const YTDlpWrap = require("yt-dlp-wrap").default;
const fs = require("fs-extra");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const cookieManager = require("./cookieManager");

const {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { GetObjectCommand } = require("@aws-sdk/client-s3");

const https = require("https");
const dns = require("dns");
const { Resolver } = require("dns").promises;
const platformDetector = require("./platformDetector");
const Download = require("../models/Download");

dns.setServers(["8.8.8.8", "1.1.1.1"]);
const resolver = new Resolver();
resolver.setServers(["8.8.8.8", "1.1.1.1"]);

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
    this.maxRetries = 3;
    this.retryDelay = 2000;

    this.ensureDirectories();
    this.testDNSResolution();
    this.initializeR2Client();
    this.startCleanupJob();
    this.logCookieStatus();
  }

  // ─── COOKIE STATUS LOG ────────────────────────────────────────────
  logCookieStatus() {
    const status = cookieManager.getStatus();
    console.log("\n🍪 Cookie Manager Status:");
    console.log(`   Has Cookies: ${status.hasCookies ? "✅" : "❌"}`);
    console.log(`   Source: ${status.cookieSource}`);
    console.log(`   Valid: ${status.valid ? "✅" : "❌"}`);
    if (status.ageHours) console.log(`   Age: ${status.ageHours} hours`);
    if (!status.hasCookies) {
      console.log("\n⚠️  WARNING: No cookies configured!");
      console.log("💡 Add YOUTUBE_COOKIES environment variable in Railway");
    }
    console.log("");
  }

  // ─── DNS ──────────────────────────────────────────────────────────
  async testDNSResolution() {
    if (!process.env.R2_ACCOUNT_ID) return;
    const hostname = `${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
    try {
      const addresses = await resolver.resolve4(hostname);
      this.r2IP = addresses[0];
      console.log(`✓ R2 DNS resolved: ${this.r2IP}`);
    } catch {
      this.r2IP = "172.64.66.1";
    }
  }

  // ─── R2 ───────────────────────────────────────────────────────────
  async initializeR2Client() {
    if (!process.env.R2_ACCOUNT_ID || !process.env.R2_ACCESS_KEY_ID) {
      console.log("⚠ R2 credentials not found - using local storage only");
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
          httpsAgent,
          requestTimeout: 120000,
          connectionTimeout: 30000,
        },
      });
      this.r2Working = await this.testR2Connection();
      console.log(
        this.r2Working ? "✓ R2 connection working" : "✗ R2 connection failed",
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
    } catch {
      return false;
    }
  }

  // ─── DIRECTORIES ──────────────────────────────────────────────────
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

  // ─── CLEANUP ──────────────────────────────────────────────────────
  startCleanupJob() {
    const cleanupInterval = process.env.RAILWAY_ENVIRONMENT
      ? 2 * 60 * 1000
      : 5 * 60 * 1000;
    setInterval(async () => {
      try {
        const now = Date.now();
        for (const dir of [this.tempDir, this.downloadDir]) {
          try {
            const files = await fs.readdir(dir);
            for (const file of files) {
              const filePath = path.join(dir, file);
              const stats = await fs.stat(filePath);
              const maxAge = process.env.RAILWAY_ENVIRONMENT
                ? 15 * 60 * 1000
                : 30 * 60 * 1000;
              if (now - stats.mtimeMs > maxAge) {
                await fs.remove(filePath);
                console.log(`🗑️ Cleaned up old file: ${file}`);
              }
            }
          } catch {}
        }
      } catch (error) {
        console.error("Cleanup job error:", error.message);
      }
    }, cleanupInterval);
    console.log(`✓ Cleanup job started (interval: ${cleanupInterval / 1000}s)`);
  }

  // ─── BUG-FIX 1: SANITISE URL BEFORE IT REACHES yt-dlp ────────────
  sanitiseUrl(rawUrl) {
    if (!rawUrl) return rawUrl;
    let url = rawUrl.trim();

    // Remove any duplicate concatenation like:
    //   youtube.com/watchttps://youtube.com/watch?v=XXXh?v=XXX
    // Strategy: if the string contains "http" more than once, take the LAST valid URL
    const httpMatches = url.match(/https?:\/\/[^\s]+/g);
    if (httpMatches && httpMatches.length > 1) {
      // Use the last http(s):// occurrence — that's normally the real one
      url = httpMatches[httpMatches.length - 1];
      console.log(`🔧 Fixed duplicated URL → ${url}`);
    }

    // YouTube: normalise youtu.be short links and remove extra params
    const ytShort = url.match(/youtu\.be\/([\w-]{11})/);
    if (ytShort) {
      url = `https://www.youtube.com/watch?v=${ytShort[1]}`;
    }

    // YouTube: extract video ID from any youtube.com URL mess
    const ytLong = url.match(/youtube\.com\/watch[^?]*\?.*?v=([\w-]{11})/);
    if (ytLong) {
      url = `https://www.youtube.com/watch?v=${ytLong[1]}`;
    }

    // Instagram: keep clean
    const igReel = url.match(/instagram\.com\/(?:reel|p)\/([\w-]+)/);
    if (igReel) {
      url = `https://www.instagram.com/reel/${igReel[1]}/`;
    }

    // TikTok: keep clean
    const ttMatch = url.match(/tiktok\.com\/(?:@[\w.-]+\/video\/)?([\d]+)/);
    if (ttMatch) {
      url = `https://www.tiktok.com/embed/video/${ttMatch[1]}`;
    }

    return url;
  }

  // ─── DETECT PLATFORM FROM URL ─────────────────────────────────────
  detectPlatformFromUrl(url) {
    if (!url) return "unknown";
    const lower = url.toLowerCase();
    if (lower.includes("youtube") || lower.includes("youtu.be"))
      return "youtube";
    if (lower.includes("instagram")) return "instagram";
    if (lower.includes("tiktok")) return "tiktok";
    if (lower.includes("facebook") || lower.includes("fb.watch"))
      return "facebook";
    if (lower.includes("twitter") || lower.includes("x.com")) return "twitter";
    return "other";
  }

  // ─── MAIN ENTRY ───────────────────────────────────────────────────
  async downloadVideo(options = {}) {
    const {
      url: rawUrl,
      quality = "high",
      format = "mp4",
      audioOnly = false,
      userIP = null,
      userAgent = null,
      includeThumbnail = false,
    } = options;

    if (this.activeDownloads.size >= this.maxConcurrentDownloads) {
      return {
        success: false,
        error: "Server is at capacity. Please try again in a moment.",
        code: "SERVER_BUSY",
      };
    }

    // 🔧 FIX: sanitise the URL BEFORE anything else
    const url = this.sanitiseUrl(rawUrl);

    const downloadId = crypto.randomBytes(8).toString("hex");
    let downloadRecord = null;
    const downloadStartTime = Date.now();

    try {
      const detection = platformDetector.detectPlatform(url);
      if (!detection.success) throw new Error(detection.error);

      console.log(
        `\n📥 [${downloadId}] Starting download from ${detection.platformName}`,
      );
      console.log(
        `⚙️ Quality: ${quality}, Format: ${format}, Thumbnail: ${includeThumbnail ? "YES" : "NO"}`,
      );

      this.activeDownloads.set(downloadId, { startTime: Date.now(), url });

      downloadRecord = await this.createDownloadRecord({
        url,
        detection,
        quality,
        format,
        userIP,
        userAgent,
      });

      // metadata
      let metadata;
      try {
        console.log("📋 Extracting metadata...");
        metadata = await Promise.race([
          this.getVideoMetadata(url, detection.platform),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Metadata timeout")), 20000),
          ),
        ]);
        console.log(`✓ Metadata: "${metadata.title}"`);
      } catch (metaError) {
        console.log("⚠ Metadata extraction failed, using defaults");
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

      const downloadResult = await this.performStreamingDownloadWithRetry({
        url,
        quality,
        format,
        audioOnly,
        detection,
        metadata,
        downloadId,
      });

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
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
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
        message: includeThumbnail
          ? "Video ready! Thumbnail URL included."
          : "Video downloaded successfully!",
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

      const userMessage = this.getUserFriendlyError(error.message);

      if (downloadRecord) {
        await this.updateDownloadRecord(downloadRecord, {
          status: "failed",
          error: { message: userMessage, code: error.code || "DOWNLOAD_ERROR" },
          processingEndTime: new Date(),
        }).catch(() => {});
      }

      return {
        success: false,
        error: userMessage,
        code: error.code || "DOWNLOAD_ERROR",
      };
    } finally {
      this.activeDownloads.delete(downloadId);
    }
  }

  // ─── RETRY WRAPPER ────────────────────────────────────────────────
  async performStreamingDownloadWithRetry(options) {
    const { downloadId } = options;
    let lastError = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        console.log(`🔄 [${downloadId}] Attempt ${attempt}/${this.maxRetries}`);
        const result = await this.performStreamingDownload(options);
        if (attempt > 1)
          console.log(
            `✅ [${downloadId}] Succeeded on retry attempt ${attempt}`,
          );
        return result;
      } catch (error) {
        lastError = error;
        console.error(
          `❌ [${downloadId}] Attempt ${attempt} failed:`,
          error.message,
        );

        if (
          error.message.toLowerCase().includes("bot") ||
          error.message.toLowerCase().includes("sign in")
        ) {
          console.error(
            `🤖 [${downloadId}] Bot detection error - checking cookies...`,
          );
          const cookieStatus = cookieManager.getStatus();
          if (!cookieStatus.hasCookies)
            console.error(`❌ [${downloadId}] NO COOKIES CONFIGURED!`);
          else if (!cookieStatus.valid)
            console.error(`❌ [${downloadId}] Cookies are invalid or expired!`);
        }

        if (attempt < this.maxRetries) {
          const delay = this.retryDelay * Math.pow(2, attempt - 1);
          console.log(`⏳ [${downloadId}] Waiting ${delay}ms before retry...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }
    console.error(`❌ [${downloadId}] All ${this.maxRetries} attempts failed`);
    throw lastError;
  }

  // ─── STREAMING DOWNLOAD ROUTER ───────────────────────────────────
  async performStreamingDownload(options) {
    const { url, quality, format, audioOnly, metadata, downloadId } = options;
    const fileName = `${this.sanitizeFilename(metadata?.title || "video")}.${format}`;
    const contentType = this.getContentType(`.${format}`);

    if (this.r2Client && this.r2Working) {
      try {
        console.log(`☁️ [${downloadId}] Downloading and uploading to R2...`);
        const result = await this.downloadAndUploadToR2({
          url,
          quality,
          format,
          audioOnly,
          fileName,
          contentType,
          downloadId,
        });
        console.log(`✓ [${downloadId}] R2 upload completed`);
        return result;
      } catch (r2Error) {
        console.warn(`⚠ [${downloadId}] R2 upload failed:`, r2Error.message);
      }
    }

    console.log(`[${downloadId}] Using local storage fallback`);
    return await this.performLocalDownload({
      url,
      quality,
      format,
      audioOnly,
      fileName,
      downloadId,
    });
  }

  // ─── R2 DOWNLOAD + UPLOAD ─────────────────────────────────────────
  async downloadAndUploadToR2(options) {
    const {
      url,
      quality,
      format,
      audioOnly,
      fileName,
      contentType,
      downloadId,
    } = options;
    const tempFile = path.join(this.tempDir, `${downloadId}.${format}`);
    const ytDlpArgs = this.buildDownloadOptions({
      url,
      quality,
      format,
      audioOnly,
    });
    ytDlpArgs.push("-o", tempFile);

    console.log(`⬇️ [${downloadId}] Downloading video...`);
    await this.ytDlp.execPromise([url, ...ytDlpArgs]);

    const stats = await fs.stat(tempFile);
    const fileSize = stats.size;
    console.log(
      `✓ [${downloadId}] Download complete (${this.formatFileSize(fileSize)})`,
    );

    console.log(`☁️ [${downloadId}] Uploading to R2...`);
    const fileContent = await fs.readFile(tempFile);
    const key = `downloads/${Date.now()}_${crypto.randomBytes(8).toString("hex")}_${fileName}`;

    await this.r2Client.send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: key,
        Body: fileContent,
        ContentType: contentType,
        ContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        CacheControl: "public, max-age=31536000",
      }),
    );

    const downloadUrl = await getSignedUrl(
      this.r2Client,
      new GetObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: key,
      }),
      { expiresIn: 86400 },
    );

    await fs.remove(tempFile).catch(() => {});
    return { success: true, downloadUrl, fileSize, quality, format };
  }

  // ─── LOCAL DOWNLOAD ───────────────────────────────────────────────
  async performLocalDownload(options) {
    const { url, quality, format, audioOnly, fileName, downloadId } = options;
    const tempFile = path.join(this.tempDir, `${downloadId}.${format}`);
    const ytDlpArgs = this.buildDownloadOptions({
      url,
      quality,
      format,
      audioOnly,
    });
    ytDlpArgs.push("-o", tempFile);

    console.log(`⬇️ [${downloadId}] Downloading to temp file...`);
    await this.ytDlp.execPromise([url, ...ytDlpArgs]);

    const stats = await fs.stat(tempFile);
    const fileSize = stats.size;
    const finalFileName = `${Date.now()}_${fileName}`;
    const finalPath = path.join(this.downloadDir, finalFileName);
    await fs.move(tempFile, finalPath);

    return {
      success: true,
      downloadUrl: `/api/v1/download/file/${encodeURIComponent(finalFileName)}`,
      fileSize,
      quality,
      format,
    };
  }

  // ─── BUG-FIX 2 & 3: PER-PLATFORM OPTIONS ─────────────────────────
  // Cookies, referer, and ffmpeg args now change based on the actual platform.
  buildDownloadOptions({ url, quality, format, audioOnly }) {
    const options = [];
    const platform = this.detectPlatformFromUrl(url);

    // ── cookies: only add for YouTube ──
    if (platform === "youtube") {
      cookieManager.addCookieOptions(options);
    } else {
      console.log(`🍪 Skipping YouTube cookies for ${platform}`);
    }

    // ── audio-only path ──
    if (audioOnly || format === "mp3") {
      if (platform === "instagram" || platform === "tiktok") {
        // Instagram/TikTok: download best video+audio, then extract audio
        // avoids the "unable to obtain file audio codec with ffprobe" crash
        options.push(
          "-f",
          "best",
          "--extract-audio",
          "--audio-format",
          "mp3",
          "--audio-quality",
          "0",
          "--postprocessor-args",
          "ffmpeg:-y",
        );
      } else {
        options.push(
          "-f",
          "bestaudio/best",
          "--extract-audio",
          "--audio-format",
          "mp3",
          "--audio-quality",
          "0",
        );
      }
    } else {
      // ── video path ──
      const heightMap = {
        highest: "2160",
        high: "1080",
        medium: "720",
        low: "480",
      };
      const maxHeight = heightMap[quality] || "1080";

      if (platform === "instagram" || platform === "tiktok") {
        // Instagram/TikTok typically serve a single combined stream
        options.push("-f", "best");
      } else {
        options.push(
          "-f",
          `bestvideo[height<=${maxHeight}]+bestaudio/best[height<=${maxHeight}]/best`,
        );
      }

      if (format === "mp4") {
        options.push("--merge-output-format", "mp4");
        options.push(
          "--postprocessor-args",
          "ffmpeg:-c:v copy -c:a aac -b:a 192k",
        );
      }
    }

    // ── shared network options ──
    options.push(
      "--no-playlist",
      "--no-warnings",
      "--socket-timeout",
      "30",
      "--retries",
      "10",
      "--fragment-retries",
      "10",
    );

    // ── per-platform user-agent & referer ──
    if (platform === "instagram") {
      options.push(
        "--user-agent",
        "Mozilla/5.0 (Linux; Android 13; SM-G998B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.230 Mobile Safari/537.36",
        "--referer",
        "https://www.instagram.com/",
      );
    } else if (platform === "tiktok") {
      options.push(
        "--user-agent",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "--referer",
        "https://www.tiktok.com/",
      );
    } else if (platform === "facebook") {
      options.push(
        "--user-agent",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "--referer",
        "https://www.facebook.com/",
      );
    } else {
      // YouTube / default
      options.push(
        "--user-agent",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "--referer",
        "https://www.youtube.com/",
        "--hls-prefer-native",
      );
    }

    return options;
  }

  // ─── ERROR MESSAGES ───────────────────────────────────────────────
  getUserFriendlyError(errorMessage) {
    const lower = errorMessage.toLowerCase();
    if (lower.includes("sign in") || lower.includes("bot"))
      return "YouTube blocked this request. Please try again in 30 seconds.";
    if (lower.includes("private"))
      return "This video is private and cannot be downloaded.";
    if (lower.includes("unavailable") || lower.includes("removed"))
      return "This video is no longer available.";
    if (lower.includes("age-restricted"))
      return "This video is age-restricted and cannot be downloaded.";
    if (lower.includes("copyright"))
      return "This video is protected by copyright.";
    if (lower.includes("geo"))
      return "This video is not available in your region.";
    if (lower.includes("timeout"))
      return "Download timed out. Please try a lower quality.";
    if (lower.includes("members"))
      return "This video is only available to channel members.";
    if (lower.includes("ffprobe") || lower.includes("postprocessing"))
      return "Audio processing failed. Try downloading as video (mp4) instead.";
    return "Download failed. The video may be restricted or unavailable.";
  }

  // ─── DB HELPERS ───────────────────────────────────────────────────
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

  // ─── METADATA ─────────────────────────────────────────────────────
  async getVideoMetadata(url, platform) {
    try {
      const options = [
        "--dump-json",
        "--no-playlist",
        "--skip-download",
        "--socket-timeout",
        "20",
        "--no-warnings",
      ];

      // per-platform cookies + user-agent for metadata too
      const detectedPlatform = this.detectPlatformFromUrl(url);
      if (detectedPlatform === "youtube") {
        cookieManager.addCookieOptions(options);
        options.push(
          "--user-agent",
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "--referer",
          "https://www.youtube.com/",
        );
      } else if (detectedPlatform === "instagram") {
        options.push(
          "--user-agent",
          "Mozilla/5.0 (Linux; Android 13; SM-G998B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.230 Mobile Safari/537.36",
          "--referer",
          "https://www.instagram.com/",
        );
      } else if (detectedPlatform === "tiktok") {
        options.push(
          "--user-agent",
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "--referer",
          "https://www.tiktok.com/",
        );
      } else {
        options.push(
          "--user-agent",
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        );
      }

      const result = await this.ytDlp.execPromise([url, ...options]);
      const metadata = JSON.parse(result);

      let uploadDate = null;
      if (metadata.upload_date) {
        try {
          const dateStr = metadata.upload_date.toString();
          if (dateStr.length === 8) {
            uploadDate = new Date(
              parseInt(dateStr.substring(0, 4)),
              parseInt(dateStr.substring(4, 6)) - 1,
              parseInt(dateStr.substring(6, 8)),
            );
          }
        } catch {}
      }

      let thumbnail = null;
      if (metadata.thumbnails && metadata.thumbnails.length > 0) {
        const sorted = metadata.thumbnails.sort(
          (a, b) => (b.width || 0) - (a.width || 0),
        );
        thumbnail = sorted[0].url;
      } else if (metadata.thumbnail) {
        thumbnail = metadata.thumbnail;
      }

      return {
        title: metadata.title || "Unknown Title",
        description: (metadata.description || "").substring(0, 2000),
        thumbnail,
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

  // ─── VALIDATION ───────────────────────────────────────────────────
  validateDownloadRequest(options) {
    const { url: rawUrl, quality, format } = options;
    if (!rawUrl) return { valid: false, error: "URL is required" };

    const url = this.sanitiseUrl(rawUrl);
    const detection = platformDetector.detectPlatform(url);
    if (!detection.success) return { valid: false, error: detection.error };

    const validQualities = ["highest", "high", "medium", "low"];
    if (quality && !validQualities.includes(quality))
      return {
        valid: false,
        error: `Invalid quality. Must be one of: ${validQualities.join(", ")}`,
      };

    const validFormats = ["mp4", "mp3", "webm"];
    if (format && !validFormats.includes(format))
      return {
        valid: false,
        error: `Invalid format. Must be one of: ${validFormats.join(", ")}`,
      };

    return { valid: true, detection };
  }

  // ─── UTILS ────────────────────────────────────────────────────────
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
    let size = bytes,
      unitIndex = 0;
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
    const cookieStatus = cookieManager.getStatus();
    return {
      activeDownloads: this.activeDownloads.size,
      maxConcurrent: this.maxConcurrentDownloads,
      r2Status: this.r2Working ? "operational" : "degraded",
      cookieStatus:
        cookieStatus.hasCookies && cookieStatus.valid
          ? "operational"
          : "missing",
      uptime: process.uptime(),
    };
  }
}

module.exports = new VideoDownloaderService();
