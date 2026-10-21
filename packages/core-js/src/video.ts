import type { Decision } from "./types.ts";
import type { ImageGuard } from "./guard.ts";

/** مصدر إطارات مجرّد: في المتصفح <video> + canvas، وفي أندرويد MediaMetadataRetriever */
export interface FrameSource {
  /** يلتقط الإطار الحالي، أو null إن لم يتوفر إطار */
  captureFrame(): Promise<unknown | null>;
}

export type VideoState = "covered" | "clear";

export interface VideoGuardOptions {
  guard: ImageGuard;
  source: FrameSource;
  /** عدد الإطارات الآمنة المتتالية قبل رفع التغطية (افتراضي 2) */
  clearAfter?: number;
  /** أقل مدة تغطية بعد آخر حجب بالمللي ثانية (افتراضي 1500) */
  holdMs?: number;
  onChange?: (state: VideoState, last: Decision) => void;
}

/**
 * آلة حالة للفيديو. تبدأ مغطّاة (covered) ولا ترفع التغطية
 * إلا بعد عدد من الإطارات الآمنة المتتالية ومرور مدة التثبيت.
 * الجدولة (كل كم مللي ثانية نستدعي tick) مسؤولية المستخدم.
 */
export class VideoGuard {
  private _state: VideoState = "covered";
  private clean = 0;
  private lastBlockAt = Number.NEGATIVE_INFINITY;
  private readonly clearAfter: number;
  private readonly holdMs: number;
  private readonly o: VideoGuardOptions;

  constructor(o: VideoGuardOptions) {
    this.o = o;
    this.clearAfter = o.clearAfter ?? 2;
    this.holdMs = o.holdMs ?? 1500;
  }

  get state(): VideoState {
    return this._state;
  }

  /** استدعِها دوريًا (مثلًا كل 300–500ms أثناء التشغيل). now بالمللي ثانية. */
  async tick(now: number): Promise<VideoState> {
    let decision: Decision;
    try {
      const frame = await this.o.source.captureFrame();
      decision =
        frame === null
          ? { action: "block", reason: "analysis-error", regions: [] }
          : await this.o.guard.check(frame);
    } catch {
      decision = { action: "block", reason: "analysis-error", regions: [] };
    }

    if (decision.action === "block") {
      this.clean = 0;
      this.lastBlockAt = now;
      this.set("covered", decision);
    } else {
      this.clean += 1;
      const held = now - this.lastBlockAt < this.holdMs;
      if (this.clean >= this.clearAfter && !held) this.set("clear", decision);
    }
    return this._state;
  }

  /** عند التنقّل/السحب في الفيديو: غطِّ فورًا وأعد العدّ */
  reset(): void {
    this.clean = 0;
    this._state = "covered";
  }

  private set(next: VideoState, d: Decision): void {
    if (this._state !== next) {
      this._state = next;
      this.o.onChange?.(next, d);
    }
  }
}
