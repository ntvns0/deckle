#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   dev.js — static server + live reload, zero dependencies
   ───────────────────────────────────────────────────────────────
   node dev.js  →  http://localhost:8787, and on your network

   Listens on every interface by default so the page can be opened
   from a phone or another computer. HOST=127.0.0.1 keeps it local.

   Watches the source files and pushes a reload over Server-Sent
   Events. A small client script is injected into index.html on the
   way out, so nothing in the source has to know this exists.
   ═══════════════════════════════════════════════════════════════ */

const http = require("http");
const fs   = require("fs");
const os   = require("os");
const path = require("path");

const ROOT = __dirname;
/* PORT=0 asks the OS for any free port, which is what the tests use. */
const PORT = process.env.PORT ? Number(process.env.PORT) : 8787;
const HOST = process.env.HOST || "0.0.0.0";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".js":   "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg":  "image/svg+xml",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".woff2": "font/woff2",
  ".ico":  "image/x-icon",
  ".txt":  "text/plain; charset=utf-8"
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
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { "Allow": "GET, HEAD" }).end("method not allowed");
    return;
  }

  /* A malformed escape like /%E0 makes decodeURIComponent throw.
     Uncaught, that took the whole server down with it. */
  let url;
  try {
    url = decodeURIComponent(req.url.split("?")[0]);
  } catch (err) {
    res.writeHead(400, { "Content-Type": "text/plain" }).end("bad request");
    return;
  }

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

  const rel = url === "/" ? "index.html" : url.replace(/^\/+/, "");
  const full = path.join(ROOT, rel);

  /* Only files inside the project, and never a dotfile or anything
     under a dot-directory: this listens on the network, and .git
     holds the whole history. The separator matters — a bare prefix
     check would also let through a sibling like ../paper_project2. */
  const inside = full.startsWith(ROOT + path.sep);
  const hidden = path.relative(ROOT, full).split(path.sep)
    .some((part) => part.startsWith("."));
  if (!inside || hidden) {
    res.writeHead(404, { "Content-Type": "text/plain" }).end("not found");
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

/* Every address another device could reach this machine on: the LAN
   one at home, the Tailscale one (100.x) when away from it. */
function networkAddresses() {
  const out = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === "IPv4" && !a.internal) out.push({ name, address: a.address });
    }
  }
  return out;
}

server.listen(PORT, HOST, () => {
  const port = server.address().port;
  const wide = HOST === "0.0.0.0" || HOST === "::";
  console.log(`\n  deckle  →  http://${wide ? "localhost" : HOST}:${port}`);
  if (wide) {
    for (const { name, address } of networkAddresses()) {
      console.log(`             http://${address}:${port}   (${name})`);
    }
  }
  console.log(`  watching index.html, styles.css, ink.js, page.js`);
  console.log(`  ctrl-c to stop\n`);
});
