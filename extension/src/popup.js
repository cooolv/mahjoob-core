(async () => {
  const $ = (id) => document.getElementById(id);
  const s = await self.svGetSettings();

  let host = "";
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url && /^https?:/.test(tab.url)) host = new URL(tab.url).hostname;
  } catch (e) { /* بلا تبويب */ }

  const save = (patch) => chrome.storage.local.set(patch);

  $("enabled").checked = s.enabled;
  $("target").value = s.target;
  $("strict").checked = s.strict;
  $("thr").value = s.blockThreshold;
  $("firstrun").hidden = !!s.configured;
  $("thrrow").hidden = s.target === "any";
  if (host) { $("host").textContent = host; $("siteoff").checked = (s.disabledHosts || []).includes(host); }
  else { $("siteoff").disabled = true; }

  $("enabled").addEventListener("change", (e) => save({ enabled: e.target.checked }));
  $("target").addEventListener("change", (e) => {
    $("thrrow").hidden = e.target.value === "any";
    $("firstrun").hidden = true;
    save({ target: e.target.value, configured: true });
  });
  $("strict").addEventListener("change", (e) => save({ strict: e.target.checked }));
  $("thr").addEventListener("change", (e) => {
    const v = Math.min(0.9, Math.max(0.05, Number(e.target.value) || 0.2));
    e.target.value = v;
    save({ blockThreshold: v });
  });
  $("siteoff").addEventListener("change", async (e) => {
    const cur = (await self.svGetSettings()).disabledHosts || [];
    const next = e.target.checked ? Array.from(new Set(cur.concat(host))) : cur.filter((h) => h !== host);
    save({ disabledHosts: next });
  });

  const labels = { idle: "لم تُحمَّل بعد (تُحمَّل عند أول صورة)", loading: "جارٍ التحميل…", ready: "جاهزة" };
  chrome.runtime.sendMessage({ type: "sv-status" }, (res) => {
    const el = $("status");
    if (chrome.runtime.lastError || !res) { el.textContent = "النماذج: لا استجابة"; return; }
    el.textContent = res.state === "error"
      ? "النماذج: خطأ (الصور تبقى محجوبة): " + (res.error || "")
      : "النماذج: " + (labels[res.state] || res.state);
  });
})();
