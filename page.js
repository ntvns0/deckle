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
