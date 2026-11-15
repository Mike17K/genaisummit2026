#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_TOOLS="/opt/homebrew/share/android-commandlinetools/build-tools/36.0.0"
PLATFORM="/opt/homebrew/share/android-commandlinetools/platforms/android-36/android.jar"
JAVA_HOME="/opt/homebrew/opt/openjdk@21"
JAVAC="$JAVA_HOME/bin/javac"
KEYTOOL="$JAVA_HOME/bin/keytool"

WORK_DIR="$ROOT_DIR/brag-output/work/apk_build"
OUT_APK="$ROOT_DIR/app/static/voxeye.apk"

rm -rf "$WORK_DIR"
mkdir -p "$WORK_DIR/src/ai/voxeye/assistant" "$WORK_DIR/res/drawable" "$WORK_DIR/res/values" "$WORK_DIR/classes"

cp "$ROOT_DIR/app/static/icon-192.png" "$WORK_DIR/res/drawable/ic_launcher.png"

cat > "$WORK_DIR/res/values/strings.xml" << 'EOF'
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">VoxEye</string>
</resources>
EOF

cat > "$WORK_DIR/AndroidManifest.xml" << 'EOF'
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="ai.voxeye.assistant"
    android:versionCode="18"
    android:versionName="1.8.0">

    <uses-sdk android:minSdkVersion="26" android:targetSdkVersion="34" />

    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.CAMERA" />
    <uses-permission android:name="android.permission.RECORD_AUDIO" />
    <uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
    <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
    <uses-permission android:name="android.permission.VIBRATE" />

    <uses-feature android:name="android.hardware.camera" android:required="false" />
    <uses-feature android:name="android.hardware.microphone" android:required="false" />

    <application
        android:label="@string/app_name"
        android:icon="@drawable/ic_launcher"
        android:usesCleartextTraffic="true"
        android:hardwareAccelerated="true"
        android:theme="@android:style/Theme.DeviceDefault.NoActionBar">

        <activity
            android:name="ai.voxeye.assistant.MainActivity"
            android:exported="true"
            android:configChanges="orientation|screenSize|keyboardHidden"
            android:launchMode="singleTask">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
            <intent-filter>
                <action android:name="android.intent.action.ASSIST" />
                <action android:name="android.intent.action.VOICE_COMMAND" />
                <category android:name="android.intent.category.DEFAULT" />
            </intent-filter>
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="voxeye" android:host="open" />
            </intent-filter>
        </activity>
    </application>
</manifest>
EOF

cat > "$WORK_DIR/src/ai/voxeye/assistant/MainActivity.java" << 'EOF'
package ai.voxeye.assistant;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.GeolocationPermissions;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;

public class MainActivity extends Activity {
    private static final String PREFS = "voxeye_prefs";
    private static final String KEY_URL = "server_url";
    private static final String DEFAULT_URL = "http://10.0.2.2:8000/app";
    private WebView webView;
    private boolean volHeld = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        requestRuntimePermissions();

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#05040f"));

