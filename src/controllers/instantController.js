const instantMetadataService = require("../services/instantMetadataService");
const platformDetector = require("../services/platformDetector");

/**
 * 🚀 INSTANT METADATA ENDPOINT
 * GET /api/v1/instant/metadata?url=VIDEO_URL
 *
 * Returns cached metadata in <1 second or fresh in 2-3 seconds
 * Perfect for instant preview when user pastes URL!
 */
exports.getInstantMetadata = async (req, res) => {
  const startTime = Date.now();

  try {
    const { url } = req.query;

    if (!url || !url.trim()) {
      return res.status(400).json({
        status: "error",
        message: "Video URL is required",
        code: "MISSING_URL",
      });
    }

    const cleanUrl = url.trim();
    const detection = platformDetector.detectPlatform(cleanUrl);

    if (!detection.success) {
      return res.status(400).json({
        status: "error",
        message: detection.error,
        code: "INVALID_URL",
      });
    }

    console.log(`\n⚡ INSTANT metadata request: ${detection.platformName}`);

    const result = await instantMetadataService.getInstantMetadata(cleanUrl);
    const totalTime = Date.now() - startTime;

    res.status(200).json({
      status: "success",
      cached: result.cached,
      responseTime: `${totalTime}ms`,
      message: result.cached
        ? "Retrieved from cache (instant)"
        : "Fresh metadata fetched",
      data: {
        title: result.data.title,
        description: result.data.description,
        thumbnail: result.data.thumbnail,
        duration: result.data.duration,
        durationFormatted: result.data.durationFormatted,
        viewCount: result.data.viewCount,
        viewCountFormatted: result.data.viewCountFormatted,
        uploadDate: result.data.uploadDate,
        uploader: result.data.uploader,
        uploaderVerified: result.data.uploaderVerified,
        platform: result.data.platform,
        platformKey: result.data.platformKey,
        videoId: result.data.videoId,
        downloadOptions: {
          video: result.data.availableFormats.video,
          audio: result.data.availableFormats.audio,
        },
        thumbnailProxy: result.data.thumbnail
          ? `/api/v1/download/thumbnail?url=${encodeURIComponent(result.data.thumbnail)}`
          : null,
      },
    });
  } catch (error) {
    const totalTime = Date.now() - startTime;
    console.error(
      `❌ Instant metadata error (${totalTime}ms):`,
      error.message || error.error,
    );

    res.status(500).json({
      status: "error",
      message:
        error.error || error.message || "Failed to fetch video information",
      code: error.code || "METADATA_ERROR",
      responseTime: `${totalTime}ms`,
    });
  }
};

/**
 * 🔄 INVALIDATE CACHE
 * POST /api/v1/instant/invalidate
 */
exports.invalidateCache = async (req, res) => {
  try {
    const { url } = req.body;

    if (!url || !url.trim()) {
      return res.status(400).json({
        status: "error",
        message: "URL is required",
      });
    }

    const cacheService = require("../services/cacheService");
    await cacheService.invalidate(url.trim());

    res.status(200).json({
      status: "success",
      message: "Cache invalidated for this URL",
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: "Failed to invalidate cache",
    });
  }
};

/**
 * 📊 CACHE STATS
 * GET /api/v1/instant/stats
 */
exports.getCacheStats = async (req, res) => {
  try {
    const cacheService = require("../services/cacheService");
    const stats = await cacheService.getStats();

    res.status(200).json({
      status: "success",
      data: {
        cacheEnabled: stats.enabled,
        cacheStatus: stats.status || "disabled",
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: "Failed to get cache stats",
    });
  }
};
