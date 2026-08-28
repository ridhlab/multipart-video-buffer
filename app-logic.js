export function parseSegmentList(text) {
  let items;

  try {
    items = JSON.parse(text);
  } catch (error) {
    throw new Error(`Segment list is not valid JSON: ${error.message}`);
  }

  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("Provide at least one segment");
  }

  const seen = new Set();
  let timelineOffsetMs = 0;

  return items.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`Segment ${index + 1} must be an object`);
    }

    if (typeof item.url !== "string" || item.url.trim() === "") {
      throw new Error(`Segment ${index + 1} must have a URL`);
    }

    let parsedUrl;

    try {
      parsedUrl = new URL(item.url);
    } catch {
      throw new Error(`Segment ${index + 1} has an invalid URL`);
    }

    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      throw new Error(`Segment ${index + 1} must use HTTP or HTTPS`);
    }

    if (seen.has(parsedUrl.href)) {
      throw new Error(`Duplicate segment URL: ${parsedUrl.href}`);
    }

    if (
      typeof item.duration !== "number" ||
      !Number.isFinite(item.duration) ||
      item.duration <= 0
    ) {
      throw new Error(`Segment ${index + 1} duration must be a positive number`);
    }

    seen.add(parsedUrl.href);

    // Input memakai detik, flv.js membutuhkan milidetik.
    const durationMs = item.duration * 1000;

    const segment = {
      id: `segment-${index + 1}`,
      url: parsedUrl.href,
      duration: durationMs,
      startMs: timelineOffsetMs,
    };

    timelineOffsetMs += durationMs;

    return segment;
  });
}

export function clampSeekSeconds(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}
