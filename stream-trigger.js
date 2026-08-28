const OPEN_STREAM_URL = "http://127.0.0.1:3000/open-stream";

export function filenameFromUrl(url) {
  const filename = new URL(url).pathname.split("/").filter(Boolean).at(-1);
  if (!filename?.toLowerCase().endsWith(".flv")) {
    throw new Error(`Stream URL is not an FLV resource: ${url}`);
  }
  return filename;
}

export async function openStream(url, { fetchImpl = globalThis.fetch } = {}) {
  const filename = filenameFromUrl(url);
  const response = await fetchImpl(OPEN_STREAM_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ filename }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? `Open stream failed (${response.status})`);
  return result;
}
