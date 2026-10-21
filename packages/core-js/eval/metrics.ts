import type { Reason } from "../src/index.ts";

/** مجال ثقة ويلسون 95% لنسبة k من n */
export function wilson(k: number, n: number, z = 1.96): { low: number; high: number } {
  if (n === 0) return { low: 0, high: 1 };
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { low: Math.max(0, center - half), high: Math.min(1, center + half) };
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))]!;
}

export interface Outcome {
  path: string;
  tags: string[];
  /** هل كان يجب حجبها؟ */
  positive: boolean;
  blocked: boolean;
  reason: Reason;
}

export interface Summary {
  positives: number;
  negatives: number;
  /** صور كان يجب حجبها لكنها مرّت */
  leaked: number;
  leakRate: number;
  leakCI: { low: number; high: number };
  /** صور آمنة حُجبت */
  overblocked: number;
  overRate: number;
  overCI: { low: number; high: number };
}

export function summarize(outcomes: Outcome[]): Summary {
  const pos = outcomes.filter((o) => o.positive);
  const neg = outcomes.filter((o) => !o.positive);
  const leaked = pos.filter((o) => !o.blocked).length;
  const over = neg.filter((o) => o.blocked).length;
  return {
    positives: pos.length,
    negatives: neg.length,
    leaked,
    leakRate: pos.length ? leaked / pos.length : 0,
    leakCI: wilson(leaked, pos.length),
    overblocked: over,
    overRate: neg.length ? over / neg.length : 0,
    overCI: wilson(over, neg.length),
  };
}

export function byTag(outcomes: Outcome[]): Record<string, Summary> {
  const tags = new Set(outcomes.flatMap((o) => o.tags));
  const res: Record<string, Summary> = {};
  for (const t of [...tags].sort()) res[t] = summarize(outcomes.filter((o) => o.tags.includes(t)));
  return res;
}

export function reasonCounts(outcomes: Outcome[]): Record<string, number> {
  const c: Record<string, number> = {};
  for (const o of outcomes) c[o.reason] = (c[o.reason] ?? 0) + 1;
  return c;
}
