# Hotwire Native Demo

A deliberately small Hotwire Native app for checking native navigation, modals, and the Plotline web SDK.

- 3 web screens: Home, Detail, Modal
- Native push navigation on iOS and Android
- Native modal presentation driven by path configuration
- Local bundled path configuration with a remote override
- No custom tab bar, modal controller, or per-screen native code
- Plotline web SDK configured with separate iOS and Android demo users

## Versions

Hotwire Native is the current successor to Turbo Native.

- iOS: `hotwire-native-ios` `1.3.1`
- Android: `dev.hotwire:core` and `dev.hotwire:navigation-fragments` `1.4.1`
- iOS deployment target: 16.0
- Android min SDK: 28

The older Turbo Native experiment is still in `../TurboNative` and is not used by this app.

## Layout

```
server/                 3-page Node server, path configs, CSS, Turbo
ios/                    XcodeGen project + Hotwire Native iOS app
android/                Gradle project + Hotwire Native Android app
scripts/                dev, run-ios, run-android, check
```

## Run

### 1. Start the web server

```bash
cd server
node index.js
```

Server: `http://localhost:3000`

Quick check:

```bash
./scripts/check.sh
```

### 2. iOS

```bash
./scripts/run-ios.sh
```

Or manually:

```bash
cd ios
xcodegen generate --spec project.yml
xcodebuild \
  -project HotwireDemo.xcodeproj \
  -scheme HotwireDemo \
  -sdk iphonesimulator \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -derivedDataPath build \
  CODE_SIGNING_ALLOWED=NO \
  build
xcrun simctl install booted build/Build/Products/Debug-iphonesimulator/HotwireDemo.app
xcrun simctl launch booted com.example.hotwiredemo
```

The iOS app loads `http://localhost:3000`.

### 3. Android

Start an emulator, then:

```bash
./scripts/run-android.sh
```

Or manually:

```bash
cd android
./gradlew :app:assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n com.example.hotwiredemo/.MainActivity
```

The Android emulator loads `http://10.0.2.2:3000` (the host machine).

For a physical Android device, change `SERVER_URL` in
`android/app/build.gradle.kts` to your Mac's LAN address.

## What to check

1. Tap **Detail screen** and confirm the native navigation bar pushes and animates.
2. Use the native back button (or Android system back) to return.
3. Tap **Modal screen** and confirm it opens as a native modal.
4. Dismiss with the iOS Done button, Android close button, swipe down, or system back.
5. Confirm the platform badge shows `Hotwire Native iOS` or `Hotwire Native Android`.
6. If a Plotline campaign is active for the demo user, it should appear on Home.

## How the setup works

### iOS

`ios/HotwireDemo/AppDelegate.swift` configures Hotwire before the first visit:

- Loads the bundled `path-configuration.json`
- Loads the remote `/configurations/ios_v1.json` override
- Sets the user-agent prefix
- Enables the Done button for modals
- Uses a minimal back button

`ios/HotwireDemo/SceneDelegate.swift` creates a single `Navigator` and starts it at the home URL. There is no custom modal code.

### Android

`android/app/src/main/kotlin/com/example/hotwiredemo/HotwireDemoApplication.kt` loads the path configuration and enables debug logging.

`MainActivity.kt` extends `HotwireActivity` and declares one `NavigatorConfiguration` attached to the `NavigatorHost` in `activity_main.xml`.

The modal is created by the `/modal` rule in:

- `server/index.js` for the remote config
- `ios/HotwireDemo/path-configuration.json` for the iOS bundled fallback
- `android/app/src/main/assets/json/configuration.json` for the Android bundled fallback

### Path configuration

Both platforms use the same idea:

```json
{
  "patterns": ["/modal$"],
  "properties": {
    "context": "modal"
  }
}
```

Android additionally maps the modal to `hotwire://fragment/web/modal/sheet`.

### Page titles

Each page sets a simple `<title>`, so the native toolbar title stays clean:

- `Home`
- `Detail`
- `Modal`

## Plotline

The Plotline web SDK is configured in `server/index.js` and `server/public/assets/plotline.js`.

- The loader snippet is injected into every page `<head>`
- `PlotlineHotwire.start({ apiKey, userId })` (from `assets/plotline-hotwire.js`) replaces
  `plotline('init', apiKey, userId)`; see "Hotwire handling" below. It uses separate demo users:
  - iOS: `vamsi_hotwire_ios`
  - Android: `vamsi_hotwire_android`
  - Web fallback: `vamsi_hotwire`
