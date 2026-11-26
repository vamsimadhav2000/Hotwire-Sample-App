import HotwireNative
import UIKit

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    private var navigator: Navigator?

    func scene(
        _ scene: UIScene,
        willConnectTo session: UISceneSession,
        options connectionOptions: UIScene.ConnectionOptions
    ) {
        guard let windowScene = scene as? UIWindowScene else { return }

        let deepLink = deepLinkTarget(from: connectionOptions.urlContexts.first?.url)

        // -userId <id> launches through /login-as first, as the native test automation expects.
        let startLocation: URL
        var routeAfterStart: URL?
        if let userId = AppConfig.launchUserId {
            startLocation = AppConfig.loginURL(userId: userId)
            routeAfterStart = deepLink
        } else if let deepLink = deepLink {
            startLocation = deepLink
        } else {
            startLocation = AppConfig.baseURL
        }

        let navigator = Navigator(configuration: .init(name: "main", startLocation: startLocation))
        self.navigator = navigator

        let window = UIWindow(windowScene: windowScene)
        window.rootViewController = navigator.rootViewController
        window.makeKeyAndVisible()
        self.window = window

        navigator.start()

        if let routeAfterStart = routeAfterStart {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { [weak navigator] in
                navigator?.route(routeAfterStart)
            }
        }
    }

    // Warm start: hwdemo://open?path=/tooltips
    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        guard let url = URLContexts.first?.url, let target = deepLinkTarget(from: url) else {
            return
        }
        if let userId = AppConfig.launchUserId {
            navigator?.route(AppConfig.loginURL(userId: userId))
        }
        navigator?.route(target)
    }

    private func deepLinkTarget(from url: URL?) -> URL? {
        guard let url = url, url.scheme == "hwdemo", url.host == "open" else { return nil }
        let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        guard let path = components?.queryItems?.first(where: { $0.name == "path" })?.value,
              path.hasPrefix("/") else {
            return nil
        }
        return AppConfig.url(for: path)
    }
}
