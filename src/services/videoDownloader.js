const YTDlpWrap = require("yt-dlp-wrap").default;
const fs = require("fs-extra");
const path = require("path");
const crypto = require("crypto");

const {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { GetObjectCommand } = require("@aws-sdk/client-s3");
const { Upload } = require("@aws-sdk/lib-storage");

const https = require("https");
const dns = require("dns");
const { Resolver } = require("dns").promises;
const platformDetector = require("./platformDetector");
const Download = require("../models/Download");
const cookieManager = require("./cookieManager");
const cacheService = require("./cacheService"); // 🔥 NEW!
// Line ~16 area — this line is MISSING ❌
const instantMetadataService = require("./instantMetadataService");
dns.setServers(["8.8.8.8", "1.1.1.1"]);
const resolver = new Resolver();
resolver.setServers(["8.8.8.8", "1.1.1.1"]);

// 🔥 CONSTANTS FOR PREMIUM SERVICE
const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB hard limit
const RECOMMENDED_QUALITY = "medium"; // 720p default
const TEMP_FILE_MAX_AGE = 5 * 60 * 1000; // 5 minutes
const R2_FILE_MAX_AGE = 60 * 60 * 1000; // 1 hour

class VideoDownloaderService {
  constructor() {
    this.ytDlp = new YTDlpWrap();

    const isProduction =
      process.env.NODE_ENV === "production" || process.env.RAILWAY_ENVIRONMENT;

    if (isProduction) {
      this.downloadDir = "/tmp/downloads";
      this.tempDir = "/tmp/temp";
    } else {
      this.downloadDir = path.join(__dirname, "../../downloads");
      this.tempDir = path.join(__dirname, "../../temp");
    }

    this.activeDownloads = new Map();
    this.maxConcurrentDownloads = 4;

    this.ensureDirectories();
    this.testDNSResolution();
    this.initializeR2Client();
    this.startAggressiveCleanup();
    this.startR2CleanupJob();
  }

  async testDNSResolution() {
    if (!process.env.R2_ACCOUNT_ID) return;
    const hostname = `${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
    try {
      const addresses = await resolver.resolve4(hostname);
      this.r2IP = addresses[0];
      console.log(`✓ R2 DNS resolved: ${this.r2IP}`);
    } catch (error) {
      this.r2IP = "172.64.66.1";
    }
  }

  async initializeR2Client() {
    if (!process.env.R2_ACCOUNT_ID || !process.env.R2_ACCESS_KEY_ID) {
      console.log("❌ R2 credentials not found!");
      this.r2Client = null;
      this.r2Working = false;
      return;
    }

    try {
      const httpsAgent = new https.Agent({
        keepAlive: true,
        maxSockets: 50,
        timeout: 60000,
        rejectUnauthorized: true,
      });

      this.r2Client = new S3Client({
        region: "auto",
        endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: process.env.R2_ACCESS_KEY_ID,
          secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
        },
        forcePathStyle: true,
        requestHandler: {
          httpsAgent: httpsAgent,
          requestTimeout: 300000,
          connectionTimeout: 60000,
        },
      });

      this.r2Working = await this.testR2Connection();
      console.log(
        this.r2Working
          ? "✅ R2 PREMIUM MODE: Smart caching, 500MB limit, instant cleanup"
          : "❌ R2 connection failed!",
      );
    } catch (error) {
      console.error("R2 initialization error:", error.message);
      this.r2Client = null;
      this.r2Working = false;
    }
  }

  async testR2Connection() {
    if (!this.r2Client) return false;
    try {
      await this.r2Client.send(
        new ListObjectsV2Command({
          Bucket: process.env.R2_BUCKET_NAME,
          MaxKeys: 1,
        }),
      );
      return true;
    } catch (error) {
      return false;
    }
  }

  async ensureDirectories() {
    try {
      await fs.ensureDir(this.downloadDir);
      await fs.ensureDir(this.tempDir);
      console.log("✓ Download directories ready");
    } catch (error) {
      console.error("Error creating directories:", error);
      throw new Error("Failed to initialize download directories");
    }
  }

  // 🔥 OPTIMIZED: R2 cleanup every 10 min, delete files >1 hour
  startR2CleanupJob() {
    const CLEANUP_INTERVAL = 10 * 60 * 1000;

    setInterval(async () => {
      if (!this.r2Client || !this.r2Working) return;

      try {
        const listCommand = new ListObjectsV2Command({
          Bucket: process.env.R2_BUCKET_NAME,
          Prefix: "downloads/",
        });

        const response = await this.r2Client.send(listCommand);
        if (!response.Contents || response.Contents.length === 0) return;

        const now = Date.now();
        let deletedCount = 0;

        for (const file of response.Contents) {
          const fileAge = now - file.LastModified.getTime();
          if (fileAge > R2_FILE_MAX_AGE) {
            await this.r2Client.send(
              new DeleteObjectCommand({
                Bucket: process.env.R2_BUCKET_NAME,
                Key: file.Key,
              }),
            );
            deletedCount++;
          }
        }

        if (deletedCount > 0) {
          console.log(`🧹 R2: Deleted ${deletedCount} old files (>1hr)`);
        }
      } catch (error) {
        console.error("R2 cleanup error:", error.message);
      }
    }, CLEANUP_INTERVAL);

    console.log(`✅ R2 cleanup: Every 10min, deletes files >1hr`);
  }

  // 🔥 OPTIMIZED: Aggressive temp cleanup every 3 min, delete files >5 min
  startAggressiveCleanup() {
    const CLEANUP_INTERVAL = 3 * 60 * 1000;

    setInterval(async () => {
      try {
        const now = Date.now();
        for (const dir of [this.tempDir, this.downloadDir]) {
          try {
            const files = await fs.readdir(dir);
            let cleanedCount = 0;

            for (const file of files) {
              const filePath = path.join(dir, file);
              try {
                const stats = await fs.stat(filePath);
                const age = now - stats.mtimeMs;

                if (age > TEMP_FILE_MAX_AGE) {
                  await fs.remove(filePath);
                  cleanedCount++;
                }
              } catch (e) {
                // File might be in use or deleted, skip
              }
            }

            if (cleanedCount > 0) {
              console.log(
                `🧹 Temp: Cleaned ${cleanedCount} old files from ${path.basename(dir)}`,
              );
            }
          } catch (error) {
            // Directory might not exist yet
          }
        }
      } catch (error) {
        console.error("Cleanup error:", error.message);
      }
    }, CLEANUP_INTERVAL);

    console.log(`✅ Temp cleanup: Every 3min, deletes files >5min`);
  }

  async downloadVideo(options = {}) {
    const {
      url,
      quality = "high",
      format = "mp4",
      audioOnly = false,
      userIP = null,
      userAgent = null,
      includeThumbnail = false,
      prefetchedMetadata = null,
    } = options;

    if (this.activeDownloads.size >= this.maxConcurrentDownloads) {
      return {
        success: false,
        error: "Server is at capacity. Please try again in a moment.",
        code: "SERVER_BUSY",
      };
    }

    const downloadId = crypto.randomBytes(8).toString("hex");
    let downloadRecord = null;
    const downloadStartTime = Date.now();

    try {
      const detection = platformDetector.detectPlatform(url);
      if (!detection.success) {
        throw new Error(detection.error);
      }

      console.log(
        `\n📥 [${downloadId}] Starting download from ${detection.platformName}`,
      );
      console.log(`⚙️ Quality: ${quality}, Format: ${format}`);

      this.activeDownloads.set(downloadId, { startTime: Date.now(), url });

      // 🔥 STEP 1: Check R2 cache FIRST!
      console.log(`🔍 [${downloadId}] Checking cache...`);
      const cachedResult = await cacheService.getR2Url(url, quality, format);

      if (cachedResult && cachedResult.cached) {
        console.log(`🚀 [${downloadId}] INSTANT! Serving from cache!`);

        // Get metadata for response
        // Get metadata for response — from Redis cache, NOT raw yt-dlp
        let metadata;
        try {
          const metaResult =
            await instantMetadataService.getInstantMetadata(url);
          metadata = metaResult.data;
        } catch (e) {
          metadata = { title: "Video", thumbnail: null, duration: 0 };
        }

        const downloadDuration = (
          (Date.now() - downloadStartTime) /
          1000
        ).toFixed(2);
        console.log(
          `✓ [${downloadId}] Served instantly in ${downloadDuration}s`,
        );

        return {
          success: true,
          data: {
            id: downloadId,
            title: metadata.title,
            thumbnail: metadata.thumbnail,
            duration: metadata.duration,
            platform: detection.platformName,
            quality: quality,
            format: format,
            fileSize: cachedResult.fileSize,
            downloadUrl: cachedResult.url,
            expiresAt: cachedResult.expiresAt,
            cached: true, // 🔥 Frontend can show "Instant!" badge
          },
          message: "Ready instantly! 🚀 (Served from cache)",
        };
      }

      // 🔥 STEP 2: Cache miss - proceed with download
      console.log(`📥 [${downloadId}] Cache miss - downloading fresh...`);

      downloadRecord = await this.createDownloadRecord({
        url,
        detection,
        quality,
        format,
        userIP,
        userAgent,
      });

      let metadata;
      try {
        console.log("📋 Extracting metadata...");
        metadata =
          prefetchedMetadata ||
          (await instantMetadataService.getInstantMetadata(url)).data;
        console.log(`✓ Metadata: "${metadata.title}"`);

        const estimatedSize = this.estimateFileSize(
          metadata.duration,
          quality,
          detection.platform,
        );

        if (estimatedSize > MAX_FILE_SIZE) {
          throw {
            message: "FILE_TOO_LARGE",
            code: "FILE_TOO_LARGE",
            estimatedSize: estimatedSize,
            maxSize: MAX_FILE_SIZE,
          };
        }
      } catch (metaError) {
        if (metaError.code === "FILE_TOO_LARGE") {
          throw metaError;
        }
        console.log("⚠️  Metadata extraction failed, using defaults");
        metadata = {
          title: "Video",
          description: "",
          thumbnail: null,
          duration: 0,
          view_count: 0,
          upload_date: null,
          uploader: "Unknown",
        };
      }

      if (downloadRecord && metadata.title !== "Video") {
        await this.updateDownloadRecord(downloadRecord, {
          title: metadata.title,
          thumbnail: metadata.thumbnail,
          duration: metadata.duration,
        }).catch(() => {});
      }

      const downloadResult = await this.performStreamingDownload({
        url,
        quality,
        format,
        audioOnly,
        detection,
        metadata,
        downloadId,
      });

      // 🔥 STEP 4: Cache the R2 URL for next user!
      await cacheService.setR2Url(
        url,
        quality,
        format,
        downloadResult.downloadUrl,
        downloadResult.fileSize,
        10 * 60, // 10 minutes
      );

      const downloadDuration = (
        (Date.now() - downloadStartTime) /
        1000
      ).toFixed(2);
      console.log(
        `✓ [${downloadId}] Download completed in ${downloadDuration}s`,
      );

      if (downloadRecord) {
        await this.updateDownloadRecord(downloadRecord, {
          status: "completed",
          actualQuality: downloadResult.quality,
          actualFormat: downloadResult.format,
          fileSize: downloadResult.fileSize,
          downloadUrl: downloadResult.downloadUrl,
          processingEndTime: new Date(),
        }).catch(() => {});
      }

      const responseData = {
        id: downloadRecord?._id,
        title: metadata.title,
        thumbnail: metadata.thumbnail, // 🔥 Direct URL for preview!
        duration: metadata.duration,
        platform: detection.platformName,
        quality: downloadResult.quality,
        format: downloadResult.format,
        fileSize: downloadResult.fileSize,
        downloadUrl: downloadResult.downloadUrl,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        cached: false,
      };

      if (includeThumbnail && metadata.thumbnail) {
        responseData.thumbnailDownload = {
          url: `/api/v1/download/thumbnail?url=${encodeURIComponent(metadata.thumbnail)}&download=true`,
          format: "jpg",
          note: "Click to download thumbnail to your device",
        };
        console.log(`✓ [${downloadId}] Thumbnail download URL included`);
      }

      return {
        success: true,
        data: responseData,
        message:
          "Video ready! Download link valid for 30 min. File available for 1 hour.",
      };
    } catch (error) {
      const downloadDuration = (
        (Date.now() - downloadStartTime) /
        1000
      ).toFixed(2);
      console.error(
        `✗ [${downloadId}] Failed after ${downloadDuration}s:`,
        error.message,
      );

      let userMessage = this.getUserFriendlyError(error.message);

      // 🔥 Special handling for file too large
      if (error.code === "FILE_TOO_LARGE") {
        userMessage = `Video too large! This video is approximately ${this.formatFileSize(error.estimatedSize)}, but our limit is ${this.formatFileSize(error.maxSize)}. Please try 720p or lower quality.`;
      }

      if (downloadRecord) {
        await this.updateDownloadRecord(downloadRecord, {
          status: "failed",
          error: {
            message: userMessage,
            code: error.code || "DOWNLOAD_ERROR",
          },
          processingEndTime: new Date(),
        }).catch(() => {});
      }

      return {
        success: false,
        error: userMessage,
        code: error.code || "DOWNLOAD_ERROR",
        suggestedQuality: error.code === "FILE_TOO_LARGE" ? "medium" : null,
      };
    } finally {
      this.activeDownloads.delete(downloadId);
    }
  }

  async performStreamingDownload(options, progressCallback = null) {
    const { url, quality, format, audioOnly, metadata, downloadId } = options;
    const platform = options.detection?.platform || "youtube";
    const fileName = `${this.sanitizeFilename(metadata?.title || "video")}.${format}`;
    const contentType = this.getContentType(`.${format}`);

    if (!this.r2Client || !this.r2Working) {
      throw new Error("Cloud storage unavailable. Please try again later.");
    }

    console.log(`☁️ [${downloadId}] Downloading and uploading to R2...`);

    const result = await this.streamDirectlyToR2(
      {
        url,
        quality,
        format,
        audioOnly,
        fileName,
        contentType,
        downloadId,
        platform,
      },
      progressCallback,
    );

    console.log(`✓ [${downloadId}] R2 upload completed`);
    return result;
  }
  // ✅ NEW METHOD: Download with progress callback support
  async downloadVideoWithProgress(options = {}) {
    const {
      url,
      quality = "high",
      format = "mp4",
      audioOnly = false,
      userIP = null,
      userAgent = null,
      includeThumbnail = false,
      prefetchedMetadata = null,
      progressCallback = null,
    } = options;

    if (this.activeDownloads.size >= this.maxConcurrentDownloads) {
      return {
        success: false,
        error: "Server is at capacity. Please try again in a moment.",
        code: "SERVER_BUSY",
      };
    }

    const downloadId = crypto.randomBytes(8).toString("hex");
    const downloadStartTime = Date.now();

    try {
      const detection = platformDetector.detectPlatform(url);
      if (!detection.success) {
        throw new Error(detection.error);
      }

      console.log(
        `\n📥 [${downloadId}] Starting download from ${detection.platformName}`,
      );

      this.activeDownloads.set(downloadId, { startTime: Date.now(), url });

      // Check R2 cache first
      const cachedResult = await cacheService.getR2Url(url, quality, format);
      if (cachedResult && cachedResult.cached) {
        let metadata;
        try {
          const metaResult =
            await instantMetadataService.getInstantMetadata(url);
          metadata = metaResult.data;
        } catch (e) {
          metadata = { title: "Video", thumbnail: null, duration: 0 };
        }

        return {
          success: true,
          data: {
            id: downloadId,
            title: metadata.title,
            thumbnail: metadata.thumbnail,
            duration: metadata.duration,
            platform: detection.platformName,
            quality: quality,
            format: format,
            fileSize: cachedResult.fileSize,
            downloadUrl: cachedResult.url,
            expiresAt: cachedResult.expiresAt,
            cached: true,
          },
          message: "Ready instantly! 🚀 (Served from cache)",
        };
      }

      // Get metadata
      let metadata;
      try {
        metadata =
          prefetchedMetadata ||
          (await instantMetadataService.getInstantMetadata(url)).data;

        const estimatedSize = this.estimateFileSize(
          metadata.duration,
          quality,
          detection.platform,
        );

        if (estimatedSize > MAX_FILE_SIZE) {
          throw {
            message: "FILE_TOO_LARGE",
            code: "FILE_TOO_LARGE",
            estimatedSize: estimatedSize,
            maxSize: MAX_FILE_SIZE,
          };
        }
      } catch (metaError) {
        if (metaError.code === "FILE_TOO_LARGE") {
          throw metaError;
        }
        metadata = {
          title: "Video",
          description: "",
          thumbnail: null,
          duration: 0,
        };
      }

      // Perform download with progress callback
      const downloadResult = await this.performStreamingDownload(
        { url, quality, format, audioOnly, detection, metadata, downloadId },
        progressCallback,
      );

      // Cache result for next user
      await cacheService.setR2Url(
        url,
        quality,
        format,
        downloadResult.downloadUrl,
        downloadResult.fileSize,
        10 * 60,
      );

      // ✅ THE ONLY FIX: Save to MongoDB ONLY on success (you only count completed!)
      try {
        const record = new (require("../models/Download"))({
          originalUrl: url,
          platform: detection.platform,
          videoId: detection.videoId,
          requestedQuality: quality,
          requestedFormat: format,
          status: "completed",
          processingStartTime: new Date(downloadStartTime),
          processingEndTime: new Date(),
          ipAddress: userIP
            ? require("crypto")
                .createHash("sha256")
                .update(userIP)
                .digest("hex")
            : null,
          userAgent: userAgent,
        });
        await record.save();
      } catch (dbError) {
        console.error("⚠️ DB save failed (non-critical):", dbError.message);
      }

      const responseData = {
        id: downloadId,
        title: metadata.title,
        thumbnail: metadata.thumbnail,
        duration: metadata.duration,
        platform: detection.platformName,
        quality: downloadResult.quality,
        format: downloadResult.format,
        fileSize: downloadResult.fileSize,
        downloadUrl: downloadResult.downloadUrl,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        cached: false,
      };

      if (includeThumbnail && metadata.thumbnail) {
        responseData.thumbnailDownload = {
          url: `/api/v1/download/thumbnail?url=${encodeURIComponent(metadata.thumbnail)}`,
          format: "jpg",
        };
      }

      return {
        success: true,
        data: responseData,
        message: "Video ready!",
      };
    } catch (error) {
      console.error(`✗ [${downloadId}] Failed:`, error.message);

      let userMessage = this.getUserFriendlyError(error.message);

      if (error.code === "FILE_TOO_LARGE") {
        userMessage = `Video too large! This video is approximately ${this.formatFileSize(error.estimatedSize)}, but our limit is ${this.formatFileSize(error.maxSize)}. Please try 720p or lower quality.`;
      }

      return {
        success: false,
        error: userMessage,
        code: error.code || "DOWNLOAD_ERROR",
        suggestedQuality: error.code === "FILE_TOO_LARGE" ? "medium" : null,
      };
    } finally {
      this.activeDownloads.delete(downloadId);
    }
  }

  async streamDirectlyToR2(options, progressCallback = null) {
    const {
      url,
      quality,
      format,
      audioOnly,
      fileName,
      contentType,
      downloadId,
      platform,
    } = options;

    const tempFile = path.join(this.tempDir, `${downloadId}.${format}`);

    try {
      const ytDlpArgs = this.buildDownloadOptions({
        quality,
        format,
        audioOnly,
        platform,
      });

      ytDlpArgs.push("-o", tempFile);

      console.log(`⬇️ [${downloadId}] Downloading and merging audio+video...`);

      const { spawn } = require("child_process");

      // 🔥 Store last known values
      let lastDownloadedSize = null;
      let lastSpeed = null;
      let lastProgress = 0;

      await new Promise((resolve, reject) => {
        const ytDlpProcess = spawn("yt-dlp", [url, ...ytDlpArgs]);

        ytDlpProcess.stdout.on("data", (data) => {
          const output = data.toString();

          const progressMatch = output.match(/\[download\]\s+(\d+\.?\d*)%/);
          const sizeMatch = output.match(/of\s+([\d.]+[A-Za-z]+)/);
          const speedMatch = output.match(/at\s+([\d.]+[A-Za-z]+\/s)/);
          const etaMatch = output.match(/ETA\s+(\d+:\d+)/);

          if (progressMatch) {
            const progress = parseFloat(progressMatch[1]);

            if (Math.abs(progress - lastProgress) >= 1 && progressCallback) {
              // 🔥 SAVE these values!
              if (sizeMatch) lastDownloadedSize = sizeMatch[1];
              if (speedMatch) lastSpeed = speedMatch[1];

              progressCallback({
                progress: progress,
                downloaded: sizeMatch ? sizeMatch[1] : lastDownloadedSize,
                speed: speedMatch ? speedMatch[1] : lastSpeed,
                timeLeft: etaMatch ? etaMatch[1] : null,
                stage: progress < 90 ? "Downloading" : "Merging",
                isReal: true,
              });
              lastProgress = progress;
            }
          }
        });

        ytDlpProcess.stderr.on("data", (data) => {
          console.log(`yt-dlp: ${data.toString()}`);
        });

        ytDlpProcess.on("close", (code) => {
          if (code === 0) resolve();
          else reject(new Error("Download failed"));
        });

        ytDlpProcess.on("error", (error) => {
          reject(error);
        });
      });

      const stats = await fs.stat(tempFile);
      const fileSize = stats.size;

      if (fileSize > MAX_FILE_SIZE) {
        await fs.remove(tempFile).catch(() => {});
        throw {
          message: "FILE_TOO_LARGE",
          code: "FILE_TOO_LARGE",
          estimatedSize: fileSize,
          maxSize: MAX_FILE_SIZE,
        };
      }

      console.log(
        `✓ [${downloadId}] File ready (${this.formatFileSize(fileSize)})`,
      );

      // 🔥 CRITICAL FIX: Show "Uploading" with last known stats!
      if (progressCallback) {
        progressCallback({
          progress: 95,
          stage: "Uploading to cloud",
          downloaded: lastDownloadedSize || this.formatFileSize(fileSize),
          speed: null,
          timeLeft: "Almost done",
          isReal: true,
        });
      }

      console.log(`☁️ [${downloadId}] Uploading to R2...`);

      const key = `downloads/${Date.now()}_${crypto.randomBytes(8).toString("hex")}_${fileName}`;
      const fileStream = fs.createReadStream(tempFile);

      const upload = new Upload({
        client: this.r2Client,
        params: {
          Bucket: process.env.R2_BUCKET_NAME,
          Key: key,
          Body: fileStream,
          ContentType: contentType,
          ContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
          CacheControl: "public, max-age=1800",
        },
        queueSize: 4,
        partSize: 100 * 1024 * 1024,
        leavePartsOnError: false,
      });

      // 🔥 Keep showing stats during R2 upload!
      if (progressCallback) {
        upload.on("httpUploadProgress", (progress) => {
          if (progress.loaded && progress.total) {
            const uploadPercent = (progress.loaded / progress.total) * 100;
            const mappedProgress = 95 + uploadPercent * 0.049; // 95% -> 99.9%

            progressCallback({
              progress: Math.min(mappedProgress, 99.9),
              stage: "Uploading to cloud",
              downloaded: lastDownloadedSize || this.formatFileSize(fileSize),
              speed: null,
              timeLeft: uploadPercent > 50 ? "Few seconds" : "Uploading",
              isReal: true,
            });
          }
        });
      }

      await upload.done();

      // 🔥 Final 100%
      if (progressCallback) {
        progressCallback({
          progress: 100,
          stage: "Complete",
          downloaded: lastDownloadedSize || this.formatFileSize(fileSize),
          speed: null,
          timeLeft: null,
          isReal: true,
        });
      }

      console.log(`✓ [${downloadId}] Upload complete`);

      const downloadUrl = await getSignedUrl(
        this.r2Client,
        new GetObjectCommand({
          Bucket: process.env.R2_BUCKET_NAME,
          Key: key,
        }),
        { expiresIn: 1800 },
      );

      await fs.remove(tempFile).catch(() => {});
      console.log(`🗑️ [${downloadId}] Temp file deleted`);

      return {
        success: true,
        downloadUrl,
        fileSize,
        quality,
        format,
      };
    } catch (error) {
      try {
        if (await fs.pathExists(tempFile)) {
          await fs.remove(tempFile);
        }
      } catch {}
      throw error;
    }
  }

  // 🔥 UPDATED: Line ~16 - Add this line to fix Instagram
  // Replace this in your videoDownloader.js

  buildDownloadOptions({ quality, format, audioOnly, platform }) {
    const options = [];

    // ============================================
    // ✅ AUDIO ONLY
    // ============================================
    if (audioOnly || format === "mp3") {
      options.push("-f", "bestaudio/best");
      if (format === "mp3") {
        options.push(
          "--extract-audio",
          "--audio-format",
          "mp3",
          "--audio-quality",
          "0",
        );
      }
    }

    // ============================================
    // ✅ TIKTOK - Pre-merged streams, special API
    // ============================================
    else if (platform === "tiktok") {
      const heightMap = {
        highest: 1080,
        high: 720,
        medium: 540,
        low: 360,
      };
      const maxHeight = heightMap[quality] || 720;

      // ✅ NEW
      options.push(
        "-f",
        `b[ext=mp4][height<=${maxHeight}]/b[ext=mp4]/b`,
        "--extractor-args",
        "tiktok:api_hostname=api22-normal-c-useast2a.tiktokv.com",
        "--impersonate",
        "chrome-110",
        "--add-header",
        "Referer:https://www.tiktok.com/",
        "--add-header",
        "Accept-Language:en-US,en;q=0.9",
      );

      // 🔥 Add TikTok cookies if available
      cookieManager.addCookieOptions(options, platform);
    } else if (platform === "instagram") {
      const heightMap = {
        highest: 720,
        high: 720,
        medium: 480,
        low: 360,
      };
      const maxHeight = heightMap[quality] || 480;

      options.push(
        "-f",
        `b[ext=mp4][height<=${maxHeight}]/b[ext=mp4]/best`,
        "--user-agent",
        "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 Instagram/311.0.0.34.109",
        "--add-header",
        "Referer:https://www.instagram.com/",
        "--add-header",
        "Origin:https://www.instagram.com",
        "--add-header",
        "X-IG-App-ID:936619743392459",
        "--add-header",
        "X-ASBD-ID:129477",
        "--add-header",
        "X-IG-WWW-Claim:0",
        "--add-header",
        "Accept-Language:en-US,en;q=0.9",
        "--legacy-server-connect",
      );

      const hasCookies = cookieManager.addCookieOptions(options, platform);
      if (!hasCookies) {
        console.log("⚠️  [INSTAGRAM] No cookies! Download may fail.");
      }
    }

    // ============================================
    // ✅ TWITTER/X - Pre-merged + COOKIES
    // ============================================
    else if (platform === "twitter") {
      const heightMap = {
        highest: 1080,
        high: 720,
        medium: 480,
        low: 360,
      };
      const maxHeight = heightMap[quality] || 720;

      options.push(
        "-f",
        `best[ext=mp4][height<=${maxHeight}]/best[ext=mp4]/best`,
      );

      // 🔥 Add Twitter cookies if available
      cookieManager.addCookieOptions(options, platform);
    }

    // ============================================
    // ✅ FACEBOOK - Pre-merged + COOKIES
    // ============================================
    else if (platform === "facebook") {
      const heightMap = {
        highest: 1080,
        high: 720,
        medium: 480,
        low: 360,
      };
      const maxHeight = heightMap[quality] || 720;

      options.push(
        "-f",
        `best[ext=mp4][height<=${maxHeight}]/best[ext=mp4]/best`,
      );

      // 🔥 Add Facebook cookies if available
      cookieManager.addCookieOptions(options, platform);
    }

    // ============================================
    // ✅ REDDIT - Simple best
    // ============================================
    else if (platform === "reddit") {
      options.push("-f", "best[ext=mp4]/best");
    }

    // ============================================
    // ✅ YOUTUBE + VIMEO + ALL OTHERS
    // ============================================
    else {
      const heightMap = {
        highest: 1080,
        high: 720,
        medium: 720,
        low: 480,
      };
      const maxHeight = heightMap[quality] || 720;

      if (format === "mp4") {
        options.push(
          "-f",
          `bv*[ext=mp4][height<=${maxHeight}]+ba[ext=m4a]/b[ext=mp4][height<=${maxHeight}]/best[height<=${maxHeight}]/best`,
          "--merge-output-format",
          "mp4",
        );
      } else if (format === "webm") {
        options.push(
          "-f",
          `bv*[height<=${maxHeight}]+ba/best[height<=${maxHeight}]/best`,
          "--merge-output-format",
          "webm",
        );
      } else {
        options.push("-f", `best[height<=${maxHeight}]/best`);
      }
    }

    // ============================================
    // ✅ UNIVERSAL FLAGS - ALL PLATFORMS
    // ============================================
    options.push(
      "--no-playlist",
      "--socket-timeout",
      "30",
      "--retries",
      "10",
      "--fragment-retries",
      "10",
      "--retry-sleep",
      "3",
      "--file-access-retries",
      "5",
      "--js-runtimes",
      "node",
    );

    // ✅ YouTube cookies (already working)
    if (platform === "youtube") {
      options.push("--geo-bypass-country", "US");
      cookieManager.addCookieOptions(options, platform);
    }
    return options;
  }
  estimateFileSize(durationSeconds, quality, platform = "generic") {
    if (!durationSeconds || durationSeconds <= 0) return 0;

    // Real-world yt-dlp averages (BYTES/sec)
    const bitrateTable = {
      youtube: {
        highest: 750000, // ~6 Mbps (1080p)
        high: 500000, // ~4 Mbps
        medium: 300000, // ~2.4 Mbps
        low: 150000, // ~1.2 Mbps
      },

      instagram: {
        highest: 320000,
        high: 220000,
        medium: 160000,
        low: 90000,
      },

      tiktok: {
        highest: 300000,
        high: 200000,
        medium: 140000,
        low: 80000,
      },

      // ✅ NEW — Facebook
      facebook: {
        highest: 350000, // ~2.8 Mbps
        high: 250000, // ~2 Mbps
        medium: 180000, // ~1.4 Mbps
        low: 100000, // ~0.8 Mbps
      },

      generic: {
        highest: 600000,
        high: 350000,
        medium: 220000,
        low: 120000,
      },
    };

    const table = bitrateTable[platform] || bitrateTable.generic;
    const bitrate = table[quality] || table.medium;

    let estimated = bitrate * durationSeconds;

    // Safety buffer for audio/container spikes
    estimated *= 1.25;

    return Math.ceil(estimated);
  }

  getUserFriendlyError(errorMessage) {
    const errorMap = {
      private: "This video is private and cannot be downloaded.",
      unavailable: "This video is no longer available.",
      removed: "This video has been removed.",
      "age-restricted":
        "This video is age-restricted and cannot be downloaded.",
      copyright: "This video is protected by copyright.",
      "geo-restricted": "This video is not available in your region.",
      timeout: "Download timed out. Please try a lower quality.",
      "members-only": "This video is only available to channel members.",
    };

    const lowerError = errorMessage.toLowerCase();
    for (const [key, message] of Object.entries(errorMap)) {
      if (lowerError.includes(key.toLowerCase())) {
        return message;
      }
    }

    return "Download failed. The video may be restricted or unavailable.";
  }

  async createDownloadRecord(options) {
    try {
      const { url, detection, quality, format, userIP, userAgent } = options;
      const downloadRecord = new Download({
        originalUrl: url,
        platform: detection.platform,
        videoId: detection.videoId,
        requestedQuality: quality,
        requestedFormat: format,
        status: "processing",
        processingStartTime: new Date(),
        ipAddress: userIP
          ? crypto.createHash("sha256").update(userIP).digest("hex")
          : null,
        userAgent: userAgent,
      });
      await downloadRecord.save();
      return downloadRecord;
    } catch (error) {
      console.error("Error creating download record:", error);
      return null;
    }
  }

  async updateDownloadRecord(record, updates) {
    try {
      if (!record) return;
      Object.assign(record, updates);
      await record.save();
    } catch (error) {
      console.error("Error updating download record:", error.message);
    }
  }

  async getVideoMetadata(url, platform) {
    try {
      const options = [
        "--dump-json",
        "--no-playlist",
        "--skip-download",
        "--socket-timeout",
        "20",
        "--js-runtimes",
        "node",
      ];

      if (platform === "youtube") {
        cookieManager.addCookieOptions(options);
      }

      const result = await this.ytDlp.execPromise([url, ...options]);
      const metadata = JSON.parse(result);

      let uploadDate = null;
      if (metadata.upload_date) {
        try {
          const dateStr = metadata.upload_date.toString();
          if (dateStr.length === 8) {
            const year = parseInt(dateStr.substring(0, 4));
            const month = parseInt(dateStr.substring(4, 6)) - 1;
            const day = parseInt(dateStr.substring(6, 8));
            uploadDate = new Date(year, month, day);
          }
        } catch (e) {}
      }

      let thumbnail = null;
      if (metadata.thumbnails && metadata.thumbnails.length > 0) {
        const thumbnails = metadata.thumbnails.sort(
          (a, b) => (b.width || 0) - (a.width || 0),
        );
        thumbnail = thumbnails[0].url;
      } else if (metadata.thumbnail) {
        thumbnail = metadata.thumbnail;
      }

      return {
        title: metadata.title || "Unknown Title",
        description: (metadata.description || "").substring(0, 2000),
        thumbnail: thumbnail,
        duration: metadata.duration || 0,
        view_count: metadata.view_count || 0,
        upload_date: uploadDate,
        uploader: metadata.uploader || "Unknown",
        uploader_id: metadata.uploader_id || "",
        uploader_verified: metadata.uploader_verified || false,
        webpage_url: metadata.webpage_url || url,
      };
    } catch (error) {
      console.error("Metadata extraction error:", error.message);
      throw error;
    }
  }

  validateDownloadRequest(options) {
    const { url, quality, format } = options;
    if (!url) return { valid: false, error: "URL is required" };

    const detection = platformDetector.detectPlatform(url);
    if (!detection.success) return { valid: false, error: detection.error };

    const validQualities = ["highest", "high", "medium", "low"];
    if (quality && !validQualities.includes(quality)) {
      return {
        valid: false,
        error: `Invalid quality. Must be one of: ${validQualities.join(", ")}`,
      };
    }

    const validFormats = ["mp4", "mp3", "webm"];
    if (format && !validFormats.includes(format)) {
      return {
        valid: false,
        error: `Invalid format. Must be one of: ${validFormats.join(", ")}`,
      };
    }

    return { valid: true, detection };
  }

  getContentType(ext) {
    const types = {
      ".mp4": "video/mp4",
      ".mp3": "audio/mpeg",
      ".webm": "video/webm",
      ".m4a": "audio/mp4",
      ".mkv": "video/x-matroska",
    };
    return types[ext.toLowerCase()] || "application/octet-stream";
  }

  sanitizeFilename(filename) {
    if (!filename) return "video";
    return filename
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
      .replace(/\s+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "")
      .substring(0, 150)
      .toLowerCase();
  }

  formatFileSize(bytes) {
    const units = ["B", "KB", "MB", "GB"];
    let size = bytes;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    return `${size.toFixed(2)} ${units[unitIndex]}`;
  }

  getSupportedPlatforms() {
    return platformDetector.getSupportedPlatforms();
  }

  getServerStats() {
    return {
      activeDownloads: this.activeDownloads.size,
      maxConcurrent: this.maxConcurrentDownloads,
      r2Status: this.r2Working ? "operational" : "degraded",
      uptime: process.uptime(),
      features: {
        smartCaching: true,
        fileSizeLimit: "500 MB",
        recommendedQuality: "720p",
        instantCleanup: true,
      },
    };
  }
}

module.exports = new VideoDownloaderService();
