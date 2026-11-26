/*!
 * plotline-hotwire.js 2.0: makes the Plotline Web SDK (3.x) behave correctly under Hotwire
 * (Turbo Drive 7/8 and Hotwire Native iOS/Android). Load it in <head>, before or after the
 * Plotline loader snippet, and call PlotlineHotwire.start({...}) instead of plotline('init', ...).
 *
 * What it fixes (see the Hotwire integration report for the root causes):
 *  0. Leaving a page closes the open campaign, as leaving a screen does in the native SDKs. It is
 *     hidden at once, before Hotwire Native screenshots the screen being left (Android keeps that
 *     screenshot behind a modal sheet and shows it on Back). Steps set to "Don't dismiss on click
 *     outside" stay open, as on Android. A walkthrough's next step still shows on its own page.
 *  1. Campaign views, surveys, stories, toasts and the page-capture button are appended to <body>.
 *     Turbo replaces <body> on every visit; whatever is still open is carried into the new <body>.
 *  2. Turbo's snapshot cache cloned live overlays and widgets into restored pages (dead close
 *     buttons, dead widget CTAs). Clones are stripped before a cached page is rendered.
 *  3. Turbo 8 morph refreshes removed SDK nodes. They are kept.
 *  4. Hotwire Native changes the URL when a visit starts, before the new page renders, so the SDK
 *     ran the next page's campaigns on the previous page. The page id now follows the rendered page.
 *  5. Batched analytics events were lost when a WebView reloaded within the batch window. The batch
 *     is flushed when the page is hidden or unloaded.
 *  6. "Open URL" CTAs call window.open(), which is a no-op from script on Hotwire Native Android.
 *     In Hotwire Native, http(s) URLs are routed through Turbo / the native router instead.
 *  7. "Default: App Open" fires once per app session, as in the native SDKs, not once per WebView
 *     boot (iOS modals use a second WebView; pull-to-refresh is a cold boot). Exact per app launch
 *     when the native app adds "PlotlineLaunch/<id>" to its user agent (see the README).
 *  8. Optional: login/logout through Turbo keeps the same JS context, so the SDK kept the old user.
 *     With userIdMeta, the user id is read from a <meta> tag on every page and re-init runs on change.
 *  9. A multi-step campaign continues in another WebView of the app (iOS modals): the WebView that
 *     shows the next step's page shows that step, and the first WebView lets the campaign go.
 * 10. In Hotwire Native, a WebView that is hidden (a dismissed iOS modal, the app in the background)
 *     closes its open campaign, as Android does on pause; shown again, it counts as a new page view.
 * Items 0, 1, 4, 5, 7 and 9 use SDK internals that are stable in 3.6.x; each use is guarded and fails open.
 */
