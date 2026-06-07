const express = require("express");
const downloadController = require("../controllers/downloadController");
const { downloadLimiter, apiLimiter } = require("../middleware/rateLimiting");
const rateLimit = require("express-rate-limit");
const router = express.Router();

// ==================== MAIN DOWNLOAD ENDPOINTS ====================

/**
 * 🔥 NEW: DOWNLOAD WITH REAL-TIME PROGRESS (SSE)
 * GET /api/v1/download/video-progress?url=URL&quality=high&format=mp4&includeThumbnail=false
 * POST /api/v1/download/video-progress (also supported for compatibility)
 * Returns: Server-Sent Events stream with progress updates
 *
 * IMPORTANT: SSE works best with GET requests!
 */
router.get(
  "/video-progress",
  downloadLimiter,
  downloadController.downloadVideoWithProgress,
);
router.post(
  "/video-progress",
  downloadLimiter,
  downloadController.downloadVideoWithProgress,
);

/**
 * 🚀 DOWNLOAD VIDEO - Main endpoint (no progress)
 * POST /api/v1/download/video
 * Body: { url, quality, format, audioOnly, includeThumbnail }
 */
router.post("/video", downloadLimiter, downloadController.downloadVideo);

// ==================== METADATA ====================

/**
 * 📋 GET VIDEO METADATA (with cache)
 * POST /api/v1/download/metadata
 */
router.post("/metadata", apiLimiter, downloadController.getVideoMetadata);

// ==================== THUMBNAILS ====================

/**
 * 📸 DOWNLOAD THUMBNAIL ONLY
 * POST /api/v1/download/thumbnail-only
 */
router.post(
  "/thumbnail-only",
  apiLimiter,
  downloadController.downloadThumbnailOnly,
);

/**
 * 🖼️ THUMBNAIL PROXY (CORS-safe)
 * GET /api/v1/download/thumbnail?url=THUMBNAIL_URL
 */
router.get("/thumbnail", downloadController.proxyThumbnail);

/**
 * 🔗 GET THUMBNAIL URL
 * POST /api/v1/download/thumbnail-url
 */
router.post("/thumbnail-url", apiLimiter, downloadController.getThumbnailUrl);

// ==================== FILE SERVING ====================

/**
 * 📦 SERVE DOWNLOADED FILE
 * GET /api/v1/download/file/:filename
 */
router.get("/file/:filename", downloadController.serveFile);

// ==================== PLATFORM INFO ====================

/**
 * 🌐 GET SUPPORTED PLATFORMS
 * GET /api/v1/download/platforms
 */
router.get("/platforms", downloadController.getSupportedPlatforms);

// ==================== HEALTH & STATS ====================

/**
 * ❤️ HEALTH CHECK
 * GET /api/v1/download/health
 */
router.get("/health", downloadController.healthCheck);

// ✅ PRODUCTION: Rate limit stats endpoint
const statsLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // Max 20 requests per minute per IP
  message: {
    status: "error",
    message: "Too many requests, please try again later",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// ✅ Apply rate limiter to stats route
router.get("/stats", statsLimiter, downloadController.getServerStats);

// Direct CDN URL — instant for supported formats, fallback to normal flow
router.get("/direct-url", downloadController.getDirectDownloadUrl);

// Redirect to CDN/R2 URL — forces browser download via 302
router.get("/redirect", downloadController.redirectDirectDownload);

// Mux streaming endpoint — streams video directly to browser
router.get("/stream", downloadController.streamVideo);

// ==================== 404 HANDLER ====================
router.use((req, res) => {
  res.status(404).json({
    status: "error",
    message: "Download endpoint not found",
    availableEndpoints: {
      "GET /video-progress": "🔥 Download with real-time progress (SSE)",
      "POST /video": "Main download endpoint",
      "POST /metadata": "Get video metadata (cached)",
      "POST /thumbnail-only": "Download thumbnail only",
      "GET /thumbnail": "Proxy thumbnail (CORS-safe)",
      "GET /file/:filename": "Serve downloaded file",
      "GET /platforms": "Get supported platforms",
      "GET /health": "Health check",
      "GET /stats": "Server statistics",
    },
  });
});

module.exports = router;
