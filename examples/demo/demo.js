import {
  ImageGuard, VideoGuard, createYuNetGenderV1Analyzer, serialized, toRawImage,
} from "./core/index.js";

const ORT_BASE = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/";
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const REASONS = {
  "target-gender": "وجه من الجنس المستهدف",
  "any-person": "شخص مكتشف (وضع الحجب الشامل)",
  "uncertain-gender": "جنس غير محسوم",
  "low-confidence": "كشف ضعيف مشتبه",
  "analysis-error": "خطأ في التحليل",
  timeout: "انتهت مهلة التحليل",
  "no-person": "لم يُكتشف أي وجه",
  "no-target": "وجوه غير مستهدفة",
};

let analyzer = null;

function setStatus(text, isErr = false) {
  const el = $("status");
  el.textContent = text;
  el.classList.toggle("err", isErr);
}

async function loadModels() {
  try {
    const ort = window.ort;
    if (!ort) throw new Error("تعذّر تحميل onnxruntime-web من الشبكة");
    ort.env.wasm.wasmPaths = ORT_BASE;
    ort.env.wasm.numThreads = 1; // يتفادى اشتراط عزل الأصل (cross-origin isolation)
    const opts = { executionProviders: ["wasm"] };
    const [yunetSession, genderSession] = await Promise.all([
      ort.InferenceSession.create("models/face_detection_yunet_2023mar.onnx", opts),
      ort.InferenceSession.create("models/gender-v1.onnx", opts),
    ]);
    analyzer = serialized(createYuNetGenderV1Analyzer({ ort, yunetSession, genderSession }));
    setStatus("النماذج جاهزة. اختر صورًا أو فيديو.");
    $("imgs").disabled = false;
    $("vid").disabled = false;
  } catch (e) {
    setStatus("تعذّر تحميل النماذج: " + (e && e.message ? e.message : e), true);
  }
}

function settings() {
  return {
    target: $("target").value,
    strict: $("strict").checked,
    blockThreshold: Number($("thr").value) || 0.2,
  };
}

/** حارس جديد لكل مهمة، مع تسجيل آخر كشوفات/خطأ لعرضها */
function makeGuard(rec) {
  const s = settings();
  const recording = {
    async analyze(image, signal) {
      try {
        const d = await analyzer.analyze(image, signal);
        rec.dets = d;
        rec.error = null;
        return d;
      } catch (e) {
        rec.error = e;
        throw e;
      }
    },
  };
  return new ImageGuard({
    analyzer: recording,
    target: s.target,
    policy: { strict: s.strict, blockThreshold: s.blockThreshold, timeoutMs: 20000 },
    cacheSize: 1,
  });
}

const pct = (x) => (x === undefined ? "؟" : Math.round(x * 100) + "%");

/* ================= صور ================= */
function renderImageCard(card, decision, rec, raw, ms) {
  const blocked = decision.action === "block";
  card.classList.toggle("covered", blocked);
  card.classList.toggle("blocked", blocked);

  const boxes = card.querySelector(".boxes");
  boxes.innerHTML = "";
  for (const d of rec.dets || []) {
    const b = document.createElement("div");
    b.style.left = (d.box.x / raw.width) * 100 + "%";
    b.style.top = (d.box.y / raw.height) * 100 + "%";
    b.style.width = (d.box.width / raw.width) * 100 + "%";
    b.style.height = (d.box.height / raw.height) * 100 + "%";
    if (d.pFemale !== undefined) b.className = d.pFemale >= 0.5 ? "f" : "m";
    boxes.appendChild(b);
  }

  const info = card.querySelector(".info");
  info.textContent = "";
  const tag = document.createElement("span");
  tag.className = "tag " + (blocked ? "block" : "allow");
  tag.textContent = blocked ? "محجوبة" : "مسموحة";
  info.appendChild(tag);
  const lines = [REASONS[decision.reason] || decision.reason];
  if (rec.error) lines.push("الخطأ: " + (rec.error.message || rec.error));
  for (const d of rec.dets || []) {
    lines.push("وجه: احتمال أنثى " + pct(d.pFemale) + "، ثقة الكشف " + pct(d.confidence));
  }
  lines.push("زمن المعالجة: " + Math.round(ms) + "ms");
  for (const l of lines) {
    const p = document.createElement("div");
    p.textContent = l;
    info.appendChild(p);
  }
}

