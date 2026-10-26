package dev.mahjoob.core;

/** سبب القرار. المعرّفات النصية تطابق نسخة TypeScript. */
public enum Reason {
    TARGET_GENDER("target-gender"),
    ANY_PERSON("any-person"),
    UNCERTAIN_GENDER("uncertain-gender"),
    LOW_CONFIDENCE("low-confidence"),
    ANALYSIS_ERROR("analysis-error"),
    TIMEOUT("timeout"),
    NO_PERSON("no-person"),
    NO_TARGET("no-target");

    private final String id;

    Reason(String id) {
        this.id = id;
    }

    public String id() {
        return id;
    }
}
