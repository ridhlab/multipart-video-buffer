import assert from "node:assert/strict";
import test from "node:test";
import { FfmpegStreamController } from "../stream-controller.js";

function createHarness() {
  const calls = [];
  const children = [];
  const spawnImpl = (command, args, options) => {
    calls.push({ command, args, options });
    const child = { killed: false, kill(signal) { this.killed = signal; }, once() {} };
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

test("open launches the requested allowlisted FLV without a shell", () => {
  const { controller, calls } = createHarness();
  const result = controller.open("test-001.flv");
  assert.deepEqual(result, { started: true, filename: "test-001.flv", streamName: "test-001" });
  assert.deepEqual(calls, [{
    command: "ffmpeg",
    args: ["-re", "-i", "/project/live/test-001.flv", "-c", "copy", "-f", "flv", "rtmp://127.0.0.1:1935/live/test-001"],
    options: { stdio: "inherit" },
  }]);
});

test("open rejects filenames outside the allowlist", () => {
  const { controller, calls } = createHarness();
  assert.throws(() => controller.open("../test-001.flv"), /Unknown FLV file/);
  assert.equal(calls.length, 0);
});

test("open does not launch the same filename twice", () => {
  const { controller, calls } = createHarness();
  controller.open("test-000.flv");
  assert.deepEqual(controller.open("test-000.flv"), {
    started: false,
    reason: "already-opened",
    filename: "test-000.flv",
  });
  assert.equal(calls.length, 1);
});

test("stopAll terminates every ffmpeg child", () => {
  const { controller, children } = createHarness();
  controller.open("test-000.flv");
  controller.open("test-001.flv");
  controller.stopAll();
  assert.deepEqual(children.map((child) => child.killed), ["SIGTERM", "SIGTERM"]);
});
