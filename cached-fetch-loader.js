const LoaderStatus = Object.freeze({
  IDLE: 0,
  CONNECTING: 1,
  BUFFERING: 2,
  ERROR: 3,
  COMPLETE: 4,
});

function exactArrayBuffer(view) {
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
}

export function createCachedFetchLoader({
  cache,
  completionController = null,
  fetchImpl = globalThis.fetch,
  onProgress = () => {},
}) {
  if (!cache) throw new TypeError("cache is required");
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl must be a function");

  return class CachedFetchLoader {
    _status = LoaderStatus.IDLE;
    _needStash = true;

    onContentLengthKnown = null;
    onURLRedirect = null;
    onDataArrival = null;
    onError = null;
    onComplete = null;

    #abortController = null;
    #reader = null;
    #destroyed = false;
    #completed = false;
    #unsubscribeCompletion = null;

    constructor(_seekHandler, _config) {}

    get type() {
      return "cached-fetch-stream-loader";
    }

    get status() {
      return this._status;
    }

    get needStashBuffer() {
      return this._needStash;
    }

    isWorking() {
      return this._status === LoaderStatus.CONNECTING || this._status === LoaderStatus.BUFFERING;
    }

    open(dataSource, range = { from: 0, to: -1 }) {
      if (this.#destroyed) throw new Error("Loader has been destroyed");
      if (this.isWorking()) throw new Error("Loader is already working");
      this.#completed = false;

      const source = {
        ...dataSource,
        id: dataSource.id ?? dataSource.url,
        startMs: dataSource.startMs ?? 0,
      };
      const cached = cache.entries.find((entry) => entry.id === source.id && entry.complete);

      if (cached) {
        this.#deliverFromCache(source, range, cached.byteLength);
        return;
      }

      this.#unsubscribeCompletion = completionController?.subscribe(source.id, () => {
        this.#reader?.cancel().catch(() => {});
      });
      this.#fetchAndDeliver(source, range);
    }

    abort() {
      this.#unsubscribeCompletion?.();
      this.#unsubscribeCompletion = null;
      this.#abortController?.abort(new DOMException("Request aborted", "AbortError"));
      this.#reader?.cancel().catch(() => {});
      this.#reader = null;
      this._status = LoaderStatus.IDLE;
    }

    destroy() {
      this.abort();
      this.#destroyed = true;
      this.onContentLengthKnown = null;
      this.onURLRedirect = null;
      this.onDataArrival = null;
      this.onError = null;
      this.onComplete = null;
    }

    #deliverFromCache(source, range, byteLength) {
      const from = Math.max(0, range?.from ?? 0);
      const requestedTo = range?.to ?? -1;
      const to = requestedTo >= 0 ? Math.min(requestedTo, byteLength - 1) : byteLength - 1;
      const bytes = cache.readRange(source.id, from, to);

      this._status = LoaderStatus.BUFFERING;
      if (bytes.byteLength > 0) {
        this.onDataArrival?.(exactArrayBuffer(bytes), from, bytes.byteLength);
      }
      this._status = LoaderStatus.COMPLETE;
      queueMicrotask(() => this.onComplete?.(from, to));
      onProgress({ source, byteLength: bytes.byteLength, cached: true, complete: true });
    }

    async #fetchAndDeliver(source, range) {
      this.#abortController = new AbortController();
      this._status = LoaderStatus.CONNECTING;
      const from = Math.max(0, range?.from ?? 0);
      const requestedTo = range?.to ?? -1;
      const isWholeSegment = from === 0 && requestedTo < 0;
      let byteStart = from;
      let receivedLength = 0;

      try {
        const headers = {};
        if (!isWholeSegment) {
          headers.Range = `bytes=${from}-${requestedTo >= 0 ? requestedTo : ""}`;
        }
        const response = await fetchImpl(source.url, {
          signal: this.#abortController.signal,
          headers,
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status} while fetching ${source.url}`);
        }

        const contentLength = Number(response.headers?.get?.("content-length"));
        if (Number.isFinite(contentLength)) this.onContentLengthKnown?.(contentLength);
        if (response.url && response.url !== source.url) this.onURLRedirect?.(response.url);
        if (!response.body) throw new Error("Streaming response body is unavailable");

        if (isWholeSegment) cache.begin(source);
        this.#reader = response.body.getReader();
        this._status = LoaderStatus.BUFFERING;

        while (true) {
          const { value, done } = await this.#reader.read();
          // console.log({ value, done });
          if (done) break;
          if (!(value instanceof Uint8Array) || value.byteLength === 0) continue;
          // console.log(cache);
          if (isWholeSegment) cache.append(source.id, value);
          receivedLength += value.byteLength;
          this.onDataArrival?.(exactArrayBuffer(value), byteStart, receivedLength);
          byteStart += value.byteLength;
          onProgress({ source, byteLength: value.byteLength, cached: false, complete: false });
        }

        this.#finish(source, {
          from,
          to: byteStart - 1,
          receivedLength,
          isWholeSegment,
        });
      } catch (error) {
        if (this.#abortController.signal.aborted) {
          this._status = LoaderStatus.IDLE;
          return;
        }
        this._status = LoaderStatus.ERROR;
        this.onError?.("Exception", {
          code: error?.status ?? -1,
          msg: error instanceof Error ? error.message : String(error),
        });
      } finally {
        this.#reader = null;
      }
    }

    #finish(source, { from, to, receivedLength, isWholeSegment }) {
      if (this.#completed) return;
      this.#completed = true;
      this.#unsubscribeCompletion?.();
      this.#unsubscribeCompletion = null;
      if (isWholeSegment) cache.complete(source.id);
      this._status = LoaderStatus.COMPLETE;
      this.onComplete?.(from, to);
      onProgress({ source, byteLength: receivedLength, cached: false, complete: true });
    }
  };
}
