'use strict';

/**
 * GET /api/audit?url=<page url>
 * Fetch a page and extract its outbound links (capped at 60). Checking is
 * done by the browser in chunks through POST /api/check, so no single
 * function call can time out on a link-heavy page (see design.md §2).
 */
const lib = require('./_lib');

const MAX_LINKS = 60;
const MAX_PAGE_BYTES = 1536 * 1024; // 1.5 MB

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
    let page;
    try {
      page = await lib.fetchWithTimeout(href, { timeoutMs: 8000, maxBytes: MAX_PAGE_BYTES });
    } catch (err) {
      if (err && err.code === 'TIMEOUT') return lib.sendError(res, 504, 'That page took too long to respond (8s). Try again.');
      if (err && err.code === 'TOO_LARGE') return lib.sendError(res, 413, 'That page is too large to audit (over 1.5 MB of HTML).');
      return lib.sendError(res, 502, 'Could not fetch that page — it may be dead or blocking requests.');
    }
    if (page.status < 200 || page.status >= 400) {
      return lib.sendError(res, 502, `That page returned HTTP ${page.status}, so there are no links to audit.`);
    }
    const readable = lib.extractReadable(page.text, 2000);
    const links = lib.extractLinks(page.text, page.url || href, MAX_LINKS);
    return lib.sendJson(res, 200, {
      url: page.url || href,
      input: raw,
      title: readable.title || '',
      totalLinks: links.length,
      truncated: links.length >= MAX_LINKS,
      links,
    });
  } catch (err) {
    return lib.sendError(res, 500, 'Something went wrong while auditing that page.');
  }
};
