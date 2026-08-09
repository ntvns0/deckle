# Roadmap

Where Deckle is. Three sections: what's **done**, what's **in
progress**, and what's **next**. An item moves down this file, never
sideways — if something is listed as done it is in `main` and has been
looked at in a browser, not just written.

The organising principle for everything below is the one in the
[README](README.md): this is a page, not a scroll, and every feature has
to survive `mix-blend-mode: multiply` and a stack of SVG filters. That
constraint kills more ideas than taste does.

---

## Done

### The sheet — `a5c975e`

The original build. Three stacked noise layers as the substrate, a
deckled edge and torn bottom from `feDisplacementMap`, glyphs pushed off
their outlines so no two `e`s match, everything rotated a fraction of a
degree, and baselines locked to the ruled-line pitch. All of it
multiplying into the fibers rather than sitting on top of them.

### The ink engine — `a5c975e`

~300 dependency-free lines. Strokes are chains of filled quads whose
width tracks pointer velocity, with real stylus pressure overriding it
when a tablet reports it, and `getCoalescedEvents()` recovering the
samples the browser batched between frames. Four nibs: pen, pencil
(stippled graphite, no solid fill anywhere), highlighter (composited
once on pointerup so crossings don't darken), eraser.

Strokes are stored as point data rather than pixels, which is the
decision the rest of the project leans on — it's what makes undo,
persistence, and crisp resizing possible at all.

### Undoable clear — `8bd77b0`

`clear()` used to empty the stroke list *and* the redo stack and then
immediately persist, so one stray click destroyed a drawing with no path
back. That was the only place in the codebase where the stroke model
wasn't being used to do the obvious thing. Clears now push the discarded
list onto a stack and `⌘Z` steps back over them.

The knock-on: "can I undo" stopped being the same question as "is there
ink on the canvas," so `hasInk` no longer answers it. `canUndo` /
`canRedo` getters were added and the tray asks those.

Verified pixel-exact rather than assumed — 2 strokes → 5536 ink pixels →
clear → 0 → undo → 5536 again, then undo → 2768, redo → 5536.

**Known limit:** the snapshot lives in memory, not `localStorage`. A
clear you don't undo before reloading is permanent.

### Print stylesheet — `8bd77b0`

The premise is that a website can be a page, and `⌘P` is where that
claim gets tested. The rules invert the argument instead of preserving
it: a printer supplies grain, tooth and fibers for free, so every layer
faking those comes off, the sheet squares up to true, and what prints is
the type, the ruling and your ink.

The bug worth remembering: `.fade` elements sit at `opacity: 0` until
they scroll into view, so printing a fresh load produced a beautifully
textured **blank page**. Print now forces every reveal to its finished
state.

**Known limit:** ink is one canvas sized to the whole sheet, and a
canvas won't split across a page break, so a drawing spanning several
printed pages is cut at the first.

---

## In progress

Nothing is mid-flight right now.

When you start something, move it here with a line on what you're
actually doing — not the title, the approach — so an interrupted piece
of work can be picked back up by someone who isn't you.

---

## Next

Roughly in the order they're worth doing. The first three were scoped
during the review that produced the two shipped items above; they're
agreed, just not started.

### 1. Export — get a drawing off the machine

Strokes-as-data already bought undo, persistence and crisp resize.
Export is the fourth thing it paid for and it hasn't been collected: a
drawing currently can't leave the browser profile it was made in, which
is a strange fate for something deliberately modeled as a document.

Two forms, both small. **PNG** via `toBlob()`, composited over a render
of the sheet — ink alone on transparency isn't the artifact anyone
wants. **JSON**, where `serialize()` already returns the right shape and
`restore()` already validates on the way back in, so it's a
download/drop-to-load pair and little else.

The open question is UI. The tray is a deliberate, finished-looking row
of pens and two more buttons may not belong in it.

### 2. Self-host the fonts

`index.html` pulls Caveat and Kalam from Google Fonts. The README opens
with "no dependencies" and the sticky note *in the page itself* says
"four files and zero dependencies," while there's a render-blocking
third-party request that also leaks every visitor's IP to Google.

Two `woff2` files and an `@font-face` block resolves the contradiction
and kills the flash of fallback cursive. `dev.js` already serves
`font/woff2`. Needs a call on committing binaries to the repo.

### 3. A test for stroke determinism

The README claims undo→redo round-trips to an identical pixel count and
quantifies replay drift at ~0.05%. Both are true and both were measured
by hand.

`mulberry32` seeding is the load-bearing detail of the whole stroke
model and exactly the kind of thing that breaks silently: move one
`rnd()` call inside `_graphite` and every replayed pencil stroke
re-scatters, with nothing to catch it. One headless check against a
canvas stub, counting `arc()` calls and their arguments, would pin it.

### 4. The corner-peel page turn

The identity feature. A draggable fold: the next sheet stacked
underneath with a sliver of edge showing, grab the bottom corner and
fold it back. Built from `clip-path` plus a mirrored shaded triangle
rather than a rasterized 3D flip, so the blend modes and filters survive
intact.

This is what makes "the page *ends*" literal instead of asserted. It's
also the most expensive item here, and the `clip-path` will fight the
multiply stack in ways that won't surface until it's half-built. Worth
doing after the cheap wins above, not before.

### 5. Smaller things

- **Pointer-tracked raking light.** `.sheet__light` is a fixed gradient;
  driving its angle from the pointer would make the sheet read as a
  surface being tilted.
- **A paper-stock switcher** — legal pad, graph, kraft. Mostly a matter
  of swapping the rule pitch, the paper variables and the fleck density.
- **A hand-authored SVG wordmark** that genuinely writes itself, instead
  of a font revealed by a mask.
- **Favicon, `theme-color`, and an OG image.** A project this visual has
  no social preview card, and the OG image could just be a screenshot of
  the sheet.
- **Redo across a clear.** Undoing a clear restores the strokes but
  drops the redo branch. Consistent with how a new stroke branches
  history, but a proper command stack would handle both.
- **Pencil redraw cost.** Every undo re-renders the full stroke list,
  and `_graphite` stipples hundreds of arcs per segment. A few hundred
  pencil strokes will make undo perceptibly slow; caching a bitmap of
  everything below the current stroke would fix it. Not yet measured —
  measure before building.

---

## Not doing

- **Infinite scroll.** The name is the argument: a deckle edge means the
  sheet was made rather than manufactured, and that the page ends.
- **A build step or a framework.** The constraint is load-bearing. Four
  source files that a browser reads directly is the point, not an
  accident of scale.
