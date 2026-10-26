package dev.mahjoob.core;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/** محرك القرار (دوال صافية). القاعدة: إن لم نتأكد أن الصورة آمنة نحجبها (في الوضع الصارم). */
public final class PolicyEngine {
    private PolicyEngine() {}

    /** احتمال الجنس المستهدف لكشف واحد، أو null إن كان غير محسوم. */
    private static Double pTarget(PersonDetection d, Policy p) {
        if (d.pFemale == null) return null;
        double gc = d.genderConfidence == null ? 0 : d.genderConfidence;
        if (gc < p.minGenderConfidence) return null;
        if (p.target == TargetGender.ANY) return 1.0;
        double pf = Math.min(1, Math.max(0, d.pFemale));
        return p.target == TargetGender.FEMALE ? pf : 1 - pf;
    }

    public static Decision decide(List<PersonDetection> detections, Policy policy) {
        List<Box> blocked = new ArrayList<Box>();
        Reason reason = null;

        // وضع ANY: لا نصنّف الجنس إطلاقًا، أي شخص مكتشف => حجب
        if (policy.target == TargetGender.ANY) {
            for (PersonDetection d : detections) {
                if (d.confidence >= policy.minPersonConfidence) {
                    blocked.add(d.box);
                    reason = Reason.ANY_PERSON;
                } else if (policy.strict && d.confidence > 0) {
                    blocked.add(d.box);
                    if (reason == null) reason = Reason.LOW_CONFIDENCE;
                }
            }
            if (!blocked.isEmpty()) return new Decision(Action.BLOCK, reason, blocked);
            return new Decision(Action.ALLOW, Reason.NO_PERSON, Collections.<Box>emptyList());
        }

        for (PersonDetection d : detections) {
            boolean isPerson = d.confidence >= policy.minPersonConfidence;
            Double p = pTarget(d, policy);

            if (p != null && p >= policy.blockThreshold) {
                blocked.add(d.box);
                reason = Reason.TARGET_GENDER;
            } else if (policy.strict && isPerson && p == null) {
                blocked.add(d.box);
                if (reason == null) reason = Reason.UNCERTAIN_GENDER;
            } else if (policy.strict && !isPerson && d.confidence > 0) {
                // كشف ضعيف: قد يكون شخصًا بعيدًا أو صغيرًا
                blocked.add(d.box);
                if (reason == null) reason = Reason.LOW_CONFIDENCE;
            }
        }

        if (!blocked.isEmpty()) {
            return new Decision(Action.BLOCK, reason == null ? Reason.TARGET_GENDER : reason, blocked);
        }
        if (detections.isEmpty()) return new Decision(Action.ALLOW, Reason.NO_PERSON, Collections.<Box>emptyList());
        return new Decision(Action.ALLOW, Reason.NO_TARGET, Collections.<Box>emptyList());
    }
}
