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
    this.dpr = Math.min(global.devicePixelRatio || 1, 2);
    this.tool = opts.tool || "pen";
    this.enabled = opts.enabled !== false;
    this.onFirstMark = opts.onFirstMark || null;
    this.onCommit = opts.onCommit || null;

    /* The document. Everything on screen is a rendering of this. */
    this.strokes = [];
    this.undone = [];
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

  InkSurface.prototype.clear = function () {
    this.strokes = [];
    this.undone = [];
    this.redraw();
    this._commit();
  };

  InkSurface.prototype.undo = function () {
    if (!this.strokes.length) return false;
    this.undone.push(this.strokes.pop());
    this.redraw();
    this._commit();
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

  InkSurface.prototype.restore = function (strokes) {
    if (!Array.isArray(strokes)) return;
    this.strokes = strokes.filter(function (s) {
      return s && NIBS[s.tool] && Array.isArray(s.p) && s.p.length >= 3;
    });
    this.undone = [];
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

  global.InkSurface = InkSurface;
})(window);
