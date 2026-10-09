// ==UserScript==
// @name         Manhwa Hub
// @namespace    manhwa-hub
// @version      3.48.0
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
var VERSION = '3.48.0';
var HUB_DEFAULT = 'https://claude.ai/artifact/8Ntpoy1ewrkkFitaHPioqk';
var SITES = ['asura', 'thunder'];
var CH = /(?:^|[^a-z])(?:chapter|chap|ch|kapitel|episode|ep)[-_\/ .]?\d/;
var SERIES = /\/(?:series|manga|manhwa|manhua|comics?|title|webtoon|novels?)\/[^\/]+\/?$/;
// Cover: Zielgröße und Qualitätsstufe (ältere Stufen werden einmal neu geholt). Hier oben, weil auch der Hub-Teil sie braucht
var COVER_W = 600, COVER_H = 800, COVER_Q = 2;
var LOG = 'mhub_log', COV = 'mhub_cov', DISC = 'mhub_disc', LIB = 'mhub_lib', ADD = 'mhub_add';
/* Konstanten, die auch der Hub-Teil (01-hub) braucht: Er endet mit return, bevor die übrigen Dateien ihre var-Zeilen
   ausführen. Funktionen sind dort überall nutzbar (hoisting), Variablen nur, wenn sie hier oben stehen. */
var CHNUM = /(?:chapter|chap|ch|episode|ep)[-_\/ .]?(\d+(?:[-_.]\d+)?)/;
var MON = { jan: 0, feb: 1, mar: 2, 'mär': 2, mae: 2, apr: 3, may: 4, mai: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, okt: 9, nov: 10, dec: 11, dez: 11 };
var UNIT = [[/^(s|sec|secs|second|seconds|sek|sekunde|sekunden)$/, 1e3], [/^(m|min|mins|minute|minutes|minuten)$/, 6e4], [/^(h|hr|hrs|hour|hours|std|stunde|stunden)$/, 36e5],
  [/^(d|day|days|tag|tage|tagen)$/, 864e5], [/^(w|wk|wks|week|weeks|woche|wochen)$/, 6048e5], [/^(mo|mon|mons|month|months|monat|monate|monaten)$/, 2592e6], [/^(y|yr|yrs|year|years|jahr|jahre|jahren)$/, 31536e6]];
// Text-Hilfen für Beschreibungen (10-serieninfo): „Mehr anzeigen“-Knöpfe, Status-Wörter
var MORE_RE = /^(?:\.\.\.|…)?\s*(?:(?:read|show|see|view)\s+(?:more|less|all|full)|mehr(?:\s+anzeigen)?|weniger(?:\s+anzeigen)?|expand|collapse|\+\s*more)\s*(?:»|›|>|▼|▲)?$/i;
var STATUS_WORDS = [[/\b(completed?|finished|ended|abgeschlossen|beendet)\b/i, 'done'], [/\b(hiatus|on.?hold|paused|pausiert|season end)\b/i, 'hiatus'],
  [/\b(dropped|cancell?ed|discontinued|abgebrochen|eingestellt)\b/i, 'dropped'], [/\b(ongoing|on.?going|publishing|releasing|laufend)\b/i, 'ongoing']];
// Beschriftung alternativer Namen („Alternative:“, „Associated Names“ …), Gruppe 1 = Doppelpunkt
var ALT_LABEL = /^(?:alternative(?:\s+(?:titles?|names?))?|alt(?:\.|ernative)?\s*names?|associated\s+names?|other\s+names?|also\s+known\s+as|aka|synonyms?|alternativ(?:e)?\s*(?:titel|namen)?)\b\s*(:)?\s*/i;
function cutEnd(t) { return /(\.\.\.|…)\s*$/.test(t); }
/* Eine Serie unter einer Adresse: Asura verlinkt dieselbe Serie mal mit, mal ohne Kennung am Ende („overgeared-bd5bdaf8“
   und „overgeared“), beide funktionieren. Die Kennung (8 Hex-Zeichen mit Ziffer und Buchstabe) fällt weg. Kapitel-Adressen
   bleiben, wie sie sind. Gleiche Regel im Hub (canonUrl in 06-link). */
