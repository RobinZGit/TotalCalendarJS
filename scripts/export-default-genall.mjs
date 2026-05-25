/**
 * Экспорт встроенной базы из index.html в GenTrainsAndCalendarFromTotalCalendarJS.genall
 * для публикации на GitHub Pages (сравнение локальной базы с удалённой).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const indexPath = path.join(root, "index.html");
const outPath = path.join(root, "GenTrainsAndCalendarFromTotalCalendarJS.genall");

const html = fs.readFileSync(indexPath, "utf8");
const start = html.indexOf("//Календарь тренировок");
const end = html.indexOf("/* ===================== конец БЛОКА 3");
if (start < 0 || end < 0 || end <= start) {
  console.error("Не найден блок trainings-data в index.html");
  process.exit(1);
}

let body = html.slice(start, end);
body = body.replace(/^\s*\/\/Календарь тренировок\s*\n/, "");
body = body.replace(/\bvar Gl_aMetaMetaCalendar\b/g, "Gl_aMetaMetaCalendar");
body = body.replace(/\bvar Gl_aMetaRithm\b/g, "Gl_aMetaRithm");
body = body.replace(/\s*var Gl_aMetaMetaCalendarSelected[^\n]*\n/g, "\n");
body = body.replace(/\s*var Gl_date[^\n]*\n/g, "\n");

const rithmIdx = body.indexOf("Gl_aMetaRithm");
if (rithmIdx < 0) {
  console.error("Gl_aMetaRithm не найден");
  process.exit(1);
}
const calPart = body.slice(0, rithmIdx).trim();
const rithmPart = body.slice(rithmIdx).trim();

const out =
  "//===== КАЛЕНДАРИ ================================\n" +
  calPart +
  "\n\n\n//===== ТРЕНИРОВКИ ==============================\n" +
  rithmPart +
  "\n";

fs.writeFileSync(outPath, out, "utf8");
console.log("Wrote", outPath, "(" + out.length + " bytes)");
