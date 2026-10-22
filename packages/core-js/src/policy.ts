import type { Box, Decision, PersonDetection, Policy } from "./types.ts";

/** احتمال الجنس المستهدف لكشف واحد، أو undefined إن كان غير محسوم */
function pTarget(d: PersonDetection, p: Policy): number | undefined {
  if (d.pFemale === undefined) return undefined;
  if ((d.genderConfidence ?? 0) < p.minGenderConfidence) return undefined;
  if (p.target === "any") return 1;
  const pf = Math.min(1, Math.max(0, d.pFemale));
  return p.target === "female" ? pf : 1 - pf;
}

/**
 * محرك القرار (دالة صافية، بلا آثار جانبية).
 * القاعدة: إن لم نتأكد أن الصورة آمنة، نحجبها (في الوضع الصارم).
 */
export function decide(detections: PersonDetection[], policy: Policy): Decision {
  const blocked: Box[] = [];
  let reason: Decision["reason"] | undefined;

  // وضع "any": لا نصنّف الجنس إطلاقًا، أي شخص مكتشف => حجب
  if (policy.target === "any") {
    for (const d of detections) {
      if (d.confidence >= policy.minPersonConfidence) {
        blocked.push(d.box);
        reason = "any-person";
      } else if (policy.strict && d.confidence > 0) {
        blocked.push(d.box);
        reason ??= "low-confidence";
      }
    }
    if (blocked.length > 0) return { action: "block", reason: reason!, regions: blocked };
    return { action: "allow", reason: "no-person", regions: [] };
  }

  for (const d of detections) {
    const isPerson = d.confidence >= policy.minPersonConfidence;
    const p = pTarget(d, policy);

    if (p !== undefined && p >= policy.blockThreshold) {
      blocked.push(d.box);
      reason = "target-gender";
    } else if (policy.strict && isPerson && p === undefined) {
      blocked.push(d.box);
      reason ??= "uncertain-gender";
    } else if (policy.strict && !isPerson && d.confidence > 0) {
      // كشف ضعيف: قد يكون شخصًا بعيدًا أو صغيرًا
      blocked.push(d.box);
      reason ??= "low-confidence";
    }
  }

  if (blocked.length > 0) {
    return { action: "block", reason: reason ?? "target-gender", regions: blocked };
  }
  if (detections.length === 0) return { action: "allow", reason: "no-person", regions: [] };
  return { action: "allow", reason: "no-target", regions: [] };
}
