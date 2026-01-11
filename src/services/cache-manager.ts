export interface CacheOptions {
  ttl?: number;
  maxSize?: number;
  name?: string;
}

export interface CacheEntry<T> {
  value: T;
  timestamp: number;
  key: string;
}

export interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  evictions: number;
}

export class ScraperCache<T> {
  private cache = new Map<string, CacheEntry<T>>();
  private readonly ttl: number;
  private readonly maxSize: number;
  private readonly name: string;
  
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    size: 0,
    evictions: 0,
  };

  constructor(options: CacheOptions = {}) {
    this.ttl = options.ttl ?? 60 * 1000;
    this.maxSize = options.maxSize ?? 1000;
    this.name = options.name ?? 'cache';
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    
    if (!entry) {
      this.stats.misses++;
      return undefined;
    }

    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key);
      this.stats.misses++;
      this.stats.size = this.cache.size;
      return undefined;
    }

    this.stats.hits++;
    return entry.value;
  }

  set(key: string, value: T): void {
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      this.evictOldest();
    }

    this.cache.set(key, {
      key,
      value,
      timestamp: Date.now(),
    });
    this.stats.size = this.cache.size;
  }

  setMany(entries: Array<{ key: string; value: T }>): void {
    for (const { key, value } of entries) {
      this.set(key, value);
    }
  }

  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    
    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key);
      this.stats.size = this.cache.size;
      return false;
    }
    
    return true;
  }

  delete(key: string): boolean {
    const result = this.cache.delete(key);
    this.stats.size = this.cache.size;
    return result;
  }

  clear(): void {
    this.cache.clear();
    this.stats.size = 0;
  }

  getAll(): T[] {
    const now = Date.now();
    const results: T[] = [];
    
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp <= this.ttl) {
        results.push(entry.value);
      } else {
        this.cache.delete(key);
      }
    }
    
    this.stats.size = this.cache.size;
    return results;
  }

  getStats(): CacheStats {
    return { ...this.stats };
  }

  getHitRate(): number {
    const total = this.stats.hits + this.stats.misses;
    return total === 0 ? 0 : this.stats.hits / total;
  }

  isEmpty(): boolean {
    this.pruneExpired();
    return this.cache.size === 0;
  }

  get size(): number {
    return this.cache.size;
  }

  pruneExpired(): number {
    const now = Date.now();
    let pruned = 0;
    
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.ttl) {
        this.cache.delete(key);
        pruned++;
      }
    }
    
    this.stats.size = this.cache.size;
    return pruned;
  }

  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    
    for (const [key, entry] of this.cache.entries()) {
      if (entry.timestamp < oldestTime) {
        oldestTime = entry.timestamp;
        oldestKey = key;
      }
    }
    
    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.stats.evictions++;
    }
  }
}

export function createScraperCache<T>(name: string, ttlMs: number = 60000): ScraperCache<T> {
  return new ScraperCache<T>({ name, ttl: ttlMs });
}

export const CACHE_TTLS = {
  EVENTS: 60 * 1000,
  LISTINGS: 2 * 60 * 1000,
  REFERENCE: 60 * 60 * 1000,
} as const;
