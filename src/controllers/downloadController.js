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

    if (!url) {
      return res.status(400).json({
        status: "error",
        message: "URL is required",
      });
    }

    const validation = videoDownloader.validateDownloadRequest({
      url,
      quality,
      format,
    });

    if (!validation.valid) {
      return res.status(400).json({
        status: "error",
        message: validation.error,
      });
    }

    const userIP = req.ip || req.connection.remoteAddress;
    const userAgent = req.get("User-Agent");

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
    console.error("Download controller error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error during download",
    });
  }
};

// @desc    Proxy thumbnail images to bypass CORS
// @route   GET /api/v1/download/thumbnail
// @access  Public
exports.proxyThumbnail = async (req, res) => {
  try {
    const { url } = req.query;

    if (!url) {
      return res.status(400).send();
    }

    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    if (!response.ok) {
      return res.status(404).send();
    }

    const buffer = await response.arrayBuffer();
    const contentType = response.headers.get("content-type") || "image/jpeg";

    res.set("Content-Type", contentType);
    res.set("Cache-Control", "public, max-age=86400");
    res.set("Access-Control-Allow-Origin", "*");
    res.send(Buffer.from(buffer));
  } catch (error) {
    console.error("Thumbnail proxy error:", error);
    res.status(500).send();
  }
};

// @desc    Get video metadata without downloading
// @route   POST /api/v1/download/metadata
// @access  Public
exports.getVideoMetadata = async (req, res, next) => {
  try {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({
        status: "error",
        message: "URL is required",
      });
    }

    const detection = platformDetector.detectPlatform(url);
    if (!detection.success) {
      return res.status(400).json({
        status: "error",
        message: detection.error,
      });
    }

    const metadata = await videoDownloader.getVideoMetadata(url);

    res.status(200).json({
      status: "success",
      data: {
        platform: detection,
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
        availableFormats: detection.availableFormats,
        qualityOptions: platformDetector.getQualityOptions(detection.platform),
      },
    });
  } catch (error) {
    console.error("Metadata controller error:", error);
    res.status(500).json({
      status: "error",
      message: "Error fetching video metadata",
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
    const cleanupService = require("../services/cleanupService");

    if (
      filename.includes("..") ||
      filename.includes("/") ||
      filename.includes("\\")
    ) {
      return res.status(400).json({
        status: "error",
        message: "Invalid filename",
      });
    }

    const downloadsDir = path.join(__dirname, "../../downloads");
    const tempDir = path.join(__dirname, "../../temp");
    const decodedFilename = decodeURIComponent(filename);

    let filePath = path.join(downloadsDir, decodedFilename);

    if (!(await fs.pathExists(filePath))) {
      filePath = path.join(tempDir, decodedFilename);
    }

    if (await fs.pathExists(filePath)) {
      const stats = await fs.stat(filePath);
      const fileSize = stats.size;
      const ext = path.extname(decodedFilename).toLowerCase();
      const contentType = getContentType(ext);
      const safeFilename = sanitizeFilenameForDownload(decodedFilename);

      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Length", fileSize);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename*=UTF-8''${encodeURIComponent(safeFilename)}`
      );
      res.setHeader("Cache-Control", "private, no-cache");
      res.setHeader("Access-Control-Allow-Origin", "*");

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
        cleanupService.deleteAfterDownload(filePath, 5);
      });

      req.on("close", () => {
        if (!res.writableEnded) {
          cleanupService.deleteAfterDownload(filePath, 0.1);
        }
      });

      fileStream.pipe(res);
      return;
    }

    return res.status(404).json({
      status: "error",
      message: "File not found or expired",
    });
  } catch (error) {
    console.error("File serve error:", error);
    if (!res.headersSent) {
      res.status(500).json({
        status: "error",
        message: "Error serving file",
      });
    }
  }
};

// Helper functions
function sanitizeFilenameForDownload(filename) {
  if (!filename) return "video.mp4";
  const ext = path.extname(filename);
  const nameWithoutExt = path.basename(filename, ext);
  const cleanName = nameWithoutExt
    .replace(/[<>:"/\\|?*]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .substring(0, 100);
  return (cleanName || "video") + (ext || ".mp4");
}

function getContentType(ext) {
  const types = {
    ".mp4": "video/mp4",
    ".mp3": "audio/mpeg",
    ".webm": "video/webm",
    ".wav": "audio/wav",
    ".flac": "audio/flac",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
  };
  return types[ext] || "application/octet-stream";
}
