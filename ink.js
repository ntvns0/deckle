/* ═══════════════════════════════════════════════════════════════
   ink.js — a small variable-width stroke engine
   ───────────────────────────────────────────────────────────────
   A stroke drawn with a constant lineWidth always reads as a
   computer line. Real nibs swell where the hand slows and thin out
   where it accelerates, so every stroke here is a chain of filled
   quads whose width tracks pointer velocity (or real stylus
   pressure, if a tablet is reporting it).

   Strokes are kept as point data rather than pixels, which is what
   makes undo, redo, crisp resizing and persistence possible — the
   canvas is only ever a rendering of the stroke list.
   ═══════════════════════════════════════════════════════════════ */

(function (global) {
  "use strict";

  var TAU = Math.PI * 2;

  /* Cheap deterministic value noise — used for pencil tooth, so the
     same patch of paper always grabs graphite the same way. */
  function hash2(x, y) {
    var n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return n - Math.floor(n);
  }

  /* Seeded PRNG. Graphite is scattered at random, so replaying a
     stroke has to draw the same sequence of numbers it was drawn
     with — otherwise every undo would re-shuffle the pencil. */
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function lerp(a, b, t)    { return a + (b - a) * t; }

  /* ── nib definitions ─────────────────────────────────────────
     speedRef is the velocity (px/ms) at which a nib reaches its
     thinnest; below that it fattens up toward wMax. */
  var NIBS = {
    pen: {
      wMin: 1.05, wMax: 3.4, speedRef: 1.9, smooth: 0.42,
      color: "rgba(41, 54, 86, 0.90)", mode: "solid"
    },
    pencil: {
      wMin: 1.7, wMax: 4.8, speedRef: 2.0, smooth: 0.34,
      color: "60, 58, 62", mode: "grain"
    },
    marker: {
      wMin: 17, wMax: 19, speedRef: 6, smooth: 0.6,
      color: "rgba(255, 220, 40, 1)", mode: "wash", alpha: 0.42
    },
    eraser: {
      wMin: 24, wMax: 28, speedRef: 6, smooth: 0.6,
      color: "#000", mode: "erase"
    }
  };

  /* Samples closer together than this are dropped. Round joints mean
     the line stays smooth, and it keeps stored strokes to a sane size. */
  var MIN_STEP = 0.75;

  function InkSurface(canvas, opts) {
    opts = opts || {};
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    /* Capped at 2: a sheet-sized canvas at 3x is a lot of memory for
       detail nobody can see. Export passes its own scale. */
    this.dpr = opts.dpr || Math.min(global.devicePixelRatio || 1, 2);
    this.tool = opts.tool || "pen";
    this.enabled = opts.enabled !== false;
    this.onFirstMark = opts.onFirstMark || null;
    this.onCommit = opts.onCommit || null;

    /* The document. Everything on screen is a rendering of this. */
    this.strokes = [];
    this.undone = [];
    /* Clearing throws away every stroke at once, which is too much
       to lose to a stray click. The discarded lists are kept here so
       undo can walk back through them like any other edit. */
    this.cleared = [];
    this.current = null;
    this.rng = Math.random;

    /* Scratch canvases, only allocated when the highlighter needs
       them: `wash` collects one stroke at full alpha, `snap` holds
       the page as it was before that stroke started. Compositing
       the finished stroke once is what stops a highlighter from
       darkening every place it crosses itself. */
    this.wash = null;
    this.snap = null;

    this.drawing = false;
    this.pointerId = null;
    this.last = null;
    this.lastW = 0;
    this.lastT = 0;

    this._bind();
    this.resize();
  }

  InkSurface.prototype._bind = function () {
    var self = this;
    var c = this.canvas;

    c.addEventListener("pointerdown", function (e) { self._down(e); });
    c.addEventListener("pointermove", function (e) { self._move(e); });
    c.addEventListener("pointerup", function (e) { self._up(e); });
    c.addEventListener("pointercancel", function (e) { self._up(e); });
    c.addEventListener("pointerleave", function (e) { self._up(e); });
  };

  Object.defineProperty(InkSurface.prototype, "hasInk", {
    get: function () { return this.strokes.length > 0; }
  });

  /* History reaches back past a clear, so "is there anything to undo"
     is no longer the same question as "is there ink on the canvas". */
  Object.defineProperty(InkSurface.prototype, "canUndo", {
    get: function () { return this.strokes.length > 0 || this.cleared.length > 0; }
  });

  Object.defineProperty(InkSurface.prototype, "canRedo", {
    get: function () { return this.undone.length > 0; }
  });

  /* ── geometry ────────────────────────────────────────────────
     Stroke coordinates are stored as a fraction of the canvas's CSS
     width, so a drawing survives a resize (and a reload at a
     different window size) by scaling as a whole rather than
     landing in the wrong place. */

  InkSurface.prototype._unit = function () {
    return this.canvas.clientWidth || 1;
  };

  /* Resize, then re-render from the stroke list. Rescaling the old
     bitmap would work but every resize would soften the ink a
     little more; redrawing keeps it crisp forever. */
  InkSurface.prototype.resize = function () {
    var c = this.canvas;
    var w = c.clientWidth;
    var h = c.clientHeight;
    if (!w || !h) return;

    var pw = Math.round(w * this.dpr);
    var ph = Math.round(h * this.dpr);
    if (c.width === pw && c.height === ph) return;

    c.width = pw;
    c.height = ph;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.wash = null;
    this.snap = null;

    this.redraw();
  };

  InkSurface.prototype.setTool = function (tool) {
    if (NIBS[tool]) this.tool = tool;
  };

  /* ── the document ───────────────────────────────────────────── */

  InkSurface.prototype.redraw = function () {
    var c = this.canvas;
    this.ctx.save();
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, c.width, c.height);
    this.ctx.restore();

    for (var i = 0; i < this.strokes.length; i++) {
      this._render(this.strokes[i]);
    }
  };

  /* Clear is an edit like any other, not a demolition: the stroke
     list is set aside rather than dropped, so undo brings it back. */
  InkSurface.prototype.clear = function () {
    if (!this.strokes.length) return false;
    this.cleared.push(this.strokes);
    this.strokes = [];
    this.undone = [];
    this.redraw();
    this._commit();
    return true;
  };

  /* Peel one stroke off the top; when the page is bare, step back
     over the clear that emptied it. */
  InkSurface.prototype.undo = function () {
    if (this.strokes.length) {
      this.undone.push(this.strokes.pop());
    } else if (this.cleared.length) {
      this.strokes = this.cleared.pop();
    } else {
      return false;
    }
    this.redraw();
    this._commit();
    if (this.strokes.length && this.onFirstMark) this.onFirstMark();
    return true;
  };

  InkSurface.prototype.redo = function () {
    if (!this.undone.length) return false;
    this.strokes.push(this.undone.pop());
    this.redraw();
    this._commit();
    return true;
  };

  InkSurface.prototype.serialize = function () {
    return this.strokes;
  };

  /* Strokes now arrive from files and links as well as from this
     browser's own storage, so anything that isn't a well-formed
     stroke is dropped rather than rendered as NaN. */
  function validStroke(s) {
    if (!s || !NIBS[s.tool] || !Array.isArray(s.p)) return false;
    if (s.p.length < 3 || s.p.length % 3 !== 0) return false;
    for (var i = 0; i < s.p.length; i++) {
      if (typeof s.p[i] !== "number" || !isFinite(s.p[i])) return false;
    }
    return typeof s.seed === "number" && isFinite(s.seed);
  }

  InkSurface.prototype.restore = function (strokes) {
    if (!Array.isArray(strokes)) return;
    this.strokes = strokes.filter(validStroke);
    this.undone = [];
    this.cleared = [];
    this.redraw();
    if (this.strokes.length && this.onFirstMark) this.onFirstMark();
  };

  InkSurface.prototype._commit = function () {
    if (this.onCommit) this.onCommit(this);
  };

  /* ── input ──────────────────────────────────────────────────── */

  /* Pointer coords in the canvas's own space. offsetX/offsetY are
     used deliberately: the sheet is rotated a fraction of a degree,
     and offset coords respect that transform where a
     getBoundingClientRect subtraction would not. */
  InkSurface.prototype._pos = function (e) {
    if (typeof e.offsetX === "number" && e.target === this.canvas) {
      return { x: e.offsetX, y: e.offsetY };
    }
    var r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  /* Nib width for this sample. Real stylus pressure wins when it's
     available; otherwise width comes from how fast the hand moved. */
  InkSurface.prototype._width = function (nib, speed, pressure, isPen) {
    var t = clamp(speed / nib.speedRef, 0, 1);
    var w = lerp(nib.wMax, nib.wMin, t * t * (3 - 2 * t));   // smoothstep
    if (isPen && pressure > 0 && pressure !== 0.5) {
      w *= 0.45 + pressure * 1.25;
    }
    return w;
  };

  InkSurface.prototype._down = function (e) {
    if (!this.enabled) return;
    var nib = NIBS[this.tool];
    if (!nib) return;

    e.preventDefault();
    /* Capture keeps a fast stroke alive when the pointer leaves the
       canvas mid-gesture. It throws on a pointerId the browser isn't
       tracking, which is exactly what synthetic events produce. */
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch (err) { /* not a live pointer — keep drawing anyway */ }

    this.drawing = true;
    this.pointerId = e.pointerId;
    this.last = this._pos(e);
    this.lastT = e.timeStamp || performance.now();
    this.lastW = nib.wMax * 0.7;

    /* A fresh branch of history: anything undone is now unreachable. */
    this.undone.length = 0;

    var seed = (Math.random() * 0x7FFFFFFF) | 0;
    this.rng = mulberry32(seed);
    this.current = { tool: this.tool, seed: seed, p: [] };
    this._record(this.last.x, this.last.y, this.lastW);

    if (nib.mode === "wash") this._beginWash();

    /* A dot, so a tap leaves a mark. */
    this._dab(this.last.x, this.last.y, this.lastW, nib);
    if (this.onFirstMark && this.strokes.length === 0) this.onFirstMark();
  };

  InkSurface.prototype._move = function (e) {
    if (!this.drawing || e.pointerId !== this.pointerId) return;
    e.preventDefault();

    var nib = NIBS[this.tool];
    /* Coalesced events recover the samples the browser batched
       between frames — the difference between a smooth curve and a
       chain of straight segments on a fast flick. */
    var events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    if (!events.length) events = [e];

    for (var i = 0; i < events.length; i++) {
      this._segment(events[i], nib);
    }
    if (nib.mode === "wash") this._compositeWash();
  };

  InkSurface.prototype._segment = function (e, nib) {
    var p = this._pos(e);
    var t = e.timeStamp || performance.now();
    var dt = Math.max(t - this.lastT, 1);

    var dx = p.x - this.last.x;
    var dy = p.y - this.last.y;
    var dist = Math.hypot(dx, dy);
    if (dist < MIN_STEP) return;

    var target = this._width(nib, dist / dt, e.pressure,
                             e.pointerType === "pen");
    /* Ease toward the target width so the stroke doesn't stutter
       between samples. */
    var w = lerp(this.lastW, target, nib.smooth);

    this._stroke(this.last, p, this.lastW, w, nib);
    this._record(p.x, p.y, w);

    this.last = p;
    this.lastW = w;
    this.lastT = t;
  };

  InkSurface.prototype._up = function (e) {
    if (!this.drawing) return;
    if (e && e.pointerId !== this.pointerId) return;
    this.drawing = false;
    this.pointerId = null;

    if (NIBS[this.tool].mode === "wash") this._commitWash();

    if (this.current && this.current.p.length >= 3) {
      this.strokes.push(this.current);
      this._commit();
    }
    this.current = null;
  };

  InkSurface.prototype._record = function (x, y, w) {
    if (!this.current) return;
    var u = this._unit();
    var p = this.current.p;
    /* five decimals of a width-fraction is ~0.01px at this scale */
    p.push(
      Math.round((x / u) * 1e5) / 1e5,
      Math.round((y / u) * 1e5) / 1e5,
      Math.round((w / u) * 1e5) / 1e5
    );
  };

  /* ── rendering ──────────────────────────────────────────────── */

  /* Draw a whole stored stroke. Same code path the live pointer
     takes, just fed from the point list instead of the mouse. */
  InkSurface.prototype._render = function (stroke) {
    var nib = NIBS[stroke.tool];
    if (!nib) return;
    var p = stroke.p;
    if (p.length < 3) return;

    var u = this._unit();
    this.rng = mulberry32(stroke.seed);

    if (nib.mode === "wash") this._beginWash();

    var prev = { x: p[0] * u, y: p[1] * u };
    var prevW = p[2] * u;
    this._dab(prev.x, prev.y, prevW, nib);

    for (var i = 3; i < p.length; i += 3) {
      var cur = { x: p[i] * u, y: p[i + 1] * u };
      var curW = p[i + 2] * u;
      this._stroke(prev, cur, prevW, curW, nib);
      prev = cur;
      prevW = curW;
    }

    if (nib.mode === "wash") this._commitWash();
  };

  InkSurface.prototype._target = function (nib) {
    return nib.mode === "wash" ? this.wash.getContext("2d") : this.ctx;
  };

  /* One segment, rendered as a quad between two circles. This is
     what buys the variable width — canvas lineWidth can't taper. */
  InkSurface.prototype._stroke = function (p0, p1, w0, w1, nib) {
    if (nib.mode === "grain") return this._graphite(p0, p1, w0, w1, nib);

    var ctx = this._target(nib);
    var dx = p1.x - p0.x, dy = p1.y - p0.y;
    var len = Math.hypot(dx, dy) || 1;
    var nx = -dy / len, ny = dx / len;

    ctx.save();
    if (nib.mode === "erase") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = "#000";
    } else {
      ctx.fillStyle = nib.color;
    }

    ctx.beginPath();
    ctx.moveTo(p0.x + nx * w0 / 2, p0.y + ny * w0 / 2);
    ctx.lineTo(p1.x + nx * w1 / 2, p1.y + ny * w1 / 2);
    ctx.lineTo(p1.x - nx * w1 / 2, p1.y - ny * w1 / 2);
    ctx.lineTo(p0.x - nx * w0 / 2, p0.y - ny * w0 / 2);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();                       /* round the joint */
    ctx.arc(p1.x, p1.y, w1 / 2, 0, TAU);
    ctx.fill();
    ctx.restore();
  };

  InkSurface.prototype._dab = function (x, y, w, nib) {
    if (nib.mode === "grain") {
      return this._graphite({ x: x, y: y }, { x: x + 0.01, y: y }, w, w, nib);
    }
    var ctx = this._target(nib);
    ctx.save();
    if (nib.mode === "erase") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = "#000";
    } else {
      ctx.fillStyle = nib.color;
    }
    ctx.beginPath();
    ctx.arc(x, y, w / 2, 0, TAU);
    ctx.fill();
    ctx.restore();
  };

  /* Pencil: no solid fill anywhere. Graphite is powder scattered
     across the tooth of the sheet, so this stipples along the
     segment and lets the paper's high spots take most of it.
     Every random number comes from the stroke's seeded generator so
     the scatter is identical on replay. */
  InkSurface.prototype._graphite = function (p0, p1, w0, w1, nib) {
    var ctx = this.ctx;
    var rnd = this.rng;
    var dx = p1.x - p0.x, dy = p1.y - p0.y;
    var dist = Math.hypot(dx, dy);
    var steps = Math.max(1, Math.ceil(dist / 0.7));

    ctx.save();
    for (var i = 0; i <= steps; i++) {
      var t = i / steps;
      var cx = p0.x + dx * t;
      var cy = p0.y + dy * t;
      var w = lerp(w0, w1, t);

      var grains = Math.max(2, Math.round(w * 1.7));
      for (var g = 0; g < grains; g++) {
        var a = rnd() * TAU;
        /* sqrt keeps the scatter even across the disc rather than
           bunching in the middle */
        var r = Math.sqrt(rnd()) * (w / 2);
        var gx = cx + Math.cos(a) * r;
        var gy = cy + Math.sin(a) * r;

        /* the tooth: low spots in the paper stay bare */
        var tooth = hash2(Math.floor(gx * 1.7), Math.floor(gy * 1.7));
        var jitter = rnd();
        if (tooth < 0.26) continue;

        var edge = 1 - (r / (w / 2)) * 0.55;
        ctx.fillStyle = "rgba(" + nib.color + "," +
                        (0.055 + tooth * 0.075) * edge + ")";
        ctx.beginPath();
        ctx.arc(gx, gy, 0.34 + jitter * 0.5, 0, TAU);
        ctx.fill();
      }
    }
    ctx.restore();
  };

  /* ── highlighter ─────────────────────────────────────────────
     Drawn opaque into `wash`, then laid down once at low alpha, so
     a stroke that crosses itself stays one flat pass of colour. */

  InkSurface.prototype._ensureScratch = function () {
    var c = this.canvas;
    if (!this.wash || this.wash.width !== c.width || this.wash.height !== c.height) {
      this.wash = document.createElement("canvas");
      this.snap = document.createElement("canvas");
      this.wash.width = this.snap.width = c.width;
      this.wash.height = this.snap.height = c.height;
      this.wash.getContext("2d").setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }
  };

  InkSurface.prototype._beginWash = function () {
    this._ensureScratch();
    var wc = this.wash.getContext("2d");
    wc.save();
    wc.setTransform(1, 0, 0, 1, 0, 0);
    wc.clearRect(0, 0, this.wash.width, this.wash.height);
    wc.restore();

    var sc = this.snap.getContext("2d");
    sc.setTransform(1, 0, 0, 1, 0, 0);
    sc.clearRect(0, 0, this.snap.width, this.snap.height);
    sc.drawImage(this.canvas, 0, 0);
  };

  InkSurface.prototype._compositeWash = function () {
    var ctx = this.ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.snap, 0, 0);
    ctx.globalAlpha = NIBS.marker.alpha;
    ctx.drawImage(this.wash, 0, 0);
    ctx.restore();
  };

  InkSurface.prototype._commitWash = function () {
    this._compositeWash();
    var wc = this.wash.getContext("2d");
    wc.save();
    wc.setTransform(1, 0, 0, 1, 0, 0);
    wc.clearRect(0, 0, this.wash.width, this.wash.height);
    wc.restore();
  };

  /* ═══════════════════════════════════════════════════════════
     PACKING — a drawing small enough to put in a link
     ───────────────────────────────────────────────────────────
     JSON spends ~8 characters on every coordinate. Points are
     already stored as multiples of 1e-5 of the sheet width, so they
     pack exactly as integers; consecutive samples sit close
     together, so the gaps between them are small, and a small
     integer is one or two bytes as a varint. Deflate takes it the
     rest of the way. Being exact matters: a pencil stroke replays
     its scatter from the seed and the points, so a lossy link would
     re-shuffle the graphite.

     Layout, all integers as LEB128 varints:
       version (1), surface count,
       per surface: stroke count,
         per stroke: tool, seed, point count,
           then x, y, w for the first point and the change in each
           for every point after it, zigzag-signed.

     A link is anyone's input, so decoding checks every count
     against a limit before it allocates anything for it. */

  var FORMAT = 1;
  /* Indices into this list are written into links, so it only ever
     grows at the end. */
  var TOOLS = ["pen", "pencil", "marker", "eraser"];
  var SCALE = 1e5;
  var LIMITS = {
    surfaces: 16,
    strokes: 20000,
    points: 200000,       /* per stroke */
    total: 2000000,       /* points across the whole drawing */
    bytes: 16 * 1024 * 1024
  };

  function Writer() { this.buf = new Uint8Array(1024); this.n = 0; }
  Writer.prototype.byte = function (b) {
    if (this.n === this.buf.length) {
      var next = new Uint8Array(this.buf.length * 2);
      next.set(this.buf);
      this.buf = next;
    }
    this.buf[this.n++] = b;
  };
  /* Arithmetic rather than bit ops, which would truncate at 2^31. */
  Writer.prototype.uint = function (v) {
    while (v >= 128) {
      this.byte((v % 128) + 128);
      v = Math.floor(v / 128);
    }
    this.byte(v);
  };
  Writer.prototype.sint = function (v) {
    this.uint(v >= 0 ? v * 2 : -v * 2 - 1);
  };
  Writer.prototype.bytes = function () { return this.buf.slice(0, this.n); };

  function Reader(bytes) { this.buf = bytes; this.i = 0; }
  Reader.prototype.uint = function () {
    var v = 0, mul = 1;
    for (var k = 0; k < 8; k++) {
      if (this.i >= this.buf.length) throw new Error("truncated");
      var b = this.buf[this.i++];
      v += (b & 127) * mul;
      if (b < 128) return v;
      mul *= 128;
    }
    throw new Error("varint too long");
  };
  Reader.prototype.sint = function () {
    var u = this.uint();
    return u % 2 ? -(u + 1) / 2 : u / 2;
  };
  Reader.prototype.upTo = function (max, what) {
    var v = this.uint();
    if (v > max) throw new Error("too many " + what);
    return v;
  };

  /* surfaces: an array of stroke lists, in a fixed order the caller
     owns (sheet, pad, …). */
  function encode(surfaces) {
    var w = new Writer();
    w.uint(FORMAT);
    w.uint(surfaces.length);
    surfaces.forEach(function (strokes) {
      strokes = (strokes || []).filter(validStroke);
      w.uint(strokes.length);
      strokes.forEach(function (s) {
        w.uint(TOOLS.indexOf(s.tool));
        w.uint(s.seed >>> 0);
        var p = s.p;
        w.uint(p.length / 3);
        var px = 0, py = 0, pw = 0;
        for (var i = 0; i < p.length; i += 3) {
          var x = Math.round(p[i] * SCALE);
          var y = Math.round(p[i + 1] * SCALE);
          var wd = Math.round(p[i + 2] * SCALE);
          w.sint(x - px); w.sint(y - py); w.sint(wd - pw);
          px = x; py = y; pw = wd;
        }
      });
    });
    return w.bytes();
  }

  function decode(bytes) {
    var r = new Reader(bytes);
    if (r.uint() !== FORMAT) throw new Error("unknown format");
    var nSurf = r.upTo(LIMITS.surfaces, "surfaces");
    var total = 0;
    var out = [];
    for (var s = 0; s < nSurf; s++) {
      var nStrokes = r.upTo(LIMITS.strokes, "strokes");
      var strokes = [];
      for (var k = 0; k < nStrokes; k++) {
        var tool = TOOLS[r.uint()];
        if (!tool) throw new Error("unknown tool");
        var seed = r.uint();
        if (seed > 0xFFFFFFFF) throw new Error("bad seed");
        var n = r.upTo(LIMITS.points, "points");
        if (n < 1) throw new Error("empty stroke");
        total += n;
        if (total > LIMITS.total) throw new Error("drawing too large");
        /* Every point costs at least three bytes, so a count the
           remaining input can't possibly hold is a lie. */
        if (n * 3 > bytes.length - r.i) throw new Error("truncated");
        var p = new Array(n * 3);
        var x = 0, y = 0, wd = 0;
        for (var i = 0; i < n * 3; i += 3) {
          x += r.sint(); y += r.sint(); wd += r.sint();
          p[i] = x / SCALE; p[i + 1] = y / SCALE; p[i + 2] = wd / SCALE;
        }
        strokes.push({ tool: tool, seed: seed, p: p });
      }
      out.push(strokes);
    }
    if (r.i !== bytes.length) throw new Error("trailing bytes");
    return out;
  }

  function toBase64Url(bytes) {
    var bin = "";
    for (var i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function fromBase64Url(str) {
    if (!/^[A-Za-z0-9_-]*$/.test(str)) throw new Error("not base64url");
    var bin = atob(str.replace(/-/g, "+").replace(/_/g, "/"));
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  /* Run bytes through a (de)compression stream. Output is read in
     chunks so a tiny link that inflates to gigabytes is stopped at
     the limit instead of being buffered whole. */
  function pipe(bytes, stream, limit) {
    var writer = stream.writable.getWriter();
    writer.write(bytes).catch(function () {});
    writer.close().catch(function () {});
    var reader = stream.readable.getReader();
    var chunks = [], size = 0;
    function pump() {
      return reader.read().then(function (res) {
        if (res.done) {
          var out = new Uint8Array(size), o = 0;
          chunks.forEach(function (c) { out.set(c, o); o += c.length; });
          return out;
        }
        size += res.value.length;
        if (size > limit) {
          reader.cancel().catch(function () {});
          throw new Error("drawing too large");
        }
        chunks.push(res.value);
        return pump();
      });
    }
    return pump();
  }

  var canZip = typeof CompressionStream === "function" &&
               typeof DecompressionStream === "function";

  /* Drawing → the text after "#ink=". The first character says how
     the rest is stored: "z" deflated, "r" raw, for a browser that
     has no CompressionStream. */
  function pack(surfaces) {
    var bytes = encode(surfaces);
    if (!canZip) return Promise.resolve("r" + toBase64Url(bytes));
    return pipe(bytes, new CompressionStream("deflate-raw"), Infinity)
      .then(function (z) { return "z" + toBase64Url(z); });
  }

  function unpack(text) {
    return Promise.resolve().then(function () {
      var kind = text.charAt(0);
      var bytes = fromBase64Url(text.slice(1));
      if (kind === "r") return bytes;
      if (kind === "z" && canZip) {
        return pipe(bytes, new DecompressionStream("deflate-raw"), LIMITS.bytes);
      }
      throw new Error("unreadable link");
    }).then(decode);
  }

  InkSurface.TOOLS = TOOLS.slice();
  InkSurface.encode = encode;
  InkSurface.decode = decode;
  InkSurface.pack = pack;
  InkSurface.unpack = unpack;
  InkSurface.isStroke = validStroke;

  global.InkSurface = InkSurface;
})(typeof window !== "undefined" ? window : globalThis);
