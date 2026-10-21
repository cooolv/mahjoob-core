# قياس الدقة (eval)

سكربت يقيس أداء أي `PersonAnalyzer` على **صور حقيقية مُسمّاة** ويخرج تقريرًا بأرقام صادقة
مع مجالات ثقة. لا يضمّن بيانات ولا نماذج.

## المقاييس

- **التسرّب (Leakage)**: نسبة الصور التي *كان يجب حجبها* لكنها مرّت. هو المقياس الأهم.
- **الحجب الزائد (Over-block)**: نسبة الصور الآمنة التي حُجبت خطأً.
- مجال ثقة ويلسون 95% لكل نسبة، وتقسيم حسب الوسوم، ومقارنة عتبات متعددة من تشغيل واحد.
- الأخطاء والمهلات تُحسب محجوبة في الوضع الصارم، ويُحذَّر منها صراحةً في التقرير.

## تجهيز البيانات

1. اجمع صورًا **مرخّصة** (لا ترفعها لمستودع عام ما لم يسمح الترخيص). ضعها في مجلد محلي.
2. اكتب `manifest.json` (انظر `manifest.example.json`):
   - `gender`: `female` أو `male` أو `mixed` (الاثنان معًا) أو `none` (لا أشخاص).
   - `tags` اختيارية للتحليل التفصيلي: `no-face`, `small`, `occluded`, `cartoon`, `group`, `video-thumb` ...
3. **حجم العيّنة**: أقل من 100 صورة في كل فئة (يجب حجبها / آمنة) يعطي مجالات ثقة واسعة جدًا.
   يُنصح بمئات الصور على الأقل، مع تنويع الإضاءة والزوايا والأعمار والأحجام والصور بلا وجوه.
4. دقّة التسمية تحدد دقة القياس. راجع عيّنة من التسميات يدويًا.

## كتابة وحدة المحلّل

ملف `my-analyzer.ts` يصدّر `default` يُنشئ المحلّل (مثال مع `OnnxAnalyzer` في المحوّل):

```ts
import * as ort from "onnxruntime-node";           // أو onnxruntime-web
import { OnnxAnalyzer } from "../src/index.ts";

export default async function () {
  const det = await ort.InferenceSession.create("models/detector.onnx");
  const cls = await ort.InferenceSession.create("models/gender.onnx");
  return new OnnxAnalyzer({
    ort,
    detector: { session: det, inputSize: 640, decode: { layout: "channels-first", classIndex: 0 } },
    classifier: { session: cls, inputSize: [112, 112], output: { type: "softmax", femaleIndex: 0 } },
    toRaw: (x) => x as any, // السكربت يمرّر RawImage جاهزة
  });
}
```

## التشغيل

```bash
npm i -D sharp onnxruntime-node      # لقراءة الصور وتشغيل النماذج
npm run eval -- --manifest data/manifest.json --analyzer ./my-analyzer.ts --target female --out eval-out
```

يُنتج `eval-out/report.md` و`eval-out/outcomes.json`.
انشر `report.md` في المستودع مع اسم النموذج ومصدر البيانات، فهذا ما يجعل ادعاءاتك قابلة للتحقق.

## حدود

- الأرقام تخص مجموعتك فقط.
- لا يقيس الفيديو الفعلي (فاصل أخذ العيّنات والحركة)؛ استخرج إطارات وصنّفها كصور مع وسم `video-thumb`.
