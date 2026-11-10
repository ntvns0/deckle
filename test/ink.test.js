/* The stroke model is the decision the whole project leans on: the
   canvas is only ever a rendering of a list of strokes, and a pencil
   stroke's scatter is replayed from a seed. These tests pin that down
   against a fake canvas that records every drawing call.
   Run with `node --test`. */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

/* ── a canvas that writes down what it was asked to draw ──────── */

function fakeContext(log) {
  const ctx = {
    fillStyle: "#000",
    globalAlpha: 1,
    globalCompositeOperation: "source-over"
  };
  const rec = (name) => (...args) => {
    log.push([name, ctx.fillStyle, ctx.globalCompositeOperation, ctx.globalAlpha,
              ...args.map((a) => (typeof a === "number" ? +a.toFixed(6) : typeof a))]);
  };
  for (const m of ["arc", "moveTo", "lineTo", "fill", "clearRect", "drawImage"]) ctx[m] = rec(m);
  for (const m of ["save", "restore", "beginPath", "closePath", "setTransform"]) ctx[m] = () => {};
  return ctx;
}

function fakeCanvas(width = 800, height = 600) {
  const log = [];
  const handlers = {};
  const canvas = {
    log,
    clientWidth: width,
    clientHeight: height,
    width: 0,
    height: 0,
    ctx: fakeContext(log),
    getContext() { return this.ctx; },
    addEventListener(type, fn) { handlers[type] = fn; },
    setPointerCapture() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width, height }),
    fire(type, e) { handlers[type](e); }
  };
  return canvas;
}

/* ink.js is a browser script, not a module. Run it the way a page
   would, with just enough of `window` for it to find. */
globalThis.window = globalThis;
globalThis.devicePixelRatio = 1;
globalThis.document = { createElement: () => fakeCanvas() };
vm.runInThisContext(fs.readFileSync(path.join(__dirname, "..", "ink.js"), "utf8"), { filename: "ink.js" });
const { InkSurface } = globalThis;

/* Drive a stroke through the real pointer handlers. */
function draw(surface, tool, points, startT = 1000) {
  surface.setTool(tool);
  const c = surface.canvas;
  const ev = (x, y, t) => ({
    pointerId: 1, pointerType: "mouse", pressure: 0.5,
    offsetX: x, offsetY: y, clientX: x, clientY: y,
    timeStamp: t, target: c, preventDefault() {}
  });
  c.fire("pointerdown", ev(points[0][0], points[0][1], startT));
  points.slice(1).forEach(([x, y], i) => c.fire("pointermove", ev(x, y, startT + (i + 1) * 16)));
  const last = points[points.length - 1];
  c.fire("pointerup", ev(last[0], last[1], startT + points.length * 16));
}

/* A wavy line, so width and direction both change along it. */
function squiggle(x0, y0, n = 40) {
  return Array.from({ length: n }, (_, i) => [x0 + i * 6, y0 + Math.sin(i / 3) * 20 + i]);
}

function renderLog(surface) {
  surface.canvas.log.length = 0;
  surface.redraw();
  return surface.canvas.log.slice();
}

function digest(log) {
  return crypto.createHash("sha256").update(JSON.stringify(log)).digest("hex").slice(0, 16);
}

function newSurface() {
  return new InkSurface(fakeCanvas(), { tool: "pen" });
}

/* ── replay ───────────────────────────────────────────────────── */

test("undo then redo replays every stroke identically", () => {
  const s = newSurface();
  draw(s, "pen", squiggle(20, 40));
  draw(s, "pencil", squiggle(30, 200));
  draw(s, "marker", squiggle(10, 320));
  draw(s, "eraser", squiggle(60, 60, 10));
  assert.equal(s.strokes.length, 4);

  const before = renderLog(s);
  assert.ok(before.length > 1000, "should have drawn something substantial");
  for (let i = 0; i < 4; i++) s.undo();
  assert.equal(s.strokes.length, 0);
  for (let i = 0; i < 4; i++) s.redo();
  assert.deepEqual(renderLog(s), before);
});

test("a saved drawing restores to the same rendering", () => {
  const a = newSurface();
  draw(a, "pencil", squiggle(20, 40));
  draw(a, "pen", squiggle(50, 140));
  const saved = JSON.parse(JSON.stringify(a.serialize()));

  const b = newSurface();
  b.restore(saved);
  assert.deepEqual(renderLog(b), renderLog(a));
});

