# Roadmap

Where Deckle is. Three sections: what's **done**, what's **in
progress**, and what's **next**. An item moves down this file, never
sideways — if something is listed as done it is in `main` and has been
looked at in a browser, not just written. "Looked at" means real input
in a real browser: see the sheet-drawing bug below for what a synthetic
event fired straight at an element can hide.

Commits are named by hash where they're in `main`'s history, and by
subject where they arrived on a branch — a squash merge rewrites
hashes, which is how this file once ended up citing commits that
didn't exist.

The organising principle for everything below is the one in the
[README](README.md): this is a page, not a scroll, and every feature has
to survive `mix-blend-mode: multiply` and a stack of SVG filters. That
constraint kills more ideas than taste does.

---

## Done

### The sheet — `02ef35d`

The original build. Three stacked noise layers as the substrate, a
deckled edge and torn bottom from `feDisplacementMap`, glyphs pushed off
their outlines so no two `e`s match, everything rotated a fraction of a
degree, and baselines locked to the ruled-line pitch. All of it
multiplying into the fibers rather than sitting on top of them.

### The ink engine — `02ef35d`

~300 dependency-free lines. Strokes are chains of filled quads whose
width tracks pointer velocity, with real stylus pressure overriding it
when a tablet reports it, and `getCoalescedEvents()` recovering the
samples the browser batched between frames. Four nibs: pen, pencil
(stippled graphite, no solid fill anywhere), highlighter (composited
once on pointerup so crossings don't darken), eraser.

Strokes are stored as point data rather than pixels, which is the
decision the rest of the project leans on — it's what makes undo,
persistence, and crisp resizing possible at all.

### Undoable clear — `a58f4d6`

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

### Print stylesheet — `a58f4d6`

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

### The crinkle and the raking light — `32211e8`

A creased sheet, dealt fresh on every load: a crumple field in `:root`
plus 3–4 crease elements that alternate near-vertical and
near-horizontal, so they cross like a quartered sheet. The creases
blend **soft-light**, not multiply — half of a crease is the highlight,
and multiply can only take light away.

The light follows the pointer, placed opposite it so the sheet tilts to
face your hand, eased 12% per frame in a rAF loop that parks itself
when settled. Each crease compares its lit flank's direction against
the light every frame and flips when the dot product changes sign, at
the moment it's faintest, so it's never caught swapping.

This shipped in `32211e8` while this file still listed it as
uncommitted. Still open: nobody has judged the *feel* of the 12%
easing constant in live motion.

### A dev server that's safe on the network — *Harden the dev server and open it to the network*

A malformed escape (`/%E0`) crashed it; it served `.git/config` to
anyone who asked; and its containment check was a bare prefix match
that let a sibling directory through. Fixed, with a test for each, and
it now listens on `0.0.0.0` and prints its LAN and Tailscale URLs so
the page opens on a phone. `HOST=127.0.0.1` keeps it local.

### Self-hosted fonts — *Self-host Caveat and Kalam*

The sticky note on the page said "zero dependencies" over a
render-blocking request to Google Fonts. Latin subsets now live in
`fonts/` with their OFL licences, ~140 KB, the first screen's three
faces preloaded.

### Stroke replay under test — *Pin stroke replay with tests…*

`node --test`, no framework: the real pointer handlers driven against
a fake canvas that records every draw call. Undo/redo, clear/undo and
save/restore replay identically, and a fixed pencil stroke's scatter is
pinned to a hash. Checked the way it's meant to fail: moving one
`rnd()` call in `_graphite` fails the test. CI runs it.

### Drawing on the sheet actually works — *Turn the page, fix sheet drawing…*

It never did. `.content` (the type) sits above the ink canvas and
caught every stroke, so only the scratch pad ever took marks — the
earlier "verified" checks dispatched events at the canvas directly.
Found by driving headless Chrome with real mouse input. With a nib in
hand, the type now passes strokes through.

### The corner-peel page turn — *Turn the page, fix sheet drawing…*

The identity feature, done the way this file planned it: `clip-path`
on the sheet plus a mirrored, shaded flap, no rasterized 3D flip, so
the multiply stack and filters survive. Two same-size sheets share one
grid cell; the corner rests as a dog-ear, lifts on hover, follows a
drag, completes past halfway or on a throw, and turns on click or
Enter. Paper doesn't stretch, so the corner is constrained to a
sheet-width from the bottom-left. 60fps on an integrated GPU (software
rendering in headless Chrome manages ~30 — the clip re-rasterizes).

The `clip-path` didn't fight the multiply stack after all. What did
bite: a reflection `transform` on a sheet-sized flap counts toward
scroll height, and the page grew a sheet of empty desk. And releasing a
drag fires `pointerleave`, whose hover handler cancelled the turn the
release had just started.

### Export and share — *Turn the page, fix sheet drawing…*

Roadmap item #1, collected. A **link** carries the whole drawing in
the URL fragment (delta-encoded varints, deflated; exact, so pencil
replays identically; decoding bounded against hostile input). A
**PNG** redraws your ink at 2x on the sheet's paper, ruling and margin,
cropped to the ink. A **JSON** file downloads, opens from the menu, or
drops onto the page. Anything foreign opens as someone else's drawing
and saves nothing over yours until you keep it.

The UI question this file raised — whether the tray had room — was
answered with one word-button, **share**, opening a menu above it. On
phones the tray now fits one row and the sheet leaves room for it.

### Published, with a preview card — *Publish to GitHub Pages…*

A Pages workflow runs the tests and deploys the files the page loads to
<https://ntvns0.github.io/deckle/>. Favicon, `theme-color`, and an Open
Graph image rendered from the page itself.

---

## In progress

Nothing. When you start something, move it here with a line on what
you're actually doing — not the title, the approach — so an
interrupted piece of work can be picked back up by someone who isn't
you.

---

## Next

Roughly in the order they're worth doing.

### 1. The type in the picture

The PNG is ink on paper, cropped to the ink, because a canvas can't
draw the DOM. For drawings on the blank sheet that's exactly right; for
annotations on the article it loses what they were annotating. The
serious option is SVG `<foreignObject>` with the fonts and filters
inlined, which Safari taints. Worth a spike to see what it costs.

### 2. Annotations that stay on their words

Strokes are positioned as a fraction of the sheet's width, but the type
reflows with the window, so a circle drawn around a word on a laptop
lands somewhere else on a phone. Fixing it means anchoring strokes to
the text block they were drawn over. The blank sheet doesn't have the
problem.

### 3. Pencil redraw cost

Every undo re-renders the full stroke list, and `_graphite` stipples
hundreds of arcs per segment. A few hundred pencil strokes will make
undo perceptibly slow; caching a bitmap of everything below the current
stroke would fix it. Not yet measured — measure before building. The
fake canvas in `test/` can count the calls.

### 4. Smaller things

- **A paper-stock switcher** — legal pad, graph, kraft. Mostly a matter
  of swapping the rule pitch, the paper variables and the fleck density.
  The blank sheet is the natural place for it.
- **A hand-authored SVG wordmark** that genuinely writes itself, instead
  of a font revealed by a mask.
- **Dragging the page back.** Turning forward is a drag; turning back is
  only a click on **← no. 01**. A corner of the turned sheet to take
  hold of would make it symmetric.
- **Redo across a clear.** Undoing a clear restores the strokes but
  drops the redo branch. Consistent with how a new stroke branches
  history, but a proper command stack would handle both.

---

## Not doing

- **Infinite scroll.** The name is the argument: a deckle edge means the
  sheet was made rather than manufactured, and that the page ends. It
  now literally does — there are two sheets, and the second says so.
- **A build step or a framework.** The constraint is load-bearing. Four
  source files that a browser reads directly is the point, not an
  accident of scale.
