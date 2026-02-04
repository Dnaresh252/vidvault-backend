// const fs = require("fs-extra");
// const path = require("path");

// class CookieManager {
//   constructor() {
//     const isProduction =
//       process.env.NODE_ENV === "production" || process.env.RAILWAY_ENVIRONMENT;

//     if (
//       process.env.RAILWAY_ENVIRONMENT &&
//       process.env.RAILWAY_VOLUME_MOUNT_PATH
//     ) {
//       this.cookieDir = process.env.RAILWAY_VOLUME_MOUNT_PATH;
//       console.log(`📦 Using Railway volume: ${this.cookieDir}`);
//     } else if (isProduction) {
//       this.cookieDir = "/tmp/cookies";
//     } else {
//       this.cookieDir = path.join(__dirname, "../../cookies");
//     }

//     this.cookieFile = path.join(this.cookieDir, "youtube_cookies.txt");
//     this.browserCookieFile = path.join(this.cookieDir, "browser_cookies.txt");

//     this.lastRefresh = null;
//     this.refreshInterval = 6 * 60 * 60 * 1000; // 6 hours
//     this.cookieValid = false;
//     // ── track whether a LIVE test has ever passed ──
//     this.liveValidated = false;

//     this.initialize();
//   }

//   async initialize() {
//     try {
//       await fs.ensureDir(this.cookieDir);

//       // Priority 1 – env var
//       if (process.env.YOUTUBE_COOKIES) {
//         console.log("📦 Found cookies in environment variable");
//         try {
//           await fs.writeFile(
//             this.cookieFile,
//             process.env.YOUTUBE_COOKIES,
//             "utf-8",
//           );
//           console.log("✓ YouTube cookies loaded from environment variable");

//           const formatOk = await this.validateCookieFormat();
//           if (formatOk) {
//             console.log("✓ Environment cookies validated successfully");
//             this.cookieValid = true;
//             this.lastRefresh = Date.now();
//           } else {
//             console.log("⚠️  Environment cookies failed format validation");
//             this.cookieValid = false;
//           }

//           this.startCookieValidation();
//           return;
//         } catch (error) {
//           console.error(
//             "❌ Failed to write environment cookies:",
//             error.message,
//           );
//         }
//       }

//       // Priority 2 – file system
//       const hasManual = await fs.pathExists(this.cookieFile);
//       const hasBrowser = await fs.pathExists(this.browserCookieFile);

//       if (hasManual) {
//         console.log("✓ YouTube cookies found (file)");
//         this.cookieValid = true;
//         this.lastRefresh = Date.now();
//       } else if (hasBrowser) {
//         console.log("✓ YouTube cookies found (browser export)");
//         this.cookieValid = true;
//         this.lastRefresh = Date.now();
//       } else {
//         console.log("⚠️  No YouTube cookies found - bot detection may occur");
//         console.log("💡 Solutions:");
//         console.log(
//           "   1. Add YOUTUBE_COOKIES environment variable in Railway",
//         );
//         console.log("   2. Upload youtube_cookies.txt to:", this.cookieDir);
//         this.cookieValid = false;
//       }

//       this.startCookieValidation();
//     } catch (error) {
//       console.error("❌ Cookie initialization error:", error.message);
//       this.cookieValid = false;
//     }
//   }

//   // ─── FORMAT-ONLY CHECK (fast, offline) ────────────────────────────
//   // Previously called validateCookies — renamed so callers are explicit.
//   async validateCookieFormat() {
//     const cookieFile = this.getCookieFile();
//     if (!cookieFile) {
//       this.cookieValid = false;
//       return false;
//     }

//     try {
//       const content = await fs.readFile(cookieFile, "utf-8");
//       if (!content || content.trim().length < 50) {
//         console.log("⚠️  Cookie file exists but appears empty");
//         this.cookieValid = false;
//         return false;
//       }

//       // Must mention youtube.com at all
//       if (!content.includes("youtube.com")) {
//         console.log("⚠️  Cookie file missing youtube.com domain");
//         this.cookieValid = false;
//         return false;
//       }

