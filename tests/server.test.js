import assert from "node:assert/strict";
import test from "node:test";

import { createAppServer } from "../server.js";

test("POST /api/streams/start starts the initial stream", async (t) => {
  let startCount = 0;
  const controller = {
    start() {
      startCount += 1;
      return { started: true, streamName: "test-000", index: 0 };
    },
  };
  const server = createAppServer({ controller, publicRoot: process.cwd() });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();

  const response = await fetch(`http://127.0.0.1:${port}/api/streams/start`, {
    method: "POST",
    headers: { origin: "http://127.0.0.1:8080" },
  });

  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get("access-control-allow-origin"),
    "http://127.0.0.1:8080",
  );
  assert.deepEqual(await response.json(), {
    started: true,
    streamName: "test-000",
    index: 0,
  });
  assert.equal(startCount, 1);
});

test("OPTIONS accepts CORS preflight from the local frontend", async (t) => {
  const controller = {};
  const server = createAppServer({ controller, publicRoot: process.cwd() });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();

  const response = await fetch(`http://127.0.0.1:${port}/api/streams/next`, {
    method: "OPTIONS",
    headers: {
      origin: "http://127.0.0.1:8080",
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type",
    },
  });

  assert.equal(response.status, 204);
  assert.equal(
    response.headers.get("access-control-allow-origin"),
    "http://127.0.0.1:8080",
  );
  assert.match(response.headers.get("access-control-allow-methods"), /POST/);
  assert.match(response.headers.get("access-control-allow-headers"), /content-type/i);
});

test("POST /api/streams/next advances the controller", async (t) => {
  const calls = [];
  const controller = {
    advance(name) {
      calls.push(name);
      return { started: true, streamName: "test-001", index: 1 };
    },
  };
  const server = createAppServer({ controller, publicRoot: process.cwd() });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();

  const response = await fetch(`http://127.0.0.1:${port}/api/streams/next`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ currentStreamName: "test-000" }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    started: true,
    streamName: "test-001",
    index: 1,
  });
  assert.deepEqual(calls, ["test-000"]);
});