- `page_view` is tracked on the initial load and on every Turbo navigation
- `identify` sends `plan`, `platform` (iOS/Android/web), and `uiMode`
- `setLocale` is set to `en`
- `setRedirectListener` maps `home`, `detail`, and `modal` to the app routes
- `setPlotlineEventsListener` records SDK events for debugging
- Home includes a `data-plotline-widget="true"` placeholder

### Hotwire handling (`plotline-hotwire.js`)

Turbo replaces `<body>` on every visit, restores pages from cached copies, and Hotwire Native changes the
URL before the new page is on screen. The Plotline web SDK 3.6.x assumes none of that. The adapter, loaded
in `<head>` before `plotline.js`, makes it behave like the native SDKs:

- A visit to another page closes the open campaign, as leaving a screen does in the Android SDK. It is
  hidden at once, before Hotwire Native screenshots the screen being left, so the screenshot Android keeps
  behind a modal sheet (and shows on Back) has no tooltip in it. Steps set to "Don't dismiss on click
  outside" stay open. A refresh or a visit to the same page keeps it open.
- Whatever stays open (that step, surveys, stories) moves to the new page; cached copies of overlays and
  widgets are removed, so Back never shows a dead campaign or widget.
- The page id follows the page on screen, so the next page's campaigns never show on the page being left.
- A multi-step campaign continues across WebViews: on iOS a modal is a second WebView, and a step on
  `/modal` now shows there. The first WebView lets the campaign go, so it is not stuck waiting.
- A WebView that is hidden (a dismissed iOS modal, the app in the background) closes its open campaign, as
  Android does on pause. Shown again, its page counts as a new page view.
- `Default: App Open` fires once per app session across all WebViews, as in the native SDKs, instead of on
  every iOS modal and pull-to-refresh. Existing "app open" campaigns need no change.
- "Open URL" CTAs go through Turbo or the native router inside Hotwire Native (`window.open` is a no-op on
  Hotwire Native Android).
- Queued analytics are sent before a WebView is hidden or reloaded.

Both apps add `PlotlineLaunch/<uuid>` to the user agent prefix (`AppDelegate.swift`,
`HotwireDemoApplication.kt`), one id per app launch. With it, `Default: App Open` fires exactly once per
launch. Without it the adapter treats a new WebView as the same app session when another one was used in
the last 30 minutes, so a relaunch within 30 minutes is not counted as an app open.

`PlotlineHotwire.debug()` in the WebView inspector shows the adapter state (shell, app open, walkthrough).

`turbo-cache-control: no-cache` is no longer needed, so Back is instant again. Once a Web SDK release
handles Turbo itself, the adapter detects it and leaves those parts to the SDK; no code change is needed.

### Plotline DOM IDs

Every web component has a stable `id` so Plotline can target it. Shared elements on every page:

| ID | Element |
| --- | --- |
| `app-body` | page body |
| `app-shell` | page shell |
| `app-header` | top header |
| `app-brand` | Hotwire Native brand |
| `platform-badge` | iOS/Android/web badge |

Home:

| ID | Element |
| --- | --- |
| `home-screen` | home page |
| `home-screen-label` | screen label |
| `home-title` | page heading |
| `home-description` | intro copy |
| `home-screen-links` | navigation container |
| `home-detail-link` | Detail tile |
| `home-detail-link-index` / `-content` / `-title` / `-subtitle` / `-arrow` | Detail tile parts |
| `home-modal-link` | Modal tile |
| `home-modal-link-index` / `-content` / `-title` / `-subtitle` / `-arrow` | Modal tile parts |
| `home-checklist` | checklist panel |
| `home-checklist-label` | checklist heading |
| `home-checklist-items` | checklist list |
| `home-checklist-native-push` | first checklist item |
| `home-checklist-native-back` | second checklist item |
| `home-checklist-modal` | third checklist item |
| `plotline-widget` | Plotline widget placeholder |

Detail:

| ID | Element |
| --- | --- |
| `detail-screen` | detail page |
| `detail-screen-label` | screen label |
| `detail-title` | page heading |
| `detail-description` | intro copy |
| `detail-open-modal-button` | Open the modal button |
| `detail-back-home-link` | Back to home link |

Modal:

| ID | Element |
| --- | --- |
| `modal-screen` | modal page |
| `modal-screen-label` | screen label |
| `modal-title` | page heading |
| `modal-description` | intro copy |
| `modal-note` | note panel |
| `modal-note-label` | note heading |
| `modal-note-copy` | note copy |
| `modal-go-detail-button` | Go to detail button |

Not found:

| ID | Element |
| --- | --- |
| `not-found-screen` | error page |
| `not-found-code` | 404 label |
| `not-found-title` | page heading |
| `not-found-description` | intro copy |
| `not-found-back-home-button` | Back to home button |

