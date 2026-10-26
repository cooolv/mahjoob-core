package dev.mahjoob.core;

import java.util.Collections;
import java.util.List;

public final class Decision {
    public final Action action;
    public final Reason reason;
    /** المناطق التي سببت الحجب (للتغطية الجزئية الاختيارية). */
    public final List<Box> regions;

    public Decision(Action action, Reason reason, List<Box> regions) {
        this.action = action;
        this.reason = reason;
        this.regions = Collections.unmodifiableList(regions);
    }

    public boolean isBlocked() {
        return action == Action.BLOCK;
    }

    @Override
    public String toString() {
        return "Decision(" + action + ", " + reason.id() + ", regions=" + regions.size() + ")";
    }
}
