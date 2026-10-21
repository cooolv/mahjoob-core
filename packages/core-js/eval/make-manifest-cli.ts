import { readFile, readdir, writeFile } from "node:fs/promises";
import { buildManifest, parseFairFaceCsv } from "./make-manifest.ts";

const a: Record<string, string> = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i]!.startsWith("--")) a[argv[i]!.slice(2)] = argv[i + 1] ?? "";
}
if (!a.csv) {
  console.error("الاستخدام: node --experimental-strip-types eval/make-manifest-cli.ts --csv fairface_label_val.csv --prefix fairface/ --per-class 100 [--none-dir images/none --none-prefix images/none/ --none-count 100] [--seed 1] --out data/manifest.json");
  process.exit(2);
}
const rows = parseFairFaceCsv(await readFile(a.csv, "utf8"));
let noneFiles: string[] | undefined;
if (a["none-dir"]) {
  const names = await readdir(a["none-dir"]);
  const pre = a["none-prefix"] ?? "";
  noneFiles = names.filter((n) => /\.(jpe?g|png|webp)$/i.test(n)).map((n) => pre + n);
}
const m = buildManifest({
  rows, perClass: Number(a["per-class"] ?? 100), seed: a.seed ? Number(a.seed) : 1,
  prefix: a.prefix, noneFiles, noneCount: a["none-count"] ? Number(a["none-count"]) : undefined,
});
await writeFile(a.out ?? "manifest.json", JSON.stringify(m, null, 2), "utf8");
console.log(`كُتب ${m.entries.length} إدخالًا في ${a.out ?? "manifest.json"}`);
