(function () {
  const config = window.PLOTLINE_CONFIG || {};
  if (!config.apiKey) return;

  const adapterEnabled = config.adapter !== false && !!window.PlotlineHotwire;

  const routeMap = {
    home: "/",
    detail: "/detail",
    modal: "/modal",
    features: "/features",
    tooltips: "/tooltips",
    spotlight: "/spotlight",
    sheets: "/sheets",
    "sheets-modal": "/sheets-modal",
    fullpage: "/fullpage",
    floater: "/floater",
    media: "/media",
    widgets: "/widgets",
    surveys: "/surveys",
    clicks: "/clicks",
    triggers: "/triggers",
    exit: "/exit",
    forms: "/forms",
    frames: "/frames",
    streams: "/streams",
    morph: "/morph",
    permanent: "/permanent",
    "permanent-2": "/permanent-2",
    replace: "/replace",
    debug: "/debug",
  };

  let lastTrackedURL = null;
  let activeUserId = config.userId;

  window.__plotlineEvents = window.__plotlineEvents || [];
  window.__plotlineTracks = window.__plotlineTracks || [];

  // ---- Log forwarding ---------------------------------------------------

  function nativeBridge(line) {
    try {
      if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.hwlog) {
        window.webkit.messageHandlers.hwlog.postMessage(line);
      } else if (window.HWLog && typeof window.HWLog.log === "function") {
        window.HWLog.log(line);
      }
    } catch (e) {
      /* no bridge: ignore */
    }
  }

  function sendLog(source, level, msg) {
    const entry = {
      source,
      level,
      msg: String(msg),
      url: window.location.href,
      ts: Date.now(),
    };
    nativeBridge("[" + source + "] " + entry.msg);
    try {
      const body = JSON.stringify(entry);
      if (navigator.sendBeacon) {
        navigator.sendBeacon("/debug/log", new Blob([body], { type: "application/json" }));
      } else if (window.fetch) {
        window
          .fetch("/debug/log", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body,
            keepalive: true,
          })
          .catch(function () {});
      }
    } catch (e) {
      /* never break the app for a log line */
    }
  }

  function stringifyArg(value) {
    if (typeof value === "string") return value;
    try {
      return JSON.stringify(value);
    } catch (e) {
      return String(value);
    }
  }

  ["log", "info", "warn", "error"].forEach(function (level) {
    const original = console[level];
    if (typeof original !== "function") return;
    console[level] = function () {
      original.apply(console, arguments);
      try {
        const text = Array.prototype.map.call(arguments, stringifyArg).join(" ");
        if (/^\[Plotline/i.test(text) || /plotline/i.test(text)) {
          sendLog("console", level, text);
        }
      } catch (e) {
        /* ignore */
      }
    };
  });

  [
    "turbo:visit",
    "turbo:before-render",
    "turbo:render",
    "turbo:load",
    "turbo:before-cache",
    "turbo:frame-load",
    "turbo:before-stream-render",
    "turbo:submit-end",
  ].forEach(function (name) {
    document.addEventListener(name, function () {
      sendLog("turbo", "info", name + " " + window.location.href);
    });
  });

  // Turbo 8.0.23: after a lazy frame's first load, a later src change renders the stale
  // snapshot. Switching the frame to eager after its first load keeps the initial lazy
  // load but lets an in-frame link render /frames/content2 correctly.
  document.addEventListener("turbo:frame-load", function (event) {
    const frame = event.target;
    if (frame && frame.getAttribute && frame.getAttribute("loading") === "lazy") {
      frame.setAttribute("loading", "eager");
    }
  });

  // Same workaround for a click that lands before turbo:frame-load fires: a capture-phase
  // listener runs before Turbo's link interceptor, so the src change is handled as eager.
  document.addEventListener(
    "click",
    function (event) {
      const target = event.target;
      if (!target || !target.closest) return;
      const frame = target.closest("turbo-frame");
      if (frame && frame.getAttribute("loading") === "lazy") {
        frame.setAttribute("loading", "eager");
      }
    },
    true
  );

  window.addEventListener("pagehide", function () {
    sendLog("lifecycle", "info", "pagehide " + window.location.href);
  });
  window.addEventListener("pageshow", function () {
    sendLog("lifecycle", "info", "pageshow " + window.location.href);
  });
  document.addEventListener("visibilitychange", function () {
    sendLog("lifecycle", "info", "visibilitychange " + document.visibilityState);
  });

  // ---- Tracking ---------------------------------------------------------

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

  // App buttons call this through data-pl-track; the log line uses source "app".
  function appTrack(eventName, properties) {
    sendLog(
      "app",
      "info",
      "track " + eventName + (properties ? " " + JSON.stringify(properties) : "")
    );
    track(eventName, properties);
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

  // ---- Debug helpers ----------------------------------------------------

  function cookieValue(name) {
    const match = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
    return match ? decodeURIComponent(match[1]) : "";
  }

  function setCookie(name, value) {
    document.cookie = name + "=" + encodeURIComponent(value) + "; path=/; SameSite=Lax";
  }

  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function setupDebug() {
    if (!document.getElementById("debug-screen")) return;

    const currentConfig = window.PLOTLINE_CONFIG || {};
    setText("debug-user-id", currentConfig.userId || "");

    let version = window.plotline && window.plotline.version ? window.plotline.version : "";
    if (!version) {
      const sources = Array.prototype.map
        .call(document.scripts, function (script) {
          return script.src;
        })
        .filter(function (src) {
          return /plotline-engage|plotline-local/.test(src);
        });
      version = sources.length ? sources[sources.length - 1] : "not loaded";
    }
    setText("debug-sdk-version", version);

    const launch = /PlotlineLaunch\/([A-Za-z0-9._-]+)/.exec(navigator.userAgent || "");
    setText("debug-launch-id", launch ? launch[1] : "none");

    setText(
      "debug-cookies",
      "sdk=" +
        (cookieValue("pl_sdk") || "latest") +
        " \u00b7 adapter=" +
        (cookieValue("pl_adapter") || "1") +
        " \u00b7 user=" +
        (cookieValue("pl_user") || "default")
    );

    if (window.fetch) {
      window
        .fetch("/debug/log", { headers: { accept: "application/json" } })
        .then(function (response) {
          return response.json();
        })
        .then(function (lines) {
          const recent = Array.isArray(lines) ? lines.slice(-20) : [];
          setText("debug-log", recent.length ? recent.join("\n") : "(empty)");
        })
        .catch(function () {
          setText("debug-log", "(log unavailable)");
        });
    }
  }

  // ---- Wiring -----------------------------------------------------------

  document.addEventListener("click", function (event) {
    const target = event.target;
    if (!target || !target.closest) return;

    const trigger = target.closest("[data-pl-track]");
    if (trigger) {
      const name = trigger.getAttribute("data-pl-track");
      if (name) {
        let properties;
        const raw = trigger.getAttribute("data-pl-props");
        if (raw) {
          try {
            properties = JSON.parse(raw);
          } catch (e) {
            properties = undefined;
          }
        }
        appTrack(name, properties);
      }
    }

    const control = target.closest("[data-pl-debug]");
    if (!control) return;
    const action = control.getAttribute("data-pl-debug");
    if (action === "sdk-prod") setCookie("pl_sdk", "prod");
    else if (action === "sdk-latest") setCookie("pl_sdk", "latest");
    else if (action === "sdk-local") setCookie("pl_sdk", "local");
    else if (action === "adapter-on") setCookie("pl_adapter", "1");
    else if (action === "adapter-off") setCookie("pl_adapter", "0");
    else return;
    window.location.reload();
  });

  // Adapter off: keep the same user-switch behavior through the <meta> tag.
  function syncUserFromMeta() {
    if (adapterEnabled) return;
    const meta = document.querySelector('meta[name="plotline-user-id"]');
    if (!meta) return;
    const id = meta.getAttribute("content") || undefined;
    if (id === activeUserId) return;
    activeUserId = id;
    sendLog("app", "info", "user switch " + (id || "anonymous"));
    plotline("init", config.apiKey, id);
    identify();
  }

  // ---- Init -------------------------------------------------------------

  if (adapterEnabled) {
    // plotline-hotwire.js runs the SDK and follows the user id in the <meta> tag.
    window.PlotlineHotwire.start({
      apiKey: config.apiKey,
      userId: config.userId,
      userIdMeta: "plotline-user-id",
    });
  } else {
    plotline("init", config.apiKey, config.userId);
  }
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
  document.addEventListener("turbo:load", setupDebug);
  document.addEventListener("turbo:load", syncUserFromMeta);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", trackPageView);
    document.addEventListener("DOMContentLoaded", setupDebug);
  } else {
    trackPageView();
    setupDebug();
  }

  if (window.matchMedia) {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", identify);
  }
})();
