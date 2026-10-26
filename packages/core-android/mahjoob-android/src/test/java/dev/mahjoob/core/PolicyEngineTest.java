package dev.mahjoob.core;

import static org.junit.Assert.assertEquals;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import org.junit.Test;

public class PolicyEngineTest {
    private static Policy female() { return Policy.defaults(TargetGender.FEMALE); }

    private static Decision d(Policy p, PersonDetection... dets) {
        return PolicyEngine.decide(new ArrayList<PersonDetection>(Arrays.asList(dets)), p);
    }

    @Test
    public void noPeopleAllows() {
        Decision r = PolicyEngine.decide(new ArrayList<PersonDetection>(), female());
        assertEquals(Action.ALLOW, r.action);
        assertEquals(Reason.NO_PERSON, r.reason);
    }

    @Test
    public void clearFemaleBlockedMaleAllowed() {
        assertEquals(Action.BLOCK, d(female(), TestUtil.det(0.95, 0.95, 0.9)).action);
        assertEquals(Action.ALLOW, d(female(), TestUtil.det(0.02, 0.98, 0.9)).action);
    }

    @Test
    public void targetMale() {
        Policy male = Policy.defaults(TargetGender.MALE);
        assertEquals(Action.BLOCK, d(male, TestUtil.det(0.02, 0.98, 0.9)).action);
        assertEquals(Action.ALLOW, d(male, TestUtil.det(0.98, 0.98, 0.9)).action);
    }

    @Test
    public void lowThresholdBlocksUncertainTargetProbability() {
        assertEquals(Action.BLOCK, d(female(), TestUtil.det(0.25, 0.9, 0.9)).action);
    }

    @Test
    public void unresolvedGenderBlocksInStrictOnly() {
        Decision strict = d(female(), TestUtil.det(0.05, 0.3, 0.9));
        assertEquals(Action.BLOCK, strict.action);
        assertEquals(Reason.UNCERTAIN_GENDER, strict.reason);
        Policy lenient = new Policy.Builder(TargetGender.FEMALE).strict(false).build();
        assertEquals(Action.ALLOW, d(lenient, new PersonDetection(TestUtil.box(), 0.9)).action);
    }

    @Test
    public void weakDetectionBlocksInStrict() {
        Decision r = d(female(), new PersonDetection(TestUtil.box(), 0.1));
        assertEquals(Action.BLOCK, r.action);
        assertEquals(Reason.LOW_CONFIDENCE, r.reason);
    }

    @Test
    public void outOfRangeProbabilitiesDontBreak() {
        assertEquals(Action.BLOCK, d(female(), TestUtil.det(7, 0.9, 0.9)).action);
        assertEquals(Action.ALLOW, d(female(), TestUtil.det(-3, 0.9, 0.9)).action);
    }

    @Test
    public void anyModeBlocksAnyPerson() {
        Policy any = Policy.defaults(TargetGender.ANY);
        Decision r = d(any, TestUtil.det(0.01, 0.9, 0.9));
        assertEquals(Action.BLOCK, r.action);
        assertEquals(Reason.ANY_PERSON, r.reason);
        assertEquals(Action.ALLOW, PolicyEngine.decide(new ArrayList<PersonDetection>(), any).action);
    }

    @Test
    public void multipleRegionsReported() {
        List<PersonDetection> l = new ArrayList<PersonDetection>();
        l.add(TestUtil.det(0.01, 0.9, 0.9));
        l.add(new PersonDetection(new Box(5, 5, 2, 2), 0.9, 0.9, 0.9));
        Decision r = PolicyEngine.decide(l, female());
        assertEquals(Action.BLOCK, r.action);
        assertEquals(1, r.regions.size());
    }
}
