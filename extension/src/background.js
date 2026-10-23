/* سيف فيو: service worker. يمرّر طلبات الفحص إلى offscreen document حيث تعمل النماذج. */
importScripts("settings.js");

const OFFSCREEN_URL = "offscreen.html";
let creating = null;

async function ensureOffscreen() {
  const existing = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
  if (existing.length > 0) return;
  if (!creating) {
    creating = chrome.offscreen
      .createDocument({
        url: OFFSCREEN_URL,
        reasons: ["WORKERS"],
        justification: "تشغيل نماذج ONNX محليًا (WebAssembly) لفحص الصور على الجهاز",
      })
      .finally(() => { creating = null; });
  }
  await creating;
}

async function toOffscreen(message) {
  await ensureOffscreen();
  let lastErr;
  for (let i = 0; i < 25; i++) {
    try {
      const res = await chrome.runtime.sendMessage(Object.assign({ target: "offscreen" }, message));
      if (res !== undefined) return res;
    } catch (e) {
      lastErr = e;                                  // المستمع في offscreen لم يجهز بعد
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw lastErr || new Error("offscreen لا يستجيب");
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg !== "object") return false;

  if (msg.type === "sv-classify") {
    (async () => {
      try {
        const s = await self.svGetSettings();
        const res = await toOffscreen({
          type: "classify",
          settings: { target: s.target, strict: s.strict, blockThreshold: s.blockThreshold },
          payload: msg.payload,
        });
        sendResponse(res);
      } catch (e) {
        sendResponse({ action: "block", reason: "analysis-error", error: String(e && e.message ? e.message : e) });
      }
    })();
    return true;
  }

  if (msg.type === "sv-status") {
    (async () => {
      try {
        const contexts = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
        if (contexts.length === 0) { sendResponse({ state: "idle" }); return; }
        sendResponse(await toOffscreen({ type: "status" }));
      } catch (e) {
        sendResponse({ state: "error", error: String(e && e.message ? e.message : e) });
      }
    })();
    return true;
  }
  return false;
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") chrome.storage.local.set({ configured: false });
});
