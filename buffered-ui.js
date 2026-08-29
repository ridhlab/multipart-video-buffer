export function normalizeBufferedRanges(timeRanges, windowStart, windowEnd) {
  const duration = windowEnd - windowStart;
  if (!timeRanges || !Number.isFinite(duration) || duration <= 0) return [];

  const ranges = [];
  for (let index = 0; index < timeRanges.length; index += 1) {
    const start = Math.max(windowStart, timeRanges.start(index));
    const end = Math.min(windowEnd, timeRanges.end(index));
    if (end <= start) continue;
    ranges.push({
      start,
      end,
      leftPercent: ((start - windowStart) / duration) * 100,
      widthPercent: ((end - start) / duration) * 100,
    });
  }
  return ranges;
}
