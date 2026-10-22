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

## محوّل ONNX (`OnnxAnalyzer`)

يطبّق `PersonAnalyzer` بمرحلتين: (1) كشف أشخاص/وجوه، (2) تصنيف الجنس لكل اقتطاع.
**لا يتضمن أي نموذج**، فأنت تختار نماذجك وتتحقق من ترخيصها، ثم تصف شكل مدخلاتها ومخرجاتها:

```ts
import * as ort from "onnxruntime-web";
import { ImageGuard, OnnxAnalyzer } from "@mahjoob/core";

const [detSession, clsSession] = await Promise.all([
  ort.InferenceSession.create("/models/detector.onnx"),
  ort.InferenceSession.create("/models/gender.onnx"),
]);

const analyzer = new OnnxAnalyzer({
  ort,
  detector: {
    session: detSession,
    inputSize: 640,
    normalize: {},                                  // 0..1 بدون تطبيع إضافي
    decode: { layout: "channels-first", classIndex: 0, scoreThreshold: 0.25 },
  },
  classifier: {
    session: clsSession,
    inputSize: [112, 112],
    normalize: { mean: [0.5, 0.5, 0.5], std: [0.5, 0.5, 0.5] },
    output: { type: "softmax", femaleIndex: 0 },    // عدّلها حسب نموذجك
    cropMargin: 0.2,
  },
});

const guard = new ImageGuard({ analyzer, target: "female" });
```

**أشكال مخرجات الكاشف المدعومة**

| `layout` | الشكل | أمثلة |
|---|---|---|
| `channels-first` | `[1, 4+C, N]` | نمط YOLOv8 / YOLO11 |
| `rows-with-objectness` | `[1, N, 5+C]` | نمط YOLOX / YOLOv5 |

الصناديق بصيغة `cx,cy,w,h` والدرجات يجب أن تكون مطبَّقًا عليها sigmoid داخل النموذج.

**كاشف YuNet (وجوه)**: له 12 مخرجًا فيُفَكّ بـ`layout: "yunet"`. مدخله BGR بقيم 0..255 (بدون قسمة على 255)
وأبعاده من مضاعفات 32 (نسخة 2023mar مثبّتة على 640×640):

```ts
detector: {
  session: yunetSession,
  inputSize: 640,
  normalize: { scale: 1, bgr: true },
  decode: { layout: "yunet", scoreThreshold: 0.6 },
},
```

**مصنّف بأكثر من مخرج**: حدّد المخرج المطلوب بـ`outputName` (مثلًا `"prob"`)، وللنماذج التي تتوقع 0..255
استخدم `normalize: { scale: 1 }` وللترتيب BGR أضف `bgr: true`.

**أنماط مخرجات المصنّف**: `single-prob` و`single-logit` و`softmax` (مع `femaleIndex`).

**سلوك الفشل (Fail-Closed)**
- فشل الكاشف => خطأ => `ImageGuard` يحجب.
- فشل المصنّف لشخص => يبقى جنسه غير محسوم => الوضع الصارم يحجب.
- أكثر من `maxPeople` (افتراضي 10) => الزائدون غير محسومين => حجب.

**مصدر الصورة**: يقبل `ImageData` أو `{data,width,height}` مباشرة، وفي المتصفح يقبل أيضًا
`<img>` و`<canvas>` و`<video>` و`ImageBitmap` و`Blob`. صور المواقع الأخرى تُلوّث الـCanvas (CORS)
فتفشل القراءة وتُحجب. في الإضافات اجلب بايتات الصورة من الـbackground ومرّرها كـ`Blob`.

**تنبيهات الترخيص والنماذج**
- مكتبة Ultralytics (YOLOv8/YOLO11) تحت AGPL-3.0، ما يفرض شروطًا على مشروعك. راجعها قبل الاعتماد عليها.
- بعض نماذج الوجه/الجنس الشهيرة (مثل نماذج InsightFace) مقيّدة بالاستخدام غير التجاري. راجع ترخيص كل نموذج بنفسك.
- جودة تصنيف الجنس تختلف كثيرًا حسب النموذج وبيانات تدريبه. قِس الدقة بنفسك قبل الاعتماد (سكربت `eval/` قادم).

## الإعداد الجاهز: YuNet + gender-v1

```ts
import * as ort from "onnxruntime-web";
import { ImageGuard, createYuNetGenderV1Analyzer } from "@mahjoob/core";

const yunetSession = await ort.InferenceSession.create("/models/face_detection_yunet_2023mar.onnx");
const genderSession = await ort.InferenceSession.create("/models/gender-v1.onnx");

const analyzer = createYuNetGenderV1Analyzer({ ort, yunetSession, genderSession });
const guard = new ImageGuard({ analyzer, target: "female" }); // أو "male"
```

- **YuNet** (OpenCV Zoo) ترخيصه MIT. **gender-v1** مصدره dlib-models (مساهمة Cydral Technology)، وتعلن الحزمة المبنية عليها
  (`age-and-gender`) أنه CC0. لا نضمّن النماذج: نزّلها بنفسك واحتفظ بإشعارات الترخيص.
- القيم مأخوذة من ملف `manifest.json` داخل الحزمة: RGB، 32×32، (البكسل − المتوسط) ÷ 256، والفئة 0 = أنثى.

### الدقة المقاسة (يجب قراءتها قبل الاعتماد)

قياس على **200 صورة من FairFace** (100 أنثى، 100 ذكر)، وجوه قريبة وواضحة، الهدف: حجب الإناث، عتبة 0.2،
هامش اقتطاع −0.1 (اختير من نفس الصور، فالرقم الحقيقي غالبًا أسوأ):

| | النتيجة | مجال الثقة 95% |
|---|---|---|
| تسرّب (أنثى لم تُحجب) | 8% | 4–15% |
| حجب زائد (ذكر حُجب) | 20% | 13–29% |
| صور اكتُشف فيها وجه | 100% | |

- هذه أرقام **أفضل حالة**: وجوه مقصوصة وقريبة. على صور الإنترنت (أجسام، وجوه صغيرة، إضاءة سيئة، رسوم، أطفال) نتوقع أسوأ.
- النموذج مدرّب على وجوه مُحاذاة بنقاط dlib، ونحن لا نحاذي الوجه، وهذا أحد أسباب انخفاض الدقة عن المعلن.
- الصور بلا وجه، أو التي يفوتها YuNet، **تمرّ**. لا يوجد في هذا الإعداد كشف للأجسام.
- **للحجب الأضمن** استخدم `target: "any"` (حجب كل الأشخاص)، وهو أيضًا مقيّد بقدرة الكاشف على إيجاد الأشخاص.
- أعد القياس على بياناتك قبل الاعتماد: انظر مجلد `eval/` وسكربتات `tools/`.

## وضع "حجب كل الأشخاص" (`target: "any"`)

تصنيف الجنس غير مضمون. إن كان المطلوب أقصى احتياط فاستخدم `target: "any"`: أي شخص يكتشفه الكاشف يُحجب
بلا تصنيف جنس. الثمن حجب أكثر بكثير، والضمان مقيّد بقدرة الكاشف نفسه على إيجاد الأشخاص.

```ts
const guard = new ImageGuard({ analyzer, target: "any" });
```

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
