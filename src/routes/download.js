const express = require("express");
const downloadController = require("../controllers/downloadController");
const statsController = require("../controllers/statsController");
const { downloadLimiter, apiLimiter } = require("../middleware/rateLimiting");

const router = express.Router();

router.use(apiLimiter);

// Public routes
router.get("/platforms", downloadController.getSupportedPlatforms);
router.post("/metadata", downloadController.getVideoMetadata);
router.get("/thumbnail", downloadController.proxyThumbnail);

// Stats route
router.get("/stats", statsController.getStats);

// Main download route with strict rate limiting
router.post("/video", downloadLimiter, downloadController.downloadVideo);

// File serving
router.get("/file/:filename", downloadController.serveFile);

module.exports = router;
