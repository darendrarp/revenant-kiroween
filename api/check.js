'use strict';

/**
 * POST /api/check  { "urls": ["https://...", ...] }  (1–12 URLs)
 * Bulk liveness check. Dead URLs also get their closest Wayback snapshot.
 * Used by the Bulk tab and by the Audit tab (client-side chunking).
 */
const lib = require('./_lib');

const MAX_URLS = 12;

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return lib.sendError(res, 405, 'Use POST with a JSON body: {"urls": [...]}.');
    }
    let body;
    try {
      body = await lib.readJsonBody(req);
    } catch (err) {
      if (err instanceof lib.ValidationError) return lib.sendError(res, 400, err.message);
      throw err;
    }
    const urls = body && body.urls;
    if (!Array.isArray(urls) || urls.length === 0) {
      return lib.sendError(res, 400, 'Send a JSON body with "urls": an array of 1–12 URLs.');
    }
    if (urls.length > MAX_URLS) {
      return lib.sendError(res, 400, `Too many URLs — max ${MAX_URLS} per request. Send them in chunks.`);
    }

    const results = await Promise.all(
      urls.map(async (raw) => {
        let href;
        try {
          href = lib.normalizeUrl(raw).href;
        } catch (err) {
          return { input: String(raw ?? ''), ok: false, error: err.message };
        }
        const [aliveRes, closest] = await Promise.all([
          lib.checkAlive(href, 6000),
          // Fetched in parallel (not after the liveness check) so a dead URL
          // costs ~6s total, not 6s + 6s — inside the 10s function limit.
          // The snapshot is discarded when the URL turns out to be alive.
          lib.waybackClosest(href, { timeoutMs: 6000 }),
        ]);
        const result = {
          input: String(raw),
          url: href,
          ok: true,
          alive: aliveRes.alive,
          status: aliveRes.status,
          finalUrl: aliveRes.finalUrl,
          ms: aliveRes.ms,
          error: aliveRes.error || null,
          snapshot: null,
        };
        if (!aliveRes.alive) {
          if (closest.available) {
            result.snapshot = {
              url: closest.url,
              timestamp: closest.timestamp,
              date: lib.formatSnapshotDate(closest.timestamp),
            };
          } else if (closest.error) {
            result.archiveError = closest.error;
          }
        }
        return result;
      }),
    );

    return lib.sendJson(res, 200, { results });
  } catch (err) {
    return lib.sendError(res, 500, 'Something went wrong while checking those links.');
  }
};
