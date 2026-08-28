import path from "node:path";

function streamNameFromFile(file) {
  return path.basename(file, path.extname(file));
}

export class FfmpegStreamController {
  #files;
  #spawn;
  #ffmpegCommand;
  #rtmpBaseUrl;
  #currentIndex = -1;
  #children = new Set();

  constructor({ files, spawnImpl, ffmpegCommand = "ffmpeg", rtmpBaseUrl }) {
    if (!Array.isArray(files) || files.length === 0) {
      throw new TypeError("At least one FLV file is required");
    }
    if (typeof spawnImpl !== "function") throw new TypeError("spawnImpl is required");
    this.#files = [...files];
    this.#spawn = spawnImpl;
    this.#ffmpegCommand = ffmpegCommand;
    this.#rtmpBaseUrl = rtmpBaseUrl.replace(/\/$/, "");
  }

  start() {
    if (this.#currentIndex >= 0) {
      return { started: false, reason: "already-started", index: this.#currentIndex };
    }
    return this.#launch(0);
  }

  advance(currentStreamName) {
    const reportedIndex = this.#files.findIndex(
      (file) => streamNameFromFile(file) === currentStreamName,
    );
    if (reportedIndex < 0) throw new Error(`Unknown stream: ${currentStreamName}`);
    if (reportedIndex < this.#currentIndex) {
      return { started: false, reason: "already-advanced", index: this.#currentIndex };
    }
    if (reportedIndex !== this.#currentIndex) {
      throw new Error(`Out-of-order stream trigger: ${currentStreamName}`);
    }
    if (reportedIndex + 1 >= this.#files.length) {
      return { started: false, reason: "end-of-list", index: this.#currentIndex };
    }
    return this.#launch(reportedIndex + 1);
  }

  stopAll() {
    for (const child of this.#children) child.kill("SIGTERM");
    this.#children.clear();
  }

  #launch(index) {
    const file = this.#files[index];
    const streamName = streamNameFromFile(file);
    const args = [
      "-re",
      "-i", file,
      "-c", "copy",
      "-f", "flv",
      `${this.#rtmpBaseUrl}/${streamName}`,
    ];
    const child = this.#spawn(this.#ffmpegCommand, args, { stdio: "inherit" });
    this.#children.add(child);
    child.once?.("exit", () => this.#children.delete(child));
    child.once?.("error", (error) => {
      this.#children.delete(child);
      console.error(`Failed to start ${streamName}: ${error.message}`);
    });
    this.#currentIndex = index;
    return { started: true, streamName, index };
  }
}
