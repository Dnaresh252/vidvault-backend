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

    // Cache TTL (Time To Live)
    this.TTL = {
      metadata: 60 * 60 * 24, // 24 hours for video metadata
      thumbnail: 60 * 60 * 24 * 7, // 7 days for thumbnails
      directUrl: 60 * 60 * 6, // 6 hours for direct download URLs
    };
  }

  /**
   * Generate cache key from URL
   */
  generateKey(prefix, url) {
    const hash = require("crypto").createHash("md5").update(url).digest("hex");
    return `${prefix}:${hash}`;
  }

  /**
   * Get cached metadata for a video
   */
  async getMetadata(url) {
    if (!this.enabled) return null;

    try {
      const key = this.generateKey("meta", url);
      const cached = await this.redis.get(key);

      if (cached) {
        console.log(`🎯 Cache HIT: Metadata for ${url.substring(0, 50)}...`);
        return cached;
      }

      console.log(`❌ Cache MISS: Metadata for ${url.substring(0, 50)}...`);
      return null;
    } catch (error) {
      console.error("Redis get error:", error.message);
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
      console.log(`💾 Cached metadata for ${url.substring(0, 50)}...`);
      return true;
    } catch (error) {
      console.error("Redis set error:", error.message);
      return false;
    }
  }

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
      console.error("Redis get error:", error.message);
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
      console.error("Redis set error:", error.message);
      return false;
    }
  }

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
      console.error("Redis get error:", error.message);
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
      const info = await this.redis.info();
      return {
        enabled: true,
        status: "connected",
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
}

module.exports = new CacheService();
