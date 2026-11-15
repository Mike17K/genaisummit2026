package com.voxeye.app

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.text.InputType
import android.view.KeyEvent
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.Button
import android.graphics.Color
import android.view.Gravity
import android.os.Build
import android.view.WindowInsets
import android.content.pm.PackageManager
import android.os.Bundle
import android.view.View
import android.view.WindowManager
import android.webkit.GeolocationPermissions
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.JavascriptInterface
import android.net.Uri
import android.os.Handler
import android.os.Looper
import org.json.JSONObject

/**
 * VoxEye native shell: full-screen WebView around the web client served by the
 * VoxEye server. Default URL is http://localhost:8000 (secure context, so
 * camera/mic/GPS work) reached over USB with `adb reverse tcp:8000 tcp:8000`.
 * Override: adb shell am start -n com.voxeye.app/.MainActivity --es url https://host
 */
class MainActivity : Activity() {
    private lateinit var web: WebView
    private var pendingWebPerm: PermissionRequest? = null
    private var pendingGeo: Pair<String, GeolocationPermissions.Callback>? = null
    private val main = Handler(Looper.getMainLooper())
    @Volatile private var pageOrigin = ""
    private lateinit var ar: ArDepth

    private val perms = arrayOf(
        Manifest.permission.CAMERA,
        Manifest.permission.RECORD_AUDIO,
        Manifest.permission.ACCESS_FINE_LOCATION,
    )

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        web = WebView(this)
        val d = resources.displayMetrics.density
        val urlBtn = Button(this).apply {
            text = "URL"; textSize = 11f; alpha = 0.55f
            setTextColor(Color.WHITE); setBackgroundColor(Color.parseColor("#80000000"))
            setPadding(0, 0, 0, 0); minWidth = 0; minHeight = 0
            setOnClickListener { askUrl("Server URL:") }
        }
        val root = FrameLayout(this).apply {
            setBackgroundColor(Color.BLACK)
            addView(web, FrameLayout.LayoutParams(-1, -1))
            addView(urlBtn, FrameLayout.LayoutParams((44 * d).toInt(), (28 * d).toInt(), Gravity.TOP or Gravity.END)
                .apply { setMargins(0, (4 * d).toInt(), (4 * d).toInt(), 0) })
        }
        // Keep content inside the safe area (status/nav bars, cutout, keyboard).
        root.setOnApplyWindowInsetsListener { v, ins ->
            if (Build.VERSION.SDK_INT >= 30) {
                val i = ins.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout() or WindowInsets.Type.ime())
                v.setPadding(i.left, i.top, i.right, i.bottom)
            } else {
                v.setPadding(ins.systemWindowInsetLeft, ins.systemWindowInsetTop, ins.systemWindowInsetRight, ins.systemWindowInsetBottom)
            }
            WindowInsets.CONSUMED
        }
        setContentView(root)
        WebView.setWebContentsDebuggingEnabled(true)

        web.clearCache(true) // always pick up the latest server UI
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            cacheMode = WebSettings.LOAD_DEFAULT
            setGeolocationEnabled(true)
        }
        ar = ArDepth(this,
            emit = { json -> main.post { web.evaluateJavascript("window.__voxNative&&window.__voxNative.onDepth($json)", null) } },
            ended = { why -> main.post { web.evaluateJavascript("window.__voxNative&&window.__voxNative.onEnded(${JSONObject.quote(why)})", null) } })
        web.addJavascriptInterface(Bridge(), "VoxNative")
        web.webViewClient = object : WebViewClient() {
            override fun onPageStarted(v: WebView, url: String, favicon: android.graphics.Bitmap?) {
                ar.stop() // a new page never inherits a running AR session
                pageOrigin = origin(url)
            }
            override fun onReceivedError(v: WebView, r: WebResourceRequest, e: WebResourceError) {
                if (r.isForMainFrame) askUrl("Can't load ${r.url}\n${e.description}\n\nEnter server URL:")
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                runOnUiThread {
                    if (missing().isEmpty()) request.grant(request.resources)
                    else { pendingWebPerm = request; requestPermissions(perms, 1) }
                }
            }
            override fun onGeolocationPermissionsShowPrompt(origin: String, cb: GeolocationPermissions.Callback) {
                if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
                    cb.invoke(origin, true, false)
                } else { pendingGeo = origin to cb; requestPermissions(perms, 1) }
            }
        }
        if (missing().isNotEmpty()) requestPermissions(perms, 1)
        intent.getStringExtra("url")?.let { prefs().edit().putString(KEY, it).apply() }
        val saved = prefs().getString(KEY, null)
        if (saved.isNullOrBlank()) askUrl("Enter VoxEye server URL:") else web.loadUrl(saved)
    }

    private fun prefs() = getSharedPreferences("voxeye", Context.MODE_PRIVATE)

    /** Prompts for the server URL, saves it, and loads it. */
    private fun askUrl(msg: String) {
        if (isFinishing || isDestroyed) return
        val input = EditText(this).apply {
            inputType = InputType.TYPE_TEXT_VARIATION_URI
            setText(prefs().getString(KEY, "http://localhost:8000"))
            setSelectAllOnFocus(true)
        }
        AlertDialog.Builder(this).setTitle("Server URL").setMessage(msg).setView(input)
            .setPositiveButton("Save") { _, _ ->
                var u = input.text.toString().trim()
                if (u.isNotEmpty()) {
                    if (!u.contains("://")) u = "http://$u"
                    prefs().edit().putString(KEY, u).apply()
                    web.loadUrl(u)
                }
            }
            .setNegativeButton("Cancel", null).show()
    }

    // Long-press Volume Up (or Menu) to change the saved URL.
    override fun onKeyDown(code: Int, e: KeyEvent): Boolean {
        if (code == KeyEvent.KEYCODE_VOLUME_UP) { e.startTracking(); return true }
        if (code == KeyEvent.KEYCODE_MENU) { askUrl("Server URL:"); return true }
        return super.onKeyDown(code, e)
    }
    override fun onKeyLongPress(code: Int, e: KeyEvent): Boolean {
        if (code == KeyEvent.KEYCODE_VOLUME_UP) { askUrl("Server URL:"); return true }
        return super.onKeyLongPress(code, e)
    }
    override fun onKeyUp(code: Int, e: KeyEvent): Boolean {
        if (code == KeyEvent.KEYCODE_VOLUME_UP && !e.isCanceled) {
            (getSystemService(Context.AUDIO_SERVICE) as android.media.AudioManager)
                .adjustStreamVolume(android.media.AudioManager.STREAM_MUSIC, android.media.AudioManager.ADJUST_RAISE, android.media.AudioManager.FLAG_SHOW_UI)
            return true
        }
        return super.onKeyUp(code, e)
    }

    companion object { const val KEY = "url" }

    private fun origin(u: String?): String = try { Uri.parse(u ?: "").let { "${it.scheme}://${it.authority}" } } catch (_: Throwable) { "" }

    /** Native ARCore depth for the page; only the configured server's page may use it. */
    inner class Bridge {
        private fun allowed() = pageOrigin.isNotEmpty() && pageOrigin == origin(prefs().getString(KEY, null))
        @JavascriptInterface fun arAvailable(): String = if (!allowed()) "not allowed for this page" else ar.availability()
        @JavascriptInterface fun arStart(): String = when {
            !allowed() -> "not allowed for this page"
            checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED -> "no camera permission"
            else -> ar.start()
        }
        @JavascriptInterface fun arStop() { ar.stop() }
        @JavascriptInterface fun arStatus(): String = "${ar.status}, ${ar.tracking}, depth ${ar.depthSize.ifEmpty { "-" }}, ${ar.depthFrames} frames"
        @JavascriptInterface fun captureJpeg(width: Int, quality: Int): String = if (!allowed()) "" else ar.captureJpeg(width, quality) ?: ""
    }

    override fun onPause() { super.onPause(); if (::ar.isInitialized) ar.onPause() }
    override fun onResume() { super.onResume(); if (::ar.isInitialized) ar.onResume() }
    override fun onDestroy() { if (::ar.isInitialized) ar.stop(); super.onDestroy() }

    private fun missing() = perms.filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }

    override fun onRequestPermissionsResult(code: Int, p: Array<out String>, r: IntArray) {
        pendingWebPerm?.let { req ->
            val ok = checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
            if (ok) req.grant(req.resources) else req.deny()
            pendingWebPerm = null
        }
        pendingGeo?.let { (o, cb) ->
            cb.invoke(o, checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED, false)
            pendingGeo = null
        }
    }

    @Deprecated("back navigates the web history")
    override fun onBackPressed() { if (web.canGoBack()) web.goBack() else super.onBackPressed() }
}
