// يحوّل مسارات الاستيراد النسبية في ملفات .d.ts من ".ts" إلى ".js" (المعيار لحزم ESM المنشورة)
// الاستخدام: node scripts/fix-dts.mjs [المجلد=dist]
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function fixSource(text) {
  return text.replace(/(["'])(\.{1,2}\/[^"'\n]*?)\.ts\1/g, "$1$2.js$1");
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (name.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop());
if (isMain) {
  const dir = process.argv[2] ?? "dist";
  let changed = 0;
  for (const f of walk(dir)) {
    const before = readFileSync(f, "utf8");
    const after = fixSource(before);
    if (after !== before) { writeFileSync(f, after); changed++; }
  }
  console.log(`fix-dts: عُدّل ${changed} ملف في ${dir}`);
}
