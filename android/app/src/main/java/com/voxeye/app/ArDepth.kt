package com.voxeye.app

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageFormat
import android.graphics.Matrix
import android.graphics.Rect
import android.graphics.YuvImage
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.media.Image
import android.opengl.EGL14
import android.opengl.EGLConfig
import android.opengl.EGLContext
import android.opengl.EGLDisplay
import android.opengl.EGLSurface
import android.opengl.GLES11Ext
import android.opengl.GLES20
import android.util.Base64
import android.util.Log
import android.view.Surface
import com.google.ar.core.ArCoreApk
import com.google.ar.core.Config
import com.google.ar.core.Coordinates2d
import com.google.ar.core.Frame
import com.google.ar.core.Session
import com.google.ar.core.exceptions.NotYetAvailableException
import java.io.ByteArrayOutputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Native ARCore Depth API source for the stereo sonar.
 *
 * ARCore needs a GL context to update, but nothing is drawn: the session runs on its own thread with an
 * offscreen (pbuffer) EGL context. Each depth frame (~12 Hz) is reduced to the nearest surface in the
 * LEFT / CENTER / RIGHT third of the portrait view (same band and percentile as the WebXR path in
 * xr_depth.js) plus a 48x48 thumbnail, and pushed to the page. ARCore owns the camera while it runs, so
 * question frames come from [captureJpeg] (ARCore CPU camera image, rotated to portrait).
 */
class ArDepth(private val ctx: Context, private val emit: (String) -> Unit, private val ended: (String) -> Unit) {
    companion object {
        private const val TAG = "VoxEyeAR"
        // Same sampling as xr_depth.js (denser, since native sampling is cheap)
        private const val COLS = 36; private const val ROWS = 20
        private const val Y0 = 0.18f; private const val Y1 = 0.68f
        private const val PCT = 0.15f; private const val MIN_M = 0.1f; private const val MAX_M = 8.0f
        private const val DEPTH_GAP_MS = 80L
        private const val THUMB = 48; private const val THUMB_GAP_MS = 200L
        private const val THUMB_NEAR = 0.3f; private const val THUMB_FAR = 4.0f
    }

    @Volatile private var running = false
    @Volatile private var paused = false
    private var thread: Thread? = null
    private var session: Session? = null

    // Capture request from the JS bridge thread, served on the AR thread.
    private class Capture(val width: Int, val quality: Int) { val done = CountDownLatch(1); var b64: String? = null; var err: String? = null }
    @Volatile private var capture: Capture? = null

    @Volatile var status = "idle"; private set
    @Volatile var depthFrames = 0; private set
    @Volatile var depthSize = ""; private set
    @Volatile var tracking = "-"; private set

    /** "ok" when this phone can run ARCore depth, otherwise the reason. */
    fun availability(): String {
        return try {
            val a = ArCoreApk.getInstance().checkAvailability(ctx)
            if (a.isTransient) return "checking"
            if (a != ArCoreApk.Availability.SUPPORTED_INSTALLED) return "arcore $a"
            "ok"
        } catch (e: Throwable) { "arcore error: ${e.message}" }
    }

    /** Starts the session; returns "ok" or the reason it cannot run (caller falls back). */
    @Synchronized
    fun start(): String {
        if (running) return "ok"
        val av = availability()
        if (av != "ok") return av
        val s = try { Session(ctx) } catch (e: Throwable) { return "session: ${e.javaClass.simpleName} ${e.message ?: ""}".trim() }
        if (!s.isDepthModeSupported(Config.DepthMode.AUTOMATIC)) { s.close(); return "depth not supported on this phone" }
        val cfg = Config(s).apply {
            depthMode = Config.DepthMode.AUTOMATIC
            focusMode = Config.FocusMode.AUTO
            updateMode = Config.UpdateMode.LATEST_CAMERA_IMAGE
            planeFindingMode = Config.PlaneFindingMode.DISABLED
            lightEstimationMode = Config.LightEstimationMode.DISABLED
        }
        try { s.configure(cfg) } catch (e: Throwable) { s.close(); return "configure: ${e.message}" }
        session = s
        running = true
        paused = false
        depthFrames = 0
        status = "starting"
        val ready = CountDownLatch(1)
        var startErr: String? = null
        thread = Thread({
            try { loop(s) { err -> startErr = err; ready.countDown() } }
            catch (e: Throwable) { Log.e(TAG, "AR loop", e); if (ready.count > 0) { startErr = e.message ?: e.javaClass.simpleName; ready.countDown() } else if (running) finish("error: ${e.message}") }
        }, "voxeye-arcore").also { it.start() }
        ready.await(4, TimeUnit.SECONDS)
        startErr?.let { stop(); return it }
        return "ok"
    }

