const validator = require("validator");

class PlatformDetector {
  constructor() {
    // Platform patterns with regex
    this.platforms = {
      youtube: {
        patterns: [
          /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/|m\.youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,
          /(?:https?:\/\/)?(?:www\.)?youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
          /(?:https?:\/\/)?(?:www\.)?youtube\.com\/live\/([a-zA-Z0-9_-]{11})/,
        ],
        name: "YouTube",
        supported: true,
        formats: ["mp4", "mp3", "webm"],
        maxQuality: "8K",
      },
      threads: {
        patterns: [
          /(?:https?:\/\/)?(?:www\.)?threads\.net\/@([a-zA-Z0-9_.-]+)\/post\/([a-zA-Z0-9_-]+)/,
          /(?:https?:\/\/)?(?:www\.)?threads\.com\/@([a-zA-Z0-9_.-]+)\/post\/([a-zA-Z0-9_-]+)/,
        ],
        name: "Threads",
        supported: true,
        formats: ["mp4"],
        maxQuality: "1080p",
      },
      instagram: {
        patterns: [
          /(?:https?:\/\/)?(?:www\.)?instagram\.com\/p\/([a-zA-Z0-9_-]+)/,
          /(?:https?:\/\/)?(?:www\.)?instagram\.com\/reel\/([a-zA-Z0-9_-]+)/,
          /(?:https?:\/\/)?(?:www\.)?instagram\.com\/stories\/([a-zA-Z0-9_.-]+)\/([0-9]+)/,
          /(?:https?:\/\/)?(?:www\.)?instagram\.com\/tv\/([a-zA-Z0-9_-]+)/,
        ],
        name: "Instagram",
        supported: true,
        formats: ["mp4", "jpg"],
        maxQuality: "1080p",
      },
      tiktok: {
        patterns: [
          /(?:https?:\/\/)?(?:www\.)?tiktok\.com\/@([a-zA-Z0-9_.-]+)\/video\/([0-9]+)/,
          /(?:https?:\/\/)?(?:vm\.tiktok\.com|vt\.tiktok\.com)\/([a-zA-Z0-9]+)/,
          /(?:https?:\/\/)?(?:www\.)?tiktok\.com\/t\/([a-zA-Z0-9]+)/,
        ],
        name: "TikTok",
        supported: true,
        formats: ["mp4", "mp3"],
        maxQuality: "1080p",
      },
      twitter: {
        patterns: [
          /(?:https?:\/\/)?(?:www\.)?(?:twitter\.com|x\.com)\/([a-zA-Z0-9_]+)\/status\/([0-9]+)/,
          /(?:https?:\/\/)?(?:www\.)?(?:twitter\.com|x\.com)\/i\/status\/([0-9]+)/,
        ],
        name: "Twitter/X",
        supported: true,
        formats: ["mp4", "gif"],
        maxQuality: "1080p",
      },
      facebook: {
        patterns: [
          /(?:https?:\/\/)?(?:www\.)?facebook\.com\/watch\/?\?v=([0-9]+)/,
          /(?:https?:\/\/)?(?:www\.)?facebook\.com\/([a-zA-Z0-9.]+)\/videos\/([0-9]+)/,
          /(?:https?:\/\/)?(?:www\.)?facebook\.com\/reel\/([0-9]+)/,
        ],
        name: "Facebook",
        supported: true,
        formats: ["mp4"],
        maxQuality: "1080p",
      },
      linkedin: {
        patterns: [
          /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/posts\/([a-zA-Z0-9-]+)-([a-zA-Z0-9-]+)/,
          /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/feed\/update\/urn:li:activity:([0-9]+)/,
        ],
        name: "LinkedIn",
        supported: true,
        formats: ["mp4"],
        maxQuality: "720p",
      },
      reddit: {
        patterns: [
          /(?:https?:\/\/)?(?:www\.)?reddit\.com\/r\/([a-zA-Z0-9_]+)\/comments\/([a-zA-Z0-9]+)/,
          /(?:https?:\/\/)?(?:v\.redd\.it)\/([a-zA-Z0-9]+)/,
        ],
        name: "Reddit",
        supported: true,
        formats: ["mp4"],
        maxQuality: "1080p",
      },
      vimeo: {
        patterns: [
          /(?:https?:\/\/)?(?:www\.)?vimeo\.com\/([0-9]+)/,
          /(?:https?:\/\/)?(?:player\.)?vimeo\.com\/video\/([0-9]+)/,
        ],
        name: "Vimeo",
        supported: true,
        formats: ["mp4", "mp3"],
        maxQuality: "4K",
      },
    };
  }