//       // Must have at least one of the auth-level cookies that prove a logged-in session
//       const hasAuth =
//         content.includes("__Secure-1PSID") ||
//         content.includes("__Secure-3PSID") ||
//         content.includes("SID");

//       if (!hasAuth) {
//         console.log(
//           "⚠️  Cookie file missing auth cookies (__Secure-1PSID / __Secure-3PSID / SID)",
//         );
//         console.log(
//           "💡 These cookies only exist when you are LOGGED IN to YouTube",
//         );
//         console.log(
//           "   → Export cookies WHILE logged in, then update YOUTUBE_COOKIES in Railway",
//         );
//         this.cookieValid = false;
//         return false;
//       }

//       this.cookieValid = true;
//       this.lastRefresh = Date.now();
//       return true;
//     } catch (error) {
//       console.error("Cookie format validation error:", error.message);
//       this.cookieValid = false;
//       return false;
//     }
//   }

//   // ─── BACKWARD COMPAT alias ───────────────────────────────────────
//   async validateCookies() {
//     return this.validateCookieFormat();
//   }

//   // ─── FILE PATH HELPERS ────────────────────────────────────────────
//   getCookieFile() {
//     if (fs.existsSync(this.cookieFile)) return this.cookieFile;
//     if (fs.existsSync(this.browserCookieFile)) return this.browserCookieFile;
//     return null;
//   }

//   addCookieOptions(optionsArray) {
//     const cookieFile = this.getCookieFile();
//     if (cookieFile) {
//       optionsArray.push("--cookies", cookieFile);
//       console.log(`🍪 Using cookies: ${path.basename(cookieFile)}`);
//       return true;
//     }
//     console.log("⚠️  No cookies available - proceeding without authentication");
//     return false;
//   }

//   // ─── PERIODIC VALIDATION ──────────────────────────────────────────
//   startCookieValidation() {
//     this.validateCookieFormat();

//     setInterval(
//       async () => {
//         const isValid = await this.validateCookieFormat();
//         if (!isValid && this.getCookieFile()) {
//           console.log(
//             "⚠️  Cookie validation failed - cookies may need refresh",
//           );
//           console.log(
//             "💡 Update YOUTUBE_COOKIES environment variable in Railway",
//           );
//         }
//         if (
//           this.lastRefresh &&
//           Date.now() - this.lastRefresh > this.refreshInterval
//         ) {
//           console.log(
//             "⚠️  Cookies are older than 6 hours - consider refreshing",
//           );
//           console.log(
//             `📅 Last refresh: ${new Date(this.lastRefresh).toISOString()}`,
//           );
//         }
//       },
//       60 * 60 * 1000,
//     );
//   }

//   // ─── MANUAL UPDATE ────────────────────────────────────────────────
//   async updateCookiesFromString(cookieContent, format = "netscape") {
//     try {
//       const targetFile =
//         format === "netscape" ? this.cookieFile : this.browserCookieFile;
//       if (
//         format === "netscape" &&
//         !cookieContent.includes("# Netscape HTTP Cookie File")
//       ) {
//         cookieContent = "# Netscape HTTP Cookie File\n" + cookieContent;
//       }
//       await fs.writeFile(targetFile, cookieContent, "utf-8");
//       console.log(`✓ Cookies updated successfully (${format})`);
//       const isValid = await this.validateCookieFormat();
//       return {
//         success: true,
//         valid: isValid,
//         message: isValid
//           ? "Cookies updated and validated"
//           : "Cookies updated but validation failed",
//       };
//     } catch (error) {
//       console.error("Cookie update error:", error.message);
//       return { success: false, error: error.message };
//     }
//   }

//   // ─── STATUS ───────────────────────────────────────────────────────
//   getStatus() {
//     const cookieFile = this.getCookieFile();
//     const ageHours = this.lastRefresh
//       ? ((Date.now() - this.lastRefresh) / (1000 * 60 * 60)).toFixed(1)
//       : null;
//     return {
//       hasCookies: cookieFile !== null,
//       cookieFile: cookieFile ? path.basename(cookieFile) : null,
//       cookieSource: process.env.YOUTUBE_COOKIES ? "environment" : "file",
//       valid: this.cookieValid,
//       liveValidated: this.liveValidated,
//       lastRefresh: this.lastRefresh
//         ? new Date(this.lastRefresh).toISOString()
//         : null,
//       ageHours,
//       needsRefresh: this.lastRefresh
//         ? Date.now() - this.lastRefresh > this.refreshInterval
//         : true,
//       cookieDir: this.cookieDir,
//     };
//   }

