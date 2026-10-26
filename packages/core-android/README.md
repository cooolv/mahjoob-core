# mahjoob-android — النواة لتطبيقات أندرويد

مكتبة (AAR) مكتوبة بـ**Java 8**، تعمل من تطبيقات **Kotlin وJava**، وتحجب صور جنس تختاره (إناث، ذكور، أو **كل الأشخاص**)
داخل التطبيق، بمعالجة **على الجهاز بالكامل**: لا إنترنت ولا رفع صور ولا تتبّع.

هي نسخة أندرويد من النواة `mahjoob-core` (JavaScript): نفس القرارات ونفس الأرقام، ومتحقَّق من التطابق باختبارات مشتركة (انظر أدناه).

> **الدقة ليست 100%.** في قياسنا على 200 صورة FairFace جديدة (وجوه واضحة وقريبة) مرّ نحو **7%** من وجوه الإناث دون حجب
> (المجال 3.4–13.7%)، وحُجب نحو 28% من وجوه الذكور خطأ عند العتبة الافتراضية. على صور الحياة الواقعية المتوقع أسوأ.
> الصور التي لا يُكتشف فيها وجه **تمرّ**. للأمان الأعلى استخدم `TargetGender.ANY`.

## التثبيت

### الخيار أ: ملف AAR من Releases (الأضمن)
1. من صفحة **Releases** في المستودع نزّل `mahjoob-android-X.Y.Z.aar` (يُنشأ تلقائيًا عند إنشاء وسم `android-vX.Y.Z`)،
   أو من **Actions ثم Android** نزّل الملف `mahjoob-android-aar`.
2. ضعه في `app/libs/` وأضف في `app/build.gradle`:
   ```groovy
   dependencies {
       implementation files('libs/mahjoob-android-0.1.0.aar')
       // مطلوب: ملف AAR لا يحمل اعتمادياته معه
       implementation 'com.microsoft.onnxruntime:onnxruntime-android:1.20.0'
   }
   ```

### الخيار ب: نسخ المشروع إلى مشروعك
انسخ مجلد `packages/core-android/mahjoob-android` إلى مشروعك وأضف في `settings.gradle`: `include ':mahjoob-android'`
ثم `implementation project(':mahjoob-android')`.

### الخيار ج: JitPack (تجريبي، لم يُجرَّب)
`jitpack.yml` موجود في جذر المستودع لكن لم نختبره. إن عمل فالاستخدام: `implementation 'com.github.USER:REPO:TAG'`.

**الحد الأدنى:** minSdk 24 (Android 7.0).

## النماذج (مطلوبة، وليست مضمَّنة)
ضع ملفين في `app/src/main/assets/mahjoob/`:
- `face_detection_yunet_2023mar.onnx` (YuNet، ترخيص MIT)
- `gender-v1.onnx` (ترخيص CC0، من حزمة age-and-gender)

أسهل طريقة: شغّل `python get_models.py` من مجلد `examples/starter-web` وانسخ ملفي `models/` إلى `assets/mahjoob/`.
احتفظ بإشعارات تراخيص النماذج في تطبيقك.

## الاستخدام

**Kotlin** (غير مُترجَم هنا: الصيغة تتبع نفس الواجهة المُترجَمة في مثال Java):
```kotlin
// مرة واحدة، من خيط خلفي (تحميل النماذج بطيء نسبيًا)
val guard = MahjoobGuard.create(context, TargetGender.FEMALE)

// 1) أخفِ الصورة أولًا
imageView.visibility = View.INVISIBLE

// 2) افحص من خيط خلفي (check تحجب الخيط)، أو استخدم checkAsync
guard.checkAsync(bitmap) { decision ->
    // 3) اكشف فقط إن سمح القرار. أي خطأ أو مهلة = محجوبة
    if (!decision.isBlocked) imageView.visibility = View.VISIBLE
}

// عند الانتهاء
guard.close()
```

**Java:** انظر `examples/android-java/UsageExample.java` (مُترجَم فعلًا ضد واجهات أندرويد المصغّرة).

