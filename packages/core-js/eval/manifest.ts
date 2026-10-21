import type { TargetGender } from "../src/index.ts";

export type TruthGender = "female" | "male" | "mixed" | "none";

export interface ManifestEntry {
  /** مسار الصورة نسبةً إلى مجلد manifest */
  path: string;
  /** من يظهر فعليًا في الصورة: female/male/mixed (الاثنان)/none (لا أشخاص) */
  gender: TruthGender;
  /** وسوم للتحليل التفصيلي: no-face, small, occluded, cartoon, video-thumb, group ... */
  tags?: string[];
}

export interface Manifest {
  name: string;
  /** مصدر البيانات وترخيصها (للتوثيق في التقرير) */
  source?: string;
  entries: ManifestEntry[];
}

const GENDERS: ReadonlySet<string> = new Set(["female", "male", "mixed", "none"]);

export function validateManifest(x: unknown): Manifest {
  if (typeof x !== "object" || x === null) throw new Error("manifest ليس كائنًا");
  const m = x as Record<string, unknown>;
  if (typeof m.name !== "string" || !m.name) throw new Error("الحقل name مطلوب");
  if (!Array.isArray(m.entries) || m.entries.length === 0) throw new Error("entries فارغة");
  const seen = new Set<string>();
  const entries: ManifestEntry[] = m.entries.map((e, i) => {
    const o = e as Record<string, unknown>;
    if (typeof o?.path !== "string" || !o.path) throw new Error(`entries[${i}].path مفقود`);
    if (typeof o.gender !== "string" || !GENDERS.has(o.gender)) {
      throw new Error(`entries[${i}].gender يجب أن يكون female|male|mixed|none`);
    }
    if (seen.has(o.path)) throw new Error(`مسار مكرر: ${o.path}`);
    seen.add(o.path);
    const tags = o.tags === undefined ? undefined : o.tags;
    if (tags !== undefined && (!Array.isArray(tags) || tags.some((t) => typeof t !== "string"))) {
      throw new Error(`entries[${i}].tags يجب أن تكون قائمة نصوص`);
    }
    return { path: o.path, gender: o.gender as TruthGender, tags: tags as string[] | undefined };
  });
  return { name: m.name, source: typeof m.source === "string" ? m.source : undefined, entries };
}

/** هل يجب حجب هذه الصورة؟ (الحقيقة الأرضية بالنسبة للجنس المستهدف) */
export function shouldBlock(e: ManifestEntry, target: TargetGender): boolean {
  return e.gender === "mixed" || e.gender === target;
}
