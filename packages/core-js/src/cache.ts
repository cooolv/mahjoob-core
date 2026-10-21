/** ذاكرة مؤقتة LRU بسيطة */
export class LruCache<V> {
  private map = new Map<string, V>();
  private readonly max: number;
  constructor(max: number) {
    this.max = max;
  }
  get(key: string): V | undefined {
    const v = this.map.get(key);
    if (v !== undefined) {
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }
  set(key: string, value: V): void {
    this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
  }
  get size(): number {
    return this.map.size;
  }
}
