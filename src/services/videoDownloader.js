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
const cacheService = require("./cacheService");
const instantMetadataService = require("./instantMetadataService");

dns.setServers(["8.8.8.8", "1.1.1.1"]);
const resolver = new Resolver();
resolver.setServers(["8.8.8.8", "1.1.1.1"]);

// 🔥 CONSTANTS
const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB hard limit
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
              } catch (e) {}
            }

            if (cleanedCount > 0) {
              console.log(
                `🧹 Temp: Cleaned ${cleanedCount} old files from ${path.basename(dir)}`,
              );
            }
          } catch (error) {}
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

      console.log(`🔍 [${downloadId}] Checking cache...`);
      const cachedResult = await cacheService.getR2Url(url, quality, format);

      if (cachedResult && cachedResult.cached) {
        console.log(`🚀 [${downloadId}] INSTANT! Serving from cache!`);

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
            cached: true,
          },
          message: "Ready instantly! 🚀 (Served from cache)",
        };
      }

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

        // 🔥 FIX 1: Check file size with CORRECTED estimation
        const estimatedSize = this.estimateFileSize(metadata.duration, quality);
        if (estimatedSize > MAX_FILE_SIZE) {
          const durationMins = Math.floor((metadata.duration || 0) / 60);
          throw {
            message: "FILE_TOO_LARGE",
            code: "FILE_TOO_LARGE",
            estimatedSize: estimatedSize,
            maxSize: MAX_FILE_SIZE,
            duration: durationMins,
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

      await cacheService.setR2Url(
        url,
        quality,
        format,
        downloadResult.downloadUrl,
        downloadResult.fileSize,
        10 * 60,
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

      let userMessage = this.getUserFriendlyError(error.message || "");

      // 🔥 FIX 1: Better FILE_TOO_LARGE message
      if (error.code === "FILE_TOO_LARGE") {
        const durationMins = error.duration || 0;
        userMessage =
          durationMins > 0
            ? `This video is ${durationMins} minutes long and too large for our free service (500MB limit). Please try a shorter video or lower quality (480p).`
            : `This video exceeds our 500MB limit. Please try a lower quality (480p).`;
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
        suggestedQuality: error.code === "FILE_TOO_LARGE" ? "low" : null,
      };
    } finally {
      this.activeDownloads.delete(downloadId);
    }
  }

  async performStreamingDownload(options) {
    const { url, quality, format, audioOnly, metadata, downloadId } = options;
    const platform = options.detection?.platform || "youtube";
    const fileName = `${this.sanitizeFilename(metadata?.title || "video")}.${format}`;
    const contentType = this.getContentType(`.${format}`);

    if (!this.r2Client || !this.r2Working) {
      throw new Error("Cloud storage unavailable. Please try again later.");
    }

    console.log(`☁️ [${downloadId}] Downloading and uploading to R2...`);

    const result = await this.streamDirectlyToR2({
      url,
      quality,
      format,
      audioOnly,
      fileName,
      contentType,
      downloadId,
      platform,
    });

    console.log(`✓ [${downloadId}] R2 upload completed`);
    return result;
  }

  async streamDirectlyToR2(options) {
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

      try {
        await this.ytDlp.execPromise([url, ...ytDlpArgs]);
      } catch (firstError) {
        const isFormatError =
          firstError.message.includes("Requested format is not available") ||
          firstError.message.includes("impersonation");

        const isNetworkError =
          firstError.message.includes("Could not connect") ||
          firstError.message.includes("Failed to connect") ||
          firstError.message.includes("Connection timed out") ||
          firstError.message.includes("Failed to perform");

        if (isNetworkError) {
          throw new Error(
            platform === "tiktok" ? "TIKTOK_NETWORK_ERROR" : "NETWORK_ERROR",
          );
        }

        if (isFormatError) {
          console.log(
            `⚠️ [${downloadId}] Format error, trying fallback for ${platform}...`,
          );
          await fs.remove(tempFile).catch(() => {});

          const fallbackArgs = [
            "-f",
            "b",
            "--no-playlist",
            "--socket-timeout",
            "30",
            "--retries",
            "5",
            "--fragment-retries",
            "5",
            "--retry-sleep",
            "3",
            "--js-runtimes",
            "node",
          ];

          if (platform === "tiktok") {
            fallbackArgs.push(
              "--extractor-args",
              "tiktok:api_hostname=api22-normal-c-useast2a.tiktokv.com",
              "--impersonate",
              "chrome-110",
              "--add-header",
              "Referer:https://www.tiktok.com/",
            );
          }

          fallbackArgs.push("-o", tempFile);
          console.log(`🔄 [${downloadId}] Fallback download starting...`);
          await this.ytDlp.execPromise([url, ...fallbackArgs]);
        } else {
          throw firstError;
        }
      }

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
        `✓ [${downloadId}] Merged file ready (${this.formatFileSize(fileSize)})`,
      );
      console.log(`☁️ [${downloadId}] Streaming to R2...`);

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

      await upload.done();

      console.log(
        `✓ [${downloadId}] R2 upload complete (${this.formatFileSize(fileSize)})`,
      );

      const downloadUrl = await getSignedUrl(
        this.r2Client,
        new GetObjectCommand({
          Bucket: process.env.R2_BUCKET_NAME,
          Key: key,
        }),
        { expiresIn: 1800 },
      );

      await fs.remove(tempFile).catch((err) => {
        console.log(`⚠️  Failed to delete temp file: ${err.message}`);
      });
      console.log(`🗑️  [${downloadId}] Temp file deleted immediately`);

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
          console.log(`🗑️  [${downloadId}] Temp file deleted (after error)`);
        }
      } catch (cleanupError) {}

      throw error;
    }
  }

  buildDownloadOptions({ quality, format, audioOnly, platform }) {
    const options = [];

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
    } else if (platform === "tiktok") {
      const heightMap = { highest: 1080, high: 720, medium: 540, low: 360 };
      const maxHeight = heightMap[quality] || 720;

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
      cookieManager.addCookieOptions(options, platform);
    } else if (platform === "instagram") {
      const heightMap = { highest: 1080, high: 720, medium: 480, low: 360 };
      const maxHeight = heightMap[quality] || 720;

      options.push(
        "-f",
        `bv*[ext=mp4][height<=${maxHeight}]+ba[ext=m4a]/b[ext=mp4][height<=${maxHeight}]/best`,
        "--merge-output-format",
        "mp4",
        "--user-agent",
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        "--add-header",
        "Referer:https://www.instagram.com/",
        "--add-header",
        "Accept-Language:en-US,en;q=0.9",
        "--add-header",
        "X-IG-App-ID:936619743392459",
        "--add-header",
        "X-Requested-With:XMLHttpRequest",
      );
      const hasCookies = cookieManager.addCookieOptions(options, platform);
      if (!hasCookies) {
        console.log("⚠️  [INSTAGRAM] No cookies! Download may fail.");
      }
    } else if (platform === "twitter") {
      const heightMap = { highest: 1080, high: 720, medium: 480, low: 360 };
      const maxHeight = heightMap[quality] || 720;

      options.push(
        "-f",
        `best[ext=mp4][height<=${maxHeight}]/best[ext=mp4]/best`,
      );
      cookieManager.addCookieOptions(options, platform);
    } else if (platform === "facebook") {
      const heightMap = { highest: 1080, high: 720, medium: 480, low: 360 };
      const maxHeight = heightMap[quality] || 720;

      options.push(
        "-f",
        `best[ext=mp4][height<=${maxHeight}]/best[ext=mp4]/best`,
      );
      cookieManager.addCookieOptions(options, platform);
    } else if (platform === "reddit") {
      options.push("-f", "best[ext=mp4]/best");
    } else {
      // YouTube + Vimeo + all others
      const heightMap = { highest: 1080, high: 720, medium: 720, low: 480 };
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

    if (platform === "youtube") {
      options.push("--geo-bypass-country", "US");
      cookieManager.addCookieOptions(options, platform);
    }

    return options;
  }

  // ============================================================
  // 🔥 FIX 2: CORRECTED estimateFileSize
  // Old code used 10MB/s bitrate = WAY too high, blocked everything!
  // Real YouTube 720p = ~200KB/s, 1080p = ~400KB/s
  // ============================================================
  estimateFileSize(durationSeconds, quality) {
    // Unknown duration = NEVER block! Let it try and check real size after
    if (!durationSeconds || durationSeconds === 0) {
      return 0;
    }

    // REALISTIC bitrates in bytes/second (actual measured values)
    const bitrateMap = {
      highest: 400000, // ~3.2 Mbps for 1080p
      high: 200000, // ~1.6 Mbps for 720p
      medium: 200000, // ~1.6 Mbps for 720p
      low: 80000, // ~640 Kbps for 480p
    };

    const bitrate = bitrateMap[quality] || bitrateMap.medium;
    const estimatedBytes = bitrate * durationSeconds;

    // Add 20% safety buffer
    return Math.ceil(estimatedBytes * 1.2);

    // REAL WORLD EXAMPLES NOW:
    // 10 min 720p  = 600 × 200000 × 1.2 = 144MB  ✅ passes 500MB limit
    // 30 min 720p  = 1800 × 200000 × 1.2 = 432MB ✅ passes 500MB limit
    // 45 min 720p  = 2700 × 200000 × 1.2 = 648MB ❌ blocked correctly
    // 10 min 1080p = 600 × 400000 × 1.2 = 288MB  ✅ passes 500MB limit
    // 20 min 1080p = 1200 × 400000 × 1.2 = 576MB ❌ blocked correctly
  }

  // ============================================================
  // 🔥 FIX 3: IMPROVED getUserFriendlyError with geo-restriction
  // ============================================================
  getUserFriendlyError(errorMessage) {
    const errorMap = {
      // Existing
      private: "This video is private and cannot be downloaded.",
      unavailable: "This video is no longer available.",
      removed: "This video has been removed.",
      "age-restricted":
        "This video is age-restricted and cannot be downloaded.",
      copyright: "This video is protected by copyright.",
      "members-only": "This video is only available to channel members.",
      timeout: "Download timed out. Please try again.",

      // 🔥 FIX: Geo-restriction - clear message explaining Singapore server
      "not available in your country":
        "This video is region-locked (not available from our Singapore servers). Please try a different video.",
      "not made this video available":
        "This video is region-locked and unavailable from our servers. Try a different video.",
      "geo-restricted":
        "This video is not available in our server region. Try a different video.",
      "available in":
        "This video is region-locked and unavailable from our servers. Try a different video.",

      // Network errors
      tiktok_network_error:
        "TikTok is temporarily unavailable. Please try again.",
      network_error: "Network connection failed. Please try again.",
      "could not connect": "Connection failed. Please try again.",
      "failed to connect": "Connection failed. Please try again.",
      "connection timed out": "Connection timed out. Please try again.",
      "failed to perform": "Network error. Please try again.",

      // Format errors
      "requested format is not available":
        "Video format unavailable. Please try again.",
      "unable to extract":
        "Could not extract video. The link may have expired.",

      // Login/auth
      "login required": "This content requires login. Try a public video.",
      "rate-limit": "Rate limit reached. Please try again in a few minutes.",
      "requested content is not available":
        "This content is private or requires login.",
    };

    const lowerError = errorMessage.toLowerCase();
    for (const [key, message] of Object.entries(errorMap)) {
      if (lowerError.includes(key.toLowerCase())) {
        return message;
      }
    }

    return "Download failed. Please check the URL and try again.";
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
