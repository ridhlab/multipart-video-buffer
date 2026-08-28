import assert from "node:assert/strict";
import test from "node:test";
import { createAppServer } from "../server.js";

async function listen(server, t) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return server.address().port;
}

test("POST /open-stream opens the requested filename", async (t) => {
  const calls = [];
  const controller = {
    open(filename) {
      calls.push(filename);
      return { started: true, filename, streamName: "test-001" };
    },
  };
  const server = createAppServer({ controller, publicRoot: process.cwd() });
  const port = await listen(server, t);
  const response = await fetch(`http://127.0.0.1:${port}/open-stream`, {
    method: "POST",
    headers: { origin: "http://127.0.0.1:8080", "content-type": "application/json" },
    body: JSON.stringify({ filename: "test-001.flv" }),
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), "http://127.0.0.1:8080");
  assert.deepEqual(calls, ["test-001.flv"]);
});

test("OPTIONS /open-stream accepts local CORS preflight", async (t) => {
  const server = createAppServer({ controller: {}, publicRoot: process.cwd() });
  const port = await listen(server, t);
  const response = await fetch(`http://127.0.0.1:${port}/open-stream`, {
    method: "OPTIONS",
    headers: {
      origin: "http://127.0.0.1:8080",
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type",
    },
  });
  assert.equal(response.status, 204);
  assert.match(response.headers.get("access-control-allow-methods"), /POST/);
});

test("POST /open-stream requires a filename", async (t) => {
  const server = createAppServer({ controller: {}, publicRoot: process.cwd() });
  const port = await listen(server, t);
  const response = await fetch(`http://127.0.0.1:${port}/open-stream`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(response.status, 400);
});
