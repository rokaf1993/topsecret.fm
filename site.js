/* ==========================================================
   topsecret.fm — persistent player + seamless page navigation
   Loaded once in <head>. Clicking a link inside the site swaps
   the page in place instead of reloading, so the stream keeps
   playing while you browse.
   ========================================================== */
(function () {
  if (window.__tsSite) return;
  window.__tsSite = true;

  var STREAM_URL = 'https://azura-3949.az-streamingserver.com/listen/topsecret.fm/topsecretfm.mp3';

  /* ---------- the one audio element (lives outside the page, never replaced) ---------- */
  var audio = new Audio();
  audio.preload = 'none';
  var wantPlaying = false;

  function isPlaying() { return wantPlaying && !audio.paused; }

  function relabel() {
    var on = isPlaying();
    document.querySelectorAll('.navlisten').forEach(function (b) {
      b.innerHTML = '<span class="dot"></span>' + (on ? 'Pause' : 'Listen live');
      b.classList.toggle('playing', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    document.querySelectorAll('.js-tune-in').forEach(function (b) {
      b.textContent = on ? '⏸ Pause' : '▶ Tune in now';
      b.classList.toggle('playing', on);
    });
    document.querySelectorAll('.js-tune-in-quiet').forEach(function (b) {
      b.classList.toggle('playing', on);
    });
  }

  function toggle() {
    if (isPlaying()) {
      wantPlaying = false;
      audio.pause();
      // drop the connection so the next play is live, not buffered from minutes ago
      audio.removeAttribute('src'); audio.load();
    } else {
      wantPlaying = true;
      audio.src = STREAM_URL;
      audio.play().catch(function () { wantPlaying = false; relabel(); });
    }
    relabel();
  }

  audio.addEventListener('playing', relabel);
  audio.addEventListener('pause', relabel);
  audio.addEventListener('error', function () { if (wantPlaying) { wantPlaying = false; relabel(); } });

  if ('mediaSession' in navigator) {
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: 'topsecret.fm — live',
        artist: 'Marginalised voices first — the best kept secret'
      });
      navigator.mediaSession.setActionHandler('play', function () { if (!isPlaying()) toggle(); });
      navigator.mediaSession.setActionHandler('pause', function () { if (isPlaying()) toggle(); });
    } catch (e) {}
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('.navlisten, .js-tune-in, .js-tune-in-quiet');
    if (!b) return;
    e.preventDefault();
    toggle();
  });

  /* ---------- page timers: tracked so they stop when you leave a page ---------- */
  var _setInterval = window.setInterval.bind(window);
  var _setTimeout = window.setTimeout.bind(window);
  var _clearInterval = window.clearInterval.bind(window);
  var _clearTimeout = window.clearTimeout.bind(window);
  var pageIntervals = [], pageTimeouts = [];
  window.setInterval = function () { var id = _setInterval.apply(null, arguments); pageIntervals.push(id); return id; };
  window.setTimeout = function () { var id = _setTimeout.apply(null, arguments); pageTimeouts.push(id); return id; };
  function clearPageTimers() {
    pageIntervals.forEach(_clearInterval); pageTimeouts.forEach(_clearTimeout);
    pageIntervals = []; pageTimeouts = [];
  }

  /* ---------- seamless navigation ---------- */
  var canSwap = !!(window.fetch && window.DOMParser && window.history && history.pushState) &&
                location.protocol.indexOf('http') === 0;

  function isInternalPage(a) {
    if (!a || !a.href) return false;
    if (a.target && a.target !== '_self') return false;
    if (a.hasAttribute('download')) return false;
    var url = new URL(a.href, location.href);
    if (url.origin !== location.origin) return false;
    if (url.pathname === location.pathname && url.hash) return false; // same-page anchor
    if (a.getAttribute('href') === '#' || a.getAttribute('href') === '') return false;
    return /(\.html?|\/)$/.test(url.pathname);
  }

  function runScripts(container) {
    container.querySelectorAll('script').forEach(function (old) {
      var s = document.createElement('script');
      if (old.src) {
        if (/site\.js(\?|$)/.test(old.src)) { old.remove(); return; }
        s.src = old.src;
      } else {
        // each page's code runs in its own scope, so re-visiting a page never clashes
        s.textContent = '(function(){\n' + old.textContent + '\n})();';
      }
      old.replaceWith(s);
    });
  }

  function swapHead(doc) {
    document.title = doc.title;
    var brand = document.querySelector('link[href$="brand.css"]');
    document.head.querySelectorAll('style').forEach(function (s) { s.remove(); });
    doc.head.querySelectorAll('style').forEach(function (s) {
      var n = document.createElement('style'); n.textContent = s.textContent;
      document.head.insertBefore(n, brand);
    });
    var d = document.querySelector('meta[name="description"]'), nd = doc.querySelector('meta[name="description"]');
    if (d && nd) d.setAttribute('content', nd.getAttribute('content'));
  }

  var busy = false;
  function go(url, push) {
    if (busy) return;
    busy = true;
    document.documentElement.classList.add('ts-loading');
    fetch(url, { credentials: 'same-origin', cache: 'no-cache' }) // always check for the current page, never an old saved copy
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); })
      .then(function (html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        if (!doc.querySelector('.masthead')) throw new Error('not a site page');
        clearPageTimers();
        swapHead(doc);
        doc.body.querySelectorAll('audio#topsecretAudio').forEach(function (a) { a.remove(); });
        document.body.className = doc.body.className;
        document.body.innerHTML = doc.body.innerHTML;
        if (push) history.pushState({ ts: 1 }, '', url);
        runScripts(document.body);
        relabel();
        var hash = new URL(url, location.href).hash;
        var target = hash && document.getElementById(hash.slice(1));
        if (target) target.scrollIntoView(); else window.scrollTo(0, 0);
      })
      .catch(function () { location.href = url; })
      .then(function () { busy = false; document.documentElement.classList.remove('ts-loading'); });
  }

  if (canSwap) {
    history.replaceState({ ts: 1 }, '', location.href);
    document.addEventListener('click', function (e) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var a = e.target.closest && e.target.closest('a');
      if (!isInternalPage(a)) return;
      e.preventDefault();
      go(a.href, true);
    });
    window.addEventListener('popstate', function (e) {
      if (e.state && e.state.ts) go(location.href, false);
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('audio#topsecretAudio').forEach(function (a) { a.remove(); });
    relabel();
  });
})();
