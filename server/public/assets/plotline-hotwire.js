/*!
 * plotline-hotwire.js: makes the Plotline Web SDK (3.x) behave correctly under Hotwire
 * (Turbo Drive 7/8 and Hotwire Native iOS/Android). Load it in <head>, before or after the
 * Plotline loader snippet, and call PlotlineHotwire.start({...}) instead of plotline('init', ...).
 *
 * What it fixes (see the Hotwire integration report for the root causes):
 *  0. A Turbo visit to another page closes the open campaign, as leaving a screen does in the
 *     Android SDK. Steps set to "Don't dismiss on click outside" stay open, as on Android.
 *  1. Campaign views, surveys, stories, toasts and the page-capture button are appended to <body>.
 *     Turbo replaces <body> on every visit, so they vanished and the SDK stayed "showing" (no more
 *     campaigns until a reload). Whatever is still open is now carried into the new <body>.
 *  2. Turbo's snapshot cache cloned live overlays and widgets into restored pages (dead close
 *     buttons, dead widget CTAs). Clones are stripped before a cached page is rendered.
 *  3. Turbo 8 morph refreshes removed SDK nodes. They are kept.
 *  4. Hotwire Native changes the URL when a visit starts, before the new page renders, so the SDK
 *     ran the next page's campaigns on the previous page. The page id now follows the rendered page.
 *  5. Batched analytics events were lost when a WebView reloaded within the batch window. The batch
 *     is flushed when the page is hidden or unloaded.
 *  6. "Open URL" CTAs call window.open(), which is a no-op from script on Hotwire Native Android.
 *     In Hotwire Native, http(s) URLs are routed through Turbo / the native router instead.
 *  8. Optional: login/logout through Turbo keeps the same JS context, so the SDK kept the old user.
 *     With userIdMeta, the user id is read from a <meta> tag on every page and re-init runs on change.
 *  7. Optional: a "Hotwire App Open" event that fires once per app session across all WebViews
 *     (iOS modals use a separate WebView, and pull-to-refresh is a cold boot, so the SDK's own
 *     "Default: App Open" fires far more often than real app opens).
 * Items 0, 1, 4, 5 use SDK internals that are stable in 3.6.x; each use is guarded and fails open.
 */
