const instagramImageService = require("../services/instagramImageService");
const platformDetector = require("../services/platformDetector");
const cacheService = require("../services/cacheService");
const videoDownloader = require("../services/videoDownloader");
const crypto = require("crypto");

// ============================================
// 📸 PHOTO & CAROUSEL DOWNLOAD — gallery-dl only
// POST /api/v1/instagram/download
// Body: { url }
// ============================================
exports.downloadInstagram = async (req, res) => {
  try {
    const { url } = req.body;

    // ── Validate input ──
    if (!url?.trim()) {
      return res.status(400).json({
        status: "error",
        message: "Please provide an Instagram post URL",
      });
    }

    const cleanUrl = url.trim();

    const detection = platformDetector.detectPlatform(cleanUrl);
    if (!detection.success || detection.platform !== "instagram") {
      return res.status(400).json({
        status: "error",
        message:
          "Please provide a valid Instagram post URL (instagram.com/p/...)",
      });
    }

    console.log(`\n📸 Instagram photo request | ID: ${detection.videoId}`);

    // ── Cache check ──
    const cacheKey = `ig:photo:${detection.videoId}`;
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

    // ── R2 check ──
    if (!videoDownloader.r2Client || !videoDownloader.r2Working) {
      return res.status(503).json({
        status: "error",
        message:
          "Storage temporarily unavailable. Please try again in a moment.",
        code: "R2_UNAVAILABLE",
      });
    }

    // ── Download via gallery-dl ──
    const imageResult = await instagramImageService.downloadImages(cleanUrl, {
      r2Client: videoDownloader.r2Client,
      r2Working: videoDownloader.r2Working,
    });

    if (!imageResult.success) {
      throw new Error("DOWNLOAD_FAILED");
    }

    // ── Get post metadata (best effort) ──
    let meta = { username: "instagram", description: "" };
    try {
      meta = await instagramImageService.getPostMetadata(cleanUrl);
    } catch (e) {
      console.log("⚠️  Metadata fetch skipped");
    }

    // ── Build response ──
    const responseData = {
      type: imageResult.isCarousel ? "carousel" : "image",
      id: crypto.randomBytes(6).toString("hex"),
      title: meta.description?.trim()
        ? meta.description.substring(0, 120)
        : `Instagram ${imageResult.isCarousel ? "Carousel" : "Photo"} by @${meta.username}`,
      thumbnail: meta.thumbnail || null,
      platform: "Instagram",
      quality: "original",
      format: imageResult.format,
      fileSize: imageResult.fileSize,
      downloadUrl: imageResult.downloadUrl,
      expiresAt: imageResult.expiresAt,
      imageCount: imageResult.imageCount,
      isCarousel: imageResult.isCarousel,
      fileName: imageResult.fileName,
      cached: false,
      note: imageResult.isCarousel
        ? `📦 All ${imageResult.imageCount} photos packed in ZIP`
        : "📸 Photo ready in original quality",
    };

    // ── Cache for 10 min ──
    try {
      await cacheService.set?.(cacheKey, responseData, 10 * 60);
    } catch (e) {}

    console.log(
      `✅ Instagram photo done | type: ${responseData.type} | images: ${imageResult.imageCount}`,
    );

    return res.status(200).json({
      status: "success",
      cached: false,
      data: responseData,
    });
  } catch (error) {
    console.error("❌ Instagram download error:", error.message);
    return res.status(...resolveError(error.message));
  }
};

// ============================================
// 📋 GET POST INFO — metadata only, no download
// POST /api/v1/instagram/info
// Body: { url }
// ============================================
exports.getPostInfo = async (req, res) => {
  try {
    const { url } = req.body;

    if (!url?.trim()) {
      return res.status(400).json({
        status: "error",
        message: "Please provide an Instagram URL",
      });
    }

    const detection = platformDetector.detectPlatform(url.trim());
    if (!detection.success || detection.platform !== "instagram") {
      return res.status(400).json({
        status: "error",
        message: "Please provide a valid Instagram URL",
      });
    }

    const meta = await instagramImageService.getPostMetadata(url.trim());

    return res.status(200).json({
      status: "success",
      data: {
        platform: "Instagram",
        videoId: detection.videoId,
        username: meta.username,
        description: meta.description,
        imageCount: meta.imageCount,
        isCarousel: meta.isCarousel,
        type: meta.imageCount > 0 ? "image" : "unknown",
      },
    });
  } catch (error) {
    console.error("❌ Post info error:", error.message);
    return res.status(500).json({
      status: "error",
      message: "Failed to get post info. Please try again.",
    });
  }
};

// ============================================
// 🛠️  Error resolver helper
// ============================================
function resolveError(message) {
  const map = {
    NO_IMAGES_FOUND: [
      404,
      {
        status: "error",
        message:
          "No photos found in this post. The post may be private or unavailable.",
        code: "NO_IMAGES_FOUND",
      },
    ],
    PRIVATE_ACCOUNT: [
      403,
      {
        status: "error",
        message:
          "This account is private. Only public Instagram posts can be downloaded.",
        code: "PRIVATE_ACCOUNT",
      },
    ],
    POST_NOT_FOUND: [
      404,
      {
        status: "error",
        message: "Post not found. It may have been deleted.",
        code: "POST_NOT_FOUND",
      },
    ],
    GALLERY_DL_NOT_INSTALLED: [
      500,
      {
        status: "error",
        message: "Service temporarily unavailable. Please try again later.",
        code: "SERVICE_UNAVAILABLE",
      },
    ],
    DOWNLOAD_TIMEOUT: [
      408,
      {
        status: "error",
        message: "Download timed out. Please try again.",
        code: "TIMEOUT",
      },
    ],
    R2_UNAVAILABLE: [
      503,
      {
        status: "error",
        message: "Storage unavailable. Please try again in a moment.",
        code: "R2_UNAVAILABLE",
      },
    ],
  };

  const resolved = map[message];
  if (resolved) return resolved;

  return [
    500,
    {
      status: "error",
      message: "Failed to download. Please try again.",
      code: "UNKNOWN_ERROR",
    },
  ];
}
