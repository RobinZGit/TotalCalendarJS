# Total Calendar Android

This directory contains a native Android wrapper for the existing Total Calendar
HTML app.

## What the app does

- Loads `index.html` from Android assets in a `WebView`.
- Copies the repository's top-level `*.html` files into the APK at build time.
- Exposes an `AndroidTraining` JavaScript bridge so the web app can:
  - keep the Android screen on while a training run is active;
  - stop native speech when training is stopped or muted;
  - use Android `TextToSpeech` instead of browser speech synthesis inside the
    Android app;
  - connect a **BLE heart rate monitor** (GATT Heart Rate service). While a
    run is active, BPM is sent to the page (`onAndroidHeartRate`) and shown in
    the time textarea next to elapsed time.

## Build

Open this `android/` directory in Android Studio, or build from a machine with
Gradle and the Android SDK installed:

```sh
gradle :app:assembleDebug
```

The Android Gradle Plugin version in this project requires Gradle 9.4.1 or
newer and Android SDK 36.