The native navigation bar, back button, Done button, and native Android modal chrome are not DOM elements, so they cannot have HTML IDs.

This is the public Plotline web SDK key, so it is intentionally delivered to the client. The API key and user ID can be overridden without editing code:

```bash
PLOTLINE_API_KEY=... \
PLOTLINE_USER_ID_IOS=... \
PLOTLINE_USER_ID_ANDROID=... \
node server/index.js
```

Because this is the web SDK running inside the Hotwire WebView, it does not need extra native Plotline
setup for the basic campaigns, surveys, and events flow. If you later need native deep links or native
widgets, add Plotline's native SDK separately.

For debugging on Android, Chrome DevTools shows the WebView state:

```js
window.__plotlineTracks     // page_view calls made by this app
window.__plotlineEvents     // Plotline-generated events
window.__plotlineRedirects  // redirect payloads received from Plotline
```

## Test bed

The app doubles as an end-to-end test bed for the Plotline Web SDK inside Turbo 8 and
Hotwire Native. Every page is a normal Turbo page built with the same `layout()` and
`chrome()`, and every Plotline target has a stable, unique `id`. `/features` is the index.

### SDK and adapter switches

| Query param | Cookie | Values | Default | Meaning |
| --- | --- | --- | --- | --- |
| `?sdk=` | `pl_sdk` | `prod`, `latest`, `local` | `latest` | Which SDK build to load: `@3.6.8`, `@latest`, or `/assets/sdk/plotline-local.js` |
| `?adapter=` | `pl_adapter` | `1`, `0` | `1` | `1` loads `plotline-hotwire.js`; `0` skips it and `plotline.js` calls `plotline('init', ...)` directly |

The cookie is set by the server on the first request with the query param, so the choice
survives Turbo visits and new WebViews. Every page shows the active values in the
`#build-badge` footer, for example `sdk: prod · adapter: on`.

To test a local build, drop it at `server/public/assets/sdk/plotline-local.js` (the folder
keeps a `.gitkeep`; the file is not committed) and open `/?sdk=local`, or press
**SDK: local** on `/debug`.

### User switching

`POST /login` (form field `userId`) sets the `pl_user` cookie, `POST /logout` clears it,
and `GET /login-as?userId=<id>` does the same from a link/redirect. All redirect `303` to
`/`. While the cookie is set, `PLOTLINE_CONFIG.userId` and the
`<meta name="plotline-user-id">` tag in `<head>` use it; otherwise the platform env
defaults apply.

### Pages and element ids

| Page | Element ids | Purpose |
| --- | --- | --- |
| `/` | `home-features-link` (+ existing home ids, `plotline-widget`) | Link to the index, default widget slot |
| `/detail` | existing detail ids | Push navigation |
| `/modal` | existing modal ids | Native modal via path config |
| `/features` | `features-title`, `nav-<page>` | Index of every test page |
| `/tooltips` | `tt-a`, `tt-b`, `tt-c`, `tt-far` (2 screens down), `tt-next`, `tt-modal` | Tooltip targets and leaving links |
| `/spotlight` | `spot-card`, `spot-btn`, `spot-leave` | Spotlight anchor, button and leave link |
| `/sheets` | `sheet-trigger`, `sheet-input`, `sheet-leave`, `sheet-modal-link` | Sheet trigger, keyboard resize, sheet modal |
| `/sheets-modal` | `sheets-modal-input`, `sheets-modal-trigger` | Modal target for sheets (`/sheets-modal$` rule) |
| `/fullpage` | `fullpage-trigger`, `fullpage-leave` | Full page campaign |
| `/floater` | `floater-content`, `floater-leave` | 3+ screen page for floaters |
| `/media` | `pip-trigger`, `media-trigger`, `media-leave` | PIP and media campaigns |
| `/widgets` | `hw-widget-default`, `hw-widget-stories`, `hw-widget-swipe`, `hw-widget-group-1`, `hw-widget-group-2`, `hw-widget-carousel`, `widgets-leave` | One widget slot per type |
| `/surveys` | `survey-trigger`, `survey-leave` | Survey campaign |
| `/clicks` | `click-id`, `click-class-1`, `click-class-2` (class `click-class`), `click-text` (text "Click Text Trigger"), `click-leave` | Click id / class / text targets |
| `/triggers` | `trg-delay`, `trg-a`, `trg-b`, `trg-priority`, `trg-event-props`, `trg-leave` | Delay, composite, priority and property triggers |
| `/exit` | `exit-home`, `exit-detail` | Page-exit triggers |
| `/forms` | `form-same`, `form-error`, `form-error-msg`, `form-other`, `form-saved-msg` | Same-page 303, 422 error, other-page 303 |
| `/frames` | `hw-frame` (lazy, `src=/frames/content`) | Lazy Turbo Frame |
| `/frames/content` | `hw-widget-frame`, `frame-btn`, `frame-next` | Frame content 1 (fragment only) |
| `/frames/content2` | `hw-widget-frame-2` | Frame content 2 (fragment only) |
| `/streams` | `stream-add`, `stream-target` | Turbo Stream append |
| `/streams/add` | appends `stream-block-<n>`, `hw-widget-stream-<n>`, `stream-btn-<n>`, `stream-target-<n>` | Stream response (n counts up per process) |
| `/morph` | `hw-widget-morph`, `morph-target`, `morph-refresh` | Morph refresh with preserved scroll |
| `/permanent` | `perm-box` (`data-turbo-permanent`), `hw-widget-perm`, `perm-next` | Permanent element across a visit |
| `/permanent-2` | `perm-box`, `hw-widget-perm`, `perm-back` | Same permanent box |
| `/replace` | `replace-link` (`data-turbo-action=replace`), `replace-normal` | Replace vs normal visit |
| `/debug` | `debug-user-id`, `debug-sdk-version`, `debug-launch-id`, `debug-cookies`, `debug-user`, `debug-login`, `debug-logout`, `debug-event`, `debug-sdk-prod`, `debug-sdk-latest`, `debug-sdk-local`, `debug-adapter-on`, `debug-adapter-off`, `debug-log` | Runtime state, login, cookie switches and log tail |

