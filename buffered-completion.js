export class BufferedCompletionTracker {
  #endToleranceSeconds;
  #stabilityDurationMs;
  #activeSegmentId = null;
  #lastBufferedUntil = 0;
  #lastChangedAt = 0;
  #completedSegmentId = null;

  constructor({ endToleranceSeconds, stabilityDurationMs }) {
    if (!Number.isFinite(endToleranceSeconds) || endToleranceSeconds < 0) {
      throw new RangeError("endToleranceSeconds must be non-negative");
    }
    if (!Number.isFinite(stabilityDurationMs) || stabilityDurationMs < 0) {
      throw new RangeError("stabilityDurationMs must be non-negative");
    }
    this.#endToleranceSeconds = endToleranceSeconds;
    this.#stabilityDurationMs = stabilityDurationMs;
  }

  observe(segment, bufferedUntil, now = performance.now()) {
    if (!segment || !Number.isFinite(bufferedUntil)) return false;

    if (segment.id !== this.#activeSegmentId) {
      this.#activeSegmentId = segment.id;
      this.#lastBufferedUntil = bufferedUntil;
      this.#lastChangedAt = now;
      this.#completedSegmentId = null;
      return false;
    }

    if (bufferedUntil > this.#lastBufferedUntil + 0.001) {
      this.#lastBufferedUntil = bufferedUntil;
      this.#lastChangedAt = now;
      return false;
    }

    const segmentEndSeconds = (segment.startMs + segment.duration) / 1000;
    const reachedEndWindow = bufferedUntil >= segmentEndSeconds - this.#endToleranceSeconds;
    const stableLongEnough = now - this.#lastChangedAt >= this.#stabilityDurationMs;

    if (reachedEndWindow && stableLongEnough && this.#completedSegmentId !== segment.id) {
      this.#completedSegmentId = segment.id;
      return true;
    }

    return false;
  }

  reset() {
    this.#activeSegmentId = null;
    this.#lastBufferedUntil = 0;
    this.#lastChangedAt = 0;
    this.#completedSegmentId = null;
  }
}

export class SegmentCompletionController {
  #listeners = new Map();
  #completed = new Set();

  subscribe(segmentId, listener) {
    if (!this.#listeners.has(segmentId)) this.#listeners.set(segmentId, new Set());
    this.#listeners.get(segmentId).add(listener);

    return () => {
      const listeners = this.#listeners.get(segmentId);
      listeners?.delete(listener);
      if (listeners?.size === 0) this.#listeners.delete(segmentId);
    };
  }

  complete(segmentId) {
    if (this.#completed.has(segmentId)) return false;
    this.#completed.add(segmentId);

    for (const listener of this.#listeners.get(segmentId) ?? []) listener();
    this.#listeners.delete(segmentId);
    return true;
  }

  clear() {
    this.#listeners.clear();
    this.#completed.clear();
  }
}
