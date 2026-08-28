const STREAM_API_BASE_URL = "http://127.0.0.1:3000";

export function streamNameFromUrl(url) {
  const pathname = new URL(url).pathname;
  const filename = pathname.split("/").filter(Boolean).at(-1);
  if (!filename?.toLowerCase().endsWith(".flv")) {
    throw new Error(`Stream URL is not an FLV resource: ${url}`);
  }
  return filename.slice(0, -4);
}

async function readTriggerResponse(response) {
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? `Stream trigger failed (${response.status})`);
  return result;
}

export async function triggerInitialStream({ fetchImpl = globalThis.fetch } = {}) {
  const response = await fetchImpl(`${STREAM_API_BASE_URL}/api/streams/start`, { method: "POST" });
  return readTriggerResponse(response);
}

export async function triggerNextStream(url, { fetchImpl = globalThis.fetch } = {}) {
  const currentStreamName = streamNameFromUrl(url);
  const response = await fetchImpl(`${STREAM_API_BASE_URL}/api/streams/next`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ currentStreamName }),
  });
  return readTriggerResponse(response);
}
