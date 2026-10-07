// ==UserScript==
// @name         Manhwa Hub
// @namespace    manhwa-hub
// @version      3.18.0
// @description  Verbindet deine Scan-Seiten mit dem Manhwa Hub: Lesestand, Cover, neue Kapitel, Entdecken
// @homepageURL  https://github.com/de-joneh/manhwa-hub
// @updateURL    https://raw.githubusercontent.com/de-joneh/manhwa-hub/main/manhwa-hub.user.js
// @downloadURL  https://raw.githubusercontent.com/de-joneh/manhwa-hub/main/manhwa-hub.user.js
// @match        *://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_setClipboard
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @grant        GM_addValueChangeListener
// @grant        unsafeWindow
// @connect      *
// @run-at       document-idle
// ==/UserScript==
(function (GM) {
var isHub = !!document.querySelector('[data-mhub]');
'use strict';
var GM_getValue = GM.GM_getValue, GM_setValue = GM.GM_setValue, GM_setClipboard = GM.GM_setClipboard,
    GM_xmlhttpRequest = GM.GM_xmlhttpRequest, GM_registerMenuCommand = GM.GM_registerMenuCommand,
    GM_addValueChangeListener = GM.GM_addValueChangeListener;
var VERSION = '3.18.0';
var HUB_DEFAULT = 'https://claude.ai/artifact/8Ntpoy1ewrkkFitaHPioqk';
var SITES = ['asura', 'thunder'];
var CH = /(?:^|[^a-z])(?:chapter|chap|ch|kapitel|episode|ep)[-_\/ .]?\d/;
var SERIES = /\/(?:series|manga|manhwa|manhua|comics?|title|webtoon|novels?)\/[^\/]+\/?$/;
var LOG = 'mhub_log', COV = 'mhub_cov', DISC = 'mhub_disc', LIB = 'mhub_lib', ADD = 'mhub_add';

function get(k) { try { return JSON.parse(GM_getValue(k, '{}')) || {}; } catch (e) { return {}; } }
// Sprache kommt vom Hub (MHUB-LANG)
function L(de, en) { return GM_getValue('mhub_lang', 'de') === 'en' ? en : de; }
function put(k, v) { GM_setValue(k, JSON.stringify(v)); }
function keep(o, n) {
  var ks = Object.keys(o).sort(function (a, b) { return o[b].t - o[a].t; }).slice(0, n), r = {};
  ks.forEach(function (k) { r[k] = o[k]; }); return r;
}
// Der Hub läuft in einem eingebetteten Rahmen. Läuft das Skript dort nicht, übernimmt es die Claude-Seite
// außen herum und spricht den Rahmen per Nachricht an.
var topMode = !isHub && window.top === window.self && /(^|\.)claude\.ai$/.test(location.hostname);
var hubWin = isHub ? window : null;
function post(m) { if (hubWin) { try { hubWin.postMessage(m, '*'); } catch (e) {} } }
function token(forClipboard) {
  var l = get(LOG), cv = get(COV);
  var p = Object.keys(l).map(function (k) { return { url: k, pct: l[k].pct, t: l[k].t, site: l[k].site || 0 }; });
  var c = Object.keys(cv).filter(function (k) { return !cv[k].ack && (!forClipboard || (cv[k].sent || 0) < 2); })
    .map(function (k) { return { url: k, img: cv[k].img, title: cv[k].title }; });
  var dd = get(DISC), d = Object.keys(dd).filter(function (k) { return !dd[k].ack; }).slice(0, forClipboard ? 30 : 150)
    .map(function (k) { var e = dd[k]; return { url: k, title: e.title, rating: e.rating, ch: e.ch, chUrl: e.chUrl, img: e.img, site: e.site, g: e.g, desc: e.desc, type: e.type, rel: e.rel }; });
  var a = forClipboard ? [] : Object.keys(get(ADD));
  if (!p.length && !c.length && !d.length && !a.length) return '';
  return 'MHUB2:' + btoa(unescape(encodeURIComponent(JSON.stringify({ p: p, c: c, d: d, a: a }))));
}

/* ---------- Im Hub ---------- */
if (isHub || topMode) {
  var send = function () { var t = token(false); if (t) post(t); };
  var checking = false;
  var escRe = function (s) { return s.replace(/[.*+?^$(){}|[\]\\]/g, '\\$&'); };
  var pattern = function (tpl) {
    var path = tpl.replace(/^https?:\/\/[^\/]+/, ''), origin = tpl.slice(0, tpl.length - path.length);
    var parts = path.split('{n}');
    var rx = escRe(parts[0]).replace(/-([a-z0-9]{8})\//, function (m, g) { return /\d/.test(g) ? '-[a-z0-9]{8}/' : m; });
    return { re: new RegExp(rx + '(\\d+(?:[.-]\\d+)?)(?!\\d)', 'gi'), origin: origin, after: parts[1] || '' };
  };
  var seriesPage = function (tpl) {
    var m = tpl.match(/^(https?:\/\/[^\/]+\/(?:series|manga|manhwa|manhua|comics?|title|webtoon|novels?)\/[^\/]+)\//i);
    return m ? m[1] : null;
  };
  var fetchText = function (url, cb) {
    GM_xmlhttpRequest({ method: 'GET', url: url, timeout: 15000,
      onload: function (r) { cb(r.status >= 200 && r.status < 300 ? String(r.responseText || '') : null); },
      onerror: function () { cb(null); }, ontimeout: function () { cb(null); } });
  };
  var scan = function (text, pt) {
    var best = null, m;
    text = text.replace(/\\\//g, '/');
    pt.re.lastIndex = 0;
    while ((m = pt.re.exec(text))) {
      var n = parseFloat(m[1].replace('-', '.'));
      if (!isNaN(n) && n < 100000 && (!best || n > best.n)) best = { n: n, url: pt.origin + m[0] + pt.after };
    }
    return best;
  };
  var checkOne = function (j, cb) {
    var pt = pattern(j.tpl), urls = [seriesPage(j.tpl), j.latest].filter(Boolean), i = 0;
    (function step() {
      if (i >= urls.length) return cb(null);
      fetchText(urls[i++], function (t) {
        var b = t ? scan(t, pt) : null;
        if (b) return cb(b);
        step();
      });
    })();
  };
  var runCheck = function (jobs) {
    if (checking || !Array.isArray(jobs)) return;
    checking = true;
    var i = 0;
    (function next() {
      if (i >= jobs.length) { checking = false; post('MHUB-CHECKEND:' + JSON.stringify({ total: jobs.length })); return; }
      var j = jobs[i++];
      checkOne(j, function (b) {
        post('MHUB-FOUND:' + JSON.stringify({ id: j.id, max: b ? b.n : null, url: b ? b.url : null, done: i, total: jobs.length }));
        setTimeout(next, 900);
      });
    })();
  };
  window.addEventListener('message', function (e) {
    if (typeof e.data !== 'string' || e.data.indexOf('MHUB') !== 0) return;
    if (isHub ? e.origin !== location.origin : (!e.source || e.source === window)) return;
    var d = e.data;
    if (topMode && hubWin !== e.source) { hubWin = e.source; post('MHUB-CORE:' + VERSION); GM_setValue('mhub_home', location.origin + location.pathname); }
    if (d === 'MHUB-HELLO') send();
    else if (d.indexOf('MHUB-LANG:') === 0) GM_setValue('mhub_lang', d.slice(10) === 'en' ? 'en' : 'de');
    else if (d.indexOf('MHUB-SITES:') === 0) {
      try { var list = JSON.parse(d.slice(11)); if (Array.isArray(list)) GM_setValue('mhub_sites', JSON.stringify(list)); } catch (err) {}
      post('MHUB-SITES-OK');
    }
    else if (d.indexOf('MHUB-LIB:') === 0) { GM_setValue(LIB, d.slice(9)); }
    else if (d.indexOf('MHUB-ACK:') === 0) {
      try {
        var urls = JSON.parse(d.slice(9)), cv = get(COV), dv = get(DISC), ad = get(ADD), ch = false, ch2 = false, ch3 = false;
        urls.forEach(function (u) {
          if (cv[u] && !cv[u].ack) { cv[u].ack = true; ch = true; }
          if (dv[u] && !dv[u].ack) { dv[u].ack = true; ch2 = true; }
          if (ad[u]) { delete ad[u]; ch3 = true; }
        });
        if (ch) put(COV, cv);
        if (ch2) put(DISC, dv);
        if (ch3) put(ADD, ad);
      } catch (err) {}
    }
    else if (d.indexOf('MHUB-CHECK:') === 0) { try { runCheck(JSON.parse(d.slice(11))); } catch (err) {} }
    else if (d.indexOf('MHUB-IMG:') === 0) {
      try { var o = JSON.parse(d.slice(9)); shrink(o.url, 360, 480, function (img) { post('MHUB-IMGOK:' + JSON.stringify({ id: o.id, img: img })); }); } catch (err) {}
    }
  });
  if (GM_addValueChangeListener) {
    GM_addValueChangeListener(LOG, function (n, o, v, remote) { if (remote) send(); });
    GM_addValueChangeListener(COV, function (n, o, v, remote) { if (remote) send(); });
    GM_addValueChangeListener(DISC, function (n, o, v, remote) { if (remote) send(); });
    GM_addValueChangeListener(ADD, function (n, o, v, remote) { if (remote) send(); });
  }
  if (isHub) { post('MHUB-CORE:' + VERSION); send(); }
  else {
    // Alle Rahmen der Claude-Seite anpingen, bis sich der Hub meldet
    var ping = function (w, depth) {
      for (var i = 0; i < w.frames.length; i++) {
        try { w.frames[i].postMessage('MHUB-PING', '*'); if (depth < 3) ping(w.frames[i], depth + 1); } catch (e) {}
      }
    };
    var tries = 0, pt = setInterval(function () { if (hubWin || ++tries > 30) { clearInterval(pt); return; } ping(window, 0); }, 1500);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) { hubWin = null; tries = 0; ping(window, 0); } });
  }
  return;
}

/* ---------- Auf den Scan-Seiten ---------- */
if (window.top !== window.self) return;
try { SITES = SITES.concat(JSON.parse(GM_getValue('mhub_sites', '[]')) || []); } catch (e) {}
if (!SITES.some(function (s) { return s && location.hostname.indexOf(s) > -1; })) return;
var path = '', cur = 0, box = null, imgCount = -1, dirty = false, lastWrite = 0, flashUntil = 0, queued = false, restoring = false, touched = false;
var bigImgs = [], curA = null, REF = 0.3;
var savedT = 0, savedA = null;
var hideT = 0, discT = 0, discQ = [], discBusy = false, discSeen = {};
function isChapter() { return CH.test(path.toLowerCase()); }

var dock = document.createElement('div');
dock.style.cssText = 'position:fixed;right:8px;bottom:calc(8px + env(safe-area-inset-bottom, 0px));z-index:2147483647;transition:opacity .25s;display:flex;gap:6px;align-items:center;font:700 14px system-ui,sans-serif;user-select:none';
var pill = document.createElement('div');
pill.style.cssText = 'background:#913fe2;color:#fff;padding:9px 14px;border-radius:999px;box-shadow:0 3px 12px rgba(0,0,0,.45);display:none;cursor:pointer;white-space:nowrap';
var homeBtn = document.createElement('div');
homeBtn.setAttribute('role', 'button'); homeBtn.setAttribute('aria-label', L('Zurück zum Manhwa Hub', 'Back to Manhwa Hub'));
homeBtn.style.cssText = 'display:flex;align-items:center;gap:5px;background:#17121f;color:#fff;padding:9px 12px;border-radius:999px;box-shadow:0 3px 12px rgba(0,0,0,.45);cursor:pointer;border:1px solid #913fe2';
homeBtn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#ab6bf0" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/></svg><span>Hub</span>';
homeBtn.addEventListener('click', function () {
  save(true);
  location.href = GM_getValue('mhub_home', '') || HUB_DEFAULT;
});
dock.id = 'mhub-dock';
var cleanBtn = document.createElement('div');
cleanBtn.setAttribute('role', 'button');
cleanBtn.style.cssText = 'display:none;background:#17121f;color:#fff;padding:9px 11px;border-radius:999px;box-shadow:0 3px 12px rgba(0,0,0,.45);cursor:pointer;border:1px solid #3a3350;font-size:13px';
function cleanLabel() { cleanBtn.textContent = cleanOn() ? 'Original' : L('Nur Bilder', 'Images only'); cleanBtn.setAttribute('aria-label', cleanOn() ? L('Originalseite anzeigen', 'Show original page') : L('Nur die Bilder anzeigen', 'Show images only')); }
// Zwischen Original und „Nur Bilder“ wechseln. Nach dem Neuladen zeigt die Leiste sich nur beim Wechsel zu Original.
var switching = false, quietUntil = 0;
function toggleMode() {
  if (switching) return;
  switching = true;
  save(true);
  var toOrig = cleanOn();
  GM_setValue(CLEAN_KEY, toOrig ? '0' : '1');
  GM_setValue('mhub_switch', JSON.stringify({ to: toOrig ? 'orig' : 'clean', t: Date.now() }));
  location.reload();
}
cleanBtn.addEventListener('click', toggleMode);
dock.appendChild(pill); dock.appendChild(cleanBtn); dock.appendChild(homeBtn);
// In Kapiteln ist die Leiste versteckt. Doppeltipp wechselt direkt zwischen Original und „Nur Bilder“.
var dockT = 0;
function showDock(ms, force) {
  if (!force && Date.now() < quietUntil) return;
  dock.style.opacity = '1'; dock.style.pointerEvents = 'auto';
  clearTimeout(dockT);
  if (isChapter()) dockT = setTimeout(hideDock, ms || 3000);
}
function hideDock() { if (!isChapter()) return; dock.style.opacity = '0'; dock.style.pointerEvents = 'none'; }
var lastTap = 0, tapX = 0, tapY = 0, tapMoved = false;
window.addEventListener('touchstart', function () { tapMoved = false; }, { passive: true, capture: true });
window.addEventListener('touchmove', function () { tapMoved = true; }, { passive: true, capture: true });
window.addEventListener('touchend', function (e) {
  if (!isChapter() || tapMoved || e.touches.length || dock.contains(e.target)) return;
  var t = e.changedTouches[0], now = Date.now();
  if (now - lastTap < 350 && Math.abs(t.clientX - tapX) < 40 && Math.abs(t.clientY - tapY) < 40) { lastTap = 0; toggleMode(); }
  else { lastTap = now; tapX = t.clientX; tapY = t.clientY; }
}, { passive: true, capture: true });
window.addEventListener('dblclick', function (e) { if (isChapter() && !dock.contains(e.target)) toggleMode(); }, true);
dock.addEventListener('click', function () { if (isChapter()) showDock(3000, true); }, true);
(document.body || document.documentElement).appendChild(dock);
function flash(t) {
  pill.textContent = t; pill.style.display = 'block'; flashUntil = Date.now() + 2500;
  showDock(2800);
  clearTimeout(hideT);
  if (!isChapter()) hideT = setTimeout(function () { if (!isChapter()) pill.style.display = 'none'; }, 2600);
}

/* ---------- Lesemodus: nur die Bilder ---------- */
var preparing = false, CLEAN_KEY = 'mhub_clean', reader = null, readerStyle = null, readerObs = null, readerSrcs = {}, readerNav = null;
function cleanOn() { return GM_getValue(CLEAN_KEY, '1') === '1'; }
// Größte verfügbare Bildversion: srcset, <picture>-Quellen und Next.js-Bildproxy (/_next/image?url=…)
function pickSet(set) {
  var best = '', bw = 0;
  String(set || '').split(',').forEach(function (part) {
    var m = part.trim().match(/^(\S+)(?:\s+(\d+(?:\.\d+)?)([wx]))?$/); if (!m) return;
    var w = m[2] ? parseFloat(m[2]) * (m[3] === 'x' ? 1000 : 1) : 1;
    if (w >= bw) { bw = w; best = m[1]; }
  });
  return best;
}
function unproxy(u) {
  try {
    var x = new URL(u, location.href);
    if (/\/_next\/image/.test(x.pathname) && x.searchParams.get('url')) return new URL(x.searchParams.get('url'), location.href).href;
    return x.href;
  } catch (e) { return u; }
}
function bestSrc(im) {
  var set = im.getAttribute('srcset') || im.getAttribute('data-srcset') || '';
  var pic = im.parentElement && im.parentElement.tagName === 'PICTURE' ? im.parentElement : null;
  if (pic) [].forEach.call(pic.querySelectorAll('source'), function (s) { set += ',' + (s.getAttribute('srcset') || s.getAttribute('data-srcset') || ''); });
  var fromSet = pickSet(set.replace(/^,+/, ''));
  var base = imgSrc(im);
  var u = fromSet && !/^data:/.test(fromSet) ? fromSet : base;
  return u ? unproxy(u) : '';
}
function imgSrc(im) {
  var ds = im.getAttribute('data-src') || im.getAttribute('data-lazy-src') || im.getAttribute('data-original') || im.getAttribute('data-url') || '';
  var s = im.currentSrc || im.getAttribute('src') || '';
  if (ds && (!s || /^data:|blank|placeholder|loading|lazy/i.test(s))) s = ds;
  try { return s ? new URL(s, location.href).href : ''; } catch (e) { return ''; }
}
function addReaderImgs(list) {
  var added = 0;
  list.forEach(function (im) {
    var src = bestSrc(im); if (!src || /^data:/.test(src) || readerSrcs[src]) return;
    readerSrcs[src] = 1;
    var n = document.createElement('img');
    n.src = src; n.alt = ''; n.decoding = 'async';
    if (reader.children.length > 3) n.loading = 'lazy';
    var w = +im.getAttribute('width'), hgt = +im.getAttribute('height');
    if (w > 0 && hgt > 0) { n.width = w; n.height = hgt; }
    reader.appendChild(n); added++;
  });
  return added;
}
function buildReader() {
  if (reader) return true;
  var c = findBox(); if (!c || bigImgs.length < 3) return false;
  var src = c, srcImgs = bigImgs.slice();
  reader = document.createElement('div'); reader.id = 'mhub-reader';
  readerSrcs = {};
  // Bilder ohne normale Adresse (z. B. auf Canvas gezeichnet): Lesemodus hier nicht möglich
  if (addReaderImgs(srcImgs) < 3) { reader = null; return 'skip'; }
  readerStyle = document.createElement('style');
  readerStyle.textContent = 'html,body{background:#0b0a10!important;overflow-x:hidden!important;overflow-y:auto!important;margin:0!important}' +
    'body>*:not(#mhub-reader):not(#mhub-dock):not(#mhub-nav){display:none!important}' +
    '#mhub-nav{display:flex!important;gap:8px;max-width:820px;margin:0 auto;padding:18px 12px 120px;background:#0b0a10;font:700 15px system-ui,sans-serif}' +
    '#mhub-nav a{flex:1;display:flex;align-items:center;justify-content:center;min-height:52px;border-radius:12px;background:#2a2639;color:#ece9f6;text-decoration:none;text-align:center;padding:0 10px}' +
    '#mhub-nav a.nx{background:#913fe2;color:#fff;flex:1.4}#mhub-nav span{flex:1.4;display:flex;align-items:center;justify-content:center;color:#9893b0}' +
    '#mhub-reader{display:block!important;background:#0b0a10;padding:0;margin:0;touch-action:manipulation}' +
    '#mhub-reader img{display:block;width:100%;max-width:820px;height:auto;margin:0 auto;border:0}';
  (document.head || document.documentElement).appendChild(readerStyle);
  document.body.appendChild(reader);
  readerNav = chapterNav(); if (readerNav) document.body.appendChild(readerNav);
  if (dock.parentNode) document.body.appendChild(dock);
  // Klicks im Leser nicht an die Seite durchreichen, damit dort keine Werbe-Fenster aufgehen
  ['click', 'mousedown', 'mouseup', 'touchend', 'pointerup', 'auxclick'].forEach(function (ev) {
    reader.addEventListener(ev, function (e) { e.stopPropagation(); }, true);
  });
  // Bilder, die die Seite später nachlädt, ebenfalls übernehmen
  var pend = 0;
  readerObs = new MutationObserver(function () {
    clearTimeout(pend);
    pend = setTimeout(function () {
      if (!reader) return;
      addReaderImgs([].slice.call(src.querySelectorAll('img')).filter(function (im) { var w = +im.getAttribute('width'); return !w || w >= 250; }));
    }, 700);
  });
  readerObs.observe(src, { subtree: true, childList: true, attributes: true, attributeFilter: ['src', 'data-src', 'srcset'] });
  box = null; imgCount = -1; bigImgs = [];
  window.scrollTo(0, 0);
  return true;
}
function teardownReader() {
  if (readerObs) { readerObs.disconnect(); readerObs = null; }
  if (reader && reader.parentNode) reader.parentNode.removeChild(reader);
  if (readerStyle && readerStyle.parentNode) readerStyle.parentNode.removeChild(readerStyle);
  if (readerNav && readerNav.parentNode) readerNav.parentNode.removeChild(readerNav);
  reader = null; readerStyle = null; readerSrcs = {}; readerNav = null;
}
// Knöpfe am Kapitelende im Lesemodus: vorheriges Kapitel, Serienseite, nächstes Kapitel.
// Links stammen von der Seite selbst; fehlt einer, wird er gebaut, wenn der Hub das Kapitel kennt.
var CHPART = /((?:chapter|chap|ch|episode|ep)[-_\/ .]?)(\d+(?:[-_.]\d+)?)/i;
function chapterNav() {
  var m = path.match(CHPART); if (!m) return null;
  var n = parseFloat(m[2].replace(/[-_]/, '.')), head = path.slice(0, m.index), strip = function (p) { return p.toLowerCase().replace(CHPART, '#'); };
  var found = {}, me = strip(path);
  document.querySelectorAll('a[href]').forEach(function (a) {
    var u = absUrl(a.getAttribute('href')), k = chOf(u);
    if (k == null || strip(pathOf(u)) !== me || new URL(u).hostname !== location.hostname) return;
    if (!found[k]) found[k] = u;
  });
  var key = slugBase(head.replace(/[-_\/]+$/, '')).replace(/[^a-z0-9]/g, ''), e = key ? libEntry(key) : null;
  var make = function (k) { return location.origin + path.replace(CHPART, function (all, a) { return a + k; }); };
  var prevN = Math.ceil(n) - 1, nextN = Math.floor(n) + 1;
  var prev = found[prevN] || (prevN >= 1 ? make(prevN) : '');
  var next = found[nextN] || (e && e.m >= nextN ? make(nextN) : '');
  var home = head.replace(/[-_\/]+$/, ''), homeUrl = isSeriesUrl(location.origin + home) ? location.origin + home : '';
  var nav = document.createElement('div'); nav.id = 'mhub-nav';
  var link = function (href, text, cls) {
    var a = document.createElement('a'); a.href = href; a.textContent = text; if (cls) a.className = cls;
    // Nächstes Kapitel: dieses als fertig gelesen speichern
    if (cls === 'nx') a.addEventListener('click', function () { cur = 100; curA = null; dirty = true; save(true); });
    else a.addEventListener('click', function () { save(true); });
    nav.appendChild(a);
  };
  if (prev) link(prev, '‹ ' + prevN);
  if (homeUrl) link(homeUrl, L('Serie', 'Series'));
  if (next) link(next, L('Kapitel ', 'Chapter ') + nextN + ' ›', 'nx');
  else { var sp = document.createElement('span'); sp.textContent = L('Neuestes Kapitel ✓', 'Latest chapter ✓'); nav.appendChild(sp); }
  // Klicks nicht an die Seite weitergeben (Werbe-Fenster)
  nav.addEventListener('click', function (ev) { ev.stopPropagation(); });
  return nav;
}
function blockPopups() {
  var w = GM.uw; if (!w) return;
  try { w.open = function () { return null; }; } catch (e) {}
}
// Lesemodus aufbauen, sobald die Bilder da sind, dann weitermachen
function prepareReader(cb) {
  if (!cleanOn()) return cb();
  blockPopups();
  var tries = 0; preparing = true;
  var done = function () { preparing = false; cb(); };
  (function t() {
    if (!isChapter()) return done();
    var b = buildReader();
    if (b) return done();
    // Textkapitel (Novel): nichts umzubauen
    var txt = document.body ? (document.body.innerText || '').length : 0;
    if (txt > 4000 && document.querySelectorAll('img').length < 3) return done();
    if (++tries > 24) return done();
    setTimeout(t, 500);
  })();
}
function findBox() {
  var imgs = document.images;
  if (imgs.length === imgCount && box && box.isConnected) return box;
  imgCount = imgs.length; box = null; bigImgs = [];
  var big = [];
  for (var i = 0; i < imgs.length; i++) if (imgs[i].clientWidth >= 250) big.push(imgs[i]);
  if (big.length < 3) return null;
  var need = Math.max(3, Math.floor(big.length * 0.8)), el = big[0].parentElement;
  while (el && el !== document.body) {
    var n = 0; for (var j = 0; j < big.length; j++) if (el.contains(big[j])) n++;
    if (n >= need) break; el = el.parentElement;
  }
  box = el && el !== document.body ? el : null;
  if (box) bigImgs = big.filter(function (b) { return box.contains(b); });
  return box;
}
// Genauer Ankerpunkt: welches Bild liegt auf Höhe der oberen Bildschirmdrittel-Linie, und wie weit darin.
// Das bleibt stabil, auch wenn andere Bilder noch nachladen und die Gesamthöhe sich ändert.
function anchor() {
  if (!findBox() || !bigImgs.length) return null;
  var ref = window.innerHeight * REF, lo = 0, hi = bigImgs.length - 1;
  while (lo < hi) { var mid = (lo + hi) >> 1; if (bigImgs[mid].getBoundingClientRect().bottom <= ref) lo = mid + 1; else hi = mid; }
  var rc = bigImgs[lo].getBoundingClientRect();
  var f = rc.height > 0 ? Math.max(0, Math.min(1, (ref - rc.top) / rc.height)) : 0;
  return { i: lo, f: Math.round(f * 1000) / 1000, n: bigImgs.length };
}
// Bereich, über den der Fortschritt gemessen wird: der Bilderblock, bei Textkapiteln (Novels) die ganze Seite
function contentBox() {
  var vh = window.innerHeight, c = findBox();
  if (c) { var r = c.getBoundingClientRect(); return r.height >= vh * 2.5 ? { top: r.top + window.scrollY, height: r.height } : null; }
  var H = document.documentElement.scrollHeight, txt = document.body ? (document.body.innerText || '').length : 0;
  if (bigImgs.length < 3 && txt > 4000 && H >= vh * 2.5) return { top: 0, height: H };
  return null;
}
function measure() {
  var b = contentBox(); if (!b) return -1;
  var vh = window.innerHeight, y = window.scrollY;
  return Math.max(0, Math.min(100, Math.round((y + vh - b.top) / b.height * 100)));
}
function save(force) {
  if (!dirty) return;
  var now = Date.now(); if (!force && now - lastWrite < 800) return;
  var l = get(LOG), en = { pct: cur, t: now };
  if (curA) { en.i = curA.i; en.f = curA.f; en.n = curA.n; }
  l[location.origin + path] = en;
  put(LOG, keep(l, 60)); lastWrite = now; dirty = false;
}
function update() {
  queued = false;
  if (!CH.test(path.toLowerCase())) return;
  if (restoring || preparing) return;
  var p = measure();
  if (p < 0) return;
  var a = anchor();
  var moved = a && (!curA || a.i !== curA.i || Math.abs(a.f - curA.f) > 0.01);
  if (a) curA = a;
  if (p !== cur || moved) { cur = p; dirty = true; save(false); }
  if (Date.now() > flashUntil) pill.textContent = '📖 ' + cur + ' %';
}
// Beim Öffnen an die letzte Stelle springen. Bilder laden nach, deshalb wird kurz nachjustiert,
// bis die Position stabil ist oder du selbst scrollst.
function restore(target, anc) {
  if (!(target > 2 && target < 95)) return;
  restoring = true; touched = false;
  var t0 = Date.now(), lastY = -1;
  flash(L('↩ Springe zu ', '↩ Jumping to ') + target + ' %');
  var iv = setInterval(function () {
    var done = function () { clearInterval(iv); restoring = false; onScroll(); };
    if (touched || Date.now() - t0 > 15000) return done();
    var b = contentBox(); if (!b) return;
    var vh = window.innerHeight, y;
    var img = anc && bigImgs.length >= anc.n * 0.9 ? bigImgs[anc.i] : null;
    if (img) {
      var ir = img.getBoundingClientRect();
      y = Math.max(0, ir.top + window.scrollY + anc.f * ir.height - vh * REF);
    } else y = Math.max(0, b.top + target / 100 * b.height - vh);
    if (Math.abs(y - window.scrollY) > 8) window.scrollTo(0, y);
    else if (Math.abs(y - lastY) < 3) done();
    lastY = y;
  }, 400);
}
['touchstart', 'wheel', 'keydown', 'mousedown'].forEach(function (ev) {
  window.addEventListener(ev, function () { if (restoring) touched = true; }, { passive: true });
});
function onScroll() { if (!queued) { queued = true; requestAnimationFrame(update); } }

function shrink(src, W, H, cb) {
  GM_xmlhttpRequest({ method: 'GET', url: src, responseType: 'blob', timeout: 15000,
    onload: function (res) {
      if (res.status !== 200 || !res.response) return cb('');
      createImageBitmap(res.response).then(function (bmp) {
        var c = document.createElement('canvas'); c.width = W; c.height = H;
        var k = Math.max(W / bmp.width, H / bmp.height), w = bmp.width * k, h = bmp.height * k;
        c.getContext('2d').drawImage(bmp, (W - w) / 2, (H - h) / 2, w, h);
        c.getContext('2d').imageSmoothingQuality = 'high';
        var d = c.toDataURL('image/webp', 0.84);
        if (d.indexOf('data:image/webp') !== 0) d = c.toDataURL('image/jpeg', 0.86);
        cb(d);
      }).catch(function () { cb(''); });
    },
    onerror: function () { cb(''); }, ontimeout: function () { cb(''); } });
}
function grabCover(force) {
  var key = location.origin + location.pathname, all = get(COV);
  if (all[key] && !force) return;
  var m = document.querySelector('meta[property="og:image"],meta[name="twitter:image"]');
  var t = document.querySelector('meta[property="og:title"]');
  if (!m || !m.content) { if (force) flash(L('Kein Cover gefunden', 'No cover found')); return; }
  shrink(m.content, 360, 480, function (d) {
    if (!d) return;
    var cur = get(COV); cur[key] = { img: d, title: t ? t.content : document.title, t: Date.now() };
    put(COV, keep(cur, 40)); if (force) flash(L('✓ Cover gemerkt', '✓ Cover saved'));
  });
}

/* ---------- Entdecken: Serien auf Übersichtsseiten einsammeln ---------- */
var CHNUM = /(?:chapter|chap|ch|episode|ep)[-_\/ .]?(\d+(?:[-_.]\d+)?)/;
function absUrl(href, base) { try { return new URL(href, base || location.href).href.replace(/[#?].*$/, ''); } catch (e) { return ''; } }
function pathOf(u) { try { return new URL(u).pathname; } catch (e) { return ''; } }
function slugBase(u) {
  return u.replace(/\/$/, '').split('/').pop().toLowerCase()
    .replace(/-[a-z0-9]{8}$/, function (m) { return /\d/.test(m) ? '' : m; });
}
function chOf(u) { var m = pathOf(u).toLowerCase().match(CHNUM); return m ? parseFloat(m[1].replace(/[-_]/, '.')) : null; }
function isSeriesUrl(u) { var p = pathOf(u); return !!p && SERIES.test(p) && !CH.test(p.toLowerCase()); }
function onlySeries(el, key, base) {
  var as = el.querySelectorAll('a[href]');
  for (var i = 0; i < as.length; i++) {
    var u = absUrl(as[i].getAttribute('href'));
    if (isSeriesUrl(u)) { if (u.replace(/\/$/, '') !== key) return false; }
    else if (chOf(u) != null && pathOf(u).toLowerCase().indexOf(base) < 0) return false;
  }
  return true;
}
function scrapeCards() {
  var map = {}, out = [];
  document.querySelectorAll('a[href]').forEach(function (a) {
    var u = absUrl(a.getAttribute('href'));
    if (!isSeriesUrl(u) || new URL(u).hostname !== location.hostname) return;
    var k = u.replace(/\/$/, ''); (map[k] = map[k] || []).push(a);
  });
  Object.keys(map).forEach(function (k) {
    var as = map[k], base = slugBase(k), card = null;
    for (var j = 0; j < as.length && !card; j++) {
      var el = as[j];
      for (var i = 0; i < 6 && el && el !== document.body; i++) {
        if (!onlySeries(el, k, base)) break;
        if (el.tagName === 'IMG' || el.querySelector('img')) card = el;
        el = el.parentElement;
      }
    }
    card = card || as[0];
    var title = '';
    as.forEach(function (a) {
      var t = (a.getAttribute('title') || a.textContent || '').replace(/\s+/g, ' ').trim();
      if (t.length > title.length && t.length < 120 && !/^(chapter|kapitel|ch\.?)\s*\d/i.test(t)) title = t;
    });
    var img = card.tagName === 'IMG' ? card : card.querySelector('img');
    if (!title && img) title = img.alt || '';
    if (!title) return;
    var text = card.innerText || card.textContent || '', rating = null, re = /(\d{1,2}[.,]\d{1,2})/g, m;
    while ((m = re.exec(text))) { var v = parseFloat(m[1].replace(',', '.')); if (v > 0 && v <= 10) { rating = v; break; } }
    var type = badgeType(card) || (/\/novels?\//i.test(k) ? 'Novel' : '');
    var chN = null, chU = null;
    card.querySelectorAll('a[href]').forEach(function (a) {
      var u = absUrl(a.getAttribute('href')), n = chOf(u);
      if (n != null && (chN == null || n > chN)) { chN = n; chU = u; }
    });
    out.push({ url: k, title: title.slice(0, 120), rating: rating, ch: chN, chUrl: chU, type: type,
      imgSrc: img ? (img.currentSrc || img.src || img.getAttribute('data-src') || '') : '' });
  });
  return out;
}
function enrich(c, cb) {
  var base = slugBase(c.url);
  GM_xmlhttpRequest({ method: 'GET', url: c.url, timeout: 15000,
    onload: function (r) {
      var doc = null;
      try { if (r.status === 200) doc = new DOMParser().parseFromString(r.responseText, 'text/html'); } catch (e) {}
      var og = doc && doc.querySelector('meta[property="og:image"]'), ot = doc && doc.querySelector('meta[property="og:title"]');
      var e = { title: (ot && ot.content) || c.title, rating: c.rating, ch: c.ch, chUrl: c.chUrl, img: '', site: location.hostname, t: Date.now(),
        g: [], desc: '', type: c.type || '', rel: [] };
      if (doc) {
        var seen = {}, rel = {};
        doc.querySelectorAll('a[href]').forEach(function (a) {
          var hrf = (a.getAttribute('href') || '').toLowerCase();
          var u = absUrl(a.getAttribute('href'), c.url), n = chOf(u);
          if (n != null && pathOf(u).toLowerCase().indexOf(base) > -1) {
            if (e.ch == null || n > e.ch) { e.ch = n; e.chUrl = u; }
            var dt = linkDate(a);
            if (dt && !rel[n]) rel[n] = dt;
            return;
          }
          if (/(genre|genres|tag|tags)[\/=]/.test(hrf) && !a.closest('nav,header,footer,[class*="menu"],[id*="menu"]')) {
            var t = (a.textContent || '').replace(/\s+/g, ' ').trim();
            if (t && t.length < 30 && !seen[t.toLowerCase()] && e.g.length < 12) { seen[t.toLowerCase()] = 1; e.g.push(t); }
          }
        });
        e.rel = Object.keys(rel).map(function (n) { return [parseFloat(n), rel[n]]; }).sort(function (a, b) { return a[0] - b[0]; }).slice(-20);
        e.desc = fullDesc(doc);
        e.g = mergeGenres(headGenres(doc), e.g);
        var bt = doc.body ? (doc.body.textContent || '').slice(0, 40000) : '';
        var ty = bt.match(/(?:type|typ)\s*:?\s*(manhwa|manga|manhua|novel|webtoon)/i);
        if (ty) e.type = ty[1].charAt(0).toUpperCase() + ty[1].slice(1).toLowerCase();
        else if (!e.type) e.type = badgeType(doc.body);
        if (!e.type && /\/novels?\//i.test(c.url)) e.type = 'Novel';
      }
      var src = (og && og.content) || c.imgSrc;
      if (!src || /^data:/.test(src)) return cb(e);
      shrink(src, 240, 320, function (d) { e.img = d; cb(e); });
    },
    onerror: function () { cb(null); }, ontimeout: function () { cb(null); } });
}
// Art (Manhwa, Novel …) aus einem Abzeichen lesen: ein Element, dessen Text genau so heißt
function badgeType(root) {
  if (!root) return '';
  var els = root.querySelectorAll('span,div,a,p,b,i,small,li');
  for (var i = 0; i < els.length && i < 400; i++) {
    if (els[i].children.length) continue;
    var t = (els[i].textContent || '').trim().toLowerCase();
    if (/^(manhwa|manga|manhua|novel|webtoon)$/.test(t)) return t.charAt(0).toUpperCase() + t.slice(1);
  }
  return '';
}
// Datum aus dem Text eines Kapitel-Links lesen. Versteht absolute Angaben ("October 3rd 2025", "Oct 3, 2025",
// "3. Oktober 2025", "03.10.2025", "2025-10-03", "Oct 3"), relative ("5 days ago", "vor 2 Stunden", "yesterday")
// und <time datetime>. Ergebnis ist der Tag (12 Uhr), damit sich der Wert innerhalb eines Tages nicht ändert.
var MON = { jan: 0, feb: 1, mar: 2, 'mär': 2, mae: 2, apr: 3, may: 4, mai: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, okt: 9, nov: 10, dec: 11, dez: 11 };
var UNIT = [[/^(s|sec|secs|second|seconds|sek|sekunde|sekunden)$/, 1e3], [/^(m|min|mins|minute|minutes|minuten)$/, 6e4], [/^(h|hr|hrs|hour|hours|std|stunde|stunden)$/, 36e5],
  [/^(d|day|days|tag|tage|tagen)$/, 864e5], [/^(w|wk|wks|week|weeks|woche|wochen)$/, 6048e5], [/^(mo|mon|mons|month|months|monat|monate|monaten)$/, 2592e6], [/^(y|yr|yrs|year|years|jahr|jahre|jahren)$/, 31536e6]];
function unitMs(u) { for (var i = 0; i < UNIT.length; i++) if (UNIT[i][0].test(u)) return UNIT[i][1]; return 0; }
function dayOf(t) { var d = new Date(t); d.setHours(12, 0, 0, 0); return d.getTime(); }
function parseDate(txt) {
  txt = String(txt || '').replace(/\s+/g, ' ').trim();
  var low = txt.toLowerCase(), now = Date.now(), t = NaN, m, mi;
  var num = function (x) { return /^\d+$/.test(x) ? +x : 1; };
  if ((m = low.match(/(\d+|an?|one)\s*([a-z]+)\s+ago\b/)) && unitMs(m[2])) t = now - num(m[1]) * unitMs(m[2]);
  else if ((m = low.match(/\bvor\s+(\d+|eine[rmn]?)\s+([a-zä]+)/)) && unitMs(m[2])) t = now - num(m[1]) * unitMs(m[2]);
  else if (/\b(today|just now|heute|gerade eben)\b/.test(low)) t = now;
  else if (/\b(yesterday|gestern)\b/.test(low)) t = now - 864e5;
  else if ((m = txt.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/))) t = new Date(+m[3], +m[2] - 1, +m[1]).getTime();
  else if ((m = txt.match(/(\d{4})-(\d{2})-(\d{2})/))) t = new Date(+m[1], +m[2] - 1, +m[3]).getTime();
  else if ((m = low.match(/([a-zä]{3,9})\.? (\d{1,2})(?:st|nd|rd|th)?,? (\d{4})/)) && (mi = MON[m[1].slice(0, 3)]) != null) t = new Date(+m[3], mi, +m[2]).getTime();
  else if ((m = low.match(/(\d{1,2})\.? ([a-zä]{3,9})\.?,? (\d{4})/)) && (mi = MON[m[2].slice(0, 3)]) != null) t = new Date(+m[3], mi, +m[1]).getTime();
  else if ((m = low.match(/\b([a-zä]{3,9})\.? (\d{1,2})(?:st|nd|rd|th)?\b/)) && (mi = MON[m[1].slice(0, 3)]) != null && +m[2] <= 31) {
    // Ohne Jahr: dieses Jahr, liegt das in der Zukunft, dann letztes
    var y = new Date().getFullYear(); t = new Date(y, mi, +m[2]).getTime(); if (t > now + 864e5) t = new Date(y - 1, mi, +m[2]).getTime();
  }
  if (isNaN(t) || t > now + 864e5 || t < now - 4 * 365 * 864e5) return 0;
  return dayOf(t);
}
function timeAttr(el) {
  var tm = el.getAttribute && el.getAttribute('datetime') ? el : (el.querySelector && el.querySelector('time[datetime]'));
  var t = tm ? Date.parse(tm.getAttribute('datetime')) : NaN;
  return isNaN(t) || t > Date.now() + 864e5 ? 0 : dayOf(t);
}
// Text eines Elements mit Leerzeichen zwischen den Teilen: sonst wird aus "Chapter 32" + "5 days ago" "Chapter 325 days ago"
function textOf(el) {
  var out = [], w = (el.ownerDocument || document).createTreeWalker(el, 4), n;
  while ((n = w.nextNode())) out.push(n.nodeValue);
  return out.join(' ');
}
// Datum zu einem Kapitel-Link: im Link selbst, sonst im umgebenden Element, wenn dort nur dieser eine Link steht
function linkDate(a) {
  var t = timeAttr(a) || parseDate(textOf(a));
  for (var el = a.parentElement, i = 0; !t && el && i < 3; el = el.parentElement, i++) {
    if (el.querySelectorAll('a[href]').length > 1) break;
    t = timeAttr(el) || parseDate(textOf(el));
  }
  return t;
}
// Auf der Serienseite: Kapitel und Daten aus der angezeigten Seite neu lesen und an den Hub geben
var relDoneFor = '';
function refreshRel() {
  if (relDoneFor === path || isChapter() || !SERIES.test(path)) return;
  var self = (location.origin + path).replace(/\/$/, ''), base = slugBase(self), rel = {}, mx = null, mxU = null;
  document.querySelectorAll('a[href]').forEach(function (a) {
    var u = absUrl(a.getAttribute('href')), n = chOf(u);
    if (n == null || pathOf(u).toLowerCase().indexOf(base) < 0) return;
    if (mx == null || n > mx) { mx = n; mxU = u; }
    var dt = linkDate(a); if (dt && !rel[n]) rel[n] = dt;
  });
  if (mx == null) return;
  var all = get(DISC), e = all[self]; if (!e) return; // Erster Besuch: der Eintrag entsteht gerade beim Entdecken
  var list = Object.keys(rel).map(function (n) { return [parseFloat(n), rel[n]]; }).sort(function (a, b) { return a[0] - b[0]; }).slice(-20);
  var desc = fullDesc(document), hg = headGenres(document);
  var sig = JSON.stringify([list, mx, desc.length, hg]);
  relDoneFor = path;
  if (e.relSig === sig) return;
  if (list.length) e.rel = list;
  if (desc && desc.length >= (e.desc || '').length) e.desc = desc;
  if (hg.length) e.g = mergeGenres(hg, e.g || []);
  if (mx > (e.ch || 0)) { e.ch = mx; e.chUrl = mxU; }
  e.relSig = sig; e.ack = false; e.t = Date.now();
  put(DISC, keep(all, 150));
}
/* ---------- Beschreibung und Genres von der Serienseite ---------- */
// Text mit Absätzen: Blöcke und <br> werden zu Zeilenumbrüchen
function blockText(el) {
  var out = '';
  (function walk(n) {
    if (n.nodeType === 3) { out += n.nodeValue; return; }
    if (n.nodeType !== 1 || /^(SCRIPT|STYLE|NOSCRIPT|BUTTON|SVG)$/i.test(n.tagName)) return;
    if (n.tagName === 'BR') { out += '\n'; return; }
    var blk = /^(P|DIV|LI|H[1-6]|SECTION|ARTICLE|BLOCKQUOTE)$/.test(n.tagName);
    if (blk) out += '\n';
    for (var c = n.firstChild; c; c = c.nextSibling) walk(c);
    if (blk) out += '\n';
  })(el);
  return out.replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
function normT(t) { return String(t || '').replace(/\s+/g, ' ').trim().toLowerCase(); }
// Die Kurzbeschreibung in den Metadaten ist oft abgeschnitten. Gesucht wird das Element, das ihren Anfang enthält,
// dann nach oben, solange der Behälter nur Absätze enthält (mehrere <p> einer Beschreibung).
function fullDesc(root) {
  var md = root.querySelector('meta[property="og:description"],meta[name="description"]');
  var meta = md && md.content ? md.content.replace(/\s+/g, ' ').trim() : '';
  var probe = normT(meta.replace(/(\.\.\.|…)\s*$/, '')).slice(0, 60), best = null, bl = 1e9;
  if (probe.length >= 20) {
    root.querySelectorAll('p,div,span,section,article').forEach(function (el) {
      if (el.closest('head,script,style,noscript')) return;
      var t = normT(el.textContent); if (t.length < probe.length || t.length > 8000) return;
      if (t.indexOf(probe) > -1 && t.length < bl) { best = el; bl = t.length; }
    });
    while (best && best.parentElement && best.parentElement !== root.body && normT(best.parentElement.textContent).length < 8000 &&
      [].every.call(best.parentElement.children, function (c) { return /^(P|SPAN|BR|EM|STRONG|I|B|U)$/.test(c.tagName); })) best = best.parentElement;
  }
  if (!best) {
    // Ohne Metadaten: Text unter einer Überschrift wie „Synopsis“
    root.querySelectorAll('h1,h2,h3,h4,h5,h6,span,div,b,strong').forEach(function (h) {
      if (best || h.children.length) return;
      if (!/^(synopsis|summary|description|story|beschreibung|inhalt|zusammenfassung)\s*:?$/i.test((h.textContent || '').trim())) return;
      var nx = h.nextElementSibling; if (nx && normT(nx.textContent).length > 40) best = nx;
    });
  }
  var txt = best ? blockText(best) : '';
  if (!txt || txt.length < meta.replace(/(\.\.\.|…)$/, '').length - 3) txt = meta;
  return txt.slice(0, 5000);
}
// Genres unter einer Überschrift „Genres“/„Tags“, z. B. als Knöpfe (Asura)
function headGenres(root) {
  var out = [];
  root.querySelectorAll('h1,h2,h3,h4,h5,h6,span,div,p,b,strong,dt,label').forEach(function (h) {
    if (out.length || h.children.length) return;
    var ht = (h.textContent || '').trim().toLowerCase().replace(/[:\s]+$/, '');
    if (!/^(genres?|tags?|genre\(s\)|categories|kategorien)$/.test(ht)) return;
    [h.nextElementSibling, h.parentElement, h.parentElement && h.parentElement.nextElementSibling].forEach(function (c) {
      if (out.length || !c || normT(c.textContent).length > 800) return;
      var seen = {};
      c.querySelectorAll('a,button,span,li').forEach(function (it) {
        if (it.children.length > 1) return;
        var t = (it.textContent || '').replace(/\s+/g, ' ').trim().replace(/,$/, '');
        if (t.length < 2 || t.length > 30 || t.toLowerCase() === ht || seen[t.toLowerCase()]) return;
        seen[t.toLowerCase()] = 1; out.push(t);
      });
    });
  });
  return out.slice(0, 20);
}
function mergeGenres(a, b) {
  var seen = {}, out = [];
  a.concat(b).forEach(function (g) { var k = g.toLowerCase(); if (!seen[k]) { seen[k] = 1; out.push(g); } });
  return out.slice(0, 20);
}
/* ---------- Lesestand der Scan-Seite: „Continue reading Chapter 10“ ---------- */
var STRIPCH = function (p) { return p.toLowerCase().replace(/((?:chapter|chap|ch|episode|ep)[-_\/ .]?)(\d+(?:[-_.]\d+)?)/, '#'); };
function siteProgress() {
  var l = get(LOG), ch = false;
  document.querySelectorAll('a[href]').forEach(function (a) {
    if (a.closest('#mhub-card,#mhub-dock,#mhub-nav')) return;
    var u = absUrl(a.getAttribute('href')), n = chOf(u);
    if (n == null || new URL(u).hostname !== location.hostname) return;
    var ctx = textOf(a), p = a.parentElement;
    for (var i = 0; i < 2 && p; i++, p = p.parentElement) { if (p.querySelectorAll('a[href]').length > 2) break; ctx += ' ' + textOf(p); }
    if (!/(continue|resume|keep reading|last read|weiterlesen|zuletzt gelesen|reading now)/i.test(ctx)) return;
    if (/(first chapter|read first|latest|newest|new chapter|erstes|neuestes)/i.test(ctx)) return;
    // Nur übernehmen, wenn hier noch nichts Gleichwertiges oder Weiteres gemerkt ist
    var base = STRIPCH(pathOf(u));
    if (Object.keys(l).some(function (k) { return STRIPCH(pathOf(k)) === base && chOf(k) >= n; })) return;
    l[u] = { pct: 1, t: Date.now(), site: 1 }; ch = true;
  });
  if (ch) put(LOG, keep(l, 60));
}
function runDisc() {
  discBusy = true;
  var done = 0;
  (function next() {
    if (!discQ.length || document.hidden) { discBusy = false; if (done) flash('✓ ' + done + L(' Manhwas für den Hub gemerkt', ' manhwas saved for the hub')); return; }
    var c = discQ.shift();
    flash(L('🔎 Entdecke … noch ', '🔎 Discovering … ') + (discQ.length + 1) + L('', ' left'));
    enrich(c, function (e) {
      if (e) { var all = get(DISC); all[c.url] = e; put(DISC, keep(all, 150)); done++; }
      setTimeout(next, 600);
    });
  })();
}
function discover() {
  if (isChapter()) return;
  siteProgress();
  var cards = scrapeCards(), all = get(DISC), changed = false;
  cards.forEach(function (c) {
    var e = all[c.url];
    if (e) {
      var nr = c.rating && c.rating !== e.rating, nc = c.ch != null && c.ch > (e.ch || 0);
      if (nr) e.rating = c.rating;
      if (nc) { e.ch = c.ch; e.chUrl = c.chUrl; }
      if (nr || nc) { e.ack = false; changed = true; }
      return;
    }
    if (discSeen[c.url]) return;
    discSeen[c.url] = 1; discQ.push(c);
  });
  if (changed) put(DISC, keep(all, 150));
  if (discQ.length && !discBusy) runDisc();
}

/* ---------- Serienseite: Stand aus dem Hub, Weiterlesen, gelesene Kapitel markieren ---------- */
var card = null, cardKey = '', libRaw = '', libList = [];
function libEntry(key) {
  var raw = GM_getValue(LIB, '[]');
  if (raw !== libRaw) { libRaw = raw; try { libList = JSON.parse(raw) || []; } catch (e) { libList = []; } }
  for (var i = 0; i < libList.length; i++) {
    var e = libList[i];
    if ((e.k || []).some(function (x) { return x === key || (Math.min(x.length, key.length) >= 6 && (x.indexOf(key) > -1 || key.indexOf(x) > -1)); })) return e;
  }
  return null;
}
// Stand aus dem Hub, ergänzt um das, was du auf diesem Gerät seitdem gelesen hast
function seriesState(e, base) {
  var st = { r: e.r || 0, c: e.c ? { n: e.c.n, pct: e.c.pct, url: '' } : null, u: e.u || '', n: e.n }, l = get(LOG);
  Object.keys(l).filter(function (k) { return pathOf(k).toLowerCase().indexOf(base) > -1 && l[k].t > (e.at || 0); })
    .sort(function (a, b) { return l[a].t - l[b].t; })
    .forEach(function (k) {
      var n = chOf(k); if (n == null) return;
      if (l[k].pct >= 95) { if (n > st.r) st.r = n; if (st.c && st.c.n <= st.r) st.c = null; }
      else if (n > st.r) st.c = { n: n, pct: l[k].pct, url: k };
    });
  if (st.c) st.n = st.c.n;
  else if (st.n == null || st.n <= st.r) st.n = st.r + 1 <= (e.m || 0) ? Math.floor(st.r) + 1 : null;
  return st;
}
// Kapitel-Links dieser Serie auf der Seite
function chapLinks(base) {
  var out = [];
  document.querySelectorAll('a[href]').forEach(function (a) {
    var u = absUrl(a.getAttribute('href')), n = chOf(u);
    if (n != null && pathOf(u).toLowerCase().indexOf(base) > -1 && new URL(u).hostname === location.hostname) out.push({ a: a, n: n, u: u });
  });
  return out;
}
function cardBtn(label, fn, main) {
  var b = document.createElement('div');
  b.setAttribute('role', 'button'); b.textContent = label;
  b.style.cssText = 'flex:none;padding:8px 12px;border-radius:999px;cursor:pointer;font-weight:700;white-space:nowrap;' + (main ? 'background:#913fe2;color:#fff' : 'background:#2a2639;color:#ece9f6');
  b.addEventListener('click', function (ev) { ev.preventDefault(); ev.stopPropagation(); fn(); });
  return b;
}
function seriesCard() {
  if (isChapter() || !SERIES.test(path)) { if (card) { card.remove(); card = null; } return; }
  var self = (location.origin + path).replace(/\/$/, ''), base = slugBase(self), key = base.replace(/[^a-z0-9]/g, '');
  var e = libEntry(key), links = chapLinks(base), st = e ? seriesState(e, base) : null;
  // Kapitelliste: gelesene abdunkeln, aktuelles gelb umranden
  links.forEach(function (x) {
    var mode = !st ? '' : (st.c && x.n === st.c.n ? 'c' : (x.n <= st.r ? 'r' : ''));
    if (x.a.getAttribute('data-mhub') === mode) return;
    x.a.setAttribute('data-mhub', mode);
    x.a.style.opacity = mode === 'r' ? '0.45' : '';
    // Umrandung aufs innere Element, wenn der Link selbst nur eine Textzeile ist
    var box = (getComputedStyle(x.a).display === 'inline' && x.a.firstElementChild) || x.a;
    box.style.outline = mode === 'c' ? '2px solid #ffc21a' : '';
    box.style.outlineOffset = mode === 'c' ? '-2px' : '';
  });
  var adds = get(ADD), sig = JSON.stringify([self, st, !!adds[self], links.length]);
  if (card && sig === cardKey) return;
  cardKey = sig;
  if (!card) {
    card = document.createElement('div'); card.id = 'mhub-card';
    card.style.cssText = 'position:fixed;left:8px;right:8px;margin-left:auto;bottom:calc(60px + env(safe-area-inset-bottom, 0px));z-index:2147483646;display:flex;align-items:center;gap:10px;' +
      'background:#1f1c2c;color:#ece9f6;border:1px solid #913fe2;border-radius:14px;padding:8px 8px 8px 12px;box-shadow:0 4px 18px rgba(0,0,0,.55);font:500 13px/1.3 system-ui,sans-serif;max-width:460px';
    (document.body || document.documentElement).appendChild(card);
  }
  card.innerHTML = '';
  var info = document.createElement('div'); info.style.cssText = 'flex:1;min-width:0';
  var l1 = document.createElement('div'), l2 = document.createElement('div');
  l1.style.cssText = 'font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
  l2.style.cssText = 'font-size:12px;color:#9893b0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
  info.appendChild(l1); info.appendChild(l2); card.appendChild(info);
  if (!e) {
    l1.textContent = adds[self] ? L('✓ Kommt in den Hub', '✓ Going to your hub') : L('Nicht in deinem Hub', 'Not in your hub');
    l2.textContent = adds[self] ? L('als „Geplant“, sobald der Hub offen ist', 'as “Plan to read” once the hub is open') : L('Als „Geplant“ merken?', 'Save as “Plan to read”?');
    if (!adds[self]) card.appendChild(cardBtn(L('+ Zum Hub', '+ Add to hub'), function () {
      var ad = get(ADD); ad[self] = { t: Date.now() }; put(ADD, ad);
      var dv = get(DISC); if (dv[self]) { dv[self].ack = false; put(DISC, dv); }
      else if (!discSeen[self]) { discSeen[self] = 1; discQ.unshift({ url: self, title: document.title, rating: null, ch: null, chUrl: null, imgSrc: '' }); if (!discBusy) runDisc(); }
      cardKey = ''; seriesCard();
    }, true));
    return;
  }
  l1.textContent = st.c ? L('Kapitel ', 'Chapter ') + st.c.n + ' · ' + st.c.pct + ' %' : (st.r ? L('Gelesen bis Kapitel ', 'Read up to chapter ') + st.r : L('Noch nicht angefangen', 'Not started yet'));
  var open = e.m ? Math.max(0, Math.floor(e.m) - Math.floor(st.r)) : 0;
  l2.textContent = L('Im Hub', 'In your hub') + (e.m ? ' · ' + (open ? open + L(' offen', ' unread') : L('alles gelesen', 'all caught up')) : '');
  if (st.n == null) return;
  // Bevorzugt auf dieser Seite weiterlesen, sonst der Link aus dem Hub
  var here = links.filter(function (x) { return x.n === st.n; })[0], url = here ? here.u : (st.c && st.c.url) || e.u;
  if (!url) return;
  if (st.c && st.c.pct > 2 && st.c.pct < 95) url = url.replace(/#.*$/, '') + '#mhub-' + st.c.pct;
  card.appendChild(cardBtn(st.c ? L('Weiterlesen', 'Continue') : (st.r ? L('Kapitel ', 'Chapter ') + st.n : L('Lesen', 'Read')), function () { location.href = url; }, true));
}

function copyAll() {
  save(true);
  var t = token(true);
  if (!t) { flash(L('Noch nichts gemerkt', 'Nothing saved yet')); return; }
  GM_setClipboard(t, 'text');
  var cv = get(COV); Object.keys(cv).forEach(function (k) { if (!cv[k].ack) cv[k].sent = (cv[k].sent || 0) + 1; }); put(COV, cv);
  flash(L('✓ Kopiert. Für einen anderen Browser', '✓ Copied. For another browser'));
}

function route() {
  if (location.pathname === path) return;
  save(true);
  teardownReader();
  path = location.pathname; box = null; imgCount = -1;
  if (card) { card.remove(); card = null; }
  if (CH.test(path.toLowerCase())) {
    var e = get(LOG)[location.origin + path], target = (e && e.pct) || 0;
    var anc = e && e.i != null ? { i: e.i, f: e.f, n: e.n } : null;
    var hm = location.hash.match(/mhub-(\d{1,3})/);
    if (hm) {
      // Kommt der Stand von einem anderen Gerät, passt der lokale Anker nicht mehr
      if (!e || Math.abs(e.pct - +hm[1]) > 3) anc = null;
      target = +hm[1];
      try { history.replaceState(history.state, '', location.pathname + location.search); } catch (err) {}
    }
    cur = target;
    pill.style.display = 'block'; pill.textContent = '📖 ' + cur + ' %';
    cleanBtn.style.display = 'block'; cleanLabel();
    // Gerade per Doppeltipp gewechselt? Zu Original: Leiste kurz zeigen. Zu „Nur Bilder“: nichts einblenden.
    var sw = null; try { sw = JSON.parse(GM_getValue('mhub_switch', 'null')); } catch (err) {}
    if (sw && Date.now() - sw.t < 15000) {
      GM_setValue('mhub_switch', 'null');
      if (sw.to === 'clean') { quietUntil = Date.now() + 20000; hideDock(); } else showDock(4000);
    } else showDock(3000);
    curA = null;
    savedT = target; savedA = anc;
    var myPath = path;
    prepareReader(function () {
      if (path !== myPath) return;
      if (target > 2 && target < 95) restore(target, anc); else onScroll();
    });
  } else {
    pill.style.display = 'none'; cleanBtn.style.display = 'none';
    cardKey = ''; setTimeout(seriesCard, 800);
    clearTimeout(dockT); dock.style.opacity = '1'; dock.style.pointerEvents = 'auto';
    if (SERIES.test(path)) {
      setTimeout(function () { grabCover(false); }, 1500);
      var self = (location.origin + path).replace(/\/$/, '');
      if (!get(DISC)[self] && !discSeen[self]) { discSeen[self] = 1; discQ.unshift({ url: self, title: document.title, rating: null, ch: null, chUrl: null, imgSrc: '' }); }
    }
    clearTimeout(discT); discT = setTimeout(discover, 2500);
  }
}

// Tipp auf die Prozentanzeige: zurück an die Stelle, an der du das Kapitel zuletzt verlassen hattest
pill.addEventListener('click', function () {
  if (!isChapter()) { copyAll(); return; }
  if (restoring) return;
  if (savedT > 2 && savedT < 95 && Math.abs(cur - savedT) > 1) restore(savedT, savedA);
  else flash(savedT > 2 && savedT < 95 ? L('Du bist schon an deiner Stelle', 'You are already at your spot') : L('Noch keine gespeicherte Stelle', 'No saved spot yet'));
});
window.addEventListener('scroll', function () {
  onScroll();
  if (!isChapter()) { clearTimeout(discT); discT = setTimeout(discover, 2000); }
}, { passive: true });
window.addEventListener('pagehide', function () { save(true); });
document.addEventListener('visibilitychange', function () { if (document.hidden) save(true); });
if (typeof GM_registerMenuCommand === 'function') {
  GM_registerMenuCommand(L('Stand kopieren', 'Copy progress'), copyAll);
  GM_registerMenuCommand(L('Cover dieser Seite merken', 'Save cover of this page'), function () { grabCover(true); });
}
setInterval(function () { route(); if (isChapter()) onScroll(); else { seriesCard(); refreshRel(); } }, 1200);
route();
if (!isChapter()) flash(L('📖 Manhwa Hub aktiv', '📖 Manhwa Hub active'));

})({ GM_getValue: GM_getValue, GM_setValue: GM_setValue, GM_setClipboard: GM_setClipboard,
  GM_xmlhttpRequest: GM_xmlhttpRequest, GM_registerMenuCommand: GM_registerMenuCommand,
  GM_addValueChangeListener: typeof GM_addValueChangeListener === 'function' ? GM_addValueChangeListener : null,
  uw: typeof unsafeWindow !== 'undefined' ? unsafeWindow : null });
