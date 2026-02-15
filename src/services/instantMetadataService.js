const cacheService = require("./cacheService");
const platformDetector = require("./platformDetector");
const YTDlpWrap = require("yt-dlp-wrap").default;
const cookieManager = require("./cookieManager");

class InstantMetadataService {
  constructor() {
    this.ytDlp = new YTDlpWrap();
    this.inflightRequests = new Map();
  }

  // =====================================================
  // 🚀 MAIN ENTRY
  // =====================================================
  async getInstantMetadata(url) {
    const startTime = Date.now();

    try {
      const detection = platformDetector.detectPlatform(url);
      if (!detection.success) throw new Error(detection.error);

      console.log(`\n🔍 Metadata request for: ${detection.platformName}`);

      // 1️⃣ CACHE FIRST
      const cached = await cacheService.getMetadata(url);
      if (cached) {
        return {
          success: true,
          cached: true,
          responseTime: Date.now() - startTime,
          data: {
            ...cached,
            platform: detection.platformName,
            platformKey: detection.platform,
            videoId: detection.videoId,
          },
        };
      }

      // 2️⃣ IN-FLIGHT DEDUPE
      if (this.inflightRequests.has(url)) {
        console.log("⏳ Waiting for in-flight request...");
        return this.inflightRequests.get(url);
      }

      console.log(`📡 Fetching fresh metadata...`);

      const requestPromise = this.fetchMetadataFromSource(
        url,
        detection.platform,
      ).then(async (metadata) => {
        await cacheService.setMetadata(url, metadata);
        this.inflightRequests.delete(url);

        return {
          success: true,
          cached: false,
          responseTime: Date.now() - startTime,
          data: {
            ...metadata,
            platform: detection.platformName,
            platformKey: detection.platform,
            videoId: detection.videoId,
          },
        };
      });

      this.inflightRequests.set(url, requestPromise);
      return await requestPromise;
    } catch (error) {
      this.inflightRequests.delete(url);

      throw {
        success: false,
        error: this.getUserFriendlyError(error.message),
        code: "METADATA_ERROR",
      };
    }
  }

  // =====================================================
  // 🔥 METADATA FETCHER WITH MULTI-PLATFORM COOKIES
  // =====================================================
  async fetchMetadataFromSource(url, platform) {
    const options = [
      "--dump-json",
      "--skip-download",
      "--no-playlist",
      "--no-warnings",
      "--retries",
      "3",
      "--socket-timeout",
      "20",
      "--js-runtimes",
      "node",
    ];

    // ========= PLATFORM-SPECIFIC CONFIGS =========

    if (platform === "youtube") {
      options.push("--geo-bypass-country", "US");
      cookieManager.addCookieOptions(options, platform);
    }

    if (platform === "instagram") {
      options.push(
        "--user-agent",
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        "--add-header",
        "Referer:https://www.instagram.com/",
        "--add-header",
        "X-IG-App-ID:936619743392459",
      );

      // 🔥 CRITICAL: Add Instagram cookies for metadata
      cookieManager.addCookieOptions(options, platform);
    }

    if (platform === "tiktok") {
      options.push(
        "--extractor-args",
        "tiktok:api_hostname=api22-normal-c-useast2a.tiktokv.com",
        "--impersonate",
        "chrome-110",
        "--add-header",
        "Referer:https://www.tiktok.com/",
      );
      cookieManager.addCookieOptions(options, platform);
    }

    if (platform === "twitter") {
      cookieManager.addCookieOptions(options, platform);
    }

    if (platform === "facebook") {
      cookieManager.addCookieOptions(options, platform);
    }

    const result = await Promise.race([
      this.ytDlp.execPromise([url, ...options]),
      new Promise((_, r) =>
        setTimeout(() => r(new Error("Metadata timeout")), 15000),
      ),
    ]);

    const raw = JSON.parse(result);

    return this.cleanMetadata(raw, url);
  }

  // =====================================================
  // 🧹 CLEAN METADATA
  // =====================================================
  cleanMetadata(raw, url) {
    const thumbnail = this.extractThumbnail(raw);

    return {
      title: raw.title || "Unknown Title",
      description: (raw.description || "").slice(0, 500),
      thumbnail,
      duration: raw.duration || 0,
      durationFormatted: this.formatDuration(raw.duration || 0),
      viewCount: raw.view_count || 0,
      viewCountFormatted: this.formatNumber(raw.view_count || 0),
      uploadDate: this.parseDate(raw.upload_date),
      uploader: raw.uploader || "Unknown",
      uploaderVerified: raw.uploader_verified || false,
      availableFormats: this.parseAvailableFormats(raw),
      webpageUrl: raw.webpage_url || url,
    };
  }

  // =====================================================
  // 🖼️ UNIVERSAL THUMBNAIL EXTRACTOR
  // =====================================================
  extractThumbnail(raw) {
    if (raw.thumbnails?.length) {
      return raw.thumbnails.sort((a, b) => (b.width || 0) - (a.width || 0))[0]
        .url;
    }

    return (
      raw.thumbnail ||
      raw.display_url ||
      raw["og:image"] ||
      "/default-thumbnail.jpg"
    );
  }

  // =====================================================
  // 📦 FORMATS
  // =====================================================
  parseAvailableFormats(raw) {
    return {
      video: [
        { quality: "1080p", format: "mp4", label: "Full HD" },
        { quality: "720p", format: "mp4", label: "HD" },
        { quality: "480p", format: "mp4", label: "SD" },
        { quality: "360p", format: "mp4", label: "Low" },
      ],
      audio: [
        { quality: "high", format: "mp3", label: "High (320kbps)" },
        { quality: "medium", format: "mp3", label: "Medium (192kbps)" },
      ],
    };
  }

  // =====================================================
  // ⏱️ HELPERS
  // =====================================================
  parseDate(dateStr) {
    if (!dateStr || dateStr.length !== 8) return null;
    return new Date(
      dateStr.slice(0, 4),
      dateStr.slice(4, 6) - 1,
      dateStr.slice(6, 8),
    ).toISOString();
  }

  formatDuration(s) {
    if (!s) return "0:00";
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    return h
      ? `${h}:${m.toString().padStart(2, "0")}:${sec
          .toString()
          .padStart(2, "0")}`
      : `${m}:${sec.toString().padStart(2, "0")}`;
  }

  formatNumber(n) {
    if (!n) return "0";
    if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
    if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
    return n.toString();
  }

  // =====================================================
  // ❌ ERRORS
  // =====================================================
  getUserFriendlyError(msg) {
    msg = msg.toLowerCase();

    if (msg.includes("private")) return "Private video";
    if (msg.includes("unavailable")) return "Video unavailable";
    if (msg.includes("copyright")) return "Copyright protected";
    if (msg.includes("timeout")) return "Server timeout";
    if (msg.includes("login")) return "Login required";

    return "Failed to fetch video info";
  }
}

module.exports = new InstantMetadataService();
