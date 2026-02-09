const cacheService = require("./cacheService");
const platformDetector = require("./platformDetector");
const YTDlpWrap = require("yt-dlp-wrap").default;
const cookieManager = require("./cookieManager");

class InstantMetadataService {
  constructor() {
    this.ytDlp = new YTDlpWrap();
  }

  /**
   * 🚀 INSTANT METADATA - With Redis Caching
   * Returns metadata in 0.1s if cached, 2-3s if fresh
   */
  async getInstantMetadata(url) {
    const startTime = Date.now();

    try {
      // 1️⃣ Detect platform
      const detection = platformDetector.detectPlatform(url);
      if (!detection.success) {
        throw new Error(detection.error);
      }

      console.log(`\n🔍 Metadata request for: ${detection.platformName}`);

      // 2️⃣ Check cache FIRST (0.1 seconds!)
      const cached = await cacheService.getMetadata(url);
      if (cached) {
        const duration = Date.now() - startTime;
        console.log(`⚡ INSTANT response from cache (${duration}ms)`);

        return {
          success: true,
          cached: true,
          responseTime: duration,
          data: {
            ...cached,
            platform: detection.platformName,
            platformKey: detection.platform,
            videoId: detection.videoId,
          },
        };
      }

      // 3️⃣ Cache MISS - Fetch from source (2-3 seconds)
      console.log(
        `📡 Fetching fresh metadata from ${detection.platformName}...`,
      );

      const metadata = await this.fetchMetadataFromSource(
        url,
        detection.platform,
      );

      // 4️⃣ Cache for next time
      await cacheService.setMetadata(url, metadata);

      const duration = Date.now() - startTime;
      console.log(`✅ Fresh metadata fetched (${duration}ms)`);

      return {
        success: true,
        cached: false,
        responseTime: duration,
        data: {
          ...metadata,
          platform: detection.platformName,
          platformKey: detection.platform,
          videoId: detection.videoId,
        },
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`❌ Metadata error (${duration}ms):`, error.message);

      throw {
        success: false,
        error: this.getUserFriendlyError(error.message),
        code: error.code || "METADATA_ERROR",
        responseTime: duration,
      };
    }
  }

  /**
   * Fetch metadata from video source (YouTube, Instagram, etc.)
   */
  async fetchMetadataFromSource(url, platform) {
    const options = [
      "--dump-json",
      "--no-playlist",
      "--skip-download",
      "--socket-timeout",
      "15",
      "--retries",
      "3",
      "--no-warnings",
      "--js-runtimes",
      "node",
    ];

    // Add cookies only for YouTube
    if (platform === "youtube") {
      cookieManager.addCookieOptions(options);
    }

    // Execute with timeout (15 seconds max)
    const result = await Promise.race([
      this.ytDlp.execPromise([url, ...options]),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Metadata timeout")), 15000),
      ),
    ]);

    const rawData = JSON.parse(result);

    // Parse upload date
    let uploadDate = null;
    if (rawData.upload_date) {
      try {
        const dateStr = rawData.upload_date.toString();
        if (dateStr.length === 8) {
          const year = parseInt(dateStr.substring(0, 4));
          const month = parseInt(dateStr.substring(4, 6)) - 1;
          const day = parseInt(dateStr.substring(6, 8));
          uploadDate = new Date(year, month, day).toISOString();
        }
      } catch (e) {
        uploadDate = null;
      }
    }

    // Get best thumbnail
    let thumbnail = null;
    if (rawData.thumbnails && rawData.thumbnails.length > 0) {
      const thumbnails = rawData.thumbnails.sort(
        (a, b) => (b.width || 0) - (a.width || 0),
      );
      thumbnail = thumbnails[0].url;
    } else if (rawData.thumbnail) {
      thumbnail = rawData.thumbnail;
    }

    // Extract available formats for download options
    const availableFormats = this.parseAvailableFormats(rawData);

