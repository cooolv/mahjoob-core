import { ImageGuard, createYuNetGenderV1Analyzer, serialized, toRawImage } from "./core/index.js";

const MAX_BYTES = 25 * 1024 * 1024;
let state = "idle";            // idle | loading | ready | error
let lastError = null;
let analyzerPromise = null;
const guards = new Map();

function getAnalyzer() {
  if (!analyzerPromise) {
    state = "loading";
    analyzerPromise = (async () => {
      const ort = self.ort;
      if (!ort) throw new Error("onnxruntime-web غير محمَّل");
      ort.env.wasm.wasmPaths = chrome.runtime.getURL("vendor/");
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.proxy = false;
      const opts = { executionProviders: ["wasm"] };
      const [yunetSession, genderSession] = await Promise.all([
        ort.InferenceSession.create(chrome.runtime.getURL("models/face_detection_yunet_2023mar.onnx"), opts),
        ort.InferenceSession.create(chrome.runtime.getURL("models/gender-v1.onnx"), opts),
      ]);
      state = "ready";
      lastError = null;
      return serialized(createYuNetGenderV1Analyzer({ ort, yunetSession, genderSession }));
    })();
    analyzerPromise.catch((e) => {
      state = "error";
      lastError = String(e && e.message ? e.message : e);
      analyzerPromise = null;              // يسمح بإعادة المحاولة عند الطلب التالي
    });
  }
  return analyzerPromise;
}

async function getGuard(settings) {
  const key = [settings.target, settings.strict, settings.blockThreshold].join("|");
  let g = guards.get(key);
  if (!g) {
    g = new ImageGuard({
      analyzer: await getAnalyzer(),
      target: settings.target,
      policy: { strict: !!settings.strict, blockThreshold: Number(settings.blockThreshold) || 0.2, timeoutMs: 20000 },
      cacheSize: 300,
    });
    guards.set(key, g);
  }
  return g;
}

async function toBlob(payload) {
  if (payload.kind === "data") {
    if (typeof payload.data !== "string" || payload.data.length > MAX_BYTES * 1.4) throw new Error("حجم غير مقبول");
    const mime = /^image\/(jpeg|png|webp)$/.test(payload.mime) ? payload.mime : "image/jpeg";
    const r = await fetch("data:" + mime + ";base64," + payload.data);
    return r.blob();
  }
  if (payload.kind === "url") {
    const u = new URL(payload.url);
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("بروتوكول غير مسموح");
    const r = await fetch(u.href, { credentials: "include" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const b = await r.blob();
    if (b.size > MAX_BYTES) throw new Error("صورة كبيرة جدًا");
    return b;
  }
  throw new Error("نوع طلب غير معروف");
}

async function classify(msg) {
  try {
    const guard = await getGuard(msg.settings);
    const blob = await toBlob(msg.payload);
    const bitmap = await createImageBitmap(blob);
    let raw;
    try { raw = await toRawImage(bitmap, 1280); } finally { bitmap.close(); }
    const d = await guard.check(raw, msg.payload.key ? "k:" + msg.payload.key : undefined);
    return { action: d.action, reason: d.reason };
  } catch (e) {
    return { action: "block", reason: "analysis-error", error: String(e && e.message ? e.message : e) };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.target !== "offscreen") return false;
  if (msg.type === "classify") {
    classify(msg).then(sendResponse);
    return true;
  }
  if (msg.type === "status") {
    sendResponse({ state, error: lastError });
    return false;
  }
  return false;
});
