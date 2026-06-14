package com.totalcalendarjs.app;

import android.annotation.SuppressLint;
import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ActivityNotFoundException;
import android.content.BroadcastReceiver;
import android.content.ComponentCallbacks2;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.os.BatteryManager;
import android.net.Uri;
import android.media.AudioAttributes;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.speech.tts.TextToSpeech;
import android.view.WindowManager;
import android.text.InputType;
import android.widget.EditText;
import android.widget.Toast;
import android.content.SharedPreferences;
import android.webkit.JavascriptInterface;
import android.webkit.JsResult;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.Locale;

public final class MainActivity extends Activity implements TextToSpeech.OnInitListener {
    private static final int FILE_CHOOSER_REQUEST_CODE = 42;
    private static final int SAVE_FILE_REQUEST_CODE = 43;
    private static final int NOTIFICATION_PERMISSION_REQUEST_CODE = 44;
    private static final int HEART_RATE_BLE_PERMISSION_REQUEST_CODE = 56;
    private static final int TRAINING_NOTIFICATION_ID = 1001;
    private static final String TRAINING_NOTIFICATION_CHANNEL_ID = "training_status";
    private static final int MAX_PENDING_SPEECH_ITEMS = 20;
    private static final String PREFS_TCJS = "tcjs_prefs";
    private static final String PREF_EXPORT_EMAIL = "export_email";

    private WebView webView;
    private WebView printWebView;
    private ValueCallback<Uri[]> filePathCallback;
    private String pendingSaveFileText;
    private String pendingSaveFileFilename;
    private boolean pendingSaveOfferEmail;
    private TextToSpeech textToSpeech;
    private PowerManager.WakeLock trainingWakeLock;
    private PowerManager.WakeLock trainingScreenWakeLock;
    private boolean trainingGuardActive;
    private boolean noSoundMode;
    private boolean textToSpeechReady;
    private final ArrayDeque<SpeechRequest> pendingSpeech = new ArrayDeque<>();
    private HeartRateBleManager heartRateBleManager;
    private boolean pendingHeartRateScanAfterPermission;
    private BroadcastReceiver batteryEmergencyReceiver;
    private long lastBatteryPercentFlushMs;

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

        heartRateBleManager = new HeartRateBleManager(this, new HeartRateBleManager.Listener() {
            @Override
            public void onHeartRateBpm(int bpm) {
                if (!trainingGuardActive) {
                    return;
                }
                deliverHeartRateBpmToWeb(bpm);
            }

            @Override
            public void onSensorDisconnected() {
                deliverHeartRateBpmToWeb(-1);
            }
        });

        registerBatteryEmergencyReceiver();

