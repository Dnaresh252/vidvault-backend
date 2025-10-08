const videoDownloader = require("../services/videoDownloader");
const platformDetector = require("../services/platformDetector");
const path = require("path");
const fs = require("fs-extra");

// @desc    Download video from URL
// @route   POST /api/v1/download/video
// @access  Public (Anonymous)
exports.downloadVideo = async (req, res, next) => {
  try {
    const {
      url,
      quality = "high",
      format = "mp4",
      audioOnly = false,
    } = req.body;

    // Validate URL
    if (!url || typeof url !== "string" || url.trim().length === 0) {
      return res.status(400).json({
        status: "error",
        message: "Valid URL is required",
      });
    }

    // Validate download request
    const validation = videoDownloader.validateDownloadRequest({
      url: url.trim(),
      quality,
      format,
    });

    if (!validation.valid) {
      return res.status(400).json({
        status: "error",
        message: validation.error,
      });
    }

    // Extract user info
    const userIP = req.ip || req.connection.remoteAddress;
    const userAgent = req.get("User-Agent");

    console.log(`\n📥 New download request from ${userIP}`);
    console.log(`🔗 URL: ${url.substring(0, 80)}...`);

    // Perform download
    const downloadResult = await videoDownloader.downloadVideo({
      url: url.trim(),
      quality,
      format,
      audioOnly,
      userIP,
      userAgent,
    });

    if (!downloadResult.success) {
      console.error(`❌ Download failed: ${downloadResult.error}`);
      return res.status(400).json({
        status: "error",
        message: downloadResult.error,
        code: downloadResult.code,
      });
    }

    console.log(`✅ Download successful: ${downloadResult.data.title}`);

    // Return success response
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

// @desc    Proxy thumbnail images to bypass CORS
// @route   GET /api/v1/download/thumbnail
// @access  Public
exports.proxyThumbnail = async (req, res) => {
  try {
    const { url } = req.query;

    if (!url || typeof url !== "string") {
      return res.status(400).json({
        status: "error",
        message: "Thumbnail URL is required",
      });
    }

    // Validate URL format
    try {
      new URL(url);
    } catch (e) {
      return res.status(400).json({
        status: "error",
        message: "Invalid thumbnail URL",
      });
    }

    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "image/webp,image/apng,image/*,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
      },
      timeout: 10000,
    });

    if (!response.ok) {
      console.warn(
        `Thumbnail fetch failed: ${response.status} ${response.statusText}`
      );
      return res.status(404).json({
        status: "error",
        message: "Thumbnail not found",
      });
    }

    const buffer = await response.arrayBuffer();
    const contentType = response.headers.get("content-type") || "image/jpeg";

    // Set caching and CORS headers
    res.set("Content-Type", contentType);
    res.set("Cache-Control", "public, max-age=86400, immutable");
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.set("Access-Control-Max-Age", "86400");

    res.send(Buffer.from(buffer));
  } catch (error) {
    console.error("Thumbnail proxy error:", error.message);

    // Return a 1x1 transparent pixel as fallback
    const transparentPixel = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
      "base64"
    );

    res.set("Content-Type", "image/png");
    res.set("Cache-Control", "public, max-age=60");
    res.send(transparentPixel);
  }
};

// @desc    Get video metadata without downloading
// @route   POST /api/v1/download/metadata
// @access  Public
exports.getVideoMetadata = async (req, res, next) => {
  try {
    const { url } = req.body;

    if (!url || typeof url !== "string" || url.trim().length === 0) {
      return res.status(400).json({
        status: "error",
        message: "Valid URL is required",
      });
    }

    console.log(`📋 Metadata request for: ${url.substring(0, 60)}...`);

    // Detect platform
    const detection = platformDetector.detectPlatform(url.trim());
    if (!detection.success) {
      return res.status(400).json({
        status: "error",
        message: detection.error,
      });
    }

    console.log(`✓ Platform: ${detection.platformName}`);

    // Get metadata with timeout
    const metadataPromise = videoDownloader.getVideoMetadata(
      url.trim(),
      detection.platform
    );
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Metadata fetch timeout")), 30000)
    );

    const metadata = await Promise.race([metadataPromise, timeoutPromise]);

    console.log(`✓ Metadata retrieved: ${metadata.title}`);

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
            detection.platform
          ),
          recommendedQuality: "high",
          recommendedFormat: "mp4",
        },
      },
    });
  } catch (error) {
    console.error("❌ Metadata error:", error.message);

    // Return user-friendly error
    let errorMessage = "Failed to fetch video information. ";

    if (error.message.includes("timeout")) {
      errorMessage += "The request took too long. Please try again.";
    } else if (error.message.includes("private")) {
      errorMessage += "This video is private.";
    } else if (error.message.includes("unavailable")) {
      errorMessage += "This video is unavailable.";
    } else {
      errorMessage += "Please check the URL and try again.";
    }

    res.status(500).json({
      status: "error",
      message: errorMessage,
    });
  }
};

