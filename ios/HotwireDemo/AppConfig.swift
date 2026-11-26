import Foundation

enum AppConfig {
    // -baseURL <url> launch argument (test automation) wins over the Info.plist value.
    static var baseURL: URL {
        if let configured = UserDefaults.standard.string(forKey: "baseURL"),
           let url = URL(string: configured) {
            return url
        }
        if let configured = Bundle.main.object(forInfoDictionaryKey: "HotwireDemoBaseURL") as? String,
           let url = URL(string: configured) {
            return url
        }
        return URL(string: "http://localhost:3000")!
    }

    // -userId <id> launch argument (test automation), read through UserDefaults.
    static var launchUserId: String? {
        guard let value = UserDefaults.standard.string(forKey: "userId"), !value.isEmpty else {
            return nil
        }
        return value
    }

    static func url(for path: String) -> URL {
        URL(string: path, relativeTo: baseURL)?.absoluteURL ?? baseURL
    }

    static func loginURL(userId: String) -> URL {
        let encoded = userId.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? userId
        return url(for: "/login-as?userId=\(encoded)")
    }
}
