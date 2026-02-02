const express = require("express");
const downloadController = require("../controllers/downloadController");
const { downloadLimiter, apiLimiter } = require("../middleware/rateLimiting");
const statsController = require("../controllers/statsController");

const router = express.Router();

// Health check endpoint (no rate limiting)
router.get("/health", downloadController.healthCheck);

// Apply general rate limiting to all other routes
router.use(apiLimiter);

// Public information routes (light rate limiting)
router.get("/platforms", downloadController.getSupportedPlatforms);

// Stats endpoint (if you have it)
if (statsController && statsController.getStats) {
  router.get("/stats", statsController.getStats);
}

// Metadata extraction (moderate rate limiting)
router.post("/metadata", downloadController.getVideoMetadata);

// Thumbnail proxy - CORS fix (light rate limiting)
router.get("/thumbnail", downloadController.proxyThumbnail);
// 🆕 NEW: Get thumbnail URL only (no download)
router.post("/thumbnail-url", apiLimiter, downloadController.getThumbnailUrl);

// Main download route (strict rate limiting)
router.post("/video", downloadLimiter, downloadController.downloadVideo);
// Thumbnail-only download endpoint
router.post(
  "/thumbnail-only",
  apiLimiter,
  downloadController.downloadThumbnailOnly,
);
// File serving (no additional rate limiting - already protected by filename validation)
router.get("/file/:filename", downloadController.serveFile);

// 404 handler for download routes
router.use((req, res) => {
  res.status(404).json({
    status: "error",
    message: "Download endpoint not found",
    availableEndpoints: {
      "GET /health": "Service health check",
      "GET /platforms": "List supported platforms",
      "POST /metadata": "Get video metadata",
      "POST /video": "Download video",
      "POST /thumbnail-url": "Get thumbnail URL only",
      "GET /file/:filename": "Retrieve downloaded file",
      "GET /thumbnail": "Proxy thumbnail image",
    },
  });
});

module.exports = router;
