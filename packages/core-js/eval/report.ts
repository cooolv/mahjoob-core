import type { Outcome, Summary } from "./metrics.ts";
import { byTag, percentile, reasonCounts, summarize } from "./metrics.ts";
import type { Sample } from "./runner.ts";
import { score } from "./runner.ts";
import type { TargetGender } from "../src/index.ts";

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const ci = (c: { low: number; high: number }) => `${pct(c.low)}–${pct(c.high)}`;
const row = (label: string, s: Summary) =>
  `| ${label} | ${s.positives} | ${s.leaked} | ${pct(s.leakRate)} (${ci(s.leakCI)}) | ${s.negatives} | ${s.overblocked} | ${pct(s.overRate)} (${ci(s.overCI)}) |`;

const HEAD =
  "| الإعداد | صور يجب حجبها | تسرّب | نسبة التسرّب (CI 95%) | صور آمنة | حُجبت خطأً | نسبة الحجب الزائد (CI 95%) |\n|---|---|---|---|---|---|---|";

export interface ReportInput {
  datasetName: string;
  source?: string;
  target: TargetGender;
  samples: Sample[];
  /** السياسة المعتمدة للتقرير التفصيلي */
  policy: { strict: boolean; blockThreshold: number };
  thresholds: number[];
  analyzerName: string;
}

export function renderReport(r: ReportInput): string {
  const main: Outcome[] = score(r.samples, r.target, r.policy);
  const sum = summarize(main);
  const errors = r.samples.filter((s) => s.error !== undefined);
  const ms = r.samples.map((s) => s.ms);
  const L: string[] = [];

  L.push(`# تقرير القياس: ${r.datasetName}`, "");
  L.push(`- المحلّل: \`${r.analyzerName}\``);
  L.push(`- الجنس المستهدف بالحجب: \`${r.target}\``);
  if (r.source) L.push(`- مصدر البيانات: ${r.source}`);
  L.push(`- عدد الصور: ${r.samples.length} (يجب حجب ${sum.positives}، آمنة ${sum.negatives})`);
  L.push(`- صور فشل تحليلها أو تحميلها: ${errors.length}`);
  L.push(`- زمن المعالجة لكل صورة: وسيط ${percentile(ms, 0.5).toFixed(0)}ms، P95 ${percentile(ms, 0.95).toFixed(0)}ms (على جهاز التشغيل الحالي فقط)`, "");

  if (errors.length > 0) {
    const first = errors[0]!.error;
    L.push(`> ⚠️ ${errors.length} من ${r.samples.length} صورة فشل تحليلها أو تحميلها (أول خطأ: ${first}). في الوضع الصارم تُحسب هذه الصور محجوبة، فقد تبدو النتائج أفضل مما هي عليه. أصلح الأخطاء قبل الحكم على الأرقام.`, "");
  }
  if (sum.positives < 100 || sum.negatives < 100) {
    L.push("> ⚠️ العيّنة صغيرة (أقل من 100 في إحدى الفئتين). مجالات الثقة واسعة، فلا تعتمد على هذه الأرقام للحكم على الجودة.", "");
  }

  L.push("## النتيجة بالسياسة المعتمدة", "", HEAD);
  L.push(row(`strict=${r.policy.strict}, threshold=${r.policy.blockThreshold}`, sum), "");
  L.push("**التسرّب** هو الأخطر: صورة يجب حجبها مرّت. **الحجب الزائد** يضرّ سهولة الاستخدام فقط.", "");
  L.push("أسباب القرارات: " + Object.entries(reasonCounts(main)).map(([k, v]) => `${k}=${v}`).join("، "), "");

  L.push("## مقارنة العتبات (من نفس التشغيل)", "", HEAD);
  for (const strict of [true, false]) {
    for (const t of r.thresholds) {
      L.push(row(`strict=${strict}, threshold=${t}`, summarize(score(r.samples, r.target, { strict, blockThreshold: t }))));
    }
  }
  L.push("");

  const tags = byTag(main);
  if (Object.keys(tags).length) {
    L.push("## حسب الوسم (بالسياسة المعتمدة)", "", HEAD);
    for (const [t, s] of Object.entries(tags)) L.push(row(t, s));
    L.push("");
  }

  L.push("## حدود هذا التقرير", "",
    "- الأرقام تخص هذه المجموعة فقط، ولا تعمَّم على صور الإنترنت عمومًا.",
    "- جودة الأرقام مرتبطة بدقة تسمية البيانات (`gender`) وتنوّعها.",
    "- لا يشمل القياس الفيديو الفعلي (فاصل أخذ العيّنات والحركة)، بل صورًا ثابتة أو إطارات مُستخرجة.", "");
  return L.join("\n");
}
