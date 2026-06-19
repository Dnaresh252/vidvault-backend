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
const proxyManager = require("./proxyManager");
// Line ~16 area — this line is MISSING ❌
const instantMetadataService = require("./instantMetadataService");
dns.setServers(["8.8.8.8", "1.1.1.1"]);
const resolver = new Resolver();
resolver.setServers(["8.8.8.8", "1.1.1.1"]);

// ── Instagram auth-error patterns ───────────────────────────────────────────
const INSTAGRAM_AUTH_PATTERNS = [
  "login_required",
  "checkpoint_required",
  "HTTP Error 401",
  "401 Client Error",
  "login and try again",
  "Please log in",
  "not-authorized",
  "Sorry, this page isn",
  "This content isn",
  "cookies expired",
  "sessionid",
  "Please wait a few minutes before you try again",
];

function isInstagramAuthError(stderr) {
  const lower = stderr.toLowerCase();
  return INSTAGRAM_AUTH_PATTERNS.some((p) => lower.includes(p.toLowerCase()));
}

// ── YouTube rate-limit patterns ──────────────────────────────────────────────
// yt-dlp writes these to stderr when YouTube detects bot-like activity or the
// cookie account has been rate-limited.
const YOUTUBE_RATELIMIT_PATTERNS = [
  "Sign in to confirm",
  "confirm you're not a bot",
  "confirm that you're not a bot",
  "HTTP Error 429",
  "429 Too Many Requests",
  "rate-limited",
  "ratelimited",
  "Too many requests",
  "unusual traffic",
  "This helps protect our community",
  "bot traffic",
];

function isYouTubeRateLimited(stderr) {
  const lower = stderr.toLowerCase();
  return YOUTUBE_RATELIMIT_PATTERNS.some((p) => lower.includes(p.toLowerCase()));
}

function isProxyHttpBlocked(stderr) {
  return (
    stderr.includes("HTTP Error 403") ||
    stderr.includes("403 Forbidden") ||
    stderr.includes("HTTP Error 429") ||
    stderr.includes("429 Too Many Requests")
  );
}

const PROXY_CONN_ERROR_PATTERNS = [
  "Tunnel connection failed",
  "Unable to connect to proxy",
  "Could not connect to proxy",
  "Cannot connect to proxy",
  "Failed to connect to proxy",
  "Proxy connection failed",
  "ProxyError",
  "407 Proxy Authentication",
  "urlopen error timed out",
  "connection timed out",
];

function isProxyConnError(stderr) {
  const lower = stderr.toLowerCase();
  return PROXY_CONN_ERROR_PATTERNS.some((p) => lower.includes(p.toLowerCase()));
}

