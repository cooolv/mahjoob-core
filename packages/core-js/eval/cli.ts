import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { PersonAnalyzer, TargetGender } from "../src/index.ts";
import { validateManifest } from "./manifest.ts";
import { loadWithSharp } from "./loader-sharp.ts";
import { collect, score } from "./runner.ts";
import { renderReport } from "./report.ts";

function args(argv: string[]): Record<string, string> {
  const o: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) o[a.slice(2)] = argv[i + 1] && !argv[i + 1]!.startsWith("--") ? argv[++i]! : "true";
  }
  return o;
}

const USAGE = `الاستخدام:
  node --experimental-strip-types eval/cli.ts --manifest data/manifest.json --analyzer ./my-analyzer.ts --target female [--out eval-out] [--threshold 0.2] [--lenient]

  --analyzer  وحدة تصدّر default: دالة async ترجع PersonAnalyzer (أو كائنًا جاهزًا)
  --lenient   يعطّل الوضع الصارم في السياسة المعتمدة (الافتراضي: صارم)`;

const a = args(process.argv.slice(2));
if (!a.manifest || !a.analyzer || (a.target !== "female" && a.target !== "male" && a.target !== "any")) {
  console.error(USAGE);
  process.exit(2);
}

const manifestPath = resolve(a.manifest);
const manifest = validateManifest(JSON.parse(await readFile(manifestPath, "utf8")));
const mod = await import(pathToFileURL(resolve(a.analyzer)).href);
const made = typeof mod.default === "function" ? await mod.default() : mod.default;
const analyzer: PersonAnalyzer = made;
if (!analyzer || typeof analyzer.analyze !== "function") throw new Error("المحلّل غير صالح: يجب أن يملك analyze()");

const target = a.target as TargetGender;
const baseDir = dirname(manifestPath);
const samples = await collect(manifest.entries, {
  analyzer,
  loadImage: loadWithSharp,
  resolvePath: (p) => resolve(baseDir, p),
  onProgress: (d, t) => { if (d % 25 === 0 || d === t) process.stderr.write(`\r${d}/${t}`); },
});
process.stderr.write("\n");

const policy = { strict: a.lenient !== "true", blockThreshold: a.threshold ? Number(a.threshold) : 0.2 };
const report = renderReport({
  datasetName: manifest.name, source: manifest.source, target, samples, policy,
  thresholds: [0.05, 0.1, 0.2, 0.3, 0.5, 0.7], analyzerName: a.analyzer,
});

const out = resolve(a.out ?? "eval-out");
await mkdir(out, { recursive: true });
await writeFile(resolve(out, "report.md"), report, "utf8");
await writeFile(resolve(out, "outcomes.json"), JSON.stringify(score(samples, target, policy), null, 2), "utf8");
console.log(report);
console.log(`\nحُفظ التقرير في ${out}`);