### قواعد مهمة
- **`check()` تحجب الخيط** حتى صدور القرار، وتمنع نفسها من خيط الواجهة (ترمي `IllegalStateException`). استخدم خيطًا خلفيًا أو `checkAsync`.
- **Fail-Closed**: أي خطأ أو مهلة (15 ثانية افتراضيًا) = حجب. لا تعكس هذا السلوك في واجهتك.
- أنشئ `MahjoobGuard` **مرة واحدة** وأعد استخدامه (يحمّل نموذجين ويشغّل خيط تحليل واحد). أغلقه في `onDestroy`.
- مرّر `cacheKey` (مثل رابط الصورة) لتفادي إعادة تحليل الصورة نفسها في القوائم.
- لا يطبّق اتجاه EXIF: مرّر Bitmap مدوَّرًا بالاتجاه الصحيح.

### القوائم (RecyclerView) والمصغّرات
اجعل صورة العنصر **مخفية افتراضيًا** عند ربط الـViewHolder، ثم افحصها بـ`checkAsync(bitmap, url) { ... }` ولا تكشفها إلا لو سمح القرار.
تأكد أن النتيجة ما زالت تخص نفس العنصر قبل الكشف (لأن الـViewHolder يُعاد استخدامه).

### الفيديو
```java
VideoGuard vg = guard.newVideoGuard(new TextureViewFrameSource(textureView, 480), listener);
// من خيط خلفي، كل 300–500ms أثناء التشغيل:
vg.tick(SystemClock.elapsedRealtime());
// عند التقديم/التأخير: vg.reset();
```
غطِّ الفيديو (طبقة معتمة فوقه) **ما دامت `vg.state() == COVERED`**. يبدأ مغطّى ولا يُكشف إلا بعد إطارين آمنين متتاليين.
مصادر الإطارات: `TextureViewFrameSource` و`MediaMetadataFrameSource`، أو نفّذ `FrameSource` بنفسك (ExoPlayer وغيره).

### الإعدادات
`MahjoobOptions.Builder(target)`: `.strict(true)` و`.blockThreshold(0.2)` و`.timeoutMs(15000)` و`.cropMargin(-0.1)` و`.maxSide(1280)` و`.assetDir("mahjoob")` و`.cacheSize(500)`.

## الحدود
- الدقة (أعلاه) والصور بلا وجه مكتشف.
- لا كشف أجسام، ولا كشف أطفال/عمر.
- لا تغطية تلقائية لواجهتك: أنت مسؤول عن إخفاء الصور حتى يصدر القرار.

## التحقق من التطابق مع نسخة JavaScript
- المنطق الأساسي (`dev.mahjoob.core`) يطابق `packages/core-js` ويُختبر بمتجهات مشتركة في `spec/vectors/` متولّدة من نسخة TypeScript:
  1200 حالة قرار، و57 حالة معالجة صور (بايتًا ببايت)، و18 حالة كشف YuNet.
- إن غيّرت سلوك النواة عمدًا: عدّل TypeScript، ثم أعد التوليد: `node --experimental-strip-types spec/gen-vectors.ts`،
  ثم عدّل Java حتى تنجح اختبارات `VectorsTest`.

## ما اختُبر وما لم يُختبر (بصراحة)
- **اختُبر هنا:** كل منطق `dev.mahjoob.core` (37 اختبارًا على JVM، منها المتجهات المشتركة؛ وجرّبنا كسر الكود عمدًا في ثلاثة مواضع وكشفها الاختبار).
  والمترجم قبل الكود بمستوى Java 8.
- **ترجمتَ فقط ضد واجهات مصغّرة كتبتها من معرفتي:** طبقة `dev.mahjoob.android` (Bitmap وAssetManager وTextureView وMediaMetadataRetriever)
  وواجهة ONNX Runtime (`ai.onnxruntime`). لم تُشغَّل على جهاز أو محاكٍ.
- **لم يُشغَّل:** بناء Gradle/AGP، واختبارات JUnit الفعلية (استخدمنا بديلًا محليًا مصغّرًا)، وسير النماذج الحقيقية على أندرويد،
  وأداء الاستدلال على الهواتف. أول تشغيل لـ**Actions ثم Android** سيكشف أي خطأ في البناء: ابعتوا لنا نصه.
- نسخة `onnxruntime-android:1.20.0` اخترناها من المعرفة ولم نتحقق من وجودها.

## التراخيص
الكود: MIT. YuNet: MIT. gender-v1: CC0. ONNX Runtime: MIT.
