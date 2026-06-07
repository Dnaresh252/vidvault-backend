const videoDownloader = require("../services/videoDownloader");
const platformDetector = require("../services/platformDetector");
const instantMetadataService = require("../services/instantMetadataService");
const streamingService = require("../services/streamingService");
const cacheService = require("../services/cacheService");
const path = require("path");
const fs = require("fs-extra");
const fetch = require("node-fetch");
const Download = require("../models/Download");
// ----------------------
// 🔥 FIXED: Download with Real-time Progress (SSE)
// ----------------------
function getISTMidnightUTC() {
  const IST_OFFSET_MINUTES = 330; // IST = UTC+5:30
  const now = new Date();
  const nowIST = new Date(now.getTime() + IST_OFFSET_MINUTES * 60 * 1000);
  const midnightIST = new Date(nowIST);
  midnightIST.setUTCHours(0, 0, 0, 0);
  return new Date(midnightIST.getTime() - IST_OFFSET_MINUTES * 60 * 1000);
}

function getNextISTMidnightUTC() {
  return new Date(getISTMidnightUTC().getTime() + 24 * 60 * 60 * 1000);
}
function getISTMidnightUTC() {
  const IST_OFFSET_MINUTES = 330; // IST = UTC+5:30
  const now = new Date();
  const nowIST = new Date(now.getTime() + IST_OFFSET_MINUTES * 60 * 1000);
  const midnightIST = new Date(nowIST);
  midnightIST.setUTCHours(0, 0, 0, 0);
  return new Date(midnightIST.getTime() - IST_OFFSET_MINUTES * 60 * 1000);
}

