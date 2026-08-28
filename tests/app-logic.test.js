import assert from "node:assert/strict";
import test from "node:test";

import { clampSeekSeconds, parseSegmentList } from "../app-logic.js";

test("parseSegmentList maps distinct HTTP URLs onto one continuous timeline", () => {
  const segments = parseSegmentList(JSON.stringify([
    { url: "http://127.0.0.1:8000/live/test-1.flv", duration: 15 },
    { url: "http://127.0.0.1:8000/live/test-2.flv", duration: 47 },
  ]));

  assert.deepEqual(segments, [
    {
      id: "segment-1",
      url: "http://127.0.0.1:8000/live/test-1.flv",
      duration: 15_000,
      startMs: 0,
    },
    {
      id: "segment-2",
      url: "http://127.0.0.1:8000/live/test-2.flv",
      duration: 47_000,
      startMs: 15_000,
    },
  ]);
});

test("parseSegmentList rejects duplicate URLs", () => {
  const input = JSON.stringify([
    { url: "http://127.0.0.1:8000/live/test-1.flv", duration: 15 },
    { url: "http://127.0.0.1:8000/live/test-1.flv", duration: 15 },
  ]);

  assert.throws(() => parseSegmentList(input), /duplicate/i);
});

test("parseSegmentList rejects non-HTTP URLs and empty lists", () => {
  assert.throws(() => parseSegmentList("[]"), /at least one/i);
  assert.throws(
    () => parseSegmentList('[{"url":"file:///tmp/test.flv","duration":15}]'),
    /HTTP/i,
  );
});

test("clampSeekSeconds keeps seeks inside the retained window", () => {
  assert.equal(clampSeekSeconds(10, 30, 330), 30);
  assert.equal(clampSeekSeconds(120, 30, 330), 120);
  assert.equal(clampSeekSeconds(500, 30, 330), 330);
});
