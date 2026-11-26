import HotwireNative
import UIKit
import WebKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        configureHotwire()
        return true
    }

    func application(
        _ application: UIApplication,
        configurationForConnecting connectingSceneSession: UISceneSession,
        options: UIScene.ConnectionOptions
    ) -> UISceneConfiguration {
        UISceneConfiguration(name: "Default Configuration", sessionRole: connectingSceneSession.role)
    }

    private func configureHotwire() {
        let bundledConfiguration = Bundle.main.url(
            forResource: "path-configuration",
            withExtension: "json"
        )!

        Hotwire.loadPathConfiguration(from: [
            .file(bundledConfiguration),
            .server(AppConfig.url(for: "/configurations/ios_v1.json")),
        ])

        // One id per app launch: lets the Plotline adapter count "Default: App Open" once per launch.
        Hotwire.config.applicationUserAgentPrefix = "Hotwire Demo; PlotlineLaunch/\(UUID().uuidString);"
        Hotwire.config.backButtonDisplayMode = .minimal
        Hotwire.config.showDoneButtonOnModals = true

        // E2E log bridge: plotline.js posts each log line to WKScriptMessageHandler "hwlog".
        Hotwire.config.makeCustomWebView = { configuration in
            configuration.userContentController.add(HWLogHandler(), name: "hwlog")
            return WKWebView(frame: .zero, configuration: configuration)
        }

        #if DEBUG
        Hotwire.config.debugLoggingEnabled = true
        #endif
    }
}

final class HWLogHandler: NSObject, WKScriptMessageHandler {
    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        NSLog("PlotlineE2E %@", String(describing: message.body))
    }
}