        webView = new WebView(this);
        WebSettings ws = webView.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setMediaPlaybackRequiresUserGesture(false);
        ws.setGeolocationEnabled(true);
        ws.setAllowFileAccess(true);

        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        request.grant(request.getResources());
                    }
                });
            }

            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                callback.invoke(origin, true, false);
            }
        });

        root.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));

        Button cfgBtn = new Button(this);
        cfgBtn.setText("Server URL");
        cfgBtn.setTextSize(11f);
        cfgBtn.setTextColor(Color.parseColor("#f2ead8"));
        cfgBtn.setBackgroundColor(Color.parseColor("#2a2420"));
        cfgBtn.setContentDescription("Configure VoxEye Server URL");
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
                Gravity.TOP | Gravity.END);
        lp.setMargins(16, 16, 16, 16);
        cfgBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                promptServerUrl();
            }
        });
        root.addView(cfgBtn, lp);

        setContentView(root);

        String targetUrl = getSavedUrl();
        Intent intent = getIntent();
        if (intent != null && intent.getData() != null) {
            Uri data = intent.getData();
            String qUrl = data.getQueryParameter("url");
            if (qUrl != null && !qUrl.isEmpty()) {
                saveUrl(qUrl);
                targetUrl = qUrl;
            }
        }
        webView.loadUrl(targetUrl);
    }

    private void requestRuntimePermissions() {
        String[] perms = new String[]{
                Manifest.permission.CAMERA,
                Manifest.permission.RECORD_AUDIO,
                Manifest.permission.ACCESS_FINE_LOCATION
        };
        boolean need = false;
        for (String p : perms) {
            if (checkSelfPermission(p) != PackageManager.PERMISSION_GRANTED) {
                need = true;
                break;
            }
        }
        if (need) {
            requestPermissions(perms, 101);
        }
    }

    private String getSavedUrl() {
        SharedPreferences sp = getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        return sp.getString(KEY_URL, DEFAULT_URL);
    }

    private void saveUrl(String url) {
        SharedPreferences sp = getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        sp.edit().putString(KEY_URL, url).apply();
    }

    private void promptServerUrl() {
        final EditText input = new EditText(this);
        input.setText(getSavedUrl());
        input.setSelection(input.getText().length());
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(48, 24, 48, 12);
        box.addView(input);

        new AlertDialog.Builder(this)
                .setTitle("VoxEye Server URL")
                .setMessage("Enter your VoxEye WebApp URL (e.g. https://your-tunnel.trycloudflare.com/app or http://192.168.1.x:8000/app):")
                .setView(box)
                .setPositiveButton("Connect", new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface dialog, int which) {
                        String u = input.getText().toString().trim();
                        if (!u.isEmpty()) {
                            saveUrl(u);
                            webView.loadUrl(u);
                        }
                    }
                })
                .setNegativeButton("Cancel", null)
                .show();
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_VOLUME_DOWN || keyCode == KeyEvent.KEYCODE_VOLUME_UP) {
            if (!volHeld && webView != null) {
                volHeld = true;
                webView.evaluateJavascript("window.dispatchEvent(new KeyboardEvent('keydown', {code:'Space', key:' '}));", null);
            }
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    public boolean onKeyUp(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_VOLUME_DOWN || keyCode == KeyEvent.KEYCODE_VOLUME_UP) {
            volHeld = false;
            if (webView != null) {
                webView.evaluateJavascript("window.dispatchEvent(new KeyboardEvent('keyup', {code:'Space', key:' '}));", null);
            }
            return true;
        }
        return super.onKeyUp(keyCode, event);
    }
}
EOF

echo "[1/5] Compiling Android resources with aapt2..."
"$BUILD_TOOLS/aapt2" compile --dir "$WORK_DIR/res" -o "$WORK_DIR/res.zip"
"$BUILD_TOOLS/aapt2" link \
    -I "$PLATFORM" \
    --manifest "$WORK_DIR/AndroidManifest.xml" \
    --java "$WORK_DIR/src" \
    -o "$WORK_DIR/unaligned.apk" \
    "$WORK_DIR/res.zip"

echo "[2/5] Compiling Java sources with javac..."
"$JAVAC" --release 11 \
    -cp "$PLATFORM" \
    -d "$WORK_DIR/classes" \
    "$WORK_DIR/src/ai/voxeye/assistant/R.java" \
    "$WORK_DIR/src/ai/voxeye/assistant/MainActivity.java"

echo "[3/5] Converting bytecode to DEX with d8..."
export JAVA_HOME="/opt/homebrew/opt/openjdk@21"
export PATH="$JAVA_HOME/bin:$PATH"
"$BUILD_TOOLS/d8" --lib "$PLATFORM" --output "$WORK_DIR" "$WORK_DIR"/classes/ai/voxeye/assistant/*.class

echo "[4/5] Packaging classes.dex & aligning APK..."
(cd "$WORK_DIR" && zip -q -u unaligned.apk classes.dex)
"$BUILD_TOOLS/zipalign" -f 4 "$WORK_DIR/unaligned.apk" "$WORK_DIR/aligned.apk"

echo "[5/5] Signing APK with apksigner..."
KEYSTORE="$WORK_DIR/debug.keystore"
"$KEYTOOL" -genkeypair -v \
    -keystore "$KEYSTORE" \
    -storepass android \
    -keypass android \
    -alias androiddebugkey \
    -keyalg RSA \
    -keysize 2048 \
    -validity 10000 \
    -dname "CN=VoxEye Athens,OU=GenAISummit2026,O=VoxEye,L=Athens,ST=Attica,C=GR" >/dev/null 2>&1

"$BUILD_TOOLS/apksigner" sign \
    --ks "$KEYSTORE" \
    --ks-pass pass:android \
    --key-pass pass:android \
    --out "$OUT_APK" \
    "$WORK_DIR/aligned.apk"

"$BUILD_TOOLS/apksigner" verify "$OUT_APK"
ls -lh "$OUT_APK"
shasum -a 256 "$OUT_APK"
echo "Successfully built and verified signed APK at $OUT_APK"
