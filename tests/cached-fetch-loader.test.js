import assert from "node:assert/strict";
import test from "node:test";

import { createCachedFetchLoader } from "../cached-fetch-loader.js";
import { SegmentCompletionController } from "../buffered-completion.js";
import { RollingSegmentCache } from "../rolling-segment-cache.js";

const dataSource = {
  id: "s1",
  url: "http://127.0.0.1:8000/live/test-1.flv",
  duration: 30_000,
  startMs: 0,
};

function streamingResponse(chunks) {
  let index = 0;
  return {
    ok: true,
    status: 200,
    headers: new Headers({ "content-length": String(chunks.reduce((n, chunk) => n + chunk.byteLength, 0)) }),
    body: {
      getReader() {
        return {
          async read() {
            if (index === chunks.length) return { done: true, value: undefined };
            return { done: false, value: chunks[index++] };
          },
          async cancel() {},
        };
      },
    },
  };
}

function runLoader(Loader, source, range = { from: 0, to: -1 }) {
  const loader = new Loader(null, {});
  const arrivals = [];

  const completed = new Promise((resolve, reject) => {
    loader.onDataArrival = (buffer, byteStart, receivedLength) => {
      arrivals.push({ bytes: [...new Uint8Array(buffer)], byteStart, receivedLength });
    };
    loader.onComplete = (rangeFrom, rangeTo) => resolve({ rangeFrom, rangeTo });
    loader.onError = (type, info) => reject(new Error(`${type}: ${info.msg}`));
  });

  loader.open(source, range);
  return { loader, arrivals, completed };
}

test("network chunks are cached and forwarded once with correct offsets", async () => {
  const cache = new RollingSegmentCache({ maxDurationMs: 300_000 });
  let fetchCount = 0;
  const Loader = createCachedFetchLoader({
    cache,
    fetchImpl: async () => {
      fetchCount += 1;
      return streamingResponse([Uint8Array.of(1, 2), Uint8Array.of(3, 4)]);
    },
  });

  const { arrivals, completed } = runLoader(Loader, dataSource);
  assert.deepEqual(await completed, { rangeFrom: 0, rangeTo: 3 });

  assert.equal(fetchCount, 1);
  assert.deepEqual(arrivals, [
    { bytes: [1, 2], byteStart: 0, receivedLength: 2 },
    { bytes: [3, 4], byteStart: 2, receivedLength: 4 },
  ]);
  assert.deepEqual([...cache.readRange("s1", 0, 3)], [1, 2, 3, 4]);
  assert.equal(cache.entries[0].complete, true);
});

test("a retained byte range is served without another network request", async () => {
  const cache = new RollingSegmentCache({ maxDurationMs: 300_000 });
  cache.begin(dataSource);
  cache.append("s1", Uint8Array.of(1, 2));
  cache.append("s1", Uint8Array.of(3, 4));
  cache.complete("s1");

  let fetchCount = 0;
  const Loader = createCachedFetchLoader({
    cache,
    fetchImpl: async () => {
      fetchCount += 1;
      throw new Error("network should not be used");
    },
  });

  const { arrivals, completed } = runLoader(Loader, dataSource, { from: 1, to: 2 });
  assert.deepEqual(await completed, { rangeFrom: 1, rangeTo: 2 });
  assert.equal(fetchCount, 0);
  assert.deepEqual(arrivals, [
    { bytes: [2, 3], byteStart: 1, receivedLength: 2 },
  ]);
});

test("abort cancels an active request and does not report completion", async () => {
  const cache = new RollingSegmentCache({ maxDurationMs: 300_000 });
  let observedSignal;
  const Loader = createCachedFetchLoader({
    cache,
    fetchImpl: (_url, options) => {
      observedSignal = options.signal;
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(options.signal.reason));
      });
    },
  });

  const loader = new Loader(null, {});
  let completed = false;
  loader.onComplete = () => { completed = true; };
  loader.onError = () => {};
  loader.open(dataSource, { from: 0, to: -1 });
  loader.abort();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(observedSignal.aborted, true);
  assert.equal(loader.isWorking(), false);
  assert.equal(completed, false);
});

test("buffered completion cancels an endless response and completes exactly once", async () => {
  const cache = new RollingSegmentCache({ maxDurationMs: 300_000 });
  const completionController = new SegmentCompletionController();
  let releaseRead;
  let readCount = 0;
  let cancelCount = 0;

  const Loader = createCachedFetchLoader({
    cache,
    completionController,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      body: {
        getReader() {
          return {
            async read() {
              if (readCount++ === 0) return { done: false, value: Uint8Array.of(1, 2, 3) };
              return new Promise((resolve) => { releaseRead = resolve; });
            },
            async cancel() {
              cancelCount += 1;
              releaseRead?.({ done: true, value: undefined });
            },
          };
        },
      },
    }),
  });

  const loader = new Loader(null, {});
  let completeCount = 0;
  let firstArrival;
  const arrived = new Promise((resolve) => { firstArrival = resolve; });
  const completed = new Promise((resolve, reject) => {
    loader.onDataArrival = () => firstArrival();
    loader.onComplete = () => {
      completeCount += 1;
      resolve();
    };
    loader.onError = (type, info) => reject(new Error(`${type}: ${info.msg}`));
  });

  loader.open(dataSource, { from: 0, to: -1 });
  await arrived;
  completionController.complete("s1");

  const didComplete = await Promise.race([
    completed.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 25)),
  ]);

  assert.equal(didComplete, true);
  assert.equal(cancelCount, 1);
  assert.equal(completeCount, 1);
  assert.equal(cache.entries[0].complete, true);
});
