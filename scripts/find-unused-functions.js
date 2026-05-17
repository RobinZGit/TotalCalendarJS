/**
 * Static scan: functions in index.html with no call sites (name followed by "(").
 * Not a full JS analyzer — verify before deleting.
 */
const fs = require("fs");
const path = require("path");
const htmlPath = path.join(__dirname, "..", "index.html");
const html = fs.readFileSync(htmlPath, "utf8");
const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
const allJs = scripts.join("\n");
const htmlOnly = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");

const lines = allJs.split("\n");

const funcDeclRe = /(?:^|\s)(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm;
const decls = [];
let m;
while ((m = funcDeclRe.exec(allJs)) !== null) {
  const before = allJs.slice(0, m.index);
  decls.push({ name: m[1], line: before.split("\n").length, index: m.index });
}

function getFuncEnd(startLine0) {
  const startIndent = (lines[startLine0].match(/^(\s*)/) || ["", ""])[1].length;
  for (let i = startLine0 + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(?:async\s+)?function\s+[A-Za-z_$]/.test(line)) {
      const ind = (line.match(/^(\s*)/) || ["", ""])[1].length;
      if (ind <= startIndent) return i;
    }
  }
  return lines.length;
}

function countCallRefs(name) {
  const callRe = new RegExp("\\b" + name.replace(/\$/g, "\\$") + "\\s*\\(", "g");
  let c = 0;
  let r;
  const hay = allJs + "\n" + htmlOnly;
  while ((r = callRe.exec(hay)) !== null) {
    const before = hay.slice(Math.max(0, r.index - 12), r.index);
    if (/function\s*$/.test(before)) continue;
    c++;
  }
  return c;
}

const dead = [];
for (const d of decls) {
  const line0 = d.line - 1;
  const endLine = getFuncEnd(line0);
  const bodyLines = endLine - line0;
  const calls = countCallRefs(d.name);
  const ind = (lines[line0].match(/^(\s*)/) || ["", ""])[1].length;
  if (calls === 0) {
    dead.push({
      name: d.name,
      line: d.line,
      endLine: endLine + 1,
      bodyLines,
      topLevel: ind <= 2,
    });
  }
}

const topDead = dead.filter((d) => d.topLevel);
function mergeRanges(items) {
  const ranges = items.map((u) => ({ start: u.line - 1, end: u.endLine - 1 }));
  if (!ranges.length) return 0;
  ranges.sort((a, b) => a.start - b.start);
  let total = 0;
  let cur = { ...ranges[0] };
  for (let i = 1; i < ranges.length; i++) {
    const r = ranges[i];
    if (r.start <= cur.end) cur.end = Math.max(cur.end, r.end);
    else {
      total += cur.end - cur.start;
      cur = { ...r };
    }
  }
  total += cur.end - cur.start;
  return total;
}

const topLines = mergeRanges(topDead);
const allDeadLines = mergeRanges(dead.filter((d) => d.topLevel || d.bodyLines > 3));

console.log(JSON.stringify({
  totalFunctions: decls.length,
  deadFunctions: dead.length,
  topLevelDead: topDead.length,
  topLevelDeadLinesNonOverlap: topLines,
  nestedDead: dead.length - topDead.length,
}, null, 2));

console.log("\n=== Top-level: no call sites (name() anywhere) ===\n");
for (const u of topDead.sort((a, b) => a.line - b.line)) {
  console.log(`L${u.line}-${u.endLine} (${u.bodyLines} lines) ${u.name}`);
}

const nested = dead.filter((d) => !d.topLevel && d.bodyLines > 2);
if (nested.length) {
  console.log("\n=== Nested (no calls) ===\n");
  for (const u of nested.sort((a, b) => a.line - b.line)) {
    console.log(`L${u.line}-${u.endLine} (${u.bodyLines} lines) ${u.name}`);
  }
}
