import assert from "node:assert/strict";
import test from "node:test";

import {
  streamNameFromUrl,
  triggerInitialStream,
  triggerNextStream,
} from "../stream-trigger.js";

test("streamNameFromUrl extracts the FLV basename", () => {
  assert.equal(
    streamNameFromUrl("http://127.0.0.1:8000/live/test-000.flv"),
    "test-000",
  );
});

test("triggerInitialStream posts to the start endpoint", async () => {
  const calls = [];
  const result = await triggerInitialStream({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        async json() {
          return { started: true, streamName: "test-000", index: 0 };
        },
      };
    },
  });

  assert.deepEqual(result, { started: true, streamName: "test-000", index: 0 });
  assert.deepEqual(calls, [{
    url: "http://127.0.0.1:3000/api/streams/start",
    options: { method: "POST" },
  }]);
});

test("triggerNextStream posts the current stream name", async () => {
  const calls = [];
  const result = await triggerNextStream("http://127.0.0.1:8000/live/test-000.flv", {
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        async json() {
          return { started: true, streamName: "test-001", index: 1 };
        },
      };
    },
  });

  assert.deepEqual(result, { started: true, streamName: "test-001", index: 1 });
  assert.equal(calls[0].url, "http://127.0.0.1:3000/api/streams/next");
  assert.equal(calls[0].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].options.body), { currentStreamName: "test-000" });
});

test("triggerNextStream rejects an unsuccessful response", async () => {
  await assert.rejects(
    triggerNextStream("http://127.0.0.1:8000/live/test-000.flv", {
      fetchImpl: async () => ({
        ok: false,
        status: 409,
        async json() {
          return { error: "Out-of-order stream trigger" };
        },
      }),
    }),
    /Out-of-order stream trigger/,
  );
});
