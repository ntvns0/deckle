# Deckle

> **deckle** *(n.)* — the ragged edge of a sheet formed by hand, never
> cut by a machine.

A website that tries very hard to be a physical sheet of paper you can
write on. No build step, no dependencies, no design tool — four source
files and a browser, plus a dev server if you want live reload.

**See it: <https://ntvns0.github.io/deckle/>**

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

Then open **<http://localhost:8787>**. Edit any of `index.html`,
`styles.css`, `ink.js` or `page.js` and the browser reloads itself.

It listens on your network too, so you can open it on a phone and draw
with a finger or a stylus; `dev.js` prints the LAN address (and the
Tailscale one, if you're on a tailnet) when it starts. `HOST=127.0.0.1
node dev.js` keeps it to this machine.

That's the whole setup. A few things worth knowing once you're in:

| To do this | Do that |
|---|---|
| Pick a nib | click the tray, bottom right — or press `2`–`5` (pen, pencil, highlighter, eraser) |
| Stop drawing | `1`, `Esc`, or the ✋ button |
| Undo / redo | `⌘Z` / `⇧⌘Z` (`ctrl` on Windows and Linux) |
| Start over | **clear** — and `⌘Z` puts it back |
| Turn the page | drag the turned-up corner at the bottom right, or click it; **← no. 01** turns back |
| Send someone your drawing | **share** → copy a link, or download a picture or the drawing file |
| See it as paper | `⌘P`; the print view drops every faked texture |

**Port already taken?** `dev.js` says so and exits rather than failing
quietly. Use another: `PORT=8788 node dev.js`.

**No Node handy?** Opening `index.html` straight from disk renders the
page — there's no bundler, no modules and no fetching, so nothing needs
a server. You lose live reload, and some browsers refuse `localStorage`
on `file://`, so your ink may not survive a refresh. The page handles
that without breaking; it just forgets.

### What the dev server is

Static file server plus live reload, zero dependencies, ~190 lines. It
watches the four source files and pushes a reload over Server-Sent
Events; the client script is injected into the HTML on the way out, so
nothing in the source knows it exists. It also reconnects on its own,
so you can edit `dev.js` and restart it without touching the browser.

Because it's on the network, it's careful about what it hands out:
only files inside the project, never a dotfile or anything under a
dot-directory (`.git` holds the whole history), and a malformed URL is
a 400 rather than a crash. `test/dev-server.test.js` holds it to that.

### Tests

```sh
node --test
```

No framework, nothing to install: `node:test` and a fake canvas that
writes down every drawing call. They cover the stroke model (undo,
redo, clear and save/restore all replay identically, and a pinned
pencil stroke fails if the seeded scatter ever changes), the link
format, and the dev server. CI runs them on every push.

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

A few hundred lines, no dependencies. A stroke drawn with a constant `lineWidth`
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
  PRNG. Without it every undo would re-shuffle the pencil. The tests pin
  a fixed stroke's scatter to a hash, so moving one `rnd()` call inside
  `_graphite` fails CI instead of silently re-scattering every saved
  drawing.

And a fifth, collected later: **a drawing can leave the browser**. See
[Sharing a drawing](#sharing-a-drawing).

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

It prints the page you're on, and only that one.

Known limit: ink lives on one canvas sized to the whole sheet, and a
canvas won't split across a page break, so a drawing that spans several
printed pages gets cut at the first one.

## The page turn

The name is the argument, and this is where it stops being asserted:
the page ends, and you turn it. The pad is two sheets of the same size
stacked in one grid cell — the article on top, a fresh ruled sheet
underneath with a sliver of its edge showing. The top sheet's bottom
right corner sits turned up as a dog-ear; reach for it and it lifts a
little more.

There is no 3D transform and no screenshot of the page. The corner is
at C, your hand has carried it to D, and the fold is the perpendicular
bisector of CD. The sheet is `clip-path`ed to the far side of that
line, and the part beyond it is drawn again as its own back: the same
outline reflected across the fold, filled with the paper's grain and
shaded as a curl — dark in the crease, a bright band where the curve
faces the room. Both are plain clip-paths, so every multiply blend and
SVG filter on the page keeps working while it turns. It holds 60fps on
an integrated GPU.

Paper doesn't stretch, so the corner is held within a sheet-width of
the bottom left, where the page is still lying flat. Let go past
halfway (or throw it) and it goes over; short of that it drops back.
Clicking the corner, or Enter on it, turns it for you; **← no. 01** at
the top of the next sheet brings the first one back.

One bug worth remembering: the flap was first a sheet-sized box with a
reflection `transform`. A transformed box counts toward the page's
scroll height, so the page grew a sheet's worth of empty desk at the
bottom. The flap is now placed and sized to its own outline.

## The surfaces

The controls are in [Run it](#run-it); this is the behaviour behind
them, which is less obvious.

There are three places to draw. The **scratch pad** is always live. The
two **sheets** only accept marks once you've picked up a nib — in
reading mode their canvases are `pointer-events: none`, so text stays
selectable and you can't scribble on the page by accident. With a nib
in hand, the type lets strokes through to the ink underneath it.

(For a long time that last part was missing: the type sits above the
ink canvas and quietly caught every stroke, so only the pad ever took
marks. The checks that "verified" it fired events straight at the
canvas, which is exactly the path a real pointer never takes. It's
fixed, and it was found by driving a real browser with real input.)

Undo applies to the page you're looking at — whichever of its surfaces
you drew on last, falling through to the other when that one has
nothing left. The button is enabled if *any* of them can act, so it
must never be a no-op. That history reaches back over `clear`, which
is why the button is recoverable rather than final. Clear, likewise,
only clears the page you're on.

Everything you draw lives on a canvas sized to the whole sheet, so it
scrolls with the page, survives a resize, and comes back after a reload.

## Sharing a drawing

**share** in the tray, three ways out and one way in.

- **A link.** The whole drawing is packed into the URL's fragment —
  after the `#`, which browsers never send to a server. There's no
  backend and nothing stored anywhere but the link. Points are already
  multiples of 1e-5 of the sheet width, so they pack exactly as
  integers; consecutive samples are close together, so they're stored
  as small differences in one or two bytes each; deflate does the rest.
  Being exact matters, because pencil replays its scatter from the
  points. A few strokes come to well under a kilobyte. On a phone it
  opens the share sheet; over plain `http` on the LAN, where browsers
  withhold the clipboard, it shows the link to copy.
- **A picture.** Your ink, redrawn from the stroke list at 2x on the
  sheet's own paper: colour, the same turbulence textures, the ruling
  and the margin. The type isn't in it — a canvas can't draw the DOM —
  so it's cropped to the ink.
- **A file.** `.json`, the same shape `serialize()` has always
  returned. Open one from the menu or drop it on the page.

Anything that arrives from a link or a file is someone else's drawing:
a note says so, nothing is saved while it's up, and your own waits
underneath until you either go **back to my page** or **keep it as
mine**. Links and files are anyone's input, so the decoder bounds every
count before allocating, rejects truncated or trailing bytes, and stops
inflating at 16 MB; `restore()` drops any stroke that isn't well formed.

Known limit: strokes are positioned as a fraction of the sheet's width,
but the type reflows with the window. Annotations made over the text on
a laptop land on different words on a phone. A drawing on the blank
sheet travels exactly.

## Files

```
index.html   markup + the SVG filter definitions
styles.css   the paper
ink.js       the variable-width stroke engine, stroke model, link format
page.js      reveals, tilt, the page turn, tool tray, storage, sharing

dev.js       static server + live reload
test/        node:test — stroke replay, link format, dev server
fonts/       Caveat and Kalam, Latin subset, with their licences
icon.svg, apple-touch-icon.png, og.png   favicon and link preview
```

The site is published to GitHub Pages by `.github/workflows/pages.yml`
on every push to `main`: tests first, then the files the page loads,
copied as they are.

## Next

See **[ROADMAP.md](ROADMAP.md)** for what's shipped and what's queued.

## Contributing

Issues and pull requests are welcome. There's no build step and nothing
to install — clone it, run `node dev.js`, edit, and run `node --test`
before you push. If you're adding a nib, it's a single entry in the
`NIBS` table in `ink.js` plus a swatch in the tray — and add it to the
*end* of `TOOLS` in the same file, because its position there is
written into every shared link.

## License

[MIT](LICENSE).

The fonts are Caveat and Kalam, served from `fonts/` rather than Google
Fonts — no third-party request, no visitor IP handed to anyone. Both
are under the SIL Open Font License; the licences are alongside them.
`prefers-reduced-motion` skips every animation, the page turn included.
