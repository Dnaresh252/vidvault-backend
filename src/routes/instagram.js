const express = require("express");
const instagramController = require("../controllers/instagramController");
const { downloadLimiter, apiLimiter } = require("../middleware/rateLimiting");
const rateLimit = require("express-rate-limit");
const router = express.Router();

// Photo download limiter — stricter than general
const photoLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 20, // 20 downloads per 10 min per IP
  message: {
    status: "error",
    message: "Too many download requests. Please wait a moment and try again.",
    retryAfter: 600,
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    console.warn(`⚠️  Instagram rate limit exceeded: ${req.ip}`);
    res.status(429).json({
      status: "error",
      message:
        "Too many requests. Please wait 10 minutes before downloading more photos.",
      retryAfter: 600,
    });
  },
});

// ============================================
// 📸 PHOTO & CAROUSEL DOWNLOAD
// POST /api/v1/instagram/download
// Body: { url: "https://www.instagram.com/p/..." }
// Returns: { status, data: { downloadUrl, imageCount, isCarousel, ... } }
// ============================================
router.post("/download", photoLimiter, instagramController.downloadInstagram);

// ============================================
// 📋 GET POST INFO (no download)
// POST /api/v1/instagram/info
// Body: { url }
// Returns: { status, data: { username, imageCount, isCarousel, ... } }
// ============================================
router.post("/info", apiLimiter, instagramController.getPostInfo);

// ==================== 404 ====================
router.use((req, res) => {
  res.status(404).json({
    status: "error",
    message: "Instagram endpoint not found",
    availableEndpoints: {
      "POST /api/v1/instagram/download":
        "Download Instagram photos & carousels",
      "POST /api/v1/instagram/info": "Get post info without downloading",
    },
  });
});

module.exports = router;
