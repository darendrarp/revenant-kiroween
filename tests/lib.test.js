'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const lib = require('../api/_lib');

test('normalizeUrl: adds https:// when no scheme is present', () => {
  assert.equal(lib.normalizeUrl('example.com').href, 'https://example.com/');
  assert.equal(lib.normalizeUrl('  geocities.com/foo  ').href, 'https://geocities.com/foo');
});

test('normalizeUrl: keeps explicit http/https and path/query', () => {
  assert.equal(lib.normalizeUrl('http://example.com/a?b=1').href, 'http://example.com/a?b=1');
  assert.equal(lib.normalizeUrl('https://en.wikipedia.org/wiki/Link_rot').hostname, 'en.wikipedia.org');
});

test('normalizeUrl: rejects non-HTTP(S) schemes', () => {
  for (const bad of ['ftp://example.com', 'file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,hi']) {
    assert.throws(() => lib.normalizeUrl(bad), lib.ValidationError, bad);
  }
});

test('normalizeUrl: rejects localhost and private addresses', () => {
  for (const bad of [
    'localhost', 'http://localhost:3000/admin', 'http://127.0.0.1/', 'http://10.0.0.5/',
    'http://172.16.0.1/', 'http://172.31.255.255/', 'http://192.168.1.1/',
    'http://169.254.169.254/latest/meta-data/', 'http://[::1]/', 'http://[fe80::1]/',
    'http://myprinter.local/', 'http://service.internal/',
  ]) {
    assert.throws(() => lib.normalizeUrl(bad), lib.ValidationError, bad);
  }
});

test('normalizeUrl: accepts public IPs and normal hosts', () => {
  assert.equal(lib.normalizeUrl('http://8.8.8.8/').hostname, '8.8.8.8');
  assert.equal(lib.normalizeUrl('http://93.184.216.34/').hostname, '93.184.216.34');
  assert.equal(lib.normalizeUrl('https://sub.example.co.uk/').hostname, 'sub.example.co.uk');
});

test('normalizeUrl: rejects empty, non-string, and over-long input', () => {
  assert.throws(() => lib.normalizeUrl(''), lib.ValidationError);
  assert.throws(() => lib.normalizeUrl('   '), lib.ValidationError);
  assert.throws(() => lib.normalizeUrl(42), lib.ValidationError);
  assert.throws(() => lib.normalizeUrl(null), lib.ValidationError);
  assert.throws(() => lib.normalizeUrl(`https://example.com/${'a'.repeat(3000)}`), lib.ValidationError);
  assert.throws(() => lib.normalizeUrl('https://'), lib.ValidationError);
});

test('isPublicHostname: boundary cases', () => {
  assert.equal(lib.isPublicHostname('example.com'), true);
  assert.equal(lib.isPublicHostname('172.15.0.1'), true); // just below 172.16/12
  assert.equal(lib.isPublicHostname('172.32.0.1'), true); // just above 172.16/12
  assert.equal(lib.isPublicHostname('192.167.1.1'), true);
  assert.equal(lib.isPublicHostname('100.63.0.1'), true);
  assert.equal(lib.isPublicHostname('100.64.0.1'), false); // CGNAT
  assert.equal(lib.isPublicHostname(''), false);
});

test('extractLinks: resolves relative URLs and marks internal/external', () => {
  const html = '<a href="/about">a</a><a href="https://other.com/x">b</a><a href="page2">c</a>';
  const links = lib.extractLinks(html, 'https://example.com/blog/post', 10);
  assert.deepEqual(links, [
    { url: 'https://example.com/about', internal: true },
    { url: 'https://other.com/x', internal: false },
    { url: 'https://example.com/blog/page2', internal: true },
  ]);
});

test('extractLinks: filters junk schemes, fragments, and duplicates; honors cap', () => {
  const html = [
    '<a href="https://a.com/1">1</a>',
    '<a href="https://a.com/1#frag">dup</a>',
    "<a href='mailto:x@y.com'>mail</a>",
    '<a href="javascript:void(0)">js</a>',
    '<a href="#top">frag</a>',
    '<a href="https://a.com/2">2</a>',
    '<a href="https://a.com/3">3</a>',
  ].join('');
  const links = lib.extractLinks(html, 'https://example.com/', 2);
  assert.equal(links.length, 2);
  assert.equal(links[0].url, 'https://a.com/1');
  assert.equal(links[1].url, 'https://a.com/2');
});

test('extractLinks: never throws on malformed HTML or bad base', () => {
  assert.deepEqual(lib.extractLinks('<a href="', 'https://example.com/'), []);
  assert.deepEqual(lib.extractLinks('<a href="https://x.com/">x', 'not a url'), []);
  assert.deepEqual(lib.extractLinks(null, 'https://example.com/'), []);
});

test('extractReadable: strips scripts/styles/nav and keeps readable text', () => {
  const html = `<html><head><title>Old &amp; Gold</title><style>.x{color:red}</style>
    <script>var evil = 1;</script></head><body>
    <nav><a href="/">home</a></nav>
    <h1>Welcome back</h1><h2>Section</h2>
    <p>First paragraph.</p><p>Second &lt;paragraph&gt;.</p>
    <footer>copyright</footer></body></html>`;
  const out = lib.extractReadable(html);
  assert.equal(out.title, 'Old & Gold');
  assert.deepEqual(out.headings, ['Welcome back', 'Section']);
  assert.match(out.text, /First paragraph\./);
  assert.match(out.text, /Second <paragraph>\./);
  assert.doesNotMatch(out.text, /evil|color:red|home|copyright/);
  assert.equal(out.truncated, false);
});

test('extractReadable: falls back to body text when there are no paragraphs', () => {
  const out = lib.extractReadable('<html><body><div>Just some text</div></body></html>');
  assert.equal(out.text, 'Just some text');
});

test('extractReadable: truncates long text and flags it', () => {
  const out = lib.extractReadable(`<p>${'word '.repeat(5000)}</p>`, 100);
  assert.equal(out.text.length, 100);
  assert.equal(out.truncated, true);
});

test('parseYear / formatSnapshotDate / tombstoneFromTimeline', () => {
  assert.equal(lib.parseYear('20261118082138'), 2026);
  assert.equal(lib.parseYear('19961001000000'), 1996);
  assert.equal(lib.parseYear('19951001000000'), null); // archiving began in 1996
  assert.equal(lib.parseYear('garbage'), null);
  assert.equal(lib.parseYear(''), null);
  assert.equal(lib.formatSnapshotDate('20261118082138'), '18 Nov 2026, 08:21 UTC');
  assert.equal(lib.formatSnapshotDate('bogus'), 'bogus');
  assert.deepEqual(lib.tombstoneFromTimeline([
    { year: 1997 }, { year: 2005 }, { year: 2009 },
  ]), { born: 1997, died: 2009 });
  assert.equal(lib.tombstoneFromTimeline([]), null);
});
