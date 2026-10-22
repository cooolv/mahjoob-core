import { test } from "node:test";
import assert from "node:assert/strict";
import { decide, DEFAULT_POLICY } from "../src/index.ts";
import type { PersonDetection, Policy } from "../src/index.ts";

const box = { x: 0, y: 0, width: 10, height: 10 };
const pol = (o: Partial<Policy> = {}): Policy => ({ ...DEFAULT_POLICY, target: "female", ...o });
const det = (o: Partial<PersonDetection> = {}): PersonDetection => ({
  box, confidence: 0.9, pFemale: 0.5, genderConfidence: 0.9, ...o,
});

test("لا أشخاص => سماح", () => {
  assert.equal(decide([], pol()).action, "allow");
});

test("أنثى واضحة مع هدف أنثى => حجب", () => {
  const r = decide([det({ pFemale: 0.95 })], pol());
  assert.equal(r.action, "block");
  assert.equal(r.reason, "target-gender");
  assert.equal(r.regions.length, 1);
});

test("ذكر واضح مع هدف أنثى => سماح", () => {
  assert.equal(decide([det({ pFemale: 0.02 })], pol()).action, "allow");
});

test("الهدف ذكر: ذكر واضح => حجب، أنثى واضحة => سماح", () => {
  assert.equal(decide([det({ pFemale: 0.02 })], pol({ target: "male" })).action, "block");
  assert.equal(decide([det({ pFemale: 0.98 })], pol({ target: "male" })).action, "allow");
});

test("العتبة منخفضة: احتمال 0.25 للهدف => حجب", () => {
  assert.equal(decide([det({ pFemale: 0.25 })], pol()).action, "block");
});

test("جنس غير محسوم (ثقة منخفضة) => حجب في الوضع الصارم", () => {
  const r = decide([det({ pFemale: 0.05, genderConfidence: 0.3 })], pol());
  assert.equal(r.action, "block");
  assert.equal(r.reason, "uncertain-gender");
});

test("جنس غير محسوم => سماح إن عُطّل الوضع الصارم", () => {
  assert.equal(decide([det({ pFemale: undefined })], pol({ strict: false })).action, "allow");
});

test("كشف ضعيف => حجب في الصارم", () => {
  const r = decide([det({ confidence: 0.1, pFemale: undefined })], pol());
  assert.equal(r.action, "block");
  assert.equal(r.reason, "low-confidence");
});

test("شخصان: واحد مسموح وواحد مستهدف => حجب مع منطقة واحدة", () => {
  const r = decide([det({ pFemale: 0.01 }), det({ pFemale: 0.9, box: { x: 5, y: 5, width: 2, height: 2 } })], pol());
  assert.equal(r.action, "block");
  assert.equal(r.regions.length, 1);
});

test("قيم خارج المدى لا تكسر الدالة", () => {
  assert.equal(decide([det({ pFemale: 7 })], pol()).action, "block");
  assert.equal(decide([det({ pFemale: -3 })], pol()).action, "allow");
});

test('وضع "any": أي شخص يُحجب بلا تصنيف جنس', () => {
  const r = decide([det({ pFemale: 0.01 })], pol({ target: "any" }));
  assert.deepEqual([r.action, r.reason], ["block", "any-person"]);
  assert.equal(decide([det({ pFemale: undefined, genderConfidence: undefined })], pol({ target: "any" })).action, "block");
});

test('وضع "any": لا أشخاص => سماح، وكشف ضعيف => حجب في الصارم فقط', () => {
  assert.equal(decide([], pol({ target: "any" })).action, "allow");
  const weak = det({ confidence: 0.1, pFemale: undefined });
  assert.equal(decide([weak], pol({ target: "any" })).action, "block");
  assert.equal(decide([weak], pol({ target: "any", strict: false })).action, "allow");
});
