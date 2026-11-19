'use strict';

/**
 * Shared helpers for the REVENANT API functions.
 * Zero dependencies — Node built-ins only. Unit-tested in tests/lib.test.js.
 */

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

const MAX_URL_LENGTH = 2048;
const WAYBACK_AVAILABLE = 'https://archive.org/wayback/available';
const USER_AGENT = 'Revenant/1.0 (dead-link resurrector; +https://github.com/darendrarp/revenant-kiroween)';

/** Anchor years sampled to build a page's life timeline (see design.md §2). */
const TIMELINE_ANCHORS = ['20000101', '20050101', '20100101', '20150101', '20200101', '20250101'];

function isPrivateIPv4(parts) {
  const [a, b] = parts;
  if (a === 10) return true; // 10/8
  if (a === 127) return true; // 127/8 loopback
  if (a === 169 && b === 254) return true; // 169.254/16 link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 0) return true; // 0/8
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
  if (a === 192 && b === 0 && (parts[2] === 0 || parts[2] === 2)) return true; // 192.0.0/24, 192.0.2/24
  if (a === 198 && b === 51 && parts[2] === 100) return true; // 198.51.100/24 TEST-NET-2
  if (a === 203 && b === 0 && parts[2] === 113) return true; // 203.0.113/24 TEST-NET-3
  if (a >= 224) return true; // 224/4 multicast + 240/4 reserved
  return false;
}

function isPublicHostname(hostname) {
  let host = String(hostname || '').toLowerCase();
  if (!host) return false;
  // Node's URL.hostname keeps IPv6 brackets (e.g. "[::1]") — strip them.
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (host === 'localhost' || host.endsWith('.localhost')) return false;
  if (host.endsWith('.local') || host.endsWith('.internal')) return false;
  if (host === '::1' || host === '::') return false;

  // IPv4 literal.
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const parts = v4.slice(1).map(Number);
    if (parts.some((n) => Number.isNaN(n) || n > 255)) return false;
    return !isPrivateIPv4(parts);
  }

  // IPv6 literal (URL.hostname strips brackets).
  if (host.includes(':')) {
    if (host.startsWith('::ffff:')) {
      const embedded = host.slice('::ffff:'.length);
      const m = embedded.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
      if (m) return !isPrivateIPv4(m.slice(1).map(Number));
      return false;
    }
    if (host.startsWith('fe80') || host.startsWith('fc') || host.startsWith('fd')) return false;
    if (host.startsWith('::')) return false;
    return true; // global unicast IPv6
  }

  return true;
}

/**
 * Normalize a user-supplied URL string into a URL object.
 * Assumes https:// when no scheme is present. Throws ValidationError for
 * anything we must not fetch (non-HTTP(S), localhost, private IPs).
 */
function normalizeUrl(input) {
  if (typeof input !== 'string') throw new ValidationError('URL must be a string.');
  const trimmed = input.trim();
  if (!trimmed) throw new ValidationError('Please enter a URL.');
  if (trimmed.length > MAX_URL_LENGTH) throw new ValidationError('That URL is too long (max 2048 characters).');
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    throw new ValidationError('That does not look like a valid URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ValidationError('Only http:// and https:// URLs are supported.');
  }
  if (!url.hostname) throw new ValidationError('That URL has no host.');
  if (!isPublicHostname(url.hostname)) {
    throw new ValidationError('Local and private addresses cannot be checked.');
  }
  return url;
}

/**
 * fetch() with a timeout and an optional response-size cap (enforced while
 * streaming, so oversized bodies are aborted, not buffered).
 * Returns { status, url, text }. Throws on timeout (err.code 'TIMEOUT'),
 * oversize (err.code 'TOO_LARGE'), or network failure.
 */
