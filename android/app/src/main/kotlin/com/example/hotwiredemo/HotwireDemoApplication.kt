package com.example.hotwiredemo

import android.app.Application
import dev.hotwire.core.config.Hotwire
import dev.hotwire.core.logging.HotwireLogLevel
import dev.hotwire.core.turbo.config.PathConfiguration

class HotwireDemoApplication : Application() {
    override fun onCreate() {
        super.onCreate()

        // One id per app launch: lets the Plotline adapter count "Default: App Open" once per launch.
        Hotwire.config.applicationUserAgentPrefix = "Hotwire Demo; PlotlineLaunch/${java.util.UUID.randomUUID()};"
        Hotwire.config.webViewDebuggingEnabled = BuildConfig.DEBUG
        Hotwire.config.logger.logLevel = if (BuildConfig.DEBUG) {
            HotwireLogLevel.DEBUG
        } else {
            HotwireLogLevel.NONE
        }

        Hotwire.loadPathConfiguration(
            context = this,
            location = PathConfiguration.Location(
                assetFilePath = "json/configuration.json",
                remoteFileUrl = "${BuildConfig.SERVER_URL}/configurations/android_v1.json"
            )
        )
    }
}
