# AGENTS.md

## Cursor Cloud specific instructions

### Project overview

Total Calendar is a self-contained static HTML/JS/CSS web application for training/exercise scheduling and guided execution. There are no build steps, no package managers, and no backend services for the web portion.

### Running the development server

```sh
python3 -m http.server 8080 --directory /workspace
```

Then open `http://localhost:8080/index.html` in a browser.

### Key files

- `index.html` — Main application (single-file, ~370KB, inline JS/CSS)
- `index_ref.html` — Alternate version that loads JS from an external ref file
- `StableVoice.html` — Standalone TTS testing utility
- `android/` — Android WebView wrapper (requires Gradle 9.4.1+, Android SDK 36, Java 17)

### Notes

- There is no linter, no test framework, and no build system for the web portion.
- The app is entirely client-side; all state lives in the browser DOM and file I/O.
- The Android build is optional and requires an Android SDK environment not present by default.
- Speech synthesis features require a browser with Web Speech API support (Chrome).
