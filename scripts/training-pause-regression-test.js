const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const mainActivity = fs.readFileSync(
  path.join(
    __dirname,
    "..",
    "android",
    "app",
    "src",
    "main",
    "java",
    "com",
    "totalcalendarjs",
    "app",
    "MainActivity.java",
  ),
  "utf8",
);

function extractFunction(name, nextName) {
  const start = html.indexOf(`function ${name}(`);
  const end = html.indexOf(`function ${nextName}(`, start);
  assert(start >= 0 && end > start, `Could not extract ${name}`);
  return html.slice(start, end);
}

assert.match(
  html,
  /function pauseTrainingPlayback\(\)[\s\S]*?GlIsRunning = false[\s\S]*?clearInterval\(Gl_SayInterval\)/,
  "Pause must mark playback stopped before clearing the JavaScript timer",
);
assert.match(
  mainActivity,
  /evaluateJavascript\([\s\S]*?fSayInTime\(\)/,
  "The Android native tick must remain covered by this regression test",
);

const fSayInTime = extractFunction("fSayInTime", "calcMilliseconds");
assert.doesNotThrow(
  () => vm.runInNewContext(`${fSayInTime}; fSayInTime();`, {
    Gl_IsFinished: false,
    GlIsRunning: false,
  }),
  "A native timer tick must be a no-op while training is paused",
);

console.log("training pause regression test: ok");
