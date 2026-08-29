import assert from "node:assert/strict";
import test from "node:test";

import { normalizeBufferedRanges } from "../buffered-ui.js";

function timeRanges(items) {
  return {
    length: items.length,
    start(index) { return items[index][0]; },
    end(index) { return items[index][1]; },
  };
}

test("normalizes multiple buffered ranges inside the retained window", () => {
  const ranges = normalizeBufferedRanges(
    timeRanges([[10, 20], [25, 40]]),
    10,
    50,
  );

  assert.deepEqual(ranges, [
    { start: 10, end: 20, leftPercent: 0, widthPercent: 25 },
    { start: 25, end: 40, leftPercent: 37.5, widthPercent: 37.5 },
  ]);
});

test("clips buffered ranges to the retained window", () => {
  const ranges = normalizeBufferedRanges(
    timeRanges([[0, 15], [45, 70]]),
    10,
    50,
  );

  assert.deepEqual(ranges, [
    { start: 10, end: 15, leftPercent: 0, widthPercent: 12.5 },
    { start: 45, end: 50, leftPercent: 87.5, widthPercent: 12.5 },
  ]);
});

test("returns no ranges for an empty retained window", () => {
  assert.deepEqual(normalizeBufferedRanges(timeRanges([[0, 10]]), 0, 0), []);
});
