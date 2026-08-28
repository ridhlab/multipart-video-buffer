import path from "node:path";

function streamNameFromFile(file) {
  return path.basename(file, path.extname(file));
}

export class FfmpegStreamController {
  #filesByName;
  #spawn;
  #ffmpegCommand;
  #rtmpBaseUrl;
  #children = new Set();
  #openedFiles = new Set();

  constructor({ files, spawnImpl, ffmpegCommand = "ffmpeg", rtmpBaseUrl }) {
    if (!Array.isArray(files) || files.length === 0) {
      throw new TypeError("At least one FLV file is required");
    }
    if (typeof spawnImpl !== "function") throw new TypeError("spawnImpl is required");
    this.#filesByName = new Map(files.map((file) => [path.basename(file), file]));
    this.#spawn = spawnImpl;
    this.#ffmpegCommand = ffmpegCommand;
    this.#rtmpBaseUrl = rtmpBaseUrl.replace(/\/$/, "");
  }

  open(filename) {
    const file = this.#filesByName.get(filename);
    if (!file) throw new Error(`Unknown FLV file: ${filename}`);
    if (this.#openedFiles.has(filename)) {
      return { started: false, reason: "already-opened", filename };
    }
    return this.#launch(filename, file);
  }

  stopAll() {
    for (const child of this.#children) child.kill("SIGTERM");
    this.#children.clear();
  }

  #launch(filename, file) {
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
    this.#openedFiles.add(filename);
    return { started: true, filename, streamName };
  }
}
