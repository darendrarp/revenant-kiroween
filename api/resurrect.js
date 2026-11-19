'use strict';

/**
 * GET /api/resurrect?url=<url>
 * Check whether a URL is alive; find its closest Wayback Machine snapshot and
 * life timeline; return the tombstone. Partial results on upstream timeouts.
 */
const lib = require('./_lib');

module.exports = async (req, res) => {
  try {
    const raw = (req.query && req.query.url) || '';
    let url;
    try {
      url = lib.normalizeUrl(raw);
    } catch (err) {
      if (err instanceof lib.ValidationError) return lib.sendError(res, 400, err.message);
      throw err;
    }
    const href = url.href;

    // All three lookups run in parallel: sequential phases could exceed
    // Vercel's 10s Hobby limit (6s closest + 6s timeline). If there is no
    // snapshot at all, the timeline points are discarded below.
    const [aliveRes, closest, timelineRaw] = await Promise.all([
      lib.checkAlive(href, 6000),
      lib.waybackClosest(href, { timeoutMs: 6000 }),
      lib.waybackTimeline(href, 6000),
    ]);
    const timeline = closest.available ? timelineRaw : { points: [], complete: true };

    let tombstone = lib.tombstoneFromTimeline(timeline.points);
    if (!tombstone && closest.available) {
      const year = lib.parseYear(closest.timestamp);
      tombstone = year ? { born: year, died: year } : null;
    }

    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    return lib.sendJson(res, 200, {
      input: raw,
      url: href,
      alive: aliveRes.alive,
      status: aliveRes.status,
      finalUrl: aliveRes.finalUrl,
      checkError: aliveRes.error || null,
      checkedMs: aliveRes.ms,
      snapshot: closest.available
        ? { url: closest.url, timestamp: closest.timestamp, date: lib.formatSnapshotDate(closest.timestamp) }
        : null,
      archiveError: closest.error || null,
      timeline: timeline.points,
      timelineComplete: timeline.complete,
      tombstone,
    });
  } catch (err) {
    return lib.sendError(res, 500, 'Something went wrong while resurrecting that link.');
  }
};
