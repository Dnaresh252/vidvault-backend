const crypto = require("crypto");

/**
 * Metadata Cache Service
 * Caches video metadata to avoid re-fetching
 * Makes repeated requests INSTANT
 */
class MetadataCache {
  constructor() {
    this.cache = new Map();
    this.maxSize = 1000; // Cache up to 1000 videos
    this.ttl = 6 * 60 * 60 * 1000; // 6 hours TTL

    // Clean up expired entries every 30 minutes
    setInterval(() => this.cleanup(), 30 * 60 * 1000);
  }

  // Generate cache key from URL
  generateKey(url) {
    return crypto
      .createHash("md5")
      .update(url.toLowerCase().trim())
      .digest("hex");
  }

  // Store metadata
  set(url, metadata) {
    try {
      const key = this.generateKey(url);

      // If cache is full, remove oldest entry
      if (this.cache.size >= this.maxSize) {
        const firstKey = this.cache.keys().next().value;
        this.cache.delete(firstKey);
      }

      this.cache.set(key, {
        metadata: metadata,
        timestamp: Date.now(),
        url: url,
      });

      console.log(`✓ Cached metadata for: ${url.substring(0, 50)}...`);
      return true;
    } catch (error) {
      console.error("Cache set error:", error.message);
      return false;
    }
  }

  // Get metadata from cache
  get(url) {
    try {
      const key = this.generateKey(url);
      const cached = this.cache.get(key);

      if (!cached) {
        return null;
      }

      // Check if expired
      const age = Date.now() - cached.timestamp;
      if (age > this.ttl) {
        this.cache.delete(key);
        return null;
      }

      console.log(
        `⚡ Cache HIT for: ${url.substring(0, 50)}... (${Math.floor(age / 1000)}s old)`,
      );
      return cached.metadata;
    } catch (error) {
      console.error("Cache get error:", error.message);
      return null;
    }
  }

  // Check if URL is cached and fresh
  has(url) {
    const cached = this.get(url);
    return cached !== null;
  }

  // Remove from cache
  delete(url) {
    try {
      const key = this.generateKey(url);
      return this.cache.delete(key);
    } catch (error) {
      return false;
    }
  }

  // Clean up expired entries
  cleanup() {
    try {
      const now = Date.now();
      let removed = 0;

      for (const [key, value] of this.cache.entries()) {
        const age = now - value.timestamp;
        if (age > this.ttl) {
          this.cache.delete(key);
          removed++;
        }
      }

      if (removed > 0) {
        console.log(`🗑️ Cleaned up ${removed} expired cache entries`);
      }
    } catch (error) {
      console.error("Cache cleanup error:", error.message);
    }
  }

  // Get cache stats
  getStats() {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      ttl: this.ttl,
      usage: `${this.cache.size}/${this.maxSize}`,
    };
  }

  // Clear entire cache
  clear() {
    this.cache.clear();
    console.log("🗑️ Cache cleared");
  }
}

module.exports = new MetadataCache();
