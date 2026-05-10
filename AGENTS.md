# AGENTS.md

## Cursor Cloud specific instructions

### Overview

TotalCalendarJS is a zero-dependency, static HTML/JavaScript web application for managing timed training/exercise routines with text-to-speech voice guidance. The UI is entirely in Russian.

### Running the application

No build step required. Serve the workspace root via any static HTTP server:

```bash
python3 -m http.server 8080 --directory /workspace
```

Then open `http://localhost:8080/index.html` in a browser.

**Important**: `index_ref.html` uses `fetch("./index.html")` internally, so files must be served over HTTP (not `file://`).

### Key files

- `index.html` — Main application (current version)
- `index1.html` — Slightly older version
- `index_old.html` — Oldest version
- `index_ref.html` — Wrapper that loads and normalizes `index.html` via fetch
- `StableVoice.html` — Standalone text-to-speech utility page

### Testing and linting

There are no automated tests, linter configurations, or CI/CD pipelines in this repository. The application is tested manually by interacting with it in a browser.

### Browser requirements

The application requires a modern browser with `SpeechSynthesis` API support (Chrome, Edge, Firefox, Safari). It also uses the `WakeLock` API and `AudioContext`.

### Notes

- The codebase uses Russian-language variable names and UI labels.
- All code is inline within monolithic HTML files (~4000+ lines each).
- No package manager, no node_modules, no external dependencies.
