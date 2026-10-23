# نشر @mahjoob/core على npm

> النشر على npm **لا يمكن التراجع عنه بسهولة**: الإصدار المنشور ثابت (يمكن إلغاؤه خلال 72 ساعة فقط بشروط، ولا يمكن إعادة استخدام رقمه).
> لذلك جرّب دائمًا بـ«تجربة بدون نشر» أولًا.

## قبل أول نشر (مرة واحدة)
1. أنشئ حسابًا على npmjs.com وفعّل المصادقة الثنائية.
2. **اسم الحزمة**: `@mahjoob/core` يتطلب أن تملك الـscope `mahjoob`. أنشئ منظمة (Organization) مجانية بهذا الاسم من npmjs.com
   (الحزم العامة مجانية). إن كان الاسم محجوزًا لغيرك فغيّر `name` في `package.json` (واسم الاستيراد في أمثلتك).
   *لم أتحقق من توفر الاسم، افحصه بنفسك.*
3. أنشئ **Access Token** من npm (نوع Granular مع صلاحية Publish على الحزمة، أو Automation).
4. في مستودع GitHub: **Settings ثم Secrets and variables ثم Actions ثم New repository secret**
   بالاسم `NPM_TOKEN` وضع فيه الـtoken.
5. المستودع يجب أن يكون **عامًّا (Public)** حتى تعمل شهادة المصدر (provenance).

## تجربة بدون نشر
**Actions ثم Publish @mahjoob/core (npm) ثم Run workflow** واترك «تجربة بدون نشر» مفعّلة.
يبني ويختبر ويعرض محتويات الحزمة ولا ينشر شيئًا.

## النشر
1. ارفع الإصدار في `packages/core-js/package.json` (مثلًا `0.1.0`).
2. أنشئ **Release** جديدًا في GitHub بوسم يطابق الإصدار بالضبط: `v0.1.0`.
3. يعمل الـworkflow تلقائيًا وينشر. تحقق على `https://www.npmjs.com/package/@mahjoob/core`.

## بعد النشر
- غيّر في `examples/starter-web/index.html` رابط jsDelivr إلى الإصدار المنشور (يعمل بعد دقائق من النشر).
- النواة **لا تضمّن نماذج**. أبقِ تحذير الدقة ظاهرًا في README.
