/**
 * In-process TTL cache used by the meta plugin's route layer to coalesce
 * identical provider calls within a short window. Providers MAY hold their
 * own cache too; the meta cache exists primarily to dampen accidental UI
 * polling storms.
 */

export interface CacheEntry<T> {
  ts: number;
  ttlMs: number;
  value: T;
}

export class TtlCache<T = unknown> {
  private store = new Map<string, CacheEntry<T>>();

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.ts > entry.ttlMs) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T, ttlMs: number): void {
    this.store.set(key, { ts: Date.now(), ttlMs, value });
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

export const META_CACHE = new TtlCache();
