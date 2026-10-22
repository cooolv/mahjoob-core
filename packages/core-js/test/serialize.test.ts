import { test } from "node:test";
import assert from "node:assert/strict";
import { serialized } from "../src/index.ts";
import type { PersonAnalyzer } from "../src/index.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("serialized: لا يتداخل استدعاءان أبدًا", async () => {
  let active = 0, maxActive = 0;
  const inner: PersonAnalyzer = {
    async analyze() { active++; maxActive = Math.max(maxActive, active); await sleep(10); active--; return []; },
  };
  const s = serialized(inner);
  await Promise.all([s.analyze(1), s.analyze(2), s.analyze(3), s.analyze(4)]);
  assert.equal(maxActive, 1);
});

test("serialized: فشل استدعاء لا يوقف الطابور، والترتيب محفوظ", async () => {
  const order: number[] = [];
  const inner: PersonAnalyzer = {
    async analyze(x) { order.push(x as number); if (x === 2) throw new Error("boom"); return []; },
  };
  const s = serialized(inner);
  const rs = await Promise.allSettled([s.analyze(1), s.analyze(2), s.analyze(3)]);
  assert.deepEqual(rs.map((r) => r.status), ["fulfilled", "rejected", "fulfilled"]);
  assert.deepEqual(order, [1, 2, 3]);
});

test("serialized: استدعاء ملغى قبل أن يبدأ لا يشغّل النموذج", async () => {
  let calls = 0;
  const inner: PersonAnalyzer = { async analyze() { calls++; await sleep(20); return []; } };
  const s = serialized(inner);
  const ctrl = new AbortController();
  const first = s.analyze(1);
  const second = s.analyze(2, ctrl.signal);
  ctrl.abort();
  await first;
  await assert.rejects(second, /أُلغي/);
  assert.equal(calls, 1);
});