async function fetchWithTimeout(target, { timeoutMs = 8000, method = 'GET', headers = {}, maxBytes = 0 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(target, {
      method,
      headers: { 'User-Agent': USER_AGENT, ...headers },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (maxBytes > 0 && res.body && typeof res.body.getReader === 'function') {
      const reader = res.body.getReader();
      const chunks = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          try { await reader.cancel(); } catch { /* ignore */ }
          const err = new Error('Response too large');
          err.code = 'TOO_LARGE';
          throw err;
        }
        chunks.push(value);
      }
      const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
      return { status: res.status, url: res.url, text: buf.toString('utf-8') };
    }
    const text = await res.text();
    return { status: res.status, url: res.url, text };
  } catch (err) {
    if (err && err.code === 'TOO_LARGE') throw err;
    if (controller.signal.aborted || (err && err.name === 'AbortError')) {
      const timeout = new Error('Request timed out');
      timeout.code = 'TIMEOUT';
      throw timeout;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Check whether a URL is alive. HEAD first, GET (first byte only) fallback for
 * servers that reject HEAD. Returns { alive, status, finalUrl, ms, error? }.
 * alive = final status 200–399.
 */
async function checkAlive(targetUrl, timeoutMs = 5000) {
  const start = Date.now();
  const finish = (alive, status, finalUrl, error) => ({
    alive,
    status: status || 0,
    finalUrl: finalUrl || targetUrl,
    ms: Date.now() - start,
    ...(error ? { error } : {}),
  });
  // Try HEAD first. 405/501/403 on HEAD are inconclusive (many servers refuse
  // HEAD but serve GET), so fall through to GET. A HEAD timeout means the host
  // is unresponsive — report it instead of spending another timeout on GET.
  try {
    const head = await fetchWithTimeout(targetUrl, { timeoutMs, method: 'HEAD' });
    if (head.status !== 405 && head.status !== 501 && head.status !== 403) {
      return finish(head.status >= 200 && head.status < 400, head.status, head.url || targetUrl);
    }
  } catch (err) {
    if (err && err.code === 'TIMEOUT') return finish(false, 0, targetUrl, 'timeout');
    // Network error on HEAD — one GET retry below, then report 'network'.
  }
  try {
    const get = await fetchWithTimeout(targetUrl, {
      timeoutMs,
      method: 'GET',
      headers: { Range: 'bytes=0-0' },
      maxBytes: 65536,
    });
    return finish(get.status >= 200 && get.status < 400, get.status, get.url || targetUrl);
  } catch (err2) {
    if (err2 && err2.code === 'TIMEOUT') return finish(false, 0, targetUrl, 'timeout');
    return finish(false, 0, targetUrl, 'network');
  }
}

/**
 * Closest Wayback Machine snapshot for a URL (optionally near a timestamp
 * `YYYYMMDD...`). Returns { available, url?, timestamp?, status? } or
 * { available: false, error?: 'timeout' | 'archive_unreachable' }.
 * Never throws for upstream failures — callers degrade gracefully.
 */
async function waybackClosest(targetUrl, { timestamp = null, timeoutMs = 6000 } = {}) {
  const apiUrl = new URL(WAYBACK_AVAILABLE);
  apiUrl.searchParams.set('url', targetUrl);
  if (timestamp) apiUrl.searchParams.set('timestamp', timestamp);
  try {
    const { text } = await fetchWithTimeout(apiUrl.href, { timeoutMs, maxBytes: 65536 });
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return { available: false, error: 'archive_unreachable' };
    }
    const closest = data && data.archived_snapshots && data.archived_snapshots.closest;
    if (closest && closest.available && closest.url && closest.timestamp) {
      return {
        available: true,
        url: String(closest.url).replace(/^http:\/\//, 'https://'),
        timestamp: String(closest.timestamp),
        status: closest.status || '200',
      };
    }
    return { available: false };
  } catch (err) {
    if (err && err.code === 'TIMEOUT') return { available: false, error: 'timeout' };
    return { available: false, error: 'archive_unreachable' };
  }
}

/**
 * Sample the page's life at anchor years via the availability API (the CDX API
 * proved unreliable from serverless regions). Returns
 * { points: [{year, timestamp, url}], complete } — partial on timeouts.
 */
async function waybackTimeline(targetUrl, timeoutMs = 6000) {
  const results = await Promise.allSettled(
    TIMELINE_ANCHORS.map((anchor) => waybackClosest(targetUrl, { timestamp: anchor, timeoutMs })),
  );
  const byYear = new Map();
  let complete = true;
  for (const r of results) {
    if (r.status !== 'fulfilled') { complete = false; continue; }
    const v = r.value;
    if (v.error) complete = false;
    if (v.available && v.timestamp) {
      const year = parseYear(v.timestamp);
      if (year && !byYear.has(year)) byYear.set(year, { year, timestamp: v.timestamp, url: v.url });
    }
  }
  const points = [...byYear.values()].sort((a, b) => a.year - b.year);
  return { points, complete };
}

function parseYear(timestamp) {
  const m = /^(\d{4})/.exec(String(timestamp || ''));
  if (!m) return null;
  const year = Number(m[1]);
  return year >= 1996 && year <= 2100 ? year : null;
}

function formatSnapshotDate(timestamp) {
  const s = String(timestamp || '');
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(s);
  if (!m) return s || 'unknown date';
  const [, y, mo, d, h, mi] = m;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[Number(mo) - 1] || mo;
  return `${Number(d)} ${month} ${y}, ${h}:${mi} UTC`;
}

function tombstoneFromTimeline(points) {
  if (!points || points.length === 0) return null;
  return { born: points[0].year, died: points[points.length - 1].year };
}

function decodeEntities(s) {
  return String(s || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n);
      return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
    });
}

function stripTags(s) {
  return decodeEntities(String(s || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/**
 * Extract outbound links from HTML. Resolves relative URLs, de-duplicates,
 * marks internal vs external, caps at `limit`. Never throws on bad HTML.
 */
function extractLinks(html, baseUrl, limit = 60) {
  const out = [];
  const seen = new Set();
  let base;
  try {
    base = new URL(baseUrl);
  } catch {
    return out;
  }
  const re = /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+))/gi;
  let m;
  while ((m = re.exec(String(html || ''))) !== null && out.length < limit) {
    const raw = (m[1] ?? m[2] ?? m[3] ?? '').trim();
    if (!raw || raw.startsWith('#')) continue;
    const lower = raw.toLowerCase();
    if (lower.startsWith('javascript:') || lower.startsWith('mailto:') || lower.startsWith('tel:') || lower.startsWith('data:')) continue;
    let resolved;
    try {
      resolved = new URL(raw, base);
    } catch {
      continue;
    }
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') continue;
    resolved.hash = '';
    const href = resolved.href;
    if (seen.has(href)) continue;
    seen.add(href);
    out.push({ url: href, internal: resolved.hostname === base.hostname });
  }
  return out;
}

/**
 * Reduce snapshot HTML to readable text. Strips scripts, styles, nav/header/
 * footer chrome; keeps title, headings, paragraphs. Also detects a
 * meta-refresh redirect (common for dead-site snapshots that bounce to a
 * successor page) and returns it as `redirect`. Never throws on bad HTML.
 */
function extractReadable(html, maxChars = 20000, baseUrl = null) {
  const src = String(html || '');
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(src);
  const title = titleMatch ? stripTags(titleMatch[1]).slice(0, 300) : '';
  // Meta-refresh redirect: scan each <meta> tag (attribute order varies).
  let redirect = null;
  const metaRe = /<meta\b[^>]*>/gi;
  let mm;
  while ((mm = metaRe.exec(src)) !== null && !redirect) {
    const tag = mm[0];
    if (!/http-equiv\s*=\s*["']?refresh["']?/i.test(tag)) continue;
    const content = /content\s*=\s*["']([^"']*)["']/i.exec(tag);
    const urlPart = content && /url\s*=\s*([^\s"']+)/i.exec(content[1]);
    if (urlPart) {
      try {
        redirect = baseUrl ? new URL(urlPart[1], baseUrl).href : urlPart[1];
      } catch {
        redirect = urlPart[1];
      }
    }
  }
  let body = src
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ');
  const headings = [];
  const hRe = /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi;
  let hm;
  while ((hm = hRe.exec(body)) !== null && headings.length < 20) {
    const h = stripTags(hm[1]);
    if (h) headings.push(h.slice(0, 200));
  }
  const paras = [];
  const pRe = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  let pm;
  while ((pm = pRe.exec(body)) !== null) {
    const p = stripTags(pm[1]);
    if (p.length > 1) paras.push(p);
  }
  let text = paras.join('\n\n');
  if (!text) {
    const bodyMatch = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(body);
    text = stripTags(bodyMatch ? bodyMatch[1] : body);
  }
  text = text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  const truncated = text.length > maxChars;
  if (truncated) text = text.slice(0, maxChars);
  return { title, headings, text, truncated, redirect };
}

/** Read a JSON request body with a size cap (for POST endpoints). */
function readJsonBody(req, maxBytes = 65536) {
  return new Promise((resolve, reject) => {
    if (req.body && typeof req.body === 'object') return resolve(req.body);
    if (typeof req.body === 'string') {
      try { return resolve(JSON.parse(req.body)); } catch { return reject(new ValidationError('Request body is not valid JSON.')); }
    }
    const chunks = [];
    let total = 0;
    let failed = false;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes && !failed) {
        failed = true;
        reject(new ValidationError('Request body is too large.'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (failed) return;
      const raw = Buffer.concat(chunks).toString('utf-8');
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new ValidationError('Request body is not valid JSON.'));
      }
    });
    req.on('error', () => reject(new ValidationError('Could not read the request body.')));
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(body);
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

module.exports = {
  ValidationError,
  TIMELINE_ANCHORS,
  normalizeUrl,
  isPublicHostname,
  fetchWithTimeout,
  checkAlive,
  waybackClosest,
  waybackTimeline,
  parseYear,
  formatSnapshotDate,
  tombstoneFromTimeline,
  extractLinks,
  extractReadable,
  readJsonBody,
  sendJson,
  sendError,
};
