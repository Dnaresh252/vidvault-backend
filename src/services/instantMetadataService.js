const cacheService = require("./cacheService");
const platformDetector = require("./platformDetector");
const YTDlpWrap = require("yt-dlp-wrap").default;
const cookieManager = require("./cookieManager");

class InstantMetadataService {
  constructor() {
    this.ytDlp = new YTDlpWrap();
    this.inflightRequests = new Map();
  }

  async getInstantMetadata(url) {
    const startTime = Date.now();

    try {
      const detection = platformDetector.detectPlatform(url);
      if (!detection.success) throw new Error(detection.error);

      console.log(`\n🔍 Metadata request for: ${detection.platformName}`);

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

    // 🔥 FIXED: Instagram - updated headers + longer timeout
    if (platform === "instagram") {
      options.push(
        "--user-agent",
        "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 Instagram/311.0.0.34.109",
        "--add-header",
        "Referer:https://www.instagram.com/",
        "--add-header",
        "Origin:https://www.instagram.com",
        "--add-header",
        "X-IG-App-ID:936619743392459",
        "--add-header",
        "X-ASBD-ID:129477",
        "--add-header",
        "X-IG-WWW-Claim:0",
        "--add-header",
        "Accept:*/*",
        "--add-header",
        "Accept-Language:en-US,en;q=0.9",
        "--legacy-server-connect",
      );
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

    // 🔥 FIXED: Instagram gets 30s timeout, YouTube 20s, others 12s
    const timeoutMs = platform === "instagram" ? 30000 : platform === "youtube" ? 20000 : 12000;

    const result = await Promise.race([
      this.ytDlp.execPromise([url, ...options]),
      new Promise((_, r) =>
        setTimeout(() => r(new Error("Metadata timeout")), timeoutMs),
      ),
    ]);

    const raw = JSON.parse(result);
    return this.cleanMetadata(raw, url);
  }

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
      ? `${h}:${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`
      : `${m}:${sec.toString().padStart(2, "0")}`;
  }

  formatNumber(n) {
    if (!n) return "0";
    if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
    if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
    return n.toString();
  }

  getUserFriendlyError(msg) {
    msg = (msg || "").toLowerCase();

    if (msg.includes("private")) return "Private video";
    if (msg.includes("unavailable")) return "Video unavailable";
    if (msg.includes("copyright")) return "Copyright protected";
    if (msg.includes("timeout")) return "Server timeout - please try again";
    if (msg.includes("login") || msg.includes("rate-limit"))
      return "This Instagram content requires login. Try a public video.";
    if (msg.includes("400") || msg.includes("bad request"))
      return "Instagram is temporarily blocking requests. Try again in a moment.";
    if (msg.includes("not granting"))
      return "Instagram access denied. Cookies may need refreshing.";

    return "Failed to fetch video info. Please try again.";
  }
}

module.exports = new InstantMetadataService();
