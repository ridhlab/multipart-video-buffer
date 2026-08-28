import assert from "node:assert/strict";
import test from "node:test";

import { RollingSegmentCache } from "../rolling-segment-cache.js";

function segment(id, startMs = 0) {
  return {
    id,
    url: `http://127.0.0.1:8000/live/${id}.flv`,
    duration: 30_000,
    startMs,
  };
}

test("readRange returns exact bytes across stored chunk boundaries", () => {
  const cache = new RollingSegmentCache({ maxDurationMs: 300_000 });

  cache.begin(segment("s1"));
  cache.append("s1", Uint8Array.of(1, 2));
  cache.append("s1", Uint8Array.of(3, 4, 5));
  cache.complete("s1");

  assert.deepEqual([...cache.readRange("s1", 1, 3)], [2, 3, 4]);
  assert.equal(cache.totalBytes, 5);
});

test("completing segments beyond five minutes evicts the oldest completed segment", () => {
  const cache = new RollingSegmentCache({ maxDurationMs: 300_000 });

  for (let index = 0; index < 11; index += 1) {
    const id = `s${index + 1}`;
    cache.begin(segment(id, index * 30_000));
    cache.append(id, Uint8Array.of(index));
    cache.complete(id);
  }

  assert.equal(cache.has("s1"), false);
  for (let index = 2; index <= 11; index += 1) {
    assert.equal(cache.has(`s${index}`), true);
  }
  assert.equal(cache.retainedStartMs, 30_000);
  assert.equal(cache.retainedEndMs, 330_000);
  assert.equal(cache.totalBytes, 10);
});

test("append copies the supplied view instead of retaining shared ownership", () => {
  const cache = new RollingSegmentCache({ maxDurationMs: 300_000 });
  const bytes = Uint8Array.of(10, 20, 30);

  cache.begin(segment("s1"));
  cache.append("s1", bytes);
  bytes[1] = 99;
  cache.complete("s1");

  assert.deepEqual([...cache.readRange("s1", 0, 2)], [10, 20, 30]);
});