  /**
   * Detect platform from URL
   * @param {string} url - The video URL
   * @returns {Object} Detection result
   */
  detectPlatform(url) {
    try {
      // Validate URL format
      if (!url || typeof url !== "string") {
        return {
          success: false,
          error: "Invalid URL provided",
          platform: null,
          videoId: null,
        };
      }

      // Clean and normalize URL
      const cleanUrl = this.normalizeUrl(url);

      // Validate URL structure
      if (!validator.isURL(cleanUrl, { require_protocol: false })) {
        return {
          success: false,
          error: "Invalid URL format",
          platform: null,
          videoId: null,
        };
      }

      // Check each platform
      for (const [platformKey, platformData] of Object.entries(
        this.platforms,
      )) {
        for (const pattern of platformData.patterns) {
          const match = cleanUrl.match(pattern);
          if (match) {
            const videoId = this.extractVideoId(match, platformKey);

            return {
              success: true,
              platform: platformKey,
              platformName: platformData.name,
              videoId: videoId,
              originalUrl: url,
              cleanUrl: cleanUrl,
              supported: platformData.supported,
              availableFormats: platformData.formats,
              maxQuality: platformData.maxQuality,
              match: match,
            };
          }
        }
      }

      // No platform detected
      return {
        success: false,
        error: "Unsupported platform or invalid URL",
        platform: null,
        videoId: null,
        suggestion:
          "Please check if the URL is correct and from a supported platform",
      };
    } catch (error) {
      return {
        success: false,
        error: `Detection error: ${error.message}`,
        platform: null,
        videoId: null,
      };
    }
  }

  /**
   * Normalize URL by adding protocol and cleaning parameters
   * @param {string} url - Raw URL
   * @returns {string} Normalized URL
   */
  normalizeUrl(url) {
    let normalized = url.trim();

    // Remove leading/trailing spaces and quotes
    normalized = normalized.replace(/^["']|["']$/g, "");

    // Add https:// if no protocol
    if (!normalized.match(/^https?:\/\//)) {
      normalized = "https://" + normalized;
    }

    // Handle special short URLs
    if (normalized.includes("youtu.be/")) {
      const videoId = normalized
        .split("youtu.be/")[1]
        ?.split("?")[0]
        ?.split("&")[0];
      if (videoId) {
        normalized = `https://www.youtube.com/watch?v=${videoId}`;
      }
    }

    // Handle TikTok short URLs
    if (
      normalized.includes("vm.tiktok.com") ||
      normalized.includes("vt.tiktok.com")
    ) {
      // These need to be resolved, but we'll handle that in the downloader
      return normalized;
    }

    return normalized;
  }

  /**
   * Extract video ID from regex match
   * @param {Array} match - Regex match result
   * @param {string} platform - Platform key
   * @returns {string} Video ID
   */
  extractVideoId(match, platform) {
    switch (platform) {
      case "youtube":
        return match[1]; // Video ID is always first capture group

      case "instagram":
        return match[1]; // Post/reel ID

      case "tiktok":
        if (match[2]) return match[2]; // Full URL video ID
        return match[1]; // Short URL code

      case "twitter":
        return match[2] || match[1]; // Status ID

      case "facebook":
        return match[1] || match[2]; // Video ID

      case "linkedin":
        return match[2] || match[1]; // Activity ID

      case "reddit":
        return match[1] || match[2]; // Post or video ID
      case "threads":
        return match[2] || match[1]; // post ID

      case "vimeo":
        return match[1]; // Video ID

      default:
        return match[1] || match[0];
    }
  }

  /**
   * Get platform capabilities
   * @param {string} platform - Platform key
   * @returns {Object} Platform capabilities
   */
  getPlatformCapabilities(platform) {
    if (!this.platforms[platform]) {
      return null;
    }

    return {
      name: this.platforms[platform].name,
      supported: this.platforms[platform].supported,
      formats: this.platforms[platform].formats,
      maxQuality: this.platforms[platform].maxQuality,
      features: {
        audioOnly: this.platforms[platform].formats.includes("mp3"),
        subtitles: ["youtube", "vimeo"].includes(platform),
        thumbnails: true,
        metadata: true,
      },
    };
  }

  /**
   * Validate URL for specific platform
   * @param {string} url - URL to validate
   * @param {string} expectedPlatform - Expected platform
   * @returns {boolean} Is valid for platform
   */
  validateForPlatform(url, expectedPlatform) {
    const detection = this.detectPlatform(url);
    return detection.success && detection.platform === expectedPlatform;
  }

  /**
   * Get all supported platforms list
   * @returns {Array} List of supported platforms
   */
  getSupportedPlatforms() {
    return Object.entries(this.platforms)
      .filter(([key, data]) => data.supported)
      .map(([key, data]) => ({
        key: key,
        name: data.name,
        formats: data.formats,
        maxQuality: data.maxQuality,
      }));
  }

  /**
   * Check if platform supports specific format
   * @param {string} platform - Platform key
   * @param {string} format - Desired format
   * @returns {boolean} Format supported
   */
  supportsFormat(platform, format) {
    const platformData = this.platforms[platform];
    return platformData && platformData.formats.includes(format);
  }

  /**
   * Get quality options for platform
   * @param {string} platform - Platform key
   * @returns {Array} Available quality options
   */
  getQualityOptions(platform) {
    const qualityMap = {
      "8K": ["8K", "4K", "1440p", "1080p", "720p", "480p", "360p"],
      "4K": ["4K", "1440p", "1080p", "720p", "480p", "360p"],
      "1080p": ["1080p", "720p", "480p", "360p"],
      "720p": ["720p", "480p", "360p"],
      "480p": ["480p", "360p"],
    };

    const platformData = this.platforms[platform];
    if (!platformData) return ["360p"];

    return qualityMap[platformData.maxQuality] || ["360p"];
  }
}

module.exports = new PlatformDetector();
