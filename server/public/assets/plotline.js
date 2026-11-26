(function () {
  const config = window.PLOTLINE_CONFIG || {};
  if (!config.apiKey) return;

  const routeMap = {
    home: "/",
    detail: "/detail",
    modal: "/modal",
  };

  let lastTrackedURL = null;

  function platform() {
    if (config.platform === "ios" || config.platform === "android") return config.platform;
    if (document.body.classList.contains("platform-ios")) return "ios";
    if (document.body.classList.contains("platform-android")) return "android";
    return "web";
  }

  function uiMode() {
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }

  function identify() {
    plotline("identify", {
      plan: "hotwire_demo",
      platform: platform(),
      uiMode: uiMode(),
    });
  }

  function track(eventName, properties) {
    window.__plotlineTracks.push({
      eventName,
      properties,
      at: Date.now(),
    });
    plotline("track", eventName, properties);
  }

  function trackPageView() {
    const url = window.location.href;
    if (url === lastTrackedURL) return;
    lastTrackedURL = url;

    identify();
    track("page_view", {
      path: window.location.pathname,
      title: document.title,
      platform: platform(),
      native: platform() !== "web",
    });
  }

  function parsePayload(payload) {
    if (!payload) return {};
    if (typeof payload === "string") {
      try {
        return JSON.parse(payload);
      } catch {
        return { url: payload };
      }
    }
    return typeof payload === "object" ? payload : {};
  }

  function redirectFor(payload) {
    const data = parsePayload(payload);
    window.__plotlineRedirects = window.__plotlineRedirects || [];
    window.__plotlineRedirects.push(data);

    const key = data.route || data.screen || data.page || data.destination;
    const target = routeMap[key] || data.path || data.url || data.deeplink;
    if (!target) return;

    const url = new URL(target, window.location.origin);
    if (url.origin === window.location.origin) {
      if (window.Turbo) {
        window.Turbo.visit(url.href);
      } else {
        window.location.assign(url.href);
      }
      return;
    }

    window.location.assign(target);
  }

  window.__plotlineEvents = window.__plotlineEvents || [];
  window.__plotlineTracks = window.__plotlineTracks || [];

  // Init once per WebView, plus the Turbo / Hotwire Native lifecycle handling (plotline-hotwire.js).
  // "Default: App Open" campaigns need no change: the adapter makes it fire once per app session across
  // all WebViews (iOS modals and pull-to-refresh boot a WebView, not the app).
  PlotlineHotwire.start({
    apiKey: config.apiKey,
    userId: config.userId,
  });
  plotline("setLocale", "en");
  identify();

  plotline("setRedirectListener", redirectFor);

  plotline("setPlotlineEventsListener", function (eventName, properties) {
    window.__plotlineEvents.push({
      eventName,
      properties,
      at: Date.now(),
    });
    console.info("[plotline]", eventName, properties);
  });

  document.addEventListener("turbo:load", trackPageView);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", trackPageView);
  } else {
    trackPageView();
  }

  if (window.matchMedia) {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", identify);
  }
})();