//   static getInstructions() {
//     return {
//       railway: {
//         title: "Railway Deployment (Recommended)",
//         steps: [
//           "1. Install browser extension: https://chrome.google.com/webstore/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc",
//           "2. Login to YouTube in your browser",
//           "3. Click extension icon → Export cookies",
//           "4. Open the downloaded youtube_cookies.txt file",
//           "5. Copy ALL content (Ctrl+A, Ctrl+C)",
//           "6. Go to Railway Dashboard → Your Service → Variables",
//           "7. Add new variable: YOUTUBE_COOKIES",
//           "8. Paste cookie content as the value",
//           "9. Railway will auto-redeploy with cookies ✅",
//         ],
//       },
//       local: {
//         title: "Local Development",
//         steps: [
//           "1. Get cookies using browser extension (see Railway method)",
//           "2. Create folder: cookies/ in your project root",
//           "3. Save as: cookies/youtube_cookies.txt",
//           "4. Restart your server",
//           "5. Check logs for: ✓ YouTube cookies found",
//         ],
//       },
//       method2: {
//         title:
//           "Using yt-dlp Command (Advanced) — RUN ON YOUR OWN MACHINE, NOT RAILWAY",
//         steps: [
//           "1. Install yt-dlp on YOUR laptop/desktop: https://github.com/yt-dlp/yt-dlp/releases",
//           "2. Login to YouTube in Chrome/Firefox on that same machine",
//           "3. Open terminal ON THAT MACHINE and run:",
//           "   yt-dlp --cookies-from-browser chrome --cookies youtube_cookies.txt https://youtube.com",
//           "4. This creates youtube_cookies.txt in your current folder",
//           "5. Open that file, copy ALL content",
//           "6. Go to Railway → Variables → Update YOUTUBE_COOKIES",
//         ],
//       },
//     };
//   }

//   async refreshFromEnvironment() {
//     if (!process.env.YOUTUBE_COOKIES)
//       return {
//         success: false,
//         message: "No YOUTUBE_COOKIES environment variable found",
//       };
//     try {
//       await fs.writeFile(this.cookieFile, process.env.YOUTUBE_COOKIES, "utf-8");
//       const isValid = await this.validateCookieFormat();
//       if (isValid) {
//         console.log("✓ Cookies refreshed from environment variable");
//         this.lastRefresh = Date.now();
//         return { success: true, message: "Cookies refreshed and validated" };
//       }
//       return {
//         success: false,
//         message: "Cookies refreshed but validation failed",
//       };
//     } catch (error) {
//       return { success: false, message: error.message };
//     }
//   }
// }

