/**
 * League Metadata Cache Service
 * Caches league IDs, category IDs, and other metadata to speed up scrapers
 */

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

interface LeagueMetadata {
  categoryId?: string | number;
  tournamentId?: string;
  competitionId?: number;
  url?: string;
}

const DEFAULT_TTL = 60 * 60 * 1000; // 1 hour

class MetadataCacheService {
  private cache: Map<string, CacheEntry<any>> = new Map();

  /**
   * Get cached value
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key);

    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.data as T;
  }

  /**
   * Set cached value
   */
  set<T>(key: string, data: T, ttl: number = DEFAULT_TTL): void {
    this.cache.set(key, {
      data,
      expiresAt: Date.now() + ttl,
    });
  }

  /**
   * Generate cache key for league metadata
   */
  private leagueKey(scraper: string, league: string): string {
    return `league:${scraper}:${league}`;
  }

  /**
   * Get league metadata (categoryId, tournamentId, etc.)
   */
  getLeagueMetadata(scraper: string, league: string): LeagueMetadata | null {
    return this.get<LeagueMetadata>(this.leagueKey(scraper, league));
  }

  /**
   * Set league metadata
   */
  setLeagueMetadata(
    scraper: string,
    league: string,
    metadata: LeagueMetadata,
    ttl?: number
  ): void {
    this.set(this.leagueKey(scraper, league), metadata, ttl);
  }

  /**
   * Cache API response data
   */
  setApiResponse(key: string, data: any, ttl: number = 5 * 60 * 1000): void {
    // Shorter TTL for API responses (5 min default)
    this.set(`api:${key}`, data, ttl);
  }

  /**
   * Get cached API response
   */
  getApiResponse<T>(key: string): T | null {
    return this.get<T>(`api:${key}`);
  }

  /**
   * Clear all cache
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Clear expired entries
   */
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Get cache stats
   */
  getStats(): { size: number; keys: string[] } {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys()),
    };
  }
}

// Singleton instance
export const metadataCache = new MetadataCacheService();
