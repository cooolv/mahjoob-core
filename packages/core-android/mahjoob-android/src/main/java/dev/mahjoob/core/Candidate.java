package dev.mahjoob.core;

/** مرشّح كشف: صندوق ودرجة. */
public final class Candidate {
    public final Box box;
    public final double score;

    public Candidate(Box box, double score) {
        this.box = box;
        this.score = score;
    }
}