    // Return clean metadata
    return {
      title: rawData.title || "Unknown Title",
      description: (rawData.description || "").substring(0, 500),
      thumbnail: thumbnail,
      duration: rawData.duration || 0,
      durationFormatted: this.formatDuration(rawData.duration || 0),
      viewCount: rawData.view_count || 0,
      viewCountFormatted: this.formatNumber(rawData.view_count || 0),
      uploadDate: uploadDate,
      uploader: rawData.uploader || "Unknown",
      uploaderVerified: rawData.uploader_verified || false,
      availableFormats: availableFormats,
      webpageUrl: rawData.webpage_url || url,
    };
  }

  /**
   * Parse available download formats - ONLY POPULAR QUALITIES
   * Returns: 1080p, 720p, 480p, 360p (video) + High/Medium quality (audio)
   */
  parseAvailableFormats(rawData) {
    const formats = {
      video: [],
      audio: [],
    };

    if (!rawData.formats) {
      // Default fallback - most popular options
      return {
        video: [
          {
            quality: "1080p",
            format: "mp4",
            label: "Full HD",
            available: true,
          },
          { quality: "720p", format: "mp4", label: "HD", available: true },
          { quality: "480p", format: "mp4", label: "SD", available: true },
          { quality: "360p", format: "mp4", label: "Low", available: true },
        ],
        audio: [
          {
            quality: "high",
            format: "mp3",
            label: "High Quality (320kbps)",
            available: true,
          },
          {
            quality: "medium",
            format: "mp3",
            label: "Medium Quality (192kbps)",
            available: true,
          },
        ],
      };
    }

    // Parse video formats
    const videoFormats = rawData.formats.filter(
      (f) => f.vcodec && f.vcodec !== "none" && f.height,
    );

    const uniqueHeights = [...new Set(videoFormats.map((f) => f.height))];
    uniqueHeights.sort((a, b) => b - a);

    // Only include POPULAR resolutions
    const popularResolutions = [
      { height: 1080, quality: "1080p", label: "Full HD" },
      { height: 720, quality: "720p", label: "HD" },
      { height: 480, quality: "480p", label: "SD" },
      { height: 360, quality: "360p", label: "Low" },
    ];

    popularResolutions.forEach(({ height, quality, label }) => {
      // Check if this resolution exists in available formats
      const hasResolution = uniqueHeights.some(
        (h) => h >= height && h < height + 180,
      );

      if (hasResolution || height <= 480) {
        // Always show 480p and 360p as fallback
        formats.video.push({
          quality,
          format: "mp4",
          label,
          height,
          available: hasResolution,
        });
      }
    });

    // Audio formats - only 2 popular options
    formats.audio = [
      {
        quality: "high",
        format: "mp3",
        label: "High Quality (320kbps)",
        available: true,
      },
      {
        quality: "medium",
        format: "mp3",
        label: "Medium Quality (192kbps)",
        available: true,
      },
    ];

    return formats;
  }

  /**
   * Format duration (seconds → "MM:SS" or "HH:MM:SS")
   */
  formatDuration(seconds) {
    if (!seconds || seconds === 0) return "0:00";

    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hrs > 0) {
      return `${hrs}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
    }
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }

  /**
   * Format numbers (1234567 → "1.2M")
   */
  formatNumber(num) {
    if (!num || num === 0) return "0";

    if (num >= 1000000000) {
      return (num / 1000000000).toFixed(1) + "B";
    }
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + "M";
    }
    if (num >= 1000) {
      return (num / 1000).toFixed(1) + "K";
    }
    return num.toString();
  }

  /**
   * User-friendly error messages
   */
  getUserFriendlyError(errorMessage) {
    const errorMap = {
      private: "This video is private and cannot be accessed.",
      unavailable: "This video is no longer available.",
      removed: "This video has been removed.",
      "age-restricted": "This video is age-restricted.",
      copyright: "This video is protected by copyright.",
      "geo-restricted": "This video is not available in your region.",
      timeout: "Request timed out. Please try again.",
      "members-only": "This video is only available to channel members.",
    };

    const lowerError = errorMessage.toLowerCase();
    for (const [key, message] of Object.entries(errorMap)) {
      if (lowerError.includes(key.toLowerCase())) {
        return message;
      }
    }

    return "Unable to fetch video information. Please check the URL.";
  }
}

module.exports = new InstantMetadataService();
