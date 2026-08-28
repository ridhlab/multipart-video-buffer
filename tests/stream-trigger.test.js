import assert from "node:assert/strict";
import test from "node:test";
import { filenameFromUrl, openStream } from "../stream-trigger.js";

test("filenameFromUrl extracts the FLV filename", () => {
  assert.equal(filenameFromUrl("http://127.0.0.1:8000/live/test-000.flv"), "test-000.flv");
});

test("openStream posts the requested filename", async () => {
  const calls = [];
  const result = await openStream("http://127.0.0.1:8000/live/test-001.flv", {
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        async json() { return { started: true, filename: "test-001.flv", streamName: "test-001" }; },
      };
    },
  });
  assert.equal(calls[0].url, "http://127.0.0.1:3000/open-stream");
  assert.equal(calls[0].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].options.body), { filename: "test-001.flv" });
  assert.equal(result.streamName, "test-001");
});