    @Synchronized
    fun stop() {
        running = false
        thread?.let { if (it !== Thread.currentThread()) it.join(1500) }
        thread = null
        capture?.let { it.err = "stopped"; it.done.countDown() }
        capture = null
        status = "stopped"
    }

    fun onPause() { if (running) { paused = true; try { session?.pause() } catch (_: Throwable) {} } }
    fun onResume() { if (running && paused) { try { session?.resume(); paused = false } catch (e: Throwable) { finish("resume: ${e.message}") } } }

    private fun finish(reason: String) {
        if (!running) return
        running = false
        status = "ended: $reason"
        ended(reason)
    }

    /** Camera JPEG (base64, portrait) from the AR camera; blocks the calling (JS bridge) thread up to 1.5 s. */
    fun captureJpeg(width: Int, quality: Int): String? {
        if (!running) return null
        val c = Capture(width.coerceIn(64, 1280), quality.coerceIn(20, 95))
        capture = c
        if (!c.done.await(1500, TimeUnit.MILLISECONDS)) { if (capture === c) capture = null; return null }
        return c.b64
    }

    // ---------------------------------------------------------------- AR thread

    private fun loop(s: Session, started: (String?) -> Unit) {
        val egl = OffscreenGl()
        try {
            val tex = IntArray(1)
            GLES20.glGenTextures(1, tex, 0)
            GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, tex[0])
            GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
            GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
            s.setCameraTextureName(tex[0])
            // Portrait display with the camera image's own aspect -> VIEW covers the whole camera image (no crop)
            val img = s.cameraConfig.imageSize
            s.setDisplayGeometry(Surface.ROTATION_0, min(img.width, img.height), max(img.width, img.height))
            val sensorDeg = sensorOrientation(s.cameraConfig.cameraId)
            s.resume()
            status = "running"
            started(null)

            var grid: FloatArray? = null   // view -> image-normalized points for sectors
            var thumbPts: FloatArray? = null
            var lastDepth = 0L; var lastThumb = 0L
            while (running) {
                if (paused) { Thread.sleep(50); continue }
                val frame: Frame = try { s.update() } catch (e: com.google.ar.core.exceptions.SessionPausedException) { Thread.sleep(50); continue }
                if (grid == null || frame.hasDisplayGeometryChanged()) {
                    grid = mapPoints(frame, sectorViewPoints())
                    thumbPts = mapPoints(frame, thumbViewPoints())
                }
                capture?.let { c -> capture = null; serveCapture(frame, c, sensorDeg) }
                val cam = frame.camera
                tracking = if (cam.trackingState == com.google.ar.core.TrackingState.TRACKING) "tracking"
                    else "${cam.trackingState.name.lowercase()} (${cam.trackingFailureReason.name.lowercase()})"
                val now = System.currentTimeMillis()
                if (now - lastDepth < DEPTH_GAP_MS) { Thread.sleep(10); continue }
                val depth = try { frame.acquireDepthImage16Bits() } catch (_: NotYetAvailableException) { Thread.sleep(15); continue }
                try {
                    lastDepth = now
                    depthFrames++
                    depthSize = "${depth.width}x${depth.height}"
                    val read = DepthReader(depth)
                    val sectors = sectors(read, grid!!)
                    val sb = StringBuilder(160)
                    sb.append("{\"l\":").append(js(sectors[0])).append(",\"c\":").append(js(sectors[1])).append(",\"r\":").append(js(sectors[2]))
                    sb.append(",\"w\":").append(depth.width).append(",\"h\":").append(depth.height).append(",\"n\":").append(depthFrames)
                    if (now - lastThumb >= THUMB_GAP_MS) {
                        lastThumb = now
                        sb.append(",\"t\":\"").append(Base64.encodeToString(thumb(read, thumbPts!!), Base64.NO_WRAP)).append('"')
                    }
                    sb.append('}')
                    emit(sb.toString())
                } finally { depth.close() }
            }
        } finally {
            try { s.pause() } catch (_: Throwable) {}
            try { s.close() } catch (_: Throwable) {}
            session = null
            egl.release()
        }
    }

    private fun js(v: Float?) = if (v == null) "null" else ((v * 100).roundToInt() / 100f).toString()

    private class DepthReader(img: Image) {
        val w = img.width; val h = img.height
        private val buf = img.planes[0].buffer.order(java.nio.ByteOrder.nativeOrder())
        private val rowStride = img.planes[0].rowStride
        private val pixStride = img.planes[0].pixelStride
        /** metres at image-normalized (x, y); 0 = invalid */
        fun at(x: Float, y: Float): Float {
            val px = (x * w).toInt().coerceIn(0, w - 1); val py = (y * h).toInt().coerceIn(0, h - 1)
            val mm = buf.getShort(py * rowStride + px * pixStride).toInt() and 0xFFFF
            return mm / 1000f
        }
    }

    private fun sectorViewPoints(): FloatArray {
        val out = FloatArray(COLS * ROWS * 2); var i = 0
        for (c in 0 until COLS) for (r in 0 until ROWS) {
            out[i++] = (c + 0.5f) / COLS
            out[i++] = Y0 + ((r + 0.5f) / ROWS) * (Y1 - Y0)
        }
        return out
    }

    private fun thumbViewPoints(): FloatArray {
        val out = FloatArray(THUMB * THUMB * 2); var i = 0
        for (y in 0 until THUMB) for (x in 0 until THUMB) { out[i++] = (x + 0.5f) / THUMB; out[i++] = (y + 0.5f) / THUMB }
        return out
    }

    private fun mapPoints(frame: Frame, view: FloatArray): FloatArray {
        val out = FloatArray(view.size)
        frame.transformCoordinates2d(Coordinates2d.VIEW_NORMALIZED, view, Coordinates2d.IMAGE_NORMALIZED, out)
        return out
    }

    /** nearest surface per third, low percentile over valid samples (>= 4 needed), like xr_depth.js */
    private fun sectors(d: DepthReader, pts: FloatArray): Array<Float?> {
        val bins = Array(3) { FloatArray(COLS / 3 * ROWS + ROWS) }
        val n = IntArray(3)
        var i = 0
        for (c in 0 until COLS) {
            val key = when { (c + 0.5f) / COLS < 1f / 3 -> 0; (c + 0.5f) / COLS < 2f / 3 -> 1; else -> 2 }
            for (r in 0 until ROWS) {
                val m = d.at(pts[i], pts[i + 1]); i += 2
                if (m >= MIN_M && m <= MAX_M) bins[key][n[key]++] = m
            }
        }
        return Array(3) { k ->
            if (n[k] < 4) null else {
                val v = bins[k].copyOf(n[k]); v.sort()
                v[min(v.size - 1, (v.size * PCT).toInt())]
            }
        }
    }

    private fun thumb(d: DepthReader, pts: FloatArray): ByteArray {
        val out = ByteArray(THUMB * THUMB)
        for (j in 0 until THUMB * THUMB) {
            val m = d.at(pts[j * 2], pts[j * 2 + 1])
            if (m <= 0f) continue
            val t = (THUMB_FAR - m.coerceIn(THUMB_NEAR, THUMB_FAR)) / (THUMB_FAR - THUMB_NEAR)
            out[j] = (t * 255).roundToInt().toByte()
        }
        return out
    }

    private fun serveCapture(frame: Frame, c: Capture, sensorDeg: Int) {
        try {
            val img = frame.acquireCameraImage()
            val jpegFull: ByteArray
            val w: Int; val h: Int
            try { w = img.width; h = img.height; jpegFull = yuvToJpeg(img) } finally { img.close() }
            val bmp = BitmapFactory.decodeByteArray(jpegFull, 0, jpegFull.size)
            // rotate to portrait, scale to the requested width
            val rotW = if (sensorDeg % 180 == 0) w else h
            val scale = c.width.toFloat() / rotW
            val m = Matrix().apply { postRotate(sensorDeg.toFloat()); postScale(scale, scale) }
            val out = Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, m, true)
            val bos = ByteArrayOutputStream()
            out.compress(Bitmap.CompressFormat.JPEG, c.quality, bos)
            bmp.recycle(); out.recycle()
            c.b64 = Base64.encodeToString(bos.toByteArray(), Base64.NO_WRAP)
        } catch (e: Throwable) {
            c.err = e.message
        } finally { c.done.countDown() }
    }

    private fun yuvToJpeg(img: Image): ByteArray {
        val w = img.width; val h = img.height
        val nv21 = ByteArray(w * h * 3 / 2)
        val y = img.planes[0]; val u = img.planes[1]; val v = img.planes[2]
        var o = 0
        val yb = y.buffer
        for (row in 0 until h) { yb.position(row * y.rowStride); yb.get(nv21, o, w); o += w }
        val ub = u.buffer; val vb = v.buffer
        for (row in 0 until h / 2) for (col in 0 until w / 2) {
            nv21[o++] = vb.get(row * v.rowStride + col * v.pixelStride)
            nv21[o++] = ub.get(row * u.rowStride + col * u.pixelStride)
        }
        val bos = ByteArrayOutputStream()
        YuvImage(nv21, ImageFormat.NV21, w, h, null).compressToJpeg(Rect(0, 0, w, h), 90, bos)
        return bos.toByteArray()
    }

    private fun sensorOrientation(cameraId: String): Int = try {
        val cm = ctx.getSystemService(Context.CAMERA_SERVICE) as CameraManager
        cm.getCameraCharacteristics(cameraId).get(CameraCharacteristics.SENSOR_ORIENTATION) ?: 90
    } catch (_: Throwable) { 90 }

    /** 1x1 pbuffer EGL context current on the AR thread (ARCore needs GL to update the camera texture). */
    private class OffscreenGl {
        val dpy: EGLDisplay = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY)
        val ctx: EGLContext
        val surf: EGLSurface
        init {
            val ver = IntArray(2)
            EGL14.eglInitialize(dpy, ver, 0, ver, 1)
            val attrs = intArrayOf(EGL14.EGL_RENDERABLE_TYPE, EGL14.EGL_OPENGL_ES2_BIT, EGL14.EGL_SURFACE_TYPE, EGL14.EGL_PBUFFER_BIT,
                EGL14.EGL_RED_SIZE, 8, EGL14.EGL_GREEN_SIZE, 8, EGL14.EGL_BLUE_SIZE, 8, EGL14.EGL_NONE)
            val cfgs = arrayOfNulls<EGLConfig>(1); val num = IntArray(1)
            EGL14.eglChooseConfig(dpy, attrs, 0, cfgs, 0, 1, num, 0)
            ctx = EGL14.eglCreateContext(dpy, cfgs[0], EGL14.EGL_NO_CONTEXT, intArrayOf(EGL14.EGL_CONTEXT_CLIENT_VERSION, 2, EGL14.EGL_NONE), 0)
            surf = EGL14.eglCreatePbufferSurface(dpy, cfgs[0], intArrayOf(EGL14.EGL_WIDTH, 1, EGL14.EGL_HEIGHT, 1, EGL14.EGL_NONE), 0)
            if (!EGL14.eglMakeCurrent(dpy, surf, surf, ctx)) throw IllegalStateException("eglMakeCurrent failed")
        }
        fun release() {
            EGL14.eglMakeCurrent(dpy, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_CONTEXT)
            EGL14.eglDestroySurface(dpy, surf); EGL14.eglDestroyContext(dpy, ctx)
        }
    }
}
