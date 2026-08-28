import { clampSeekSeconds, parseSegmentList } from "./app-logic.js";
import { createCachedFetchLoader } from "./cached-fetch-loader.js";
import { RollingSegmentCache } from "./rolling-segment-cache.js";
import { BufferedCompletionTracker, SegmentCompletionController } from "./buffered-completion.js";
import { triggerInitialStream, triggerNextStream } from "./stream-trigger.js";

const MAX_CACHE_DURATION_MS = 5 * 60 * 1000;
const END_TOLERANCE_SECONDS = 2;
const STABILITY_DURATION_MS = 1_000;

const $ = (selector) => document.querySelector(selector);
const elements = {
  video: $("#video"),
  segmentList: $("#segment-list"),
  connect: $("#connect"),
  disconnect: $("#disconnect"),
  goLive: $("#go-live"),
  seek: $("#seek"),
  seekStart: $("#seek-start"),
  seekEnd: $("#seek-end"),
  status: $("#status"),
  currentSegment: $("#current-segment"),
  cacheSize: $("#cache-size"),
  cacheCount: $("#cache-count"),
  retainedWindow: $("#retained-window"),
  playbackTime: $("#playback-time"),
  error: $("#error"),
  log: $("#log"),
};

let player = null;
let cache = null;
let updateTimer = null;
let seekingFromApp = false;
let completionController = null;
let completionTracker = null;
let activeSegment = null;
const triggeringSegments = new Set();

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00";
  const total = Math.floor(seconds);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
}

function writeLog(message) {
  elements.log.textContent =
    `[${new Date().toLocaleTimeString()}] ${message}\n${elements.log.textContent}`.slice(0, 12_000);
}

function showError(error) {
  const message = error instanceof Error ? error.message : String(error);
  elements.error.textContent = message;
  elements.error.hidden = false;
  elements.status.textContent = "Error";
  writeLog(`ERROR: ${message}`);
}

function clearError() {
  elements.error.hidden = true;
  elements.error.textContent = "";
}

function getLatestBufferedTime(video) {
  const ranges = video.buffered;

  if (ranges.length === 0) {
    return 0;
  }

  return ranges.end(ranges.length - 1);
}

async function finishSegmentAndStartNext(segment) {
  if (triggeringSegments.has(segment.id)) return;
  triggeringSegments.add(segment.id);
  try {
    const result = await triggerNextStream(segment.url);
    if (result.started) {
      writeLog(`Node started RTMP stream ${result.streamName}`);
    } else {
      writeLog(`Node stream trigger: ${result.reason}`);
    }
    completionController?.complete(segment.id);
  } catch (error) {
    completionTracker?.reset();
    showError(error);
  } finally {
    triggeringSegments.delete(segment.id);
  }
}

function updateUi() {
  const start = (cache?.retainedStartMs ?? 0) / 1000;
  const end = (cache?.retainedEndMs ?? 0) / 1000;
  const entries = cache?.entries ?? [];
  elements.cacheSize.textContent = formatBytes(cache?.totalBytes ?? 0);
  const completedCount = entries.filter((entry) => entry.complete).length;

  const retainedDuration = (cache?.retainedDurationMs ?? 0) / 1000;

  elements.cacheCount.textContent = `${completedCount} segment · ${formatTime(retainedDuration)}`;

  elements.retainedWindow.textContent = `${formatTime(start)}–${formatTime(end)}`;
  elements.seekStart.textContent = formatTime(start);
  elements.seekEnd.textContent = formatTime(end);
  elements.seek.min = String(start);
  elements.seek.max = String(Math.max(start, end));
  elements.seek.disabled = !player || end <= start;
  elements.goLive.disabled = !player || end <= start;
  if (!elements.seek.matches(":active")) {
    elements.seek.value = String(
      clampSeekSeconds(elements.video.currentTime || start, start, Math.max(start, end)),
    );
  }
  elements.playbackTime.textContent = formatTime(elements.video.currentTime);

  const bufferedUntil = getLatestBufferedTime(elements.video);
  console.log("time now", elements.video.currentTime, "bufferedUntil", bufferedUntil);
  if (
    activeSegment &&
    completionTracker?.observe(activeSegment, bufferedUntil, performance.now())
  ) {
    const segmentEnd = (activeSegment.startMs + activeSegment.duration) / 1000;
    writeLog(
      `${activeSegment.id} considered complete at ${bufferedUntil.toFixed(2)}s ` +
        `(target ${segmentEnd.toFixed(2)}s)`,
    );
    void finishSegmentAndStartNext(activeSegment);
  }
}

function setConnectedState(connected) {
  elements.connect.disabled = connected;
  elements.disconnect.disabled = !connected;
  elements.segmentList.disabled = connected;
}

