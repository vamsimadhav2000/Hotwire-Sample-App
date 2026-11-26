const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");

const plotlineApiKey = process.env.PLOTLINE_API_KEY || "ZjRiODc0MDYtMGM4Yi00OThlLWJjYzktZTMyYzdjZTVhZGNl";

const plotlineUserIds = {
  default: process.env.PLOTLINE_USER_ID || "vamsi_hotwire",
  ios: process.env.PLOTLINE_USER_ID_IOS || "vamsi_hotwire_ios",
  android: process.env.PLOTLINE_USER_ID_ANDROID || "vamsi_hotwire_android",
};

function plotlineConfigFor(platform) {
  return {
    apiKey: plotlineApiKey,
    userId: plotlineUserIds[platform] || plotlineUserIds.default,
    platform,
  };
}

const assets = new Map([
  ["/assets/app.css", { file: "assets/app.css", type: "text/css; charset=utf-8" }],
  ["/assets/turbo.js", { file: "assets/turbo.js", type: "text/javascript; charset=utf-8" }],
  ["/assets/plotline.js", { file: "assets/plotline.js", type: "text/javascript; charset=utf-8" }],
  ["/assets/plotline-hotwire.js", { file: "assets/plotline-hotwire.js", type: "text/javascript; charset=utf-8" }],
]);

const iosPathConfiguration = {
  settings: {},
  rules: [
    {
      patterns: [".*"],
      properties: {
        context: "default",
        pull_to_refresh_enabled: true,
      },
    },
    {
      patterns: ["/modal$"],
      properties: {
        context: "modal",
        pull_to_refresh_enabled: false,
      },
    },
    {
      patterns: ["^/$"],
      properties: {
        presentation: "clear_all",
      },
    },
  ],
};

const androidPathConfiguration = {
  settings: {},
  rules: [
    {
      patterns: [".*"],
      properties: {
        context: "default",
        uri: "hotwire://fragment/web",
        pull_to_refresh_enabled: true,
      },
    },
    {
      patterns: ["/modal$"],
      properties: {
        context: "modal",
        uri: "hotwire://fragment/web/modal/sheet",
        pull_to_refresh_enabled: false,
      },
    },
    {
      patterns: ["^$", "^/$"],
      properties: {
        presentation: "clear_all",
      },
    },
  ],
};

function detectPlatform(request) {
  const userAgent = String(request.headers["user-agent"] || "");
  if (/Hotwire Native iOS|Turbo Native iOS/.test(userAgent)) return "ios";
  if (/Hotwire Native Android|Turbo Native Android/.test(userAgent)) return "android";
  return "web";
}

