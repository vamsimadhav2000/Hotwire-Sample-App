import Foundation

enum AppConfig {
    static var baseURL: URL {
        if let configured = Bundle.main.object(forInfoDictionaryKey: "HotwireDemoBaseURL") as? String,
           let url = URL(string: configured) {
            return url
        }
        return URL(string: "http://localhost:3000")!
    }

    static func url(for path: String) -> URL {
        URL(string: path, relativeTo: baseURL)?.absoluteURL ?? baseURL
    }
}
