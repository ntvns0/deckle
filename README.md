# Deckle

> **deckle** *(n.)* — the ragged edge of a sheet formed by hand, never
> cut by a machine.

A website that tries very hard to be a physical sheet of paper you can
write on. No build step, no dependencies, no design tool — four source
files and a browser, plus a dev server if you want live reload.

The name is the argument. A deckle edge is what you get when a sheet is
made rather than manufactured, and it's a promise that the page *ends* —
which is why this is paginated and will never be an infinite scroll.

## Run it

You need Node. Nothing else — there is no `npm install`, because there
is nothing to install.

```sh
git clone <this repo> deckle
cd deckle
node dev.js
```

Then open **<http://127.0.0.1:8787>**. Edit any of `index.html`,
`styles.css`, `ink.js` or `page.js` and the browser reloads itself.

That's the whole setup. A few things worth knowing once you're in:

| To do this | Do that |
|---|---|
| Pick a nib | click the tray, bottom right — or press `2`–`5` (pen, pencil, highlighter, eraser) |
| Stop drawing | `1`, `Esc`, or the ✋ button |
| Undo / redo | `⌘Z` / `⇧⌘Z` (`ctrl` on Windows and Linux) |
| Start over | **clear** — and `⌘Z` puts it back |
| See it as paper | `⌘P`; the print view drops every faked texture |

**Port already taken?** `dev.js` says so and exits rather than failing
quietly. Use another: `PORT=8788 node dev.js`.

**No Node handy?** Opening `index.html` straight from disk renders the
page — there's no bundler, no modules and no fetching, so nothing needs
a server. You lose live reload, and some browsers refuse `localStorage`
on `file://`, so your ink may not survive a refresh. The page handles
that without breaking; it just forgets.

### What the dev server is

Static file server plus live reload, zero dependencies, ~140 lines. It
watches the four source files and pushes a reload over Server-Sent
Events; the client script is injected into the HTML on the way out, so
nothing in the source knows it exists. It also reconnects on its own,
so you can edit `dev.js` and restart it without touching the browser.

---

The rest of this file is *why* the page is built the way it is. If you
only wanted to run it, you're done — go draw on it.

## The techniques, in order of how much they matter

**1. Ink multiplies.** This is the whole thing. Composite type normally
over a textured background and the texture dies underneath the glyphs —
you get letters sitting *on* a photo of paper. `mix-blend-mode: multiply`
makes the type a stain *in* the sheet, and the fibers show straight
through it. Every mark here multiplies: the type, the rules, the tape,
the coffee ring, the highlighter, and anything you draw.

**2. The substrate is three stacked noise layers,** not an image:

| Layer | What it does |
|---|---|
| `--tex-grain` | high-frequency `feTurbulence`, the tooth of the sheet |
| `--tex-fiber` | anisotropic turbulence (`baseFrequency: 0.004 0.9`) → long fibers |
| `--tex-fleck` | `feComponentTransfer` with a `discrete` alpha ramp → sparse dark specks |

They're inlined as `data:image/svg+xml` background images, so the browser
rasterizes each one once and caches it. A live SVG filter over a surface
that big would repaint on every scroll.

**3. Displacement kills the repeated-glyph tell.** A font renders the
third `e` in a paragraph pixel-identical to the first, and the eye catches
it even when it can't say why. `#f-ink` pushes every glyph a couple of
pixels off its outline with a `feDisplacementMap`, so no two are the same.
`#f-graphite` is the same idea, harder, for pencil.

**4. Edges are displaced, not drawn.** The deckle (`#f-deckle`), the torn
bottom (`#f-tear`) and the torn tape ends (`#f-tape`) are all one
`feTurbulence` + `feDisplacementMap` pair at different frequencies. Order
matters in `filter:` — displace *first*, then `drop-shadow`, so the shadow
traces the ragged silhouette instead of a clean rectangle.

**5. Nothing is at zero degrees.** The sheet, the rules, every heading,
every note is rotated a fraction of a degree, with a little random jitter
added at runtime so repeated elements don't line up with each other.

**6. Baselines sit on the rules.** `--rule-h` sets both the ruled-line
pitch and the `line-height` of every paragraph, so the writing lands on
the lines instead of floating between them.

## The ink engine (`ink.js`)

~300 lines, no dependencies. A stroke drawn with a constant `lineWidth`
reads as a computer line every time, so instead each stroke is a chain of
filled quads whose width tracks pointer velocity — fast is thin, slow is
fat — smoothed between samples. Real stylus pressure overrides velocity
when a tablet reports it. `getCoalescedEvents()` recovers the samples the
browser batched between frames, which is the difference between a smooth
curve and a polyline on a fast flick.

Four nibs:

- **pen** — solid variable-width quads
- **pencil** — no solid fill anywhere; graphite is stippled across the
  segment and a hashed "tooth" function keeps the low spots of the paper bare
- **highlighter** — drawn opaque into an offscreen buffer and composited
  *once* at low alpha on pointerup, so a stroke crossing itself stays one
  flat pass instead of darkening at the intersection