test("pencil scatter is pinned to its seed", () => {
  /* A fixed stroke with a fixed seed has to scatter graphite exactly
     the same way forever. If this hash changes, every pencil stroke
     anyone has saved now redraws differently — most likely an rnd()
     call was added, removed or moved in _graphite. Only update the
     hash if that change was meant to break old drawings. */
  const s = newSurface();
  const p = [];
  squiggle(20, 40, 30).forEach(([x, y], i) => p.push(x / 800, y / 800, (2 + (i % 5) * 0.4) / 800));
  s.restore([{ tool: "pencil", seed: 123456789, p }]);
  const log = renderLog(s).filter((call) => call[0] === "arc");
  assert.ok(log.length > 500);
  assert.equal(digest(log), "aaf0fe5d66d60ecc");
});

test("clear is undoable, and undo walks back over it", () => {
  const s = newSurface();
  draw(s, "pen", squiggle(20, 40));
  draw(s, "pen", squiggle(20, 140));
  const full = renderLog(s);

  assert.equal(s.clear(), true);
  assert.equal(s.hasInk, false);
  assert.equal(s.canUndo, true, "a clear can be undone");

  s.undo();
  assert.equal(s.strokes.length, 2);
  assert.deepEqual(renderLog(s), full);
});

test("restore drops anything that isn't a well-formed stroke", () => {
  const s = newSurface();
  const good = { tool: "pen", seed: 1, p: [0.1, 0.1, 0.004, 0.2, 0.2, 0.004] };
  s.restore([
    good,
    null,
    { tool: "crayon", seed: 1, p: [0, 0, 0] },
    { tool: "pen", seed: 1, p: [0, 0] },
    { tool: "pen", seed: 1, p: [0, 0, 0, 1] },
    { tool: "pen", seed: 1, p: [0, NaN, 0] },
    { tool: "pen", seed: 1, p: [0, "1", 0] },
    { tool: "pen", p: [0, 0, 0] }
  ]);
  assert.deepEqual(s.strokes, [good]);
  s.restore("not an array");
  assert.deepEqual(s.strokes, [good], "junk input leaves the drawing alone");
});

/* ── packing drawings into links ──────────────────────────────── */

function sampleDrawing() {
  const a = newSurface();
  draw(a, "pen", squiggle(20, 40));
  draw(a, "pencil", squiggle(30, 200, 80));
  draw(a, "marker", squiggle(10, 320));
  const b = newSurface();
  draw(b, "eraser", squiggle(5, 5, 12));
  return [a.serialize(), b.serialize(), []];
}

test("encode/decode round-trips points exactly", () => {
  const drawing = sampleDrawing();
  const back = InkSurface.decode(InkSurface.encode(drawing));
  assert.deepEqual(back, JSON.parse(JSON.stringify(drawing)));
});

test("pack/unpack round-trips through a link, and is much smaller than JSON", async () => {
  const drawing = sampleDrawing();
  const text = await InkSurface.pack(drawing);
  assert.match(text, /^[zr][A-Za-z0-9_-]+$/, "fragment-safe characters only");
  assert.deepEqual(await InkSurface.unpack(text), JSON.parse(JSON.stringify(drawing)));
  const json = JSON.stringify(drawing).length;
  assert.ok(text.length < json / 3, `link ${text.length} chars vs JSON ${json}`);
});

test("decode refuses malformed input rather than drawing garbage", async () => {
  const good = InkSurface.encode(sampleDrawing());
  const bad = {
    empty: new Uint8Array([]),
    wrongVersion: new Uint8Array([9, 0]),
    truncated: good.slice(0, good.length - 5),
    trailing: new Uint8Array([...good, 0]),
    unknownTool: new Uint8Array([1, 1, 1, 7, 0, 1, 0, 0, 0]),
    hugeCount: new Uint8Array([1, 1, 0xff, 0xff, 0xff, 0x7f]),
    lyingPointCount: new Uint8Array([1, 1, 1, 0, 0, 0xff, 0xff, 0x03, 0, 0, 0])
  };
  for (const [name, bytes] of Object.entries(bad)) {
    assert.throws(() => InkSurface.decode(bytes), Error, name);
  }
  for (const text of ["", "x", "zno+pe", "r!!!", "z" + "A".repeat(40)]) {
    await assert.rejects(InkSurface.unpack(text), Error, JSON.stringify(text));
  }
});

test("a link that inflates past the size limit is refused", async () => {
  /* ~20 MB of zeros deflates to a few kilobytes. */
  const zeros = new Uint8Array(20 * 1024 * 1024);
  const z = new Uint8Array(await new Response(
    new Blob([zeros]).stream().pipeThrough(new CompressionStream("deflate-raw"))
  ).arrayBuffer());
  let bin = "";
  z.forEach((b) => { bin += String.fromCharCode(b); });
  const text = "z" + btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  assert.ok(text.length < 100000);
  await assert.rejects(InkSurface.unpack(text), /too large/);
});
