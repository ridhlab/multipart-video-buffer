import assert from "node:assert/strict";
import test from "node:test";

import { FfmpegStreamController } from "../stream-controller.js";

function createHarness() {
  const calls = [];
  const children = [];
  const spawnImpl = (command, args, options) => {
    calls.push({ command, args, options });
    const child = {
      killed: false,
      kill(signal) {
        this.killed = signal;
      },
      once() {},
    };
    children.push(child);
    return child;
  };
  const controller = new FfmpegStreamController({
    files: ["/project/live/test-000.flv", "/project/live/test-001.flv"],
    spawnImpl,
    rtmpBaseUrl: "rtmp://127.0.0.1:1935/live",
  });
  return { controller, calls, children };
}

test("start launches the first FLV using ffmpeg without a shell", () => {
  const { controller, calls } = createHarness();

  const result = controller.start();

  assert.deepEqual(result, { started: true, streamName: "test-000", index: 0 });
  assert.deepEqual(calls, [{
    command: "ffmpeg",
    args: [
      "-re",
      "-i", "/project/live/test-000.flv",
      "-c", "copy",
      "-f", "flv",
      "rtmp://127.0.0.1:1935/live/test-000",
    ],
    options: { stdio: "inherit" },
  }]);
});

test("advance launches only the segment after the reported current stream", () => {
  const { controller, calls } = createHarness();
  controller.start();

  const result = controller.advance("test-000");

  assert.deepEqual(result, { started: true, streamName: "test-001", index: 1 });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].args.at(-1), "rtmp://127.0.0.1:1935/live/test-001");
});

test("duplicate completion trigger does not launch ffmpeg twice", () => {
  const { controller, calls } = createHarness();
  controller.start();
  controller.advance("test-000");

  const result = controller.advance("test-000");

  assert.deepEqual(result, { started: false, reason: "already-advanced", index: 1 });
  assert.equal(calls.length, 2);
});

test("stopAll terminates every ffmpeg child", () => {
  const { controller, children } = createHarness();
  controller.start();
  controller.advance("test-000");

  controller.stopAll();

  assert.deepEqual(children.map((child) => child.killed), ["SIGTERM", "SIGTERM"]);
});
