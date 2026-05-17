const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const lines = fs.readFileSync(path.join(root, "index.html"), "utf8").split(/\r?\n/);

const block1End = lines.findIndex((l) => l.includes("конец БЛОКА 1"));
const block1 = lines.slice(0, block1End + 1);

function blockStartAfter(marker, afterIdx) {
  for (let i = afterIdx + 1; i < lines.length; i++) {
    if (!lines[i].includes(marker)) continue;
    for (let j = i - 1; j >= afterIdx && j >= i - 3; j--) {
      if (/^\/\* =+$/.test(lines[j].trim())) return j;
    }
    return i;
  }
  return -1;
}

const scriptOpen = lines.findIndex((l) => l.trim() === "<script>");

const i2p1Start = blockStartAfter("БЛОК 2 — app.js", scriptOpen >= 0 ? scriptOpen : block1End);
const i3Start = blockStartAfter("БЛОК 3 — trainings-data.js", i2p1Start);
const i3End = lines.findIndex((l) => l.includes("конец БЛОКА 3"));
const i2p2aStart = blockStartAfter("БЛОК 2 (продолжение)", i3End);
const i4Start = blockStartAfter("БЛОК 4 — train-help.js", i2p2aStart);
const i4End = lines.findIndex((l) => l.includes("конец БЛОКА 4"));
const i2p2bStart = blockStartAfter("БЛОК 2 (продолжение)", i4End);
const i2End = lines.findIndex((l) => l.includes("конец БЛОКА 2"));

if (
  [block1End, i2p1Start, i3Start, i3End, i2p2aStart, i4Start, i4End, i2p2bStart, i2End].some(
    (i) => i < 0
  )
) {
  console.error("Block markers not found", {
    block1End,
    i2p1Start,
    i3Start,
    i3End,
    i2p2aStart,
    i4Start,
    i4End,
    i2p2bStart,
    i2End,
  });
  process.exit(1);
}

const appHeader = [
  "/* =============================================================================",
  " * БЛОК 2 — app.js",
  " * Логика UI, тренировки, календарь, экспорт, движок ритма.",
  " * ============================================================================= */",
  "",
];

function stripBlockHeader(slice, markerRe) {
  const out = [];
  let i = 0;
  while (i < slice.length) {
    const line = slice[i];
    if (/^\/\* =+$/.test(line.trim())) {
      let j = i + 1;
      if (j < slice.length && markerRe.test(slice[j])) {
        i = j + 1;
        while (i < slice.length) {
          if (slice[i].includes("*/")) {
            i++;
            break;
          }
          if (/^\/\* =+$/.test(slice[i].trim())) break;
          i++;
        }
        while (i < slice.length && slice[i].trim() === "") i++;
        continue;
      }
    }
    if (/^\s*\* /.test(line) && (markerRe.test(line) || line.includes("Инициализация DOM"))) {
      while (i < slice.length && !slice[i].includes("*/")) i++;
      if (i < slice.length) i++;
      continue;
    }
    out.push(line);
    i++;
  }
  return out;
}

const appBody = [
  ...stripBlockHeader(lines.slice(i2p1Start, i3Start), /БЛОК 2 — app\.js/),
  ...stripBlockHeader(lines.slice(i2p2aStart, i4Start), /БЛОК 2 \(продолжение\)/),
  ...stripBlockHeader(lines.slice(i2p2bStart, i2End + 1), /БЛОК 2 \(продолжение\)/).filter(
    (l) => !l.includes("конец БЛОКА 2")
  ),
  "/* ===================== конец БЛОКА 2 — app.js ===================== */",
];

const jsDir = path.join(root, "js");
fs.mkdirSync(jsDir, { recursive: true });
fs.writeFileSync(
  path.join(jsDir, "trainings-data.js"),
  lines.slice(i3Start, i3End + 1).join("\n") + "\n"
);
fs.writeFileSync(path.join(jsDir, "app.js"), [...appHeader, ...appBody].join("\n") + "\n");
fs.writeFileSync(
  path.join(jsDir, "train-help.js"),
  lines.slice(i4Start, i4End + 1).join("\n") + "\n"
);

const scriptBlock = [
  "",
  '<script src="js/trainings-data.js"></script>',
  '<script src="js/app.js"></script>',
  '<script src="js/train-help.js"></script>',
  "",
];

const tail = lines.slice(i2End + 1);
const tailInScript = [];
let inScript = false;
for (const line of tail) {
  if (line.trim() === "</script>") {
    tailInScript.push(line);
    inScript = false;
    continue;
  }
  if (!inScript && line.includes("/*Формат под EVAL")) {
    tailInScript.push("<script>");
    inScript = true;
  }
  tailInScript.push(line);
}

const indexHtml = [...block1, ...scriptBlock, ...tailInScript].join("\n");
fs.writeFileSync(path.join(root, "index.html"), indexHtml);

console.log("OK", {
  trainingsData: i3End - i3Start + 1,
  app: appBody.length,
  help: i4End - i4Start + 1,
});