// @desc    Get supported platforms
// @route   GET /api/v1/download/platforms
// @access  Public
exports.getSupportedPlatforms = (req, res, next) => {
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
          batchDownload: false, // Premium feature
        },
      },
    });
  } catch (error) {
    console.error("Platforms controller error:", error);
    res.status(500).json({
      status: "error",
      message: "Error fetching supported platforms",
    });
  }
};

// @desc    Serve downloaded files
// @route   GET /api/v1/download/file/:filename
// @access  Public
exports.serveFile = async (req, res, next) => {
  try {
    const { filename } = req.params;

    // Security: Prevent directory traversal
    if (
      !filename ||
      filename.includes("..") ||
      filename.includes("/") ||
      filename.includes("\\") ||
      filename.includes("\x00")
    ) {
      return res.status(400).json({
        status: "error",
        message: "Invalid filename",
      });
    }

    const downloadsDir = path.join(__dirname, "../../downloads");
    const tempDir = path.join(__dirname, "../../temp");
    const decodedFilename = decodeURIComponent(filename);

    // Try downloads directory first, then temp
    let filePath = path.join(downloadsDir, decodedFilename);
    let fileLocation = "downloads";

    if (!(await fs.pathExists(filePath))) {
      filePath = path.join(tempDir, decodedFilename);
      fileLocation = "temp";

      if (!(await fs.pathExists(filePath))) {
        console.warn(`File not found: ${decodedFilename}`);
        return res.status(404).json({
          status: "error",
          message: "File not found or has expired. Please download again.",
        });
      }
    }

    console.log(`📤 Serving file: ${decodedFilename} from ${fileLocation}`);

    const stats = await fs.stat(filePath);
    const fileSize = stats.size;
    const ext = path.extname(decodedFilename).toLowerCase();
    const contentType = getContentType(ext);
    const safeFilename = sanitizeFilenameForDownload(decodedFilename);

    // Support for range requests (resume downloads)
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;

      res.status(206);
      res.set({
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunkSize,
        "Content-Type": contentType,
      });

      const fileStream = fs.createReadStream(filePath, { start, end });
      fileStream.pipe(res);
    } else {
      // Full file download
      res.set({
        "Content-Type": contentType,
        "Content-Length": fileSize,
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(
          safeFilename
        )}`,
        "Cache-Control": "private, no-cache, no-store, must-revalidate",
        Pragma: "no-cache",
        Expires: "0",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Expose-Headers": "Content-Disposition, Content-Length",
        "Accept-Ranges": "bytes",
      });

      const fileStream = fs.createReadStream(filePath);

      fileStream.on("error", (error) => {
        console.error(`Error streaming file ${decodedFilename}:`, error);
        if (!res.headersSent) {
          res.status(500).json({
            status: "error",
            message: "Error streaming file",
          });
        }
      });

      fileStream.on("end", () => {
        console.log(`✓ File served successfully: ${decodedFilename}`);

        // Schedule file deletion after successful download (5 seconds delay)
        setTimeout(async () => {
          try {
            if (await fs.pathExists(filePath)) {
              await fs.remove(filePath);
              console.log(`🗑️ Cleaned up: ${decodedFilename}`);
            }
          } catch (cleanupError) {
            console.warn(
              `Cleanup warning for ${decodedFilename}:`,
              cleanupError.message
            );
          }
        }, 5000);
      });

      // Handle client disconnect
      req.on("close", () => {
        if (!res.writableEnded) {
          console.log(
            `⚠️ Client disconnected during download: ${decodedFilename}`
          );
          fileStream.destroy();

          // Quick cleanup on disconnect
          setTimeout(async () => {
            try {
              if (await fs.pathExists(filePath)) {
                await fs.remove(filePath);
                console.log(
                  `🗑️ Cleaned up after disconnect: ${decodedFilename}`
                );
              }
            } catch (cleanupError) {
              console.warn(`Cleanup warning: ${cleanupError.message}`);
            }
          }, 1000);
        }
      });

      fileStream.pipe(res);
    }
  } catch (error) {
    console.error("❌ File serve error:", error);
    if (!res.headersSent) {
      res.status(500).json({
        status: "error",
        message: "Error serving file. Please try again.",
      });
    }
  }
};

// @desc    Health check for download service
// @route   GET /api/v1/download/health
// @access  Public
exports.healthCheck = async (req, res) => {
  try {
    const health = {
      status: "healthy",
      timestamp: new Date().toISOString(),
      services: {
        videoDownloader: "operational",
        platformDetector: "operational",
        storage: "operational",
      },
      stats: {
        supportedPlatforms: videoDownloader.getSupportedPlatforms().length,
      },
    };

    res.status(200).json({
      status: "success",
      data: health,
    });
  } catch (error) {
    res.status(503).json({
      status: "error",
      message: "Service unhealthy",
      timestamp: new Date().toISOString(),
    });
  }
};

// Helper functions
function sanitizeFilenameForDownload(filename) {
  if (!filename) return "video.mp4";

  const ext = path.extname(filename);
  const nameWithoutExt = path.basename(filename, ext);

  const cleanName = nameWithoutExt
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
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

module.exports = exports;
