import { LruCache } from "./cache.ts";
import { decide } from "./policy.ts";
import { DEFAULT_POLICY } from "./types.ts";
import type { Decision, ImageInput, PersonAnalyzer, Policy, TargetGender } from "./types.ts";

export interface GuardOptions {
  analyzer: PersonAnalyzer;
  target: TargetGender;
  policy?: Partial<Omit<Policy, "target">>;
  /** حجم الذاكرة المؤقتة للقرارات (افتراضي 500) */
  cacheSize?: number;
}

/**
 * الواجهة الرئيسية للصور والمصغّرات.
 * أي خطأ أو مهلة => حجب (Fail-Closed) في الوضع الصارم.
 */
export class ImageGuard {
  readonly policy: Policy;
  private readonly analyzer: PersonAnalyzer;
  private readonly cache: LruCache<Decision>;

  constructor(opts: GuardOptions) {
    this.analyzer = opts.analyzer;
    this.policy = { ...DEFAULT_POLICY, ...opts.policy, target: opts.target };
    this.cache = new LruCache(opts.cacheSize ?? 500);
  }

  /** @param cacheKey مفتاح اختياري (مثل رابط الصورة) لتفادي إعادة التحليل */
  async check(image: ImageInput, cacheKey?: string): Promise<Decision> {
    if (cacheKey) {
      const hit = this.cache.get(cacheKey);
      if (hit) return hit;
    }
    const decision = await this.run(image);
    // لا نخزّن الأخطاء والمهلات حتى تُعاد المحاولة لاحقًا
    const transient = decision.reason === "analysis-error" || decision.reason === "timeout";
    if (cacheKey && !transient) this.cache.set(cacheKey, decision);
    return decision;
  }

  private async run(image: ImageInput): Promise<Decision> {
    const ctrl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => {
        ctrl.abort();
        resolve("timeout");
      }, this.policy.timeoutMs);
    });
    try {
      const result = await Promise.race([this.analyzer.analyze(image, ctrl.signal), timeout]);
      if (result === "timeout") return this.failure("timeout");
      return decide(result, this.policy);
    } catch {
      return this.failure("analysis-error");
    } finally {
      clearTimeout(timer);
    }
  }

  private failure(reason: "timeout" | "analysis-error"): Decision {
    return { action: this.policy.strict ? "block" : "allow", reason, regions: [] };
  }
}
