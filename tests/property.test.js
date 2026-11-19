'use strict';

/**
 * Property-style tests with generated inputs (seeded PRNG, deterministic).
 * These are the "property-based testing" leg of the Kiro spec: instead of a
 * handful of examples, we assert invariants over hundreds of generated cases.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const lib = require('../api/_lib');

// Deterministic PRNG (mulberry32) so the suite is reproducible.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20261119);
function pick(arr) { return arr[Math.floor(rand() * arr.length)]; }
function randomString(len) {
  const chars = 'abcXYZ019-._~:/?#[]@!$&\'()*+,;=%<>^`|{ }';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(rand() * chars.length)];
  return s;
}

test('property: normalizeUrl never throws a non-ValidationError on arbitrary strings', () => {
  const schemes = ['', 'http://', 'https://', 'ftp://', 'HTTP://', 'java\tscript:', '://', 'http:/', 'https:'];
  const hosts = ['example.com', 'localhost', '127.0.0.1', '10.1.2.3', '192.168.0.1', 'a', 'exa mple.com', '[::1]', '8.8.8.8', 'sub.domain.co', ''];
  const tails = ['', '/', '/path', '/a?b=c&d=e', '#frag', ':8080/x', '/%20', '/ünicode'];
  for (let i = 0; i < 600; i++) {
    const input = Math.random() < 0.3
      ? randomString(Math.floor(rand() * 60))
      : pick(schemes) + pick(hosts) + pick(tails);
    try {
      const url = lib.normalizeUrl(input);
      // Invariant: a returned URL is always fetchable by our rules.
      assert.ok(url.protocol === 'http:' || url.protocol === 'https:');
      assert.ok(lib.isPublicHostname(url.hostname), `hostname must be public: ${url.hostname}`);
      assert.ok(url.href.length <= 2048);
    } catch (err) {
      // Invariant: the ONLY failure mode is a ValidationError with a message.
      assert.ok(err instanceof lib.ValidationError, `unexpected error for ${JSON.stringify(input)}: ${err}`);
      assert.ok(typeof err.message === 'string' && err.message.length > 0);
    }
  }
});

test('property: extractLinks never crashes and only returns valid, unique HTTP(S) URLs', () => {
  const hrefs = [
    '/rel', 'rel2', '../up', 'https://ok.com/a', 'http://ok.com/b', 'https://ok.com/a',
    'mailto:a@b.c', 'javascript:x', '#frag', '', 'ftp://x.com/', 'data:text/html,x',
    'https://ok.com/a?x=1&y=2', 'https://ok.com/a#hash', '//protocol-relative.com/p',
    'https://sub.ok.com/', 'not a url at all', 'https://', 'http://[::1]/',
  ];
  for (let i = 0; i < 250; i++) {
    const n = Math.floor(rand() * 12);
    let html = '<html><body>';
    for (let j = 0; j < n; j++) {
      const q = pick(['"', "'", '']);
      const href = pick(hrefs);
      html += `<a href=${q}${href}${q}>x</a>`;
      if (rand() < 0.3) html += randomString(10); // noise between tags
    }
    html += '</body></html>';
    const links = lib.extractLinks(html, 'https://base.example/dir/page', 60);
    assert.ok(Array.isArray(links));
    assert.ok(links.length <= 60);
    const seen = new Set();
    for (const link of links) {
      const u = new URL(link.url); // must parse
      assert.ok(u.protocol === 'http:' || u.protocol === 'https:');
      assert.ok(!u.hash, 'fragments are stripped');
      assert.ok(!seen.has(link.url), 'no duplicates');
      seen.add(link.url);
      assert.equal(typeof link.internal, 'boolean');
    }
  }
});

test('property: extractReadable never crashes and returns collapsed, bounded text', () => {
  const fragments = [
    '<p>hello   world</p>', '<script>var a=1;</script>', '<style>p{}</style>',
    '<h1>Title &amp; stuff</h1>', '<p></p>', '<div><p>nested</p></div>',
    '<!-- comment -->', '<p>unclosed', 'plain text', '<svg><circle/></svg>',
    '<p>&lt;tag&gt; &quot;quoted&quot; &#65;</p>', '<nav>nav text</nav>',
    '<title>Doc Title</title>', '<p>' + 'word '.repeat(50) + '</p>',
  ];
  for (let i = 0; i < 250; i++) {
    let html = '<html><body>';
    const n = Math.floor(rand() * 8);
    for (let j = 0; j < n; j++) html += pick(fragments);
    html += '</body></html>';
    const out = lib.extractReadable(html, 500);
    assert.equal(typeof out.title, 'string');
    assert.ok(Array.isArray(out.headings));
    assert.equal(typeof out.text, 'string');
    assert.ok(out.text.length <= 500, 'text respects maxChars');
    assert.doesNotMatch(out.text, /  /, 'no double spaces survive collapsing');
    assert.doesNotMatch(out.text, /\n\n\n/, 'no triple newlines survive collapsing');
    assert.doesNotMatch(out.text, /var a=1|nav text/, 'script/nav content is stripped');
  }
});

test('property: formatSnapshotDate round-trips every generated timestamp', () => {
  for (let i = 0; i < 200; i++) {
    const y = 1996 + Math.floor(rand() * 31);
    const mo = String(1 + Math.floor(rand() * 12)).padStart(2, '0');
    const d = String(1 + Math.floor(rand() * 28)).padStart(2, '0');
    const h = String(Math.floor(rand() * 24)).padStart(2, '0');
    const mi = String(Math.floor(rand() * 60)).padStart(2, '0');
    const ts = `${y}${mo}${d}${h}${mi}00`;
    const formatted = lib.formatSnapshotDate(ts);
    assert.ok(formatted.includes(String(y)), `${ts} -> ${formatted}`);
    assert.ok(formatted.includes('UTC'));
    assert.equal(lib.parseYear(ts), y);
  }
});
