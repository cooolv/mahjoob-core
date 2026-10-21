import { decide, DEFAULT_POLICY } from "../src/index.ts";
import type { PersonAnalyzer, PersonDetection, Policy, TargetGender } from "../src/index.ts";
import type { RawImage } from "../src/index.ts";
import { shouldBlock } from "./manifest.ts";
import type { ManifestEntry } from "./manifest.ts";
import type { Outcome } from "./metrics.ts";

export interface Sample {
  entry: ManifestEntry;
  detections?: PersonDetection[];
  /** نص الخطأ إن فشل التحميل أو التحليل أو انتهت المهلة */
  error?: string;
  ms: number;
}

export interface CollectOptions {
  analyzer: PersonAnalyzer;
  loadImage: (path: string) => Promise<RawImage>;
  /** مجلد manifest لحلّ المسارات النسبية */
  resolvePath: (rel: string) => string;
  timeoutMs?: number;
  onProgress?: (done: number, total: number) => void;
}

/** يشغّل المحلّل مرة واحدة لكل صورة ويحفظ الكشوفات الخام (لإعادة التقييم بسياسات مختلفة دون إعادة التشغيل) */
export async function collect(entries: ManifestEntry[], o: CollectOptions): Promise<Sample[]> {
  const out: Sample[] = [];
  const timeoutMs = o.timeoutMs ?? 10000;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    const t0 = performance.now();
    const s: Sample = { entry, ms: 0 };
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const img = await o.loadImage(o.resolvePath(entry.path));
      const ctrl = new AbortController();
      const timeout = new Promise<"timeout">((r) => {
        timer = setTimeout(() => { ctrl.abort(); r("timeout"); }, timeoutMs);
      });
      const res = await Promise.race([o.analyzer.analyze(img, ctrl.signal), timeout]);
      if (res === "timeout") s.error = "timeout";
      else s.detections = res;
    } catch (e) {
      s.error = e instanceof Error ? e.message : String(e);
    } finally {
      clearTimeout(timer);
    }
    s.ms = performance.now() - t0;
    out.push(s);
    o.onProgress?.(i + 1, entries.length);
  }
  return out;
}

/** يطبّق سياسة على العيّنات المجموعة. الأخطاء تعامل كما يعاملها ImageGuard. */
export function score(samples: Sample[], target: TargetGender, overrides: Partial<Omit<Policy, "target">> = {}): Outcome[] {
  const policy: Policy = { ...DEFAULT_POLICY, ...overrides, target };
  return samples.map((s) => {
    const base = { path: s.entry.path, tags: s.entry.tags ?? [], positive: shouldBlock(s.entry, target) };
    if (s.detections === undefined) {
      return { ...base, blocked: policy.strict, reason: s.error === "timeout" ? "timeout" as const : "analysis-error" as const };
    }
    const d = decide(s.detections, policy);
    return { ...base, blocked: d.action === "block", reason: d.reason };
  });
}