Every app button that should emit a Plotline event carries `data-pl-track="<event>"` (and
optionally `data-pl-props='{"json":true}'`), which `plotline.js` turns into
`plotline('track', ...)` and logs with source `app`. This keeps all scripts in `<head>`.

### Deep links

Scheme `hwdemo`, host `open`, query `path`:

```
hwdemo://open?path=/tooltips
```

iOS registers `CFBundleURLTypes` (`hwdemo`) in `project.yml`/`Info.plist` and handles cold
and warm starts in `SceneDelegate`. Android registers an `intent-filter` on `MainActivity`
and handles `onCreate`/`onNewIntent`, routing with the Hotwire navigator.

### Launch overrides (test automation)

iOS launch arguments, read through `UserDefaults`:

```bash
xcrun simctl launch booted com.example.hotwiredemo -baseURL http://localhost:3000 -userId e2e_user
```

Android intent extras:

```bash
adb shell am start -n com.example.hotwiredemo/.MainActivity \
  --es baseUrl http://10.0.2.2:3000 --es userId e2e_user
```

When `userId` is given, the app opens `/login-as?userId=<id>` first (server sets `pl_user`
and redirects `303` to `/`), then continues to any deep link.

### Log endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/debug/log` | Append `{source, level, msg, url, ts}` as one line to `server/logs/e2e.log` and stdout (`PlotlineE2E ...`) |
| `GET` | `/debug/log` | Last 500 log lines as a JSON array |
| `POST` | `/debug/log/clear` | Empty the log file |
| `GET` | `/health` | Health check |
| `GET` | `/login-as?userId=<id>` | Set `pl_user`, redirect `303` to `/` |
| `POST` | `/login`, `/logout` | Set / clear `pl_user`, redirect `303` to `/` |

`plotline.js` forwards:

- `console.log/info/warn/error` messages that start with `[Plotline` or contain
  `plotline` (case-insensitive), source `console`.
- Turbo events (`turbo:visit`, `turbo:before-render`, `turbo:render`, `turbo:load`,
  `turbo:before-cache`, `turbo:frame-load`, `turbo:before-stream-render`,
  `turbo:submit-end`), source `turbo`.
- App button `track` calls, source `app`.
- `pagehide`, `pageshow`, `visibilitychange`, source `lifecycle`.
- Every line also goes to the native bridges when present: iOS
  `WKScriptMessageHandler` `hwlog` (`NSLog("PlotlineE2E ...")`) and Android
  `@JavascriptInterface` `HWLog` (`Log.i("PlotlineE2E", ...)`).

`server/logs/` is gitignored. The `/frames` lazy-frame handler flips a loaded frame from
`lazy` to `eager` to work around a Turbo 8.0.23 quirk where a second `src` change on a
lazy frame renders the stale snapshot.

## Notes

- The server is intentionally dependency-free.
- Turbo Drive is served locally from `server/public/assets/turbo.js`.
- The app supports `http://` to localhost for development via ATS and Android cleartext settings.
- Android uses a light toolbar matching the web page; dark mode gets a dark toolbar and light icons.