// module.exports = new CookieManager();
const YTDlpWrap = require("yt-dlp-wrap").default;
const fs = require("fs-extra");
const path = require("path");
const crypto = require("crypto");
const cookieManager = require("./cookieManager"); // 🔥 CRITICAL: Import cookie manager

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

    this.ensureDirectories();
    this.testDNSResolution();
    this.initializeR2Client();
    this.startCleanupJob();
    this.logCookieStatus(); // 🔥 Log cookie status on startup
  }

  // 🔥 NEW: Log cookie status
  logCookieStatus() {
    const status = cookieManager.getStatus();
    console.log("\n🍪 Cookie Manager Status:");
    console.log(`   Has Cookies: ${status.hasCookies ? "✅" : "❌"}`);
    console.log(`   Source: ${status.cookieSource}`);
    console.log(`   Valid: ${status.valid ? "✅" : "❌"}`);
    if (!status.hasCookies || !status.valid) {
      console.log("⚠️  WARNING: No YouTube cookies - bot detection may occur");
      console.log("💡 Add YOUTUBE_COOKIES environment variable in Railway");
    }
    console.log("");
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
          httpsAgent: httpsAgent,
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
              const age = now - stats.mtimeMs;
              const maxAge = process.env.RAILWAY_ENVIRONMENT
                ? 15 * 60 * 1000
                : 30 * 60 * 1000;

              if (age > maxAge) {
                await fs.remove(filePath);
              }
            }
          } catch (error) {}
        }
      } catch (error) {
        console.error("Cleanup job error:", error.message);
      }
    }, cleanupInterval);

    console.log(`✓ Cleanup job started (interval: ${cleanupInterval / 1000}s)`);
  }

  // 🔥 NEW: Detect if URL is YouTube
  isYouTubeUrl(url) {
    if (!url) return false;
    const lower = url.toLowerCase();
    return lower.includes("youtube.com") || lower.includes("youtu.be");
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

      const downloadResult = await this.performStreamingDownload({
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
          note: "Right-click and 'Save As' to download thumbnail",
        };
        console.log(`✓ [${downloadId}] Thumbnail URL included in response`);
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

      let userMessage = this.getUserFriendlyError(error.message);

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
      };
    } finally {
      this.activeDownloads.delete(downloadId);
    }
  }

  async performStreamingDownload(options) {
    const { url, quality, format, audioOnly, metadata, downloadId } = options;

    const fileName = `${this.sanitizeFilename(
      metadata?.title || "video",
    )}.${format}`;
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
    }); // 🔥 Pass URL
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
    const key = `downloads/${Date.now()}_${crypto
      .randomBytes(8)
      .toString("hex")}_${fileName}`;

    await this.r2Client.send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: key,
        Body: fileContent,
        ContentType: contentType,
        ContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(
          fileName,
        )}`,
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

    return {
      success: true,
      downloadUrl,
      fileSize,
      quality,
      format,
    };
  }

  async performLocalDownload(options) {
    const { url, quality, format, audioOnly, fileName, downloadId } = options;

    const tempFile = path.join(this.tempDir, `${downloadId}.${format}`);
    const ytDlpArgs = this.buildDownloadOptions({
      url,
      quality,
      format,
      audioOnly,
    }); // 🔥 Pass URL
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

  // 🔥 CRITICAL FIX: Add cookies ONLY for YouTube
  buildDownloadOptions({ url, quality, format, audioOnly }) {
    const options = [];

    // 🔥 ADD COOKIES FOR YOUTUBE ONLY
    if (this.isYouTubeUrl(url)) {
      cookieManager.addCookieOptions(options);
    }

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
    } else {
      const heightMap = {
        highest: "2160",
        high: "1080",
        medium: "720",
        low: "480",
      };
      const maxHeight = heightMap[quality] || "1080";

      options.push(
        "-f",
        `bestvideo[height<=${maxHeight}]+bestaudio/best[height<=${maxHeight}]/best`,
      );

      if (format === "mp4") {
        options.push("--merge-output-format", "mp4");
        options.push(
          "--postprocessor-args",
          "ffmpeg:-c:v copy -c:a aac -b:a 192k",
        );
      }
    }

    options.push(
      "--no-playlist",
      "--no-warnings",
      "--user-agent",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36", // 🔥 Updated UA
      "--socket-timeout",
      "30",
      "--retries",
      "10",
      "--fragment-retries",
      "10",
      "--hls-prefer-native",
    );
    return options;
  }

  getUserFriendlyError(errorMessage) {
    const errorMap = {
      "sign in":
        "YouTube bot detection. Cookies may be expired. Please contact support.",
      "not a bot":
        "YouTube bot detection. Cookies may be expired. Please contact support.",
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

  // 🔥 CRITICAL FIX: Add cookies for YouTube metadata
  async getVideoMetadata(url, platform) {
    try {
      const options = [
        "--dump-json",
        "--no-playlist",
        "--skip-download",
        "--socket-timeout",
        "20",
        "--no-warnings",
        "--user-agent",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36", // 🔥 Updated UA
      ];

      // 🔥 ADD COOKIES FOR YOUTUBE
      if (this.isYouTubeUrl(url)) {
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