        if (savedInstanceState == null) {
            webView.loadUrl(getLaunchUrl(getIntent()));
        } else {
            webView.restoreState(savedInstanceState);
        }
    }

    private void registerBatteryEmergencyReceiver() {
        if (batteryEmergencyReceiver != null) {
            return;
        }
        batteryEmergencyReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (intent == null || !trainingGuardActive) {
                    return;
                }
                String action = intent.getAction();
                if (Intent.ACTION_BATTERY_LOW.equals(action)) {
                    flushWebLastTrainingCheckpoint("battery_low");
                    return;
                }
                if (!Intent.ACTION_BATTERY_CHANGED.equals(action)) {
                    return;
                }
                int level = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
                int scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, -1);
                if (level < 0 || scale <= 0) {
                    return;
                }
                float pct = level / (float) scale;
                long now = System.currentTimeMillis();
                if (pct <= 0.05f) {
                    if (now - lastBatteryPercentFlushMs >= 15000L) {
                        lastBatteryPercentFlushMs = now;
                        flushWebLastTrainingCheckpoint("battery_critical");
                    }
                } else if (pct <= 0.12f && now - lastBatteryPercentFlushMs >= 60000L) {
                    lastBatteryPercentFlushMs = now;
                    flushWebLastTrainingCheckpoint("battery_12pct");
                }
            }
        };
        IntentFilter filter = new IntentFilter();
        filter.addAction(Intent.ACTION_BATTERY_LOW);
        filter.addAction(Intent.ACTION_BATTERY_CHANGED);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(batteryEmergencyReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(batteryEmergencyReceiver, filter);
        }
    }

    private void unregisterBatteryEmergencyReceiver() {
        if (batteryEmergencyReceiver == null) {
            return;
        }
        try {
            unregisterReceiver(batteryEmergencyReceiver);
        } catch (IllegalArgumentException ignored) {
        }
        batteryEmergencyReceiver = null;
    }

    private String getLaunchUrl(Intent intent) {
        Uri data = intent == null ? null : intent.getData();
        if (data == null || !"totalcalendarjs".equals(data.getScheme())) {
            return "file:///android_asset/index.html";
        }

        String query = data.getEncodedQuery();
        if (query == null || query.isEmpty()) {
            return "file:///android_asset/index.html";
        }

        return "file:///android_asset/index.html?" + query;
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

    private void saveTextFileOnUiThread(String text, String filename, String mimeType, boolean offerEmailAfterSave) {
        pendingSaveFileText = text == null ? "" : text;
        pendingSaveFileFilename = sanitizeFilename(filename);
        pendingSaveOfferEmail = offerEmailAfterSave;

        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(normalizeMimeType(mimeType));
        intent.putExtra(Intent.EXTRA_TITLE, sanitizeFilename(filename));

        try {
            startActivityForResult(intent, SAVE_FILE_REQUEST_CODE);
        } catch (ActivityNotFoundException exception) {
            pendingSaveFileText = null;
            pendingSaveFileFilename = null;
            pendingSaveOfferEmail = false;
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
            pendingSaveFileFilename = null;
            pendingSaveOfferEmail = false;
            return;
        }

        String savedFilename = pendingSaveFileFilename;
        boolean offerEmail = pendingSaveOfferEmail;
        boolean success = false;
        try (OutputStream outputStream = getContentResolver().openOutputStream(uri)) {
            if (outputStream == null) {
                throw new IOException("Output stream is unavailable");
            }
            outputStream.write(pendingSaveFileText.getBytes(StandardCharsets.UTF_8));
            success = true;
        } catch (IOException exception) {
            new AlertDialog.Builder(this)
                    .setMessage("Не удалось сохранить файл: " + exception.getMessage())
                    .setPositiveButton(android.R.string.ok, null)
                    .show();
        } finally {
            pendingSaveFileText = null;
            pendingSaveFileFilename = null;
            pendingSaveOfferEmail = false;
        }
        if (success && offerEmail) {
            offerEmailShareForSavedFile(uri, savedFilename);
        }
    }

    private SharedPreferences tcjsPrefs() {
        return getSharedPreferences(PREFS_TCJS, MODE_PRIVATE);
    }

    private void offerEmailShareForSavedFile(Uri uri, String filename) {
        String displayName = filename == null || filename.trim().isEmpty()
                ? "файл"
                : filename;
        new AlertDialog.Builder(this)
                .setMessage("Отправить файл «" + displayName + "» по электронной почте?")
                .setPositiveButton("Да", (dialog, which) -> promptEmailAndShare(uri, displayName))
                .setNegativeButton("Нет", null)
                .show();
    }

    private void promptEmailAndShare(Uri uri, String filename) {
        EditText input = new EditText(this);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS);
        input.setText(tcjsPrefs().getString(PREF_EXPORT_EMAIL, ""));
        new AlertDialog.Builder(this)
                .setTitle("Адрес e-mail получателя")
                .setView(input)
                .setPositiveButton("Отправить", (dialog, which) -> {
                    String email = input.getText().toString().trim();
                    if (!isValidExportEmail(email)) {
                        new AlertDialog.Builder(this)
                                .setMessage("Некорректный адрес e-mail.")
                                .setPositiveButton(android.R.string.ok, null)
                                .show();
                        return;
                    }
                    tcjsPrefs().edit().putString(PREF_EXPORT_EMAIL, email).apply();
                    shareFileViaEmail(uri, filename, email);
                })
                .setNegativeButton("Отмена", null)
                .show();
    }

    private boolean isValidExportEmail(String email) {
        return email != null && email.matches("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$");
    }

    private void shareFileViaEmail(Uri uri, String filename, String email) {
        Intent intent = new Intent(Intent.ACTION_SEND);
        intent.setType("*/*");
        intent.putExtra(Intent.EXTRA_EMAIL, new String[]{email});
        intent.putExtra(Intent.EXTRA_SUBJECT, "Total Calendar: " + filename);
        intent.putExtra(Intent.EXTRA_STREAM, uri);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try {
            startActivity(Intent.createChooser(intent, "Отправить по почте"));
        } catch (ActivityNotFoundException exception) {
            new AlertDialog.Builder(this)
                    .setMessage("Не найдено приложение для отправки почты.")
                    .setPositiveButton(android.R.string.ok, null)
                    .show();
        }
    }

    private void openCalendarIcsOnUiThread(String text, String filename) {
        if (text == null || text.trim().isEmpty()) {
            return;
        }

        try {
            File directory = CalendarIcsProvider.getCalendarCacheDirectory(this);
            File file = new File(directory, sanitizeFilename(filename));
            try (OutputStream outputStream = new FileOutputStream(file)) {
                outputStream.write(text.getBytes(StandardCharsets.UTF_8));
            }

            Uri uri = CalendarIcsProvider.getUriForFile(file);
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, "text/calendar");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            startActivity(Intent.createChooser(intent, "Открыть в календаре"));
        } catch (IOException | ActivityNotFoundException exception) {
            new AlertDialog.Builder(this)
                    .setMessage("Не удалось открыть календарь для импорта ICS: " + exception.getMessage())
                    .setPositiveButton(android.R.string.ok, null)
                    .show();
        }
    }

    private void printTextOnUiThread(String text, String title) {
        if (text == null || text.trim().isEmpty()) {
            return;
        }

        PrintManager printManager = (PrintManager) getSystemService(PRINT_SERVICE);
        if (printManager == null) {
            new AlertDialog.Builder(this)
                    .setMessage("Не удалось открыть печать на этом устройстве.")
                    .setPositiveButton(android.R.string.ok, null)
                    .show();
            return;
        }

        if (printWebView != null) {
            printWebView.destroy();
        }

        String printTitle = normalizePrintTitle(title);
        printWebView = new WebView(this);
        printWebView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                PrintDocumentAdapter adapter = view.createPrintDocumentAdapter(printTitle);
                PrintAttributes attributes = new PrintAttributes.Builder()
                        .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                        .setColorMode(PrintAttributes.COLOR_MODE_MONOCHROME)
                        .build();
                printManager.print(printTitle, adapter, attributes);
            }
        });

        String html = "<!doctype html><html><head><meta charset=\"utf-8\">"
                + "<style>body{font-family:sans-serif;margin:24px;}pre{white-space:pre-wrap;font-size:16px;line-height:1.45;}</style>"
                + "</head><body><pre>"
                + escapeHtml(text)
                + "</pre></body></html>";
        printWebView.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
    }

    private String normalizePrintTitle(String title) {
        if (title == null || title.trim().isEmpty()) {
            return "Текст тренировки";
        }

        return title;
    }

    private String escapeHtml(String text) {
        return text
                .replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
                .replace("\"", "&quot;")
                .replace("'", "&#39;");
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

    private void restartAppOnUiThread() {
        trainingGuardActive = false;
        noSoundMode = false;
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        releaseTrainingScreenWakeLock();
        releaseTrainingWakeLock();
        hideTrainingNotification();
        stopSpeechOnUiThread();

        Intent intent = new Intent(this, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_CLEAR_TASK | Intent.FLAG_ACTIVITY_NEW_TASK);
        startActivity(intent);
        finish();
        overridePendingTransition(0, 0);
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

    /** Экран и CPU не засыпают на всё время тренировки (не только в режиме «без звука»). */
    private void updateTrainingScreenWakeLock() {
        if (trainingGuardActive) {
            acquireTrainingScreenWakeLock();
        } else {
            releaseTrainingScreenWakeLock();
        }
    }

    @SuppressLint({"WakelockTimeout", "InvalidWakeLockTag"})
    private void acquireTrainingScreenWakeLock() {
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        }
        if (trainingScreenWakeLock == null) {
            PowerManager powerManager = (PowerManager) getSystemService(POWER_SERVICE);
            if (powerManager == null) {
                return;
            }
            trainingScreenWakeLock = powerManager.newWakeLock(
                    PowerManager.SCREEN_BRIGHT_WAKE_LOCK | PowerManager.ACQUIRE_CAUSES_WAKEUP,
                    "TotalCalendar:TrainingScreen"
            );
            trainingScreenWakeLock.setReferenceCounted(false);
        }

        if (!trainingScreenWakeLock.isHeld()) {
            trainingScreenWakeLock.acquire();
        }
    }

    private void releaseTrainingScreenWakeLock() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(false);
            setTurnScreenOn(false);
        }
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
        intent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);

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
                pendingSaveFileFilename = null;
                pendingSaveOfferEmail = false;
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
            return;
        }

        if (requestCode == HEART_RATE_BLE_PERMISSION_REQUEST_CODE) {
            boolean wanted = pendingHeartRateScanAfterPermission;
            pendingHeartRateScanAfterPermission = false;
            if (wanted && heartRateBleManager != null && allPermissionsGranted(grantResults)) {
                heartRateBleManager.startScanAndPickDevice();
            }
        }
    }

    private static boolean allPermissionsGranted(int[] grantResults) {
        if (grantResults == null || grantResults.length == 0) {
            return false;
        }
        for (int result : grantResults) {
            if (result != PackageManager.PERMISSION_GRANTED) {
                return false;
            }
        }
        return true;
    }

    private void deliverHeartRateBpmToWeb(int bpm) {
        if (webView == null) {
            return;
        }

        webView.evaluateJavascript(
                "try{if(typeof onAndroidHeartRate==='function'){onAndroidHeartRate(" + bpm + ");}}catch(e){}",
                null
        );
    }

    private boolean hasBluetoothPermissionsForHeartRate() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            return checkSelfPermission(Manifest.permission.BLUETOOTH_SCAN) == PackageManager.PERMISSION_GRANTED
                    && checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
        }
        return true;
    }

    private void requestHeartRateSensorFlow() {
        if (heartRateBleManager == null) {
            return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (!hasBluetoothPermissionsForHeartRate()) {
                pendingHeartRateScanAfterPermission = true;
                requestPermissions(
                        new String[]{
                                Manifest.permission.BLUETOOTH_SCAN,
                                Manifest.permission.BLUETOOTH_CONNECT
                        },
                        HEART_RATE_BLE_PERMISSION_REQUEST_CODE
                );
                return;
            }
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            if (!hasBluetoothPermissionsForHeartRate()) {
                pendingHeartRateScanAfterPermission = true;
                requestPermissions(
                        new String[]{Manifest.permission.ACCESS_FINE_LOCATION},
                        HEART_RATE_BLE_PERMISSION_REQUEST_CODE
                );
                return;
            }
        }

        pendingHeartRateScanAfterPermission = false;
        heartRateBleManager.startScanAndPickDevice();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        flushWebLastTrainingCheckpoint("save_state");
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    @Override
    public void onLowMemory() {
        flushWebLastTrainingCheckpoint("low_memory");
        super.onLowMemory();
    }

    @Override
    public void onTrimMemory(int level) {
        if (level >= ComponentCallbacks2.TRIM_MEMORY_RUNNING_CRITICAL
                || level == ComponentCallbacks2.TRIM_MEMORY_COMPLETE) {
            flushWebLastTrainingCheckpoint("trim_memory");
        }
        super.onTrimMemory(level);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);

        Uri data = intent == null ? null : intent.getData();
        if (data != null && "totalcalendarjs".equals(data.getScheme())) {
            if (webView != null) {
                webView.loadUrl(getLaunchUrl(intent));
            }
            return;
        }

        if (trainingGuardActive) {
            startTrainingGuardOnUiThread();
        }
    }

    @Override
    protected void onPause() {
        flushWebLastTrainingCheckpoint("android_pause");
        super.onPause();
    }

    @Override
    protected void onStop() {
        flushWebLastTrainingCheckpoint("android_stop");
        super.onStop();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (trainingGuardActive) {
            startTrainingGuardOnUiThread();
        }
    }

    private void flushWebLastTrainingCheckpoint(String reason) {
        if (!trainingGuardActive || webView == null) {
            return;
        }
        String r = reason != null ? reason : "android";
        r = r.replace("\\", "\\\\").replace("'", "\\'");
        String js = "try{if(typeof flushAutoSaveLastTrainingCheckpoint==='function')"
                + "flushAutoSaveLastTrainingCheckpoint('" + r + "');}catch(e){}";
        webView.post(() -> webView.evaluateJavascript(js, null));
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
        flushWebLastTrainingCheckpoint("android_destroy");
        unregisterBatteryEmergencyReceiver();
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
        pendingSaveFileFilename = null;
        pendingSaveOfferEmail = false;

        if (heartRateBleManager != null) {
            heartRateBleManager.destroy();
            heartRateBleManager = null;
        }

        if (webView != null) {
            webView.removeJavascriptInterface("AndroidTraining");
            webView.destroy();
            webView = null;
        }

        if (printWebView != null) {
            printWebView.destroy();
            printWebView = null;
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
            runOnUiThread(() -> saveTextFileOnUiThread(text, filename, mimeType, false));
        }

        @JavascriptInterface
        public void saveTextFileWithEmailOffer(String text, String filename, String mimeType) {
            runOnUiThread(() -> saveTextFileOnUiThread(text, filename, mimeType, true));
        }

        /** Чекпоинты тренировки — без диалога «Сохранить как», в training-checkpoints/. */
        @JavascriptInterface
        public boolean saveTextFileInternal(String text, String filename, String mimeType, boolean showToast) {
            try {
                final File saved = TrainingFilesStorage.saveText(MainActivity.this, text, filename);
                if (showToast) {
                    runOnUiThread(() -> Toast.makeText(
                            MainActivity.this,
                            "Сохранено в папку приложения:\n" + saved.getName(),
                            Toast.LENGTH_SHORT
                    ).show());
                }
                return true;
            } catch (IOException exception) {
                final String message = exception.getMessage();
                runOnUiThread(() -> new AlertDialog.Builder(MainActivity.this)
                        .setMessage("Не удалось сохранить файл: " + message)
                        .setPositiveButton(android.R.string.ok, null)
                        .show());
                return false;
            }
        }

        @JavascriptInterface
        public boolean deleteCheckpointFile(String filename) {
            try {
                return TrainingFilesStorage.deleteText(MainActivity.this, filename);
            } catch (Exception exception) {
                return false;
            }
        }

        @JavascriptInterface
        public void openCalendarIcs(String text, String filename) {
            runOnUiThread(() -> openCalendarIcsOnUiThread(text, filename));
        }

        @JavascriptInterface
        public void printText(String text, String title) {
            runOnUiThread(() -> printTextOnUiThread(text, title));
        }

        @JavascriptInterface
        public void exitApp() {
            runOnUiThread(() -> stopSpeechAndFinishOnUiThread());
        }

        @JavascriptInterface
        public void restartApp() {
            runOnUiThread(() -> restartAppOnUiThread());
        }

        @JavascriptInterface
        public void speak(String text, double rate) {
            runOnUiThread(() -> speakOnUiThread(text, normalizeSpeechRate(rate)));
        }

        @JavascriptInterface
        public void startHeartRateSensor() {
            runOnUiThread(() -> requestHeartRateSensorFlow());
        }

        @JavascriptInterface
        public void stopHeartRateSensor() {
            runOnUiThread(() -> {
                if (heartRateBleManager != null) {
                    heartRateBleManager.disconnect();
                }
            });
        }

        @JavascriptInterface
        public boolean clearAllLocalFiles() {
            try {
                TrainingFilesStorage.deleteAllCheckpoints(MainActivity.this);
                return true;
            } catch (Exception exception) {
                return false;
            }
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
