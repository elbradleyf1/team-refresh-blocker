// Runs inside the F1 Fantasy page itself, so it can see the site's own requests.
//
// Team requests (/getteam/) are allowed when:
//   - the site first loads your team after the page opens (including F5):
//     that request, plus any others in the next few seconds;
//   - you move to another screen in the site: for a few seconds after;
//   - you save changes (e.g. Confirm Changes): while the save is in progress
//     and for a few seconds after it succeeds, so the site can show your
//     newly saved team.
// Every other team request is blocked, whatever numbers are in its address.
// Blocked requests fail as if the network had dropped, so the site keeps the
// team you're editing, and it isn't left waiting forever.
(() => {
  const DEBUG = false; // true = log every decision to the console, prefixed [TRB]
  const PATTERN = '/getteam/';
  const LOAD_WINDOW_MS = 3000; // after the first team request since the page opened
  const NAV_WINDOW_MS = 3000;  // after moving to another screen in the site
  const SAVE_WINDOW_MS = 5000; // after a save succeeds
  const FAIL_DELAY_MS = 1000;  // short pause before failing, so retries can't spin
  const root = document.documentElement;
  let firstLoadDone = false;
  let allowUntil = 0;      // team requests allowed until this time...
  let allowReason = '';    // ...because of this
  let savesInProgress = 0;
  const t0 = performance.now();

  const isOn = () => root.dataset.f1rbEnabled !== 'off';
  const page = () => location.pathname + location.hash;
  const secs = ms => (ms / 1000).toFixed(1) + 's';
  const log = (...a) => {
    if (DEBUG) console.log('[TRB]', secs(performance.now() - t0), ...a);
  };

  const toUrl = raw => { try { return new URL(raw, location.href); } catch { return null; } };

  // A save is a request that changes your team: transferteam (Confirm Changes),
  // or any other non-GET request to the game's user services that isn't a "get".
  function isSave(url, method) {
    const path = url.pathname;
    if (path.includes('/transferteam')) return true;
    if (!path.startsWith('/services/user/')) return false;
    if (String(method || 'GET').toUpperCase() === 'GET') return false;
    return !path.split('/').some(seg => seg.toLowerCase().startsWith('get'));
  }

  function allowFor(ms, reason) {
    const until = performance.now() + ms;
    if (until > allowUntil) { allowUntil = until; allowReason = reason; }
  }

  function saveStarted(via, method, path) {
    savesInProgress++;
    log('SAVE ', via, method, path, '| team requests allowed until it finishes');
  }
  function saveFinished(ok, path) {
    savesInProgress = Math.max(0, savesInProgress - 1);
    if (ok) allowFor(SAVE_WINDOW_MS, 'after a save');
    log('SAVED', path, ok ? '| ok, team requests allowed for ' + secs(SAVE_WINDOW_MS) : '| failed, nothing extra allowed');
  }

  function shouldBlock(url, via) {
    if (!url) return false;
    const path = url.pathname;
    if (!path.includes(PATTERN)) {
      if (path.startsWith('/services/')) log('PASS ', via, path);
      return false;
    }
    if (!isOn()) { log('OFF  ', via, path); return false; }

    // The numbers in the address don't matter, only when the request happens.
    if (!firstLoadDone) {
      firstLoadDone = true;
      allowFor(LOAD_WINDOW_MS, 'part of page load');
      log('ALLOW', via, path, '| first team load since the page opened |', page());
      return false;
    }
    if (savesInProgress > 0) {
      log('ALLOW', via, path, '| save in progress |', page());
      return false;
    }
    if (performance.now() <= allowUntil) {
      log('ALLOW', via, path, '|', allowReason, '|', page());
      return false;
    }
    log('BLOCK', via, path, '|', page());
    window.postMessage({ source: 'f1rb', type: 'held' }, location.origin);
    return true;
  }

  // fetch()
  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    const url = toUrl(typeof input === 'string' ? input : (input && (input.url || input.href)) || '');
    const method = (init && init.method) || (input && input.method) || 'GET';
    if (shouldBlock(url, 'fetch')) {
      return new Promise((_, reject) =>
        setTimeout(() => reject(new TypeError('Failed to fetch')), FAIL_DELAY_MS));
    }
    const result = origFetch.apply(this, arguments);
    if (url && isSave(url, method)) {
      saveStarted('fetch', method, url.pathname);
      result.then(r => saveFinished(r.ok, url.pathname), () => saveFinished(false, url.pathname));
    }
    return result;
  };

  // XMLHttpRequest
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  const progress = type =>
    typeof ProgressEvent === 'function' ? new ProgressEvent(type) : new Event(type);

  XMLHttpRequest.prototype.open = function (method, url) {
    if (Object.prototype.hasOwnProperty.call(this, 'readyState')) delete this.readyState;
    this.__f1rbUrl = url;
    this.__f1rbMethod = method;
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    const url = toUrl(String(this.__f1rbUrl || ''));
    if (shouldBlock(url, 'xhr')) {
      // Don't send it; fire the same events a network error would.
      const xhr = this;
      setTimeout(() => {
        Object.defineProperty(xhr, 'readyState', { configurable: true, get: () => 4 });
        xhr.dispatchEvent(new Event('readystatechange'));
        xhr.dispatchEvent(progress('error'));
        xhr.dispatchEvent(progress('loadend'));
      }, FAIL_DELAY_MS);
      return;
    }
    if (url && isSave(url, this.__f1rbMethod)) {
      saveStarted('xhr', this.__f1rbMethod, url.pathname);
      const xhr = this;
      xhr.addEventListener('loadend', () =>
        saveFinished(xhr.status >= 200 && xhr.status < 300, url.pathname), { once: true });
    }
    return origSend.apply(this, arguments);
  };

  // Moving to another screen in the site (it changes the address without
  // reloading). pushState = clicking through; popstate = Back/Forward.
  // replaceState is only logged: sites use it for small address tweaks too.
  const origPush = history.pushState;
  history.pushState = function () {
    const r = origPush.apply(this, arguments);
    allowFor(NAV_WINDOW_MS, 'moved to another screen');
    log('NAV  ', page(), '| team requests allowed for ' + secs(NAV_WINDOW_MS));
    return r;
  };
  window.addEventListener('popstate', () => {
    allowFor(NAV_WINDOW_MS, 'moved to another screen');
    log('NAV  ', page(), '(back/forward) | team requests allowed for ' + secs(NAV_WINDOW_MS));
  });
  if (DEBUG) {
    const origReplace = history.replaceState;
    history.replaceState = function () {
      const r = origReplace.apply(this, arguments);
      log('NAV  ', page(), '(replace, nothing extra allowed)');
      return r;
    };
  }

  log('START', 'blocking', isOn() ? 'on' : 'off', '| page', page());
})();
