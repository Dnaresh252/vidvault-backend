const express = require("express");
const instantController = require("../controllers/instantController");
const { apiLimiter } = require("../middleware/rateLimiting");

const router = express.Router();

// Apply light rate limiting
router.use(apiLimiter);

/**
 * 🚀 INSTANT METADATA - Fast cached metadata
 * GET /api/v1/instant/metadata?url=VIDEO_URL
 *
 * Returns in <1 second if cached, 2-3 seconds if fresh
 * Perfect for instant preview when user pastes URL!
 */
router.get("/metadata", instantController.getInstantMetadata);

/**
 * 🔄 INVALIDATE CACHE - Force refresh (admin only)
 * POST /api/v1/instant/invalidate
 * Body: { "url": "VIDEO_URL" }
 */
router.post("/invalidate", instantController.invalidateCache);

/**
 * 📊 CACHE STATS - Monitor cache health
 * GET /api/v1/instant/stats
 */
router.get("/stats", instantController.getCacheStats);

// ==================== 404 HANDLER ====================
router.use((req, res) => {
  res.status(404).json({
    status: "error",
    message: "Instant endpoint not found",
    availableEndpoints: {
      "GET /metadata?url=": "Get instant cached metadata",
      "POST /invalidate": "Clear cache for URL",
      "GET /stats": "Cache statistics",
    },
  });
});

module.exports = router;
