#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   dev.js — static server + live reload, zero dependencies
   ───────────────────────────────────────────────────────────────
   node dev.js  →  http://127.0.0.1:8787

   Watches the source files and pushes a reload over Server-Sent
   Events. A small client script is injected into index.html on the
   way out, so nothing in the source has to know this exists.
   ═══════════════════════════════════════════════════════════════ */

const http = require("http");
const fs   = require("fs");
const path = require("path");

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 8787;
const HOST = "127.0.0.1";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".js":   "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg":  "image/svg+xml",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".woff2": "font/woff2",
  ".ico":  "image/x-icon"
};

/* ── connected browsers ─────────────────────────────────────── */
const clients = new Set();

function broadcast(file) {
  const line = `data: ${JSON.stringify({ file })}\n\n`;
  for (const res of clients) res.write(line);
  const stamp = new Date().toLocaleTimeString();
  console.log(`  ${stamp}  reload → ${file}  (${clients.size} client${clients.size === 1 ? "" : "s"})`);
}

/* ── watch, with a debounce so one save doesn't fire twice ──── */
let pending = null;
function onChange(file) {
  clearTimeout(pending);
  pending = setTimeout(() => broadcast(file), 40);
}

for (const file of ["index.html", "styles.css", "ink.js", "page.js"]) {
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) continue;
  fs.watch(full, () => onChange(file));
}

/* Injected into index.html. Reconnects on its own if the server
   restarts, so you can edit dev.js too. */
const LIVE_RELOAD = `
<script>
(function () {
  var wait = 500;
  function connect() {
    var es = new EventSource("/__reload");
    es.onopen = function () { wait = 500; };
    es.onmessage = function () { location.reload(); };
    es.onerror = function () {
      es.close();
      /* Server went away — probably a restart. Back off up to 10s
         instead of hammering it, or a stopped server fills the
         console with refused connections. */
      setTimeout(connect, wait);
      wait = Math.min(wait * 1.8, 10000);
    };
  }
  connect();
})();
</script>
`;

/* ── server ─────────────────────────────────────────────────── */
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);

  if (url === "/__reload") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive"
    });
    res.write("retry: 500\n\n");
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }

  let rel = url === "/" ? "index.html" : url.replace(/^\/+/, "");
  const full = path.join(ROOT, rel);

  /* don't serve anything outside the project directory */
  if (!full.startsWith(ROOT)) {
    res.writeHead(403).end("forbidden");
    return;
  }

  fs.readFile(full, (err, buf) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" }).end("not found");
      return;
    }
    const ext = path.extname(full).toLowerCase();
    const type = TYPES[ext] || "application/octet-stream";

    if (ext === ".html") {
      buf = Buffer.from(
        buf.toString("utf8").replace("</body>", LIVE_RELOAD + "</body>")
      );
    }

    res.writeHead(200, {
      "Content-Type": type,
      "Cache-Control": "no-store"   /* always pick up your last save */
    });
    res.end(buf);
  });
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`\n  port ${PORT} is already serving something.`);
    console.error(`  another deckle?  fuser -k ${PORT}/tcp`);
    console.error(`  or pick another: PORT=8788 node dev.js\n`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, HOST, () => {
  console.log(`\n  deckle  →  http://${HOST}:${PORT}`);
  console.log(`  watching index.html, styles.css, ink.js, page.js`);
  console.log(`  ctrl-c to stop\n`);
});