function getNextISTMidnightUTC() {
  return new Date(getISTMidnightUTC().getTime() + 24 * 60 * 60 * 1000);
}
exports.downloadVideoWithProgress = async (req, res) => {
  try {
    // SSE works with GET - accept params from both query and body
    const url = req.query.url || req.body?.url;
    const quality = req.query.quality || req.body?.quality || "high";
    const format = req.query.format || req.body?.format || "mp4";
    const audioOnly = (req.query.audioOnly || req.body?.audioOnly) === "true";
    const includeThumbnail =
      (req.query.includeThumbnail || req.body?.includeThumbnail) === "true";

    if (!url?.trim()) {
      return res.status(400).json({
        status: "error",
        message: "Valid URL is required",
      });
    }

    // Set SSE headers - CRITICAL!
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("X-Accel-Buffering", "no"); // Disable nginx buffering
    res.flushHeaders(); // Flush headers immediately

    // Send initial ping
    res.write(": ping\n\n");

    // Helper to send progress updates
    const sendProgress = (data) => {
      const message = `data: ${JSON.stringify(data)}\n\n`;
      res.write(message);
    };

    // Handle client disconnect
    let clientDisconnected = false;
    req.on("close", () => {
      clientDisconnected = true;
      console.log("📡 Client disconnected from SSE");
    });

    try {
      // Step 1: Analyzing (10%)
      if (clientDisconnected) return;
      sendProgress({
        step: 1,
        status: "analyzing",
        message: "🔍 Checking your link...",
        progress: 10,
        stage: "Initializing",
      });

      await new Promise((resolve) => setTimeout(resolve, 800));

      if (clientDisconnected) return;

      const validation = videoDownloader.validateDownloadRequest({
        url: url.trim(),
        quality,
        format,
      });

      if (!validation.valid) {
        sendProgress({
          step: 0,
          status: "error",
          message: validation.error,
          progress: 0,
        });
        return res.end();
      }

      // Step 2: Fetching metadata (20-30%)
      if (clientDisconnected) return;
      sendProgress({
        step: 2,
        status: "fetching",
        message: "⚡ Found it! Getting details...",
        progress: 20,
        stage: "Getting Details",
      });

      let metadata;
      try {
        const cachedResult = await instantMetadataService.getInstantMetadata(
          url.trim(),
        );
        metadata = cachedResult.data;

        if (!clientDisconnected) {
          sendProgress({
            step: 2,
            status: "fetching",
            message: metadata?.title ? `🎬 ${metadata.title.substring(0, 45)}` : "✅ Video found!",
            progress: 30,
            stage: "Metadata Retrieved",
            title: metadata.title || "Video",
            thumbnail: metadata.thumbnail,
          });
        }
      } catch (e) {
        metadata = { title: "Video", thumbnail: null, duration: 0 };
      }

      await new Promise((resolve) => setTimeout(resolve, 600));
      // Step 3: REAL DOWNLOAD with REAL PROGRESS
      if (clientDisconnected) return;
      sendProgress({
        step: 3,
        status: "downloading",
        message: "📥 Preparing your download...",
        progress: 35,
        stage: "Preparing",
        title: metadata.title || "Video",
        thumbnail: metadata.thumbnail,
      });

      // ✅ REAL DOWNLOAD with progress callback
      const userIP = req.ip || req.connection.remoteAddress;
      const userAgent = req.get("User-Agent");

      const downloadResult = await videoDownloader.downloadVideoWithProgress({
        url: url.trim(),
        quality,
        format,
        audioOnly,
        userIP,
        userAgent,
        includeThumbnail,
        prefetchedMetadata: metadata,

        // ✅ REAL PROGRESS CALLBACK
        progressCallback: (realProgress) => {
          if (!clientDisconnected) {
            // Map yt-dlp progress (0-100%) to our range (20-95%)
            const mappedProgress = 20 + realProgress.progress * 0.75;

            sendProgress({
              step: 3,
              status: "downloading",
              message: `Downloading... ${realProgress.progress.toFixed(1)}%`,
              progress: mappedProgress,
              stage: realProgress.stage || "Downloading",
              downloaded: realProgress.downloaded || null,
              speed: realProgress.speed || null,
              timeLeft: realProgress.timeLeft || null,
              isReal: true, // ✅ Frontend knows this is REAL!
            });
          }
        },
      });

      if (!downloadResult.success) {
        if (!clientDisconnected) {
          if (downloadResult.code === "RETRY_SOON") {
            sendProgress({
              step: 3,
              status: "retrying",
              message: "⚡ Almost there! Preparing your video...",
              progress: 45,
              stage: "Preparing",
              retryAfter: downloadResult.retryAfter || 8,
              code: "RETRY_SOON",
            });
          } else {
            sendProgress({
              step: 0,
              status: "error",
              message: downloadResult.error || "Download failed",
              progress: 0,
            });
          }
        }
        return res.end();
      }

      await new Promise((resolve) => setTimeout(resolve, 500));

      // Step 5: Complete (100%)
      if (!clientDisconnected) {
        sendProgress({
          step: 5,
          status: "complete",
          message: "✅ Your download is ready!",
          progress: 100,
          stage: "Complete",
          data: downloadResult.data,
        });
      }

      // Keep connection open briefly then close
      await new Promise((resolve) => setTimeout(resolve, 1000));
      res.end();
    } catch (error) {
      console.error("❌ Progress stream error:", error);
      if (!clientDisconnected && !res.finished) {
        sendProgress({
          step: 0,
          status: "error",
          message: error.message || "Download failed",
          progress: 0,
        });
        res.end();
      }
    }
  } catch (error) {
    console.error("❌ SSE setup error:", error);
    if (!res.headersSent) {
      res.status(500).json({
        status: "error",
        message: "Failed to initialize progress stream",
      });
    }
  }
};

