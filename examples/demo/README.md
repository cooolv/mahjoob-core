# الصفحة التجريبية

صفحة تشغّل النواة بالنماذج الحقيقية (YuNet + gender-v1) داخل المتصفح، لتجربة الصور والفيديو.
كل المعالجة محلية: لا تُرفع أي صورة.

## النشر على GitHub Pages (مرة واحدة)
1. في المستودع: **Settings** ثم **Pages**.
2. في **Source** اختر **GitHub Actions**.
3. اذهب إلى **Actions** ثم **Demo (GitHub Pages)** ثم **Run workflow**.
4. بعد ✅ يظهر الرابط في خطوة **deploy** (يشبه `https://اسمك.github.io/اسم-المستودع/`).

ينزّل الـworkflow النماذج تلقائيًا (YuNet من Hugging Face، و gender-v1 من حزمة age-and-gender على PyPI)
ويبني النواة وينشر الصفحة. لا حاجة لرفع النماذج يدويًا.

## تشغيل محلي (اختياري)
يتطلب Node.js وPython. من جذر المستودع:
```
cd packages/core-js && npm install && npm run build && cd ../..
mkdir -p _site/models && cp -r packages/core-js/dist _site/core
cp examples/demo/index.html examples/demo/demo.js _site/
# ضع النموذجين في _site/models ثم:
cd _site && python -m http.server 8000
```
ثم افتح `http://localhost:8000`.
