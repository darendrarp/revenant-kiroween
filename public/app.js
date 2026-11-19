/* REVENANT frontend — vanilla JS, no framework. */
(function () {
  'use strict';

  var API_TIMEOUT_MS = 12000;
  var CHECK_CHUNK = 12;
  var GRAVEYARD_KEY = 'revenant-graveyard';
  var GRAVEYARD_MAX = 100;

  function $(sel) { return document.querySelector(sel); }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function domainOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return url; }
  }

  function showToast(msg) {
    var toast = $('#toast');
    toast.textContent = msg;
    toast.hidden = false;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { toast.hidden = true; }, 2600);
  }

  function copyText(text, label) {
    function done() { showToast(label + ' copied to clipboard'); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text, done); });
    } else {
      fallbackCopy(text, done);
    }
  }

  function fallbackCopy(text, done) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { showToast('Copy failed — long-press to copy'); }
    document.body.removeChild(ta);
  }

  /* ---------- API helpers ---------- */

  function fetchJson(url, options) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, API_TIMEOUT_MS);
    var opts = Object.assign({}, options || {}, { signal: controller.signal });
    return fetch(url, opts)
      .then(function (res) {
        return res.text().then(function (text) {
          var data = null;
          try { data = JSON.parse(text); } catch (e) { /* non-JSON error page */ }
          if (!res.ok) {
            var err = new Error((data && data.error) || ('Request failed (HTTP ' + res.status + ')'));
            err.status = res.status;
            throw err;
          }
          return data;
        });
      })
      .catch(function (err) {
        if (err && err.name === 'AbortError') throw new Error('The request timed out. The archive can be slow — please try again.');
        throw err;
      })
      .finally(function () { clearTimeout(timer); });
  }

  function loadingHtml(msg) {
    return '<div class="loading"><div class="spinner" aria-hidden="true"></div><span>' + escapeHtml(msg) + '</span></div>';
  }

  function errorHtml(msg) {
    return '<div class="error-box" role="alert">' + escapeHtml(msg) + '</div>';
  }

  /* ---------- Tabs ---------- */

  var tabs = Array.prototype.slice.call(document.querySelectorAll('.tab'));
  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () { switchTab(tab.getAttribute('data-tab')); });
  });

  function switchTab(name) {
    tabs.forEach(function (tab) {
      var active = tab.getAttribute('data-tab') === name;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    Array.prototype.slice.call(document.querySelectorAll('.tab-panel')).forEach(function (panel) {
      var active = panel.id === 'panel-' + name;
      panel.classList.toggle('active', active);
      panel.hidden = !active;
    });
  }

  /* ---------- Graveyard (localStorage) ---------- */

  function loadGraveyard() {
    try {
      var raw = localStorage.getItem(GRAVEYARD_KEY);
      var list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) { return []; }
  }

  function saveGraveyard(list) {
    try { localStorage.setItem(GRAVEYARD_KEY, JSON.stringify(list.slice(0, GRAVEYARD_MAX))); } catch (e) { /* storage unavailable — history just won't persist */ }
  }

  function addToGraveyard(entry) {
    var list = loadGraveyard().filter(function (e) { return e.url !== entry.url; });
    list.unshift(entry);
    saveGraveyard(list);
    renderGraveyard();
  }

  function removeFromGraveyard(url) {
    saveGraveyard(loadGraveyard().filter(function (e) { return e.url !== url; }));
    renderGraveyard();
  }

  function renderGraveyard() {
    var list = loadGraveyard();
    var listEl = $('#graveyard-list');
    var emptyEl = $('#graveyard-empty');
    $('#stat-revived').textContent = list.length + (list.length === 1 ? ' soul revived' : ' souls revived');
    emptyEl.style.display = list.length ? 'none' : '';
    listEl.innerHTML = list.map(function (e) {
      return '<article class="grave">' +
        '<p class="grave-domain">' + escapeHtml(domainOf(e.url)) + '</p>' +
        '<p class="grave-date">Captured ' + escapeHtml(e.date || 'unknown date') + '</p>' +
        '<p class="grave-meta">Revived ' + escapeHtml(new Date(e.revivedAt).toLocaleDateString()) + '</p>' +
        '<div class="grave-actions">' +
        '<button class="mini-btn" type="button" data-view="' + escapeHtml(e.snapshotUrl) + '">View</button>' +
        '<button class="mini-btn" type="button" data-revive="' + escapeHtml(e.url) + '">Revive again</button>' +
        '<button class="mini-btn" type="button" data-bury="' + escapeHtml(e.url) + '">Bury</button>' +
        '</div></article>';
    }).join('');
  }

  $('#graveyard-list').addEventListener('click', function (ev) {
    var btn = ev.target.closest('button');
    if (!btn) return;
    if (btn.hasAttribute('data-bury')) { removeFromGraveyard(btn.getAttribute('data-bury')); return; }
    if (btn.hasAttribute('data-view')) { openViewer(btn.getAttribute('data-view')); return; }
    if (btn.hasAttribute('data-revive')) {
      switchTab('resurrect');
      $('#resurrect-input').value = btn.getAttribute('data-revive');
      resurrect(btn.getAttribute('data-revive'));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });

  $('#graveyard-clear').addEventListener('click', function () {
    if (!loadGraveyard().length) return;
    if (window.confirm('Bury every soul in the graveyard? This cannot be undone.')) {
      saveGraveyard([]);
      renderGraveyard();
      showToast('The graveyard is empty again');
    }
  });

  /* ---------- Modals ---------- */

  function openModal(id) {
    var modal = $(id);
    modal.hidden = false;
    var closeBtn = modal.querySelector('[data-close]');
    if (closeBtn) closeBtn.focus();
  }

  function closeModal(modal) {
    modal.hidden = true;
    if (modal.id === 'viewer-modal') $('#viewer-frame').removeAttribute('src');
  }

  document.querySelectorAll('.modal').forEach(function (modal) {
    modal.addEventListener('click', function (ev) {
      if (ev.target.closest('[data-close]')) closeModal(modal);
    });
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') {
      document.querySelectorAll('.modal').forEach(function (m) { if (!m.hidden) closeModal(m); });
    }
  });

  function openViewer(snapshotUrl) {
    $('#viewer-sub').innerHTML = 'Snapshot: <a href="' + escapeHtml(snapshotUrl) + '" target="_blank" rel="noopener">' + escapeHtml(snapshotUrl) + '</a>';
    $('#viewer-frame').setAttribute('src', snapshotUrl);
    openModal('#viewer-modal');
  }

  function openReader(snapshotUrl, btn) {
    var body = $('#reader-body');
    body.innerHTML = loadingHtml('Reading the snapshot…');
    openModal('#reader-modal');
    if (btn) btn.disabled = true;
    fetchJson('/api/extract?url=' + encodeURIComponent(snapshotUrl))
      .then(function (data) {
        var html = '';
        if (data.redirect) {
          html += '<div class="note-box" style="margin:0 0 14px">This snapshot immediately redirects to ' +
            '<a href="' + escapeHtml(data.redirect) + '" target="_blank" rel="noopener">' + escapeHtml(data.redirect) + '</a>.' +
            ' <button class="mini-btn" type="button" id="reader-follow">Open the redirect in the viewer</button></div>';
        }
        if (data.title) html += '<p class="reader-title">' + escapeHtml(data.title) + '</p>';
        if (data.headings && data.headings.length) {
          html += data.headings.slice(0, 5).map(function (h) { return '<h4>' + escapeHtml(h) + '</h4>'; }).join('');
        }
        var paras = (data.text || '').split(/\n\n+/).filter(Boolean);
        html += paras.length
          ? paras.map(function (p) { return '<p>' + escapeHtml(p) + '</p>'; }).join('')
          : '<p>No readable text could be extracted from this snapshot. Try the full snapshot view instead.</p>';
        if (data.truncated) html += '<p><em>Text truncated at 20,000 characters.</em></p>';
        body.innerHTML = html;
        var followBtn = document.getElementById('reader-follow');
        if (followBtn && data.redirect) {
          followBtn.addEventListener('click', function () {
            closeModal(document.getElementById('reader-modal'));
            openViewer(data.redirect);
          });
        }
      })
      .catch(function (err) {
        body.innerHTML = errorHtml(err.message || 'Could not read that snapshot.');
      })
      .finally(function () { if (btn) btn.disabled = false; });
  }

  /* ---------- Resurrect ---------- */

  var resurrectResult = $('#resurrect-result');

  function causeOfDeath(data) {
    if (data.alive) return 'Still alive — checked ' + (data.checkedMs || 0) + 'ms ago';
    if (data.checkError === 'timeout') return 'Cause of death: stopped responding (timeout)';
    if (data.checkError === 'network') return 'Cause of death: unreachable (DNS / connection failed)';
    if (data.status) return 'Cause of death: HTTP ' + data.status;
    return 'Cause of death: unknown';
  }

  function renderResurrect(data) {
    var html = '';
    var host = domainOf(data.url);

    if (data.alive) {
      html += '<div class="tombstone alive">' +
        '<p class="tomb-domain">' + escapeHtml(host) + '</p>' +
        '<p class="tomb-years">STILL ALIVE</p>' +
        '<p class="tomb-cause">HTTP ' + (data.status || '?') + ' · responded in ' + (data.checkedMs || 0) + 'ms · no resurrection needed</p>';
      if (data.snapshot) {
        html += '<p class="tomb-snapshot">The archive still keeps a snapshot from <strong>' + escapeHtml(data.snapshot.date) + '</strong> — for the day it dies.</p>' +
          '<div class="tomb-actions">' +
          '<button class="btn btn-ghost" type="button" data-view="' + escapeHtml(data.snapshot.url) + '">View snapshot</button>' +
          '<button class="btn btn-ghost" type="button" data-read="' + escapeHtml(data.snapshot.url) + '">Reader view</button>' +
          '</div>';
      }
      html += '</div>';
      resurrectResult.innerHTML = html;
      wireResultButtons(resurrectResult, data);
      return;
    }

    if (!data.snapshot) {
      html += '<div class="tombstone">' +
        '<p class="tomb-domain">' + escapeHtml(host) + '</p>' +
        '<p class="tomb-years">LOST FOREVER?</p>' +
        '<p class="tomb-cause">' + escapeHtml(causeOfDeath(data)) + '</p>' +
        '<p class="tomb-snapshot">The Wayback Machine holds no snapshot of this URL' +
        (data.archiveError ? ' — and the archive lookup itself failed (' + escapeHtml(data.archiveError) + '). Try again in a moment.' : '.') + '</p>' +
        '<p class="tomb-snapshot">If you know a snapshot exists under a different URL (http vs https, www vs bare), try that address.</p>' +
        '</div>';
      resurrectResult.innerHTML = html;
      return;
    }

    var years = data.tombstone ? (data.tombstone.born + ' — ' + data.tombstone.died) : 'R.I.P.';
    html += '<div class="tombstone">' +
      '<p class="tomb-domain">' + escapeHtml(host) + '</p>' +
      '<p class="tomb-years">' + escapeHtml(years) + '</p>' +
      '<p class="tomb-cause">' + escapeHtml(causeOfDeath(data)) + '</p>' +
      '<p class="tomb-snapshot">Resurrected from <strong>' + escapeHtml(data.snapshot.date) + '</strong> via the Wayback Machine.</p>' +
      '<div class="tomb-actions">' +
      '<button class="btn btn-primary" type="button" data-view="' + escapeHtml(data.snapshot.url) + '">View resurrected page</button>' +
      '<button class="btn btn-ghost" type="button" data-read="' + escapeHtml(data.snapshot.url) + '">Reader view</button>' +
      '<button class="btn btn-ghost" type="button" data-share>Copy share link</button>' +
      '</div>';

    if (data.timeline && data.timeline.length > 1) {
      html += '<div class="timeline"><p class="timeline-label">Its life, year by year</p>' +
        data.timeline.map(function (p) {
          return '<a class="year-chip" href="' + escapeHtml(p.url) + '" target="_blank" rel="noopener">' + escapeHtml(String(p.year)) + '</a>';
        }).join('') + '</div>';
    }
    html += '</div>';

    if (!data.timelineComplete) {
      html += '<div class="note-box">The archive was slow, so the timeline above is partial — some years could not be fetched in time.</div>';
    }
    if (data.archiveError) {
      html += '<div class="note-box">Note: part of the archive lookup failed (' + escapeHtml(data.archiveError) + '). What you see is what could be verified.</div>';
    }
    resurrectResult.innerHTML = html;
    wireResultButtons(resurrectResult, data);

    addToGraveyard({
      url: data.url,
      snapshotUrl: data.snapshot.url,
      date: data.snapshot.date,
      revivedAt: new Date().toISOString(),
    });
  }

  function wireResultButtons(container, data) {
    container.querySelectorAll('[data-view]').forEach(function (btn) {
      btn.addEventListener('click', function () { openViewer(btn.getAttribute('data-view')); });
    });
    container.querySelectorAll('[data-read]').forEach(function (btn) {
      btn.addEventListener('click', function () { openReader(btn.getAttribute('data-read'), btn); });
    });
    container.querySelectorAll('[data-share]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var share = window.location.origin + window.location.pathname + '#r=' + encodeURIComponent(data.url);
        copyText(share, 'Share link');
      });
    });
  }

  function resurrect(url) {
    var btn = $('#resurrect-btn');
    btn.disabled = true;
    resurrectResult.innerHTML = loadingHtml('Checking the pulse, then digging through the archive…');
    return fetchJson('/api/resurrect?url=' + encodeURIComponent(url))
      .then(renderResurrect)
      .catch(function (err) { resurrectResult.innerHTML = errorHtml(err.message || 'Something went wrong.'); })
      .finally(function () { btn.disabled = false; });
  }

  $('#resurrect-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var url = $('#resurrect-input').value.trim();
    if (url) resurrect(url);
  });

  document.querySelectorAll('.demo-chip').forEach(function (chip) {
    chip.addEventListener('click', function () {
      var url = chip.getAttribute('data-url');
      $('#resurrect-input').value = url;
      resurrect(url);
    });
  });

  /* ---------- Audit ---------- */

  var auditResult = $('#audit-result');

  function auditRow(item, result) {
    var status = result
      ? (result.alive
        ? '<span class="dot alive"></span><span class="badge alive">HTTP ' + (result.status || '?') + '</span>'
        : '<span class="dot dead"></span><span class="badge dead">' + (result.status ? 'HTTP ' + result.status : (result.error || 'dead')) + '</span>')
      : '<span class="dot unknown"></span><span class="badge">…</span>';
    var resurrectBtn = (result && !result.alive && result.snapshot)
      ? '<button class="mini-btn" type="button" data-view="' + escapeHtml(result.snapshot.url) + '">Resurrect</button>'
      : '';
    var internal = item.internal ? '<span class="badge internal">internal</span>' : '';
    return '<li class="link-row">' + status +
      '<span class="url"><a href="' + escapeHtml(item.url) + '" target="_blank" rel="noopener">' + escapeHtml(item.url) + '</a></span>' +
      internal + resurrectBtn + '</li>';
  }

  $('#audit-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var url = $('#audit-input').value.trim();
    if (!url) return;
    var btn = $('#audit-btn');
    btn.disabled = true;
    auditResult.innerHTML = loadingHtml('Fetching the page and digging out its links…');

    fetchJson('/api/audit?url=' + encodeURIComponent(url))
      .then(function (data) {
        if (!data.links.length) {
          auditResult.innerHTML = '<div class="error-box">No outbound links found on that page' +
            (data.title ? ' (“' + escapeHtml(data.title) + '”)' : '') + '.</div>';
          return null;
        }
        auditResult.innerHTML =
          '<div class="summary-bar"><span class="big">Checking <span id="audit-count">0</span> / ' + data.links.length + ' links…</span>' +
          '<span>' + escapeHtml(data.title || domainOf(data.url)) + '</span></div>' +
          '<div class="progress"><div id="audit-progress"></div></div>' +
          '<ul class="link-list" id="audit-list">' + data.links.map(function (l) { return auditRow(l, null); }).join('') + '</ul>';
        auditResult.querySelectorAll('[data-view]').forEach(function (b) {
          b.addEventListener('click', function () { openViewer(b.getAttribute('data-view')); });
        });

        var results = new Array(data.links.length);
        var done = 0;
        var chunks = [];
        for (var i = 0; i < data.links.length; i += CHECK_CHUNK) chunks.push(data.links.slice(i, i + CHECK_CHUNK));

        function runChunk(index) {
          if (index >= chunks.length) return Promise.resolve();
          var chunk = chunks[index];
          var startIdx = index * CHECK_CHUNK;
          return fetchJson('/api/check', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ urls: chunk.map(function (l) { return l.url; }) }),
          }).then(function (resp) {
            resp.results.forEach(function (r, j) { results[startIdx + j] = r; });
          }).catch(function () {
            chunk.forEach(function (l, j) { results[startIdx + j] = { url: l.url, alive: false, status: 0, error: 'check failed' }; });
          }).then(function () {
            done += chunk.length;
            $('#audit-count').textContent = String(Math.min(done, data.links.length));
            $('#audit-progress').style.width = Math.round((done / data.links.length) * 100) + '%';
            var listEl = $('#audit-list');
            listEl.innerHTML = data.links.map(function (l, k) { return auditRow(l, results[k] || null); }).join('');
            listEl.querySelectorAll('[data-view]').forEach(function (b) {
              b.addEventListener('click', function () { openViewer(b.getAttribute('data-view')); });
            });
            return runChunk(index + 1);
          });
        }

        return runChunk(0).then(function () {
          var dead = results.filter(function (r) { return r && !r.alive; }).length;
          var alive = results.length - dead;
          var pct = results.length ? Math.round((dead / results.length) * 100) : 0;
          var summary = auditResult.querySelector('.summary-bar');
          summary.innerHTML = '<span class="big"><span class="dead">' + dead + ' dead</span> · <span class="alive">' + alive + ' alive</span></span>' +
            '<span>' + pct + '% link rot across ' + results.length + ' links' +
            (data.truncated ? ' (first 60 links only)' : '') + '</span>';
        });
      })
      .catch(function (err) { auditResult.innerHTML = errorHtml(err.message || 'Something went wrong.'); })
      .finally(function () { btn.disabled = false; });
  });

  /* ---------- Bulk ---------- */

  var bulkResult = $('#bulk-result');

  $('#bulk-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var lines = $('#bulk-input').value.split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
    var urls = [];
    var seen = {};
    lines.forEach(function (u) { if (!seen[u]) { seen[u] = true; urls.push(u); } });
    if (!urls.length) { bulkResult.innerHTML = errorHtml('Paste at least one URL.'); return; }
    if (urls.length > 25) { bulkResult.innerHTML = errorHtml('Too many URLs — max 25 at a time. You pasted ' + urls.length + '.'); return; }

    var btn = $('#bulk-btn');
    btn.disabled = true;
    bulkResult.innerHTML = '<div class="summary-bar"><span class="big">Checking <span id="bulk-count">0</span> / ' + urls.length + '…</span></div>' +
      '<div class="progress"><div id="bulk-progress"></div></div><ul class="link-list" id="bulk-list"></ul>';

    var results = [];
    var chunks = [];
    for (var i = 0; i < urls.length; i += CHECK_CHUNK) chunks.push(urls.slice(i, i + CHECK_CHUNK));

    function runChunk(index) {
      if (index >= chunks.length) return Promise.resolve();
      return fetchJson('/api/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: chunks[index] }),
      }).then(function (resp) { results = results.concat(resp.results); })
      .catch(function () {
        results = results.concat(chunks[index].map(function (u) { return { input: u, ok: false, error: 'check failed' }; }));
      })
      .then(function () {
        $('#bulk-count').textContent = String(results.length);
        $('#bulk-progress').style.width = Math.round((results.length / urls.length) * 100) + '%';
        renderBulk(results);
        return runChunk(index + 1);
      });
    }

    function renderBulk(list) {
      var listEl = $('#bulk-list');
      listEl.innerHTML = list.map(function (r) {
        if (!r.ok) {
          return '<li class="link-row"><span class="dot unknown"></span><span class="badge">invalid</span>' +
            '<span class="url">' + escapeHtml(r.input) + ' — ' + escapeHtml(r.error || 'invalid URL') + '</span></li>';
        }
        var status = r.alive
          ? '<span class="dot alive"></span><span class="badge alive">HTTP ' + (r.status || '?') + '</span>'
          : '<span class="dot dead"></span><span class="badge dead">' + (r.status ? 'HTTP ' + r.status : (r.error || 'dead')) + '</span>';
        var snap = (r.snapshot)
          ? '<button class="mini-btn" type="button" data-view="' + escapeHtml(r.snapshot.url) + '">Resurrect (' + escapeHtml(r.snapshot.date) + ')</button>'
          : '';
        return '<li class="link-row">' + status +
          '<span class="url"><a href="' + escapeHtml(r.url) + '" target="_blank" rel="noopener">' + escapeHtml(r.url) + '</a></span>' + snap + '</li>';
      }).join('');
      listEl.querySelectorAll('[data-view]').forEach(function (b) {
        b.addEventListener('click', function () { openViewer(b.getAttribute('data-view')); });
      });
      var dead = list.filter(function (r) { return r.ok && !r.alive; }).length;
      var alive = list.filter(function (r) { return r.ok && r.alive; }).length;
      var summary = bulkResult.querySelector('.summary-bar');
      summary.innerHTML = '<span class="big"><span class="dead">' + dead + ' dead</span> · <span class="alive">' + alive + ' alive</span></span>' +
        '<span>' + list.length + ' of ' + urls.length + ' checked</span>';
    }

    runChunk(0)
      .catch(function (err) { bulkResult.innerHTML = errorHtml(err.message || 'Something went wrong.'); })
      .finally(function () { btn.disabled = false; });
  });

  /* ---------- Init ---------- */

  renderGraveyard();

  // Deep link: #r=<encoded-url> resurrects on load.
  var hash = window.location.hash;
  if (hash.indexOf('#r=') === 0) {
    try {
      var shared = decodeURIComponent(hash.slice(3));
      if (shared) {
        $('#resurrect-input').value = shared;
        resurrect(shared);
      }
    } catch (e) { /* ignore a malformed hash */ }
  }
})();
