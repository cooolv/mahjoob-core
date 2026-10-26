package dev.mahjoob.core;

import java.util.List;

/**
 * واجهة المحلّل: تُنفَّذ بنموذج حقيقي (انظر OnnxAnalyzer). قد تُستدعى من خيط خلفي
 * وقد تُقاطَع (Thread.interrupt) عند انتهاء المهلة، فاحترم المقاطعة حين يمكن.
 */
public interface PersonAnalyzer {
    List<PersonDetection> analyze(RawImage image) throws Exception;
}
