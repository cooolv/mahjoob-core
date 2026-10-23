/* سيف فيو: content script. يغطّي كل صورة وفيديو (عبر CSS) ثم يكشف ما يسمح به القرار.
 * لا يستورد أي وحدات: التحليل يتم في offscreen document عبر background. */
(function () {
  "use strict";

  const ROOT = document.documentElement;
  const MAX_INFLIGHT = 3;
  const MIN_SIDE = 40;           // الصور الأصغر لا تحوي وجوهًا يُعتدّ بها (أيقونات)
  const SEND_SIDE = 640;         // أكبر ضلع للصورة المرسلة للتحليل
  const VIDEO_SIDE = 480;
  const VIDEO_INTERVAL = 500;
  const VIDEO_CLEAR_AFTER = 2;   // إطاران آمنان متتاليان
  const VIDEO_HOLD_MS = 1500;    // أقل مدة تغطية بعد آخر حجب

  let active = false;
  let generation = 0;            // يزداد عند تغيير الإعدادات لإبطال النتائج القديمة
  let inflight = 0;
  const queue = [];
  const decisions = new Map();   // رابط الصورة => قرار (لكل صفحة)
  let known = new WeakSet();     // العناصر المراقبة
  let processedSrc = new WeakMap(); // آخر رابط بدأ فحصه لكل صورة (يمنع الفحص المزدوج)
  let io = null;
  let mo = null;

  /* ---------- الاتصال بالخلفية ---------- */
  function classify(payload) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: "sv-classify", payload }, (res) => {
          if (chrome.runtime.lastError || !res) resolve({ action: "block", reason: "analysis-error" });
          else resolve(res);
        });
      } catch (e) {
        resolve({ action: "block", reason: "analysis-error" });
      }
    });
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result).split(",")[1] || "");
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(blob);
    });
  }

  /** يرسم المصدر على canvas ويعيد base64 JPEG. يرمي SecurityError إن كان المصدر ملوّثًا (CORS). */
  async function snapshot(source, w, h, maxSide, quality) {
    const k = Math.min(1, maxSide / Math.max(w, h));
    const cw = Math.max(1, Math.round(w * k));
    const ch = Math.max(1, Math.round(h * k));
    const c = document.createElement("canvas");
    c.width = cw;
    c.height = ch;
    const ctx = c.getContext("2d");
    ctx.drawImage(source, 0, 0, cw, ch);
    const blob = await new Promise((res) => c.toBlob(res, "image/jpeg", quality)); // يرمي إن كان ملوّثًا
    if (!blob) throw new Error("toBlob فشل");
    return blobToBase64(blob);
  }

  function setState(el, action, reason, via) {
    if (action !== "allow" && el.tagName === "IMG") {
      // البديل الرمادي يأخذ نفس مقاس الصورة الأصلية (قبل تغيير الحالة، فالتخطيط ما زال كما هو)
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        el.style.setProperty("--sv-w", r.width + "px");
        el.style.setProperty("--sv-h", r.height + "px");
      }
    }
    el.setAttribute("data-sv", action === "allow" ? "ok" : "blocked");
    if (reason) el.setAttribute("data-sv-reason", reason);
    if (via) el.setAttribute("data-sv-via", via);
  }

  /* ---------- الصور ---------- */
  function isSvg(src) {
    return /^data:image\/svg/i.test(src) || /\.svg(\?|#|$)/i.test(src);
  }

  async function processImage(img, gen) {
    if (gen !== generation) return;
    const src = img.currentSrc || img.src;
    if (!src) { setState(img, "allow", "no-src"); return; }
    if (isSvg(src)) { setState(img, "allow", "svg"); return; }
    if (img.naturalWidth < MIN_SIDE || img.naturalHeight < MIN_SIDE) { setState(img, "allow", "tiny"); return; }

    if (decisions.has(src)) {
      const d = decisions.get(src);
      setState(img, d.action, d.reason, "cache");
      return;
    }

    let res, via;
    try {
      const data = await snapshot(img, img.naturalWidth, img.naturalHeight, SEND_SIDE, 0.85);
      via = "canvas";
      res = await classify({ kind: "data", data, mime: "image/jpeg", key: src });
    } catch (e) {
      // صورة من أصل آخر بلا CORS: نطلب من الإضافة جلبها بنفسها
      if (/^https?:/i.test(src)) {
        via = "url";
        res = await classify({ kind: "url", url: src, key: src });
      } else {
        res = { action: "block", reason: "analysis-error" };
        via = "none";
      }
    }
    if (gen !== generation) return;
    if (!/^data:/i.test(src)) decisions.set(src, { action: res.action, reason: res.reason });
    setState(img, res.action, res.reason, via);
  }

  function enqueueImage(img) {
    if (!active) return;
    const gen = generation;
    const run = () => {
      if (gen !== generation) return;
      const cur = img.currentSrc || img.src;
      if (processedSrc.get(img) === cur) return;          // بدأ فحص هذا الرابط بالفعل
      processedSrc.set(img, cur);
      queue.push(async () => {
        try { await processImage(img, gen); }
        catch (e) { if (gen === generation) setState(img, "block", "analysis-error"); }
      });
      pump();
    };
    if (img.complete && img.naturalWidth > 0) run();
    else if (img.complete) setState(img, "allow", "broken");        // صورة تالفة: لا شيء لإخفائه
    else {
      img.addEventListener("load", run, { once: true });
      img.addEventListener("error", () => setState(img, "allow", "broken"), { once: true });
    }
  }

  function pump() {
    while (inflight < MAX_INFLIGHT && queue.length) {
      const job = queue.shift();
      inflight++;
      job().finally(() => { inflight--; pump(); });
    }
  }

  function watchImage(img) {
    if (known.has(img)) return;
    known.add(img);
    img.addEventListener("load", () => {
      // تغيّر currentSrc بعد فحص سابق (srcset/picture/تغيير src): نعيد الفحص
      const cur = img.currentSrc || img.src;
      if (processedSrc.has(img) && processedSrc.get(img) !== cur) {
        processedSrc.delete(img);
        img.removeAttribute("data-sv");
        enqueueImage(img);
      }
    });
    if (io) io.observe(img); else enqueueImage(img);
  }

  /* ---------- الفيديو ---------- */
  function watchVideo(v) {
    if (known.has(v)) return;
    known.add(v);
    let clean = 0;
    let lastBlock = -Infinity;
    let extra = 4;
    let permanent = false;
    const gen = generation;

    const cover = () => { if (!permanent) v.removeAttribute("data-sv"); };
    const reset = () => { clean = 0; extra = 4; cover(); };
    v.addEventListener("seeking", reset);
    v.addEventListener("loadstart", reset);
    v.addEventListener("emptied", reset);
    v.addEventListener("pause", () => { extra = 4; });
    v.addEventListener("loadeddata", () => { extra = 4; });

    const tick = async () => {
      if (gen !== generation || !active) return;
      if (permanent) return;
      if (!v.paused || extra > 0) {
        if (v.readyState >= 2 && v.videoWidth > 0) {
          try {
            const data = await snapshot(v, v.videoWidth, v.videoHeight, VIDEO_SIDE, 0.7);
            const res = await classify({ kind: "data", data, mime: "image/jpeg" });
            if (gen !== generation) return;
            const now = performance.now();
            if (res.action === "block") {
              clean = 0; lastBlock = now;
              v.removeAttribute("data-sv");
              v.setAttribute("data-sv-reason", res.reason || "block");
            } else {
              clean++;
              if (clean >= VIDEO_CLEAR_AFTER && now - lastBlock >= VIDEO_HOLD_MS) {
                v.setAttribute("data-sv", "ok");
                v.setAttribute("data-sv-reason", res.reason || "ok");
              }
            }
          } catch (e) {
            // إطار لا يمكن قراءته (مصدر من أصل آخر/محمي): يبقى الفيديو مغطّى نهائيًا
            permanent = true;
            v.setAttribute("data-sv", "blocked");
            v.setAttribute("data-sv-reason", "unreadable-video");
            return;
          }
          if (v.paused) extra--;
        } else {
          cover();
        }
      }
      setTimeout(tick, VIDEO_INTERVAL);
    };
    tick();
  }

  /* ---------- المسح والمراقبة ---------- */
  function scan(node) {
    if (!node || node.nodeType !== 1) return;
    if (node.tagName === "IMG") watchImage(node);
    else if (node.tagName === "VIDEO") watchVideo(node);
    if (node.querySelectorAll) {
      node.querySelectorAll("img").forEach(watchImage);
      node.querySelectorAll("video").forEach(watchVideo);
    }
  }

  function startObserving() {
    io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) { io.unobserve(e.target); enqueueImage(e.target); }
      }
    }, { rootMargin: "800px" });

    mo = new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === "childList") {
          m.addedNodes.forEach(scan);
        } else if (m.type === "attributes" && m.target.tagName === "IMG") {
          const img = m.target;
          img.removeAttribute("data-sv");
          processedSrc.delete(img);
          if (known.has(img)) enqueueImage(img); else watchImage(img);
        } else if (m.type === "attributes" && m.target.tagName === "VIDEO") {
          m.target.removeAttribute("data-sv");
        }
      }
    });
    mo.observe(ROOT, { childList: true, subtree: true, attributes: true, attributeFilter: ["src", "srcset"] });
    scan(ROOT);
  }

  function teardown() {
    generation++;
    queue.length = 0;
    if (mo) { mo.disconnect(); mo = null; }
    if (io) { io.disconnect(); io = null; }
  }

  function apply(s) {
    const off = !s.enabled || (s.disabledHosts || []).includes(location.hostname);
    teardown();
    if (off) {
      active = false;
      ROOT.setAttribute("data-sv-off", "1");
      return;
    }
    // تفعيل أو إعادة تفعيل: نبطل النتائج القديمة ونعيد الفحص
    decisions.clear();
    known = new WeakSet();
    processedSrc = new WeakMap();
    document.querySelectorAll("img[data-sv], video[data-sv]").forEach((el) => el.removeAttribute("data-sv"));
    ROOT.removeAttribute("data-sv-off");
    active = true;
    startObserving();
  }

  /* ---------- البدء ---------- */
  (async () => {
    let s;
    try { s = await self.svGetSettings(); }
    catch (e) { return; }                       // تعذّرت قراءة الإعدادات: يبقى كل شيء مخفيًّا (Fail-Closed)
    apply(s);
    chrome.storage.onChanged.addListener((_c, area) => {
      if (area !== "local") return;
      self.svGetSettings().then(apply).catch(() => {});
    });
  })();
})();