(function () {
  'use strict';
  if (window.PlotlineHotwire) return;

  var VERSION = '2.0.0';
  var ua = navigator.userAgent || '';
  var nativeMatch = /(?:Hotwire|Turbo) Native (iOS|Android)/.exec(ua);
  var shell = nativeMatch ? nativeMatch[1].toLowerCase() : 'web';
  var isNative = shell !== 'web';
  var FLOW_CONTAINER = '.plotline-flows-container';
  var LEAVING = 'data-plotline-leaving';
  var SDK_ROOTS = [
    '.plotline-flows-container', '.plotline-story-dialog', '.plotline-overlay', '[class^="plotline-dialog"]',
    '.plotline-agent-container', '.plotline-toast', '.plotline-page-capture-btn-container',
    '.plotline-page-capture-notification',
  ];
  var ROOT_SELECTOR = SDK_ROOTS.map(function (s) { return ':scope > ' + s; }).join(',');
  var SDK_NODE_SELECTOR = SDK_ROOTS.join(',') + ',[data-plotline-widget-id],[data-plotline-loader]';
  var SESSION_KEY = 'plotline_hotwire_session';     // localStorage: shared by every WebView of the app
  var WALK_KEY = 'plotline_hotwire_walkthrough';    // localStorage: a multi-step campaign waiting for its next page
  var BOOT_KEY = 'plotline_hotwire_booted';         // sessionStorage: this WebView booted before (a reload)
  var APP_OPEN = 'Default: App Open';
  var webviewId = 'wv' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  var state = {
    started: false, apiKey: null, userId: null, renderedPath: location.pathname, leftPage: false,
    visitLoading: false, options: {}, holdProposal: false, isAppOpen: true, raw: {}, published: null,
  };

  function warn(msg, err) { try { console.warn('[plotline-hotwire] ' + msg, err || ''); } catch (e) { /* noop */ } }
  function sdk() { return window.PlotlineWeb || null; }
  function sessionTimeoutMs() { return state.options.sessionTimeoutMs || 30 * 60 * 1000; }
  function readJSON(store, key) { try { return JSON.parse(store.getItem(key) || 'null'); } catch (e) { return null; } }
  function writeJSON(store, key, value) { try { store.setItem(key, JSON.stringify(value)); } catch (e) { /* noop */ } }
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
  function flowStore(s) {
    var store = s && typeof s.getFlowStore === 'function' ? s.getFlowStore() : null;
    return store && Array.isArray(store.stepsOfActiveFlow) ? store : null;
  }

  // 0: the 3.6 SDK has no public dismiss call. setShouldDisablePlotline(true) runs its own
  // dismissActiveFlow(), the path a user's dismiss takes; its Disabled/Enabled events are muted
  // because this is a page change, not the host turning Plotline off. Returns true if it closed one.
  function dismissOpenCampaign() {
    var s = sdk();
    if (!s || typeof s.setShouldDisablePlotline !== 'function' || !s.getIsShowingCampaign()) return false;
    if (s.getShouldDisablePlotline()) return false; // the host turned Plotline off: nothing is on screen
    var store = flowStore(s);
    var step = store && store.stepsOfActiveFlow[store.nextFlowStepIndex - 1];
    if (step && step.dismissAfter === -1) return false; // "Don't dismiss on click outside" stays, as on Android
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
    return true;
  }

  // 0: a closing flow view fades out for 300 ms. Hide it now, so it is not in the frame the native side
  // screenshots, and not carried into the next page. A step that stays open is the newest container.
  function hideClosingOverlays() {
    var s = sdk();
    var stillShowing = !!(s && s.getIsShowingCampaign && s.getIsShowingCampaign());
    var containers = document.querySelectorAll(FLOW_CONTAINER);
    var hid = false;
    for (var i = 0; i < containers.length; i++) {
      if (stillShowing && i === containers.length - 1) continue;
      var c = containers[i];
      if (c.getAttribute(LEAVING) === '1') continue;
      c.setAttribute(LEAVING, '1');
      c.style.setProperty('transition', 'none', 'important');
      c.style.setProperty('display', 'none', 'important');
      hid = true;
    }
    return hid;
  }

  function leavePage() {
    dismissOpenCampaign();
    return hideClosingOverlays();
  }

  // 0: Hotwire Native screenshots the screen being left as soon as it gets the visit proposal. Hold the
  // proposal until the frame without the overlay is painted (2 frames, the bridge's own afterNextRepaint).
  function holdNativeProposals() {
    var native = window.turboNative;
    if (!native || native.__plotlineHold || typeof native.visitProposedToLocation !== 'function') return;
    var original = native.visitProposedToLocation;
    native.visitProposedToLocation = function () {
      var self = this, args = arguments;
      if (!state.holdProposal) return original.apply(self, args);
      state.holdProposal = false;
      var sent = false;
      var send = function () { if (!sent) { sent = true; original.apply(self, args); } };
      if (document.hidden || typeof window.requestAnimationFrame !== 'function') return send();
      window.requestAnimationFrame(function () { window.requestAnimationFrame(send); });
      window.setTimeout(send, 150); // never lose a navigation if frames stall
    };
    native.__plotlineHold = true;
  }

  // Runs on window, after the app's own listeners, so a visit the app cancels changes nothing.
  function onBeforeVisit(event) {
    if (event.defaultPrevented) return;
    try {
      var url = event.detail && event.detail.url;
      // Another page id (pathname) only: refreshes, same-page redirects and query changes keep it open.
      if (typeof url !== 'string' || new URL(url, location.href).pathname === state.renderedPath) return;
      if (leavePage() && isNative) {
        holdNativeProposals();
        state.holdProposal = true;
      }
    } catch (e) { warn('before-visit handling failed', e); }
  }

  function onVisit(event) {
    state.visitLoading = true;
    state.holdProposal = false;
    try {
      var url = event.detail && event.detail.url;
      var leaving = typeof url === 'string' && new URL(url, location.href).pathname !== state.renderedPath;
      if (leaving) hideClosingOverlays();
      if (sdkHandlesTurbo()) return;
      // Visits the native side starts (back, a closed modal) have no before-visit: close the campaign here.
      if (leaving) {
        state.leftPage = true;
        leavePage();
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
      var carried = 0;
      for (var j = 0; j < live.length; j++) {
        if (live[j].getAttribute(LEAVING) === '1') continue; // closing: it goes with the old page
        newBody.appendChild(live[j]);
        carried++;
      }
      // A survey or story locks scrolling on <body>; keep the lock on the new one while it is open.
      if (carried && document.body.style.overflow === 'hidden') newBody.style.overflow = 'hidden';
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
    syncWalkthrough();
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

  // 7: is this WebView boot an app open? A reload of this WebView is not; with a launch id in the user
  // agent, one per launch; otherwise one per app session (no WebView of the app seen for sessionTimeoutMs).
  function decideAppOpen() {
    var reloaded = false;
    try {
      reloaded = window.sessionStorage.getItem(BOOT_KEY) === '1';
      window.sessionStorage.setItem(BOOT_KEY, '1');
    } catch (e) { /* noop */ }
    var rec = readJSON(window.localStorage, SESSION_KEY) || {};
    var launch = /PlotlineLaunch\/([A-Za-z0-9._-]+)/.exec(ua);
    var appOpen;
    if (reloaded) appOpen = false;
    else if (launch) appOpen = rec.launchId !== launch[1];
    else appOpen = !(Date.now() - Number(rec.lastSeen || 0) <= sessionTimeoutMs());
    rec.lastSeen = Date.now();
    if (launch) rec.launchId = launch[1];
    writeJSON(window.localStorage, SESSION_KEY, rec);
    return appOpen;
  }
  function beat() {
    var rec = readJSON(window.localStorage, SESSION_KEY) || {};
    rec.lastSeen = Date.now();
    writeJSON(window.localStorage, SESSION_KEY, rec);
  }

  // 7: the SDK tracks "Default: App Open" on every init. When this boot is not an app open, drop its
  // trigger request (no "on app open" campaign) and its analytics event, so both match the native SDKs.
  function jsonResponse(value) {
    return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  function filterAppOpen() {
    if (state.isAppOpen || typeof window.fetch !== 'function' || typeof window.Response !== 'function') return;
    var original = window.fetch;
    window.fetch = function (input, init) {
      var args = Array.prototype.slice.call(arguments);
      try {
        var body = init && init.body;
        if (typeof body === 'string' && body.indexOf(APP_OPEN) !== -1) {
          var url = typeof input === 'string' ? input : (input && input.url) || '';
          var json = JSON.parse(body);
          if (/\/sdk\/campaign\/trigger(?:[?#]|$)/.test(url) && json && json.triggerEvent === APP_OPEN) {
            return Promise.resolve(jsonResponse({ data: {} }));
          }
          if (/\/sdk\/event\/track(?:[?#]|$)/.test(url) && json && Array.isArray(json.eventsData)) {
            var kept = json.eventsData.filter(function (e) { return !(e && e.eventName === APP_OPEN); });
            if (kept.length !== json.eventsData.length) {
              if (!kept.length) return Promise.resolve(jsonResponse({ data: {} }));
              json.eventsData = kept;
              var copy = {};
              for (var k in init) if (Object.prototype.hasOwnProperty.call(init, k)) copy[k] = init[k];
              copy.body = JSON.stringify(json);
              args[1] = copy;
            }
          }
        }
      } catch (e) { /* not ours: pass through */ }
      return original.apply(this, args);
    };
  }

  // 7 (optional, kept from 1.x): a custom event on the same app-open decision.
  function trackAppSession() {
    var name = state.options.appOpenEvent;
    if (name && state.isAppOpen) pl('track', name, { shell: shell });
    document.addEventListener('turbo:load', beat);
    document.addEventListener('visibilitychange', beat);
    window.addEventListener('pagehide', beat);
    setInterval(function () { if (document.visibilityState === 'visible') beat(); }, 60 * 1000);
  }

  // 9: record the raw steps of each campaign the SDK queues, so another WebView can take it over.
  function captureQueuedSteps(store) {
    if (store.__plotlineHotwire || typeof store.queueNewFlow !== 'function') return;
    var original = store.queueNewFlow;
    store.queueNewFlow = function (flowId, stepsData, journeyId) {
      try {
        if (typeof flowId === 'string' && Array.isArray(stepsData)) {
          state.raw[flowId] = { steps: stepsData, journeyId: typeof journeyId === 'string' ? journeyId : '' };
        }
      } catch (e) { /* noop */ }
      return original.apply(this, arguments);
    };
    store.__plotlineHotwire = true;
  }
  function stepIsForPage(s, rawStep, pageId) {
    if (!rawStep || typeof rawStep !== 'object') return false;
    var filter = rawStep.pageUrlFilter;
    if (filter && filter.type && typeof s.pageUrlFilterCheck === 'function') {
      return !!s.pageUrlFilterCheck(filter, pageId.substring(2));
    }
    return Array.isArray(rawStep.triggerEvents) && rawStep.triggerEvents.indexOf(pageId) !== -1;
  }

  // 9: one record in localStorage for a campaign whose next step waits for a page. The WebView that
  // queued it publishes it; a WebView showing that page takes it over (it becomes the owner) and the
  // previous owner drops its copy, so it is not stuck waiting for a page that opens elsewhere.
  function syncWalkthrough() {
    if (!isNative || state.options.continueWalkthroughs === false) return;
    try {
      var s = sdk();
      if (!s || typeof s.getIsInitialised !== 'function' || !s.getIsInitialised()) return;
      var store = flowStore(s);
      if (!store) return;
      captureQueuedSteps(store);
      var rec = readJSON(window.localStorage, WALK_KEY);
      if (rec && !(Date.now() - Number(rec.at || 0) < sessionTimeoutMs())) rec = null;
      var showing = !!s.getIsShowingCampaign();
      var pending = store.activeFlowId && store.nextFlowStepIndex < store.stepsOfActiveFlow.length ? store.activeFlowId : '';

      if (pending) {
        var pub = state.published;
        if (pub && pub.flowId === pending && pub.next === store.nextFlowStepIndex) {
          if ((!rec || rec.flowId !== pending || rec.owner !== webviewId) && !showing) {
            store.clearStepsOfActiveFlow(); // continued in another WebView
            store.activeFlowId = '';
            store.activeJourneyId = '';
            state.published = null;
          }
          return;
        }
        var raw = state.raw[pending];
        if (!raw) return;
        writeJSON(window.localStorage, WALK_KEY, {
          flowId: pending, journeyId: store.activeJourneyId || raw.journeyId || '', steps: raw.steps,
          next: store.nextFlowStepIndex, owner: webviewId, at: Date.now(),
        });
        state.published = { flowId: pending, next: store.nextFlowStepIndex };
        return;
      }
      if (state.published) {
        if (rec && rec.owner === webviewId && rec.flowId === state.published.flowId) {
          try { window.localStorage.removeItem(WALK_KEY); } catch (e) { /* noop */ }
          rec = null;
        }
        state.published = null;
      }
      if (!rec || rec.owner === webviewId || showing || document.visibilityState !== 'visible') return;
      if (typeof s.getShouldDisablePlotline === 'function' && s.getShouldDisablePlotline()) return;
      if (!Array.isArray(rec.steps) || !stepIsForPage(s, rec.steps[rec.next], currentPageId())) return;
      store.queueNewFlow(rec.flowId, rec.steps, rec.journeyId || '');
      if (store.activeFlowId !== rec.flowId || store.stepsOfActiveFlow.length <= rec.next) return;
      store.nextFlowStepIndex = rec.next; // the SDK's element search shows it when the element is there
      rec.owner = webviewId;
      rec.at = Date.now();
      writeJSON(window.localStorage, WALK_KEY, rec);
      state.published = { flowId: rec.flowId, next: rec.next };
    } catch (e) { warn('walkthrough sync failed', e); }
  }

  // 10: a hidden WebView is a screen that was left (a dismissed iOS modal keeps its WebView alive and
  // hidden). Close what it shows and stop its element search; when it is shown again, the page on screen
  // is a new page view, as a native screen that appears again.
  function onVisibilityChange() {
    if (document.visibilityState === 'hidden') {
      flushEvents();
      if (!isNative) return;
      try {
        leavePage();
        state.leftPage = true;
        var search = sdk() && sdk()._elementSearchTask;
        if (search && typeof search.setShouldStop === 'function') search.setShouldStop(true);
      } catch (e) { warn('hidden handling failed', e); }
      return;
    }
    if (isNative && state.leftPage && !state.visitLoading) onRendered(); // also syncs the walkthrough
    else syncWalkthrough();
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
    state.isAppOpen = decideAppOpen();
    if (isNative && options.dedupeAppOpen !== false) filterAppOpen();

    window.addEventListener('turbo:before-visit', onBeforeVisit);
    document.addEventListener('turbo:visit', onVisit);
    document.addEventListener('turbo:before-render', onBeforeRender);
    document.addEventListener('turbo:before-morph-element', onBeforeMorphElement);
    document.addEventListener('turbo:render', onRendered);
    document.addEventListener('turbo:load', onRendered);
    // A frame is part of the page on screen; while a page visit loads, that visit's render decides.
    document.addEventListener('turbo:frame-render', function () { if (!state.visitLoading) onRendered(); });
    if (options.userIdMeta) document.addEventListener('turbo:load', syncUserFromMeta);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', flushEvents);
    routeWindowOpen();
    if (isNative) {
      setInterval(syncWalkthrough, 400);
      // Record a campaign's steps from its first trigger on: wrap the store as soon as the SDK loads.
      var tries = 0;
      var early = setInterval(function () {
        var store = flowStore(sdk());
        if (store) captureQueuedSteps(store);
        if (store || ++tries > 400) clearInterval(early);
      }, 25);
    }

    pl('overrideInternals', 'get-current-page-id', currentPageId);
    pl('init', options.apiKey, options.userId, options.endpoint);
    if (options.identifyShell !== false) pl('identify', { hotwire_shell: shell });
    trackAppSession();
  }

  function debug() {
    var s = sdk(), store = flowStore(s);
    return {
      version: VERSION, shell: shell, webviewId: webviewId, isAppOpen: state.isAppOpen,
      renderedPath: state.renderedPath, sdkHandlesTurbo: sdkHandlesTurbo(),
      activeFlowId: store ? store.activeFlowId : null,
      nextStep: store ? store.nextFlowStepIndex + '/' + store.stepsOfActiveFlow.length : null,
      walkthrough: (function () { var r = readJSON(window.localStorage, WALK_KEY); return r && { flowId: r.flowId, next: r.next, owner: r.owner === webviewId ? 'this WebView' : r.owner }; })(),
    };
  }

  window.PlotlineHotwire = { start: start, shell: shell, flushEvents: flushEvents, version: VERSION, debug: debug };
})();
