// ==UserScript==
// @name         Manhwa Hub
// @namespace    manhwa-hub
// @version      3.31.0
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
var VERSION = '3.31.0';
var HUB_DEFAULT = 'https://claude.ai/artifact/8Ntpoy1ewrkkFitaHPioqk';
var SITES = ['asura', 'thunder'];
var CH = /(?:^|[^a-z])(?:chapter|chap|ch|kapitel|episode|ep)[-_\/ .]?\d/;
var SERIES = /\/(?:series|manga|manhwa|manhua|comics?|title|webtoon|novels?)\/[^\/]+\/?$/;
// Cover: Zielgröße und Qualitätsstufe (ältere Stufen werden einmal neu geholt). Hier oben, weil auch der Hub-Teil sie braucht
var COVER_W = 600, COVER_H = 800, COVER_Q = 2;
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
  var p = Object.keys(l).map(function (k) { return { url: k, pct: l[k].pct, t: l[k].t, site: l[k].site || 0, d: l[k].d || 0 }; });
  var c = Object.keys(cv).filter(function (k) { return !cv[k].ack && (!forClipboard || (cv[k].sent || 0) < 2); })
    .map(function (k) { return { url: k, img: cv[k].img, title: cv[k].title, q: cv[k].q || 0 }; });
  var dd = get(DISC), d = Object.keys(dd).filter(function (k) { return !dd[k].ack; }).slice(0, forClipboard ? 30 : 150)
    .map(function (k) { var e = dd[k]; return { url: k, title: e.title, rating: e.rating, ch: e.ch, chUrl: e.chUrl, img: e.img, site: e.site, g: e.g, desc: e.desc, type: e.type, rel: e.rel, ss: e.ss || '', q: e.q || 0 }; });
  var a = forClipboard ? [] : Object.keys(get(ADD));
  var rr = get('mhub_rate'), r = Object.keys(rr).map(function (k) { return { k: k, r: rr[k].r, t: rr[k].t }; });
  if (!p.length && !c.length && !d.length && !a.length && !r.length) return '';
  return 'MHUB2:' + btoa(unescape(encodeURIComponent(JSON.stringify({ p: p, c: c, d: d, a: a, r: r }))));
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
  // Serie auf anderen Scan-Seiten suchen (MHUB-FIND): Suchseite abrufen, Treffer mit dem passendsten Titel wählen,
  // dessen Kapitel-Links an den Hub schicken. Nur eigene Hilfen: die Variablen der Scan-Seiten-Teile gibt es hier nicht.
  var keyT = function (t) { return String(t || '').toLowerCase().replace(/&[a-z]+;/g, ' ').replace(/[^a-z0-9]+/g, ''); };
  var wordsT = function (t) { return String(t || '').toLowerCase().split(/[^a-z0-9]+/).filter(function (w) { return w.length > 1; }); };
  var titleScore = function (a, b) {
    var ka = keyT(a), kb = keyT(b); if (!ka || !kb) return 0;
    if (ka === kb) return 1;
    if (Math.min(ka.length, kb.length) >= 8 && (ka.indexOf(kb) > -1 || kb.indexOf(ka) > -1)) return 0.9;
    var wa = wordsT(a), wb = wordsT(b), hit = wa.filter(function (w) { return wb.indexOf(w) > -1; }).length;
    return hit / Math.max(wa.length, wb.length, 1);
  };
  var CHN = /(?:chapter|chap|ch|episode|ep)[-_\/ .]?(\d+(?:[-_.]\d+)?)/i;
  var SERP = /\/(?:series|manga|manhwa|manhua|comics?|title|webtoon)\/[^\/?#]+\/?$/i;
  var hostOfU = function (u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } };
  var absU = function (h, base) { try { var u = new URL(h, base); return u.origin + u.pathname; } catch (e) { return ''; } };
  // Links auf Serienseiten derselben Seite, mit allen Namen, die dabei stehen (Linktext, title, Bild-alt)
  var seriesHits = function (doc, base, host) {
    var out = {};
    [].forEach.call(doc.querySelectorAll('a[href]'), function (a) {
      var u = absU(a.getAttribute('href'), base); if (!u || hostOfU(u) !== host) return;
      var p = new URL(u).pathname; if (!SERP.test(p) || CHN.test(p)) return;
      u = u.replace(/\/$/, '');
      var img = a.querySelector('img'), names = [a.getAttribute('title'), (a.textContent || '').replace(/\s+/g, ' ').trim(), img && img.getAttribute('alt')];
      out[u] = (out[u] || []).concat(names.filter(function (x) { return x && x.length < 200; }));
    });
    return out;
  };
  // Kapitel-Links einer Serienseite: Links (und Adressen im Seitentext) mit Kapitelnummer, die zur Serie gehören
  var chaptersOf = function (html, page) {
    var doc = new DOMParser().parseFromString(html, 'text/html'), host = hostOfU(page), ppath = new URL(page).pathname.replace(/\/$/, '');
    var slug = ppath.split('/').pop().toLowerCase().replace(/-[a-z0-9]{8}$/, function (m) { return /\d/.test(m) ? '' : m; });
    var found = {}, add = function (u) {
      if (!u || hostOfU(u) !== host) return;
      var p = new URL(u).pathname.toLowerCase(), m = p.match(CHN);
      if (!m || (p.indexOf(ppath.toLowerCase() + '/') !== 0 && p.indexOf(slug) < 0)) return;
      var n = parseFloat(m[1].replace(/[-_]/, '.'));
      if (!isNaN(n) && n < 100000 && !found[n]) found[n] = u;
    };
    [].forEach.call(doc.querySelectorAll('a[href]'), function (a) { add(absU(a.getAttribute('href'), page)); });
    var t = html.replace(/\\+\//g, '/'), re = /(?:https?:\/\/[^"'\s<>\\]+)?\/[^"'\s<>\\]*(?:chapter|chap|ch|episode|ep)[-_\/ .]?\d+(?:[-_.]\d+)?\/?/gi, m;
    while ((m = re.exec(t))) add(absU(m[0], page));
    return Object.keys(found).map(function (n) { return [+n, found[n]]; }).sort(function (a, b) { return a[0] - b[0]; });
  };
  var findOn = function (titles, site, cb) {
    var q = encodeURIComponent(titles[0]), urls = [site.origin + '/?s=' + q, site.origin + '/series?name=' + q, site.origin + '/search?q=' + q], i = 0;
    (function step() {
      if (i >= urls.length) return cb(null);
      var su = urls[i++];
      fetchText(su, function (html) {
        if (!html) return step();
        var hits = seriesHits(new DOMParser().parseFromString(html, 'text/html'), su, site.host), best = null;
        Object.keys(hits).forEach(function (u) {
          var sc = 0, slugName = u.split('/').pop().replace(/-[a-z0-9]{8}$/, '').replace(/[-_]+/g, ' ');
          hits[u].concat([slugName]).forEach(function (nm) { titles.forEach(function (t) { sc = Math.max(sc, titleScore(nm, t)); }); });
          if (sc >= 0.6 && (!best || sc > best.sc)) best = { u: u, sc: sc, name: hits[u][0] || slugName };
        });
        if (!best) return step();
        fetchText(best.u, function (page) {
          var ch = page ? chaptersOf(page, best.u) : [];
          cb(ch.length ? { page: best.u, title: best.name, ch: ch.slice(-3000) } : null);
        });
      });
    })();
  };
  // Ältere, kleine Cover neu holen (MHUB-COVERS: [{id, page}]): og:image der Serienseite, größte srcset-Variante dazu
  var absFull = function (h, base) { try { return new URL(h, base).href; } catch (e) { return ''; } };
  var coverOfPage = function (html, page) {
    var doc = new DOMParser().parseFromString(html, 'text/html'), og = doc.querySelector('meta[property="og:image"],meta[name="twitter:image"]');
    var ogU = og && og.content ? absFull(og.content, page) : ''; if (!ogU) return '';
    var fileOf = function (u) { return u.split(/[?#]/)[0].split('/').pop(); }, base = fileOf(ogU), best = ogU, bw = 0;
    [].forEach.call(doc.querySelectorAll('img[srcset],source[srcset]'), function (im) {
      String(im.getAttribute('srcset')).split(',').forEach(function (part) {
        var m = part.trim().match(/^(\S+)\s+(\d+)w$/); if (!m) return;
        var u = absFull(m[1], page), q = ''; try { q = new URL(m[1], page).searchParams.get('url') || ''; } catch (e) {}
        if (q) u = absFull(q, page);
        if (fileOf(u) === base && +m[2] > bw) { bw = +m[2]; best = u; }
      });
    });
    return best;
  };
  var runCovers = function (jobs) {
    if (!Array.isArray(jobs)) return;
    var i = 0;
    (function next() {
      if (i >= jobs.length) return;
      var j = jobs[i++];
      fetchText(j.page, function (html) {
        var u = html ? coverOfPage(html, j.page) : '';
        var done = function (img) { post('MHUB-COVEROK:' + JSON.stringify({ id: j.id, img: img || '', q: COVER_Q })); setTimeout(next, 1200); };
        if (!u) return done('');
        shrink(u, done, j.w);
      });
    })();
  };
  var runFind = function (o) {
    if (!o || !Array.isArray(o.sites) || !Array.isArray(o.titles) || !o.titles.length) return;
    var i = 0, found = 0;
    (function next() {
      if (i >= o.sites.length) { post('MHUB-FINDEND:' + JSON.stringify({ id: o.id, found: found })); return; }
      var site = o.sites[i++];
      findOn(o.titles, site, function (r) {
        if (r) { found++; post('MHUB-SRCFOUND:' + JSON.stringify({ id: o.id, host: site.host, page: r.page, title: r.title, ch: r.ch })); }
        setTimeout(next, 700);
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
    else if (d.indexOf('MHUB-PREFS:') === 0) GM_setValue('mhub_prefs', d.slice(11));
    else if (d === 'MHUB-RELOAD' && topMode) location.reload();
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
          // Der Hub hat das Bild: hier nicht weiter aufheben, sonst wird der Speicher groß und langsam
          if (dv[u] && (!dv[u].ack || dv[u].img)) { dv[u].ack = true; delete dv[u].img; ch2 = true; }
          if (ad[u]) { delete ad[u]; ch3 = true; }
        });
        if (ch) put(COV, cv);
        if (ch2) put(DISC, dv);
        if (ch3) put(ADD, ad);
      } catch (err) {}
    }
    else if (d.indexOf('MHUB-CHECK:') === 0) { try { runCheck(JSON.parse(d.slice(11))); } catch (err) {} }
    else if (d.indexOf('MHUB-COVERS:') === 0) { try { runCovers(JSON.parse(d.slice(12))); } catch (err) {} }
    else if (d.indexOf('MHUB-FIND:') === 0) { try { runFind(JSON.parse(d.slice(10))); } catch (err) {} }
    else if (d.indexOf('MHUB-IMG:') === 0) {
      try { var o = JSON.parse(d.slice(9)); shrink(o.url, function (img) { post('MHUB-IMGOK:' + JSON.stringify({ id: o.id, img: img })); }); } catch (err) {}
    }
  });
  if (GM_addValueChangeListener) {
    GM_addValueChangeListener(LOG, function (n, o, v, remote) { if (remote) send(); });
    GM_addValueChangeListener(COV, function (n, o, v, remote) { if (remote) send(); });
    GM_addValueChangeListener(DISC, function (n, o, v, remote) { if (remote) send(); });
    GM_addValueChangeListener(ADD, function (n, o, v, remote) { if (remote) send(); });
    GM_addValueChangeListener('mhub_rate', function (n, o, v, remote) { if (remote) send(); });
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
// Zurück zum Hub: Kapitel öffnet der Hub in einem neuen Tab, der Hub-Tab ist also noch offen.
// Darum zuerst diesen Tab schließen (kein Neuladen, kein Wechsel in die Claude-App). Erlaubt Firefox das nicht, die Hub-Adresse aufrufen.
homeBtn.addEventListener('click', function () {
  save(true);
  var home = GM_getValue('mhub_home', '') || HUB_DEFAULT;
  try { window.close(); } catch (e) {}
  setTimeout(function () { location.href = home; }, 250);
});
dock.id = 'mhub-dock';
var cleanBtn = document.createElement('div');
cleanBtn.setAttribute('role', 'button');
cleanBtn.style.cssText = 'display:none;background:#17121f;color:#fff;padding:9px 11px;border-radius:999px;box-shadow:0 3px 12px rgba(0,0,0,.45);cursor:pointer;border:1px solid #3a3350;font-size:13px';
function cleanLabel() { cleanBtn.textContent = cleanOn() ? 'Original' : L('Nur Bilder', 'Images only'); cleanBtn.setAttribute('aria-label', cleanOn() ? L('Originalseite anzeigen', 'Show original page') : L('Nur die Bilder anzeigen', 'Show images only')); }
// Kurz abblenden, damit man das Nachjustieren der Stelle nicht sieht
function fadeCover(on) {
  var f = document.getElementById('mhub-fade');
  if (on) {
    if (!f) { f = document.createElement('div'); f.id = 'mhub-fade'; f.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:#000;z-index:2147483645;pointer-events:none;opacity:1;transition:opacity .2s'; (document.body || document.documentElement).appendChild(f); }
    f.style.opacity = '1'; clearTimeout(fadeCover.t); fadeCover.t = setTimeout(function () { fadeCover(false); }, 2500); return;
  }
  clearTimeout(fadeCover.t);
  if (f) { f.style.opacity = '0'; setTimeout(function () { if (f.parentNode && f.style.opacity === '0') f.parentNode.removeChild(f); }, 250); }
}
// Zwischen Original und „Nur Bilder“ wechseln, ohne die Seite neu zu laden: die versteckte Originalseite wird
// wieder gezeigt (oder der Leser neu gebaut) und die Stelle über den Anker (Bild + Anteil) übernommen.
// Danach zeigt sich die Leiste nur beim Wechsel zu Original.
var switching = false, quietUntil = 0;
function toggleMode() {
  if (switching) return;
  switching = true;
  var toOrig = cleanOn();
  var a = anchor() || curA, p = measure(); if (p < 0) p = cur;
  if (p >= 0) { cur = p; curA = a; dirty = true; }
  save(true);
  GM_setValue(CLEAN_KEY, toOrig ? '0' : '1');
  // Nach einem Wechsel per Wischen zeigt die versteckte Originalseite noch das alte Kapitel: dann sauber neu laden
  if (inlineNav) {
    GM_setValue('mhub_switch', JSON.stringify({ to: toOrig ? 'orig' : 'clean', t: Date.now() }));
    location.reload(); return;
  }
  asStop(true); dropPeek(); dropNext(); fadeCover(true);
  var finish = function () {
    resetBox(); findBox();
    var end = function () { fadeCover(false); switching = false; onScroll(); };
    if (p > 2 && p < 95) restore(p, a, { quiet: true, fast: true, done: end });
    else { window.scrollTo(0, p >= 95 ? document.documentElement.scrollHeight : 0); end(); }
    cleanLabel();
    if (toOrig) showDock(4000, true); else { quietUntil = Date.now() + 20000; hideDock(); }
  };
  if (toOrig) { teardownReader(); pre = {}; curDoc = null; setTimeout(finish, 60); }
  else prepareReader(function () { finish(); setTimeout(prefetchNeighbors, 300); });
}
cleanBtn.addEventListener('click', toggleMode);
// Vorrat für unterwegs: nur im Modus „Nur Bilder“
var stockBtn = document.createElement('div');
stockBtn.setAttribute('role', 'button'); stockBtn.setAttribute('aria-label', L('Nächste Kapitel für unterwegs laden', 'Load next chapters for offline'));
stockBtn.textContent = '⬇';
stockBtn.style.cssText = 'display:none;background:#17121f;color:#fff;padding:9px 12px;border-radius:999px;box-shadow:0 3px 12px rgba(0,0,0,.45);cursor:pointer;border:1px solid #3a3350;font-size:13px';
stockBtn.addEventListener('click', function () { stockUp(); });
dock.appendChild(pill); dock.appendChild(stockBtn); dock.appendChild(cleanBtn); dock.appendChild(homeBtn);
// In Kapiteln ist die Leiste versteckt. Ein Tipp blendet sie ein und aus, ein Doppeltipp wechselt zwischen Original und „Nur Bilder“.
var dockT = 0;
function showDock(ms, force) {
  if (!force && Date.now() < quietUntil) return;
  stockBtn.style.display = reader && isChapter() ? 'block' : 'none';
  dock.style.opacity = '1'; dock.style.pointerEvents = 'auto';
  clearTimeout(dockT);
  if (isChapter()) dockT = setTimeout(hideDock, ms || 3000);
}
function hideDock() { if (!isChapter()) return; dock.style.opacity = '0'; dock.style.pointerEvents = 'none'; }
var lastTap = 0, tapX = 0, tapY = 0, tapMoved = false, singleT = 0;
function dockShown() { return dock.style.opacity !== '0'; }
// Tipps auf Links und Knöpfe der Seite gehören der Seite
function pageControl(el) { return el && el.closest && el.closest('a,button,input,textarea,select,label,[role="button"],[onclick]') && !(reader && reader.contains(el)); }
window.addEventListener('touchstart', function () { tapMoved = false; }, { passive: true, capture: true });
window.addEventListener('touchmove', function () { tapMoved = true; }, { passive: true, capture: true });
window.addEventListener('touchend', function (e) {
  if (!isChapter() || tapMoved || e.touches.length || dock.contains(e.target)) return;
  var t = e.changedTouches[0], now = Date.now();
  if (now - lastTap < 350 && Math.abs(t.clientX - tapX) < 40 && Math.abs(t.clientY - tapY) < 40) { lastTap = 0; clearTimeout(singleT); toggleMode(); }
  else {
    lastTap = now; tapX = t.clientX; tapY = t.clientY;
    if (pageControl(e.target)) return;
    // Einfacher Tipp: kurz abwarten, ob ein zweiter folgt, dann Leiste ein- oder ausblenden
    clearTimeout(singleT);
    singleT = setTimeout(function () { if (!isChapter() || switching) return; if (dockShown()) { clearTimeout(dockT); hideDock(); } else showDock(3000, true); }, 360);
  }
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
  readerStyle.textContent = 'html,body{background:#000!important;overflow-x:hidden!important;overflow-y:auto!important;margin:0!important}' +
    'body>*:not(#mhub-reader):not(#mhub-dock):not(#mhub-nav):not(#mhub-peek):not(#mhub-fade):not(#mhub-next){display:none!important}' +
    '#mhub-nav{display:flex!important;flex-wrap:wrap;gap:8px;max-width:var(--mhub-w,820px);margin:0 auto;padding:18px 12px 120px;background:#000;font:700 15px system-ui,sans-serif}' +
    '#mhub-nav a{flex:1;display:flex;align-items:center;justify-content:center;min-height:52px;border-radius:12px;background:#2a2639;color:#ece9f6;text-decoration:none;text-align:center;padding:0 10px}' +
    '#mhub-nav a.nx{background:#913fe2;color:#fff;flex:1.4}#mhub-nav span{flex:1.4;display:flex;align-items:center;justify-content:center;color:#9893b0}' +
    // pan-y: der Browser scrollt senkrecht selbst und muss nie auf das Skript warten; waagerecht gehört dem Wischen
    '#mhub-reader{display:block!important;background:#000;padding:0;margin:0;touch-action:pan-y pinch-zoom}' +
    '#mhub-reader img,#mhub-next img{display:block;width:100%;max-width:var(--mhub-w,820px);height:auto;margin:0 auto;border:0}#mhub-next{display:block!important;background:#000}';
  applyWidth();
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
  resetBox();
  window.scrollTo(0, 0);
  return true;
}
function teardownReader() {
  dropNext();
  if (readerObs) { readerObs.disconnect(); readerObs = null; }
  if (reader && reader.parentNode) reader.parentNode.removeChild(reader);
  if (readerStyle && readerStyle.parentNode) readerStyle.parentNode.removeChild(readerStyle);
  if (readerNav && readerNav.parentNode) readerNav.parentNode.removeChild(readerNav);
  reader = null; readerStyle = null; readerSrcs = {}; readerNav = null;
}
var CHPART = /((?:chapter|chap|ch|episode|ep)[-_\/ .]?)(\d+(?:[-_.]\d+)?)/i;
// Vorheriges/nächstes Kapitel und Serienseite. Links stammen von der Seite; fehlt einer, wird er gebaut, wenn der Hub das Kapitel kennt
// root/pth: für ein anderes, schon geholtes Kapitel (Vorrat); sonst das offene
function chapterTargets(root, pth) {
  root = root || curDoc || document; pth = pth || path;
  var m = pth.match(CHPART); if (!m) return null;
  var n = parseFloat(m[2].replace(/[-_]/, '.')), head = pth.slice(0, m.index), strip = function (p) { return p.toLowerCase().replace(CHPART, '#'); };
  var found = {}, me = strip(pth);
  root.querySelectorAll('a[href]').forEach(function (a) {
    var u = absUrl(a.getAttribute('href')), k = chOf(u);
    if (k == null || strip(pathOf(u)) !== me || new URL(u).hostname !== location.hostname) return;
    if (!found[k]) found[k] = u;
  });
  var key = slugBase(head.replace(/[-_\/]+$/, '')).replace(/[^a-z0-9]/g, ''), e = key ? libEntry(key) : null;
  var make = function (k) { return location.origin + pth.replace(CHPART, function (all, a) { return a + k; }); };
  var prevN = Math.ceil(n) - 1, nextN = Math.floor(n) + 1;
  var prev = found[prevN] || (prevN >= 1 ? make(prevN) : '');
  var next = found[nextN] || (e && e.m >= nextN ? make(nextN) : '');
  var home = head.replace(/[-_\/]+$/, ''), homeUrl = isSeriesUrl(location.origin + home) ? location.origin + home : '';
  return { prev: prev, prevN: prevN, next: next, nextN: nextN, homeUrl: homeUrl, n: n, key: key, lib: e };
}
// Beim Verlassen die echte Stelle speichern, damit man beim Zurückkommen dort landet. Fast am Ende zählt als fertig
function leaveChapter() {
  var m = measure(); if (m >= 0) { cur = m; curA = anchor() || curA; }
  if (cur >= 85) { cur = 100; curA = null; }
  dirty = true; save(true);
}
function goNext(url) { if (reader && prefs().swipe) return slideTo(url, 1); leaveChapter(); location.href = url; }
function goPrev(url) { if (reader && prefs().swipe) return slideTo(url, -1); leaveChapter(); location.href = url; }
function chapterNav() {
  var t = chapterTargets(); if (!t) return null;
  var prev = t.prev, prevN = t.prevN, next = t.next, nextN = t.nextN, homeUrl = t.homeUrl;
  var nav = document.createElement('div'); nav.id = 'mhub-nav';
  var link = function (href, text, cls) {
    var a = document.createElement('a'); a.href = href; a.textContent = text; if (cls) a.className = cls;
    // Nächstes Kapitel: dieses als fertig gelesen speichern
    if (cls === 'nx') a.addEventListener('click', function (ev) { ev.preventDefault(); goNext(href); });
    else if (/‹/.test(text)) a.addEventListener('click', function (ev) { ev.preventDefault(); goPrev(href); });
    else a.addEventListener('click', function () { save(true); });
    nav.appendChild(a);
  };
  var card = endCard(t); if (card) nav.appendChild(card);
  if (prev) link(prev, '‹ ' + prevN);
  if (homeUrl) link(homeUrl, L('Serie', 'Series'));
  if (next) link(next, L('Kapitel ', 'Chapter ') + nextN + ' ›', 'nx');
  else { var sp = document.createElement('span'); sp.textContent = L('Neuestes Kapitel ✓', 'Latest chapter ✓'); nav.appendChild(sp); }
  // Klicks nicht an die Seite weitergeben (Werbe-Fenster)
  nav.addEventListener('click', function (ev) { ev.stopPropagation(); });
  return nav;
}
// Karte am Kapitelende: wie viel noch offen ist; aufgeholt: nächster Termin, Wertung (falls noch keine), nächste Serie der Warteschlange
var RATE = 'mhub_rate';
function endCard(t) {
  var e = t.lib; if (!e) return null;
  var left = e.m ? Math.max(0, Math.floor(e.m) - Math.floor(t.n)) : 0;
  var card = document.createElement('div'); card.id = 'mhub-end';
  card.style.cssText = 'flex:1 1 100%;box-sizing:border-box;background:#17121f;border:1px solid #2a2639;border-radius:12px;padding:12px 14px;color:#ece9f6;font:500 14px/1.4 system-ui,sans-serif;text-align:left';
  var row = function (txt, css) { var d = document.createElement('div'); d.textContent = txt; if (css) d.style.cssText = css; card.appendChild(d); return d; };
  row(L('Ende von Kapitel ', 'End of chapter ') + t.n + ' · ' + (left ? left + L(' offen', ' unread') : L('aufgeholt', 'all caught up')), 'font-weight:700;color:#fff');
  if (left) return card;
  if (e.ss === 'done') row(L('Die Serie ist abgeschlossen.', 'The series is completed.'), 'color:#ffc21a');
  else if (e.ss === 'hiatus') row(L('Die Serie pausiert gerade (Hiatus).', 'The series is on hiatus.'), 'color:#ffc21a');
  else if (e.nx) row(L('Nächstes Kapitel ~', 'Next chapter ~') + new Date(e.nx).toLocaleDateString(L('de-DE', 'en-GB'), { weekday: 'short', day: 'numeric', month: 'short' }), 'color:#ffc21a');
  var mine = (get(RATE)[t.key] || {}).r || e.rt;
  if (!mine) {
    row(L('Wie fandest du sie bisher?', 'How do you like it so far?'), 'margin-top:8px;color:#9893b0;font-size:13px');
    var stars = document.createElement('div'); stars.style.cssText = 'display:flex;gap:4px;margin-top:6px;flex-wrap:wrap';
    for (var i = 1; i <= 10; i++) (function (v) {
      var b = document.createElement('button'); b.type = 'button'; b.textContent = v;
      b.style.cssText = 'flex:1;min-width:26px;height:34px;border:0;border-radius:8px;background:#2a2639;color:#ece9f6;font:700 13px system-ui,sans-serif';
      b.addEventListener('click', function (ev) {
        ev.preventDefault(); var all = get(RATE); all[t.key] = { r: v, t: Date.now() }; put(RATE, keep(all, 30));
        stars.textContent = '★ ' + v + L(' gespeichert, geht an den Hub', ' saved, goes to your hub'); stars.style.cssText = 'margin-top:6px;color:#ffc21a';
      });
      stars.appendChild(b);
    })(i);
    card.appendChild(stars);
  }
  if (e.q && e.q.u) {
    var a = document.createElement('a'); a.href = e.q.u; a.textContent = L('Als Nächstes: ', 'Up next: ') + e.q.t + ' · ' + L('Kapitel ', 'Chapter ') + e.q.n + ' ›';
    a.style.cssText = 'display:block;margin-top:10px;padding:10px 12px;border-radius:10px;background:#913fe2;color:#fff;text-decoration:none;font-weight:700';
    a.addEventListener('click', function () { leaveChapter(); });
    card.appendChild(a);
  }
  return card;
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
    if (document.images.length < 3 && textLen() > 4000) return done();
    if (++tries > 24) return done();
    setTimeout(t, 500);
  })();
}
/* ---------- Lesen am PC: Auto-Scroll, Klick blättert, Mausrad-Tempo, Tasten ----------
   Einstellungen kommen vom Hub (MHUB-PREFS, gespeichert als mhub_prefs). Nur mit Maus (pointer: fine), am Handy bleibt alles wie es ist. */
var DESK = !!(window.matchMedia && matchMedia('(pointer: fine)').matches);
function prefs() {
  var p = {}; try { p = JSON.parse(GM_getValue('mhub_prefs', '{}')) || {}; } catch (e) {}
  return { auto: p.auto || 'key', speed: p.speed || 2, wheel: +p.wheel || 1, click: p.click !== false, swipe: p.swipe !== false, preload: p.preload !== false, width: +p.width || 820, endless: p.endless !== false };
}
// Bildbreite im Modus „Nur Bilder“ (Regler im Hub). 1600 heißt: volle Breite
function applyWidth() {
  var w = prefs().width;
  document.documentElement.style.setProperty('--mhub-w', w >= 1600 ? '100%' : w + 'px');
}
var AS_SPEEDS = [0, 30, 55, 85, 120, 170, 240, 330], asOn = false, asLevel = 2, asLast = 0, asAcc = 0, asPill = null, asPillT = 0;
function asShow(text) {
  if (!asPill) {
    asPill = document.createElement('div'); asPill.id = 'mhub-as';
    asPill.style.cssText = 'position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:2147483647;background:rgba(23,18,31,.92);color:#fff;border:1px solid #913fe2;' +
      'padding:7px 14px;border-radius:999px;font:600 13px system-ui,sans-serif;pointer-events:none;transition:opacity .3s';
    document.body.appendChild(asPill);
  }
  asPill.textContent = text; asPill.style.opacity = '1';
  clearTimeout(asPillT); asPillT = setTimeout(function () { if (asPill) asPill.style.opacity = '0'; }, 1600);
}
function asTick(t) {
  if (!asOn) return;
  var dt = Math.min(64, t - asLast); asLast = t;
  asAcc += AS_SPEEDS[asLevel] * dt / 1000;
  var px = Math.floor(asAcc);
  if (px) { window.scrollBy(0, px); asAcc -= px; }
  if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) { asStop(); asShow(L('Kapitelende', 'End of chapter')); return; }
  requestAnimationFrame(asTick);
}
function asStart() {
  if (asOn || !isChapter()) return;
  asOn = true; asLast = performance.now(); asAcc = 0;
  asShow('▶ ' + L('Auto-Scroll', 'Auto-scroll') + ' · ' + asLevel + '/7');
  requestAnimationFrame(asTick);
}
function asStop(quiet) { if (!asOn) return; asOn = false; if (!quiet) asShow('❚❚ ' + L('Pause', 'Paused')); }
function asSpeed(d) {
  asLevel = Math.max(0, Math.min(7, asLevel + d));
  if (!asLevel) { asLevel = 1; asStop(); return; }
  asShow('▶ ' + L('Tempo ', 'Speed ') + asLevel + '/7');
}
function autoStartWhenReady(myPath) {
  if (path !== myPath || !isChapter()) return;
  if (restoring || preparing) return setTimeout(function () { autoStartWhenReady(myPath); }, 500);
  setTimeout(function () { if (path === myPath) asStart(); }, 800);
}
var typing = function (e) { var t = e.target; return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)); };
var ours = function (el) { return el && el.closest && el.closest('#mhub-dock,#mhub-nav,#mhub-card,a,button,input,textarea,select,label'); };
if (DESK) {
  // Mausrad: während Auto-Scroll regelt es das Tempo, sonst scrollt es auf Wunsch weiter als normal
  window.addEventListener('wheel', function (e) {
    if (!isChapter() || e.ctrlKey) return;
    if (asOn) { e.preventDefault(); asSpeed(e.deltaY > 0 ? 1 : -1); return; }
    var f = prefs().wheel; if (f === 1) return;
    e.preventDefault();
    var k = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? window.innerHeight : 1;
    window.scrollBy(0, e.deltaY * k * f);
  }, { passive: false });
  // Klick blättert eine Bildschirmseite weiter, oberes Viertel zurück. Kurz warten, damit ein Doppelklick (Moduswechsel) nicht vorher blättert
  var clickT = 0;
  window.addEventListener('click', function (e) {
    if (!isChapter() || e.button !== 0 || ours(e.target) || !prefs().click) return;
    if (String(window.getSelection ? window.getSelection() : '').length) return;
    if (clickT) { clearTimeout(clickT); clickT = 0; return; }
    var up = e.clientY < window.innerHeight * 0.25;
    clickT = setTimeout(function () {
      clickT = 0;
      if (asOn) { asStop(); return; }
      window.scrollBy({ top: (up ? -1 : 1) * window.innerHeight * 0.85, behavior: 'smooth' });
    }, 260);
  }, true);
  window.addEventListener('mousemove', function (e) {
    if (!isChapter() || e.clientX < window.innerWidth - 220 || e.clientY < window.innerHeight - 140) return;
    if (!dockShown()) showDock(2500, true); else { clearTimeout(dockT); dockT = setTimeout(hideDock, 2500); }
  }, { passive: true });
  window.addEventListener('keydown', function (e) {
    if (!isChapter() || typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    var k = e.key, p = prefs();
    if ((k === 's' || k === 'S') && p.auto !== 'off') { e.preventDefault(); if (asOn) asStop(); else asStart(); }
    else if (k === ' ' && asOn) { e.preventDefault(); asStop(); }
    else if ((k === '+' || k === '=') && asOn) { e.preventDefault(); asSpeed(1); }
    else if (k === '-' && asOn) { e.preventDefault(); asSpeed(-1); }
    else if (k === 'ArrowRight' || k === 'n' || k === 'N') { var t = chapterTargets(); if (t && t.next) { e.preventDefault(); goNext(t.next); } else asShow(L('Neuestes Kapitel ✓', 'Latest chapter ✓')); }
    else if (k === 'ArrowLeft' || k === 'p' || k === 'P') { var t2 = chapterTargets(); if (t2 && t2.prev) { e.preventDefault(); goPrev(t2.prev); } }
    else if (k === 'Escape' && asOn) asStop();
  }, true);
}
/* ---------- Wischen zwischen Kapiteln (Handy, „Nur Bilder“) ----------
   Die Nachbarkapitel werden im Hintergrund geholt. Beim Wechsel gleiten deren Bilder herein, ohne die Seite neu zu laden.
   Findet das Skript die Bildadressen nicht im HTML, wird normal geladen, mit Animation. */
var pre = {}, curDoc = null, inlineNav = false, sw0 = null, swHint = null, peek = null;
// Sichtbare Breite: auf Seiten ohne Handy-Ansicht ist innerWidth die breite Desktop-Fläche
function viewW() { return Math.min(window.innerWidth, (window.visualViewport && window.visualViewport.width) || window.innerWidth); }
function hostOf(u) { try { return new URL(u, location.href).hostname; } catch (e) { return ''; } }
// Bildadressen eines Kapitels: gleiche Bild-Domain wie die aktuellen Seitenbilder, ohne Bilder, die auch sonst auf der Seite stehen
function imgsFromHtml(html, doc) {
  var mine = Object.keys(readerSrcs); if (!mine.length) return [];
  var cnt = {}; mine.forEach(function (u) { var h = hostOf(u); cnt[h] = (cnt[h] || 0) + 1; });
  var host = Object.keys(cnt).sort(function (a, b) { return cnt[b] - cnt[a]; })[0], skip = {}, out = [], seen = {};
  // Nur kleine Bilder der Seite (Logo, Symbole) aussortieren. Große versteckte Bilder können ein anderes Kapitel sein
  [].forEach.call(document.images, function (im) {
    if (reader.contains(im)) return;
    var aw = +im.getAttribute('width'), nw = im.naturalWidth;
    if ((aw > 0 && aw < 250) || (nw > 0 && nw < 250)) { var u = unproxy(imgSrc(im)); if (u) skip[u] = 1; }
  });
  var og = doc && doc.querySelector('meta[property="og:image"]'); if (og && og.content) skip[unproxy(og.content)] = 1;
  var add = function (u) { u = unproxy(u); if (!u || seen[u] || skip[u] || readerSrcs[u] || hostOf(u) !== host) return; seen[u] = 1; out.push(u); };
  if (doc) [].forEach.call(doc.images, function (im) { var w = +im.getAttribute('width'); if (!w || w >= 250) { var u = bestSrc(im); if (u) add(u); } });
  if (out.length < 3) {
    // Adressen im Seitentext, z. B. in den Daten von Next.js, mit maskierten Zeichen
    var t = html.replace(/\\+u002[fF]/g, '/').replace(/\\+\//g, '/').replace(/\\+u0026/g, '&').replace(/&amp;/g, '&'), m;
    var re = /(?:https?:)?\/\/[^"'\s<>()\\]+?\.(?:webp|jpe?g|png|avif|gif)(?:\?[^"'\s<>\\]*)?/gi;
    while ((m = re.exec(t))) add(m[0].indexOf('//') === 0 ? location.protocol + m[0] : m[0]);
  }
  return out;
}
// Gespeicherte Stelle in einem Kapitel (aus dem Lesestand), passend zu dessen Bildern
function ancFor(u, imgs) {
  var le = get(LOG)[String(u).replace(/[#?].*$/, '')];
  if (le && le.pct > 2 && le.pct < 95 && le.i != null && imgs && imgs.length && Math.abs((le.n || 0) - imgs.length) <= Math.max(2, imgs.length * 0.1)) return { i: Math.min(le.i, imgs.length - 1), f: le.f || 0 };
  return null;
}
// Kapitel holen (einmal), Ergebnis im Speicher pre[url] = {state: loading|ok|none, imgs, doc}; Wartende werden benachrichtigt
function fetchChapter(u) {
  if (pre[u] && pre[u].state !== 'none') return pre[u];
  var e = pre[u] = { state: 'loading', url: u, w: [], t: Date.now() };
  var fin = function () { var w = e.w; e.w = []; w.forEach(function (f) { try { f(); } catch (er) {} }); };
  fetch(u, { credentials: 'include' }).then(function (r) { return r.ok ? r.text() : ''; }).then(function (html) {
    var doc = html ? new DOMParser().parseFromString(html, 'text/html') : null, imgs = html ? imgsFromHtml(html, doc) : [];
    e.imgs = imgs; e.doc = doc; e.state = imgs.length >= 3 ? 'ok' : 'none';
    // Bilder dort vorladen, wo du weiterlesen würdest
    var a = ancFor(u, imgs), from = a ? Math.max(0, a.i - 1) : 0;
    if (e.state === 'ok' && prefs().preload) imgs.slice(from, from + 4).forEach(function (src) { var im = new Image(); im.decoding = 'async'; im.src = src; });
    fin();
  }).catch(function () { e.state = 'none'; fin(); });
  // Höchstens 8 Kapitel merken
  var ks = Object.keys(pre).filter(function (k) { return !pre[k].keep; }); if (ks.length > 8) ks.sort(function (a, b) { return pre[a].t - pre[b].t; }).slice(0, ks.length - 8).forEach(function (k) { if (k !== u) delete pre[k]; });
  return e;
}
// Wartet, bis ein Kapitel geholt ist (höchstens ms), dann cb(eintrag) oder cb(null)
function whenReady(u, ms, cb) {
  var e = fetchChapter(u);
  if (e.state !== 'loading') return cb(e.state === 'ok' ? e : null);
  var done = false, t = setTimeout(function () { if (!done) { done = true; cb(null); } }, ms);
  e.w.push(function () { if (done) return; done = true; clearTimeout(t); cb(e.state === 'ok' ? e : null); });
}
function prefetchNeighbors() {
  if (!reader || !prefs().swipe) return;
  var t = chapterTargets(); if (!t) return;
  [t.next, t.prev].forEach(function (u) { if (u) fetchChapter(u); });
}
// Das aktuelle Kapitel merken, bevor es verlassen wird: Zurückwischen braucht dann nichts zu laden
function rememberCurrent() {
  if (!reader) return;
  var u = location.origin + path, imgs = [].map.call(reader.querySelectorAll('img'), function (im) { return im.getAttribute('src'); }).filter(Boolean);
  if (imgs.length >= 3) pre[u] = { state: 'ok', url: u, imgs: imgs, doc: curDoc || document, w: [], t: Date.now() };
}
function moveReader(x, ms) {
  [reader, readerNav].forEach(function (el) {
    if (!el) return;
    el.style.transition = ms ? 'transform ' + ms + 'ms ease-out' : 'none';
    el.style.transform = x ? 'translateX(' + x + 'px)' : '';
  });
}
// Anfang des Nachbarkapitels als Ebene neben dem aktuellen: hängt beim Wischen am Finger
function makePeek(p, dir) {
  dropPeek();
  var d = document.createElement('div'); d.id = 'mhub-peek'; d._dir = dir;
  d.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100vh;overflow:hidden;z-index:2147483640;background:#000;pointer-events:none;will-change:transform;transform:translateX(' + (dir * viewW()) + 'px)';
  var a = ancFor(p.url, p.imgs), from = a ? Math.max(0, a.i - 1) : 0, inner = document.createElement('div'), els = [];
  inner.style.cssText = 'position:absolute;left:0;right:0;top:0';
  // Synchron zeichnen: sonst lässt der Browser die Bilder beim Springen der Seite darunter ein Bild lang weg (schwarz)
  p.imgs.slice(from, from + 4).forEach(function (src) { var i = new Image(); i.decoding = 'sync'; i.src = src; i.alt = ''; i.style.cssText = 'display:block;width:100%;max-width:var(--mhub-w,820px);height:auto;margin:0 auto'; if (i.decode) i.decode().catch(function () {}); inner.appendChild(i); els.push(i); });
  d.appendChild(inner);
  document.body.appendChild(d);
  // Wie restore(): Bild a.i, Anteil a.f liegt auf der Linie bei 30 % der Bildschirmhöhe
  if (a) {
    var lay = function () {
      var y = 0;
      for (var k = 0; k < els.length; k++) {
        if (!els[k].complete || !els[k].naturalWidth) return;
        if (from + k < a.i) y += els[k].offsetHeight; else { y += a.f * els[k].offsetHeight; break; }
      }
      inner.style.transform = 'translateY(' + Math.round(window.innerHeight * REF - y) + 'px)';
    };
    els.forEach(function (im) { im.addEventListener('load', lay); }); lay();
  }
  return (peek = d);
}
// Vorschau erst ausblenden, wenn die sichtbaren Bilder darunter fertig dekodiert sind (sonst ein schwarzes Bild)
function fadePeekWhenReady() {
  var vh = window.innerHeight, ims = reader ? [].filter.call(reader.querySelectorAll('img'), function (im) { var r = im.getBoundingClientRect(); return r.bottom > 0 && r.top < vh; }) : [];
  var wait = ims.map(function (im) { return im.decode ? im.decode().catch(function () {}) : Promise.resolve(); });
  Promise.race([Promise.all(wait), new Promise(function (r) { setTimeout(r, 700); })]).then(function () { requestAnimationFrame(fadePeek); });
}
// Vorschau ausblenden, wenn die echte Seite darunter an derselben Stelle steht
function fadePeek() {
  var pk = peek; peek = null; if (!pk) return;
  pk.style.transition = 'opacity .15s'; pk.style.opacity = '0';
  setTimeout(function () { if (pk.parentNode) pk.parentNode.removeChild(pk); }, 180);
}
function dropPeek() { if (peek && peek.parentNode) peek.parentNode.removeChild(peek); peek = null; }
function movePeek(x, ms) { if (!peek) return; peek.style.transition = ms ? 'transform ' + ms + 'ms ease-out' : 'none'; peek.style.transform = 'translateX(' + x + 'px)'; }
// dir 1 = weiter (Inhalt geht nach links), -1 = zurück
var sliding = false;
function slideTo(url, dir, swiped) {
  if (sliding) return;
  sliding = true;
  leaveChapter(); asStop(true);
  var e = fetchChapter(url);
  if (e.state === 'loading') {
    // Noch unterwegs: kurz warten statt neu zu laden, mit Hinweis
    moveReader(-dir * viewW() * 0.12, 160);
    loadingHint(dir, true);
  }
  whenReady(url, 4000, function (p) {
    loadingHint(dir, false);
    if (p) return doSlide(url, p, dir, swiped);
    // Bilder nicht zu finden: normal laden, mit Gleit-Animation
    dropPeek(); moveReader(-dir * viewW(), 200);
    GM_setValue('mhub_slide', JSON.stringify({ d: dir, t: Date.now(), s: swiped ? 1 : 0 }));
    setTimeout(function () { location.href = url; }, 190);
  });
}
function doSlide(url, p, dir, swiped) {
  var W = viewW();
  if (!peek || peek._dir !== dir) { makePeek(p, dir); peek.getBoundingClientRect(); }
  moveReader(-dir * W, 240); movePeek(0, 240);
  setTimeout(function () { swapChapter(url, p, dir, swiped); }, 250);
}
function loadingHint(dir, on) {
  if (!swHint) hint(dir > 0 ? -1 : 1, {});
  if (!on) { swHint.style.display = 'none'; return; }
  var t = chapterTargets() || {};
  swHint.textContent = (dir > 0 ? L('Kapitel ', 'Chapter ') + t.nextN : L('Kapitel ', 'Chapter ') + t.prevN) + ' …';
  swHint.style.left = dir > 0 ? '' : '12px'; swHint.style.right = dir > 0 ? '12px' : '';
  swHint.style.background = '#913fe2'; swHint.style.opacity = '1'; swHint.style.display = 'block';
}
function swapChapter(url, p, dir, swiped) {
  var u = new URL(url, location.href), a = ancFor(url, p.imgs);
  rememberCurrent();
  visitAct = !swiped; actScroll = 0; actY = 0;
  dropNext();
  if (readerObs) { readerObs.disconnect(); readerObs = null; }
  reader.innerHTML = ''; readerSrcs = {};
  p.imgs.forEach(function (src, k) {
    readerSrcs[src] = 1;
    var n = document.createElement('img'); n.src = src; n.alt = ''; n.decoding = a && k >= a.i - 1 && k <= a.i + 2 ? 'sync' : 'async'; if (k > (a ? a.i + 3 : 3)) n.loading = 'lazy';
    reader.appendChild(n);
  });
  // Erst den eigenen Pfad setzen, dann die Adresse: so baut route() nichts neu auf
  inlineNav = true; path = u.pathname; curDoc = p.doc;
  // Adresse ersetzen statt neuen Verlaufseintrag: der Tab bleibt schließbar (Hub-Knopf), Zurück führt direkt zum Hub
  try { history.replaceState({ mhub: 1 }, '', u.pathname + u.search); } catch (e) { location.href = url; return; }
  if (p.doc && p.doc.title) document.title = p.doc.title;
  resetBox();
  window.scrollTo(0, 0);
  if (readerNav && readerNav.parentNode) readerNav.parentNode.removeChild(readerNav);
  readerNav = chapterNav(); if (readerNav) { document.body.appendChild(readerNav); document.body.appendChild(dock); }
  moveReader(0, 0);
  // Die Vorschau zeigt schon genau diese Stelle und bleibt liegen, bis die Seite darunter dort steht
  enterChapter();
  sliding = false;
  setTimeout(prefetchNeighbors, 300);
}
// Stand des (neuen) Kapitels laden und an die gespeicherte Stelle springen
function enterChapter() {
  var sp = savedSpot(), target = sp.pct, anc = sp.anc;
  startTiming(sp.e);
  cur = target; curA = null; dirty = false; savedT = target; savedA = anc;
  pill.textContent = '📖 ' + cur + ' %';
  if (target > 2 && target < 95) {
    if (peek) { var pk = peek; setTimeout(function () { if (peek === pk) fadePeek(); }, 3000); restore(target, anc, { quiet: true, fast: true, done: fadePeekWhenReady }); }
    else { fadeCover(true); restore(target, anc, { quiet: true, fast: true, done: function () { fadeCover(false); } }); }
  } else { onScroll(); fadePeekWhenReady(); }
}
// Nach einem normalen Wechsel per Wischen: neues Kapitel von der Seite hereingleiten lassen
function slideIn() {
  var sl = null; try { sl = JSON.parse(GM_getValue('mhub_slide', 'null')); } catch (e) {}
  if (!sl || Date.now() - sl.t > 15000 || !reader) return;
  GM_setValue('mhub_slide', 'null');
  if (sl.s) { visitAct = false; actScroll = 0; actY = window.scrollY; }
  moveReader(sl.d * viewW(), 0);
  requestAnimationFrame(function () { requestAnimationFrame(function () { moveReader(0, 260); }); });
}
function hint(dx, tg) {
  if (!swHint) {
    swHint = document.createElement('div');
    swHint.style.cssText = 'position:fixed;top:50%;transform:translateY(-50%);z-index:2147483647;background:#913fe2;color:#fff;font:700 15px system-ui,sans-serif;padding:10px 14px;border-radius:999px;pointer-events:none;box-shadow:0 4px 16px rgba(0,0,0,.5)';
    document.body.appendChild(swHint);
  }
  var nx = dx < 0, ok = nx ? tg.next : tg.prev, W = viewW();
  swHint.textContent = ok ? (nx ? L('Kapitel ', 'Chapter ') + tg.nextN + ' ›' : '‹ ' + L('Kapitel ', 'Chapter ') + tg.prevN) : (nx ? L('Neuestes Kapitel ✓', 'Latest chapter ✓') : L('Erstes Kapitel', 'First chapter'));
  swHint.style.left = nx ? '' : '12px'; swHint.style.right = nx ? '12px' : '';
  swHint.style.background = ok && Math.abs(dx) > W * 0.28 ? '#913fe2' : 'rgba(23,18,31,.9)';
  swHint.style.opacity = String(Math.min(1, Math.abs(dx) / (W * 0.2)));
  swHint.style.display = 'block';
}
window.addEventListener('touchstart', function (e) {
  sw0 = null;
  if (!reader || !isChapter() || e.touches.length !== 1 || !prefs().swipe || preparing) return;
  var t = e.touches[0]; sw0 = { x: t.clientX, y: t.clientY, dx: 0, h: null };
}, { passive: true, capture: true });
window.addEventListener('touchmove', function (e) {
  if (!sw0) return;
  if (e.touches.length !== 1) { sw0 = null; moveReader(0, 150); dropPeek(); if (swHint) swHint.style.display = 'none'; return; }
  var t = e.touches[0], dx = t.clientX - sw0.x, dy = t.clientY - sw0.y;
  if (sw0.h === null) {
    if (Math.abs(dx) > 14 && Math.abs(dx) > Math.abs(dy) * 1.5) { sw0.h = true; sw0.tg = chapterTargets() || {}; sw0.x = t.clientX; dx = 0; }
    else if (Math.abs(dy) > 14) { sw0 = null; return; }
  }
  if (!sw0.h) return;
  sw0.dx = dx;
  var ok = dx < 0 ? sw0.tg.next : sw0.tg.prev, dir = dx < 0 ? 1 : -1, p = ok && fetchChapter(ok);
  moveReader(ok ? dx : dx * 0.25, 0);
  if (p && p.state === 'ok') { if (!peek || peek._dir !== dir) makePeek(p, dir); movePeek(dir * viewW() + dx, 0); if (swHint) swHint.style.display = 'none'; }
  else { dropPeek(); hint(dx, sw0.tg); }
}, { passive: true, capture: true });
function swipeEnd() {
  if (!sw0 || !sw0.h) { sw0 = null; return; }
  var dx = sw0.dx, url = dx < 0 ? sw0.tg.next : sw0.tg.prev; sw0 = null;
  if (swHint) swHint.style.display = 'none';
  if (url && Math.abs(dx) > viewW() * 0.28) slideTo(url, dx < 0 ? 1 : -1, true);
  else { moveReader(0, 200); if (peek) { movePeek(peek._dir * viewW(), 200); var pk = peek; peek = null; setTimeout(function () { if (pk.parentNode) pk.parentNode.removeChild(pk); }, 220); } }
}
window.addEventListener('touchend', swipeEnd, { passive: true, capture: true });
window.addEventListener('touchcancel', swipeEnd, { passive: true, capture: true });
// Zurück-Taste nach einem Wechsel ohne Laden: Seite sauber neu laden
window.addEventListener('popstate', function () { if (inlineNav) location.reload(); });
/* ---------- Endlos lesen (Einstellung „endless“, Modus „Nur Bilder“) ----------
   Kurz vor dem Kapitelende hängt das nächste Kapitel unter die Kapitel-Knöpfe (#mhub-next). Scrollst du hinein, wird es
   übergeben (handoff): das alte Kapitel gilt als fertig, seine Bilder fallen oben weg, die Stelle auf dem Bildschirm bleibt
   gleich. Danach ist alles wie bei einem normal geöffneten Kapitel (Anker, Stand, Wischen). */
var nextBox = null, nextBusy = false, noNextFor = '';
function dropNext() { if (nextBox && nextBox.parentNode) nextBox.parentNode.removeChild(nextBox); nextBox = null; nextBusy = false; }
function endlessTick() {
  if (!reader || !isChapter() || restoring || sliding || preparing) return;
  if (nextBox) return checkHandoff();
  if (nextBusy || noNextFor === path || !prefs().endless) return;
  var de = document.documentElement;
  if (window.scrollY + window.innerHeight < de.scrollHeight - window.innerHeight * 1.5) return;
  // Neuestes Kapitel: nicht bei jedem Scrollen neu suchen
  var t = chapterTargets(); if (!t || !t.next) { noNextFor = path; return; }
  nextBusy = true;
  var myPath = path;
  whenReady(t.next, 8000, function (p) {
    nextBusy = false;
    if (p && path === myPath && reader && !nextBox) appendNext(t.next, t.nextN, p);
    else if (!p) noNextFor = myPath;
  });
}
function appendNext(url, n, p) {
  var b = document.createElement('div'); b.id = 'mhub-next'; b._url = url; b._p = p;
  var h = document.createElement('div'); h.textContent = L('Kapitel ', 'Chapter ') + n;
  h.style.cssText = 'max-width:var(--mhub-w,820px);margin:0 auto;padding:26px 12px 16px;color:#9893b0;font:700 14px system-ui,sans-serif;text-align:center';
  b.appendChild(h);
  p.imgs.forEach(function (src, k) { var im = document.createElement('img'); im.src = src; im.alt = ''; im.decoding = 'async'; if (k > 2) im.loading = 'lazy'; b.appendChild(im); });
  document.body.appendChild(b); nextBox = b;
  if (dock.parentNode) document.body.appendChild(dock);
}
// Übergabe, sobald der Anfang des neuen Kapitels über die Lese-Linie (30 % der Bildschirmhöhe) gescrollt ist
function checkHandoff() {
  var first = nextBox.querySelector('img'); if (!first) return;
  var top = first.getBoundingClientRect().top;
  if (top <= window.innerHeight * REF) handoff(first, top);
}
function handoff(first, top) {
  var b = nextBox, p = b._p, u = new URL(b._url, location.href);
  cur = 100; curA = null; dirty = true; visitAct = true; save(true);
  rememberCurrent();
  if (readerObs) { readerObs.disconnect(); readerObs = null; }
  var imgs = [].slice.call(b.querySelectorAll('img'));
  reader.innerHTML = ''; readerSrcs = {};
  imgs.forEach(function (im) { readerSrcs[im.getAttribute('src')] = 1; reader.appendChild(im); });
  b.parentNode.removeChild(b); nextBox = null;
  if (readerNav && readerNav.parentNode) readerNav.parentNode.removeChild(readerNav);
  inlineNav = true; path = u.pathname; curDoc = p.doc;
  try { history.replaceState({ mhub: 1 }, '', u.pathname + u.search); } catch (e) {}
  if (p.doc && p.doc.title) document.title = p.doc.title;
  readerNav = chapterNav(); if (readerNav) { document.body.appendChild(readerNav); document.body.appendChild(dock); }
  // Im selben Schritt zurückscrollen: das erste neue Bild steht wieder genau dort, wo es war
  window.scrollTo(0, first.getBoundingClientRect().top + window.scrollY - top);
  resetBox();
  var sp = savedSpot(); startTiming(sp.e); readT = Date.now();
  cur = 0; curA = null; dirty = true; savedT = sp.pct; savedA = sp.anc; visitAct = true; actScroll = 0;
  pill.textContent = '📖 0 %';
  onScroll();
  setTimeout(prefetchNeighbors, 300);
}

/* ---------- Vorrat für unterwegs (Knopf ⬇ in der Leiste, Modus „Nur Bilder“) ----------
   Holt die nächsten STOCK_N Kapitel samt allen Bildern. Die Bilder bleiben im Speicher dieses Tabs (p.held) und
   kommen beim Wischen oder Endlos-Lesen ohne Netz. Die Kapitel sind vor dem Aufräumen des Kapitel-Speichers geschützt (p.keep). */
var STOCK_N = 5, stocking = false;
function loadImgs(list, cb) {
  var i = 0, ok = 0, active = 0, held = [];
  var pump = function () {
    if (i >= list.length && !active) return cb(ok, held);
    while (active < 3 && i < list.length) {
      var im = new Image(); active++; held.push(im);
      im.onload = function () { ok++; active--; pump(); };
      im.onerror = function () { active--; pump(); };
      im.src = list[i++];
    }
  };
  pump();
}
function stockUp() {
  if (stocking || !reader) return;
  stocking = true;
  var n = 0, pics = 0, t = chapterTargets(), url = t && t.next;
  var done = function () { stocking = false; flash(n ? '⬇ ' + n + L(' Kapitel bereit (', ' chapters ready (') + pics + L(' Bilder)', ' images)') : L('Kein weiteres Kapitel gefunden', 'No further chapter found')); };
  (function step() {
    if (!url || n >= STOCK_N) return done();
    flash('⬇ ' + L('Lade Kapitel ', 'Loading chapter ') + (n + 1) + '/' + STOCK_N + ' …');
    whenReady(url, 15000, function (p) {
      if (!p) return done();
      p.keep = true;
      loadImgs(p.imgs, function (ok, held) {
        p.held = held; pics += ok; n++;
        var nt = chapterTargets(p.doc, new URL(p.url).pathname);
        url = nt && nt.next; step();
      });
    });
  })();
}
/* ---------- Lesestand: messen, speichern, an die Stelle springen ---------- */
// Bilderblock des Kapitels: kleinster Behälter mit den meisten großen Bildern. Läuft bei jedem Scrollen und ist
// deshalb gemerkt. Neu gesucht wird, wenn sich die Bildanzahl ändert, ohne Treffer höchstens alle 300 ms
var boxAt = 0;
function resetBox() { box = null; imgCount = -1; bigImgs = []; }
function findBox() {
  var imgs = document.images;
  if (imgs.length === imgCount && (box ? box.isConnected : Date.now() - boxAt < 300)) return box;
  imgCount = imgs.length; boxAt = Date.now(); box = null; bigImgs = [];
  var big = [];
  // Bilder der Wisch-Vorschau gehören nicht zum Kapitel
  for (var i = 0; i < imgs.length; i++) if (imgs[i].clientWidth >= 250 && !(peek && peek.contains(imgs[i])) && !(nextBox && nextBox.contains(imgs[i]))) big.push(imgs[i]);
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
  var H = document.documentElement.scrollHeight;
  if (bigImgs.length < 3 && H >= vh * 2.5 && textLen() > 4000) return { top: 0, height: H };
  return null;
}
// Textmenge der Seite. innerText ist teuer (baut den ganzen Text zusammen), darum höchstens alle 2 s neu
var txtLen = 0, txtAt = 0;
function textLen() {
  var now = Date.now();
  if (now - txtAt > 2000) { txtAt = now; txtLen = document.body ? (document.body.innerText || '').length : 0; }
  return txtLen;
}
// Gespeicherte Stelle dieses Kapitels: Prozent, Anker (Bild + Anteil) und der Eintrag selbst
function savedSpot() {
  var e = get(LOG)[location.origin + path];
  return { e: e, pct: (e && e.pct) || 0, anc: e && e.i != null ? { i: e.i, f: e.f, n: e.n } : null };
}
function measure() {
  var b = contentBox(); if (!b) return -1;
  var vh = window.innerHeight, y = window.scrollY;
  return Math.max(0, Math.min(100, Math.round((y + vh - b.top) / b.height * 100)));
}
// Per Wischen betretene Kapitel zählen erst, wenn du darin wirklich scrollst (visitAct). Sonst kein Stand, kein „angefangen“
var visitAct = true, actScroll = 0, actY = 0;
function trackAct() {
  if (visitAct || restoring || !isChapter()) { actY = window.scrollY; return; }
  actScroll += Math.abs(window.scrollY - actY); actY = window.scrollY;
  if (actScroll > window.innerHeight * 0.8) { visitAct = true; dirty = true; }
}
// Aktive Lesezeit im Kapitel (d, in ms) für die Restzeit im Hub: Zeit zwischen Scroll-Bewegungen, Pausen über 45 s zählen nicht
var readMs = 0, readT = 0;
function startTiming(prev) { readMs = (prev && prev.d) || 0; readT = 0; }
function tickRead() {
  if (restoring || !isChapter()) return;
  var now = Date.now();
  if (readT && now - readT < 45000) readMs += now - readT;
  readT = now;
}
function save(force) {
  if (!dirty || !visitAct) return;
  var now = Date.now(); if (!force && now - lastWrite < 2000) return;
  var l = get(LOG), en = { pct: cur, t: now };
  if (curA) { en.i = curA.i; en.f = curA.f; en.n = curA.n; }
  if (readMs) en.d = Math.round(readMs);
  l[location.origin + path] = en;
  put(LOG, keep(l, 60)); lastWrite = now; dirty = false;
}
function update() {
  queued = false;
  endlessTick();
  if (!isChapter()) return;
  if (restoring || preparing) return;
  var p = measure();
  if (p < 0) return;
  var a = anchor();
  var moved = a && (!curA || a.i !== curA.i || Math.abs(a.f - curA.f) > 0.01);
  if (a) curA = a;
  if (p !== cur || moved) { cur = p; dirty = true; save(false); }
  if (Date.now() > flashUntil) { var pt = '📖 ' + cur + ' %'; if (pill.textContent !== pt) pill.textContent = pt; }
}
// Beim Öffnen an die letzte Stelle springen. Bilder laden nach, deshalb wird kurz nachjustiert,
// bis die Position stabil ist oder du selbst scrollst.
// o.quiet: ohne Meldung, o.fast: schneller nachjustieren, o.done: wenn die Stelle steht
function restore(target, anc, o) {
  o = o || {};
  if (!(target > 2 && target < 95)) { if (o.done) o.done(); return; }
  restoring = true; touched = false;
  var t0 = Date.now(), lastY = -1;
  if (!o.quiet) flash(L('↩ Springe zu ', '↩ Jumping to ') + target + ' %');
  var iv = setInterval(function () {
    var done = function () { clearInterval(iv); restoring = false; onScroll(); if (o.done) o.done(); };
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
  }, o.fast ? 120 : 400);
}
['touchstart', 'wheel', 'keydown', 'mousedown'].forEach(function (ev) {
  window.addEventListener(ev, function () { if (restoring) touched = true; }, { passive: true });
});
function onScroll() { if (!queued) { queued = true; requestAnimationFrame(update); } }

// Tipp auf die Prozentanzeige: zurück an die Stelle, an der du das Kapitel zuletzt verlassen hattest
pill.addEventListener('click', function () {
  if (!isChapter()) { copyAll(); return; }
  if (restoring) return;
  if (savedT > 2 && savedT < 95 && Math.abs(cur - savedT) > 1) restore(savedT, savedA);
  else flash(savedT > 2 && savedT < 95 ? L('Du bist schon an deiner Stelle', 'You are already at your spot') : L('Noch keine gespeicherte Stelle', 'No saved spot yet'));
});
/* ---------- Cover der Serienseite merken ----------
   Bis 600×800, damit es auch auf Handys mit hoher Pixeldichte scharf ist (nie größer als das Original).
   Stark verkleinert wird in Halbschritten, sonst wirkt das Bild krisselig. Das Ergebnis bleibt unter 170 000
   Zeichen, damit es in ein Cloud-Dokument passt. COVER_Q: Qualitätsstufe; ältere Cover werden einmal neu geholt. */
function coverData(bmp, maxW) {
  var W = Math.min(maxW || COVER_W, Math.max(Math.min(360, maxW || 360), Math.round(bmp.width))), H = Math.round(W * COVER_H / COVER_W);
  var k = Math.max(W / bmp.width, H / bmp.height), w = bmp.width * k, h = bmp.height * k;
  var src = bmp, sw = bmp.width, sh = bmp.height;
  while (sw / 2 >= w) {
    var t = document.createElement('canvas'); t.width = Math.round(sw / 2); t.height = Math.round(sh / 2);
    var tg = t.getContext('2d'); tg.imageSmoothingQuality = 'high'; tg.drawImage(src, 0, 0, t.width, t.height);
    src = t; sw = t.width; sh = t.height;
  }
  var c = document.createElement('canvas'); c.width = W; c.height = H;
  var g = c.getContext('2d'); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  g.drawImage(src, (W - w) / 2, (H - h) / 2, w, h);
  var d = '', qs = [0.86, 0.78, 0.7, 0.6];
  for (var i = 0; i < qs.length; i++) {
    d = c.toDataURL('image/webp', qs[i]);
    if (d.indexOf('data:image/webp') !== 0) d = c.toDataURL('image/jpeg', qs[i] + 0.04);
    if (d.length < 170000) break;
  }
  return d;
}
// maxW: kleinere Vorschau (Entdecken)
function shrink(src, cb, maxW) {
  GM_xmlhttpRequest({ method: 'GET', url: src, responseType: 'blob', timeout: 15000,
    onload: function (res) {
      if (res.status !== 200 || !res.response) return cb('');
      createImageBitmap(res.response).then(function (bmp) { cb(coverData(bmp, maxW)); }).catch(function () { cb(''); });
    },
    onerror: function () { cb(''); }, ontimeout: function () { cb(''); } });
}
// Bestes Cover der Seite: das Bild zum og:image (mit größter Variante aus srcset), sonst das größte Hochformat-Bild
// oben auf der Seite, dessen Alt-Text zum Titel passt, sonst og:image
function pageCoverUrl() {
  var og = document.querySelector('meta[property="og:image"],meta[name="twitter:image"]'), ogU = og && og.content ? unproxy(og.content) : '';
  var base = function (u) { return String(u).split(/[?#]/)[0].split('/').pop(); };
  var title = (document.querySelector('h1') || {}).textContent || '', best = null, bw = 0;
  [].forEach.call(document.images, function (im) {
    var nw = im.naturalWidth, nh = im.naturalHeight; if (!nw || !nh) return;
    var r = im.getBoundingClientRect(); if (r.top + window.scrollY > 1800 || r.width < 100) return;
    var ar = nw / nh, u = bestSrc(im); if (!u || ar < 0.5 || ar > 0.9) return;
    var sc = nw + (ogU && base(u) === base(ogU) ? 1e5 : 0) + (title && im.alt && normT(im.alt) === normT(title) ? 5e4 : 0);
    if (sc > bw) { bw = sc; best = u; }
  });
  return best || ogU;
}
function grabCover(force) {
  var key = location.origin + location.pathname, all = get(COV);
  if (all[key] && (all[key].q || 0) >= COVER_Q && !force) return;
  var u = pageCoverUrl(), t = document.querySelector('meta[property="og:title"]');
  if (!u) { if (force) flash(L('Kein Cover gefunden', 'No cover found')); return; }
  shrink(u, function (d) {
    if (!d) return;
    var cur = get(COV); cur[key] = { img: d, title: t ? t.content : document.title, t: Date.now(), q: COVER_Q };
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
        e.ss = siteStatus(doc);
      }
      var src = (og && og.content) || c.imgSrc;
      if (!src || /^data:/.test(src)) return cb(e);
      // 400 px breit: scharf in der Entdecken-Leiste auch bei hoher Pixeldichte
      shrink(src, function (d) { e.img = d; e.q = d ? 2 : 0; cb(e); }, 400);
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
  var desc = fullDesc(document), hg = headGenres(document), ss = siteStatus(document);
  var sig = JSON.stringify([list, mx, desc.length, hg, ss]);
  relDoneFor = path;
  if (e.relSig === sig) return;
  if (list.length) e.rel = list;
  if (desc && desc.length >= (e.desc || '').length) e.desc = desc;
  if (hg.length) e.g = mergeGenres(hg, e.g || []);
  if (ss) e.ss = ss;
  if (mx > (e.ch || 0)) { e.ch = mx; e.chUrl = mxU; }
  e.relSig = sig; e.ack = false; e.t = Date.now();
  put(DISC, keep(all, 150));
}
// Diese Serienseite selbst zum Entdecken vormerken (vorne in der Warteschlange)
function queueSelf(self) {
  if (discSeen[self]) return false;
  discSeen[self] = 1; discQ.unshift({ url: self, title: document.title, rating: null, ch: null, chUrl: null, imgSrc: '' });
  return true;
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
// Status der Serie auf der Seite („Status: Ongoing / Completed / Hiatus / Dropped“), auch als Beschriftung mit Wert daneben.
// Ergebnis: ongoing, done, hiatus, dropped oder ''
var STATUS_WORDS = [[/\b(completed?|finished|ended|abgeschlossen|beendet)\b/i, 'done'], [/\b(hiatus|on.?hold|paused|pausiert|season end)\b/i, 'hiatus'],
  [/\b(dropped|cancell?ed|discontinued|abgebrochen|eingestellt)\b/i, 'dropped'], [/\b(ongoing|on.?going|publishing|releasing|laufend)\b/i, 'ongoing']];
function siteStatus(root) {
  // Text mit Leerzeichen zwischen den Teilen, sonst wird aus „Status“ + „Completed“ ein Wort
  var spaced = function (el) { var w = el.ownerDocument.createTreeWalker(el, 4), out = [], n; while ((n = w.nextNode())) out.push(n.nodeValue); return out.join(' ').replace(/\s+/g, ' ').trim(); };
  var els = root.querySelectorAll('h1,h2,h3,h4,h5,h6,span,div,dt,th,td,b,strong,p,label,li');
  for (var i = 0; i < els.length; i++) {
    var el = els[i]; if (el.childElementCount > 3) continue;
    var t = spaced(el); if (t.length > 40) continue;
    var m = t.match(/^(?:status|stand)\s*:?\s*(.*)$/i); if (!m) continue;
    var val = m[1] || (el.nextElementSibling ? spaced(el.nextElementSibling) : '');
    for (var k = 0; k < STATUS_WORDS.length; k++) if (STATUS_WORDS[k][0].test(val.slice(0, 40))) return STATUS_WORDS[k][1];
  }
  return '';
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
      else if (queueSelf(self) && !discBusy) runDisc();
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
// Lesestand der Scan-Seite selbst: „Continue reading Chapter 10“
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
/* ---------- Start: Seitenwechsel erkennen, Ereignisse, Takt ---------- */
function route() {
  if (location.pathname === path) return;
  save(true);
  teardownReader();
  asStop(true);
  pre = {}; curDoc = null; dropPeek(); dropNext();
  path = location.pathname; resetBox();
  if (card) { card.remove(); card = null; }
  if (isChapter()) openChapter(); else openPage();
}
// Kapitelseite: Stand laden, Lesemodus aufbauen, an die Stelle springen
function openChapter() {
  var sp = savedSpot(), target = sp.pct, anc = sp.anc;
  startTiming(sp.e);
  var hm = location.hash.match(/mhub-(\d{1,3})/);
  if (hm) {
    // Kommt der Stand von einem anderen Gerät, passt der lokale Anker nicht mehr
    if (!sp.e || Math.abs(sp.e.pct - +hm[1]) > 3) anc = null;
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
    slideIn(); setTimeout(prefetchNeighbors, 300);
    asLevel = prefs().speed;
    if (DESK && prefs().auto === 'start') autoStartWhenReady(myPath);
  });
}
// Andere Seiten (Serienseite, Übersichten): Leiste zeigen, Karte mit Stand, Serien entdecken
function openPage() {
  pill.style.display = 'none'; cleanBtn.style.display = 'none';
  cardKey = ''; setTimeout(seriesCard, 800);
  clearTimeout(dockT); dock.style.opacity = '1'; dock.style.pointerEvents = 'auto';
  if (SERIES.test(path)) {
    setTimeout(function () { grabCover(false); }, 1500);
    var self = (location.origin + path).replace(/\/$/, '');
    if (!get(DISC)[self]) queueSelf(self);
  }
  clearTimeout(discT); discT = setTimeout(discover, 2500);
}

window.addEventListener('scroll', function () {
  trackAct(); tickRead();
  onScroll();
  if (!isChapter()) { clearTimeout(discT); discT = setTimeout(discover, 2000); }
}, { passive: true });
window.addEventListener('pagehide', function () { save(true); });
document.addEventListener('visibilitychange', function () { if (document.hidden) save(true); });
if (typeof GM_registerMenuCommand === 'function') {
  GM_registerMenuCommand(L('Stand kopieren', 'Copy progress'), copyAll);
  GM_registerMenuCommand(L('Cover dieser Seite merken', 'Save cover of this page'), function () { grabCover(true); });
}
// Lese-Einstellungen sofort übernehmen, auch in schon offenen Kapiteln (Bildbreite)
if (GM_addValueChangeListener) GM_addValueChangeListener('mhub_prefs', function () { if (reader) applyWidth(); });
setInterval(function () { route(); if (isChapter()) onScroll(); else { seriesCard(); refreshRel(); } }, 1200);
route();
if (!isChapter()) flash(L('📖 Manhwa Hub aktiv', '📖 Manhwa Hub active'));

})({ GM_getValue: GM_getValue, GM_setValue: GM_setValue, GM_setClipboard: GM_setClipboard,
  GM_xmlhttpRequest: GM_xmlhttpRequest, GM_registerMenuCommand: GM_registerMenuCommand,
  GM_addValueChangeListener: typeof GM_addValueChangeListener === 'function' ? GM_addValueChangeListener : null,
  uw: typeof unsafeWindow !== 'undefined' ? unsafeWindow : null });
