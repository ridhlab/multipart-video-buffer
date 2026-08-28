export class RollingSegmentCache {
  #maxDurationMs;
  #entries = [];
  #entriesById = new Map();
  #totalBytes = 0;

  constructor({ maxDurationMs }) {
    if (!Number.isFinite(maxDurationMs) || maxDurationMs <= 0) {
      throw new RangeError("maxDurationMs must be positive");
    }

    this.#maxDurationMs = maxDurationMs;
  }

  begin(segment) {
    if (!segment?.id || this.#entriesById.has(segment.id)) {
      throw new Error(`Segment id must be unique: ${segment?.id ?? "missing"}`);
    }
    if (!Number.isFinite(segment.duration) || segment.duration <= 0) {
      throw new RangeError("Segment duration must be positive");
    }

    const entry = {
      id: segment.id,
      url: segment.url,
      duration: segment.duration,
      startMs: segment.startMs,
      endMs: segment.startMs + segment.duration,
      chunks: [],
      byteLength: 0,
      complete: false,
    };
    this.#entries.push(entry);
    this.#entriesById.set(entry.id, entry);
    return entry;
  }

  append(id, chunk) {
    const entry = this.#requireEntry(id);
    if (entry.complete) {
      throw new Error(`Cannot append to completed segment: ${id}`);
    }
    if (!(chunk instanceof Uint8Array)) {
      throw new TypeError("chunk must be a Uint8Array");
    }

    const copy = chunk.slice();
    // console.log(entry);
    entry.chunks.push(copy);
    entry.byteLength += copy.byteLength;
    this.#totalBytes += copy.byteLength;
  }

  complete(id) {
    const entry = this.#requireEntry(id);
    entry.complete = true;
    this.#evictCompletedSegments();
  }

  has(id) {
    return this.#entriesById.has(id);
  }

  readRange(id, from = 0, toInclusive = Number.POSITIVE_INFINITY) {
    const entry = this.#requireEntry(id);
    const lastByte = Math.min(toInclusive, entry.byteLength - 1);
    if (!Number.isInteger(from) || from < 0 || lastByte < from) {
      return new Uint8Array();
    }

    const output = new Uint8Array(lastByte - from + 1);
    let sourceOffset = 0;
    let outputOffset = 0;

    for (const chunk of entry.chunks) {
      const chunkEnd = sourceOffset + chunk.byteLength - 1;
      if (chunkEnd >= from && sourceOffset <= lastByte) {
        const localStart = Math.max(0, from - sourceOffset);
        const localEnd = Math.min(chunk.byteLength, lastByte - sourceOffset + 1);
        const slice = chunk.subarray(localStart, localEnd);
        output.set(slice, outputOffset);
        outputOffset += slice.byteLength;
      }
      sourceOffset += chunk.byteLength;
      if (sourceOffset > lastByte) break;
    }

    return output;
  }

  clear() {
    this.#entries = [];
    this.#entriesById.clear();
    this.#totalBytes = 0;
  }

  get retainedDurationMs() {
    return this.#entries.reduce((total, entry) => total + entry.duration, 0);
  }

  get entries() {
    return [...this.#entries];
  }

  get totalBytes() {
    return this.#totalBytes;
  }

  get retainedStartMs() {
    return this.#entries[0]?.startMs ?? 0;
  }

  get retainedEndMs() {
    return this.#entries.at(-1)?.endMs ?? 0;
  }

  #requireEntry(id) {
    const entry = this.#entriesById.get(id);
    if (!entry) throw new Error(`Unknown segment: ${id}`);
    return entry;
  }

  #evictCompletedSegments() {
    while (this.retainedDurationMs > this.#maxDurationMs) {
      const index = this.#entries.findIndex((entry) => entry.complete);

      if (index === -1) return;

      const [entry] = this.#entries.splice(index, 1);

      this.#entriesById.delete(entry.id);
      this.#totalBytes -= entry.byteLength;
    }
  }
}