- **eraser** — `destination-out`

Coordinates come from `offsetX`/`offsetY` rather than
`clientX - rect.left`, because the sheet is rotated and offset coords
respect the element's transform where a bounding-rect subtraction wouldn't.

## Strokes are data, not pixels

The canvas is only ever a *rendering* of a stroke list. Each stroke is
`{tool, seed, p: [x, y, w, …]}`, and that one decision buys four things
at once:

- **Undo / redo** (`⌘Z`, `⇧⌘Z`) — pop a stroke, re-render the list.
- **Persistence** — `localStorage`, written on a 400 ms debounce. A few
  hundred strokes is single-digit kilobytes.
- **Crisp resizing** — coordinates are stored as a *fraction of the sheet
  width*, so a resize rescales the drawing and redraws it at the new
  size. Rescaling the old bitmap instead would soften the ink a little
  more on every resize.
- **Deterministic pencil** — graphite is scattered at random, so each
  stroke carries a seed and the scatter is replayed from a `mulberry32`
  PRNG. Without it every undo would re-shuffle the pencil. Verified:
  undo→redo round-trips to the identical pixel count.

Storage degrades gracefully — on a quota error it drops the oldest
quarter of the strokes and retries rather than losing everything, and a
`localStorage` that throws outright (private mode) just means the page
forgets, not that it breaks.

**Clear is an edit, not a demolition.** It used to empty the stroke list
*and* the redo stack, so one stray click destroyed a drawing with no way
back — a strange thing to allow on a page whose whole argument is that
strokes are data. Now the discarded list is set aside on a stack and
`⌘Z` walks back over the clear like any other edit. `canUndo` is
therefore no longer the same question as `hasInk`, which is why the tray
asks the surface rather than counting strokes. The one honest limit: the
snapshot lives in memory, not in `localStorage`, so a clear you haven't
undone before you reload is permanent.

One honest limitation: replayed points are rounded to ~0.01 px, so a
reload reproduces a drawing to about 0.05% coverage drift rather than
bit-exactly. It's invisible, and it's confined to pencil grain.

## Printing it

The premise of this thing is that a website can be a page, and the one
moment that claim gets tested for real is `⌘P`. So the print stylesheet
inverts the entire argument instead of preserving it: a printer already
hands you grain, tooth, fibers and whatever light is in the room, so
every layer that was *faking* those comes off — the desk, the three
noise layers, the raking light, the deckle, the torn edge, the tape and
the coffee ring. The sheet squares up to true, because the tilt was
there to say a hand put it down and now a hand is holding it. What
survives is only the marks: the type with its displacement filters
(the one thing paper can't supply), the ruling, and your ink.

Two details that aren't obvious. The ruled lines and the red margin are
painted as backgrounds, which browsers strip from print by default, so
they're asked for by name with `print-color-adjust: exact` — the ruling
is the sheet, not decoration. And the reveal animations start at
`opacity: 0` until they scroll into view, which on a fresh load means a
print job would produce a beautifully textured blank page; print forces
every `.write`, `.fade` and `.draw` to its finished state.

Known limit: ink lives on one canvas sized to the whole sheet, and a
canvas won't split across a page break, so a drawing that spans several
printed pages gets cut at the first one.

## The two surfaces

The controls are in [Run it](#run-it); this is the behaviour behind
them, which is less obvious.

There are two places to draw. The **scratch pad** is always live. The
**sheet** only accepts marks once you've picked up a nib — in reading
mode its canvas is `pointer-events: none`, so text stays selectable and
you can't scribble on the page by accident.

Undo applies to whichever surface you drew on last, falling through to
the other one when that one has nothing left; the button is enabled if
*either* surface can act, so it must never be a no-op. That history
reaches back over `clear`, which is why the button is recoverable
rather than final.

Everything you draw lives on a canvas sized to the whole sheet, so it
scrolls with the page, survives a resize, and comes back after a reload.

## Files

```
dev.js       static server + live reload
index.html   markup + the SVG filter definitions
styles.css   the paper
ink.js       the variable-width stroke engine + stroke model
page.js      reveals, tilt, tool tray, storage, undo
```

## Next

See **[ROADMAP.md](ROADMAP.md)** for what's shipped, what's being worked
on, and what's queued.

The headline item is a draggable corner-peel page turn: the next sheet
stacked underneath with a sliver of edge showing, grab the bottom corner
to fold it back. Built from `clip-path` plus a mirrored shaded triangle
rather than a rasterized 3D flip, so the blend modes and SVG filters
survive intact.

## Contributing

Issues and pull requests are welcome. There's no build step and nothing
to install — clone it, run `node dev.js`, and edit. If you're adding a
nib, it's a single entry in the `NIBS` table in `ink.js` plus a swatch in
the tray.

## License

[MIT](LICENSE).

Fonts are Caveat and Kalam from Google Fonts, with a `cursive` fallback if
they don't load. `prefers-reduced-motion` skips every animation.
