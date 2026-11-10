/* ═══════════════════════════════════════════════════════════════
   page.js — reveals, tilt, the pen tray, and remembering your ink
   ═══════════════════════════════════════════════════════════════ */

(function () {
  "use strict";

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ── nothing sits at exactly zero degrees ────────────────────
     The markup carries a rough angle; a little noise on top keeps
     repeated elements from lining up with each other. */
  document.querySelectorAll("[data-tilt]").forEach(function (el) {
    var base = parseFloat(el.dataset.tilt) || 0;
    var jitter = (Math.random() - 0.5) * 0.7;
    el.style.transform = "rotate(" + (base + jitter).toFixed(2) + "deg)";
  });

  /* ── fold the sheet ──────────────────────────────────────────
     A crumple field is in the stylesheet; the hard creases are dealt
     here so no two loads are folded the same way. Paper folds along
     its own geometry — near-vertical or near-horizontal, wandering a
     few degrees off true — so the angle is picked per axis rather
     than anywhere on the circle. A stray diagonal reads as a scratch,
     not a fold.

     The count is deliberately small. Every crease is a bright line
     laid over the type, and four is already at the edge of legible. */
  var creases = [];              /* handed to the raking light below */

  (function crinkle() {
    var host = document.querySelector(".sheet__crinkle");
    if (!host) return;

    var n = 3 + Math.floor(Math.random() * 2);       /* 3 or 4 */
    var vertical = Math.random() < 0.5;              /* alternates below */
    var frag = document.createDocumentFragment();

    for (var i = 0; i < n; i++) {
      var el = document.createElement("i");
      el.className = "crease";

      /* Alternate the axis so folds cross each other the way they do
         in a sheet that was quartered, rather than stacking parallel. */
      var isVert = vertical === (i % 2 === 0);
      var base = isVert ? 0 : 90;
      var angle = base + (Math.random() - 0.5) * 7;

      /* Keep creases off the outer eighth: a fold that lands on the
         deckled edge fights the displacement filter there. */
      var pos = 14 + Math.random() * 72;

      el.style.setProperty("--a", angle.toFixed(2) + "deg");
      el.style.setProperty("--x", isVert ? pos.toFixed(1) + "%" : "50%");
      el.style.setProperty("--y", isVert ? "50%" : pos.toFixed(1) + "%");
      el.style.setProperty("--w", (16 + Math.random() * 22).toFixed(0) + "px");
      el.style.setProperty("--o", (0.34 + Math.random() * 0.3).toFixed(2));

      /* The gradient runs across the strip's width, so the lit flank
         faces the strip's local +x. Rotated by `angle`, in screen
         coordinates (y down), that direction is (cos a, -sin a).
         The raking light compares it against the light direction. */
      var rad = angle * Math.PI / 180;
      creases.push({ el: el, nx: Math.cos(rad), ny: -Math.sin(rad) });

      frag.appendChild(el);
    }

    host.appendChild(frag);
  })();


  /* ── the raking light ────────────────────────────────────────
     One lamp, off the upper left, and the sheet tilts under it as
     the pointer moves. Two things follow the light: the highlight
     gradient on `.sheet__light`, and each crease, which has to
     decide which of its two flanks is facing the source.

     Nothing here runs on the pointer event itself — the handler only
     records a target, and a rAF loop eases toward it. That keeps the
     work to one frame's worth no matter how chatty the device is,
     and the easing is what gives the sheet its weight. */
  (function rakingLight() {
    /* Every sheet in the pad lies under the same lamp. */
    var lightEls = document.querySelectorAll(".sheet__light");
    var sheetEl = document.getElementById("sheet");
    if (!lightEls.length || !sheetEl) return;

    /* A touch screen has no hovering pointer to track, and a tilting
       light is exactly the kind of ambient motion reduced-motion is
       asking about. Both keep the fixed angle baked into the CSS. */
    if (reduced || !window.matchMedia("(pointer: fine)").matches) return;

    /* Where the lamp sits, as an offset from the sheet's centre, in
       units of half the sheet. Starts at the upper left — the angle
       the stylesheet has been baked at since the beginning. */
    var tx = -0.62, ty = -0.78;
    var cx = tx, cy = ty;
    var frame = null;

    window.addEventListener("pointermove", function (e) {
      var r = sheetEl.getBoundingClientRect();
      if (!r.width || !r.height) return;

      /* The pointer is where you're *looking*, so the lamp is put
         opposite it: the sheet tilts to face the hand. */
      tx = -((e.clientX - (r.left + r.width / 2)) / (r.width / 2));
      ty = -((e.clientY - (r.top + r.height / 2)) / (r.height / 2));

      /* A pointer far down a long page would otherwise drive the
         light to a grazing angle and flatten everything out. */
      ty = Math.max(-1.4, Math.min(1.4, ty));

      if (!frame) frame = requestAnimationFrame(step);
    }, { passive: true });

    function step() {
      frame = null;

      cx += (tx - cx) * 0.12;
      cy += (ty - cy) * 0.12;

      var len = Math.hypot(cx, cy) || 1;
      var lx = cx / len, ly = cy / len;

      /* CSS gradient angles run clockwise from "to top", and the
         gradient has to point away from the lamp: bright end first. */
      var deg = Math.atan2(-lx, ly) * 180 / Math.PI;
      lightEls.forEach(function (el) {
        el.style.setProperty("--light-a", deg.toFixed(1) + "deg");

        /* The edge burn drifts the other way, so the far corner from
           the lamp is the one that falls off. */
        el.style.setProperty("--burn-x", (50 - lx * 14).toFixed(1) + "%");
        el.style.setProperty("--burn-y", (44 - ly * 12).toFixed(1) + "%");
      });

      creases.forEach(function (c) {
        var dot = c.nx * lx + c.ny * ly;
        c.el.style.setProperty("--flip", dot < 0 ? "-1" : "1");
        /* Square-on light shades hardest; light running down the
           fold barely shades at all. The floor has to stay low —
           it's the cover the flank swap hides behind, and at 0.3 you
           can see the highlight jump sides. */
        c.el.style.setProperty("--strength", (0.12 + 0.88 * Math.abs(dot)).toFixed(3));
      });

      /* Keep easing until it has settled, then stop burning frames. */
      if (Math.abs(tx - cx) > 0.002 || Math.abs(ty - cy) > 0.002) {
        frame = requestAnimationFrame(step);
      }
    }

    step();
  })();

  /* ── prime the self-drawing SVG strokes ──────────────────────
     dasharray/dashoffset both need the true path length, which only
     the browser can tell us. */
  document.querySelectorAll(".draw").forEach(function (path) {
    var len = Math.ceil(path.getTotalLength());
    path.style.setProperty("--len", len);
  });

  /* ── write things on as they come into view ──────────────────── */
  var targets = document.querySelectorAll(
    ".write, .fade, .draw, [data-write], [data-fade]"
  );

  if (reduced || !("IntersectionObserver" in window)) {
    targets.forEach(function (el) { el.classList.add("is-written"); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var el = entry.target;
        io.unobserve(el);

        /* Stagger siblings so a section reads top to bottom rather
           than appearing all at once. */
        var group = el.closest(".entry, .masthead, .pad-wrap") || document.body;
        var peers = Array.prototype.slice.call(
          group.querySelectorAll(".write, .fade, .draw")
        );
        var delay = Math.max(0, peers.indexOf(el)) * 130;

        setTimeout(function () { el.classList.add("is-written"); }, delay);
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });

    targets.forEach(function (el) { io.observe(el); });
  }


  /* ═══════════════════════════════════════════════════════════
     STORAGE
     Strokes are points, not pixels, so what gets saved is small,
     resolution-independent, and redraws crisp at any window size.
     ═══════════════════════════════════════════════════════════ */

  var STORE_VERSION = "v1";

  function key(name) { return "paper.ink." + STORE_VERSION + "." + name; }

  function load(name) {
    try {
      var raw = localStorage.getItem(key(name));
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      return null;   /* private mode, corrupt JSON — start clean */
    }
  }

  /* localStorage is a few megabytes and a long pencil session can
     genuinely fill it, so on a quota error drop the oldest quarter
     of the strokes and try again rather than losing the lot. */
  function save(name, strokes) {
    var data = strokes;
    for (var attempt = 0; attempt < 4; attempt++) {
      try {
        localStorage.setItem(key(name), JSON.stringify(data));
        return true;
      } catch (err) {
        if (!data.length) return false;
        data = data.slice(Math.ceil(data.length / 4));
      }
    }
    return false;
  }

  /* Writing on every stroke is fine for a pen but punishing during
     fast sketching, so coalesce to one write per idle moment. */
  function debounce(fn, ms) {
    var t = null;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  }

  /* While someone else's drawing is on the page — from a link or a
     file — nothing is written to storage. Your own drawing waits
     underneath until you either go back to it or keep theirs. */
  var viewingShared = false;


  /* ═══════════════════════════════════════════════════════════
     INK
     Three surfaces: the pad, which is always live, and the two
     sheets, which only accept marks once a nib is picked up.
     ═══════════════════════════════════════════════════════════ */

  var stack = document.getElementById("stack");
  var pad = document.getElementById("pad");
  var padCanvas = document.getElementById("pad-ink");
  var sheet = document.getElementById("sheet");
  var sheetCanvas = document.getElementById("ink");
  var sheet2 = document.getElementById("sheet-2");
  var sheet2Canvas = document.getElementById("ink-2");

  function persister(name) {
    return debounce(function (s) {
      if (!viewingShared) save(name, s.serialize());
    }, 400);
  }
  var persistPad = persister("pad");
  var persistSheet = persister("sheet");
  var persistSheet2 = persister("sheet2");

  var padInk = new InkSurface(padCanvas, {
    tool: "pencil",
    onFirstMark: function () { pad.classList.add("has-ink"); },
    onCommit: function (s) { persistPad(s); refreshUndo(); }
  });

  var sheetInk = new InkSurface(sheetCanvas, {
    tool: "pen",
    onCommit: function (s) { persistSheet(s); refreshUndo(); }
  });

  var sheet2Ink = new InkSurface(sheet2Canvas, {
    tool: "pen",
    onFirstMark: function () { sheet2.classList.add("has-ink"); },
    onCommit: function (s) { persistSheet2(s); refreshUndo(); }
  });

  /* Storage names, and the order surfaces are packed into a link.
     The order is part of the link format: append, never reorder. */
  var SURFACES = [
    { name: "sheet",  ink: sheetInk,  page: 1 },
    { name: "pad",    ink: padInk,    page: 1 },
    { name: "sheet2", ink: sheet2Ink, page: 2 }
  ];

  function saveAllNow() {
    if (viewingShared) return;
    SURFACES.forEach(function (s) { save(s.name, s.ink.serialize()); });
  }

  function restoreFrom(doc) {
    SURFACES.forEach(function (s) { s.ink.restore(doc[s.name] || []); });
    refreshUndo();
  }

  function loadOwn() {
    var doc = {};
    SURFACES.forEach(function (s) { doc[s.name] = load(s.name); });
    restoreFrom(doc);
  }

  /* The sheets grow and shrink with the viewport; keep the canvases
     matched to them. Strokes are stored as a fraction of the width,
     so this rescales a drawing instead of cropping it. */
  function resizeAll() {
    SURFACES.forEach(function (s) { s.ink.resize(); });
    turn.relayout();
  }
  if ("ResizeObserver" in window) {
    var ro = new ResizeObserver(resizeAll);
    ro.observe(sheet);
    ro.observe(sheet2);
    ro.observe(pad);
  } else {
    window.addEventListener("resize", resizeAll);
  }


  /* ═══════════════════════════════════════════════════════════
     THE PAGE TURN
     The bottom corner of the top sheet lifts and folds back. No 3D
     transform and no screenshot of the page: the sheet is clipped
     along the fold, and the part beyond it is drawn again as its own
     back, mirrored across the same line. Both are plain clip-paths,
     so every blend mode and filter on the page keeps working while
     it turns.

     Geometry, in the sheet's own unrotated pixels: C is the corner
     (bottom right), D is where the hand has carried it. The fold is
     the perpendicular bisector of CD — every point of paper on C's
     side of it lands, mirrored, on D's side.
     ═══════════════════════════════════════════════════════════ */

  var page = 1;

  var turn = (function () {
    var body = sheet.querySelector(".sheet__body");
    var flap = sheet.querySelector(".flap");
    var face = sheet.querySelector(".flap__face");
    var corner = sheet.querySelector(".corner");
    var back = sheet2.querySelector("[data-turn='back']");

    var REST = 22;          /* the dog-ear, lifted this far, px */
    var HOVER = 56;         /* …and this far when you reach for it */

    var W = 0, H = 0, angle = 0;
    var D = null;           /* where the corner is now */
    var lift = REST;        /* how far it rests lifted */
    var anim = null, frame = null, drag = null;
    var turning = false;    /* a turn is under way; nothing interrupts it */
    var swallowClick = false;

    function measure() {
      W = sheet.offsetWidth;
      H = sheet.offsetHeight;
      var m = getComputedStyle(sheet).transform;
      var parts = m && m !== "none" ? m.match(/-?[\d.e]+/g) : null;
      angle = parts ? Math.atan2(+parts[1], +parts[0]) : 0;
    }

    function restPoint(r) { return { x: W - r, y: H - r * 0.8 }; }

    /* A screen point in the sheet's own coordinates. The sheet is
       turned a fraction of a degree about its centre; undo that. */
    function toLocal(cx, cy) {
      var r = sheet.getBoundingClientRect();
      var x = cx - (r.left + r.width / 2);
      var y = cy - (r.top + r.height / 2);
      var c = Math.cos(-angle), s = Math.sin(-angle);
      return { x: x * c - y * s + W / 2, y: x * s + y * c + H / 2 };
    }

    /* Paper doesn't stretch. The bottom edge is still lying flat at
       its left end, so the corner can get no further than a sheet's
       width from there; likewise the diagonal from the top left. And
       it can't be pushed down through the desk. */
    function constrain(p) {
      var x = p.x, y = Math.min(p.y, H - 0.5);
      var d = Math.hypot(x, y - H);
      if (d > W) { x = x / d * W; y = H + (y - H) / d * W; }
      var diag = Math.hypot(W, H);
      d = Math.hypot(x, y);
      if (d > diag) { x = x / d * diag; y = y / d * diag; }
      return { x: x, y: y };
    }

    /* Clip a convex polygon to one side of the line n·p = k. */
    function clipHalf(pts, nx, ny, k, side) {
      var out = [];
      for (var i = 0; i < pts.length; i++) {
        var p = pts[i], q = pts[(i + 1) % pts.length];
        var fp = side * (nx * p[0] + ny * p[1] - k);
        var fq = side * (nx * q[0] + ny * q[1] - k);
        if (fp >= 0) out.push(p);
        if ((fp >= 0) !== (fq >= 0)) {
          var t = fp / (fp - fq);
          out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
        }
      }
      return out;
    }

    function polygon(pts) {
      if (pts.length < 3) return "polygon(0 0, 0 0, 0 0)";
      return "polygon(" + pts.map(function (p) {
        return p[0].toFixed(1) + "px " + p[1].toFixed(1) + "px";
      }).join(", ") + ")";
    }

    /* Light across the back of the flap. A fold isn't a hinge, it's a
       curve: dark right in the crease, a bright band where the curl
       faces the room, fading flat toward the tip. Worked out as a
       gradient running from the crease along (mx, my), in px, for a
       box w × h whose crease sits where m·p = c. */
    function shade(mx, my, c, w, h, reach) {
      var deg = Math.atan2(mx, -my) * 180 / Math.PI;
      var L = Math.abs(w * mx) + Math.abs(h * my);
      var t0 = c - (mx * w / 2 + my * h / 2) + L / 2;
      var R = Math.max(8, Math.min(reach, 150));
      var at = function (f) { return (t0 + R * f).toFixed(1) + "px"; };
      return "linear-gradient(" + deg.toFixed(2) + "deg," +
        "rgba(70,52,28,.34) " + at(0) + "," +
        "rgba(70,52,28,.10) " + at(0.07) + "," +
        "rgba(255,253,246,.42) " + at(0.32) + "," +
        "rgba(255,253,246,.10) " + at(0.75) + "," +
        "rgba(255,253,246,0) " + at(1.1) + "," +
        "rgba(70,52,28,.06) " + at(2) + ")";
    }

    function apply(p) {
      D = p;
      var dx = W - p.x, dy = H - p.y;
      var len = Math.hypot(dx, dy);
      if (len < 0.5) { flat(); return; }
      var nx = dx / len, ny = dy / len;
      var k = nx * (W + p.x) / 2 + ny * (H + p.y) / 2;

      /* What stays: the far side of the fold. The rectangle runs well
         past the sheet so its shadow and torn edge aren't trimmed. */
      var M = 160;
      var keep = clipHalf([[-W - M, -M], [W + M, -M], [W + M, H + M], [-W - M, H + M]],
                          nx, ny, k, -1);
      var gone = clipHalf([[0, 0], [W, 0], [W, H], [0, H]], nx, ny, k, 1);

      body.style.clipPath = polygon(keep);

      /* Where the folded part lies now: reflected across the fold,
         p' = p − 2(n·p − k)n. The flap is placed and sized to that
         outline directly, rather than as a mirrored sheet-sized box —
         a transformed box that big would count toward the page's
         scroll height and leave a sheet's worth of empty desk below. */
      var lies = gone.map(function (q) {
        var f = 2 * (nx * q[0] + ny * q[1] - k);
        return [q[0] - f * nx, q[1] - f * ny];
      });
      if (lies.length < 3) { flat(); return; }
      var bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
      lies.forEach(function (q) {
        bx0 = Math.min(bx0, q[0]); by0 = Math.min(by0, q[1]);
        bx1 = Math.max(bx1, q[0]); by1 = Math.max(by1, q[1]);
      });
      bx0 = Math.floor(bx0); by0 = Math.floor(by0);
      var bw = Math.ceil(bx1) - bx0, bh = Math.ceil(by1) - by0;
      flap.style.left = bx0 + "px";
      flap.style.top = by0 + "px";
      flap.style.width = bw + "px";
      flap.style.height = bh + "px";
      face.style.clipPath = polygon(lies.map(function (q) { return [q[0] - bx0, q[1] - by0]; }));

      /* On the flap, light runs away from the crease toward D: along
         −n, starting from the fold line as it sits in the box. */
      var c = -(k - nx * bx0 - ny * by0);
      face.style.setProperty("--shade", shade(-nx, -ny, c, bw, bh, len / 2));
      sheet.classList.add("is-peeled");
    }

    function flat() {
      body.style.clipPath = "";
      face.style.clipPath = "";
      flap.style.opacity = "";
      sheet.classList.remove("is-peeled");
    }

    function stop() {
      if (anim) cancelAnimationFrame(anim);
      anim = null;
    }

    /* Ease the corner to a target. `arc` lifts it on the way, the
       way a page is carried over rather than slid; `fade` brings the
       flap in or out at the far end, where it lies off the pad. */
    function animateTo(target, opts, done) {
      stop();
      opts = opts || {};
      var from = D || restPoint(lift);
      var dist = Math.hypot(target.x - from.x, target.y - from.y);
      var dur = opts.duration || Math.max(180, Math.min(760, dist * 0.8));
      var t0 = performance.now();

      function step(now) {
        var t = Math.min(1, (now - t0) / dur);
        var e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        apply(constrain({
          x: from.x + (target.x - from.x) * e,
          y: from.y + (target.y - from.y) * e - (opts.arc || 0) * Math.sin(Math.PI * e)
        }));
        if (opts.fade === "out") flap.style.opacity = e > 0.82 ? ((1 - e) / 0.18).toFixed(3) : "";
        if (opts.fade === "in")  flap.style.opacity = e < 0.18 ? (e / 0.18).toFixed(3) : "";

        if (t < 1) {
          anim = requestAnimationFrame(step);
        } else {
          anim = null;
          if (done) done();
        }
      }
      anim = requestAnimationFrame(step);
    }

    function settle(r, instant) {
      /* Releasing a drag also fires pointerleave on the corner, which
         asks the dog-ear to settle — and would cancel the turn that
         the release just started. */
      if (turning) return;
      lift = r;
      if (page !== 1) return;
      if (instant || reduced) { stop(); apply(constrain(restPoint(r))); return; }
      animateTo(restPoint(r), { duration: 260 });
    }

    function scrollToTop() {
      var top = stack.getBoundingClientRect().top + window.pageYOffset - 16;
      if (window.pageYOffset > top) {
        window.scrollTo({ top: top, behavior: reduced ? "auto" : "smooth" });
      }
    }

    function forward() {
      if (page !== 1 || drag || turning) return;
      turning = true;
      measure();
      var keyboard = document.activeElement === corner;
      var finish = function () {
        turning = false;
        lift = REST;
        flat();
        show(2);
        scrollToTop();
        if (keyboard && back) back.focus({ preventScroll: true });
      };
      if (reduced) { stop(); finish(); return; }
      animateTo({ x: -W, y: H }, { arc: Math.min(W * 0.28, 220), fade: "out" }, finish);
    }

    function backward() {
      if (page !== 2 || turning) return;
      turning = true;
      var keyboard = document.activeElement === back;
      show(1);
      measure();
      var finish = function () {
        turning = false;
        lift = REST;
        if (keyboard) corner.focus({ preventScroll: true });
      };
      if (reduced) { apply(constrain(restPoint(REST))); finish(); return; }
      /* Start fully turned, lying to the left, and bring it back. */
      apply({ x: -W, y: H });
      flap.style.opacity = "0";
      animateTo(restPoint(REST), { arc: Math.min(W * 0.28, 220), fade: "in" }, finish);
    }

    /* Which sheet is on top. The other is out of the tab order and
       the accessibility tree; the turned one is out of sight too. */
    function show(n) {
      page = n;
      document.body.dataset.page = String(n);
      sheet.classList.toggle("is-turned", n === 2);
      sheet.inert = n === 2;
      sheet2.inert = n !== 2;
      refreshUndo();
    }

    /* ── the hand on the corner ─────────────────────────────── */

    corner.addEventListener("pointerdown", function (e) {
      if (e.button !== 0 || page !== 1 || turning) return;
      e.preventDefault();
      swallowClick = false;
      stop();
      measure();
      if (!D) D = restPoint(lift);
      var p = toLocal(e.clientX, e.clientY);
      drag = {
        id: e.pointerId, moved: false,
        sx: e.clientX, sy: e.clientY,
        ox: D.x - p.x, oy: D.y - p.y,
        lastX: e.clientX, lastT: e.timeStamp, vx: 0
      };
      try { corner.setPointerCapture(e.pointerId); } catch (err) { /* synthetic */ }
    });

    corner.addEventListener("pointermove", function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 5) return;
      drag.moved = true;

      var dt = e.timeStamp - drag.lastT;
      if (dt > 0) drag.vx = drag.vx * 0.6 + ((e.clientX - drag.lastX) / dt) * 0.4;
      drag.lastX = e.clientX;
      drag.lastT = e.timeStamp;

      var p = toLocal(e.clientX, e.clientY);
      var target = constrain({ x: p.x + drag.ox, y: p.y + drag.oy });
      /* Pointer events can outrun the screen; draw once per frame. */
      if (!frame) {
        frame = requestAnimationFrame(function () { frame = null; if (drag) apply(target); });
      }
      D = target;
    });

    function release(e, cancelled) {
      if (!drag || e.pointerId !== drag.id) return;
      var d = drag;
      drag = null;
      if (!d.moved) return;          /* a press, not a drag: click handles it */
      swallowClick = true;
      /* Past halfway, or thrown: it goes over. Otherwise it drops back. */
      if (!cancelled && (D.x < W * 0.5 || d.vx < -0.8)) forward();
      else settle(lift);
    }
    corner.addEventListener("pointerup", function (e) { release(e, false); });
    corner.addEventListener("pointercancel", function (e) { release(e, true); });

    corner.addEventListener("click", function () {
      if (swallowClick) { swallowClick = false; return; }
      forward();
    });

    /* Reaching for the corner lifts it a little further. */
    corner.addEventListener("pointerenter", function (e) {
      if (e.pointerType === "mouse" && !drag && !anim) settle(HOVER);
    });
    corner.addEventListener("pointerleave", function (e) {
      if (e.pointerType === "mouse" && !drag && lift === HOVER) settle(REST);
    });
    corner.addEventListener("focus", function () { if (!drag && !anim) settle(HOVER); });
    corner.addEventListener("blur", function () { if (!drag && !anim && page === 1) settle(REST); });

    if (back) back.addEventListener("click", backward);

    return {
      /* Re-measure and re-lay the dog-ear after any size change. */
      relayout: function () {
        measure();
        if (page === 1 && !drag && !anim && W && H) apply(constrain(restPoint(lift)));
      },
      /* Jump straight to a page, no animation — for links. */
      jump: function (n) {
        stop();
        turning = false;
        if (n === 2) { flat(); show(2); }
        else { show(1); measure(); apply(constrain(restPoint(REST))); }
      },
      forward: forward,
      backward: backward
    };
  })();


  /* ═══════════════════════════════════════════════════════════
     THE PEN TRAY
     ═══════════════════════════════════════════════════════════ */

  var buttons = document.querySelectorAll(".tray__btn[data-tool]");
  var undoBtn = document.querySelector('[data-action="undo"]');
  var redoBtn = document.querySelector('[data-action="redo"]');
  var current = "read";

  /* The surfaces on the page you're looking at. Undo and clear only
     ever touch what you can see. */
  function onPage() {
    return SURFACES.filter(function (s) { return s.page === page; })
      .map(function (s) { return s.ink; });
  }

  /* Undo applies to whichever surface you last drew on. */
  var lastTouched = padInk;
  SURFACES.forEach(function (s) {
    s.ink.canvas.addEventListener("pointerdown", function () {
      if (s.ink.enabled) lastTouched = s.ink;
    });
  });

  function refreshUndo() {
    var here = onPage();
    if (undoBtn) undoBtn.disabled = !here.some(function (s) { return s.canUndo; });
    if (redoBtn) redoBtn.disabled = !here.some(function (s) { return s.canRedo; });
    /* The hints follow the ink, in both directions — undoing a clear
       has to bring the pad back to life. */
    pad.classList.toggle("has-ink", padInk.hasInk);
    sheet2.classList.toggle("has-ink", sheet2Ink.hasInk);
  }

  /* Prefer the surface you were last drawing on, but fall through to
     another on this page when it has nothing left — the button is
     enabled if *any* of them can act, so it must never be a no-op. */
  function pickSurface(can) {
    var here = onPage();
    if (here.indexOf(lastTouched) >= 0 && lastTouched[can]) return lastTouched;
    for (var i = 0; i < here.length; i++) if (here[i][can]) return here[i];
    return null;
  }

  function undo() {
    var s = pickSurface("canUndo");
    if (s) { s.undo(); lastTouched = s; }
    refreshUndo();
  }

  function redo() {
    var s = pickSurface("canRedo");
    if (s) { s.redo(); lastTouched = s; }
    refreshUndo();
  }

  function selectTool(tool) {
    current = tool;

    buttons.forEach(function (b) {
      var on = b.dataset.tool === tool;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });

    var drawing = tool !== "read";
    document.body.classList.toggle("is-drawing", drawing);
    [sheetInk, sheet2Ink].forEach(function (s) {
      s.enabled = drawing;
      if (drawing) s.setTool(tool);
    });

    /* The pad never goes dead — in reading mode it just falls back
       to a pencil. */
    padInk.setTool(tool === "read" ? "pencil" : tool);
  }

  buttons.forEach(function (b) {
    b.addEventListener("click", function () { selectTool(b.dataset.tool); });
  });

  if (undoBtn) undoBtn.addEventListener("click", undo);
  if (redoBtn) redoBtn.addEventListener("click", redo);

  var clearBtn = document.querySelector('[data-action="clear"]');
  if (clearBtn) {
    clearBtn.addEventListener("click", function () {
      onPage().forEach(function (s) { s.clear(); });
      refreshUndo();
    });
  }


  /* ═══════════════════════════════════════════════════════════
     SHARING
     Strokes-as-data already paid for undo, persistence and crisp
     resizing. This collects the fourth thing: a drawing can leave
     the browser it was made in — as a link, a picture, or a file.
     ═══════════════════════════════════════════════════════════ */

  var shareBtn = document.querySelector('[data-action="share"]');
  var menu = document.getElementById("share");
  var fileInput = document.getElementById("share-file");
  var slip = document.getElementById("slip");
  var toastEl = document.getElementById("toast");

  var toastTimer = null;
  function toast(text) {
    toastEl.textContent = text;
    toastEl.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove("is-on"); }, 2600);
  }

  function anyInk() {
    return SURFACES.some(function (s) { return s.ink.hasInk; });
  }

  function stamp() {
    var d = new Date();
    var pad2 = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  function download(blob, name) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  }

  /* ── the menu ─────────────────────────────────────────────── */

  function openMenu(byKeyboard) {
    var items = menu.querySelectorAll("[data-share]");
    items.forEach(function (b) {
      var what = b.dataset.share;
      b.disabled = (what === "link" || what === "json") ? !anyInk()
                 : what === "png" ? !onPage().some(function (s) { return s.hasInk; })
                 : false;
    });
    menu.hidden = false;
    shareBtn.setAttribute("aria-expanded", "true");
    if (byKeyboard) {
      var first = menu.querySelector("[data-share]:not([disabled])");
      if (first) first.focus();
    }
  }

  function closeMenu(refocus) {
    if (menu.hidden) return;
    menu.hidden = true;
    shareBtn.setAttribute("aria-expanded", "false");
    if (refocus) shareBtn.focus();
  }

  shareBtn.addEventListener("click", function (e) {
    if (menu.hidden) openMenu(e.detail === 0); else closeMenu(false);
  });

  document.addEventListener("pointerdown", function (e) {
    if (!menu.hidden && !menu.contains(e.target) && e.target !== shareBtn) closeMenu(false);
  });

  /* Arrow keys walk the menu, the way a menu is expected to. */
  menu.addEventListener("keydown", function (e) {
    var items = Array.prototype.slice.call(menu.querySelectorAll("[data-share]:not([disabled])"));
    var i = items.indexOf(document.activeElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      var next = items[(i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length];
      if (next) next.focus();
    } else if (e.key === "Tab") {
      closeMenu(false);
    }
  });

  menu.addEventListener("click", function (e) {
    var item = e.target.closest("[data-share]");
    if (!item || item.disabled) return;
    var what = item.dataset.share;
    closeMenu(false);
    if (what === "link") copyLink();
    else if (what === "png") exportPicture();
    else if (what === "json") exportDrawing();
    else if (what === "open") fileInput.click();
  });

  /* ── a link ───────────────────────────────────────────────────
     The whole drawing rides in the fragment, after the #, which
     browsers never send to a server. No backend, nothing stored
     anywhere but the link itself. */

  function makeLink() {
    return InkSurface.pack(SURFACES.map(function (s) { return s.ink.serialize(); }))
      .then(function (text) {
        return location.href.split("#")[0] + "#" + (page === 2 ? "page=2&" : "") + "ink=" + text;
      });
  }

  function copyLink() {
    makeLink().then(function (url) {
      var long = url.length > 30000 ? " — it's a long one, some apps may cut it" : "";
      /* A phone has a share sheet, which is what you actually want. */
      if (navigator.share && window.matchMedia("(pointer: coarse)").matches) {
        return navigator.share({ title: "A page from Deckle", url: url })
          .catch(function () { /* dismissed */ });
      }
      /* The clipboard API only exists on https and localhost; opened
         over the LAN, fall back to a box you can copy from. */
      if (navigator.clipboard && window.isSecureContext) {
        return navigator.clipboard.writeText(url).then(
          function () { toast("link copied" + long); },
          function () { window.prompt("Copy this link:", url); });
      }
      window.prompt("Copy this link:", url);
    }).catch(function () { toast("couldn't make a link for this one"); });
  }

  function readHash() {
    var h = location.hash.replace(/^#/, "");
    if (!h) return null;
    var params = new URLSearchParams(h);
    var ink = params.get("ink");
    return ink ? { ink: ink, page: params.get("page") === "2" ? 2 : 1 } : null;
  }

  function clearHash() {
    if (location.hash && window.history && history.replaceState) {
      history.replaceState(null, "", location.pathname + location.search);
    }
  }

  function openFromHash() {
    var h = readHash();
    if (!h) return;
    InkSurface.unpack(h.ink).then(function (surfaces) {
      var doc = {};
      SURFACES.forEach(function (s, i) { doc[s.name] = surfaces[i] || []; });
      showShared(doc, h.page);
    }, function () {
      clearHash();
      toast("that link's drawing couldn't be read");
    });
  }

  window.addEventListener("hashchange", openFromHash);

  /* ── someone else's drawing ─────────────────────────────────── */

  function showShared(doc, toPage) {
    saveAllNow();                 /* flush your own before it's covered */
    viewingShared = true;
    restoreFrom(doc);
    slip.hidden = false;
    if (toPage !== page) turn.jump(toPage);
  }

  function leaveShared(keep) {
    viewingShared = false;
    slip.hidden = true;
    clearHash();
    if (keep) {
      saveAllNow();
      toast("it's yours now");
    } else {
      loadOwn();
    }
    refreshUndo();
  }

  slip.addEventListener("click", function (e) {
    var b = e.target.closest("[data-slip]");
    if (b) leaveShared(b.dataset.slip === "keep");
  });

  /* ── a file ──────────────────────────────────────────────────
     The same shape serialize() has always returned, with a little
     envelope. Opening one goes through restore(), which checks every
     stroke, and lands as a shared drawing so it can't overwrite
     yours by accident. */

  function exportDrawing() {
    var doc = { deckle: 1, page: page };
    SURFACES.forEach(function (s) { doc[s.name] = s.ink.serialize(); });
    download(new Blob([JSON.stringify(doc)], { type: "application/json" }),
             "deckle-" + stamp() + ".json");
  }

  function openFile(file) {
    if (!file) return;
    if (file.size > 32 * 1024 * 1024) { toast("that file's too big to be a drawing"); return; }
    file.text().then(function (text) {
      var doc = JSON.parse(text);
      if (!doc || doc.deckle !== 1) throw new Error("not a drawing");
      showShared(doc, doc.page === 2 ? 2 : 1);
    }).catch(function () { toast("that file isn't a Deckle drawing"); });
  }

  fileInput.addEventListener("change", function () {
    openFile(fileInput.files[0]);
    fileInput.value = "";
  });

  /* Or drop it anywhere on the desk. */
  window.addEventListener("dragover", function (e) {
    if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types, "Files") >= 0) {
      e.preventDefault();
    }
  });
  window.addEventListener("drop", function (e) {
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f) return;
    e.preventDefault();
    openFile(f);
  });

  /* ── a picture ───────────────────────────────────────────────
     Ink alone on transparency isn't what anyone wants, so the
     picture is your ink on the paper it was drawn on: the sheet's
     colour, grain and fibers (the same turbulence textures the page
     uses), the ruling and the margin. The type isn't in it — a
     canvas can't draw the DOM — so it's cropped to the ink. The ink
     is redrawn from the stroke list at 2x rather than copied off the
     screen, so it's crisp whatever the screen was. */

  function offsetWithin(el, ancestor) {
    var x = 0, y = 0;
    while (el && el !== ancestor) {
      x += el.offsetLeft;
      y += el.offsetTop;
      el = el.offsetParent;
    }
    return { x: x, y: y };
  }

  function strokeBounds(ink, scale, dx, dy, clip) {
    var b = null;
    ink.strokes.forEach(function (s) {
      if (s.tool === "eraser") return;
      for (var i = 0; i < s.p.length; i += 3) {
        var r = s.p[i + 2] * scale;
        var x = s.p[i] * scale, y = s.p[i + 1] * scale;
        var x0 = Math.max(x - r, clip ? 0 : -Infinity) + dx;
        var y0 = Math.max(y - r, clip ? 0 : -Infinity) + dy;
        var x1 = Math.min(x + r, clip ? clip.w : Infinity) + dx;
        var y1 = Math.min(y + r, clip ? clip.h : Infinity) + dy;
        if (!b) b = { x0: x0, y0: y0, x1: x1, y1: y1 };
        else {
          b.x0 = Math.min(b.x0, x0); b.y0 = Math.min(b.y0, y0);
          b.x1 = Math.max(b.x1, x1); b.y1 = Math.max(b.y1, y1);
        }
      }
    });
    return b;
  }

  /* Redraw a surface's strokes into a fresh canvas at `scale`. It has
     to be in the document for a moment: InkSurface sizes itself
     from layout, and a detached canvas has none. */
  function renderInk(ink, scale) {
    var c = document.createElement("canvas");
    c.style.cssText = "position:fixed;left:-100000px;top:0;" +
      "width:" + ink.canvas.clientWidth + "px;height:" + ink.canvas.clientHeight + "px";
    document.body.appendChild(c);
    var copy = new InkSurface(c, { dpr: scale, enabled: false });
    copy.restore(ink.serialize());
    c.remove();
    return c;
  }

  function texture(name) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name);
    var m = v.match(/url\(\s*["']?(.*?)["']?\s*\)\s*$/);
    return new Promise(function (resolve) {
      if (!m) return resolve(null);
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { resolve(null); };
      img.src = m[1];
    });
  }

  function exportPicture() {
    var host = page === 2 ? sheet2 : sheet;
    var W = host.offsetWidth, H = host.offsetHeight;
    var layers = [];

    if (page === 2) {
      layers.push({ ink: sheet2Ink, x: 0, y: 0 });
    } else {
      layers.push({ ink: sheetInk, x: 0, y: 0 });
      var o = offsetWithin(pad, sheet);
      var wrap = document.getElementById("pad-wrap");
      var wo = offsetWithin(wrap, sheet);
      var m = getComputedStyle(wrap).transform.match(/-?[\d.e]+/g);
      layers.push({
        ink: padInk, x: o.x, y: o.y, w: pad.clientWidth, h: pad.clientHeight, framed: true,
        /* the pad is taped down a little crooked; keep it that way */
        turn: m ? Math.atan2(+m[1], +m[0]) : 0,
        cx: wo.x + wrap.offsetWidth / 2, cy: wo.y + wrap.offsetHeight / 2
      });
    }

    var box = null;
    layers.forEach(function (l) {
      var u = l.ink.canvas.clientWidth;
      var b = strokeBounds(l.ink, u, l.x, l.y, l.w ? { w: l.w, h: l.h } : null);
      if (l.framed && b) b = { x0: l.x, y0: l.y, x1: l.x + l.w, y1: l.y + l.h };
      if (!b) return;
      box = box ? { x0: Math.min(box.x0, b.x0), y0: Math.min(box.y0, b.y0),
                    x1: Math.max(box.x1, b.x1), y1: Math.max(box.y1, b.y1) } : b;
    });
    if (!box) { toast("nothing drawn on this page yet"); return; }

    var PAD = 40;
    var x0 = Math.max(0, Math.floor(box.x0 - PAD)), y0 = Math.max(0, Math.floor(box.y0 - PAD));
    var x1 = Math.min(W, Math.ceil(box.x1 + PAD)), y1 = Math.min(H, Math.ceil(box.y1 + PAD));
    var cw = x1 - x0, ch = y1 - y0;
    /* 2x, unless that would make a canvas some phones refuse. */
    var scale = Math.min(2, Math.sqrt(16e6 / (cw * ch)));

    Promise.all([texture("--tex-grain"), texture("--tex-fiber"), texture("--tex-fleck")])
      .then(function (tex) {
        var out = document.createElement("canvas");
        out.width = Math.round(cw * scale);
        out.height = Math.round(ch * scale);
        var draw = function (withTextures) {
          var ctx = out.getContext("2d");
          ctx.setTransform(scale, 0, 0, scale, -x0 * scale, -y0 * scale);
          paintPaper(ctx, host, W, H, withTextures ? tex : []);
          layers.forEach(function (l) { paintLayer(ctx, l, scale); });
        };
        draw(true);
        var finish = function (blob) {
          download(blob, "deckle-no0" + page + "-" + stamp() + ".png");
        };
        try {
          out.toBlob(finish, "image/png");
        } catch (err) {
          /* Some browsers taint a canvas that has had an SVG drawn on
             it. The textures are the only SVG here; go without. */
          draw(false);
          out.toBlob(finish, "image/png");
        }
      });
  }

  function paintPaper(ctx, host, W, H, tex) {
    var css = getComputedStyle(document.documentElement);
    var paper = css.getPropertyValue("--paper").trim() || "#f2ece0";
    ctx.fillStyle = paper;
    ctx.fillRect(0, 0, W, H);

    var pattern = function (img, alpha, w, h) {
      if (!img) return;
      var p = ctx.createPattern(img, "repeat");
      if (p.setTransform && w) {
        p.setTransform(new DOMMatrix().scale(w / img.width, h / img.height));
      }
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.globalCompositeOperation = "multiply";
      ctx.fillStyle = p;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    };
    /* Same sizes as the stylesheet's layers. The grain is a little
       lighter than on screen, where the raking light lifts it back up;
       without the lamp it reads as grey. */
    pattern(tex[0], 0.3, 220, 220);
    pattern(tex[1], 0.17, 470, 330);
    pattern(tex[2], 0.17, 300, 300);

    /* The ruling: one line per --rule-h, starting where the sheet's
       does, fading out at both ends like the masked original. */
    var ruleH = parseFloat(css.getPropertyValue("--rule-h")) || 34;
    var rule = css.getPropertyValue("--rule").trim() || "#a9bfd0";
    var g = ctx.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(0.04, rule);
    g.addColorStop(0.96, rule);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = g;
    for (var y = 12 + ruleH - 1; y < H; y += ruleH) ctx.fillRect(0, y, W, 1);
    ctx.restore();

    var margin = host.querySelector(".sheet__margin");
    if (margin) {
      ctx.save();
      ctx.globalAlpha = 0.48;
      ctx.globalCompositeOperation = "multiply";
      ctx.fillStyle = css.getPropertyValue("--rule-red").trim() || "#d09aa2";
      ctx.fillRect(margin.offsetLeft, 0, 1.5, H);
      ctx.restore();
    }
  }

  function paintLayer(ctx, l, scale) {
    var ink = renderInk(l.ink, scale);
    var w = l.ink.canvas.clientWidth, h = l.ink.canvas.clientHeight;
    ctx.save();
    if (l.turn) {
      ctx.translate(l.cx, l.cy);
      ctx.rotate(l.turn);
      ctx.translate(-l.cx, -l.cy);
    }
    if (l.framed) {
      /* the pad's dashed outline, so a pad drawing has its edge */
      ctx.save();
      ctx.strokeStyle = "rgba(77,74,76,.38)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(l.x + 0.75, l.y + 0.75, w - 1.5, h - 1.5);
      ctx.restore();
    }
    ctx.globalCompositeOperation = "multiply";
    ctx.drawImage(ink, l.x, l.y, w, h);
    ctx.restore();
  }


  /* ═══════════════════════════════════════════════════════════
     KEYS
     ═══════════════════════════════════════════════════════════ */

  /* 1–5 pick up a nib; ⌘Z / ctrl-Z walks history. */
  var keymap = { "1": "read", "2": "pen", "3": "pencil", "4": "marker", "5": "eraser" };
  document.addEventListener("keydown", function (e) {
    if (/^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) return;

    if (e.key === "Escape" && !menu.hidden) {
      closeMenu(true);
      return;
    }

    var accel = e.metaKey || e.ctrlKey;
    if (accel && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
      return;
    }
    if (accel) return;

    if (keymap[e.key]) {
      selectTool(keymap[e.key]);
    } else if (e.key === "Escape") {
      selectTool("read");
    }
  });


  /* ═══════════════════════════════════════════════════════════
     START
     Web fonts land after first paint and reflow the sheet. Restore
     only once the geometry has settled, or the ink scales twice.
     ═══════════════════════════════════════════════════════════ */

  selectTool("read");
  document.body.dataset.page = "1";

  function hydrate() {
    resizeAll();
    loadOwn();
    openFromHash();
  }

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(hydrate);
  } else {
    hydrate();
  }
})();
