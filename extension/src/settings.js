/* الإعدادات الافتراضية (تُحمَّل في content script وbackground وpopup) */
self.SV_DEFAULTS = {
  enabled: true,
  /** female | male | any. الافتراضي "any" = أشدّ احتياطًا حتى يختار المستخدم */
  target: "any",
  strict: true,
  blockThreshold: 0.2,
  disabledHosts: [],
  configured: false,
};

self.svGetSettings = async function svGetSettings() {
  const stored = await chrome.storage.local.get(null);
  return Object.assign({}, self.SV_DEFAULTS, stored);
};
