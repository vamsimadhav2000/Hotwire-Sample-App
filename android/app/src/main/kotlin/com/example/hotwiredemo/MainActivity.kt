package com.example.hotwiredemo

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.View
import androidx.activity.enableEdgeToEdge
import dev.hotwire.navigation.activities.HotwireActivity
import dev.hotwire.navigation.navigator.Navigator
import dev.hotwire.navigation.navigator.NavigatorConfiguration
import dev.hotwire.navigation.util.applyDefaultImeWindowInsets

class MainActivity : HotwireActivity() {
    private var navigator: Navigator? = null
    private var pendingDeepLink: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        pendingDeepLink = deepLinkPath(intent)
        super.onCreate(savedInstanceState)

        setContentView(R.layout.activity_main)
        findViewById<View>(R.id.main_nav_host).applyDefaultImeWindowInsets()
    }

    override fun navigatorConfigurations(): List<NavigatorConfiguration> {
        val baseUrl = baseUrlFrom(intent)
        val userId = intent?.getStringExtra("userId")
        val startLocation = when {
            userId != null -> "$baseUrl/login-as?userId=${Uri.encode(userId)}"
            pendingDeepLink != null -> "$baseUrl$pendingDeepLink"
            else -> baseUrl
        }
        return listOf(
            NavigatorConfiguration(
                name = "main",
                startLocation = startLocation,
                navigatorHostId = R.id.main_nav_host
            )
        )
    }

    // A userId launch opens /login-as first; continue to the deep link once the navigator is ready.
    override fun onNavigatorReady(navigator: Navigator) {
        this.navigator = navigator
        val deepLink = pendingDeepLink
        if (deepLink != null && intent?.getStringExtra("userId") != null) {
            pendingDeepLink = null
            navigator.route("${baseUrlFrom(intent)}$deepLink")
        }
    }

    // Warm start: hwdemo://open?path=/tooltips
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)

        val deepLink = deepLinkPath(intent)
        val userId = intent.getStringExtra("userId")
        if (deepLink != null) {
            navigator?.route("${baseUrlFrom(intent)}$deepLink")
        } else if (userId != null) {
            navigator?.route("${baseUrlFrom(intent)}/login-as?userId=${Uri.encode(userId)}")
        }
    }

    private fun baseUrlFrom(intent: Intent?): String =
        intent?.getStringExtra("baseUrl") ?: BuildConfig.SERVER_URL

    private fun deepLinkPath(intent: Intent?): String? {
        val data: Uri = intent?.data ?: return null
        if (data.scheme != "hwdemo" || data.host != "open") return null
        val path = data.getQueryParameter("path") ?: return null
        return if (path.startsWith("/")) path else "/$path"
    }
}
