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
    var lightEl = document.querySelector(".sheet__light");
    var sheetEl = document.getElementById("sheet");
    if (!lightEl || !sheetEl) return;

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
      lightEl.style.setProperty("--light-a", deg.toFixed(1) + "deg");

      /* The edge burn drifts the other way, so the far corner from
         the lamp is the one that falls off. */
      lightEl.style.setProperty("--burn-x", (50 - lx * 14).toFixed(1) + "%");
      lightEl.style.setProperty("--burn-y", (44 - ly * 12).toFixed(1) + "%");

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


  /* ═══════════════════════════════════════════════════════════
     INK
     Two surfaces: the pad, which is always live, and the whole
     sheet, which only accepts marks once a nib is picked up.
     ═══════════════════════════════════════════════════════════ */

  var pad = document.getElementById("pad");
  var padCanvas = document.getElementById("pad-ink");
  var sheet = document.getElementById("sheet");
  var sheetCanvas = document.getElementById("ink");

  var persistPad = debounce(function (s) { save("pad", s.serialize()); }, 400);
  var persistSheet = debounce(function (s) { save("sheet", s.serialize()); }, 400);

  var padInk = new InkSurface(padCanvas, {
    tool: "pencil",
    onFirstMark: function () { pad.classList.add("has-ink"); },
    onCommit: function (s) { persistPad(s); refreshUndo(); }
  });

  var sheetInk = new InkSurface(sheetCanvas, {
    tool: "pen",
    onCommit: function (s) { persistSheet(s); refreshUndo(); }
  });

  /* The sheet grows and shrinks with the viewport; keep the canvas
     matched to it. Strokes are stored as a fraction of the sheet
     width, so this rescales the drawing instead of cropping it. */
  if ("ResizeObserver" in window) {
    var ro = new ResizeObserver(function () {
      sheetInk.resize();
      padInk.resize();
    });
    ro.observe(sheet);
    ro.observe(pad);
  } else {
    window.addEventListener("resize", function () {
      sheetInk.resize();
      padInk.resize();
    });
  }

  /* Web fonts land after first paint and reflow the sheet. Restore
     only once the geometry has settled, or the ink scales twice. */
  function hydrate() {
    sheetInk.resize();
    padInk.resize();
    sheetInk.restore(load("sheet"));
    padInk.restore(load("pad"));
    refreshUndo();
  }

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(hydrate);
  } else {
    hydrate();
  }


  /* ═══════════════════════════════════════════════════════════
     THE PEN TRAY
     ═══════════════════════════════════════════════════════════ */

  var buttons = document.querySelectorAll(".tray__btn[data-tool]");
  var undoBtn = document.querySelector('[data-action="undo"]');
  var redoBtn = document.querySelector('[data-action="redo"]');
  var current = "read";

  /* Undo applies to whichever surface you last drew on. */
  var lastTouched = padInk;
  [[padInk, padCanvas], [sheetInk, sheetCanvas]].forEach(function (pair) {
    pair[1].addEventListener("pointerdown", function () {
      if (pair[0].enabled) lastTouched = pair[0];
    });
  });

  function refreshUndo() {
    if (undoBtn) undoBtn.disabled = !(padInk.canUndo || sheetInk.canUndo);
    if (redoBtn) redoBtn.disabled = !(padInk.canRedo || sheetInk.canRedo);
    /* The hint under the pad follows the ink, in both directions —
       undoing a clear has to bring the pad back to life. */
    pad.classList.toggle("has-ink", padInk.hasInk);
  }

  /* Prefer the surface you were last drawing on, but fall through to
     the other one when it has nothing left — the button is enabled if
     *either* surface can act, so it must never be a no-op. */
  function pickSurface(can) {
    if (lastTouched[can]) return lastTouched;
    var other = lastTouched === padInk ? sheetInk : padInk;
    return other[can] ? other : null;
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
    sheetInk.enabled = drawing;
    if (drawing) sheetInk.setTool(tool);

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
      sheetInk.clear();
      padInk.clear();
      refreshUndo();
    });
  }

  /* 1–5 pick up a nib; ⌘Z / ctrl-Z walks history. */
  var keymap = { "1": "read", "2": "pen", "3": "pencil", "4": "marker", "5": "eraser" };
  document.addEventListener("keydown", function (e) {
    if (/^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) return;

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

  selectTool("read");
})();
