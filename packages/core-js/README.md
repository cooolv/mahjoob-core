# @mahjoob/core

## مثال: صورة أو مصغّرة

```ts
import { ImageGuard } from "@mahjoob/core";
import type { PersonAnalyzer } from "@mahjoob/core";

// تنفّذها أنت: تشغّل نموذج الكشف + تصنيف الجنس وتعيد قائمة PersonDetection
const analyzer: PersonAnalyzer = {
  async analyze(image, signal) {
    /* ... ONNX Runtime Web ... */
    return [];
  },
};

const guard = new ImageGuard({ analyzer, target: "female" }); // أو "male"

// الأفضل إخفاء الصورة أولًا (CSS) ثم إظهارها عند السماح
const decision = await guard.check(imgElement, imgElement.src);
if (decision.action === "block") {
  /* غطِّ الصورة */
}
```

## مثال: فيديو

```ts
import { VideoGuard } from "@mahjoob/core";

const vg = new VideoGuard({
  guard,
  source: { captureFrame: async () => grabFrameFromVideoElement(video) },
  onChange: (state) => video.style.visibility = state === "covered" ? "hidden" : "visible",
});

setInterval(() => vg.tick(performance.now()), 400);
video.addEventListener("seeking", () => vg.reset());
```

الفيديو يبدأ **مغطّى** ولا يُكشف إلا بعد إطارين آمنين متتاليين ومرور مدة تثبيت بعد آخر حجب.

## الإعدادات (Policy)

| الحقل | الافتراضي | المعنى |
|---|---|---|
| `strict` | `true` | أي غموض أو خطأ => حجب |
| `blockThreshold` | `0.2` | يُحجب إن كان احتمال الجنس المستهدف أكبر منها (منخفضة عمدًا) |
| `minPersonConfidence` | `0.35` | أقل ثقة لاعتبار الكشف شخصًا |
| `minGenderConfidence` | `0.6` | أقل ثقة لاعتبار الجنس محسومًا |
| `timeoutMs` | `3000` | بعدها يُحجب |

## الاختبار

```bash
npm test
```
