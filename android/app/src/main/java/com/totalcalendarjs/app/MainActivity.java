package com.totalcalendarjs.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.media.AudioAttributes;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.speech.tts.TextToSpeech;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.JsResult;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.Locale;

public final class MainActivity extends Activity implements TextToSpeech.OnInitListener {
    private static final int FILE_CHOOSER_REQUEST_CODE = 42;
    private static final int SAVE_FILE_REQUEST_CODE = 43;
    private static final int NOTIFICATION_PERMISSION_REQUEST_CODE = 44;
    private static final int TRAINING_NOTIFICATION_ID = 1001;
    private static final String TRAINING_NOTIFICATION_CHANNEL_ID = "training_status";
    private static final int MAX_PENDING_SPEECH_ITEMS = 20;

    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;
    private String pendingSaveFileText;
    private TextToSpeech textToSpeech;
    private PowerManager.WakeLock trainingWakeLock;
    private PowerManager.WakeLock trainingScreenWakeLock;
    private boolean trainingGuardActive;
    private boolean noSoundMode;
    private boolean textToSpeechReady;
    private final ArrayDeque<SpeechRequest> pendingSpeech = new ArrayDeque<>();

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        textToSpeech = new TextToSpeech(this, this);
        createTrainingNotificationChannel();
        webView = new WebView(this);
        setContentView(webView);

        configureWebView();
        webView.addJavascriptInterface(new TrainingBridge(), "AndroidTraining");

