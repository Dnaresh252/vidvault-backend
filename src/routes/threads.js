const express = require("express");
const { downloadLimiter, apiLimiter } = require("../middleware/rateLimiting");
const videoDownloader = require("../services/videoDownloader");
const platformDetector = require("../services/platformDetector");
const cacheService = require("../services/cacheService");
const router = express.Router();

// ============================================
// 🔥 THREADS VIDEO DOWNLOAD
// POST /api/v1/threads/download
// Body: { url, quality }
// ============================================
router.post("/download", downloadLimiter, async (req, res) => {
  try {
    const { url, quality = "high" } = req.body;

    if (!url?.trim()) {
      return res.status(400).json({
        status: "error",
        message: "Please provide a valid Threads post URL",
      });
    }

    const detection = platformDetector.detectPlatform(url.trim());
    if (!detection.success || detection.platform !== "threads") {
      return res.status(400).json({
        status: "error",
        message:
          "Please provide a valid Threads URL (threads.net/@user/post/...)",
      });
    }

    console.log(`\n🧵 Threads download | ID: ${detection.videoId}`);

    // Cache check
    const cacheKey = `threads:${detection.videoId}:${quality}`;
    try {
      const cached = await cacheService.get?.(cacheKey);
      if (cached) {
        console.log(`🚀 Cache HIT: ${detection.videoId}`);
        return res.status(200).json({
          status: "success",
          cached: true,
          data: cached,
        });
      }
    } catch (e) {}

    const result = await videoDownloader.downloadVideo({
      url: url.trim(),
      quality,
      format: "mp4",
      userIP: req.ip,
      userAgent: req.get("User-Agent"),
    });

    if (!result.success) {
      return res.status(500).json({
        status: "error",
        message: result.error || "Failed to download Threads video",
        code: result.code || "DOWNLOAD_ERROR",
      });
    }

    // Cache 10 min
    try {
      await cacheService.set?.(cacheKey, result.data, 10 * 60);
    } catch (e) {}

    return res.status(200).json({
      status: "success",
      cached: false,
      data: result.data,
    });
  } catch (error) {
    console.error("❌ Threads download error:", error.message);
    return res.status(500).json({
      status: "error",
      message: "Failed to download. Please try again.",
    });
  }
});

// ============================================
// 📋 GET POST INFO
// POST /api/v1/threads/info
// Body: { url }
// ============================================
router.post("/info", apiLimiter, async (req, res) => {
  try {
    const { url } = req.body;

    if (!url?.trim()) {
      return res.status(400).json({
        status: "error",
        message: "Please provide a Threads URL",
      });
    }

    const detection = platformDetector.detectPlatform(url.trim());
    if (!detection.success || detection.platform !== "threads") {
      return res.status(400).json({
        status: "error",
        message: "Please provide a valid Threads URL",
      });
    }

    const instantMetadataService = require("../services/instantMetadataService");
    const meta = await instantMetadataService.getInstantMetadata(url.trim());

    return res.status(200).json({
      status: "success",
      data: {
        platform: "Threads",
        videoId: detection.videoId,
        title: meta.data?.title || "Threads Video",
        thumbnail: meta.data?.thumbnail || null,
        duration: meta.data?.duration || 0,
        uploader: meta.data?.uploader || "Unknown",
      },
    });
  } catch (error) {
    console.error("❌ Threads info error:", error.message);
    return res.status(500).json({
      status: "error",
      message: "Failed to get post info",
    });
  }
});

// 404
router.use((req, res) => {
  res.status(404).json({
    status: "error",
    message: "Threads endpoint not found",
    availableEndpoints: {
      "POST /api/v1/threads/download": "Download Threads video",
      "POST /api/v1/threads/info": "Get post info",
    },
  });
});

module.exports = router;