// ----------------------
// Download Video (Original - No Progress)
// ----------------------
exports.downloadVideo = async (req, res) => {
  try {
    const {
      url,
      quality = "high",
      format = "mp4",
      audioOnly = false,
      includeThumbnail = false,
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

    console.log(`📥 Download request - Quality: ${quality}, Format: ${format}`);

    const downloadResult = await videoDownloader.downloadVideo({
      url: url.trim(),
      quality,
      format,
      audioOnly,
      userIP,
      userAgent,
      includeThumbnail,
    });

    if (!downloadResult.success) {
      const statusCode = downloadResult.code === "RETRY_SOON" ? 429 : 400;
      return res.status(statusCode).json({
        status: "error",
        message: downloadResult.error,
        code: downloadResult.code,
        retryAfter: downloadResult.retryAfter || 8,
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

exports.downloadThumbnailOnly = async (req, res) => {
  try {
    const { url } = req.body;

    if (!url?.trim()) {
      return res.status(400).json({
        status: "error",
        message: "Valid URL is required",
      });
    }

    const metadata = await instantMetadataService.getInstantMetadata(
      url.trim(),
    );

    if (!metadata.data || !metadata.data.thumbnail) {
      return res.status(404).json({
        status: "error",
        message: "No thumbnail available for this video",
      });
    }

    res.status(200).json({
      status: "success",
      message: "Thumbnail ready for download!",
      data: {
        id: Date.now().toString(),
        title: metadata.data.title,
        thumbnail: metadata.data.thumbnail,
        thumbnailDownload: {
          url: `/api/v1/download/thumbnail?url=${encodeURIComponent(metadata.data.thumbnail)}`,
          format: "jpg",
        },
        platform: metadata.data.platform,
        duration: metadata.data.duration,
        fileSize: 0,
        quality: "thumbnail",
        format: "jpg",
        downloadUrl: `/api/v1/download/thumbnail?url=${encodeURIComponent(metadata.data.thumbnail)}`,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      },
    });
  } catch (error) {
    console.error("❌ Thumbnail-only download error:", error);
    res.status(500).json({
      status: "error",
      message: "Failed to get thumbnail. Please try again.",
    });
  }
};

exports.getThumbnailUrl = async (req, res) => {
  try {
    const { url } = req.body;

    if (!url?.trim()) {
      return res.status(400).json({
        status: "error",
        message: "Valid URL is required",
      });
    }

    const metadata = await instantMetadataService.getInstantMetadata(
      url.trim(),
    );

    if (!metadata.data || !metadata.data.thumbnail) {
      return res.status(404).json({
        status: "error",
        message: "No thumbnail available for this video",
      });
    }

    const proxyUrl = `/api/v1/download/thumbnail?url=${encodeURIComponent(metadata.data.thumbnail)}`;

    res.status(200).json({
      status: "success",
      data: {
        title: metadata.data.title,
        thumbnailUrl: metadata.data.thumbnail,
        proxyUrl: proxyUrl,
        platform: metadata.data.platform,
      },
    });
  } catch (error) {
    console.error("❌ Thumbnail URL error:", error);
    res.status(500).json({
      status: "error",
      message: "Failed to get thumbnail URL. Please try again.",
    });
  }
};

exports.proxyThumbnail = async (req, res) => {
  try {
    const { url } = req.query;

    if (!url) {
      return res.status(400).json({
        status: "error",
        message: "Thumbnail URL is required",
      });
    }

    try {
      new URL(url);
    } catch {
      return res.status(400).json({
        status: "error",
        message: "Invalid thumbnail URL",
      });
    }

    const headers = {
      "User-Agent":
        "Mozilla/5.0 (Linux; Android 13; SM-G998B) AppleWebKit/537.36",
      Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
    };

    if (url.includes("instagram.com") || url.includes("cdninstagram.com")) {
      headers["Referer"] = "https://www.instagram.com/";
    } else if (url.includes("youtube.com") || url.includes("ytimg.com")) {
      headers["Referer"] = "https://www.youtube.com/";
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(url, {
      headers,
      signal: controller.signal,
      redirect: "follow",
    });

    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const contentType = response.headers.get("content-type") || "image/jpeg";
    const buffer = await response.arrayBuffer();
    const bufferView = Buffer.from(buffer);

    res.set({
      "Content-Type": contentType,
      "Content-Length": bufferView.length,
      "Cache-Control": "public, max-age=86400",
      "Access-Control-Allow-Origin": "*",
    });

    res.send(bufferView);
  } catch (error) {
    console.error("Thumbnail proxy error:", error.message);
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

    const result = await instantMetadataService.getInstantMetadata(url.trim());

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
          title: result.data.title,
          description: result.data.description,
          thumbnail: result.data.thumbnail,
          duration: result.data.duration,
          viewCount: result.data.viewCount,
          uploadDate: result.data.uploadDate,
          uploader: result.data.uploader,
          uploaderVerified: result.data.uploaderVerified,
        },
        downloadOptions: {
          availableFormats: result.data.availableFormats,
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
    res
      .status(500)
      .json({ status: "error", message: "Failed to fetch metadata" });
  }
};

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
          realtimeProgress: true,
        },
      },
    });
  } catch (error) {
    res
      .status(500)
      .json({ status: "error", message: "Error fetching platforms" });
  }
};

exports.serveFile = async (req, res) => {
  try {
    const { filename } = req.params;
    if (!filename || filename.includes("..") || filename.includes("/")) {
      return res
        .status(400)
        .json({ status: "error", message: "Invalid filename" });
    }

    const isProduction =
      process.env.NODE_ENV === "production" || process.env.RAILWAY_ENVIRONMENT;

    const downloadsDir = isProduction
      ? "/tmp/downloads"
      : path.join(__dirname, "../../downloads");

    const decodedFilename = decodeURIComponent(filename);
    const filePath = path.join(downloadsDir, decodedFilename);

    if (!(await fs.pathExists(filePath))) {
      return res.status(404).json({
        status: "error",
        message: "File not found or expired",
      });
    }

    const stats = await fs.stat(filePath);
    const ext = path.extname(decodedFilename).toLowerCase();
    const contentType = getContentType(ext);

    res.set({
      "Content-Type": contentType,
      "Content-Length": stats.size,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(decodedFilename)}`,
      "Access-Control-Allow-Origin": "*",
    });

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
    req.on("close", () => stream.destroy());
  } catch (error) {
    console.error("❌ File serve error:", error);
    if (!res.headersSent)
      res.status(500).json({ status: "error", message: "Error serving file" });
  }
};

exports.healthCheck = async (req, res) => {
  try {
    const stats = videoDownloader.getServerStats();
    res.status(200).json({
      status: "success",
      data: {
        status: "healthy",
        timestamp: new Date().toISOString(),
        stats: {
          activeDownloads: stats.activeDownloads,
          maxConcurrent: stats.maxConcurrent,
        },
      },
    });
  } catch {
    res.status(503).json({ status: "error", message: "Service unhealthy" });
  }
};

exports.getServerStats = async (req, res) => {
  try {
    const startOfTodayIST = getISTMidnightUTC();
    const nextMidnightIST = getNextISTMidnightUTC();

    // Smart cache — expires exactly at IST midnight, never stale
    const now = new Date();
    const secondsUntilISTMidnight = Math.floor((nextMidnightIST - now) / 1000);
    const cacheTTL = Math.min(300, Math.max(1, secondsUntilISTMidnight));
    res.set("Cache-Control", `public, max-age=${cacheTTL}`);

    const [totalDownloads, downloadsToday, cacheHitsAll, cacheHitsToday] = await Promise.all([
      Download.countDocuments({ status: "completed" }),
      Download.countDocuments({
        status: "completed",
        createdAt: { $gte: startOfTodayIST },
      }),
      Download.aggregate([
        { $group: { _id: null, total: { $sum: "$cacheHitCount" } } }
      ]),
      Download.aggregate([
        { $match: { updatedAt: { $gte: startOfTodayIST } } },
        { $group: { _id: null, total: { $sum: "$cacheHitCount" } } }
      ]),
    ]);
    const totalCacheHits = cacheHitsAll[0]?.total || 0;
    const todayCacheHits = cacheHitsToday[0]?.total || 0;

    let serverStats = {
      activeDownloads: 0,
      maxConcurrent: 5,
      uptime: 0,
      r2Status: "active",
    };

    try {
      const stats = videoDownloader.getServerStats();
      if (stats) {
        serverStats = {
          activeDownloads: stats.activeDownloads || 0,
          maxConcurrent: stats.maxConcurrent || 5,
          uptime: Math.floor(stats.uptime || 0),
          r2Status: stats.r2Status || "active",
        };
      }
    } catch (err) {
      console.warn("⚠️ Server stats unavailable:", err.message);
    }

    res.status(200).json({
      status: "success",
      data: {
        totalDownloads: (totalDownloads || 0) + totalCacheHits,
        platformsSupported: 25,
        downloadsToday: (downloadsToday || 0) + todayCacheHits,
        activeDownloads: serverStats.activeDownloads,
        maxConcurrent: serverStats.maxConcurrent,
        uptime: serverStats.uptime,
        r2Status: serverStats.r2Status,
      },
    });
  } catch (error) {
    console.error("❌ Stats error:", error);
    res.set("Cache-Control", "public, max-age=60");
    res.status(500).json({
      status: "error",
      message: "Error fetching stats",
      data: {
        totalDownloads: 0,
        platformsSupported: 25,
        downloadsToday: 0,
      },
    });
  }
};
function getContentType(ext) {
  const types = {
    ".mp4": "video/mp4",
    ".mp3": "audio/mpeg",
    ".webm": "video/webm",
  };
  return types[ext.toLowerCase()] || "application/octet-stream";
}

exports.getDirectDownloadUrl = async (req, res) => {
  try {
    const { url, quality = "medium", format = "mp4" } = req.query;
    if (!url) return res.status(400).json({ status: "error", message: "URL required" });

    const detection = platformDetector.detectPlatform(url.trim());
    console.log(`🔗 Direct URL request: ${detection.platform} ${quality} ${format}`);

    // Check R2 cache first — instant!
    const cached = await cacheService.getR2Url(url.trim(), quality, format);
    if (cached?.url) {
      console.log(`⚡ Direct URL — R2 cache HIT`);
      return res.json({ status: "success", url: cached.url, cached: true, source: "r2" });
    }

    // Get direct CDN URL
    const directUrl = await videoDownloader.getDirectUrl(url.trim(), quality, format);
    if (directUrl) {
      console.log(`🚀 Direct CDN URL — zero storage`);
      try {
        await Download.create({
          originalUrl: url.trim(),
          videoId: detection.videoId || url.trim(),
          platform: detection.platform,
          status: "completed",
          requestedQuality: quality,
          requestedFormat: format,
          cached: false,
          processingStartTime: new Date(),
          processingEndTime: new Date(),
        });
      } catch (e) { /* non-critical */ }

      return res.json({
        status: "success",
        url: directUrl,
        cached: false,
        source: "cdn",
        expiresIn: 3600,
      });
    }

    // Fallback — tell frontend to use normal flow
    return res.json({ status: "fallback", message: "Use standard download flow" });

  } catch (error) {
    console.error("❌ Direct URL error:", error);
    res.status(500).json({ status: "error", message: error.message });
  }
};

exports.redirectDirectDownload = async (req, res) => {
  try {
    const { url, quality = "medium", format = "mp4", filename = "video.mp4" } = req.query;
    if (!url) return res.status(400).json({ error: "URL required" });

    // Check R2 cache first — instant redirect
    const cached = await cacheService.getR2Url(url.trim(), quality, format);
    if (cached?.url) {
      res.set("Content-Disposition", `attachment; filename="${filename}"`);
      return res.redirect(302, cached.url);
    }

    // Get direct CDN URL
    const directUrl = await videoDownloader.getDirectUrl(url.trim(), quality, format);
    if (!directUrl) {
      return res.status(404).json({ error: "Could not get direct URL" });
    }

    // Proxy through our server to force download
    const https = require("https");
    const http = require("http");
    const protocol = directUrl.startsWith("https") ? https : http;

    const proxyReq = protocol.get(directUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": "https://www.youtube.com/",
      },
    }, (proxyRes) => {
      const ext = format === "mp3" ? "mp3" : "mp4";
      const contentType = format === "mp3" ? "audio/mpeg" : "video/mp4";

      res.set({
        "Content-Disposition": `attachment; filename="${filename}.${ext}"`,
        "Content-Type": contentType,
        "Content-Length": proxyRes.headers["content-length"],
        "Accept-Ranges": "bytes",
      });

      res.status(200);
      proxyRes.pipe(res);

      proxyRes.on("error", (err) => {
        console.error("Proxy stream error:", err.message);
        if (!res.headersSent) res.status(500).json({ error: "Stream error" });
      });
    });

    proxyReq.on("error", (err) => {
      console.error("Proxy request error:", err.message);
      if (!res.headersSent) res.status(500).json({ error: "Proxy error" });
    });

    // Kill proxy if client disconnects
    req.on("close", () => proxyReq.destroy());

  } catch (error) {
    console.error("❌ Redirect download error:", error);
    if (!res.headersSent) res.status(500).json({ error: error.message });
  }
};

exports.streamVideo = async (req, res) => {
  try {
    const url = req.query.url;
    const quality = req.query.quality || "high";
    const format = req.query.format || "mp4";
    const audioOnly = req.query.audioOnly === "true";

    if (!url?.trim()) {
      return res.status(400).json({ status: "error", message: "URL is required" });
    }

    // Step 1: Check R2 cache first — if hit, redirect instantly
    const cached = await cacheService.getR2Url(url.trim(), quality, format);
    if (cached && cached.url) {
      console.log(`⚡ Stream cache HIT — redirecting to R2`);
      try {
        await Download.findOneAndUpdate(
          { originalUrl: url.trim() },
          { $inc: { cacheHitCount: 1 } },
          { sort: { createdAt: -1 } }
        );
      } catch (e) { /* non-critical */ }
      return res.redirect(302, cached.url);
    }

    // Step 2: Get metadata for filename
    let title = "video";
    try {
      const meta = await instantMetadataService.getInstantMetadata(url.trim());
      title = meta?.data?.title || "video";
    } catch (e) {
      // use default title
    }

    // Step 3: Share in-progress streams (dedup)
    const dedupKey = `stream:${url}:${quality}:${format}`;
    if (streamingService.activeStreams.has(dedupKey)) {
      console.log(`⚡ Stream dedup HIT — another user already streaming this`);
    }

    // Step 4: Connect R2 client from videoDownloader
    streamingService.setR2Client(
      videoDownloader.r2Client,
      videoDownloader.r2Working
    );

    // Step 5: Stream to user
    await streamingService.streamToResponse({
      url: url.trim(),
      quality,
      format,
      audioOnly,
      title,
      res,
      onCached: async (r2Url) => {
        console.log(`☁️ Stream cached to R2 for next users: ${r2Url.slice(0, 60)}`);
        try {
          const detection = platformDetector.detectPlatform(url.trim());
          await Download.create({
            originalUrl: url.trim(),
            platform: detection.platform || "youtube",
            videoId: detection.videoId || url.trim(),
            status: "completed",
            requestedQuality: quality,
            requestedFormat: format,
            cached: false,
            processingStartTime: new Date(),
            processingEndTime: new Date(),
          });
        } catch (e) { /* non-critical */ }
      },
    });

  } catch (error) {
    console.error("❌ Stream controller error:", error.message);
    if (!res.headersSent) {
      res.status(500).json({
        status: "error",
        message: "Stream failed. Please try again.",
      });
    }
  }
};
