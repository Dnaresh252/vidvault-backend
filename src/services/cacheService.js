const { Redis } = require("@upstash/redis");

class CacheService {
  constructor() {
    // Initialize Redis only if credentials exist
    if (
      process.env.UPSTASH_REDIS_REST_URL &&
      process.env.UPSTASH_REDIS_REST_TOKEN
    ) {
      this.redis = new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      });
      this.enabled = true;
      console.log("✅ Redis cache initialized (Upstash)");
    } else {
      this.redis = null;
      this.enabled = false;
      console.log("⚠️  Redis not configured - caching disabled");
    }

    // Cache TTL (Time To Live) - OPTIMIZED!
    this.TTL = {
      metadata: 60 * 30, // 30 minutes - safe for Upstash free tier (10k cmd/day)
      thumbnail: 60 * 60 * 24 * 7, // 7 days for thumbnails
      directUrl: 60 * 60 * 6, // 6 hours for direct download URLs
      r2Url: 10 * 60, // 🔥 NEW: 10 minutes for R2 URLs (trending videos!)
    };
  }

  /**
   * Generate cache key from URL
   */
  generateKey(prefix, url) {
    const hash = require("crypto").createHash("md5").update(url).digest("hex");
    return `${prefix}:${hash}`;
  }

  // ===================================
  // 🔥 NEW: R2 URL CACHING (HUGE SAVINGS!)
  // ===================================

  /**
   * Get cached R2 download URL for a video
   * Returns URL if video was recently downloaded by someone else
   *
   * @param {string} videoUrl - Original video URL
   * @param {string} quality - Quality (high/medium/low)
   * @param {string} format - Format (mp4/mp3)
   * @returns {Object|null} - {url, expiresAt, cached: true} or null
   */
  async getR2Url(videoUrl, quality, format) {
    if (!this.enabled) return null;

    try {
      const key = this.generateKey(`r2:${quality}:${format}`, videoUrl);
      const cached = await this.redis.get(key);

      if (cached) {
        console.log(`🚀 INSTANT! R2 cache HIT (${quality} ${format})`);
        console.log(`💰 Saved ~$0.40 by serving cached file!`);
        return {
          url: cached.url,
          expiresAt: cached.expiresAt,
          fileSize: cached.fileSize,
          cached: true,
        };
      }

      console.log(`📥 R2 cache MISS - will download fresh`);
      return null;
    } catch (error) {
      console.error("Redis get R2 URL error:", error.message);
      return null;
    }
  }

  /**
   * Cache R2 download URL after upload
   * Allows next user to get instant download!
   *
   * @param {string} videoUrl - Original video URL
   * @param {string} quality - Quality (high/medium/low)
   * @param {string} format - Format (mp4/mp3)
   * @param {string} r2Url - R2 presigned URL
   * @param {number} fileSize - File size in bytes
   * @param {number} ttl - Time to live in seconds (default: 10 min)
   */
  async setR2Url(videoUrl, quality, format, r2Url, fileSize, ttl = null) {
    if (!this.enabled) return false;

    try {
      const key = this.generateKey(`r2:${quality}:${format}`, videoUrl);
      const cacheTTL = ttl || this.TTL.r2Url;

      const cacheData = {
        url: r2Url,
        expiresAt: new Date(Date.now() + cacheTTL * 1000).toISOString(),
        fileSize: fileSize,
        cachedAt: new Date().toISOString(),
      };

      await this.redis.setex(key, cacheTTL, cacheData);
      console.log(
        `💾 Cached R2 URL (${quality} ${format}) - Next user gets INSTANT download!`,
      );
      console.log(`⏰ Cache expires in ${cacheTTL / 60} minutes`);
      return true;
    } catch (error) {
      console.error("Redis set R2 URL error:", error.message);
      return false;
    }
  }

  /**
   * Invalidate R2 cache for a specific video
   * Useful if video is removed or updated
   */
  async invalidateR2Cache(videoUrl) {
    if (!this.enabled) return false;

    try {
      const qualities = ["highest", "high", "medium", "low"];
      const formats = ["mp4", "mp3", "webm"];

      const deletePromises = [];
      for (const quality of qualities) {
        for (const format of formats) {
          const key = this.generateKey(`r2:${quality}:${format}`, videoUrl);
          deletePromises.push(this.redis.del(key));
        }
      }

      await Promise.all(deletePromises);
      console.log(`🗑️  Invalidated R2 cache for video`);
      return true;
    } catch (error) {
      console.error("Redis invalidate R2 error:", error.message);
      return false;
    }
  }

  // ===================================
  // METADATA CACHING (EXISTING - KEEP!)
  // ===================================

  /**
   * Get cached metadata for a video
   */
  async getMetadata(url) {
    if (!this.enabled) return null;

    try {
      const key = this.generateKey("meta", url);
      const cached = await this.redis.get(key);

      if (cached) {
        console.log(`🎯 Cache HIT: Metadata (${url.substring(0, 50)}...)`);
        return cached;
      }

      console.log(`❌ Cache MISS: Metadata (${url.substring(0, 50)}...)`);
      return null;
    } catch (error) {
      console.error("Redis get metadata error:", error.message);
      return null;
    }
  }

  /**
   * Cache video metadata
   */
  async setMetadata(url, metadata) {
    if (!this.enabled) return false;

    try {
      const key = this.generateKey("meta", url);
      await this.redis.setex(key, this.TTL.metadata, metadata);
      console.log(`💾 Cached metadata (${url.substring(0, 50)}...)`);
      return true;
    } catch (error) {
      console.error("Redis set metadata error:", error.message);
      return false;
    }
  }

  // ===================================
  // DIRECT URL CACHING (EXISTING - KEEP!)
  // ===================================

  /**
   * Get cached direct download URL
   */
  async getDirectUrl(url, quality, format) {
    if (!this.enabled) return null;

    try {
      const key = this.generateKey(`direct:${quality}:${format}`, url);
      const cached = await this.redis.get(key);

      if (cached) {
        console.log(`🎯 Cache HIT: Direct URL (${quality} ${format})`);
        return cached;
      }

      return null;
    } catch (error) {
      console.error("Redis get direct URL error:", error.message);
      return null;
    }
  }

  /**
   * Cache direct download URL
   */
  async setDirectUrl(url, quality, format, directUrl, expiresIn = null) {
    if (!this.enabled) return false;

    try {
      const key = this.generateKey(`direct:${quality}:${format}`, url);
      const ttl = expiresIn || this.TTL.directUrl;

      await this.redis.setex(key, ttl, directUrl);
      console.log(
        `💾 Cached direct URL (${quality} ${format}) - expires in ${ttl}s`,
      );
      return true;
    } catch (error) {
      console.error("Redis set direct URL error:", error.message);
      return false;
    }
  }

  // ===================================
  // THUMBNAIL CACHING (EXISTING - KEEP!)
  // ===================================

  /**
   * Get cached thumbnail URL
   */
  async getThumbnail(url) {
    if (!this.enabled) return null;

    try {
      const key = this.generateKey("thumb", url);
      const cached = await this.redis.get(key);

      if (cached) {
        console.log(`🎯 Cache HIT: Thumbnail`);
        return cached;
      }

      return null;
    } catch (error) {
      console.error("Redis get thumbnail error:", error.message);
      return null;
    }
  }

  /**
   * Cache thumbnail URL
   */
  async setThumbnail(url, thumbnailUrl) {
    if (!this.enabled) return false;

    try {
      const key = this.generateKey("thumb", url);
      await this.redis.setex(key, this.TTL.thumbnail, thumbnailUrl);
      console.log(`💾 Cached thumbnail URL`);
      return true;
    } catch (error) {
      console.error("Redis set thumbnail error:", error.message);
      return false;
    }
  }

  // ===================================
  // UTILITY METHODS
  // ===================================
  // ===================================
  // GENERIC GET/SET (used by instagram, transcript etc)
  // ===================================

  async get(key) {
    if (!this.enabled) return null;
    try {
      const cached = await this.redis.get(key);
      if (cached) console.log(`🎯 Cache HIT: ${key}`);
      return cached || null;
    } catch (error) {
      console.error("Redis get error:", error.message);
      return null;
    }
  }

  async set(key, value, ttl = 600) {
    if (!this.enabled) return false;
    try {
      await this.redis.setex(key, ttl, value);
      console.log(`💾 Cached: ${key} (${ttl}s)`);
      return true;
    } catch (error) {
      console.error("Redis set error:", error.message);
      return false;
    }
  }

  /**
   * Delete cache for a specific URL (useful for updates)
   */
  async invalidate(url) {
    if (!this.enabled) return false;

    try {
      const metaKey = this.generateKey("meta", url);
      const thumbKey = this.generateKey("thumb", url);

      await Promise.all([this.redis.del(metaKey), this.redis.del(thumbKey)]);

      console.log(`🗑️  Invalidated cache for ${url.substring(0, 50)}...`);
      return true;
    } catch (error) {
      console.error("Redis delete error:", error.message);
      return false;
    }
  }

  /**
   * Get cache stats (for monitoring)
   */
  async getStats() {
    if (!this.enabled) {
      return { enabled: false };
    }

    try {
      // Try to get some basic stats
      const info = await this.redis.info().catch(() => null);

      return {
        enabled: true,
        status: "connected",
        provider: "Upstash",
        tier: "Free",
        features: {
          metadataCaching: true,
          r2UrlCaching: true,
          thumbnailCaching: true,
        },
        ttl: {
          metadata: `${this.TTL.metadata / 3600} hours`,
          r2Url: `${this.TTL.r2Url / 60} minutes`,
          thumbnail: `${this.TTL.thumbnail / 86400} days`,
        },
        info: info,
      };
    } catch (error) {
      return {
        enabled: true,
        status: "error",
        error: error.message,
      };
    }
  }

  /**
   * Health check
   */
  async ping() {
    if (!this.enabled) return false;

    try {
      const result = await this.redis.ping();
      return result === "PONG";
    } catch (error) {
      console.error("Redis ping error:", error.message);
      return false;
    }
  }

  /**
   * Get cache hit rate (for monitoring performance)
   */
  async getCacheHitRate() {
    if (!this.enabled) {
      return { enabled: false };
    }

    try {
      // This is an estimate based on Redis stats
      // In production, you'd track this in your own metrics
      return {
        enabled: true,
        message:
          "Cache hit rate tracking requires custom implementation with counters",
        recommendation: "Use Redis counters to track hits/misses",
      };
    } catch (error) {
      return {
        enabled: true,
        error: error.message,
      };
    }
  }
}

module.exports = new CacheService();
