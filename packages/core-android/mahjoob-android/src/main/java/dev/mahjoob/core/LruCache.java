package dev.mahjoob.core;

import java.util.LinkedHashMap;
import java.util.Map;

/** ذاكرة مؤقتة LRU بسيطة (غير آمنة للخيوط: غلّفها بـsynchronized). */
final class LruCache<V> {
    private final LinkedHashMap<String, V> map;

    LruCache(final int max) {
        this.map = new LinkedHashMap<String, V>(16, 0.75f, true) {
            @Override
            protected boolean removeEldestEntry(Map.Entry<String, V> eldest) {
                return size() > max;
            }
        };
    }

    V get(String key) {
        return map.get(key);
    }

    void put(String key, V value) {
        map.put(key, value);
    }

    int size() {
        return map.size();
    }
}