function platformLabel(platform) {
  if (platform === "ios") return "Hotwire Native iOS";
  if (platform === "android") return "Hotwire Native Android";
  return "Web preview";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function serializeForScript(value) {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

function layout({ title, platform, body }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#f2efe7">
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="/assets/app.css">
  <script src="/assets/turbo.js" defer></script>
  <script>
    (function(pl,ot,line) {
      if (window.plotline) return;
      window._plotQueue = window._plotQueue || [];
      window.plotline = function() {window._plotQueue.push(arguments)}
      var a = document.createElement('script');
      a.async = 1;
      a.src = 'https://sdk.plotline.so/plotline-engage@latest/sdk.min.js';
      var b = document.getElementsByTagName('script')[0];
      b.parentNode.insertBefore(a, b);
    })()
  </script>
  <script>
    window.PLOTLINE_CONFIG = ${serializeForScript(plotlineConfigFor(platform))};
  </script>
  <script src="/assets/plotline-hotwire.js"></script>
  <script src="/assets/plotline.js" defer></script>
</head>
<body id="app-body" class="platform-${platform}">
  ${body}
</body>
</html>`;
}

function chrome(platform) {
  return `<header class="chrome" id="app-header">
    <span class="brand" id="app-brand">Hotwire Native</span>
    <span class="platform" id="platform-badge">${escapeHtml(platformLabel(platform))}</span>
  </header>`;
}

function homePage(platform) {
  return layout({
    title: "Home",
    platform,
    body: `<div class="shell" id="app-shell">
      ${chrome(platform)}
      <main class="page" id="home-screen">
        <p class="eyebrow" id="home-screen-label">Screen 1 of 3</p>
        <h1 id="home-title">Three screens.<br>One native shell.</h1>
        <p class="lead" id="home-description">This is a tiny Hotwire Native playground. Use it to check push navigation, modal presentation, and the path configuration setup.</p>

        <nav class="tiles" id="home-screen-links" aria-label="Demo screens">
          <a class="tile" id="home-detail-link" href="/detail">
            <span class="tile__index" id="home-detail-link-index">01</span>
            <span class="tile__body" id="home-detail-link-content">
              <strong id="home-detail-link-title">Detail screen</strong>
              <small id="home-detail-link-subtitle">Native push visit</small>
            </span>
            <span class="tile__arrow" id="home-detail-link-arrow" aria-hidden="true">&#8594;</span>
          </a>
          <a class="tile" id="home-modal-link" href="/modal">
            <span class="tile__index" id="home-modal-link-index">02</span>
            <span class="tile__body" id="home-modal-link-content">
              <strong id="home-modal-link-title">Modal screen</strong>
              <small id="home-modal-link-subtitle">Path-config modal</small>
            </span>
            <span class="tile__arrow" id="home-modal-link-arrow" aria-hidden="true">&#8599;</span>
          </a>
        </nav>

        <section class="panel" id="home-checklist">
          <p class="panel__label" id="home-checklist-label">What to check</p>
          <ul class="checks" id="home-checklist-items">
            <li id="home-checklist-native-push">Tap a card and watch the native navigation bar animate.</li>
            <li id="home-checklist-native-back">Use the native back button or swipe to return.</li>
            <li id="home-checklist-modal">Open the modal and dismiss it with the close control.</li>
          </ul>
        </section>

        <div class="plotline-slot" id="plotline-widget" data-plotline-widget="true"></div>
      </main>
    </div>`,
  });
}

function detailPage(platform) {
  return layout({
    title: "Detail",
    platform,
    body: `<div class="shell" id="app-shell">
      ${chrome(platform)}
      <main class="page" id="detail-screen">
        <p class="eyebrow" id="detail-screen-label">Screen 2 of 3</p>
        <h1 id="detail-title">Detail</h1>
        <p class="lead" id="detail-description">This screen was pushed with a normal Turbo visit. The back button is native, and the URL stays in sync with the web content.</p>

        <a class="button" id="detail-open-modal-button" href="/modal">Open the modal</a>

        <a class="quiet" id="detail-back-home-link" href="/">Back to home</a>
      </main>
    </div>`,
  });
}

function modalPage(platform) {
  return layout({
    title: "Modal",
    platform,
    body: `<div class="shell" id="app-shell">
      ${chrome(platform)}
      <main class="page" id="modal-screen">
        <p class="eyebrow" id="modal-screen-label">Screen 3 of 3</p>
        <h1 id="modal-title">Modal</h1>
        <p class="lead" id="modal-description">This screen is presented modally because of a path configuration rule. Close it with the native Done button, a swipe down, or the system back gesture.</p>

        <section class="panel" id="modal-note">
          <p class="panel__label" id="modal-note-label">Good sign</p>
          <p class="panel__copy" id="modal-note-copy">The web page sits inside a native modal without any custom modal code in the app.</p>
        </section>

        <a class="button" id="modal-go-detail-button" href="/detail">Go to detail</a>
      </main>
    </div>`,
  });
}

function send(response, status, type, body, extraHeaders = {}) {
  response.writeHead(status, {
    "Content-Type": type,
    "Content-Length": Buffer.byteLength(body),
    ...extraHeaders,
  });
  response.end(body);
}

function sendHtml(response, html) {
  send(response, 200, "text/html; charset=utf-8", html, {
    "Cache-Control": "no-store",
  });
}

function sendJson(response, value) {
  send(response, 200, "application/json; charset=utf-8", JSON.stringify(value, null, 2), {
    "Cache-Control": "no-store",
  });
}

function sendNotFound(response) {
  sendHtml(
    response,
    layout({
      title: "Not found",
      platform: "web",
      body: `<div class="shell" id="app-shell">
        ${chrome("web")}
        <main class="page" id="not-found-screen">
          <p class="eyebrow" id="not-found-code">404</p>
          <h1 id="not-found-title">Not found</h1>
          <p class="lead" id="not-found-description">That screen is not part of this demo.</p>
          <a class="button" id="not-found-back-home-button" href="/">Back to home</a>
        </main>
      </div>`,
    })
  );
}

function serveAsset(response, asset) {
  fs.readFile(path.join(PUBLIC_DIR, asset.file), (error, data) => {
    if (error) {
      response.writeHead(404).end();
      return;
    }

    response.writeHead(200, {
      "Content-Type": asset.type,
      "Content-Length": data.length,
      "Cache-Control": "no-cache",
    });
    response.end(data);
  });
}

const server = http.createServer((request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" }).end();
    return;
  }

  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  const pathname = url.pathname;
  const platform = detectPlatform(request);

  if (pathname === "/health") {
    sendJson(response, { ok: true });
    return;
  }

  if (pathname === "/configurations/ios_v1.json") {
    sendJson(response, iosPathConfiguration);
    return;
  }

  if (pathname === "/configurations/android_v1.json") {
    sendJson(response, androidPathConfiguration);
    return;
  }

  if (pathname === "/") {
    sendHtml(response, homePage(platform));
    return;
  }

  if (pathname === "/detail") {
    sendHtml(response, detailPage(platform));
    return;
  }

  if (pathname === "/modal") {
    sendHtml(response, modalPage(platform));
    return;
  }

  if (pathname === "/favicon.ico") {
    response.writeHead(204).end();
    return;
  }

  const asset = assets.get(pathname);
  if (asset) {
    serveAsset(response, asset);
    return;
  }

  sendNotFound(response);
});

server.listen(PORT, HOST, () => {
  console.log(`Hotwire Native demo server listening on http://localhost:${PORT}`);
});
