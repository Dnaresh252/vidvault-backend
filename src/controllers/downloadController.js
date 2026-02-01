const videoDownloader = require("../services/videoDownloader");
const platformDetector = require("../services/platformDetector");
const path = require("path");
const fs = require("fs-extra");
const fetch = require("node-fetch");

// ----------------------
// Download Video
// ----------------------
exports.downloadVideo = async (req, res) => {
  try {
    const {
      url,
      quality = "high",
      format = "mp4",
      audioOnly = false,
    } = req.body;

    if (!url?.trim()) {
      return res
        .status(400)
        .json({ status: "error", message: "Valid URL is required" });
    }

    const validation = videoDownloader.validateDownloadRequest({
      url: url.trim(),
      quality,
      format,
    });
    if (!validation.valid) {
      return res
        .status(400)
        .json({ status: "error", message: validation.error });
    }

    const userIP = req.ip || req.connection.remoteAddress;
    const userAgent = req.get("User-Agent");

    const stats = videoDownloader.getServerStats();
    if (stats.activeDownloads >= stats.maxConcurrent) {
      return res.status(503).json({
        status: "error",
        message:
          "Server is processing maximum downloads. Please try again in a moment.",
        retryAfter: 30,
      });
    }

    const downloadResult = await videoDownloader.downloadVideo({
      url: url.trim(),
      quality,
      format,
      audioOnly,
      userIP,
      userAgent,
    });

    if (!downloadResult.success) {
      return res.status(400).json({
        status: "error",
        message: downloadResult.error,
        code: downloadResult.code,
      });
    }

    res.status(200).json({
      status: "success",
      message: downloadResult.message,
      data: downloadResult.data,
    });
  } catch (error) {
    console.error("❌ Download controller error:", error);
    res.status(500).json({
      status: "error",
      message: "An unexpected error occurred. Please try again.",
      details:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

// ----------------------
// Proxy Thumbnail Endpoint
// ----------------------
// ----------------------
// Proxy Thumbnail Endpoint - FIXED for Instagram & CDNs
// ----------------------
exports.proxyThumbnail = async (req, res) => {
  try {
    const { url } = req.query;

    if (!url) {
      return res.status(400).json({
        status: "error",
        message: "Thumbnail URL is required",
      });
    }

    // Validate URL
    try {
      new URL(url);
    } catch {
      return res.status(400).json({
        status: "error",
        message: "Invalid thumbnail URL",
      });
    }

    // 🔥 FIXED: Better headers for Instagram & CDN support
    const headers = {
      "User-Agent":
        "Mozilla/5.0 (Linux; Android 13; SM-G998B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.230 Mobile Safari/537.36",
      Accept:
        "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Accept-Encoding": "gzip, deflate, br",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      "Sec-Fetch-Dest": "image",
      "Sec-Fetch-Mode": "no-cors",
      "Sec-Fetch-Site": "cross-site",
      "sec-ch-ua": '"Chromium";v="120", "Google Chrome";v="120"',
      "sec-ch-ua-mobile": "?1",
      "sec-ch-ua-platform": '"Android"',
    };

    // Add platform-specific headers
    if (url.includes("instagram.com") || url.includes("cdninstagram.com")) {
      headers["Referer"] = "https://www.instagram.com/";
      headers["Origin"] = "https://www.instagram.com";
    } else if (
      url.includes("youtube.com") ||
      url.includes("ytimg.com") ||
      url.includes("googlevideo.com")
    ) {
      headers["Referer"] = "https://www.youtube.com/";
    } else if (url.includes("tiktok.com")) {
      headers["Referer"] = "https://www.tiktok.com/";
    } else {
      headers["Referer"] = "https://www.google.com/";
    }

    // Fetch with timeout and retries
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000); // 15 second timeout

    try {
      const response = await fetch(url, {
        headers,
        signal: controller.signal,
        redirect: "follow", // Follow redirects
        compress: true,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      // Get content type and buffer
      const contentType = response.headers.get("content-type") || "image/jpeg";
      const buffer = await response.arrayBuffer();

      // Validate it's actually an image
      const bufferView = Buffer.from(buffer);
      if (bufferView.length === 0) {
        throw new Error("Empty response");
      }

      // Set response headers
      res.set({
        "Content-Type": contentType,
        "Content-Length": bufferView.length,
        "Cache-Control": "public, max-age=86400, immutable",
        "Access-Control-Allow-Origin": "*",
        "X-Content-Type-Options": "nosniff",
      });

      res.send(bufferView);
    } catch (fetchError) {
      clearTimeout(timeout);
      throw fetchError;
    }
  } catch (error) {
    console.error("Thumbnail proxy error:", error.message);

    // Return 1x1 transparent PNG as fallback
    const transparentPixel = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      "base64",
    );

    res.set({
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=60",
      "Access-Control-Allow-Origin": "*",
    });

    res.status(200).send(transparentPixel);
  }
};

// ----------------------
// Get Video Metadata
// ----------------------
exports.getVideoMetadata = async (req, res) => {
  try {
    const { url } = req.body;
    if (!url?.trim())
      return res
        .status(400)
        .json({ status: "error", message: "Valid URL is required" });

    const detection = platformDetector.detectPlatform(url.trim());
    if (!detection.success)
      return res
        .status(400)
        .json({ status: "error", message: detection.error });

    const metadata = await Promise.race([
      videoDownloader.getVideoMetadata(url.trim(), detection.platform),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Metadata fetch timeout")), 25000),
      ),
    ]);

    res.status(200).json({
      status: "success",
      data: {
        platform: {
          key: detection.platform,
          name: detection.platformName,
          videoId: detection.videoId,
          supported: detection.supported,
        },
        metadata: {
          title: metadata.title,
          description: metadata.description,
          thumbnail: metadata.thumbnail,
          duration: metadata.duration,
          viewCount: metadata.view_count,
          uploadDate: metadata.upload_date,
          uploader: metadata.uploader,
          uploaderVerified: metadata.uploader_verified,
        },
        downloadOptions: {
          availableFormats: detection.availableFormats,
          qualityOptions: platformDetector.getQualityOptions(
            detection.platform,
          ),
          recommendedQuality: "high",
          recommendedFormat: "mp4",
        },
      },
    });
  } catch (error) {
    console.error("❌ Metadata error:", error.message);
    let message = "Failed to fetch video information. ";
    if (error.message.includes("timeout"))
      message += "The request took too long.";
    else if (error.message.includes("private"))
      message += "This video is private.";
    else if (error.message.includes("unavailable"))
      message += "This video is unavailable.";
    else if (error.message.includes("bot"))
      message += "Please try again in a moment.";
    else message += "Please check the URL.";

    res.status(500).json({ status: "error", message });
  }
};

// ----------------------
// Get Supported Platforms
// ----------------------
exports.getSupportedPlatforms = (req, res) => {
  try {
    const platforms = videoDownloader.getSupportedPlatforms();
    res.status(200).json({
      status: "success",
      data: {
        platforms,
        totalSupported: platforms.length,
        features: {
          multiQuality: true,
          multiFormat: true,
          audioExtraction: true,
          thumbnailDownload: true,
          metadataExtraction: true,
          batchDownload: false,
          streamingUpload: true,
        },
      },
    });
  } catch (error) {
    console.error("Platforms controller error:", error);
    res
      .status(500)
      .json({ status: "error", message: "Error fetching supported platforms" });
  }
};

// ----------------------
// Serve Downloaded Files - FIXED PATHS
// ----------------------
exports.serveFile = async (req, res) => {
  try {
    const { filename } = req.params;
    if (
      !filename ||
      filename.includes("..") ||
      filename.includes("/") ||
      filename.includes("\x00")
    ) {
      return res
        .status(400)
        .json({ status: "error", message: "Invalid filename" });
    }

    // FIXED: Use correct paths based on environment
    const isProduction =
      process.env.NODE_ENV === "production" || process.env.RAILWAY_ENVIRONMENT;

    const downloadsDir = isProduction
      ? "/tmp/downloads"
      : path.join(__dirname, "../../downloads");
    const tempDir = isProduction
      ? "/tmp/temp"
      : path.join(__dirname, "../../temp");

    const decodedFilename = decodeURIComponent(filename);

    let filePath = path.join(downloadsDir, decodedFilename);
    if (!(await fs.pathExists(filePath))) {
      filePath = path.join(tempDir, decodedFilename);
      if (!(await fs.pathExists(filePath))) {
        return res.status(404).json({
          status: "error",
          message: "File not found or expired. Files are kept for 2 hours.",
        });
      }
    }

    const stats = await fs.stat(filePath);
    const fileSize = stats.size;
    const ext = path.extname(decodedFilename).toLowerCase();
    const contentType = getContentType(ext);

    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;

      res.status(206).set({
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunkSize,
        "Content-Type": contentType,
      });

      fs.createReadStream(filePath, { start, end }).pipe(res);
    } else {
      res.set({
        "Content-Type": contentType,
        "Content-Length": fileSize,
        "Content-Disposition": `attachment; filename*=UTF-8''${sanitizeFilenameForDownload(
          decodedFilename,
        )}`,
        "Cache-Control": "private, no-cache",
        "Access-Control-Allow-Origin": "*",
      });

      const stream = fs.createReadStream(filePath);
      stream.pipe(res);

      req.on("close", () => stream.destroy());

      // Don't auto-delete immediately - files are kept for 2 hours now
      // Cleanup job will handle deletion
    }
  } catch (error) {
    console.error("❌ File serve error:", error);
    if (!res.headersSent)
      res.status(500).json({ status: "error", message: "Error serving file" });
  }
};

// ----------------------
// Health Check Endpoint
// ----------------------
exports.healthCheck = async (req, res) => {
  try {
    const stats = videoDownloader.getServerStats();

    res.status(200).json({
      status: "success",
      data: {
        status: "healthy",
        timestamp: new Date().toISOString(),
        services: {
          videoDownloader: "operational",
          platformDetector: "operational",
          storage: stats.r2Status === "operational" ? "r2" : "local",
          r2Status: stats.r2Status,
        },
        stats: {
          supportedPlatforms: videoDownloader.getSupportedPlatforms().length,
          activeDownloads: stats.activeDownloads,
          maxConcurrent: stats.maxConcurrent,
          capacity: `${stats.activeDownloads}/${stats.maxConcurrent}`,
          uptime: Math.floor(stats.uptime),
        },
      },
    });
  } catch {
    res.status(503).json({
      status: "error",
      message: "Service unhealthy",
      timestamp: new Date().toISOString(),
    });
  }
};

// ----------------------
// Server Stats Endpoint
// ----------------------
exports.getServerStats = (req, res) => {
  try {
    const stats = videoDownloader.getServerStats();

    res.status(200).json({
      status: "success",
      data: {
        activeDownloads: stats.activeDownloads,
        maxConcurrent: stats.maxConcurrent,
        availableSlots: stats.maxConcurrent - stats.activeDownloads,
        r2Status: stats.r2Status,
        uptime: Math.floor(stats.uptime),
        uptimeFormatted: formatUptime(stats.uptime),
      },
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: "Error fetching server stats",
    });
  }
};

// ----------------------
// Helper Functions
// ----------------------
function sanitizeFilenameForDownload(filename) {
  const ext = path.extname(filename);
  const nameWithoutExt = path.basename(filename, ext);
  const cleanName = nameWithoutExt
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, "_")
    .substring(0, 100);
  return (cleanName || "video") + (ext || ".mp4");
}

function getContentType(ext) {
  const types = {
    ".mp4": "video/mp4",
    ".mp3": "audio/mpeg",
    ".webm": "video/webm",
    ".m4a": "audio/mp4",
    ".wav": "audio/wav",
    ".flac": "audio/flac",
    ".mkv": "video/x-matroska",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
  };
  return types[ext.toLowerCase()] || "application/octet-stream";
}

function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