async function handleImage(file) {
  const card = document.createElement("div");
  card.className = "card covered";
  card.innerHTML = '<div class="imgwrap"><img alt=""><div class="boxes"></div></div><div class="info">جارٍ التحليل…</div>';
  card.querySelector("img").src = URL.createObjectURL(file);
  $("grid").prepend(card);

  const rec = { dets: [], error: null };
  const t0 = performance.now();
  try {
    const bitmap = await createImageBitmap(file);
    const raw = await toRawImage(bitmap, 1280);
    bitmap.close();
    const decision = await makeGuard(rec).check(raw);
    renderImageCard(card, decision, rec, raw, performance.now() - t0);
  } catch (e) {
    // أي فشل (صورة تالفة مثلًا) = تبقى مموّهة (Fail-Closed)
    card.classList.add("covered", "blocked");
    const info = card.querySelector(".info");
    info.textContent = "محجوبة: تعذّر قراءة الصورة (" + (e && e.message ? e.message : e) + ")";
  }
}

/* ================= فيديو ================= */
let videoLoop = 0;

async function handleVideo(file) {
  const v = $("video");
  const cover = $("vcover");
  const stateEl = $("vstate");
  const myLoop = ++videoLoop;
  const rec = { dets: [], error: null, last: null };

  // نسجّل آخر قرار لنشرح سبب التغطية حتى لو لم تتغير الحالة
  const guard = makeGuard(rec);
  const innerCheck = guard.check.bind(guard);
  guard.check = async (image, key) => {
    const d = await innerCheck(image, key);
    rec.last = d;
    return d;
  };

  const show = (state) => {
    cover.hidden = state === "clear";
    cover.textContent = "مغطّى";
    if (state === "clear") {
      stateEl.textContent = "الحالة: مكشوف (إطارات آمنة)";
    } else if (rec.last && rec.last.action === "block") {
      stateEl.textContent = "الحالة: مغطّى (" + (REASONS[rec.last.reason] || rec.last.reason) + ")";
    } else {
      stateEl.textContent = "الحالة: مغطّى (بانتظار إطارات آمنة متتالية)";
    }
  };

  v.src = URL.createObjectURL(file);
  show("covered");

  let extra = 4; // عدد مرّات الفحص المسموحة أثناء الإيقاف المؤقت
  const vg = new VideoGuard({
    guard,
    source: {
      captureFrame: async () =>
        v.videoWidth > 0 && v.readyState >= 2 ? await toRawImage(v, 960) : null,
    },
    clearAfter: 2,
    holdMs: 1500,
    onChange: (state) => show(state),
  });

  v.onseeking = () => { vg.reset(); rec.last = null; show("covered"); extra = 4; };
  v.onpause = () => { extra = 4; };
  v.onloadeddata = () => { extra = 4; };

  while (myLoop === videoLoop) {
    if (!v.paused || extra > 0) {
      try { await vg.tick(performance.now()); } catch { /* يبقى مغطّى */ }
      if (myLoop === videoLoop) show(vg.state);
      if (v.paused) extra--;
    }
    await sleep(300);
  }
}

/* ================= ربط الواجهة ================= */
$("reveal").addEventListener("change", (e) => document.body.classList.toggle("reveal", e.target.checked));

$("imgs").addEventListener("change", async (e) => {
  const files = Array.from(e.target.files || []);
  for (const f of files) await handleImage(f); // واحدة بعد الأخرى
  e.target.value = "";
});

$("vid").addEventListener("change", (e) => {
  const f = e.target.files && e.target.files[0];
  if (f) handleVideo(f);
});

loadModels();
