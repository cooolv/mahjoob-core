import type { Manifest, ManifestEntry } from "./manifest.ts";

export interface FairFaceRow {
  file: string;
  gender: "female" | "male";
}

/** يقرأ ملف FairFace CSV (الأعمدة: file,age,gender,race,service_test). القيم Male/Female بلا حساسية لحالة الأحرف. */
export function parseFairFaceCsv(text: string): FairFaceRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) throw new Error("ملف CSV فارغ");
  const head = lines[0]!.split(",").map((h) => h.trim().toLowerCase());
  const fi = head.indexOf("file");
  const gi = head.indexOf("gender");
  if (fi < 0 || gi < 0) throw new Error("لم أجد العمودين file و gender في ترويسة CSV");
  const rows: FairFaceRow[] = [];
  for (const line of lines.slice(1)) {
    const c = line.split(",");
    const g = (c[gi] ?? "").trim().toLowerCase();
    const file = (c[fi] ?? "").trim();
    if (!file || (g !== "female" && g !== "male")) continue;
    rows.push({ file, gender: g });
  }
  return rows;
}

/** مولّد عشوائي حتمي (mulberry32) ليكون أخذ العيّنة قابلًا للتكرار */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sample<T>(items: T[], n: number, rand: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a.slice(0, n);
}

export interface BuildOptions {
  rows: FairFaceRow[];
  /** عدد الصور من كل جنس */
  perClass: number;
  seed?: number;
  /** بادئة مسار صور FairFace نسبةً إلى manifest (مثل "fairface/") */
  prefix?: string;
  /** ملفات صور بلا أشخاص (تتحقق أنت من خلوّها من الأشخاص) ونسبة مساراتها إلى manifest */
  noneFiles?: string[];
  noneCount?: number;
}

export function buildManifest(o: BuildOptions): Manifest {
  const rand = rng(o.seed ?? 1);
  const prefix = o.prefix ?? "";
  const entries: ManifestEntry[] = [];
  for (const g of ["female", "male"] as const) {
    const pool = o.rows.filter((r) => r.gender === g);
    if (pool.length < o.perClass) throw new Error(`لا يكفي ${g}: المتوفر ${pool.length} والمطلوب ${o.perClass}`);
    for (const r of sample(pool, o.perClass, rand)) {
      entries.push({ path: prefix + r.file, gender: g, tags: ["face", "fairface"] });
    }
  }
  const none = o.noneFiles ?? [];
  const nn = Math.min(o.noneCount ?? none.length, none.length);
  for (const f of sample(none, nn, rand)) entries.push({ path: f, gender: "none", tags: ["no-person"] });
  return {
    name: "FairFace subset" + (nn ? " + no-person images" : ""),
    source:
      "FairFace (Kärkkäinen & Joo, WACV 2021), CC BY 4.0, https://github.com/joojs/fairface" +
      (nn ? ". صور بلا أشخاص: من مصدر يوثّقه صاحب المشروع." : ""),
    entries,
  };
}
