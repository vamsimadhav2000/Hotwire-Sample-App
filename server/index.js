const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");
const LOG_DIR = path.join(__dirname, "logs");
const LOG_FILE = path.join(LOG_DIR, "e2e.log");

const plotlineApiKey = process.env.PLOTLINE_API_KEY || "ZjRiODc0MDYtMGM4Yi00OThlLWJjYzktZTMyYzdjZTVhZGNl";

const plotlineUserIds = {
  default: process.env.PLOTLINE_USER_ID || "vamsi_hotwire",
  ios: process.env.PLOTLINE_USER_ID_IOS || "vamsi_hotwire_ios",
  android: process.env.PLOTLINE_USER_ID_ANDROID || "vamsi_hotwire_android",
};

const SDK_URLS = {
  prod: "https://sdk.plotline.so/plotline-engage@3.6.8/sdk.min.js",
  latest: "https://sdk.plotline.so/plotline-engage@latest/sdk.min.js",
  local: "/assets/sdk/plotline-local.js",
};

const assets = new Map([
  ["/assets/app.css", { file: "assets/app.css", type: "text/css; charset=utf-8" }],
  ["/assets/turbo.js", { file: "assets/turbo.js", type: "text/javascript; charset=utf-8" }],
  ["/assets/plotline.js", { file: "assets/plotline.js", type: "text/javascript; charset=utf-8" }],
  ["/assets/plotline-hotwire.js", { file: "assets/plotline-hotwire.js", type: "text/javascript; charset=utf-8" }],
  ["/assets/sdk/plotline-local.js", { file: "assets/sdk/plotline-local.js", type: "text/javascript; charset=utf-8" }],
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
      patterns: ["/modal$", "/sheets-modal$"],
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
      patterns: ["/modal$", "/sheets-modal$"],
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

const featurePages = [
  ["tooltips", "Tooltips"],
  ["spotlight", "Spotlight"],
  ["sheets", "Sheets"],
  ["sheets-modal", "Sheet modal"],
  ["fullpage", "Full page"],
  ["floater", "Floater"],
  ["media", "Media"],
  ["widgets", "Widgets"],
  ["surveys", "Surveys"],
  ["clicks", "Click targets"],
  ["triggers", "Triggers"],
  ["exit", "Exit"],
  ["forms", "Forms"],
  ["frames", "Frames"],
  ["streams", "Streams"],
  ["morph", "Morph refresh"],
  ["permanent", "Permanent"],
  ["replace", "Replace visit"],
  ["debug", "Debug"],
];

// A counter that lives for the life of the server process, one per stream append.
let streamCounter = 0;

fs.mkdirSync(LOG_DIR, { recursive: true });

function plotlineConfigFor(platform, userId) {
  return {
    apiKey: plotlineApiKey,
    userId,
    platform,
  };
}

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

function parseCookies(header) {
  const cookies = {};
  String(header || "")
    .split(";")
    .forEach((pair) => {
      const index = pair.indexOf("=");
      if (index === -1) return;
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      if (!name) return;
      cookies[name] = value;
    });
  return cookies;
}

function cookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", "SameSite=Lax"];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  return parts.join("; ");
}

function buildContext(request, url) {
  const cookies = parseCookies(request.headers.cookie);
  const platform = detectPlatform(request);
  const setCookies = [];

  let sdk = cookies.pl_sdk;
  const querySdk = url.searchParams.get("sdk");
  if (querySdk && SDK_URLS[querySdk]) {
    sdk = querySdk;
    setCookies.push(cookie("pl_sdk", querySdk));
  }
  if (!SDK_URLS[sdk]) sdk = "latest";

  let adapter = cookies.pl_adapter;
  const queryAdapter = url.searchParams.get("adapter");
  if (queryAdapter === "0" || queryAdapter === "1") {
    adapter = queryAdapter;
    setCookies.push(cookie("pl_adapter", queryAdapter));
  }
  if (adapter !== "0" && adapter !== "1") adapter = "1";

  let userFromCookie = "";
  if (cookies.pl_user) {
    try {
      userFromCookie = decodeURIComponent(cookies.pl_user);
    } catch {
      userFromCookie = cookies.pl_user;
    }
  }
  const userId =
    userFromCookie && userFromCookie.trim()
      ? userFromCookie
      : plotlineUserIds[platform] || plotlineUserIds.default;

  return {
    platform,
    sdk,
    adapter: adapter === "1",
    adapterValue: adapter,
    userId,
    setCookies,
  };
}

function layout({ title, ctx, body, extraHead = "" }) {
  const { platform, sdk, adapter, userId } = ctx;
  const sdkSrc = SDK_URLS[sdk] || SDK_URLS.latest;
  const config = { ...plotlineConfigFor(platform, userId), sdk, adapter };
  const badge = `sdk: ${sdk} \u00b7 adapter: ${adapter ? "on" : "off"}`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#f2efe7">
  <meta name="plotline-user-id" content="${escapeHtml(userId)}">
  <title>${escapeHtml(title)}</title>
  ${extraHead}
  <link rel="stylesheet" href="/assets/app.css">
  <script src="/assets/turbo.js" defer></script>
  <script>
    (function(pl,ot,line) {
      if (window.plotline) return;
      window._plotQueue = window._plotQueue || [];
      window.plotline = function() {window._plotQueue.push(arguments)}
      var a = document.createElement('script');
      a.async = 1;
      a.src = ${serializeForScript(sdkSrc)};
      var b = document.getElementsByTagName('script')[0];
      b.parentNode.insertBefore(a, b);
    })()
  </script>
  <script>
    window.PLOTLINE_CONFIG = ${serializeForScript(config)};
  </script>
  ${adapter ? '<script src="/assets/plotline-hotwire.js"></script>' : ""}
  <script src="/assets/plotline.js" defer></script>
</head>
<body id="app-body" class="platform-${platform}">
  ${body}
  <footer class="build-badge" id="build-badge">${escapeHtml(badge)}</footer>
</body>
</html>`;
}

function chrome(platform) {
  return `<header class="chrome" id="app-header">
    <span class="brand" id="app-brand">Hotwire Native</span>
    <span class="platform" id="platform-badge">${escapeHtml(platformLabel(platform))}</span>
  </header>`;
}

function shell(ctx, screen, content) {
  return `<div class="shell" id="app-shell">
      ${chrome(ctx.platform)}
      <main class="page" id="${screen}-screen">
        ${content}
      </main>
    </div>`;
}

function simplePage(ctx, { title, screen, label, heading, lead, content, extraHead }) {
  return layout({
    title,
    ctx,
    extraHead,
    body: shell(
      ctx,
      screen,
      `<p class="eyebrow" id="${screen}-screen-label">${escapeHtml(label)}</p>
        <h1 id="${screen}-title">${heading}</h1>
        <p class="lead" id="${screen}-description">${escapeHtml(lead)}</p>
        ${content}`
    ),
  });
}

function homePage(ctx) {
  return layout({
    title: "Home",
    ctx,
    body: `<div class="shell" id="app-shell">
      ${chrome(ctx.platform)}
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

        <a class="nav-link" id="home-features-link" href="/features">All test pages</a>

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

function detailPage(ctx) {
  return layout({
    title: "Detail",
    ctx,
    body: `<div class="shell" id="app-shell">
      ${chrome(ctx.platform)}
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

function modalPage(ctx) {
  return layout({
    title: "Modal",
    ctx,
    body: `<div class="shell" id="app-shell">
      ${chrome(ctx.platform)}
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

function featuresPage(ctx) {
  const links = featurePages
    .map(
      ([page, label]) =>
        `<a class="nav-link" id="nav-${page}" href="/${page}">${escapeHtml(label)}</a>`
    )
    .join("\n        ");
  return simplePage(ctx, {
    title: "Test pages",
    screen: "features",
    label: "E2E test bed",
    heading: "All test pages",
    lead: "Every Plotline campaign surface, click target and Hotwire lifecycle case has its own page.",
    content: `<nav class="nav-list" id="features-links" aria-label="Test pages">
        ${links}
      </nav>`,
  });
}

function tooltipsPage(ctx) {
  return simplePage(ctx, {
    title: "Tooltips",
    screen: "tooltips",
    label: "Tooltips",
    heading: "Tooltips",
    lead: "Tooltip targets on the first screen, one far down the page, and links to leave.",
    content: `<div class="stack" id="tooltip-first-screen">
        <button class="button" id="tt-a">Tooltip A</button>
        <button class="button" id="tt-b">Tooltip B</button>
        <button class="button" id="tt-c">Tooltip C</button>
      </div>
      <div class="spacer" aria-hidden="true"></div>
      <button class="button" id="tt-far">Far tooltip</button>
      <a class="button" id="tt-next" href="/detail">Go to detail</a>
      <a class="quiet" id="tt-modal" href="/modal">Open modal</a>`,
  });
}

function spotlightPage(ctx) {
  return simplePage(ctx, {
    title: "Spotlight",
    screen: "spotlight",
    label: "Spotlight",
    heading: "Spotlight",
    lead: "A card, a button and a link away for spotlight targeting.",
    content: `<div class="panel" id="spot-card">
        <p class="panel__label">Spotlight card</p>
        <p class="panel__copy">This card is the spotlight anchor.</p>
      </div>
      <button class="button" id="spot-btn">Spotlight button</button>
      <a class="quiet" id="spot-leave" href="/detail">Leave to detail</a>`,
  });
}

function sheetsPage(ctx) {
  return simplePage(ctx, {
    title: "Sheets",
    screen: "sheets",
    label: "Sheets",
    heading: "Sheets",
    lead: "A trigger, a text field that resizes the WebView, and a route into the sheet modal.",
    content: `<button class="button" id="sheet-trigger" data-pl-track="HW Sheet Trigger">Sheet trigger</button>
      <input class="field" id="sheet-input" type="text" placeholder="Type to open the keyboard">
      <a class="quiet" id="sheet-leave" href="/detail">Leave to detail</a>
      <a class="button" id="sheet-modal-link" href="/sheets-modal">Open sheet modal</a>`,
  });
}

function sheetsModalPage(ctx) {
  return simplePage(ctx, {
    title: "Sheet modal",
    screen: "sheets-modal",
    label: "Sheet modal",
    heading: "Sheet modal",
    lead: "Opened as a native modal by the /sheets-modal path rule.",
    content: `<input class="field" id="sheets-modal-input" type="text" placeholder="Sheet modal input">
      <button class="button" id="sheets-modal-trigger" data-pl-track="HW Sheet Modal Trigger">Sheet modal trigger</button>`,
  });
}

function fullpagePage(ctx) {
  return simplePage(ctx, {
    title: "Full page",
    screen: "fullpage",
    label: "Full page",
    heading: "Full page",
    lead: "A full page trigger and a link away.",
    content: `<button class="button" id="fullpage-trigger" data-pl-track="HW Fullpage Trigger">Fullpage trigger</button>
      <a class="quiet" id="fullpage-leave" href="/detail">Leave to detail</a>`,
  });
}

function floaterPage(ctx) {
  const paragraph =
    "This plain page is intentionally long, more than three screens of text, so a floater campaign can stay visible while the reader scrolls. ";
  const body = Array.from({ length: 14 }, (_, i) => `<p>${paragraph}Paragraph ${i + 1}.</p>`).join("\n        ");
  return simplePage(ctx, {
    title: "Floater",
    screen: "floater",
    label: "Floater",
    heading: "Floater",
    lead: "A long page so a floater can be tested while scrolling.",
    content: `<div id="floater-content" class="long-copy">
        ${body}
      </div>
      <a class="quiet" id="floater-leave" href="/detail">Leave to detail</a>`,
  });
}

function mediaPage(ctx) {
  return simplePage(ctx, {
    title: "Media",
    screen: "media",
    label: "Media",
    heading: "Media",
    lead: "Picture-in-picture and media triggers, plus a link away.",
    content: `<button class="button" id="pip-trigger" data-pl-track="HW PIP Trigger">PIP trigger</button>
      <button class="button" id="media-trigger" data-pl-track="HW Media Trigger">Media trigger</button>
      <a class="quiet" id="media-leave" href="/detail">Leave to detail</a>`,
  });
}

function widgetsPage(ctx) {
  const slots = [
    ["hw-widget-default", "Default widget"],
    ["hw-widget-stories", "Stories widget"],
    ["hw-widget-swipe", "Swipe widget"],
    ["hw-widget-group-1", "Group 1"],
    ["hw-widget-group-2", "Group 2"],
    ["hw-widget-carousel", "Carousel widget"],
  ]
    .map(
      ([id, label]) => `<p class="slot-label">${escapeHtml(label)}</p>
      <div class="plotline-slot" id="${id}" data-plotline-widget="true"></div>`
    )
    .join("\n      ");
  return simplePage(ctx, {
    title: "Widgets",
    screen: "widgets",
    label: "Widgets",
    heading: "Widgets",
    lead: "One slot per widget type, each preceded by a label.",
    content: `${slots}
      <a class="quiet" id="widgets-leave" href="/detail">Leave to detail</a>`,
  });
}

function surveysPage(ctx) {
  return simplePage(ctx, {
    title: "Surveys",
    screen: "surveys",
    label: "Surveys",
    heading: "Surveys",
    lead: "A survey trigger and a link away.",
    content: `<button class="button" id="survey-trigger" data-pl-track="HW Survey Trigger">Survey trigger</button>
      <a class="quiet" id="survey-leave" href="/detail">Leave to detail</a>`,
  });
}

function clicksPage(ctx) {
  return simplePage(ctx, {
    title: "Click targets",
    screen: "clicks",
    label: "Click targets",
    heading: "Click targets",
    lead: "A click id, a click class with two elements, and an exact text target.",
    content: `<button class="button" id="click-id">Element id target</button>
      <div class="stack" id="click-classes">
        <button class="button click-class" id="click-class-1">Class target 1</button>
        <button class="button click-class" id="click-class-2">Class target 2</button>
      </div>
      <button class="button" id="click-text">Click Text Trigger</button>
      <a class="quiet" id="click-leave" href="/detail">Leave to detail</a>`,
  });
}

function triggersPage(ctx) {
  return simplePage(ctx, {
    title: "Triggers",
    screen: "triggers",
    label: "Triggers",
    heading: "Triggers",
    lead: "Delay, composite, priority and property triggers, plus a link to leave while a delay is pending.",
    content: `<div class="stack" id="trigger-buttons">
        <button class="button" id="trg-delay" data-pl-track="HW Delay Trigger">Delay trigger</button>
        <button class="button" id="trg-a" data-pl-track="HW Composite A">Composite A</button>
        <button class="button" id="trg-b" data-pl-track="HW Composite B">Composite B</button>
        <button class="button" id="trg-priority" data-pl-track="HW Priority Trigger">Priority trigger</button>
        <button class="button" id="trg-event-props" data-pl-track="HW Props Trigger" data-pl-props='{"amount":499,"plan":"gold"}'>Props trigger</button>
      </div>
      <a class="quiet" id="trg-leave" href="/detail">Leave to detail</a>`,
  });
}

function exitPage(ctx) {
  return simplePage(ctx, {
    title: "Exit",
    screen: "exit",
    label: "Exit",
    heading: "Exit",
    lead: "Used for page-exit triggers with links to home and detail.",
    content: `<a class="button" id="exit-home" href="/">Go home</a>
      <a class="button" id="exit-detail" href="/detail">Go to detail</a>`,
  });
}

function formsPage(ctx, { saved = false, error = "" } = {}) {
  return simplePage(ctx, {
    title: "Forms",
    screen: "forms",
    label: "Forms",
    heading: "Forms",
    lead: "Three Turbo form submissions: same page, error page and another page.",
    content: `<form class="panel" id="form-same" action="/forms/same" method="post">
        <p class="panel__label">Form A</p>
        <button class="button" type="submit">Save on this page</button>
      </form>
      ${saved ? '<p class="note" id="form-saved-msg">Saved. The query string changed.</p>' : ""}
      <form class="panel" id="form-error" action="/forms/error" method="post">
        <p class="panel__label">Form B</p>
        <button class="button" type="submit">Submit and get a 422</button>
        <p class="form-error" id="form-error-msg">${escapeHtml(error)}</p>
      </form>
      <form class="panel" id="form-other" action="/forms/other" method="post">
        <p class="panel__label">Form C</p>
        <button class="button" type="submit">Submit and go to detail</button>
      </form>`,
  });
}

function framesPage(ctx) {
  return simplePage(ctx, {
    title: "Frames",
    screen: "frames",
    label: "Frames",
    heading: "Frames",
    lead: "A lazy Turbo Frame below the first screen, with a widget slot and a frame-local link.",
    content: `<div class="spacer" aria-hidden="true"></div>
      <turbo-frame id="hw-frame" src="/frames/content" loading="lazy"></turbo-frame>`,
  });
}

function framesContentOne() {
  return `<turbo-frame id="hw-frame">
    <div class="panel">
      <p class="panel__label">Frame content</p>
      <div class="plotline-slot" id="hw-widget-frame" data-plotline-widget="true"></div>
      <button class="button" id="frame-btn" data-pl-track="HW Frame Trigger">Frame trigger</button>
      <a class="quiet" id="frame-next" href="/frames/content2" data-turbo-frame="hw-frame">Next frame content</a>
    </div>
  </turbo-frame>`;
}

function framesContentTwo() {
  return `<turbo-frame id="hw-frame">
    <div class="panel" id="frame-content-2">
      <p class="panel__label">Frame content 2</p>
      <div class="plotline-slot" id="hw-widget-frame-2" data-plotline-widget="true"></div>
    </div>
  </turbo-frame>`;
}

function streamsPage(ctx) {
  return simplePage(ctx, {
    title: "Streams",
    screen: "streams",
    label: "Streams",
    heading: "Streams",
    lead: "A Turbo Stream append, one new widget slot and targets per click.",
    content: `<form action="/streams/add" method="post">
        <button class="button" id="stream-add" type="submit">Add stream block</button>
      </form>
      <div class="stack" id="stream-target"></div>`,
  });
}

function streamBlock(n) {
  return `<div class="stream-block" id="stream-block-${n}">
      <p class="slot-label">Stream widget ${n}</p>
      <div class="plotline-slot" id="hw-widget-stream-${n}" data-plotline-widget="true"></div>
      <button class="button" id="stream-btn-${n}" data-pl-track="HW Stream Trigger">Stream trigger ${n}</button>
      <button class="link-target" id="stream-target-${n}">Tooltip target ${n}</button>
    </div>`;
}

function morphPage(ctx) {
  return simplePage(ctx, {
    title: "Morph",
    screen: "morph",
    label: "Morph refresh",
    heading: "Morph refresh",
    lead: "Refresh the same URL with Turbo 8 morphing and preserved scroll.",
    extraHead: `<meta name="turbo-refresh-method" content="morph">
  <meta name="turbo-refresh-scroll" content="preserve">`,
    content: `<div class="plotline-slot" id="hw-widget-morph" data-plotline-widget="true"></div>
      <p class="note" id="morph-target">Morph target</p>
      <form action="/morph/refresh" method="post">
        <button class="button" id="morph-refresh" type="submit">Refresh with morph</button>
      </form>`,
  });
}

function permanentBox() {
  return `<div class="panel" id="perm-box" data-turbo-permanent>
        <p class="panel__label">Permanent element</p>
        <div class="plotline-slot" id="hw-widget-perm" data-plotline-widget="true"></div>
      </div>`;
}

function permanentPage(ctx) {
  return simplePage(ctx, {
    title: "Permanent",
    screen: "permanent",
    label: "Permanent",
    heading: "Permanent",
    lead: "A data-turbo-permanent box that survives a visit to the next page.",
    content: `${permanentBox()}
      <a class="button" id="perm-next" href="/permanent-2">Go to permanent 2</a>`,
  });
}

function permanentTwoPage(ctx) {
  return simplePage(ctx, {
    title: "Permanent 2",
    screen: "permanent-2",
    label: "Permanent 2",
    heading: "Permanent 2",
    lead: "The same permanent box as the previous page, so Turbo keeps the original one.",
    content: `${permanentBox()}
      <a class="quiet" id="perm-back" href="/permanent">Back to permanent</a>`,
  });
}

function replacePage(ctx) {
  return simplePage(ctx, {
    title: "Replace",
    screen: "replace",
    label: "Replace visit",
    heading: "Replace visit",
    lead: "One link with data-turbo-action=replace and one normal link to the same place.",
    content: `<a class="button" id="replace-link" href="/detail" data-turbo-action="replace">Replace visit to detail</a>
      <a class="button" id="replace-normal" href="/detail">Normal visit to detail</a>`,
  });
}

function debugPage(ctx) {
  return simplePage(ctx, {
    title: "Debug",
    screen: "debug",
    label: "Debug",
    heading: "Debug",
    lead: "Runtime state for the Web SDK, the adapter and the log sink.",
    content: `<section class="panel" id="debug-state">
        <p><span class="panel__label">User</span> <span id="debug-user-id">${escapeHtml(ctx.userId)}</span></p>
        <p><span class="panel__label">SDK</span> <span id="debug-sdk-version"></span></p>
        <p><span class="panel__label">Launch</span> <span id="debug-launch-id"></span></p>
        <p><span class="panel__label">Cookies</span> <span id="debug-cookies"></span></p>
      </section>
      <form class="panel" action="/login" method="post" id="debug-login-form">
        <input class="field" id="debug-user" name="userId" type="text" placeholder="userId">
        <button class="button" id="debug-login" type="submit">Login</button>
      </form>
      <form class="panel" action="/logout" method="post" id="debug-logout-form">
        <button class="button" id="debug-logout" type="submit">Logout</button>
      </form>
      <div class="stack" id="debug-actions">
        <button class="button" id="debug-event" type="button" data-pl-track="HW Debug Event">Track HW Debug Event</button>
        <button class="button" id="debug-sdk-prod" type="button" data-pl-debug="sdk-prod">SDK: prod</button>
        <button class="button" id="debug-sdk-latest" type="button" data-pl-debug="sdk-latest">SDK: latest</button>
        <button class="button" id="debug-sdk-local" type="button" data-pl-debug="sdk-local">SDK: local</button>
        <button class="button" id="debug-adapter-on" type="button" data-pl-debug="adapter-on">Adapter: on</button>
        <button class="button" id="debug-adapter-off" type="button" data-pl-debug="adapter-off">Adapter: off</button>
      </div>
      <pre class="debug-log" id="debug-log">Loading log...</pre>`,
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

function sendHtml(response, html, status = 200, setCookies = []) {
  const headers = { "Cache-Control": "no-store" };
  if (setCookies.length) headers["Set-Cookie"] = setCookies;
  send(response, status, "text/html; charset=utf-8", html, headers);
}

function sendJson(response, value) {
  send(response, 200, "application/json; charset=utf-8", JSON.stringify(value, null, 2), {
    "Cache-Control": "no-store",
  });
}

function sendTurboStream(response, stream) {
  send(response, 200, "text/vnd.turbo-stream.html; charset=utf-8", stream, {
    "Cache-Control": "no-store",
  });
}

function redirect(response, location, setCookies = []) {
  const headers = { Location: location };
  if (setCookies.length) headers["Set-Cookie"] = setCookies;
  response.writeHead(303, headers).end();
}

function sendNotFound(response, ctx) {
  sendHtml(
    response,
    layout({
      title: "Not found",
      ctx: ctx || { platform: "web", sdk: "latest", adapter: true, userId: plotlineUserIds.default },
      body: `<div class="shell" id="app-shell">
        ${chrome((ctx && ctx.platform) || "web")}
        <main class="page" id="not-found-screen">
          <p class="eyebrow" id="not-found-code">404</p>
          <h1 id="not-found-title">Not found</h1>
          <p class="lead" id="not-found-description">That screen is not part of this demo.</p>
          <a class="button" id="not-found-back-home-button" href="/">Back to home</a>
        </main>
      </div>`,
    }),
    404,
    (ctx && ctx.setCookies) || []
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

function readBody(request) {
  return new Promise((resolve, reject) => {
    let data = "";
    request.on("data", (chunk) => {
      data += chunk;
      if (data.length > 2 * 1024 * 1024) {
        request.destroy();
        reject(new Error("Body too large"));
      }
    });
    request.on("end", () => resolve(data));
    request.on("error", reject);
  });
}

function parseForm(body) {
  const out = {};
  String(body || "")
    .split("&")
    .forEach((pair) => {
      if (!pair) return;
      const index = pair.indexOf("=");
      const rawKey = index === -1 ? pair : pair.slice(0, index);
      const rawValue = index === -1 ? "" : pair.slice(index + 1);
      try {
        out[decodeURIComponent(rawKey.replace(/\+/g, " "))] = decodeURIComponent(
          rawValue.replace(/\+/g, " ")
        );
      } catch {
        out[rawKey] = rawValue;
      }
    });
  return out;
}

function appendLog(entry) {
  const line = JSON.stringify(entry);
  fs.appendFile(LOG_FILE, line + "\n", () => {});
  console.log("PlotlineE2E", line);
}

function readLogs(limit) {
  try {
    return fs
      .readFileSync(LOG_FILE, "utf8")
      .split("\n")
      .filter((line) => line.length > 0)
      .slice(-(limit || 500));
  } catch {
    return [];
  }
}

async function handle(request, response) {
  const method = request.method || "GET";
  if (method !== "GET" && method !== "HEAD" && method !== "POST") {
    response.writeHead(405, { Allow: "GET, HEAD, POST" }).end();
    return;
  }

  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  const pathname = url.pathname;
  const ctx = buildContext(request, url);

  if (pathname === "/favicon.ico") {
    response.writeHead(204).end();
    return;
  }

  if (method === "POST") {
    if (pathname === "/login") {
      const form = parseForm(await readBody(request));
      const userId = String(form.userId || "").trim();
      redirect(response, "/", userId ? [cookie("pl_user", userId)] : []);
      return;
    }

    if (pathname === "/logout") {
      redirect(response, "/", [cookie("pl_user", "", { maxAge: 0 })]);
      return;
    }

    if (pathname === "/forms/same") {
      redirect(response, "/forms?saved=1", ctx.setCookies);
      return;
    }

    if (pathname === "/forms/error") {
      const html = formsPage(ctx, { error: "This is the 422 form error message." });
      sendHtml(response, html, 422, ctx.setCookies);
      return;
    }

    if (pathname === "/forms/other") {
      redirect(response, "/detail", ctx.setCookies);
      return;
    }

    if (pathname === "/streams/add") {
      await readBody(request);
      streamCounter += 1;
      const stream = `<turbo-stream action="append" target="stream-target"><template>${streamBlock(
        streamCounter
      )}</template></turbo-stream>`;
      sendTurboStream(response, stream);
      return;
    }

    if (pathname === "/morph/refresh") {
      await readBody(request);
      redirect(response, "/morph", ctx.setCookies);
      return;
    }

    if (pathname === "/debug/log") {
      const body = await readBody(request);
      let entry;
      try {
        entry = JSON.parse(body);
      } catch {
        entry = { source: "unknown", level: "info", msg: body, url: "", ts: Date.now() };
      }
      if (!entry || typeof entry !== "object") entry = { msg: String(entry) };
      entry.receivedAt = Date.now();
      appendLog(entry);
      sendJson(response, { ok: true });
      return;
    }

    if (pathname === "/debug/log/clear") {
      await readBody(request);
      fs.writeFileSync(LOG_FILE, "");
      sendJson(response, { ok: true });
      return;
    }

    response.writeHead(405, { Allow: "GET, HEAD" }).end();
    return;
  }

  // GET / HEAD below.
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

  if (pathname === "/login-as") {
    const userId = String(url.searchParams.get("userId") || "").trim();
    redirect(response, "/", userId ? [cookie("pl_user", userId)] : []);
    return;
  }

  if (pathname === "/debug/log") {
    sendJson(response, readLogs(500));
    return;
  }

  if (pathname === "/frames/content") {
    send(response, 200, "text/html; charset=utf-8", framesContentOne(), {
      "Cache-Control": "no-store",
    });
    return;
  }

  if (pathname === "/frames/content2") {
    send(response, 200, "text/html; charset=utf-8", framesContentTwo(), {
      "Cache-Control": "no-store",
    });
    return;
  }

  const pageRoutes = {
    "/": () => homePage(ctx),
    "/detail": () => detailPage(ctx),
    "/modal": () => modalPage(ctx),
    "/features": () => featuresPage(ctx),
    "/tooltips": () => tooltipsPage(ctx),
    "/spotlight": () => spotlightPage(ctx),
    "/sheets": () => sheetsPage(ctx),
    "/sheets-modal": () => sheetsModalPage(ctx),
    "/fullpage": () => fullpagePage(ctx),
    "/floater": () => floaterPage(ctx),
    "/media": () => mediaPage(ctx),
    "/widgets": () => widgetsPage(ctx),
    "/surveys": () => surveysPage(ctx),
    "/clicks": () => clicksPage(ctx),
    "/triggers": () => triggersPage(ctx),
    "/exit": () => exitPage(ctx),
    "/forms": () => formsPage(ctx, { saved: url.searchParams.get("saved") === "1" }),
    "/frames": () => framesPage(ctx),
    "/streams": () => streamsPage(ctx),
    "/morph": () => morphPage(ctx),
    "/permanent": () => permanentPage(ctx),
    "/permanent-2": () => permanentTwoPage(ctx),
    "/replace": () => replacePage(ctx),
    "/debug": () => debugPage(ctx),
  };

  if (pageRoutes[pathname]) {
    sendHtml(response, pageRoutes[pathname](), 200, ctx.setCookies);
    return;
  }

  const asset = assets.get(pathname);
  if (asset) {
    serveAsset(response, asset);
    return;
  }

  sendNotFound(response, ctx);
}

const server = http.createServer((request, response) => {
  handle(request, response).catch((error) => {
    console.error("PlotlineE2E server error", error);
    if (!response.headersSent) {
      response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" }).end("Server error");
    } else {
      response.end();
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Hotwire Native demo server listening on http://localhost:${PORT}`);
});