// 🔥 CONSTANTS FOR PREMIUM SERVICE
const JS_RUNTIME = process.platform === "win32" ? "node" : "node:/usr/local/bin/node";
const MAX_FILE_SIZE = 400 * 1024 * 1024; // 400MB hard limit
const RECOMMENDED_QUALITY = "medium"; // 720p default
const TEMP_FILE_MAX_AGE = 5 * 60 * 1000; // 5 minutes
const R2_FILE_MAX_AGE = 1 * 60 * 60 * 1000; // 1 hour

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
    this.inProgressDownloads = new Map();
    this.maxConcurrentDownloads = parseInt(process.env.MAX_CONCURRENT) || 15;
    this.youtubeLastDownloadByIP = new Map();

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
    const runCleanup = async () => {
      if (!this.r2Client || !this.r2Working) return;
      try {
        let continuationToken = undefined;
        let deletedCount = 0;
        let checkedCount = 0;
        const now = Date.now();
        do {
          const response = await this.r2Client.send(new ListObjectsV2Command({
            Bucket: process.env.R2_BUCKET_NAME,
            Prefix: "downloads/",
            MaxKeys: 1000,
            ContinuationToken: continuationToken,
          }));
          if (!response.Contents || response.Contents.length === 0) break;
          checkedCount += response.Contents.length;
          for (const file of response.Contents) {
            const fileAge = now - new Date(file.LastModified).getTime();
            if (fileAge > R2_FILE_MAX_AGE) {
              try {
                await this.r2Client.send(new DeleteObjectCommand({
                  Bucket: process.env.R2_BUCKET_NAME,
                  Key: file.Key,
                }));
                deletedCount++;
              } catch (delErr) {
                console.error(`❌ R2 delete failed: ${file.Key}: ${delErr.message}`);
              }
            }
          }
          continuationToken = response.NextContinuationToken;
        } while (continuationToken);
        console.log(`🧹 R2 cleanup: checked ${checkedCount}, deleted ${deletedCount} files`);
      } catch (error) {
        console.error("❌ R2 cleanup error:", error.message);
      }
    };
    setTimeout(runCleanup, 2 * 60 * 1000);
    setInterval(runCleanup, 10 * 60 * 1000);
    console.log(`✅ R2 cleanup: runs after 2min, then every 10min with pagination`);
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
      const cached = await cacheService.getR2Url(url, quality, format);
      if (cached && cached.url) {
        console.log(`⚡ Queue bypass — instant cache hit`);
        return {
          success: true,
          data: {
            downloadUrl: cached.url,
            fileSize: cached.fileSize || 0,
            quality, format,
            cached: true,
            title: "Video",
            thumbnail: null,
            duration: 0,
            platform: "Unknown",
          },
          message: "Ready instantly! ⚡",
        };
      }
      return {
        success: false,
        error: "RETRY_SOON",
        code: "RETRY_SOON",
        retryAfter: 8,
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

      const dedupKey = `${url}::${quality}::${format}`;
      if (this.inProgressDownloads.has(dedupKey)) {
        console.log(`⚡ [${downloadId}] Dedup HIT — joining in-progress download`);
        this.activeDownloads.delete(downloadId);
        return this.inProgressDownloads.get(dedupKey);
      }

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

        try {
          await Download.findOneAndUpdate(
            { originalUrl: url },
            { $inc: { cacheHitCount: 1 } },
            { sort: { createdAt: -1 } }
          );
        } catch (e) { /* non-critical */ }

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

      // Stagger consecutive YouTube downloads from the same IP (2-5s)
      // to avoid triggering YouTube's rate limiting on the server's IP.
      if (detection.platform === "youtube" && userIP) {
        const lastTime = this.youtubeLastDownloadByIP.get(userIP);
        if (lastTime) {
          const elapsed = Date.now() - lastTime;
          const minGap = 2000 + Math.random() * 3000; // 2–5 seconds
          if (elapsed < minGap) {
            const wait = Math.ceil(minGap - elapsed);
            console.log(`⏳ [${downloadId}] YouTube delay ${wait}ms for IP ${userIP}`);
            await new Promise((resolve) => setTimeout(resolve, wait));
          }
        }
        this.youtubeLastDownloadByIP.set(userIP, Date.now());

        // Prune entries older than 10 minutes to prevent unbounded growth
        if (this.youtubeLastDownloadByIP.size > 1000) {
          const cutoff = Date.now() - 10 * 60 * 1000;
          for (const [ip, ts] of this.youtubeLastDownloadByIP) {
            if (ts < cutoff) this.youtubeLastDownloadByIP.delete(ip);
          }
        }
      }

      let metadata;
      try {
        console.log("📋 Extracting metadata...");
        metadata =
          prefetchedMetadata ||
          (await instantMetadataService.getInstantMetadata(url)).data;
        console.log(`✓ Metadata: "${metadata.title}"`);

        // Hard block — reject videos over 1 hour
        if (metadata.duration && metadata.duration > 3600) {
          return {
            success: false,
            error: "This video is too long. Maximum duration is 1 hour.",
            code: "VIDEO_TOO_LONG",
          };
        }
        if (metadata.is_live || metadata.live_status === "is_live" || metadata.live_status === "post_live" || metadata.duration === 0) {
          return {
            success: false,
            error: "Live streams and premieres cannot be downloaded.",
            code: "LIVE_STREAM",
          };
        }

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

      const downloadPromise = (async () => {
        try {
          const result = await this.performStreamingDownload({
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
            result.downloadUrl,
            result.fileSize,
            55 * 60, // 55 minutes
          );
          return result;
        } finally {
          this.inProgressDownloads.delete(dedupKey);
        }
      })();
      this.inProgressDownloads.set(dedupKey, downloadPromise);
      const downloadResult = await downloadPromise;

      const downloadDuration = (
        (Date.now() - downloadStartTime) /
        1000
      ).toFixed(2);
      console.log(
        `✓ [${downloadId}] Download completed in ${downloadDuration}s`,
      );

      const responseData = {
        id: downloadId,
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

    const baseR2Opts = { url, quality, format, audioOnly, fileName, contentType, downloadId, platform };

    let result;
    try {
      result = await this._tryWithProxies(baseR2Opts, progressCallback, downloadId);
    } catch (err) {
      if (err.code === "INSTAGRAM_AUTH") {
        console.log(`🔄 [${downloadId}] Instagram auth error — rotating cookie...`);
        const rotation = await cookieManager.switchInstagramCookie();
        if (rotation.allFailed) {
          await cookieManager.notifyAllCookiesExpired();
          throw new Error("Instagram authentication failed. Please try again later.");
        }
        console.log(`🔄 [${downloadId}] Retrying with Instagram cookie ${rotation.newIndex + 1}...`);
        try {
          result = await this.streamDirectlyToR2(baseR2Opts, progressCallback);
        } catch (retryErr) {
          if (retryErr.code === "INSTAGRAM_AUTH") {
            await cookieManager.notifyAllCookiesExpired();
            throw new Error("Instagram authentication failed. Please try again later.");
          }
          throw retryErr;
        }
      } else if (err.code === "YOUTUBE_RATE_LIMITED") {
        console.log(`🔄 [${downloadId}] YouTube rate limited — rotating cookie...`);
        const rotation = await cookieManager.switchYouTubeCookie();
        if (rotation.allFailed) {
          await cookieManager.notifyAllYouTubeCookiesRateLimited();
          throw new Error("YouTube is temporarily rate limiting our servers. Please try again in 1 hour.");
        }
        console.log(`🔄 [${downloadId}] Retrying with YouTube cookie ${rotation.newIndex + 1}...`);
        try {
          result = await this.streamDirectlyToR2(baseR2Opts, progressCallback);
        } catch (retryErr) {
          if (retryErr.code === "YOUTUBE_RATE_LIMITED") {
            await cookieManager.notifyAllYouTubeCookiesRateLimited();
            throw new Error("YouTube is temporarily rate limiting our servers. Please try again in 1 hour.");
          }
          throw retryErr;
        }
      } else {
        throw err;
      }
    }

    console.log(`✓ [${downloadId}] R2 upload completed`);
    return result;
  }

  // Phase 1: lightweight --skip-download info-check via proxy (no bandwidth cost).
  // Phase 2: actual video download always uses direct connection — proxies cannot
  //          handle 50-500MB files without exhausting bandwidth instantly.
  async _tryWithProxies(r2Options, progressCallback, downloadId) {
    const { url, platform } = r2Options;

    // Info-extraction pre-check through proxy (YouTube only — updates health scores
    // without touching video bandwidth).
    if (platform === "youtube") {
      const proxy = proxyManager.getBestProxy();
      if (proxy) {
        console.log(`🔀 [${downloadId}] Proxy info-check ${proxy}`);
        try {
          await this._skipDownloadCheck(url, proxy);
          proxyManager.recordResult(proxy, true);
        } catch (err) {
          if (err.code === "PROXY_CONN_ERR") {
            proxyManager.recordResult(proxy, false, "500");
            console.log(`🔀 [${downloadId}] Proxy unreachable (retired)`);
          } else if (err.code === "PROXY_403" || err.code === "PROXY_429") {
            proxyManager.recordResult(proxy, false, err.code.slice(6));
            console.log(`🔀 [${downloadId}] Proxy blocked (${err.code})`);
          }
          // Pre-check failure is non-fatal — always proceed to direct download
        }
      }
    }

    // Actual video download always direct — never through proxy
    return this.streamDirectlyToR2({ ...r2Options, proxy: null }, progressCallback);
  }

  // Lightweight yt-dlp --skip-download through a proxy to validate accessibility
  // and maintain proxy health scores. Resolves in <5s, uses zero video bandwidth.
  async _skipDownloadCheck(url, proxy) {
    const { spawn } = require("child_process");
    return new Promise((resolve, reject) => {
      const proc = spawn("yt-dlp", [
        url,
        "--skip-download",
        "--no-playlist",
        "--socket-timeout", "8",
        "--proxy", proxy,
        "--extractor-args", "youtube:player_client=web,default",
      ]);
      let stderr = "";
      proc.stderr.on("data", (d) => { stderr += d.toString(); });
      proc.on("close", (code) => {
        if (code === 0) return resolve();
        if (isProxyConnError(stderr)) {
          const e = new Error("Proxy connection failed");
          e.code = "PROXY_CONN_ERR";
          return reject(e);
        }
        if (isProxyHttpBlocked(stderr)) {
          const e = new Error("Proxy blocked");
          e.code = stderr.includes("403") ? "PROXY_403" : "PROXY_429";
          return reject(e);
        }
        resolve(); // Non-proxy error in pre-check — proceed to direct download
      });
      proc.on("error", () => resolve());
      // Hard cap: kill pre-check after 20s so it never blocks the download
      setTimeout(() => { proc.kill("SIGTERM"); resolve(); }, 20_000);
    });
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
      const cached = await cacheService.getR2Url(url, quality, format);
      if (cached && cached.url) {
        console.log(`⚡ Queue bypass — instant cache hit`);
        return {
          success: true,
          data: {
            downloadUrl: cached.url,
            fileSize: cached.fileSize || 0,
            quality, format,
            cached: true,
            title: "Video",
            thumbnail: null,
            duration: 0,
            platform: "Unknown",
          },
          message: "Ready instantly! ⚡",
        };
      }
      return {
        success: false,
        error: "RETRY_SOON",
        code: "RETRY_SOON",
        retryAfter: 8,
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

      const dedupKey = `${url}::${quality}::${format}`;
      if (this.inProgressDownloads.has(dedupKey)) {
        console.log(`⚡ [${downloadId}] Dedup HIT — joining in-progress download`);
        this.activeDownloads.delete(downloadId);
        return this.inProgressDownloads.get(dedupKey);
      }

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

        try {
          await Download.findOneAndUpdate(
            { originalUrl: url },
            { $inc: { cacheHitCount: 1 } },
            { sort: { createdAt: -1 } }
          );
        } catch (e) { /* non-critical */ }

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

        // Hard block — reject videos over 1 hour
        if (metadata.duration && metadata.duration > 3600) {
          return {
            success: false,
            error: "This video is too long. Maximum duration is 1 hour.",
            code: "VIDEO_TOO_LONG",
          };
        }
        if (metadata.is_live || metadata.live_status === "is_live" || metadata.live_status === "post_live" || metadata.duration === 0) {
          return {
            success: false,
            error: "Live streams and premieres cannot be downloaded.",
            code: "LIVE_STREAM",
          };
        }

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

      // Perform download with progress callback — shared across dedup waiters
      const downloadPromise = (async () => {
        try {
          const result = await this.performStreamingDownload(
            { url, quality, format, audioOnly, detection, metadata, downloadId },
            progressCallback,
          );
          await cacheService.setR2Url(
            url,
            quality,
            format,
            result.downloadUrl,
            result.fileSize,
            55 * 60, // 55 minutes
          );
          return result;
        } finally {
          this.inProgressDownloads.delete(dedupKey);
        }
      })();
      this.inProgressDownloads.set(dedupKey, downloadPromise);
      const downloadResult = await downloadPromise;

      // ✅ THE ONLY FIX: Save to MongoDB ONLY on success (you only count completed!)
      try {
        const successRecord = new Download({
          originalUrl: url,
          platform: detection.platform,
          videoId: detection.videoId,
          requestedQuality: quality,
          requestedFormat: format,
          status: "completed", // ✅ Only completed!
          title: metadata.title,
          thumbnail: metadata.thumbnail,
          duration: metadata.duration,
          actualQuality: downloadResult.quality,
          actualFormat: downloadResult.format,
          fileSize: downloadResult.fileSize,
          downloadUrl: downloadResult.downloadUrl,
          processingStartTime: new Date(downloadStartTime),
          processingEndTime: new Date(),
          ipAddress: userIP
            ? crypto.createHash("sha256").update(userIP).digest("hex")
            : null,
          userAgent: userAgent,
        });
        await successRecord.save();
        console.log(`✅ [${downloadId}] Saved to database`);
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

        // Auto-kill yt-dlp after 10 minutes max
        const maxTimer = setTimeout(() => {
          console.log(`⏰ [${downloadId}] yt-dlp timeout — killing`);
          ytDlpProcess.kill("SIGKILL");
        }, 10 * 60 * 1000);

        ytDlpProcess.on("close", () => {
          clearTimeout(maxTimer);
        });

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

        let stderrBuffer = "";
        ytDlpProcess.stderr.on("data", (data) => {
          const text = data.toString();
          stderrBuffer += text;
          console.log(`yt-dlp: ${text}`);
        });

        ytDlpProcess.on("close", (code) => {
          if (code === 0) {
            resolve();
          } else if (
            (platform === "instagram" || platform === "threads") &&
            isInstagramAuthError(stderrBuffer)
          ) {
            const authErr = new Error("Instagram cookie authentication failed");
            authErr.code = "INSTAGRAM_AUTH";
            reject(authErr);
          } else if (platform === "youtube" && isYouTubeRateLimited(stderrBuffer)) {
            const rateLimitErr = new Error("YouTube rate limited");
            rateLimitErr.code = "YOUTUBE_RATE_LIMITED";
            reject(rateLimitErr);
          } else if (stderrBuffer.includes("No space left") || stderrBuffer.includes("ENOSPC")) {
            const diskErr = new Error("no space left on device");
            diskErr.code = "DISK_FULL";
            reject(diskErr);
          } else {
            reject(new Error("Download failed"));
          }
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

      const downloadUrl = `https://downloads.vidvaults.com/${key}`;
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
      if (error.code === "DISK_FULL" || (error.message && error.message.includes("ENOSPC"))) {
        console.error("🚨 DISK FULL — triggering emergency cleanup");
        try {
          const { execSync } = require("child_process");
          execSync("find /tmp/temp -type f -mmin +1 -delete 2>/dev/null || true");
          execSync("find /tmp/downloads -type f -mmin +1 -delete 2>/dev/null || true");
        } catch (cleanErr) {
          console.error("Cleanup error:", cleanErr.message);
        }
        const diskError = new Error("no space left on device");
        diskError.code = "DISK_FULL";
        throw diskError;
      }
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
    } else if (platform === "threads") {
      const heightMap = {
        highest: 1080,
        high: 720,
        medium: 480,
        low: 360,
      };
      const maxHeight = heightMap[quality] || 720;

      options.push(
        "-f",
        `b[ext=mp4][height<=${maxHeight}]/b[ext=mp4]/best`,
        "--user-agent",
        "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 Instagram/311.0.0.34.109",
        "--add-header",
        "Referer:https://www.threads.net/",
        "--add-header",
        "Origin:https://www.threads.net",
        "--add-header",
        "X-IG-App-ID:936619743392459",
        "--add-header",
        "Accept-Language:en-US,en;q=0.9",
      );

      // Threads uses Instagram cookies
      const hasCookies = cookieManager.addCookieOptions(options, "instagram");
      if (!hasCookies) {
        console.log(
          "⚠️  [THREADS] No cookies — download may fail for some posts",
        );
      }
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
        const hlsMap = {
          highest: "96/95",
          high: "95/94",
          medium: "94/93",
          low: "93/92/18",
        };
        const hlsFormat = hlsMap[quality] || "95/94";
        options.push(
          "-f",
          `${hlsFormat}/18/bv*[ext=mp4][height<=${maxHeight}]+ba[ext=m4a]/b[ext=mp4][height<=${maxHeight}]/best`,
          "--merge-output-format",
          "mp4"
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
      "--match-filter",
      "!is_live & live_status != is_live",
      "--downloader", "aria2c",
      "--downloader-args", "aria2c:-x 16 -k 1M --file-allocation=none --console-log-level=warn",
      "--no-playlist",
      "--socket-timeout",
      "30",
      "--retries",
      "10",
      "--fragment-retries",
      "10",
      "--extractor-retries",
      "5",
      "--retry-sleep",
      "3",
      "--file-access-retries",
      "5",
      "--max-filesize",
      "400m",
      "--js-runtimes",
      JS_RUNTIME,
      "--extractor-args",
      "youtube:player_client=web,default",
      "--extractor-args",
      "youtubepot-bgutilhttp:disable_innertube=1",
    );

    if (platform === "youtube") {
      options.push(
        "--geo-bypass-country", "US",
        "--user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "--add-header", "Accept-Language:en-US,en;q=0.9",
      );
      cookieManager.addCookieOptions(options, platform);
    }
    return options;
  }

  async getDirectUrl(url, quality, format) {
    try {
      const platform = platformDetector.detectPlatform(url).platform;

      // High quality YouTube needs merge — skip direct URL
      if (platform === "youtube" && (quality === "high" || quality === "highest")) {
        return null;
      }

      const formatMap = {
        low: "18",
        medium: "22/18",
        high: "22/18",
        highest: "22/18",
      };

      const formatStr = format === "mp3"
        ? "bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio"
        : (formatMap[quality] || "22/18");

      const args = [
        "--get-url",
        "--no-playlist",
        "--socket-timeout", "15",
        "-f", formatStr,
      ];

      if (platform === "youtube") {
        args.push("--cookies", "/tmp/cookies/youtube_cookies.txt");
        args.push("--geo-bypass-country", "US");
      }

      if (platform === "instagram") {
        args.push("--cookies", "/tmp/cookies/instagram_cookies_1.txt");
      }

      args.push(url);

      return new Promise((resolve) => {
        const { spawn } = require("child_process");
        const ytDlpPath = process.env.YTDLP_PATH || "/opt/venv/bin/yt-dlp";
        const proc = spawn(ytDlpPath, args);
        let output = "";
        proc.stdout.on("data", d => { output += d.toString(); });
        const timer = setTimeout(() => { proc.kill("SIGKILL"); resolve(null); }, 20000);
        proc.on("close", (code) => {
          clearTimeout(timer);
          const lines = output.trim().split("\n").filter(l => l.startsWith("http"));
          resolve(code === 0 && lines[0] ? lines[0] : null);
        });
        proc.on("error", () => { clearTimeout(timer); resolve(null); });
      });
    } catch (e) {
      console.error("getDirectUrl error:", e.message);
      return null;
    }
  }

  estimateFileSize(durationSeconds, quality, platform = "generic") {
    if (!durationSeconds || durationSeconds <= 0) return 0;
    if (durationSeconds > 3600) return MAX_FILE_SIZE + 1;

    // Real-world yt-dlp averages (BYTES/sec)
    const bitrateTable = {
      youtube: {
        highest: 750000, // ~6 Mbps (1080p)
        high: 500000, // ~4 Mbps
        medium: 300000, // ~2.4 Mbps
        low: 150000, // ~1.2 Mbps
      },
      threads: {
        highest: 320000,
        high: 220000,
        medium: 160000,
        low: 90000,
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
    if (!errorMessage) return "Download failed. Please try again.";
    const msg = errorMessage.toLowerCase();
    if (msg.includes("private")) return "This video is private and cannot be downloaded.";
    if (msg.includes("unavailable")) return "This video is no longer available.";
    if (msg.includes("removed")) return "This video has been removed.";
    if (msg.includes("age-restricted") || msg.includes("age restricted")) return "This video is age-restricted and cannot be downloaded.";
    if (msg.includes("copyright")) return "This video is protected by copyright.";
    if (msg.includes("geo-restricted") || msg.includes("not available in your country")) return "This video is not available in your region.";
    if (msg.includes("members-only") || msg.includes("members only")) return "This video is only available to channel members.";
    if (msg.includes("timeout") || msg.includes("timed out")) return "Taking too long. Please try a lower quality.";
    if (msg.includes("rate limit") || msg.includes("too many requests") || msg.includes("429")) return "YouTube is busy right now. Please try again in 2 minutes.";
    if (msg.includes("sign in") || msg.includes("confirm")) return "Please try again in a moment.";
    if (msg.includes("instagram") && msg.includes("auth")) return "Instagram is refreshing. Please try again in 30 seconds.";
    if (msg.includes("cloud storage") || msg.includes("upload")) return "Storage is busy. Please try again in 30 seconds.";
    if (msg.includes("no space") || msg.includes("enospc") || msg.includes("disk")) return "Server is busy processing requests. Please try again in 30 seconds.";
    if (msg.includes("network") || msg.includes("econnrefused")) return "Network issue detected. Please try again.";
    if (msg.includes("too large") || msg.includes("file_too_large")) return "Video is too large. Please try 720p quality.";
    if (msg.includes("not supported") || msg.includes("unsupported")) return "This URL is not supported yet.";
    return "Download failed. Please try again in a moment.";
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
        JS_RUNTIME,
        "--extractor-args",
        "youtube:player_client=web,default",
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
