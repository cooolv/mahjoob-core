import { test } from "node:test";
import assert from "node:assert/strict";
import { ImageGuard, VideoGuard } from "../src/index.ts";
import type { PersonAnalyzer } from "../src/index.ts";

// إطارات وهمية: "safe" أو "target" أو "none" (للاختبار فقط)
const box = { x: 0, y: 0, width: 1, height: 1 };
const analyzer: PersonAnalyzer = {
  async analyze(frame) {
    if (frame === "target") return [{ box, confidence: 0.9, pFemale: 0.95, genderConfidence: 0.9 }];
    if (frame === "safe") return [{ box, confidence: 0.9, pFemale: 0.01, genderConfidence: 0.9 }];
    return [];
  },
};

function make(frames: Array<string | null>, extra = {}) {
  let i = 0;
  const guard = new ImageGuard({ target: "female", analyzer });
  return new VideoGuard({ guard, source: { captureFrame: async () => frames[i++] ?? null }, holdMs: 1000, ...extra });
}

test("تبدأ مغطّاة", () => {
  assert.equal(make([]).state, "covered");
});

test("لا ترفع التغطية قبل إطارين آمنين متتاليين", async () => {
  const v = make(["safe", "safe"]);
  assert.equal(await v.tick(0), "covered");
  assert.equal(await v.tick(500), "clear");
});

test("إطار مستهدف يعيد التغطية فورًا ويصفّر العدّ", async () => {
  const v = make(["safe", "safe", "target", "safe", "safe"]);
  await v.tick(0); await v.tick(500);
  assert.equal(v.state, "clear");
  assert.equal(await v.tick(1000), "covered"); // إطار مستهدف
  assert.equal(await v.tick(1500), "covered"); // إطار آمن واحد فقط
  assert.equal(await v.tick(2100), "clear");   // إطاران آمنان + انتهت مدة التثبيت
});

test("مدة التثبيت تمنع الرفع حتى مع إطارات آمنة كافية", async () => {
  const v = make(["target", "safe", "safe", "safe"]);
  await v.tick(1000);                          // حجب عند 1000
  await v.tick(1200);
  assert.equal(await v.tick(1400), "covered"); // إطاران آمنان لكن 400ms < 1000ms
  assert.equal(await v.tick(2100), "clear");   // مرّت مدة التثبيت
});

test("فشل التقاط الإطار => تغطية", async () => {
  const v = make(["safe", "safe", null]);
  await v.tick(0); await v.tick(500);
  assert.equal(await v.tick(1000), "covered");
});

test("reset يغطّي فورًا", async () => {
  const v = make(["safe", "safe"]);
  await v.tick(0); await v.tick(500);
  v.reset();
  assert.equal(v.state, "covered");
});
