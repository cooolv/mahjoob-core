// قالب بسيط: يربط mahjoob-core بنموذجي YuNet وgender-v1 ويفحص صورة يختارها المستخدم.
import { ImageGuard, createYuNetGenderV1Analyzer, serialized } from "mahjoob-core";

const $ = (id) => document.getElementById(id);
const ort = window.ort;

ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/";
ort.env.wasm.numThreads = 1; // بدون SharedArrayBuffer

try {
  // 1) حمّل النموذجين (ضعهما في مجلد models بجانب هذه الصفحة: انظر README)
  const opts = { executionProviders: ["wasm"] };
  const [yunetSession, genderSession] = await Promise.all([
    ort.InferenceSession.create("models/face_detection_yunet_2023mar.onnx", opts),
    ort.InferenceSession.create("models/gender-v1.onnx", opts),
  ]);

  // 2) ابنِ المحلّل. serialized يمنع تشغيل الجلسة الواحدة بالتوازي.
  const analyzer = serialized(createYuNetGenderV1Analyzer({ ort, yunetSession, genderSession }));

  // 3) الحارس: "female" أو "male" أو "any". الوضع الصارم افتراضي (أي خطأ أو غموض = حجب).
  const makeGuard = () => new ImageGuard({ analyzer, target: $("target").value });
  let guard = makeGuard();
  $("target").addEventListener("change", () => { guard = makeGuard(); });

  $("out").textContent = "جاهز. اختر صورة.";
  $("file").disabled = false;

  $("file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const preview = $("preview");
    preview.classList.add("blocked");               // الصورة مموّهة حتى يصدر القرار
    preview.src = URL.createObjectURL(file);
    $("out").textContent = "جارٍ الفحص…";

    const bitmap = await createImageBitmap(file);
    const decision = await guard.check(bitmap);      // { action: "allow" | "block", reason, regions }
    bitmap.close();

    preview.classList.toggle("blocked", decision.action === "block");
    $("out").textContent = "القرار: " + (decision.action === "block" ? "محجوبة" : "مسموحة") + "\nالسبب: " + decision.reason;
  });
} catch (err) {
  $("out").textContent = "تعذّر التحميل: " + (err && err.message ? err.message : err);
}