(function () {
  'use strict';
  if (window.PlotlineHotwire) return;

  var ua = navigator.userAgent || '';
  var nativeMatch = /(?:Hotwire|Turbo) Native (iOS|Android)/.exec(ua);
  var shell = nativeMatch ? nativeMatch[1].toLowerCase() : 'web';
  var SDK_ROOTS = [
    '.plotline-flows-container', '.plotline-story-dialog', '.plotline-overlay', '[class^="plotline-dialog"]',
    '.plotline-agent-container', '.plotline-toast', '.plotline-page-capture-btn-container',
    '.plotline-page-capture-notification',
  ];
  var ROOT_SELECTOR = SDK_ROOTS.map(function (s) { return ':scope > ' + s; }).join(',');
  var SDK_NODE_SELECTOR = SDK_ROOTS.join(',') + ',[data-plotline-widget-id],[data-plotline-loader]';
  var state = { started: false, apiKey: null, userId: null, renderedPath: location.pathname, leftPage: false, visitLoading: false, options: {} };

  function warn(msg, err) { try { console.warn('[plotline-hotwire] ' + msg, err || ''); } catch (e) { /* noop */ } }
  function sdk() { return window.PlotlineWeb || null; }
  // SDK builds with built-in Turbo handling (shouldHandleTurboNavigation) do items 1-4 and 6 themselves.
  function sdkHandlesTurbo() {
    try {
      var s = sdk();
      return !!(s && typeof s.getShouldHandleTurboNavigation === 'function' && s.getShouldHandleTurboNavigation());
    } catch (e) { return false; }
  }
  function pl() {
    if (typeof window.plotline !== 'function') return;
    try { window.plotline.apply(null, arguments); } catch (e) { warn('plotline() call failed', e); }
  }

  // 0: the 3.6 SDK has no public dismiss call. setShouldDisablePlotline(true) runs its own
  // dismissActiveFlow(), the path a user's dismiss takes; its Disabled/Enabled events are muted
  // because this is a page change, not the host turning Plotline off.
  function dismissOpenCampaign() {
    var s = sdk();
    if (!s || typeof s.setShouldDisablePlotline !== 'function' || !s.getIsShowingCampaign()) return;
    if (s.getShouldDisablePlotline()) return; // the host turned Plotline off: nothing is on screen
    var store = s.getFlowStore();
    var step = store && store.stepsOfActiveFlow && store.stepsOfActiveFlow[store.nextFlowStepIndex - 1];
    if (step && step.dismissAfter === -1) return; // "Don't dismiss on click outside" stays, as on Android
    var ownSendEvent = Object.prototype.hasOwnProperty.call(s, 'sendEvent');
    var sendEvent = s.sendEvent;
    s.sendEvent = function () {};
    try {
      s.setShouldDisablePlotline(true);
    } finally {
      try { s.setShouldDisablePlotline(false); } finally {
        if (ownSendEvent) s.sendEvent = sendEvent; else delete s.sendEvent;
      }
    }
  }

  function onVisit(event) {
    state.visitLoading = true;
    try {
      if (sdkHandlesTurbo()) return;
      var url = event.detail && event.detail.url;
      // Another page id (pathname) only: refreshes, same-page redirects and query changes keep it open.
      if (typeof url === 'string' && new URL(url, location.href).pathname !== state.renderedPath) {
        state.leftPage = true;
        dismissOpenCampaign();
        // As Android on pause: nothing else is shown on the page being left.
        var search = sdk() && sdk()._elementSearchTask;
        if (search && typeof search.setShouldStop === 'function') search.setShouldStop(true);
      }
    } catch (e) { warn('visit handling failed', e); }
  }

  // 1 + 2: carry live SDK nodes into the incoming <body>; drop stale clones that came from Turbo's cache.
  function onBeforeRender(event) {
    try {
      var detail = event.detail;
      // One handler per render: the SDK's own handler (newer builds) uses the same flag.
      if (!detail || detail.plotlineCarried || sdkHandlesTurbo()) return;
      detail.plotlineCarried = true;
      var newBody = detail.newBody;
      if (!newBody || newBody === document.body) return;
      var clones = newBody.querySelectorAll(SDK_NODE_SELECTOR);
      for (var i = 0; i < clones.length; i++) clones[i].remove();
      var live = document.body ? document.body.querySelectorAll(ROOT_SELECTOR) : [];
      for (var j = 0; j < live.length; j++) newBody.appendChild(live[j]);
      // A survey or story locks scrolling on <body>; keep the lock on the new one while it is open.
      if (live.length && document.body.style.overflow === 'hidden') newBody.style.overflow = 'hidden';
    } catch (e) { warn('before-render handling failed', e); }
  }

  // 3: Turbo 8 morph refresh would remove nodes the server never rendered.
  function onBeforeMorphElement(event) {
    try {
      if (sdkHandlesTurbo()) return;
      var el = event.target;
      if (event.detail && !event.detail.newElement && el && el.closest && el.closest(SDK_NODE_SELECTOR)) {
        event.preventDefault();
      }
    } catch (e) { /* noop */ }
  }

  // 4: the page id follows the page on screen, not the URL of a visit still loading.
  function onRendered() {
    state.visitLoading = false;
    state.renderedPath = location.pathname;
    var isNewPage = state.leftPage;
    state.leftPage = false;
    try {
      var task = sdk() && sdk()._currentPageTrackingTask;
      if (task && typeof task._track === 'function') {
        if (isNewPage) task._currentPage = ''; // left and rendered again: a new page, even if the same one
        task._track(); // pick up the new page now, not in <= 1 s
      }
    } catch (e) { /* the 1 s poll still picks it up */ }
  }
  function currentPageId() {
    return 'a:' + (window.Turbo ? state.renderedPath : location.pathname);
  }

  // 5: send queued analytics before the WebView is hidden, torn down or reloaded.
  function flushEvents() {
    try {
      var task = sdk() && sdk().getEventsBatchUploaderTask && sdk().getEventsBatchUploaderTask();
      if (task && typeof task._uploadEvents === 'function') task._uploadEvents();
    } catch (e) { warn('event flush failed', e); }
  }

  // 6: in Hotwire Native, route http(s) window.open() calls (Plotline "Open URL" CTAs) like a link tap.
  function routeWindowOpen() {
    if (shell === 'web' && !state.options.openSameOriginInPlace) return;
    var original = window.open;
    window.open = function (url, target) {
      try {
        if (sdkHandlesTurbo() && shell !== 'web') return original.apply(window, arguments);
        var u = new URL(String(url), location.href);
        if (u.protocol === 'http:' || u.protocol === 'https:') {
          var sameOrigin = u.origin === location.origin;
          if (sameOrigin && window.Turbo && typeof window.Turbo.visit === 'function') {
            window.Turbo.visit(u.href);
            return null;
          }
          if (shell !== 'web') {
            window.location.href = u.href; // the native router opens external URLs outside the WebView
            return null;
          }
        }
      } catch (e) { /* fall through */ }
      return original.apply(window, arguments);
    };
  }

  // 7: one "app open" per app session, shared by every WebView of the app (same origin storage).
  function trackAppSession() {
    var name = state.options.appOpenEvent;
    if (!name) return;
    var key = 'plotline_hotwire_session';
    var timeoutMs = state.options.sessionTimeoutMs || 30 * 60 * 1000;
    var now = Date.now();
    var last = 0;
    try { last = Number(JSON.parse(localStorage.getItem(key) || '{}').lastSeen || 0); } catch (e) { last = 0; }
    if (now - last > timeoutMs) pl('track', name, { shell: shell });
    var beat = function () {
      try { localStorage.setItem(key, JSON.stringify({ lastSeen: Date.now() })); } catch (e) { /* noop */ }
    };
    beat();
    document.addEventListener('turbo:load', beat);
    document.addEventListener('visibilitychange', beat);
    setInterval(function () { if (document.visibilityState === 'visible') beat(); }, 60 * 1000);
  }

  function userIdFromMeta(name) {
    var meta = document.querySelector('meta[name="' + name + '"]');
    var id = meta ? (meta.getAttribute('content') || '') : '';
    return id || undefined; // empty = logged out: the SDK falls back to its anonymous id
  }

  function syncUserFromMeta() {
    var name = state.options.userIdMeta;
    if (!name) return;
    var id = userIdFromMeta(name);
    if (id !== state.userId) start({ apiKey: state.apiKey, endpoint: state.options.endpoint, userId: id });
  }

  function start(options) {
    options = options || {};
    if (!state.started && options.userIdMeta && options.userId === undefined) {
      options.userId = userIdFromMeta(options.userIdMeta);
    }
    if (!options.apiKey) { warn('start() needs an apiKey'); return; }
    if (state.started) {
      // Same JS context, new user (login/logout): re-init once, after stopping the old tasks.
      if (options.userId !== state.userId) {
        flushEvents(); // the old user's queued events go out under the old user
        try { if (sdk() && sdk().getIsInitialised()) sdk().deinit(); } catch (e) { /* noop */ }
        state.userId = options.userId;
        pl('init', options.apiKey, options.userId, options.endpoint);
      }
      return;
    }
    state.started = true;
    state.apiKey = options.apiKey;
    state.userId = options.userId;
    state.options = options;

    document.addEventListener('turbo:visit', onVisit);
    document.addEventListener('turbo:before-render', onBeforeRender);
    document.addEventListener('turbo:before-morph-element', onBeforeMorphElement);
    document.addEventListener('turbo:render', onRendered);
    document.addEventListener('turbo:load', onRendered);
    // A frame is part of the page on screen; while a page visit loads, that visit's render decides.
    document.addEventListener('turbo:frame-render', function () { if (!state.visitLoading) onRendered(); });
    if (options.userIdMeta) document.addEventListener('turbo:load', syncUserFromMeta);
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flushEvents(); });
    window.addEventListener('pagehide', flushEvents);
    routeWindowOpen();

    pl('overrideInternals', 'get-current-page-id', currentPageId);
    pl('init', options.apiKey, options.userId, options.endpoint);
    if (options.identifyShell !== false) pl('identify', { hotwire_shell: shell });
    trackAppSession();
  }

  window.PlotlineHotwire = { start: start, shell: shell, flushEvents: flushEvents };
})();
