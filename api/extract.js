'use strict';

/**
 * GET /api/extract?url=<web.archive.org snapshot url>
 * Reader view: fetch a Wayback snapshot server-side and return readable
 * title/headings/text. Host-restricted to web.archive.org so this endpoint
 * cannot be abused as a general-purpose open proxy.
 */
const lib = require('./_lib');

const MAX_SNAPSHOT_BYTES = 1024 * 1024; // 1 MB

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
    if (url.hostname !== 'web.archive.org') {
      return lib.sendError(res, 400, 'Reader view only works on web.archive.org snapshot URLs.');
    }
    let page;
    try {
      page = await lib.fetchWithTimeout(url.href, { timeoutMs: 8000, maxBytes: MAX_SNAPSHOT_BYTES });
    } catch (err) {
      if (err && err.code === 'TIMEOUT') return lib.sendError(res, 504, 'The archive took too long to respond (8s). Try again.');
      if (err && err.code === 'TOO_LARGE') return lib.sendError(res, 413, 'That snapshot is too large to read (over 1 MB of HTML).');
      return lib.sendError(res, 502, 'Could not fetch that snapshot from the archive.');
    }
    if (page.status < 200 || page.status >= 400) {
      return lib.sendError(res, 502, `The archive returned HTTP ${page.status} for that snapshot.`);
    }
    const readable = lib.extractReadable(page.text, 20000, url.href);
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
    return lib.sendJson(res, 200, {
      url: url.href,
      title: readable.title,
      headings: readable.headings,
      text: readable.text,
      truncated: readable.truncated,
      redirect: readable.redirect,
    });
  } catch (err) {
    return lib.sendError(res, 500, 'Something went wrong while reading that snapshot.');
  }
};