        if (savedInstanceState == null) {
            webView.loadUrl("file:///android_asset/index.html");
        } else {
            webView.restoreState(savedInstanceState);
        }
    }

    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setAllowFileAccessFromFileURLs(true);
        settings.setAllowUniversalAccessFromFileURLs(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            settings.setSafeBrowsingEnabled(true);
        }

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("http".equals(uri.getScheme()) || "https".equals(uri.getScheme()) || "file".equals(uri.getScheme())) {
                    return false;
                }

                openExternalUri(uri);
                return true;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(
                    WebView view,
                    ValueCallback<Uri[]> callback,
                    FileChooserParams fileChooserParams
            ) {
                if (filePathCallback != null) {
                    filePathCallback.onReceiveValue(null);
                }

                filePathCallback = callback;
                try {
                    startActivityForResult(fileChooserParams.createIntent(), FILE_CHOOSER_REQUEST_CODE);
                    return true;
                } catch (ActivityNotFoundException exception) {
                    filePathCallback = null;
                    return false;
                }
            }

            @Override
            public boolean onJsAlert(WebView view, String url, String message, JsResult result) {
                new AlertDialog.Builder(MainActivity.this)
                        .setMessage(message)
                        .setPositiveButton(android.R.string.ok, (dialog, which) -> result.confirm())
                        .setOnCancelListener(dialog -> result.cancel())
                        .show();
                return true;
            }

            @Override
            public void onCloseWindow(WebView window) {
                stopSpeechAndFinishOnUiThread();
            }
        });
    }

    private void openExternalUri(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException ignored) {
            // If Android has no handler for the scheme, keep the user inside the app.
        }
    }

    private void saveTextFileOnUiThread(String text, String filename, String mimeType) {
        pendingSaveFileText = text == null ? "" : text;

        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(normalizeMimeType(mimeType));
        intent.putExtra(Intent.EXTRA_TITLE, sanitizeFilename(filename));

        try {
            startActivityForResult(intent, SAVE_FILE_REQUEST_CODE);
        } catch (ActivityNotFoundException exception) {
            pendingSaveFileText = null;
            new AlertDialog.Builder(this)
                    .setMessage("Не удалось открыть диалог сохранения файла.")
                    .setPositiveButton(android.R.string.ok, null)
                    .show();
        }
    }

    private String normalizeMimeType(String mimeType) {
        if (mimeType == null || mimeType.trim().isEmpty()) {
            return "text/plain";
        }

        return mimeType;
    }

    private String sanitizeFilename(String filename) {
        if (filename == null || filename.trim().isEmpty()) {
            return "TotalCalendar.txt";
        }

        return filename.replaceAll("[\\\\/:*?\"<>|]", "_");
    }

    private void writePendingSaveFile(Uri uri) {
        if (uri == null || pendingSaveFileText == null) {
            pendingSaveFileText = null;
            return;
        }

        try (OutputStream outputStream = getContentResolver().openOutputStream(uri)) {
            if (outputStream == null) {
                throw new IOException("Output stream is unavailable");
            }
            outputStream.write(pendingSaveFileText.getBytes(StandardCharsets.UTF_8));
        } catch (IOException exception) {
            new AlertDialog.Builder(this)
                    .setMessage("Не удалось сохранить файл: " + exception.getMessage())
                    .setPositiveButton(android.R.string.ok, null)
                    .show();
        } finally {
            pendingSaveFileText = null;
        }
    }

    @Override
    public void onInit(int status) {
        if (status != TextToSpeech.SUCCESS || textToSpeech == null) {
            pendingSpeech.clear();
            return;
        }

        int languageStatus = textToSpeech.setLanguage(new Locale("ru"));
        if (languageStatus == TextToSpeech.LANG_MISSING_DATA || languageStatus == TextToSpeech.LANG_NOT_SUPPORTED) {
            textToSpeech.setLanguage(Locale.getDefault());
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            textToSpeech.setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build());
        }

        textToSpeechReady = true;
        while (!pendingSpeech.isEmpty()) {
            SpeechRequest request = pendingSpeech.removeFirst();
            speakOnUiThread(request.text, request.rate);
        }
    }

    private void speakOnUiThread(String text, float rate) {
        if (text == null || text.trim().isEmpty()) {
            return;
        }

        if (!textToSpeechReady || textToSpeech == null) {
            if (pendingSpeech.size() >= MAX_PENDING_SPEECH_ITEMS) {
                pendingSpeech.removeFirst();
            }
            pendingSpeech.addLast(new SpeechRequest(text, rate));
            return;
        }

        textToSpeech.setSpeechRate(rate);
        textToSpeech.speak(text, TextToSpeech.QUEUE_ADD, null, "training-" + System.nanoTime());
    }

    private void stopSpeechOnUiThread() {
        pendingSpeech.clear();
        if (textToSpeech != null) {
            textToSpeech.stop();
        }
    }

    private void startTrainingGuardOnUiThread() {
        trainingGuardActive = true;
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        acquireTrainingWakeLock();
        updateTrainingScreenWakeLock();
        showTrainingNotification();
    }

    private void stopTrainingGuardOnUiThread() {
        trainingGuardActive = false;
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        releaseTrainingScreenWakeLock();
        releaseTrainingWakeLock();
        hideTrainingNotification();
        stopSpeechOnUiThread();
    }

    private void setNoSoundModeOnUiThread(boolean enabled) {
        noSoundMode = enabled;
        updateTrainingScreenWakeLock();
    }

    private void stopSpeechAndFinishOnUiThread() {
        trainingGuardActive = false;
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        releaseTrainingScreenWakeLock();
        releaseTrainingWakeLock();
        hideTrainingNotification();
        stopSpeechOnUiThread();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            finishAndRemoveTask();
        } else {
            finish();
        }
    }

    private float normalizeSpeechRate(double rate) {
        if (Double.isNaN(rate) || Double.isInfinite(rate) || rate <= 0) {
            return 1.0f;
        }
        return Math.max(0.1f, Math.min((float) rate, 3.0f));
    }

    private void acquireTrainingWakeLock() {
        if (trainingWakeLock == null) {
            PowerManager powerManager = (PowerManager) getSystemService(POWER_SERVICE);
            if (powerManager == null) {
                return;
            }
            trainingWakeLock = powerManager.newWakeLock(
                    PowerManager.PARTIAL_WAKE_LOCK,
                    "TotalCalendar:TrainingAudio"
            );
            trainingWakeLock.setReferenceCounted(false);
        }

        if (!trainingWakeLock.isHeld()) {
            trainingWakeLock.acquire();
        }
    }

    private void releaseTrainingWakeLock() {
        if (trainingWakeLock != null && trainingWakeLock.isHeld()) {
            trainingWakeLock.release();
        }
    }

    private void updateTrainingScreenWakeLock() {
        if (trainingGuardActive && noSoundMode) {
            acquireTrainingScreenWakeLock();
        } else {
            releaseTrainingScreenWakeLock();
        }
    }

    private void acquireTrainingScreenWakeLock() {
        if (trainingScreenWakeLock == null) {
            PowerManager powerManager = (PowerManager) getSystemService(POWER_SERVICE);
            if (powerManager == null) {
                return;
            }
            trainingScreenWakeLock = powerManager.newWakeLock(
                    PowerManager.SCREEN_BRIGHT_WAKE_LOCK,
                    "TotalCalendar:NoSoundScreen"
            );
            trainingScreenWakeLock.setReferenceCounted(false);
        }

        if (!trainingScreenWakeLock.isHeld()) {
            trainingScreenWakeLock.acquire();
        }
    }

    private void releaseTrainingScreenWakeLock() {
        if (trainingScreenWakeLock != null && trainingScreenWakeLock.isHeld()) {
            trainingScreenWakeLock.release();
        }
    }

    private void createTrainingNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }

        NotificationChannel channel = new NotificationChannel(
                TRAINING_NOTIFICATION_CHANNEL_ID,
                "Тренировка",
                NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("Показывает активную тренировку в шторке уведомлений.");

        NotificationManager notificationManager = getSystemService(NotificationManager.class);
        if (notificationManager != null) {
            notificationManager.createNotificationChannel(channel);
        }
    }

    private boolean canPostTrainingNotification() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
                || checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
    }

    private void requestTrainingNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && !canPostTrainingNotification()) {
            requestPermissions(
                    new String[]{android.Manifest.permission.POST_NOTIFICATIONS},
                    NOTIFICATION_PERMISSION_REQUEST_CODE
            );
        }
    }

    private void showTrainingNotification() {
        if (!canPostTrainingNotification()) {
            requestTrainingNotificationPermissionIfNeeded();
            return;
        }

        Intent intent = new Intent(this, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);

        PendingIntent pendingIntent = PendingIntent.getActivity(
                this,
                0,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(this, TRAINING_NOTIFICATION_CHANNEL_ID)
                : new Notification.Builder(this);

        Notification notification = builder
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle("Календарь тренировок")
                .setContentText("Тренировка идет. Звук активен.")
                .setContentIntent(pendingIntent)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setShowWhen(false)
                .setCategory(Notification.CATEGORY_STATUS)
                .setPriority(Notification.PRIORITY_LOW)
                .build();

        NotificationManager notificationManager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (notificationManager != null) {
            notificationManager.notify(TRAINING_NOTIFICATION_ID, notification);
        }
    }

    private void hideTrainingNotification() {
        NotificationManager notificationManager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (notificationManager != null) {
            notificationManager.cancel(TRAINING_NOTIFICATION_ID);
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == SAVE_FILE_REQUEST_CODE) {
            if (resultCode == RESULT_OK && data != null) {
                writePendingSaveFile(data.getData());
            } else {
                pendingSaveFileText = null;
            }
            return;
        }

        if (requestCode != FILE_CHOOSER_REQUEST_CODE || filePathCallback == null) {
            return;
        }

        Uri[] results = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
        filePathCallback.onReceiveValue(results);
        filePathCallback = null;
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == NOTIFICATION_PERMISSION_REQUEST_CODE
                && grantResults.length > 0
                && grantResults[0] == PackageManager.PERMISSION_GRANTED
                && trainingWakeLock != null
                && trainingWakeLock.isHeld()) {
            showTrainingNotification();
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        trainingGuardActive = false;
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        releaseTrainingScreenWakeLock();
        releaseTrainingWakeLock();
        hideTrainingNotification();

        if (filePathCallback != null) {
            filePathCallback.onReceiveValue(null);
            filePathCallback = null;
        }
        pendingSaveFileText = null;

        if (webView != null) {
            webView.removeJavascriptInterface("AndroidTraining");
            webView.destroy();
            webView = null;
        }

        if (textToSpeech != null) {
            textToSpeech.stop();
            textToSpeech.shutdown();
            textToSpeech = null;
        }

        super.onDestroy();
    }

    public final class TrainingBridge {
        @JavascriptInterface
        public void startTrainingGuard() {
            runOnUiThread(() -> startTrainingGuardOnUiThread());
        }

        @JavascriptInterface
        public void stopTrainingGuard() {
            runOnUiThread(() -> stopTrainingGuardOnUiThread());
        }

        @JavascriptInterface
        public void stopSpeech() {
            runOnUiThread(() -> stopSpeechOnUiThread());
        }

        @JavascriptInterface
        public void setNoSoundMode(boolean enabled) {
            runOnUiThread(() -> setNoSoundModeOnUiThread(enabled));
        }

        @JavascriptInterface
        public void saveTextFile(String text, String filename, String mimeType) {
            runOnUiThread(() -> saveTextFileOnUiThread(text, filename, mimeType));
        }

        @JavascriptInterface
        public void exitApp() {
            runOnUiThread(() -> stopSpeechAndFinishOnUiThread());
        }

        @JavascriptInterface
        public void speak(String text, double rate) {
            runOnUiThread(() -> speakOnUiThread(text, normalizeSpeechRate(rate)));
        }
    }

    private static final class SpeechRequest {
        private final String text;
        private final float rate;

        private SpeechRequest(String text, float rate) {
            this.text = text;
            this.rate = rate;
        }
    }
}
