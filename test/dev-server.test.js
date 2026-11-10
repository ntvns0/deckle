/* The dev server listens on the network, so what it refuses to serve
   matters as much as what it serves. Each test here is a bug it used
   to have. Run with `node --test`. */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const http = require("node:http");
const path = require("node:path");

const DEV = path.join(__dirname, "..", "dev.js");

/* Start dev.js on a free port and wait for it to print the address. */
function start() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [DEV], {
      env: { ...process.env, PORT: "0", HOST: "127.0.0.1" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let out = "";
    child.stdout.on("data", (d) => {
      out += d;
      const m = out.match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (m) resolve({ child, port: Number(m[1]) });
    });
    child.on("exit", (code) => reject(new Error("dev.js exited early: " + code + "\n" + out)));
    setTimeout(() => reject(new Error("dev.js never started:\n" + out)), 5000).unref();
  });
}

/* Raw request, so a malformed path reaches the server unaltered. */
function get(port, rawPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: rawPath }, (res) => {
      let body = "";
      res.on("data", (d) => { body += d; });
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("dev server", async (t) => {
  const { child, port } = await start();
  t.after(() => child.kill());

  await t.test("serves the page with live reload injected", async () => {
    const res = await get(port, "/");
    assert.equal(res.status, 200);
    assert.match(res.body, /<title>Deckle/);
    assert.match(res.body, /__reload/);
  });

  await t.test("a malformed escape is a 400, not a crash", async () => {
    const bad = await get(port, "/%E0");
    assert.equal(bad.status, 400);
    const after = await get(port, "/");
    assert.equal(after.status, 200, "server should still be up");
  });

  await t.test("never serves .git or other dotfiles", async () => {
    for (const p of ["/.git/config", "/.git/HEAD", "/.gitignore", "/.github/workflows/ci.yml",
                     "/%2Egit/config", "/fonts/../.git/config"]) {
      const res = await get(port, p);
      assert.equal(res.status, 404, p);
    }
  });

  await t.test("never leaves the project directory", async () => {
    const dir = path.basename(path.join(__dirname, ".."));
    for (const p of ["/../" + dir + "2/x", "/..%2f..%2fetc%2fpasswd", "/%2e%2e/%2e%2e/etc/passwd"]) {
      const res = await get(port, p);
      assert.notEqual(res.status, 200, p);
      assert.doesNotMatch(res.body, /root:/, p);
    }
  });
});