function canonUrl(u) {
  return String(u || '').replace(/^(https?:\/\/[^\/]+\/(?:[^\/?#]+\/)*[^\/?#]+?)-([0-9a-f]{8})(\/?)$/i, function (m, a, h, sl) { return /\d/.test(h) && /[a-f]/i.test(h) ? a + sl : m; });
}
function hostOf(u) { try { return new URL(u).hostname; } catch (e) { return ''; } }
// Datensparmodus aus den Lese-Einstellungen (ohne prefs() aus 04-pc, das im Hub-Teil nicht läuft)
function saveMode() { try { return (JSON.parse(GM_getValue('mhub_prefs', '{}')) || {}).save === true; } catch (e) { return false; } }
/* Warteschlange zum Entdecken (Seiten, die noch abgerufen werden müssen), im Tampermonkey-Speicher: überlebt das
   Weiterblättern und wird auf der nächsten Scan-Seite oder im offenen Hub weiter abgearbeitet. */
var DQ = 'mhub_discq', dqBusy = false, dqSendT = 0, DISC_KEEP = 300;
function dqGet() { try { var a = JSON.parse(GM_getValue(DQ, '[]')); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
function dqPut(a) { GM_setValue(DQ, JSON.stringify(a.slice(0, 400))); }

/* Serien-Schlüssel wie im Hub (slugOf + keyOf): Name aus der Adresse, ohne Kapitel und ohne wechselnde Kennung */
var SERIES_SEG = ['series', 'manga', 'manhwa', 'manhua', 'comic', 'comics', 'title', 'webtoon', 'novel', 'novels'];
function slugOfPath(p) {
  var seg = p.split('/').filter(Boolean), i = -1;
  for (var j = 0; j < seg.length; j++) if (SERIES_SEG.indexOf(seg[j]) > -1) { i = j; break; }
  var s = (i > -1 && seg[i + 1]) ? seg[i + 1] : (seg.filter(function (x) { return /(?:^|-)(?:chapter|chap|ch|episode|ep)-?\d/.test(x); })[0] || seg[0] || '');
  s = s.replace(/[-_]?(?:chapter|chap|ch|episode|ep)[-_]?\d+(?:[-_.]\d+)?.*$/, '');
  s = s.replace(/-[a-z0-9]{8}$/, function (m) { return /\d/.test(m) ? '' : m; });
  return s || seg[0] || '';
}
function seriesKeyOf(u) {
  var p = ''; try { p = new URL(u).pathname; try { p = decodeURIComponent(p); } catch (e) {} } catch (e) { return ''; }
  return slugOfPath(p.toLowerCase()).replace(/[^a-z0-9]/g, '');
}
// Neue Serien (noch nicht im Hub): erst nach deinem OK in den Hub, mit „gelesen bis“. {schlüssel: {ok, r, t}}
var NEWQ = 'mhub_newq';
function newDecision(k) { return get(NEWQ)[k] || null; }

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
  // Stand von Serien, die noch nicht im Hub sind, erst nach deinem OK (Abfrage beim Lesen, askNew)
  var nq = get(NEWQ), lib = GM_getValue(LIB, '');
  var p = Object.keys(l).filter(function (k) {
    if (!lib || forClipboard) return true;
    var key = seriesKeyOf(k); if (!key || libEntry(key)) return true;
    return !!(nq[key] && nq[key].ok);
  }).map(function (k) { return { url: k, pct: l[k].pct, t: l[k].t, site: l[k].site || 0, d: l[k].d || 0 }; });
  var n = Object.keys(nq).filter(function (k) { return nq[k].ok; }).map(function (k) { return { k: k, r: nq[k].r || 0 }; });
  var c = Object.keys(cv).filter(function (k) { return !cv[k].ack && (!forClipboard || (cv[k].sent || 0) < 2); })
    .map(function (k) { return { url: k, img: cv[k].img, title: cv[k].title, q: cv[k].q || 0 }; });
  var dd = get(DISC), d = Object.keys(dd).filter(function (k) { return !dd[k].ack; }).slice(0, forClipboard ? 30 : 150)
    .map(function (k) { var e = dd[k]; return { url: k, title: e.title, rating: e.rating, ch: e.ch, chUrl: e.chUrl, img: e.img, site: e.site, g: e.g, desc: e.desc, type: e.type, rel: e.rel, ss: e.ss || '', q: e.q || 0, feat: e.feat || 0, alt: e.alt || [], iu: e.iu || '' }; });
  var a = forClipboard ? [] : Object.keys(get(ADD));
  var rr = get('mhub_rate'), r = Object.keys(rr).map(function (k) { return { k: k, r: rr[k].r, t: rr[k].t }; });
  if (!p.length && !c.length && !d.length && !a.length && !r.length) return '';
  return 'MHUB2:' + btoa(unescape(encodeURIComponent(JSON.stringify({ p: p, c: c, d: d, a: a, r: r, n: n }))));
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
  // Cover neu holen (MHUB-COVERS: [{id, page, w}]): Bild der Serienseite in passender Größe (docCoverUrl).
  // Funde (w gesetzt): dq = Stufe im Hub, 3 = beste Quelle, 4 = groß (600 px, fürs Karussell)
  var runCovers = function (jobs) {
    if (!Array.isArray(jobs)) return;
    var i = 0;
    (function next() {
      if (i >= jobs.length) return;
      var j = jobs[i++];
      fetchText(j.page, function (html) {
        var doc = null; try { doc = html ? new DOMParser().parseFromString(html, 'text/html') : null; } catch (e) {}
        var ot = doc && doc.querySelector('meta[property="og:title"]');
        var og = doc && doc.querySelector('meta[property="og:image"],meta[name="twitter:image"]'), ogU = '';
        try { ogU = og && og.content ? new URL(og.content, j.page).href : ''; } catch (e) {}
        var us = (doc ? [docCoverUrl(doc, j.page, Math.round((j.w || COVER_W) * 1.5), ot && ot.content), ogU].concat(docMoreCovers(doc, j.page)) : []).concat(j.iu ? [j.iu] : []), desc = doc ? fullDesc(doc) : '';
        var done = function (img, w) { post('MHUB-COVEROK:' + JSON.stringify({ id: j.id, img: img || '', q: COVER_Q, dq: j.w >= 600 && w >= 570 ? 4 : 3, desc: desc })); setTimeout(next, 1200); };
        shrinkAny(us, done, j.w, j.page);
      });
    })();
  };
  // Gekürzte Beschreibungen neu holen (MHUB-DESC: [{id, page}]), ab Skript 3.34
  var runDescs = function (jobs) {
    if (!Array.isArray(jobs)) return;
    var i = 0;
    (function next() {
      if (i >= jobs.length) return;
      var j = jobs[i++];
      fetchText(j.page, function (html) {
        var desc = ''; try { if (html) desc = fullDesc(new DOMParser().parseFromString(html, 'text/html')); } catch (e) {}
        post('MHUB-DESCOK:' + JSON.stringify({ id: j.id, desc: desc }));
        setTimeout(next, 1200);
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
    else if (d.indexOf('MHUB-LIB:') === 0) {
      // Erst mit der Bibliothek weiß das Skript, welche Serien neu sind (zurückgehaltener Stand geht dann raus)
      var first = !GM_getValue(LIB, ''); GM_setValue(LIB, d.slice(9)); if (first) send();
    }
    else if (d.indexOf('MHUB-KNOWN:') === 0) GM_setValue('mhub_known', d.slice(11));
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
    else if (d.indexOf('MHUB-DESC:') === 0) { try { runDescs(JSON.parse(d.slice(10))); } catch (err) {} }
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
  if (isHub) {
    post('MHUB-CORE:' + VERSION); send();
    // Hub auf dem eigenen Server: der Hub-Knopf beim Lesen führt dorthin
    if (location.protocol === 'https:' && !/(^|\.)(claude\.ai|claudeusercontent\.com)$/.test(location.hostname)) GM_setValue('mhub_home', location.origin + location.pathname);
    // Was beim Stöbern noch nicht abgerufen wurde, hier im offenen Hub weiter abarbeiten
    var dqKick = function () { if (!document.hidden && dqGet().length) runDisc(); };
    setTimeout(dqKick, 3000);
    document.addEventListener('visibilitychange', dqKick);
    if (GM_addValueChangeListener) GM_addValueChangeListener(DQ, function (n, o, v, remote) { if (remote) setTimeout(dqKick, 2000); });
  }
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
var hideT = 0, discT = 0, discSeen = {};
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
    if (w > 0 && hgt > 0) { n.width = w; n.height = hgt; n.setAttribute('data-ok', '1'); } else holdSpace(n, guessRatio());
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
  // scroll-behavior: manche Seiten scrollen weich (CSS) – dann wären Sprünge des Lesers als schnelles Scrollen zu sehen
  readerStyle.textContent = 'html,body{background:#000!important;overflow-x:hidden!important;overflow-y:auto!important;margin:0!important;scroll-behavior:auto!important}' +
    'body>*:not(#mhub-reader):not(#mhub-dock):not(#mhub-nav):not(#mhub-peek):not(#mhub-fade):not(#mhub-next):not(#mhub-prev):not(#mhub-ask){display:none!important}' +
    '#mhub-nav{display:flex!important;flex-wrap:wrap;gap:8px;max-width:var(--mhub-w,820px);margin:0 auto;padding:18px 12px 120px;background:#000;font:700 15px system-ui,sans-serif}' +
    '#mhub-nav a{flex:1;display:flex;align-items:center;justify-content:center;min-height:52px;border-radius:12px;background:#2a2639;color:#ece9f6;text-decoration:none;text-align:center;padding:0 10px}' +
    '#mhub-nav a.nx{background:#913fe2;color:#fff;flex:1.4}#mhub-nav span{flex:1.4;display:flex;align-items:center;justify-content:center;color:#9893b0}' +
    // pan-y: der Browser scrollt senkrecht selbst und muss nie auf das Skript warten; waagerecht gehört dem Wischen
    '#mhub-reader{display:block!important;background:#000;padding:0;margin:0;touch-action:pan-y pinch-zoom}' +
    '#mhub-reader img,#mhub-next img,#mhub-prev img{display:block;width:100%;max-width:var(--mhub-w,820px);height:auto;margin:0 auto;border:0}#mhub-next,#mhub-prev{display:block!important;background:#000}' +
    // Noch nicht geladene Bilder nie als Scroll-Anker nehmen (ihre Höhe ändert sich noch)
    '#mhub-reader img:not([data-ok]),#mhub-next img:not([data-ok]){overflow-anchor:none}';
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
  // Nicht auf dieser Seite verlinkt: Adresse aus dem Hub (kann eine andere Seite sein, die das Kapitel schon hat)
  var next = found[nextN] || (e && e.x && e.x[String(nextN)]) || (e && e.m >= nextN ? make(nextN) : '');
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
  var other = next && hostOf(next) !== location.hostname ? hostOf(next).replace(/^www\./, '').split('.')[0] : '';
  if (next) link(next, L('Kapitel ', 'Chapter ') + nextN + (other ? L(' auf ', ' on ') + other.charAt(0).toUpperCase() + other.slice(1) : '') + ' ›', 'nx');
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
  return { auto: p.auto || 'key', speed: p.speed || 2, wheel: +p.wheel || 1, click: p.click !== false, swipe: p.swipe !== false, preload: p.preload !== false, width: +p.width || 820, endless: p.endless !== false, save: p.save === true };
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
var ours = function (el) { return el && el.closest && el.closest('#mhub-dock,#mhub-nav,#mhub-card,#mhub-ask,a,button,input,textarea,select,label'); };
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
  // Kapitel auf einer anderen Seite: kann hier nicht vorgeladen werden, Wischen/Weiter laden es dann normal
  if (hostOf(u) && hostOf(u) !== location.hostname) return (pre[u] = { state: 'none', url: u, w: [], t: Date.now() });
  var e = pre[u] = { state: 'loading', url: u, w: [], t: Date.now() };
  var fin = function () { var w = e.w; e.w = []; w.forEach(function (f) { try { f(); } catch (er) {} }); };
  fetch(u, { credentials: 'include' }).then(function (r) { return r.ok ? r.text() : ''; }).then(function (html) {
    var doc = html ? new DOMParser().parseFromString(html, 'text/html') : null, imgs = html ? imgsFromHtml(html, doc) : [];
    e.imgs = imgs; e.doc = doc; e.state = imgs.length >= 3 ? 'ok' : 'none';
    // Bilder dort vorladen, wo du weiterlesen würdest
    var a = ancFor(u, imgs), from = a ? Math.max(0, a.i - 1) : 0;
    if (e.state === 'ok' && prefs().preload && !prefs().save) imgs.slice(from, from + 4).forEach(function (src) { var im = new Image(); im.decoding = 'async'; im.src = src; });
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
  [reader, readerNav, prevBox, prevNav].forEach(function (el) {
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
  var ratio = guessRatio();
  reader.innerHTML = ''; readerSrcs = {};
  p.imgs.forEach(function (src, k) {
    readerSrcs[src] = 1;
    var n = document.createElement('img'); n.src = src; n.alt = ''; n.decoding = a && k >= a.i - 1 && k <= a.i + 2 ? 'sync' : 'async'; if (k > (a ? a.i + 3 : 3)) n.loading = 'lazy';
    holdSpace(n, ratio);
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
  if (e.target && e.target.closest && e.target.closest('#mhub-ask')) return;
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
   übergeben (handoff): das alte Kapitel gilt als fertig, das neue ist ab jetzt der Leser (Anker, Stand, Wischen).
   Beim Übergeben ändert sich am Bild nichts: kein Umbau, kein Scrollen, so bleibt ein laufender Wisch-Schwung (Firefox:
   asynchron) ungestört. Das alte Kapitel (#mhub-prev) fällt erst weg, wenn du kurz nicht scrollst und es weit genug
   oben liegt; die Stelle wird dabei im selben Schritt ausgeglichen. */
var nextBox = null, nextBusy = false, noNextFor = '', prevBox = null, prevNav = null, prevT = 0, lastScrollAt = 0, touchOn = false;
function dropNext() { if (nextBox && nextBox.parentNode) nextBox.parentNode.removeChild(nextBox); nextBox = null; nextBusy = false; dropPrev(); }
function dropPrev() {
  clearTimeout(prevT);
  [prevBox, prevNav].forEach(function (el) { if (el && el.parentNode) el.parentNode.removeChild(el); });
  prevBox = null; prevNav = null;
}
window.addEventListener('scroll', function () { lastScrollAt = Date.now(); }, { passive: true });
window.addEventListener('touchstart', function () { touchOn = true; }, { passive: true, capture: true });
['touchend', 'touchcancel'].forEach(function (ev) { window.addEventListener(ev, function () { touchOn = false; lastScrollAt = Date.now(); }, { passive: true, capture: true }); });
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
// Seitenverhältnis noch nicht geladener Bilder: wie die schon geladenen (Mittelwert), damit sie gleich ungefähr so hoch
// sind wie später. Sonst wären sie 0 hoch, und beim Nachladen verschiebt sich alles (der Browser hält evtl. ein falsches
// Bild fest: man springt nach vorn)
function guessRatio() {
  var ims = reader ? reader.querySelectorAll('img') : [], rs = [];
  for (var i = 0; i < ims.length && rs.length < 40; i++) if (ims[i].complete && ims[i].naturalWidth > 200) rs.push(ims[i].naturalHeight / ims[i].naturalWidth);
  if (!rs.length) return '800 / 1200';
  rs.sort(function (x, y) { return x - y; });
  return '1000 / ' + Math.round(rs[rs.length >> 1] * 1000);
}
function holdSpace(im, ratio) {
  if (im.complete && im.naturalWidth) { im.setAttribute('data-ok', '1'); return; }
  im.style.aspectRatio = 'auto ' + ratio;
  var ok = function () { im.setAttribute('data-ok', '1'); im.style.aspectRatio = ''; };
  im.addEventListener('load', ok); im.addEventListener('error', ok);
}
function appendNext(url, n, p) {
  var b = document.createElement('div'); b.id = 'mhub-next'; b._url = url; b._p = p;
  var h = document.createElement('div'); h.className = 'mhub-chhead'; h.textContent = L('Kapitel ', 'Chapter ') + n;
  h.style.cssText = 'max-width:var(--mhub-w,820px);margin:0 auto;padding:26px 12px 16px;color:#9893b0;font:700 14px system-ui,sans-serif;text-align:center';
  b.appendChild(h);
  var ratio = guessRatio();
  // Die ersten Bilder gleich laden: beim Übergang sind sie fertig und haben ihre Höhe
  p.imgs.forEach(function (src, k) { var im = document.createElement('img'); im.src = src; im.alt = ''; im.decoding = 'async'; if (k > 5) im.loading = 'lazy'; holdSpace(im, ratio); b.appendChild(im); });
  document.body.appendChild(b); nextBox = b;
  if (dock.parentNode) document.body.appendChild(dock);
}
// Übergabe, sobald der Anfang des neuen Kapitels über die Lese-Linie (30 % der Bildschirmhöhe) gescrollt ist
function checkHandoff() {
  var first = nextBox.querySelector('img'); if (!first) return;
  if (first.getBoundingClientRect().top <= window.innerHeight * REF) handoff();
}
function handoff() {
  var b = nextBox, p = b._p, u = new URL(b._url, location.href);
  cur = 100; curA = null; dirty = true; visitAct = true; save(true);
  rememberCurrent();
  if (readerObs) { readerObs.disconnect(); readerObs = null; }
  // Noch ein älteres Kapitel oben? Das jetzt entfernen (liegt weit oben), mit Ausgleich
  if (prevBox) trimPrev();
  // Altes Kapitel bleibt vorerst stehen, das neue wird der Leser. Nichts wird verschoben
  prevBox = reader; prevBox.id = 'mhub-prev'; prevNav = readerNav;
  reader = b; b.id = 'mhub-reader'; nextBox = null; readerSrcs = {};
  [].forEach.call(b.querySelectorAll('img'), function (im) { readerSrcs[im.getAttribute('src')] = 1; });
  ['click', 'mousedown', 'mouseup', 'touchend', 'pointerup', 'auxclick'].forEach(function (ev) { b.addEventListener(ev, function (e) { e.stopPropagation(); }, true); });
  inlineNav = true; path = u.pathname; curDoc = p.doc;
  try { history.replaceState({ mhub: 1 }, '', u.pathname + u.search); } catch (e) {}
  if (p.doc && p.doc.title) document.title = p.doc.title;
  // Neue Knöpfe ans Ende (unter das neue Kapitel, weit unten: verschiebt nichts Sichtbares)
  readerNav = chapterNav(); if (readerNav) { document.body.appendChild(readerNav); document.body.appendChild(dock); }
  resetBox();
  var sp = savedSpot(); startTiming(sp.e); readT = Date.now();
  cur = 0; curA = null; dirty = true; savedT = sp.pct; savedA = sp.anc; visitAct = true; actScroll = 0;
  pill.textContent = '📖 0 %';
  onScroll();
  prevLater();
  setTimeout(prefetchNeighbors, 300);
}
// Altes Kapitel entfernen, sobald du kurz nicht scrollst (kein Finger auf dem Bildschirm, kein Schwung mehr) und der
// Anfang des neuen Kapitels mindestens eine Bildschirmhöhe über dem Bildschirm liegt
function prevLater() {
  clearTimeout(prevT);
  prevT = setTimeout(function () {
    if (!prevBox || !reader) return;
    if (touchOn || Date.now() - lastScrollAt < 900 || sliding || restoring || reader.getBoundingClientRect().top > -window.innerHeight) return prevLater();
    trimPrev();
  }, 500);
}
function trimPrev() {
  var ref = reader.querySelector('img') || reader, t0 = ref.getBoundingClientRect().top;
  dropPrev();
  // Der Browser hält die Stelle evtl. schon selbst (Scroll-Anker); sonst hier ohne Bewegung ausgleichen
  var d = ref.getBoundingClientRect().top - t0;
  if (Math.abs(d) >= 1) window.scrollTo({ top: window.scrollY + d, left: 0, behavior: 'instant' });
  resetBox(); onScroll();
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
  for (var i = 0; i < imgs.length; i++) if (imgs[i].clientWidth >= 250 && !(peek && peek.contains(imgs[i])) && !(nextBox && nextBox.contains(imgs[i])) && !(prevBox && prevBox.contains(imgs[i]))) big.push(imgs[i]);
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
  // Nie hochrechnen: ein kleines Original bleibt klein (vergrößern macht es nur unschärfer und größer)
  var W = Math.max(1, Math.min(maxW || COVER_W, Math.round(bmp.width))), H = Math.round(W * COVER_H / COVER_W);
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
// maxW: kleinere Vorschau (Entdecken). cb(Bild, Breite des Ergebnisses)
// ref: Seite, von der das Bild stammt (manche Seiten liefern Bilder nur mit passendem Referer)
function shrink(src, cb, maxW, ref) {
  GM_xmlhttpRequest({ method: 'GET', url: src, responseType: 'blob', timeout: 15000, headers: ref ? { Referer: ref } : undefined,
    onload: function (res) {
      if (res.status !== 200 || !res.response) return cb('', 0);
      createImageBitmap(res.response).then(function (bmp) { cb(coverData(bmp, maxW), Math.min(maxW || COVER_W, bmp.width)); }).catch(function () { cb('', 0); });
    },
    onerror: function () { cb('', 0); }, ontimeout: function () { cb('', 0); } });
}
// Mehrere mögliche Bildadressen der Reihe nach probieren, bis eine klappt (manche Seiten sperren das Original
// hinter dem Bild-Proxy, manche Varianten gibt es nicht): erst die passende Größe, dann og:image, dann was die Seite zeigt
function shrinkAny(list, cb, maxW, ref) {
  var seen = {}, urls = (list || []).filter(function (u) { if (!u || /^data:/.test(u) || seen[u]) return false; seen[u] = 1; return true; }), i = 0;
  (function next() {
    if (i >= urls.length) return cb('', 0);
    shrink(urls[i++], function (d, w) { if (d) cb(d, w); else next(); }, maxW, ref);
  })();
}
/* Weitere Stellen, an denen Seiten ihr Cover haben, wenn og:image fehlt (z. B. Seiten, die erst per JavaScript
   aufgebaut werden, oder Cover als Hintergrundbild): itemprop/image_src, JSON-LD, Elemente mit „cover/thumb/poster“
   in der Klasse (Bild darin oder Hintergrundbild), zuletzt eine Bildadresse in den Seitendaten. Ergebnis: Liste. */
function bgUrl(el) {
  var st = (el.getAttribute && (el.getAttribute('style') || '')) || '', m = st.match(/background(?:-image)?\s*:[^;]*url\(\s*['"]?([^'")]+)['"]?\s*\)/i);
  return m ? m[1] : (el.getAttribute && (el.getAttribute('data-bg') || el.getAttribute('data-background') || el.getAttribute('data-bg-src'))) || '';
}
function docMoreCovers(doc, base) {
  var abs = function (h) { try { return h && !/^data:/.test(h) ? new URL(h, base).href : ''; } catch (e) { return ''; } }, out = [];
  var m1 = doc.querySelector('meta[itemprop="image"],link[rel="image_src"]'); if (m1) out.push(abs(m1.getAttribute('content') || m1.getAttribute('href')));
  [].forEach.call(doc.querySelectorAll('script[type="application/ld+json"]'), function (sc) {
    try { var o = JSON.parse(sc.textContent || ''), im = o && (o.image || (o['@graph'] && o['@graph'][0] && o['@graph'][0].image)); if (im) out.push(abs(typeof im === 'string' ? im : im.url || (im[0] && (im[0].url || im[0])))); } catch (e) {}
  });
  [].forEach.call(doc.querySelectorAll('[class*="cover"],[class*="thumb"],[class*="poster"],[class*="series-image"],[class*="summary_image"]'), function (el) {
    if (out.length > 12) return;
    var im = el.tagName === 'IMG' ? el : el.querySelector('img');
    if (im) out.push(abs(im.getAttribute('data-src') || im.getAttribute('data-lazy-src') || im.getAttribute('src')));
    out.push(abs(bgUrl(el)));
  });
  [].forEach.call(doc.querySelectorAll('script:not([src])'), function (sc) {
    var t = sc.textContent || ''; if (t.length > 3000000) return;
    var m = t.match(/\\?"(?:cover|coverImage|cover_url|thumbnail|thumb|poster)\\?"\s*:\s*\\?"(https?:[^"\\]+?\.(?:jpe?g|png|webp|avif)[^"\\]*)/i);
    if (m) out.push(abs(m[1].replace(/\\\//g, '/')));
  });
  return out.filter(Boolean);
}
/* Passende Bildgröße wählen: aus srcset die kleinste Variante, die mindestens need Pixel breit ist (scharf nach dem
   Verkleinern, ohne riesige Originale zu laden), sonst die größte. Varianten: [{u, w}] */
function srcsetList(set, base) {
  var out = [];
  String(set || '').split(',').forEach(function (part) {
    var m = part.trim().match(/^(\S+)\s+(\d+)w$/); if (!m) return;
    try { out.push({ u: new URL(m[1], base).href, w: +m[2] }); } catch (e) {}
  });
  return out;
}
function fitVariant(vars, need) {
  if (!vars.length) return null;
  vars.sort(function (a, b) { return a.w - b.w; });
  for (var i = 0; i < vars.length; i++) if (vars[i].w >= need) return vars[i];
  return vars[vars.length - 1];
}
// Bild einer Karte (Entdecken): passende Variante aus srcset/picture, sonst das Original hinter einem Bild-Proxy
function fitSrc(im, need) {
  var set = im.getAttribute('srcset') || im.getAttribute('data-srcset') || '';
  var pic = im.parentElement && im.parentElement.tagName === 'PICTURE' ? im.parentElement : null;
  if (pic) [].forEach.call(pic.querySelectorAll('source'), function (s) { set += ',' + (s.getAttribute('srcset') || s.getAttribute('data-srcset') || ''); });
  var v = fitVariant(srcsetList(set, location.href), need);
  return v ? v.u : bestSrc(im);
}
// Cover einer abgerufenen Serienseite: og:image, oder eine Variante desselben Bildes (gleicher Dateiname, auch hinter
// /_next/image?url=…) bzw. ein Bild, dessen Alt-Text der Titel ist, in passender Größe
function docCoverUrl(doc, base, need, title) {
  var abs = function (h) { try { return new URL(h, base).href; } catch (e) { return ''; } };
  var fileOf = function (u) {
    var x = u; try { var q = new URL(u).searchParams.get('url'); if (q) x = abs(q); } catch (e) {}
    return x.split(/[?#]/)[0].split('/').pop().toLowerCase();
  };
  var og = doc.querySelector('meta[property="og:image"],meta[name="twitter:image"]'), ogU = og && og.content ? abs(og.content) : '';
  var ogF = ogU ? fileOf(ogU) : '', tt = normT(title || ''), vars = [];
  [].forEach.call(doc.querySelectorAll('img[srcset],img[data-srcset],source[srcset]'), function (im) {
    var img = im.tagName === 'IMG' ? im : im.parentElement && im.parentElement.querySelector('img');
    var alt = normT(img ? img.getAttribute('alt') || '' : '');
    srcsetList(im.getAttribute('srcset') || im.getAttribute('data-srcset'), base).forEach(function (v) {
      if ((ogF && fileOf(v.u) === ogF) || (tt && alt === tt)) vars.push(v);
    });
  });
  var v = fitVariant(vars, need);
  // Reicht keine Variante, ist og:image meist das Original
  if (!v || (v.w < need && ogU)) return ogU || (v ? v.u : '');
  return v.u;
}
// Bestes Cover der Seite: das Bild zum og:image (mit größter Variante aus srcset), sonst das größte Hochformat-Bild
// oben auf der Seite, dessen Alt-Text zum Titel passt, sonst og:image. Als Liste zum Durchprobieren: dazu die Adresse,
// die der Browser gerade anzeigt (klappt auch, wenn das Original gesperrt ist), und og:image
function pageCoverUrls() {
  var og = document.querySelector('meta[property="og:image"],meta[name="twitter:image"]'), ogU = og && og.content ? unproxy(og.content) : '';
  var base = function (u) { return String(u).split(/[?#]/)[0].split('/').pop(); };
  var title = (document.querySelector('h1') || {}).textContent || '', best = null, bw = 0, shown = '';
  [].forEach.call(document.images, function (im) {
    var nw = im.naturalWidth, nh = im.naturalHeight; if (!nw || !nh) return;
    var r = im.getBoundingClientRect(); if (r.top + window.scrollY > 1800 || r.width < 100) return;
    var ar = nw / nh, u = bestSrc(im); if (!u || ar < 0.5 || ar > 0.9) return;
    var sc = nw + (ogU && base(u) === base(ogU) ? 1e5 : 0) + (title && im.alt && normT(im.alt) === normT(title) ? 5e4 : 0);
    if (sc > bw) { bw = sc; best = u; shown = im.currentSrc || im.src || ''; }
  });
  // Kein passendes <img>: Hintergrundbilder und weitere Stellen (Klasse cover/thumb/poster, JSON-LD, Seitendaten)
  return [best, shown, ogU, og && og.content].concat(docMoreCovers(document, location.href));
}
function grabCover(force) {
  var key = location.origin + location.pathname, all = get(COV);
  if (all[key] && (all[key].q || 0) >= COVER_Q && !force) return;
  var us = pageCoverUrls().filter(Boolean), t = document.querySelector('meta[property="og:title"]');
  if (!us.length) { if (force) flash(L('Kein Cover gefunden', 'No cover found')); return; }
  shrinkAny(us, function (d) {
    if (!d) { if (force) flash(L('Cover ließ sich nicht laden', 'Cover could not be loaded')); return; }
    var cur = get(COV); cur[key] = { img: d, title: t ? t.content : document.title, t: Date.now(), q: COVER_Q };
    put(COV, keep(cur, 40)); if (force) flash(L('✓ Cover gemerkt', '✓ Cover saved'));
  }, undefined, location.href);
}
/* ---------- Entdecken: Serien auf Übersichtsseiten einsammeln ---------- */
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
    if (isSeriesUrl(u)) { if (canonUrl(u.replace(/\/$/, '')) !== key) return false; }
    else if (chOf(u) != null && pathOf(u).toLowerCase().indexOf(base) < 0) return false;
  }
  return true;
}
var FEAT_SEL = '[class*="swiper"],[class*="slider"],[class*="carousel"],[class*="featured"],[class*="splide"],[class*="slick"],[class*="embla"],[class*="hero"],[class*="spotlight"]';
// Titel aus einer Karte säubern: Art-Abzeichen vorne („manhwa …“), „Chapter 143 …“ hinten (auch angeklebt wie
// „BraveChapter 12“) und eine Wertung am Ende („… 9.5“) gehören nicht zum Namen
function cleanCardTitle(t) {
  t = String(t || '').replace(/\s+/g, ' ').trim();
  t = t.replace(/^(?:manhwa|manga|manhua|novel|webtoon|comic)\s+(?=\S)/i, '');
  t = t.replace(/\s*(?:chapter|chap|kapitel|episode|ch\.|ep\.)\s*\d[\d.,]*.*$/i, '');
  t = t.replace(/\s+\d{1,2}[.,]\d{1,2}$/, '');
  return t.trim();
}
// Text mit Leerzeichen zwischen den Teilen (textContent klebt „Brave“ und „Chapter“ zusammen)
function spacedText(el) {
  var w = el.ownerDocument.createTreeWalker(el, 4), out = [], n;
  while ((n = w.nextNode())) out.push(n.nodeValue);
  return out.join(' ').replace(/\s+/g, ' ').trim();
}
function scrapeCards() {
  var map = {}, out = [];
  document.querySelectorAll('a[href]').forEach(function (a) {
    var u = absUrl(a.getAttribute('href'));
    if (!isSeriesUrl(u) || new URL(u).hostname !== location.hostname) return;
    var k = canonUrl(u.replace(/\/$/, '')); (map[k] = map[k] || []).push(a);
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
    // Titel: Überschrift der Karte, sonst title-Attribut, Alt-Text des Bildes, sonst der längste Linktext (gesäubert)
    var img = card.tagName === 'IMG' ? card : card.querySelector('img'), title = '';
    // Ohne <img>: Cover als Hintergrundbild der Karte (manche Seiten)
    var bg = ''; if (!img && card.querySelectorAll) { var bgEl = [card].concat([].slice.call(card.querySelectorAll('[style*="background"],[data-bg],[data-background]'))).filter(function (x) { return bgUrl(x); })[0]; if (bgEl) bg = absUrl(bgUrl(bgEl)); }
    var head = card.querySelector && card.querySelector('h1,h2,h3,h4,h5,[class*="title"],[class*="name"]');
    var cands = [head ? spacedText(head) : ''];
    as.forEach(function (a) { cands.push(a.getAttribute('title') || ''); });
    cands.push(img ? img.alt || '' : '');
    var lt = ''; as.forEach(function (a) { var t = spacedText(a); if (t.length > lt.length && t.length < 160 && !/^(chapter|kapitel|ch\.?)\s*\d/i.test(t)) lt = t; });
    cands.push(lt);
    for (var ci = 0; ci < cands.length && !title; ci++) { var ct = cleanCardTitle(cands[ci]); if (ct.length >= 2 && ct.length < 120) title = ct; }
    if (!title) return;
    var text = card.innerText || card.textContent || '', rating = null, re = /(\d{1,2}[.,]\d{1,2})/g, m;
    while ((m = re.exec(text))) { var v = parseFloat(m[1].replace(',', '.')); if (v > 0 && v <= 10) { rating = v; break; } }
    var type = badgeType(card) || (/\/novels?\//i.test(k) ? 'Novel' : '');
    var chN = null, chU = null;
    card.querySelectorAll('a[href]').forEach(function (a) {
      var u = absUrl(a.getAttribute('href')), n = chOf(u);
      if (n != null && (chN == null || n > chN)) { chN = n; chU = u; }
    });
    // Steht die Karte in einem Slider/Karussell (oben auf der Startseite der Scan-Seite), ist sie gerade hervorgehoben
    var feat = !!(card.closest && card.closest(FEAT_SEL));
    out.push({ url: k, title: title.slice(0, 120), rating: rating, ch: chN, chUrl: chU, type: type, feat: feat,
      imgSrc: img ? fitSrc(img, feat ? 900 : 600) : bg, imgRaw: img ? (img.currentSrc || img.src || img.getAttribute('data-src') || '') : '' });
  });
  return out;
}
// Fund mit Details anreichern: Serienseite holen (oder, wenn du gerade darauf bist, die offene Seite nehmen)
function enrich(c, cb) {
  if (c.url === canonUrl((location.origin + location.pathname).replace(/\/$/, ''))) return fromDoc(c, document, cb);
  GM_xmlhttpRequest({ method: 'GET', url: c.url, timeout: 15000,
    onload: function (r) {
      var doc = null;
      try { if (r.status === 200) doc = new DOMParser().parseFromString(r.responseText, 'text/html'); } catch (e) {}
      fromDoc(c, doc, cb);
    },
    onerror: function () { cb(null); }, ontimeout: function () { cb(null); } });
}
function fromDoc(c, doc, cb) {
  var base = slugBase(c.url);
  var og = doc && doc.querySelector('meta[property="og:image"]'), ot = doc && doc.querySelector('meta[property="og:title"]');
  var e = { title: (ot && ot.content) || c.title, rating: c.rating, ch: c.ch, chUrl: c.chUrl, img: '', site: hostOf(c.url) || location.hostname, t: Date.now(), feat: c.feat ? Date.now() : 0,
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
    // Seite zeichnet die Kapitelliste erst im Browser: Kapitel und Daten aus den Seitendaten
    if (!e.rel.length) applyJsonChapters(e, doc, c.url);
    e.desc = fullDesc(doc);
    e.g = mergeGenres(headGenres(doc), e.g);
    if (!e.g.length) e.g = jsonGenres(doc);
    var bt = doc.body ? (doc.body.textContent || '').slice(0, 40000) : '';
    var ty = bt.match(/(?:type|typ)\s*:?\s*(manhwa|manga|manhua|novel|webtoon)/i);
    if (ty) e.type = ty[1].charAt(0).toUpperCase() + ty[1].slice(1).toLowerCase();
    else if (!e.type) e.type = badgeType(doc.body);
    if (!e.type) e.type = jsonType(doc);
    if (!e.type && /\/novels?\//i.test(c.url)) e.type = 'Novel';
    e.ss = siteStatus(doc) || jsonStatus(doc);
    e.alt = altNames(doc);
  }
  // 400 px breit: scharf in der Entdecken-Liste auch bei hoher Pixeldichte; hervorgehobene (fürs Karussell) 600 px.
  // Quelle in passender Größe (docCoverUrl), sonst das Bild der Karte
  // Klappt eine Adresse nicht (gesperrt, nicht da), die nächste: so fehlt kein Bild mehr
  var big = !!c.feat, ogU = ''; try { ogU = og && og.content ? new URL(og.content, c.url).href : ''; } catch (er) {}
  // Woher das Bild kam, merken (iu): damit kann der Hub es später neu holen lassen, auch wenn die Seite kein og:image hat
  var cands = [doc && docCoverUrl(doc, c.url, big ? 900 : 600, e.title), ogU, c.imgSrc, c.imgRaw].concat(doc ? docMoreCovers(doc, c.url) : []);
  e.iu = c.imgSrc || c.imgRaw || '';
  shrinkAny(cands, function (d, w) { e.img = d; e.q = d ? (big && w >= 570 ? 4 : 3) : 0; cb(e); }, big ? 600 : 400, c.url);
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
/* Bei jedem Öffnen der Serienseite: alles aus der offenen Seite neu lesen (Kapitel, Daten, Beschreibung, Genres, Status,
   alternative Namen) und Fehlendes nachholen: kein Cover (q 0, z. B. schneller Eintrag von der Karte oder früher
   misslungen) wird aus der offenen Seite geholt, ein Titel nur von der Karte durch den der Seite ersetzt. */
var relDoneFor = '', relPath = '', relSince = 0;
function refreshRel() {
  if (relDoneFor === path || isChapter() || !SERIES.test(path)) return;
  if (relPath !== path) { relPath = path; relSince = Date.now(); }
  var self = canonUrl((location.origin + path).replace(/\/$/, '')), base = slugBase(self), rel = {}, mx = null, mxU = null;
  document.querySelectorAll('a[href]').forEach(function (a) {
    var u = absUrl(a.getAttribute('href')), n = chOf(u);
    if (n == null || pathOf(u).toLowerCase().indexOf(base) < 0) return;
    if (mx == null || n > mx) { mx = n; mxU = u; }
    var dt = linkDate(a); if (dt && !rel[n]) rel[n] = dt;
  });
  // Ohne Kapitel-Links erst, wenn die Seite fertig geladen sein dürfte (Seiten, die Inhalte nachladen)
  if (mx == null && Date.now() - relSince < 6000) return;
  // Keine Daten an den Links: aus den Seitendaten
  var jc = !Object.keys(rel).length ? jsonChapters(document) : null;
  if (jc) { rel = jc.rel; if (mx == null || jc.max > mx) { mx = jc.max; if (jc.slug) mxU = self + '/' + jc.slug; } }
  var all = get(DISC), e = all[self]; if (!e) return; // Erster Besuch: der Eintrag entsteht gerade beim Entdecken
  relDoneFor = path;
  var list = Object.keys(rel).map(function (n) { return [parseFloat(n), rel[n]]; }).sort(function (a, b) { return a[0] - b[0]; }).slice(-20);
  var desc = fullDesc(document), hg = headGenres(document), ss = siteStatus(document) || jsonStatus(document), alt = altNames(document);
  if (!hg.length && !(e.g && e.g.length)) hg = jsonGenres(document);
  var sig = JSON.stringify([list, mx, desc.length, hg, ss, alt]);
  var light = !e.desc && !(e.g && e.g.length), noImg = !e.q && !saveMode();
  if (e.relSig !== sig) {
    if (list.length) e.rel = list;
    if (desc && desc.length >= (e.desc || '').length) e.desc = desc;
    if (hg.length) e.g = mergeGenres(hg, e.g || []);
    if (ss) e.ss = ss;
    if (alt.length) e.alt = alt;
    if (mx != null && mx > (e.ch || 0) && mxU && (!jc || !e.chUrl || e.chUrl.indexOf(self + '/') === 0)) { e.ch = mx; e.chUrl = mxU; }
    if (!e.type) e.type = jsonType(document);
    var ot = document.querySelector('meta[property="og:title"]');
    if (light && ot && ot.content) e.title = ot.content;
    e.relSig = sig; e.ack = false; e.t = Date.now();
    put(DISC, keep(all, DISC_KEEP));
  }
  if (!noImg) return;
  // Cover fehlt: aus der offenen Seite holen (die Bilder sind meist schon geladen)
  fromDoc({ url: self, title: e.title, rating: e.rating, ch: e.ch, chUrl: e.chUrl, feat: e.feat, type: e.type, imgSrc: e.iu || '' }, document, function (n) {
    var a2 = get(DISC), cur = a2[self]; if (!cur || !n || !n.img) return;
    cur.img = n.img; cur.q = n.q; if (n.iu) cur.iu = n.iu; cur.ack = false; cur.t = Date.now();
    put(DISC, keep(a2, DISC_KEEP));
  });
}
// Einmalig (ab 3.47): gemerkte Funde unter der Adresse ohne Kennung ablegen (canonUrl), sonst würde alles neu abgerufen
function canonMigrate() {
  if (GM_getValue('mhub_canon', 0) >= 1) return;
  var all = get(DISC), ch = false;
  Object.keys(all).forEach(function (k) { var c = canonUrl(k); if (c !== k) { if (!all[c]) all[c] = all[k]; delete all[k]; ch = true; } });
  if (ch) put(DISC, all);
  var q = dqGet(), q2 = q.map(function (x) { return Object.assign({}, x, { url: canonUrl(x.url) }); });
  if (JSON.stringify(q) !== JSON.stringify(q2)) dqPut(q2);
  GM_setValue('mhub_canon', 1);
}
// Diese Serienseite selbst zum Entdecken vormerken (vorne in der Warteschlange)
function queueSelf(self) {
  if (discSeen[self]) return false;
  discSeen[self] = 1; dqAdd([{ url: self, title: document.title, rating: null, ch: null, chUrl: null, imgSrc: '' }], true);
  return true;
}
// Ohne Abruf: was die Karte selbst zeigt. Für Serien, die der gemeinsame Pool schon vollständig kennt (mhub_known),
// und im Datensparmodus (außer hervorgehobene). Bild und Beschreibung kommen dann aus dem Pool
function lightEntry(c) {
  return { title: c.title, rating: c.rating, ch: c.ch, chUrl: c.chUrl, img: '', site: hostOf(c.url) || location.hostname, t: Date.now(), feat: c.feat ? Date.now() : 0, g: [], desc: '', type: c.type || '', rel: [] };
}
var knownRaw = '', knownSet = {};
function isKnown(u) {
  var raw = GM_getValue('mhub_known', '[]');
  if (raw !== knownRaw) { knownRaw = raw; knownSet = {}; try { (JSON.parse(raw) || []).forEach(function (x) { knownSet[canonUrl(x)] = 1; }); } catch (e) {} }
  return !!knownSet[u];
}
// Kurzer Hinweis unten in der Leiste, nur auf Scan-Seiten (im Hub gibt es die Leiste nicht)
function discNote(t) { if (!isHub && !topMode && typeof flash === 'function' && typeof pill !== 'undefined' && pill) flash(t); }
// Ergebnis ablegen: den schnellen Eintrag (von der Karte) durch den vollständigen ersetzen, Hervorhebung behalten
function discStore(url, e) {
  var all = get(DISC), old = all[url];
  if (old && old.feat && !e.feat) e.feat = old.feat;
  e.ack = false; all[url] = e; put(DISC, keep(all, DISC_KEEP));
  // Im Hub selbst kommt die Änderung nicht über den Speicher-Listener: gesammelt melden
  if (isHub && typeof send === 'function') { clearTimeout(dqSendT); dqSendT = setTimeout(send, 1500); }
}
/* Warteschlange abarbeiten: Serienseite holen, Details und Bild dazu. Läuft auf Scan-Seiten und im offenen Hub,
   pausiert, wenn die Seite nicht zu sehen ist, und macht beim nächsten Mal weiter (DQ im Tampermonkey-Speicher). */
function runDisc() {
  if (dqBusy) return;
  dqBusy = true;
  var done = 0;
  (function next() {
    var q = dqGet();
    if (!q.length || document.hidden) { dqBusy = false; if (done) discNote('✓ ' + done + L(' Manhwas für den Hub gemerkt', ' manhwas saved for the hub')); return; }
    // Erst nach dem Abruf aus der Warteschlange nehmen: wird die Seite mittendrin geschlossen, geht nichts verloren
    var c = q[0];
    if (q.length % 5 === 1) discNote(L('🔎 Entdecke … noch ', '🔎 Discovering … ') + q.length + L('', ' left'));
    enrich(c, function (e) {
      if (e) { discStore(c.url, e); done++; }
      dqPut(dqGet().filter(function (x) { return x.url !== c.url; }));
      setTimeout(next, 600);
    });
  })();
}
// In die Warteschlange (vorne: die gerade offene Serienseite), ohne doppelte
function dqAdd(cards, front) {
  var q = dqGet(), have = {};
  q.forEach(function (c) { have[c.url] = 1; });
  var add = cards.filter(function (c) { if (have[c.url]) return false; have[c.url] = 1; return true; });
  if (!add.length) return;
  dqPut(front ? add.concat(q) : q.concat(add));
}
function discover() {
  if (isChapter()) return;
  siteProgress();
  var cards = scrapeCards(), all = get(DISC), changed = false, todo = [], save = saveMode();
  cards.forEach(function (c) {
    var e = all[c.url];
    if (e) {
      var nr = c.rating && c.rating !== e.rating, nc = c.ch != null && c.ch > (e.ch || 0);
      if (nr) e.rating = c.rating;
      if (nc) { e.ch = c.ch; e.chUrl = c.chUrl; }
      // Hervorgehoben: höchstens alle 12 Stunden neu melden
      var nf = c.feat && Date.now() - (e.feat || 0) > 12 * 3600e3;
      if (nf) e.feat = Date.now();
      if (nr || nc || nf) { e.ack = false; changed = true; }
      return;
    }
    if (discSeen[c.url]) return;
    discSeen[c.url] = 1;
    // Sofort melden, was die Karte zeigt (Titel, Wertung, Kapitel): so geht beim schnellen Weiterblättern nichts verloren.
    // Details und Bild holt die Warteschlange danach (außer der Pool kennt die Serie schon, oder Datensparmodus)
    all[c.url] = lightEntry(c); changed = true;
    if (!isKnown(c.url) && !(save && !c.feat)) todo.push(c);
  });
  if (changed) put(DISC, keep(all, DISC_KEEP));
  if (todo.length) dqAdd(todo.map(function (c) { return { url: c.url, title: c.title, rating: c.rating, ch: c.ch, chUrl: c.chUrl, type: c.type, feat: c.feat, imgSrc: c.imgSrc, imgRaw: c.imgRaw }; }), false);
  if (dqGet().length) runDisc();
}

/* ---------- Beschreibung und Genres von der Serienseite ---------- */
// Text mit Absätzen: Blöcke und <br> werden zu Zeilenumbrüchen. „Mehr anzeigen“-Knöpfe und -Links gehören nicht dazu
function blockText(el) {
  var out = '';
  (function walk(n) {
    if (n.nodeType === 3) { out += n.nodeValue; return; }
    if (n.nodeType !== 1 || /^(SCRIPT|STYLE|NOSCRIPT|BUTTON|SVG|TEMPLATE)$/i.test(n.tagName)) return;
    if (n.tagName === 'BR') { out += '\n'; return; }
    if (/^(A|SPAN|LABEL)$/.test(n.tagName) && MORE_RE.test((n.textContent || '').trim())) return;
    var blk = /^(P|DIV|LI|H[1-6]|SECTION|ARTICLE|BLOCKQUOTE)$/.test(n.tagName);
    if (blk) out += '\n';
    for (var c = n.firstChild; c; c = c.nextSibling) walk(c);
    if (blk) out += '\n';
  })(el);
  return out.replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
function normT(t) { return String(t || '').replace(/\s+/g, ' ').trim().toLowerCase(); }
// Text, der als HTML kommt (<p>…</p> in JSON): in Absätze umwandeln
function htmlText(t) {
  if (!/<[a-z\/][^>]*>|&[a-z#0-9]+;/i.test(t)) return t;
  try { var d = new DOMParser().parseFromString('<div>' + t + '</div>', 'text/html'); return blockText(d.body); } catch (e) { return t; }
}
// Längste Kurzbeschreibung aus den Metadaten (og:, twitter:, description)
function metaDesc(root) {
  var best = '';
  [].forEach.call(root.querySelectorAll('meta[property="og:description"],meta[name="twitter:description"],meta[name="description"],meta[itemprop="description"]'), function (m) {
    var t = (m.content || '').replace(/\s+/g, ' ').trim(); if (t.length > best.length) best = t;
  });
  return best;
}
// Strukturierte Daten (JSON-LD): oft die volle Beschreibung
function ldDescs(root) {
  var out = [];
  [].forEach.call(root.querySelectorAll('script[type="application/ld+json"]'), function (sc) {
    try {
      (function walk(o, depth) {
        if (!o || typeof o !== 'object' || depth > 6) return;
        if (typeof o.description === 'string') out.push(o.description);
        Object.keys(o).forEach(function (k) { if (o[k] && typeof o[k] === 'object') walk(o[k], depth + 1); });
      })(JSON.parse(sc.textContent || ''), 0);
    } catch (e) {}
  });
  return out;
}
/* Seitendaten als Text: die Next.js-Daten (self.__next_f.push) werden in der Reihenfolge zusammengesetzt und einmal
   entpackt (lange Zeichenketten können über mehrere push-Aufrufe verteilt sein), dazu __NEXT_DATA__, Nuxt und andere
   Inline-Skripte. Viele Seiten bauen den sichtbaren Inhalt erst im Browser: dann stehen Genres, Status, Kapitel nur hier. */
var pdCache = typeof WeakMap === 'function' ? new WeakMap() : null;
function pageTexts(root) {
  if (pdCache && pdCache.has(root)) return pdCache.get(root);
  var flight = [], other = [];
  [].forEach.call(root.querySelectorAll('script:not([src])'), function (sc) {
    var t = sc.textContent || '';
    if (!t || t.length > 4000000 || /ld\+json/.test(sc.type || '')) return;
    var re = /self\.__next_f\.push\(\[1,\s*("(?:[^"\\]|\\.)*")\]\)/g, m, hit = false;
    while ((m = re.exec(t))) { try { flight.push(JSON.parse(m[1])); hit = true; } catch (e) {} }
    if (!hit) other.push(t);
  });
  var out = (flight.length ? [flight.join('')] : []).concat(other);
  if (pdCache) pdCache.set(root, out);
  return out;
}
// Ende eines JSON-Arrays/-Objekts ab s (Zeichenketten beachtet), -1 wenn nicht innerhalb von max Zeichen
function jsonEnd(t, s, max) {
  var depth = 0, inS = false;
  for (var i = s; i < t.length && i - s < max; i++) {
    var c = t.charAt(i);
    if (inS) { if (c === '\\') i++; else if (c === '"') inS = false; continue; }
    if (c === '"') inS = true;
    else if (c === '[' || c === '{') depth++;
    else if ((c === ']' || c === '}') && --depth === 0) return i;
  }
  return -1;
}
// Stelle der Serie in den Seitendaten (ihr Titel): von mehreren Listen gilt die nächstgelegene (nicht die Genre-Liste im Menü)
function anchorOf(t, title) { var k = String(title || '').replace(/\s+/g, ' ').trim().slice(0, 40); return k.length >= 3 ? t.indexOf(k) : -1; }
function pageTitle(root) {
  var h = root.querySelector('h1'), og = root.querySelector('meta[property="og:title"]');
  return (h && h.textContent.trim()) || (og && og.content) || '';
}
// Genres aus den Seitendaten ("genres"/"tags"/"categories": [..] mit Namen oder als Text) und aus JSON-LD (genre)
function jsonGenres(root) {
  var best = null, bd = 1e12, title = pageTitle(root);
  pageTexts(root).forEach(function (t) {
    if (!/"(?:genres?|tags|categories)"/i.test(t)) return;
    var an = anchorOf(t, title), re = /"(?:genres?|tags|categories|genre_list|genreList)"\s*:\s*\[/gi, m, n = 0;
    while ((m = re.exec(t)) && n++ < 200) {
      var s = m.index + m[0].length - 1, e = jsonEnd(t, s, 8000); if (e < 0) continue;
      var arr; try { arr = JSON.parse(t.slice(s, e + 1)); } catch (er) { continue; }
      var names = [];
      (Array.isArray(arr) ? arr : []).forEach(function (x) {
        var v = typeof x === 'string' ? x : x && typeof x === 'object' ? (x.name || x.title || x.label || x.genre || x.tag) : '';
        if (typeof v !== 'string') return; v = v.replace(/\s+/g, ' ').trim();
        if (v.length >= 2 && v.length <= 30 && v.charAt(0) !== '$' && !/^\d+$/.test(v)) names.push(v);
      });
      // Eine Liste aller Genres der Seite (Menü, Filter) ist lang: nur kurze Listen
      if (!names.length || names.length > 15) continue;
      var dist = an < 0 ? 0 : Math.abs(m.index - an);
      if (dist < bd) { bd = dist; best = names; }
    }
  });
  if (!best) {
    [].forEach.call(root.querySelectorAll('script[type="application/ld+json"]'), function (sc) {
      if (best) return;
      try {
        (function walk(o, depth) {
          if (best || !o || typeof o !== 'object' || depth > 6) return;
          var g = o.genre || o.genres; if (typeof g === 'string') g = g.split(/\s*,\s*/);
          if (Array.isArray(g)) { var l = g.filter(function (x) { return typeof x === 'string' && x.length >= 2 && x.length <= 30; }); if (l.length && l.length <= 15) { best = l; return; } }
          Object.keys(o).forEach(function (k) { if (o[k] && typeof o[k] === 'object') walk(o[k], depth + 1); });
        })(JSON.parse(sc.textContent || ''), 0);
      } catch (e) {}
    });
  }
  return best ? mergeGenres(best, []) : [];
}
// Status und Art aus den Seitendaten, nahe beim Titel
function jsonField(root, re) {
  var best = '', bd = 1e12, title = pageTitle(root);
  pageTexts(root).forEach(function (t) {
    var an = anchorOf(t, title), m, n = 0; re.lastIndex = 0;
    while ((m = re.exec(t)) && n++ < 200) { var d = an < 0 ? 0 : Math.abs(m.index - an); if (d < bd) { bd = d; best = m[1]; } }
  });
  return best;
}
function jsonStatus(root) {
  var v = jsonField(root, /"(?:status|series_status|seriesStatus|publication_status)"\s*:\s*"([^"]{3,30})"/gi);
  for (var k = 0; v && k < STATUS_WORDS.length; k++) if (STATUS_WORDS[k][0].test(v)) return STATUS_WORDS[k][1];
  return '';
}
function jsonType(root) {
  var v = jsonField(root, /"(?:series_type|seriesType|comic_type|comicType|type)"\s*:\s*"(manhwa|manga|manhua|novel|webtoon)"/gi);
  return v ? v.charAt(0).toUpperCase() + v.slice(1).toLowerCase() : '';
}
/* Kapitel mit Datum aus den Seitendaten: flache Objekte, die eine Kapitelnummer (Feld oder „Chapter 62“/„chapter-62“) und
   ein Datum haben. Für Seiten, die die Kapitelliste erst im Browser zeichnen. Ergebnis: {rel: {n: Tag}, max, slug} */
function jsonChapters(root) {
  var rel = {}, cnt = 0, mx = null, slug = '', n = 0, now = Date.now();
  var NUM = /"(?:chapter_number|chapterNumber|chapter_no|chapterNo|number|chapter)"\s*:\s*"?(\d{1,5}(?:\.\d+)?)"?\s*[,}]/;
  var SLUG = /"(?:chapter_slug|chapterSlug|slug)"\s*:\s*"((?:chapter|ch|episode|ep)[._-]*(\d{1,5})(?:[._-](\d{1,2}))?(?![\d])[a-z0-9._-]{0,60})"/i;
  var NAME = /"(?:chapter_slug|chapterSlug|slug|chapter_name|chapterName|name|title)"\s*:\s*"((?:chapter|ch|episode|ep)[\s._-]*(\d{1,5})(?:[._-](\d{1,2}))?(?![\d])[^"]{0,60})"/i;
  var DATE = /"(?:created_at|createdAt|published_at|publishedAt|release_date|releaseDate|released_at|releasedAt|uploaded_at|uploadedAt|date|updated_at|updatedAt)"\s*:\s*"([^"]{8,40})"/;
  pageTexts(root).forEach(function (t) {
    if (!/hapter|pisode/.test(t)) return;
    // Von jedem Datumsfeld aus das umgebende flache Objekt nehmen (schneller als alle Objekte der Seite durchzugehen)
    var re = new RegExp(DATE.source, 'g'), m;
    while ((m = re.exec(t)) && n++ < 4000) {
      var a = t.lastIndexOf('{', m.index), z = t.indexOf('}', m.index);
      if (a < 0 || z < 0 || m.index - a > 1500 || z - m.index > 1500) continue;
      var o = t.slice(a, z + 1); if (o.indexOf('{', 1) > -1 || !/chapter|episode/i.test(o)) continue;
      var d = o.match(DATE); if (!d) continue;
      var nu = o.match(NUM), nm = o.match(SLUG) || o.match(NAME);
      var num = nu ? parseFloat(nu[1]) : nm ? parseFloat(nm[2] + (nm[3] ? '.' + nm[3] : '')) : NaN;
      if (isNaN(num) || num > 20000) continue;
      var tm = Date.parse(d[1]); if (isNaN(tm) || tm > now + 864e5 || tm < now - 6 * 365 * 864e5) continue;
      if (rel[num] == null) { rel[num] = dayOf(tm); cnt++; }
      if (mx == null || num > mx) { mx = num; slug = nm && /^[a-z0-9._-]+$/i.test(nm[1]) ? nm[1] : ''; }
    }
  });
  return cnt ? { rel: rel, max: mx, slug: slug, n: cnt } : null;
}
// Kapitel aus den Seitendaten in einen Eintrag übernehmen (nur wenn die Seite selbst keine Kapitel-Links mit Datum zeigt).
// Link zum neuesten Kapitel nur, wenn das Muster bekannt ist (Serienadresse + „/chapter-62“ wie beim bisherigen Link)
function applyJsonChapters(e, root, pageUrl) {
  var jc = jsonChapters(root); if (!jc) return false;
  e.rel = Object.keys(jc.rel).map(function (n) { return [parseFloat(n), jc.rel[n]]; }).sort(function (a, b) { return a[0] - b[0]; }).slice(-20);
  var pre = String(pageUrl || '').replace(/\/$/, '') + '/';
  if (jc.slug && jc.max > (e.ch || 0) && (!e.chUrl || e.chUrl.indexOf(pre) === 0)) { e.ch = jc.max; e.chUrl = pre + jc.slug; }
  return true;
}
// Alternative Namen aus den Seitendaten ("alternative_names": "A, B" oder [..])
function jsonAlt(root) {
  var out = [];
  pageTexts(root).forEach(function (t) {
    if (out.length) return;
    var re = /"(?:alternative_names|alternativeNames|alt_names|altNames|alternative_titles|alternativeTitles|alternatives|other_names|otherNames|associated_names|synonyms)"\s*:\s*/g, m;
    while (!out.length && (m = re.exec(t))) {
      var s = m.index + m[0].length, c = t.charAt(s), v = null;
      try {
        if (c === '"') { var e = s + 1; while (e < t.length && e - s < 3000 && !(t.charAt(e) === '"' && t.charAt(e - 1) !== '\\')) e++; v = JSON.parse(t.slice(s, e + 1)); }
        else if (c === '[') { var e2 = jsonEnd(t, s, 4000); if (e2 > 0) v = JSON.parse(t.slice(s, e2 + 1)); }
      } catch (er) { v = null; }
      if (typeof v === 'string') v = v.split(/\s*(?:[,;|•\n]|\s\/\s)\s*/);
      if (Array.isArray(v)) out = v.map(function (x) { return typeof x === 'string' ? x : x && (x.name || x.title) || ''; }).map(function (x) { return String(x).replace(/\s+/g, ' ').trim(); })
        .filter(function (x) { return x.length >= 2 && x.length <= 150 && x.charAt(0) !== '$'; });
    }
  });
  return out.slice(0, 12);
}
// Volle Beschreibung in den Seitendaten: eine Zeichenkette, die wie der Anfang der Kurzbeschreibung beginnt. In den
// zusammengesetzten Next.js-Daten auch als Textzeile („1a:T4d2,…“, für lange Texte); in anderen Skripten auch doppelt verpackt
function scriptDescs(root, meta) {
  var out = [], key = '';
  // Suchschlüssel: ein Stück vom Anfang ohne Satzzeichen, die in JSON anders aussehen könnten
  (meta.slice(0, 120).match(/[A-Za-z0-9 ,]{16,}/g) || []).forEach(function (m) { if (!key && m.trim().length >= 16) key = m.trim().slice(0, 40); });
  if (!key) return out;
  var quoteAt = function (t, i) { var b = 0; while (i - 1 - b >= 0 && t.charAt(i - 1 - b) === '\\') b++; return b; };
  pageTexts(root).forEach(function (t) {
    var at = 0, n = 0;
    while ((at = t.indexOf(key, at)) > -1 && n++ < 20) {
      // Textzeile der Next.js-Daten: „<id>:T<Länge in Bytes, hex>,“ direkt davor
      var tr = t.slice(Math.max(0, at - 200), at).match(/(?:^|[\n\]}])[0-9a-f]{1,6}:T([0-9a-f]{1,6}),([^\n]{0,190})$/);
      if (tr) {
        var len = parseInt(tr[1], 16), st = at - tr[2].length, b = 0, i = st;
        for (; i < t.length && b < len && i - st < 20000; i++) { var cc = t.charCodeAt(i); b += cc < 0x80 ? 1 : cc < 0x800 ? 2 : (cc >= 0xD800 && cc < 0xDC00) ? (i++, 4) : 3; }
        out.push(t.slice(st, i));
      }
      // Anfang der Zeichenkette: ein " davor (einfach) oder \" (doppelt verpackt); ein paar Möglichkeiten durchprobieren
      for (var a = at - 1, tries = 0; a >= 0 && at - a < 600 && tries < 4; a--) {
        if (t.charAt(a) !== '"') continue;
        var lvl = quoteAt(t, a); if (lvl > 1) continue;
        tries++;
        var e = at + key.length, ok = false;
        while (e < t.length && e - at < 16000) { if (t.charAt(e) === '"' && quoteAt(t, e) === lvl) { ok = true; break; } e++; }
        if (!ok) continue;
        try {
          var v = JSON.parse('"' + t.slice(a + 1, e - lvl) + '"');
          if (lvl) v = JSON.parse('"' + v + '"');
          // Kein Stück JSON (falsch erkannte Grenzen), und der Anfang muss vorne stehen
          if (!/"\s*:\s*["{\[]|\\"|^\s*[{\[]/.test(v) && normT(v).indexOf(normT(key)) < 80) out.push(v);
        } catch (err) {}
      }
      at += key.length;
    }
  });
  return out;
}
// Die Kurzbeschreibung in den Metadaten ist oft abgeschnitten. Gesucht wird das Element, das ihren Anfang enthält,
// dann nach oben, solange der Behälter nur Absätze enthält (mehrere <p> einer Beschreibung). Dazu volle Fassungen aus
// JSON-LD und den Seitendaten; genommen wird die längste, die zum Anfang passt.
function fullDesc(root) {
  var meta = metaDesc(root);
  var probe = normT(meta.replace(/(\.\.\.|…)\s*$/, '')).slice(0, 60), best = null, bl = 1e9, bestCut = true;
  if (probe.length >= 20) {
    root.querySelectorAll('p,div,span,section,article').forEach(function (el) {
      if (el.closest('head,script,style,noscript,template')) return;
      var t = normT(el.textContent); if (t.length < probe.length || t.length > 8000 || t.indexOf(probe) < 0) return;
      // Lieber ein Element mit dem ganzen Text als eine gekürzte Vorschau („… Mehr anzeigen“)
      var c = cutEnd(normT(blockText(el)));
      if ((bestCut && !c) || (c === bestCut && t.length < bl)) { best = el; bl = t.length; bestCut = c; }
    });
    var okChild = function (c) {
      if (/^(P|SPAN|BR|EM|STRONG|I|B|U|SMALL|BUTTON)$/.test(c.tagName)) return true;
      if (/^(A|LABEL)$/.test(c.tagName)) return MORE_RE.test((c.textContent || '').trim());
      return c.tagName === 'DIV' && !c.querySelector('div,section,article,h1,h2,h3,h4,h5,h6,ul,ol,table,img');
    };
    while (best && best.parentElement && best.parentElement !== root.body) {
      var par = best.parentElement, pt = normT(par.textContent);
      // Steht der Anfang zweimal drin (Vorschau und volle Fassung), nicht zusammenlegen
      if (pt.length >= 8000 || pt.indexOf(probe) !== pt.lastIndexOf(probe) || ![].every.call(par.children, okChild)) break;
      best = par;
    }
  }
  if (!best) {
    // Ohne Metadaten: Text unter einer Überschrift wie „Synopsis“
    root.querySelectorAll('h1,h2,h3,h4,h5,h6,span,div,b,strong,dt').forEach(function (h) {
      if (best || h.children.length) return;
      if (!/^(synopsis|summary|description|story|plot|beschreibung|inhalt|zusammenfassung)\s*:?$/i.test((h.textContent || '').trim())) return;
      var nx = h.nextElementSibling || (h.parentElement && h.parentElement.nextElementSibling);
      if (nx && normT(nx.textContent).length > 40) best = nx;
    });
  }
  var cands = [best ? blockText(best) : ''];
  var start = normT(meta).slice(0, 30);
  ldDescs(root).concat(meta ? scriptDescs(root, meta) : []).forEach(function (v) {
    v = htmlText(String(v)).replace(/\r\n?/g, '\n').replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    // Nur Fassungen, die wie die Kurzbeschreibung anfangen (ohne Metadaten: JSON-LD)
    if (v.length <= 8000 && (start.length < 20 ? true : normT(v).indexOf(start) > -1 && normT(v).indexOf(start) < 80)) cands.push(v);
  });
  cands.push(meta);
  // Längste gewinnt; gekürzte („…“) zählen etwas weniger
  var txt = '', sc = -1;
  cands.forEach(function (c) {
    c = String(c || '').replace(/\s*(?:\.\.\.|…)?\s*(?:read|show|see|view)\s+(?:more|less|all)\s*$/i, '').trim();
    var v = c.length - (cutEnd(c) ? 25 : 0);
    if (c && v > sc) { txt = c; sc = v; }
  });
  return txt.slice(0, 5000);
}
/* Alternative Namen der Serie: Asura zeigt sie unter dem Titel, getrennt mit „•“; andere Seiten unter einer Beschriftung
   wie „Alternative“, „Associated Names“, „Other names“ oder in einem Element mit „alternative“ in der Klasse. */
function altNames(root) {
  var h1 = root.querySelector('h1'), title = h1 ? normT(h1.textContent) : '', raw = [], comma = false;
  // 1. Beschriftung „Alternative: …“ (Wert im selben Element oder im nächsten)
  root.querySelectorAll('h1,h2,h3,h4,h5,h6,span,div,b,strong,dt,th,td,p,label,li').forEach(function (el) {
    if (raw.length || el.childElementCount > 3) return;
    if ((el.textContent || '').length > 700) return;
    var t = spacedText(el), m = t.match(ALT_LABEL); if (!m) return;
    // Nur eine echte Beschriftung: mit Doppelpunkt, allein im Element, oder als eigenes erstes Kind-Element
    var first = el.firstElementChild && (el.firstElementChild.textContent || '').replace(/\s+/g, ' ').trim();
    if (!m[1] && t !== m[0].trim() && !(first && ALT_LABEL.test(first) && first.replace(ALT_LABEL, '') === '')) return;
    var v = t.slice(m[0].length).trim();
    if (!v && el.nextElementSibling) v = (el.nextElementSibling.innerText || el.nextElementSibling.textContent || '').trim();
    if (v && v.length < 700) { raw.push(v); comma = true; }
  });
  // 2. Element mit „alternative“/„alt-name“ in der Klasse
  if (!raw.length) { var c = root.querySelector('[class*="alternative"],[class*="alt-name"],[class*="altname"],[class*="alt_title"]'); if (c && (c.textContent || '').length < 700) raw.push((c.textContent || '').replace(ALT_LABEL, '')); }
  // 3. Zeile direkt unter dem Titel mit mehreren durch • getrennten Namen (Asura)
  // 3. Zeile direkt über oder unter dem Titel mit mehreren Namen: mit „•“ getrennt (Asura) oder mit Komma (Vortex: über dem
  //    Titel „대마법사 커리큘럼, The Archmage Curriculum“). Nur, wenn es nach Namen aussieht: jeder Teil kurz, nicht klein
  //    anfangend, kein Satz (kein Fließtext)
  var looksList = function (t, sep, one) {
    var ps = t.split(sep); if (ps.length < (one ? 1 : 2) || t.length > 500 || /[.!?]\s+\S/.test(t)) return false;
    return ps.every(function (x) { return x && x.length <= 120 && !/^[a-z]/.test(x); });
  };
  // Auch ein einzelner Name oder eine kleine Abwandlung des Titels („Archmage's Curriculum“): mindestens ein wichtiges
  // Wort des Titels kommt vor, kurz, kein Satz, keine Seitenbeschriftung (Kapitel, Lesen, Wertung, Brotkrumen …)
  var STOP = /^(the|and|for|with|from|his|her|its|you|your|are|was|who|how|not|but|der|die|das|und|von|des|les|del)$/;
  var words = function (s) { return String(s).toLowerCase().split(/[^\p{L}\p{N}']+/u).map(function (w) { return w.replace(/'s?$/, ''); }).filter(function (w) { return w.length >= 3 && !STOP.test(w); }); };
  var tw = words(h1 ? h1.textContent : '');
  var near = function (x) {
    x = x.trim(); if (!x || x.length > 100 || /^[a-z]/.test(x)) return false;
    if (/[.!?]\s+\S|[>›»|]|chapter|episode|kapitel|\bch\.?\s*\d|\bread\b|online|scans?\b|manga\b|manhwa\b|manhua\b|webtoon|novel|status|rating|author|artist|genre|bookmark|follow|views?\b|release|update/i.test(x)) return false;
    var ws = x.split(/\s+/); if (ws.length > 10) return false;
    // Fließtext hat viele klein geschriebene Wörter (Verben usw.), Namen kaum
    if (ws.filter(function (w) { return /^[a-z]{4,}/.test(w) && !STOP.test(w); }).length > 1) return false;
    var xw = words(x); return xw.some(function (w) { return tw.indexOf(w) >= 0; });
  };
  var tryLine = function (el) {
    if (raw.length || !el || el === h1 || el.querySelector && el.querySelector('h1')) return;
    var t = (el.textContent || '').replace(/\s+/g, ' ').replace(/[\s^˄˅▲▼⌃⌄›»]+$/, '').trim();
    if (!t || t.length > 500) return;
    if (/\s[•·]\s/.test(t) && looksList(t, /\s*[•·]\s*/)) raw.push(t);
    else if (/,\s/.test(t) && looksList(t, /\s*,\s+/)) { raw.push(t); comma = true; }
  };
  var tryNear = function (el) {
    if (raw.length || !el || el === h1 || el.querySelector && el.querySelector('h1') || el.childElementCount > 4) return;
    var t = (el.textContent || '').replace(/\s+/g, ' ').replace(/[\s^˄˅▲▼⌃⌄›»]+$/, '').trim();
    if (!t || t.length > 300 || normT(t) === title) return;
    var sep = /\s[•·]\s/.test(t) ? /\s*[•·]\s*/ : /,\s/.test(t) ? /\s*,\s+/ : /\s+\/\s+/;
    if (looksList(t, sep, true) && t.split(sep).some(near) && t.split(sep).every(function (x) { return x.trim().length <= 100; })) { raw.push(t); if (/,\s/.test(t) && !/[•·]/.test(t)) comma = true; }
  };
  if (!raw.length && h1) {
    var around = function (f) {
      for (var el = h1.previousElementSibling, i = 0; el && i < 2; el = el.previousElementSibling, i++) f(el);
      for (el = h1.nextElementSibling, i = 0; el && i < 3; el = el.nextElementSibling, i++) f(el);
      if (!raw.length && h1.parentElement) [].forEach.call(h1.parentElement.children, f);
    };
    around(tryLine);
    if (!raw.length) around(tryNear);
    var pe = h1.parentElement;
    if (!raw.length && pe && pe.childElementCount <= 4) { tryNear(pe.previousElementSibling); tryNear(pe.nextElementSibling); }
  }
  // 4. Seitendaten ("alternative_names" …), z. B. wenn die Seite den Inhalt erst im Browser zeichnet
  if (!raw.length) { var ja = jsonAlt(root); if (ja.length) raw.push(ja.join('\n')); }
  var out = [], seen = {};
  // Getrennt mit • ; | / oder Zeilen; bei einer Beschriftung ohne diese Zeichen auch mit Komma („A, B, C“)
  var all = raw.join('\n'), sep = comma && !/[•·;|\n]|\s\/\s/.test(all) ? /\s*,\s+/ : /\s*[•·;|\n]\s*|\s+\/\s+/;
  all.split(sep).forEach(function (x) {
    x = x.replace(/\s+/g, ' ').trim(); var k = normT(x);
    if (x.length < 2 || x.length > 150 || !k || k === title || seen[k]) return;
    seen[k] = 1; out.push(x);
  });
  return out.slice(0, 12);
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
  var self = canonUrl((location.origin + path).replace(/\/$/, '')), base = slugBase(self), key = base.replace(/[^a-z0-9]/g, '');
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
      else if (queueSelf(self)) runDisc();
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

/* Neue Serie beim Lesen: Erst fragen, ob sie in den Hub soll und bis wohin du schon gelesen hast. Ohne Antwort geht ihr
   Stand nicht in den Hub (token filtert), die Frage kommt beim nächsten Kapitel wieder. „Nein“ gilt für immer. */
function askNew() {
  var el = document.getElementById('mhub-ask');
  var url = location.origin + path, key = isChapter() ? seriesKeyOf(url) : '';
  if (!key || !GM_getValue(LIB, '') || libEntry(key) || newDecision(key) || askOff[key]) { if (el) el.remove(); return; }
  if (el && el.getAttribute('data-k') === key) return;
  if (el) el.remove();
  var n = chOf(url), title = slugOfPath(path.toLowerCase()).replace(/[-_]+/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  el = document.createElement('div'); el.id = 'mhub-ask'; el.setAttribute('data-k', key);
  el.style.cssText = 'position:fixed;left:8px;right:8px;margin:0 auto;bottom:calc(60px + env(safe-area-inset-bottom, 0px));z-index:2147483647;max-width:460px;' +
    'background:#1f1c2c;color:#ece9f6;border:1px solid #913fe2;border-radius:14px;padding:10px 12px;box-shadow:0 4px 18px rgba(0,0,0,.55);font:500 13px/1.35 system-ui,sans-serif';
  var h = document.createElement('div'); h.style.cssText = 'font-weight:700;margin-bottom:2px;padding-right:22px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
  h.textContent = L('Neu: ', 'New: ') + title;
  var x = document.createElement('div'); x.setAttribute('role', 'button'); x.setAttribute('aria-label', L('Später', 'Later')); x.textContent = '×';
  x.style.cssText = 'position:absolute;top:4px;right:10px;font-size:20px;cursor:pointer;color:#9893b0';
  x.addEventListener('click', function (ev) { ev.stopPropagation(); askOff[key] = 1; el.remove(); });
  var row = document.createElement('label'); row.style.cssText = 'display:flex;align-items:center;gap:8px;margin:6px 0 8px;color:#9893b0;font-size:12.5px';
  row.appendChild(document.createTextNode(L('In deinen Hub? Gelesen bis Kapitel', 'Add to your hub? Read up to chapter')));
  var inp = document.createElement('input'); inp.type = 'number'; inp.inputMode = 'decimal'; inp.min = '0'; inp.step = 'any';
  inp.value = n != null ? String(Math.max(0, Math.ceil(n) - 1)) : '0';
  inp.style.cssText = 'width:72px;padding:6px 8px;border-radius:8px;border:1px solid #322d45;background:#16151d;color:#fff;font:600 14px system-ui,sans-serif';
  row.appendChild(inp);
  var btns = document.createElement('div'); btns.style.cssText = 'display:flex;gap:8px';
  var decide = function (ok) {
    var q = get(NEWQ), r = parseFloat(String(inp.value).replace(',', '.'));
    q[key] = { ok: ok, r: ok && isFinite(r) ? Math.max(0, r) : 0, t: Date.now() }; put(NEWQ, q);
    el.remove(); flash(ok ? L('✓ Kommt in den Hub', '✓ Going to your hub') : L('Wird nicht übernommen', 'Not added'));
  };
  btns.appendChild(cardBtn(L('Übernehmen', 'Add'), function () { decide(true); }, true));
  btns.appendChild(cardBtn(L('Nein', 'No'), function () { decide(false); }, false));
  el.appendChild(x); el.appendChild(h); el.appendChild(row); el.appendChild(btns);
  ['touchstart', 'touchend', 'click', 'keydown'].forEach(function (t) { el.addEventListener(t, function (ev) { ev.stopPropagation(); }); });
  (document.body || document.documentElement).appendChild(el);
}
var askOff = {};

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
  setTimeout(askNew, 1500);
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
  askNew();
  pill.style.display = 'none'; cleanBtn.style.display = 'none';
  cardKey = ''; setTimeout(seriesCard, 800);
  clearTimeout(dockT); dock.style.opacity = '1'; dock.style.pointerEvents = 'auto';
  canonMigrate();
  if (SERIES.test(path)) {
    setTimeout(function () { grabCover(false); }, 1500);
    var self = canonUrl((location.origin + path).replace(/\/$/, ''));
    if (!get(DISC)[self]) queueSelf(self);
  }
  clearTimeout(discT); discT = setTimeout(discover, 1200);
}

window.addEventListener('scroll', function () {
  trackAct(); tickRead();
  onScroll();
  if (!isChapter()) { clearTimeout(discT); discT = setTimeout(discover, 1000); }
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