async function connect() {
  clearError();
  try {
    if (!window.flvjs?.isSupported())
      throw new Error("Browser ini tidak mendukung flv.js melalui Media Source Extensions");
    const segments = parseSegmentList(elements.segmentList.value);
    disconnect({ preserveLog: true });
    elements.status.textContent = "Starting initial stream";
    const initialStream = await triggerInitialStream();
    writeLog(
      initialStream.started
        ? `Node started RTMP stream ${initialStream.streamName}`
        : `Node stream start: ${initialStream.reason}`,
    );
    cache = new RollingSegmentCache({ maxDurationMs: MAX_CACHE_DURATION_MS });
    completionController = new SegmentCompletionController();
    completionTracker = new BufferedCompletionTracker({
      endToleranceSeconds: END_TOLERANCE_SECONDS,
      stabilityDurationMs: STABILITY_DURATION_MS,
    });
    const CachedFetchLoader = createCachedFetchLoader({
      cache,
      completionController,
      onProgress({ source, byteLength, cached, complete }) {
        elements.currentSegment.textContent = source.id;
        if (!complete) {
          activeSegment = source;
        } else {
          if (activeSegment?.id === source.id) activeSegment = null;
          writeLog(
            `${source.id} ${cached ? "served from cache" : "download complete"} (${formatBytes(byteLength)})`,
          );
        }

        updateUi();
      },
    });

    player = window.flvjs.createPlayer(
      { type: "flv", isLive: false, segments },
      {
        customLoader: CachedFetchLoader,
        lazyLoad: false,
        autoCleanupSourceBuffer: false,
        accurateSeek: true,
        enableWorker: false,
      },
    );
    player.on(window.flvjs.Events.ERROR, (type, detail, info) =>
      showError(new Error(`${type} / ${detail}: ${info?.msg ?? "unknown flv.js error"}`)),
    );
    player.on(window.flvjs.Events.LOADING_COMPLETE, () => {
      elements.status.textContent = "All segments loaded";
      writeLog("All listed FLV segments reached EOF");
    });
    player.on(window.flvjs.Events.MEDIA_INFO, (info) =>
      writeLog(`Media: ${info.videoCodec ?? "no video"} / ${info.audioCodec ?? "no audio"}`),
    );
    player.on(window.flvjs.Events.STATISTICS_INFO, (stats) => {
      if (Number.isInteger(stats.currentSegmentIndex))
        elements.currentSegment.textContent = `segment-${stats.currentSegmentIndex + 1}`;
    });

    player.attachMediaElement(elements.video);
    player.load();
    setConnectedState(true);
    elements.status.textContent = "Loading";
    writeLog(`Started one multipart player with ${segments.length} segments`);
    updateTimer = window.setInterval(updateUi, 250);
    try {
      await player.play();
      elements.status.textContent = "Playing";
    } catch (error) {
      elements.status.textContent = "Ready — press play";
      writeLog(`Autoplay was blocked: ${error.message}`);
    }
  } catch (error) {
    showError(error);
    disconnect({ preserveError: true, preserveLog: true });
  }
}

function disconnect({ preserveError = false, preserveLog = false } = {}) {
  if (updateTimer !== null) window.clearInterval(updateTimer);
  updateTimer = null;
  if (player) {
    try {
      player.pause();
      player.destroy();
    } catch (error) {
      writeLog(`Teardown warning: ${error.message}`);
    }
  }
  player = null;
  cache?.clear();
  cache = null;
  completionController?.clear();
  completionController = null;
  completionTracker?.reset();
  completionTracker = null;
  activeSegment = null;
  triggeringSegments.clear();
  elements.video.removeAttribute("src");
  elements.video.load();
  elements.currentSegment.textContent = "—";
  elements.status.textContent = preserveError ? "Error" : "Idle";
  setConnectedState(false);
  if (!preserveError) clearError();
  if (!preserveLog) writeLog("Disconnected and raw cache cleared");
  updateUi();
}

function seekTo(value) {
  if (!cache || !player) return;
  const start = cache.retainedStartMs / 1000;
  const end = cache.retainedEndMs / 1000;
  const target = clampSeekSeconds(Number(value), start, end);
  seekingFromApp = true;
  elements.video.currentTime = target;
  queueMicrotask(() => {
    seekingFromApp = false;
  });
  writeLog(`Seek to ${formatTime(target)} inside retained window`);
}

function goToLatest() {
  const ranges = elements.video.buffered;
  const latest =
    ranges.length > 0
      ? Math.max(0, ranges.end(ranges.length - 1) - 0.05)
      : (cache?.retainedEndMs ?? 0) / 1000;
  seekTo(latest);
  elements.video.play().catch(showError);
}

elements.connect.addEventListener("click", connect);
elements.disconnect.addEventListener("click", () => disconnect());
elements.goLive.addEventListener("click", goToLatest);
elements.seek.addEventListener("input", (event) => seekTo(event.target.value));
elements.video.addEventListener("play", () => {
  if (player) elements.status.textContent = "Playing";
});
elements.video.addEventListener("pause", () => {
  if (player) elements.status.textContent = "Paused";
});
elements.video.addEventListener("seeking", () => {
  if (!cache || seekingFromApp) return;
  const start = cache.retainedStartMs / 1000;
  const end = cache.retainedEndMs / 1000;
  const target = clampSeekSeconds(elements.video.currentTime, start, end);
  if (target !== elements.video.currentTime) seekTo(target);
});

updateUi();
