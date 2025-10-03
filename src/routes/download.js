const express = require("express");
const downloadController = require("../controllers/downloadController");
const { downloadLimiter, apiLimiter } = require("../middleware/rateLimiting");

const router = express.Router();

// Apply general rate limiting
router.use(apiLimiter);

// Public routes
router.get("/platforms", downloadController.getSupportedPlatforms);
router.post("/metadata", downloadController.getVideoMetadata);

// Thumbnail proxy (CORS fix)
router.get("/thumbnail", downloadController.proxyThumbnail);

// Main download route with strict rate limiting
router.post("/video", downloadLimiter, downloadController.downloadVideo);

// File serving
router.get("/file/:filename", downloadController.serveFile);

module.exports = router;
