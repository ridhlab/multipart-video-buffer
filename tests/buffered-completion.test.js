import assert from "node:assert/strict";
import test from "node:test";

import {
  BufferedCompletionTracker,
  SegmentCompletionController,
} from "../buffered-completion.js";

const firstSegment = {
  id: "segment-1",
  startMs: 0,
  duration: 15_000,
};

const secondSegment = {
  id: "segment-2",
  startMs: 15_000,
  duration: 15_000,
};

test("tracker completes near the segment end only after one stable second", () => {
  const tracker = new BufferedCompletionTracker({
    endToleranceSeconds: 2,
    stabilityDurationMs: 1_000,
  });

  assert.equal(tracker.observe(firstSegment, 12.9, 0), false);
  assert.equal(tracker.observe(firstSegment, 13, 100), false);
  assert.equal(tracker.observe(firstSegment, 13, 1_099), false);
  assert.equal(tracker.observe(firstSegment, 13, 1_100), true);
  assert.equal(tracker.observe(firstSegment, 13, 2_000), false);
});

test("tracker uses each segment global timeline end", () => {
  const tracker = new BufferedCompletionTracker({
    endToleranceSeconds: 2,
    stabilityDurationMs: 1_000,
  });

  assert.equal(tracker.observe(secondSegment, 28, 0), false);
  assert.equal(tracker.observe(secondSegment, 28, 1_000), true);
});

test("completion controller notifies an active segment only once", () => {
  const controller = new SegmentCompletionController();
  let calls = 0;
  controller.subscribe("segment-1", () => { calls += 1; });

  assert.equal(controller.complete("segment-1"), true);
  assert.equal(controller.complete("segment-1"), false);
  assert.equal(calls, 1);
});
