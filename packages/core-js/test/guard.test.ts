import { test } from "node:test";
import assert from "node:assert/strict";
import { ImageGuard } from "../src/index.ts";
import type { PersonAnalyzer, PersonDetection } from "../src/index.ts";

// ملاحظة: هذه محلّلات وهمية للاختبار فقط، وليست نموذجًا حقيقيًا.
const box = { x: 0, y: 0, width: 1, height: 1 };
const fake = (res: PersonDetection[], calls = { n: 0 }): PersonAnalyzer => ({
  async analyze() { calls.n++; return res; },
});

test("خطأ في المحلّل => حجب", async () => {
  const g = new ImageGuard({ target: "female", analyzer: { analyze: async () => { throw new Error("x"); } } });
  const d = await g.check("img");
  assert.deepEqual([d.action, d.reason], ["block", "analysis-error"]);
});

test("انتهاء المهلة => حجب", async () => {
  const slow: PersonAnalyzer = { analyze: () => new Promise(() => {}) };
  const g = new ImageGuard({ target: "female", analyzer: slow, policy: { timeoutMs: 20 } });
  const d = await g.check("img");
  assert.deepEqual([d.action, d.reason], ["block", "timeout"]);
});

test("الخطأ يُسمح به فقط إن عُطّل الصارم", async () => {
  const g = new ImageGuard({ target: "female", policy: { strict: false },
    analyzer: { analyze: async () => { throw new Error("x"); } } });
  assert.equal((await g.check("img")).action, "allow");
});

test("الذاكرة المؤقتة تمنع إعادة التحليل", async () => {
  const calls = { n: 0 };
  const g = new ImageGuard({ target: "female", analyzer: fake([{ box, confidence: 0.9, pFemale: 0.01, genderConfidence: 0.9 }], calls) });
  await g.check("a", "k1");
  await g.check("a", "k1");
  assert.equal(calls.n, 1);
});

test("الأخطاء لا تُخزَّن في الذاكرة المؤقتة", async () => {
  let n = 0;
  const g = new ImageGuard({ target: "female", analyzer: { analyze: async () => { n++; throw new Error("x"); } } });
  await g.check("a", "k");
  await g.check("a", "k");
  assert.equal(n, 2);
});
