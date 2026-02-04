// const YTDlpWrap = require("yt-dlp-wrap").default;
// const fs = require("fs-extra");
// const path = require("path");
// const crypto = require("crypto");
// const { spawn } = require("child_process");

// const {
//   S3Client,
//   PutObjectCommand,
//   CreateMultipartUploadCommand,
//   UploadPartCommand,
//   CompleteMultipartUploadCommand,
//   AbortMultipartUploadCommand,
//   ListObjectsV2Command,
// } = require("@aws-sdk/client-s3");
// const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
// const { GetObjectCommand } = require("@aws-sdk/client-s3");

// const https = require("https");
// const dns = require("dns");
// const { Resolver } = require("dns").promises;
// const platformDetector = require("./platformDetector");
// const Download = require("../models/Download");

// dns.setServers(["8.8.8.8", "1.1.1.1"]);
// const resolver = new Resolver();
// resolver.setServers(["8.8.8.8", "1.1.1.1"]);

// class VideoDownloaderService {
//   constructor() {
//     this.ytDlp = new YTDlpWrap();

//     // Use /tmp on Railway/production, local paths in development
//     const isProduction =
//       process.env.NODE_ENV === "production" || process.env.RAILWAY_ENVIRONMENT;

//     if (isProduction) {
//       this.downloadDir = "/tmp/downloads";
//       this.tempDir = "/tmp/temp";
//     } else {
//       this.downloadDir = path.join(__dirname, "../../downloads");
//       this.tempDir = path.join(__dirname, "../../temp");
//     }

//     this.activeDownloads = new Map();
//     this.maxConcurrentDownloads = 4;

//     this.ensureDirectories();
//     this.testDNSResolution();
//     this.initializeR2Client();
//     this.startCleanupJob();
//   }

//   async testDNSResolution() {
//     if (!process.env.R2_ACCOUNT_ID) return;
//     const hostname = `${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
//     try {
//       const addresses = await resolver.resolve4(hostname);
//       this.r2IP = addresses[0];
//       console.log(`✓ R2 DNS resolved: ${this.r2IP}`);
//     } catch (error) {
//       this.r2IP = "172.64.66.1";
//     }
//   }

//   async initializeR2Client() {
//     if (!process.env.R2_ACCOUNT_ID || !process.env.R2_ACCESS_KEY_ID) {
//       console.log("⚠ R2 credentials not found - using local storage only");
//       this.r2Client = null;
//       this.r2Working = false;
//       return;
//     }

//     try {
//       const httpsAgent = new https.Agent({
//         keepAlive: true,
//         maxSockets: 50,
//         timeout: 60000,
//         rejectUnauthorized: true,
//       });

//       this.r2Client = new S3Client({
//         region: "auto",
//         endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
//         credentials: {
//           accessKeyId: process.env.R2_ACCESS_KEY_ID,
//           secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
//         },
//         forcePathStyle: true,
//         requestHandler: {
//           httpsAgent: httpsAgent,
//           requestTimeout: 120000,
//           connectionTimeout: 30000,
//         },
//       });

//       this.r2Working = await this.testR2Connection();
//       console.log(
//         this.r2Working ? "✓ R2 connection working" : "✗ R2 connection failed",
//       );
//     } catch (error) {
//       console.error("R2 initialization error:", error.message);
//       this.r2Client = null;
//       this.r2Working = false;
//     }
//   }

//   async testR2Connection() {
//     if (!this.r2Client) return false;
//     try {
//       await this.r2Client.send(
//         new ListObjectsV2Command({
//           Bucket: process.env.R2_BUCKET_NAME,
//           MaxKeys: 1,
//         }),
//       );
//       return true;
//     } catch (error) {
//       return false;
//     }
//   }

//   async ensureDirectories() {
//     try {
//       await fs.ensureDir(this.downloadDir);
//       await fs.ensureDir(this.tempDir);
//       console.log("✓ Download directories ready");
//     } catch (error) {
//       console.error("Error creating directories:", error);
//       throw new Error("Failed to initialize download directories");
//     }
//   }

//   startCleanupJob() {
//     // More aggressive cleanup on Railway (every 2 minutes)
//     const cleanupInterval = process.env.RAILWAY_ENVIRONMENT
//       ? 2 * 60 * 1000
//       : 5 * 60 * 1000;

//     setInterval(async () => {
//       try {
//         const now = Date.now();

//         // Clean both temp and downloads directories
//         for (const dir of [this.tempDir, this.downloadDir]) {
//           try {
//             const files = await fs.readdir(dir);

//             for (const file of files) {
//               const filePath = path.join(dir, file);
//               const stats = await fs.stat(filePath);
//               const age = now - stats.mtimeMs;

//               // Delete files older than 15 minutes on Railway, 30 minutes locally
//               const maxAge = process.env.RAILWAY_ENVIRONMENT
//                 ? 15 * 60 * 1000
//                 : 30 * 60 * 1000;

//               if (age > maxAge) {
//                 await fs.remove(filePath);
//                 console.log(`🗑️ Cleaned up old file: ${file}`);
//               }
//             }
//           } catch (error) {
//             // Directory might not exist yet, ignore
//           }
//         }
//       } catch (error) {
//         console.error("Cleanup job error:", error.message);
//       }
//     }, cleanupInterval);

//     console.log(`✓ Cleanup job started (interval: ${cleanupInterval / 1000}s)`);
//   }

//   async downloadVideo(options = {}) {
//     const {
//       url,
//       quality = "high",
//       format = "mp4",
//       audioOnly = false,
//       userIP = null,
//       userAgent = null,
//       includeThumbnail = false, // 🆕 NEW parameter
//     } = options;

//     if (this.activeDownloads.size >= this.maxConcurrentDownloads) {
//       return {
//         success: false,
//         error: "Server is at capacity. Please try again in a moment.",
//         code: "SERVER_BUSY",
//       };
//     }

//     const downloadId = crypto.randomBytes(8).toString("hex");
//     let downloadRecord = null;
//     const downloadStartTime = Date.now();

//     try {
//       const detection = platformDetector.detectPlatform(url);
//       if (!detection.success) {
//         throw new Error(detection.error);
//       }

//       console.log(
//         `\n📥 [${downloadId}] Starting download from ${detection.platformName}`,
//       );
//       console.log(
//         `⚙️ Quality: ${quality}, Format: ${format}, Thumbnail: ${includeThumbnail ? "YES" : "NO"}`,
//       );

//       this.activeDownloads.set(downloadId, { startTime: Date.now(), url });

//       downloadRecord = await this.createDownloadRecord({
//         url,
//         detection,
//         quality,
//         format,
//         userIP,
//         userAgent,
//       });

//       let metadata;
//       try {
//         console.log("📋 Extracting metadata...");
//         metadata = await Promise.race([
//           this.getVideoMetadata(url, detection.platform),
//           new Promise((_, reject) =>
//             setTimeout(() => reject(new Error("Metadata timeout")), 20000),
//           ),
//         ]);
//         console.log(`✓ Metadata: "${metadata.title}"`);
//       } catch (metaError) {
//         console.log("⚠ Metadata extraction failed, using defaults");
//         metadata = {
//           title: "Video",
//           description: "",
//           thumbnail: null,
//           duration: 0,
//           view_count: 0,
//           upload_date: null,
//           uploader: "Unknown",
//         };
//       }

//       if (downloadRecord && metadata.title !== "Video") {
//         await this.updateDownloadRecord(downloadRecord, {
//           title: metadata.title,
//           thumbnail: metadata.thumbnail,
//           duration: metadata.duration,
//         }).catch(() => {});
//       }

//       const downloadResult = await this.performStreamingDownload({
//         url,
//         quality,
//         format,
//         audioOnly,
//         detection,
//         metadata,
//         downloadId,
//       });

//       const downloadDuration = (
//         (Date.now() - downloadStartTime) /
//         1000
//       ).toFixed(2);
//       console.log(
//         `✓ [${downloadId}] Download completed in ${downloadDuration}s`,
//       );

//       if (downloadRecord) {
//         await this.updateDownloadRecord(downloadRecord, {
//           status: "completed",
//           actualQuality: downloadResult.quality,
//           actualFormat: downloadResult.format,
//           fileSize: downloadResult.fileSize,
//           downloadUrl: downloadResult.downloadUrl,
//           processingEndTime: new Date(),
//         }).catch(() => {});
//       }

//       // 🆕 BUILD RESPONSE BASED ON includeThumbnail
//       const responseData = {
//         id: downloadRecord?._id,
//         title: metadata.title,
//         thumbnail: metadata.thumbnail, // Always include thumbnail URL
//         duration: metadata.duration,
//         platform: detection.platformName,
//         quality: downloadResult.quality,
//         format: downloadResult.format,
//         fileSize: downloadResult.fileSize,
//         downloadUrl: downloadResult.downloadUrl,
//         expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
//       };

//       // 🆕 If user wants thumbnail download link, add proxy URL
//       if (includeThumbnail && metadata.thumbnail) {
//         responseData.thumbnailDownload = {
//           url: `/api/v1/download/thumbnail?url=${encodeURIComponent(metadata.thumbnail)}`,
//           format: "jpg",
//           note: "Right-click and 'Save As' to download thumbnail",
//         };
//         console.log(`✓ [${downloadId}] Thumbnail URL included in response`);
//       }

//       return {
//         success: true,
//         data: responseData,
//         message: includeThumbnail
//           ? "Video ready! Thumbnail URL included."
//           : "Video downloaded successfully!",
//       };
//     } catch (error) {
//       const downloadDuration = (
//         (Date.now() - downloadStartTime) /
//         1000
//       ).toFixed(2);
//       console.error(
//         `✗ [${downloadId}] Failed after ${downloadDuration}s:`,
//         error.message,
//       );

//       let userMessage = this.getUserFriendlyError(error.message);

//       if (downloadRecord) {
//         await this.updateDownloadRecord(downloadRecord, {
//           status: "failed",
//           error: {
//             message: userMessage,
//             code: error.code || "DOWNLOAD_ERROR",
//           },
//           processingEndTime: new Date(),
//         }).catch(() => {});
//       }

//       return {
//         success: false,
//         error: userMessage,
//         code: error.code || "DOWNLOAD_ERROR",
//       };
//     } finally {
//       this.activeDownloads.delete(downloadId);
//     }
//   }

//   async performStreamingDownload(options) {
//     const { url, quality, format, audioOnly, metadata, downloadId } = options;

//     const fileName = `${this.sanitizeFilename(
//       metadata?.title || "video",
//     )}.${format}`;
//     const contentType = this.getContentType(`.${format}`);

//     // For now, use simple upload to R2 (not streaming) for reliability
//     // This is more stable than multipart streaming
//     if (this.r2Client && this.r2Working) {
//       try {
//         console.log(`☁️ [${downloadId}] Downloading and uploading to R2...`);
//         const result = await this.downloadAndUploadToR2({
//           url,
//           quality,
//           format,
//           audioOnly,
//           fileName,
//           contentType,
//           downloadId,
//         });
//         console.log(`✓ [${downloadId}] R2 upload completed`);
//         return result;
//       } catch (r2Error) {
//         console.warn(`⚠ [${downloadId}] R2 upload failed:`, r2Error.message);
//       }
//     }

//     // Fallback: Local download
//     console.log(`[${downloadId}] Using local storage fallback`);
//     return await this.performLocalDownload({
//       url,
//       quality,
//       format,
//       audioOnly,
//       fileName,
//       downloadId,
//     });
//   }

//   async downloadAndUploadToR2(options) {
//     const {
//       url,
//       quality,
//       format,
//       audioOnly,
//       fileName,
//       contentType,
//       downloadId,
//     } = options;

//     // Download to temp first
//     const tempFile = path.join(this.tempDir, `${downloadId}.${format}`);
//     const ytDlpArgs = this.buildDownloadOptions({ quality, format, audioOnly });
//     ytDlpArgs.push("-o", tempFile);

//     console.log(`⬇️ [${downloadId}] Downloading video...`);
//     await this.ytDlp.execPromise([url, ...ytDlpArgs]);

//     const stats = await fs.stat(tempFile);
//     const fileSize = stats.size;
//     console.log(
//       `✓ [${downloadId}] Download complete (${this.formatFileSize(fileSize)})`,
//     );

//     // Upload to R2
//     console.log(`☁️ [${downloadId}] Uploading to R2...`);
//     const fileContent = await fs.readFile(tempFile);
//     const key = `downloads/${Date.now()}_${crypto
//       .randomBytes(8)
//       .toString("hex")}_${fileName}`;

//     await this.r2Client.send(
//       new PutObjectCommand({
//         Bucket: process.env.R2_BUCKET_NAME,
//         Key: key,
//         Body: fileContent,
//         ContentType: contentType,
//         ContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(
//           fileName,
//         )}`,
//         CacheControl: "public, max-age=31536000",
//       }),
//     );

//     // Generate presigned URL
//     const downloadUrl = await getSignedUrl(
//       this.r2Client,
//       new GetObjectCommand({
//         Bucket: process.env.R2_BUCKET_NAME,
//         Key: key,
//       }),
//       { expiresIn: 86400 },
//     );

//     // Clean up temp file
//     await fs.remove(tempFile).catch(() => {});

//     return {
//       success: true,
//       downloadUrl,
//       fileSize,
//       quality,
//       format,
//     };
//   }

//   async performLocalDownload(options) {
//     const { url, quality, format, audioOnly, fileName, downloadId } = options;

//     const tempFile = path.join(this.tempDir, `${downloadId}.${format}`);
//     const ytDlpArgs = this.buildDownloadOptions({ quality, format, audioOnly });
//     ytDlpArgs.push("-o", tempFile);

//     console.log(`⬇️ [${downloadId}] Downloading to temp file...`);
//     await this.ytDlp.execPromise([url, ...ytDlpArgs]);

//     const stats = await fs.stat(tempFile);
//     const fileSize = stats.size;

//     const finalFileName = `${Date.now()}_${fileName}`;
//     const finalPath = path.join(this.downloadDir, finalFileName);

//     await fs.move(tempFile, finalPath);

//     return {
//       success: true,
//       downloadUrl: `/api/v1/download/file/${encodeURIComponent(finalFileName)}`,
//       fileSize,
//       quality,
//       format,
//     };
//   }

//   buildDownloadOptions({ quality, format, audioOnly }) {
//     const options = [];

//     if (audioOnly || format === "mp3") {
//       options.push("-f", "bestaudio/best");
//       if (format === "mp3") {
//         options.push(
//           "--extract-audio",
//           "--audio-format",
//           "mp3",
//           "--audio-quality",
//           "0",
//         );
//       }
//     } else {
//       const heightMap = {
//         highest: "2160",
//         high: "1080",
//         medium: "720",
//         low: "480",
//       };
//       const maxHeight = heightMap[quality] || "1080";

//       // Robust format selection with fallbacks
//       options.push(
//         "-f",
//         `bestvideo[height<=${maxHeight}]+bestaudio/best[height<=${maxHeight}]/best`,
//       );

//       if (format === "mp4") {
//         options.push("--merge-output-format", "mp4");
//         options.push(
//           "--postprocessor-args",
//           "ffmpeg:-c:v copy -c:a aac -b:a 192k",
//         );
//       }
//     }

//     options.push(
//       "--no-playlist",
//       "--no-warnings",
//       "--user-agent",
//       "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
//       "--socket-timeout",
//       "30",
//       "--retries",
//       "10",
//       "--fragment-retries",
//       "10",
//       "--hls-prefer-native",
//     );
//     return options;
//   }

//   getUserFriendlyError(errorMessage) {
//     const errorMap = {
//       private: "This video is private and cannot be downloaded.",
//       unavailable: "This video is no longer available.",
//       removed: "This video has been removed.",
//       "age-restricted":
//         "This video is age-restricted and cannot be downloaded.",
//       copyright: "This video is protected by copyright.",
//       "geo-restricted": "This video is not available in your region.",
//       timeout: "Download timed out. Please try a lower quality.",
//       "members-only": "This video is only available to channel members.",
//     };

//     const lowerError = errorMessage.toLowerCase();
//     for (const [key, message] of Object.entries(errorMap)) {
//       if (lowerError.includes(key.toLowerCase())) {
//         return message;
//       }
//     }

//     return "Download failed. The video may be restricted or unavailable.";
//   }

//   async createDownloadRecord(options) {
//     try {
//       const { url, detection, quality, format, userIP, userAgent } = options;
//       const downloadRecord = new Download({
//         originalUrl: url,
//         platform: detection.platform,
//         videoId: detection.videoId,
//         requestedQuality: quality,
//         requestedFormat: format,
//         status: "processing",
//         processingStartTime: new Date(),
//         ipAddress: userIP
//           ? crypto.createHash("sha256").update(userIP).digest("hex")
//           : null,
//         userAgent: userAgent,
//       });
//       await downloadRecord.save();
//       return downloadRecord;
//     } catch (error) {
//       console.error("Error creating download record:", error);
//       return null;
//     }
//   }

//   async updateDownloadRecord(record, updates) {
//     try {
//       if (!record) return;
//       Object.assign(record, updates);
//       await record.save();
//     } catch (error) {
//       console.error("Error updating download record:", error.message);
//     }
//   }

//   async getVideoMetadata(url, platform) {
//     try {
//       const options = [
//         "--dump-json",
//         "--no-playlist",
//         "--skip-download",
//         "--socket-timeout",
//         "20",
//         "--no-warnings",
//         "--user-agent",
//         "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
//       ];

//       // Add platform-specific options

//       const result = await this.ytDlp.execPromise([url, ...options]);
//       const metadata = JSON.parse(result);

//       let uploadDate = null;
//       if (metadata.upload_date) {
//         try {
//           const dateStr = metadata.upload_date.toString();
//           if (dateStr.length === 8) {
//             const year = parseInt(dateStr.substring(0, 4));
//             const month = parseInt(dateStr.substring(4, 6)) - 1;
//             const day = parseInt(dateStr.substring(6, 8));
//             uploadDate = new Date(year, month, day);
//           }
//         } catch (e) {}
//       }

//       // Get best thumbnail
//       let thumbnail = null;
//       if (metadata.thumbnails && metadata.thumbnails.length > 0) {
//         // Get highest quality thumbnail
//         const thumbnails = metadata.thumbnails.sort(
//           (a, b) => (b.width || 0) - (a.width || 0),
//         );
//         thumbnail = thumbnails[0].url;
//       } else if (metadata.thumbnail) {
//         thumbnail = metadata.thumbnail;
//       }

//       return {
//         title: metadata.title || "Unknown Title",
//         description: (metadata.description || "").substring(0, 2000),
//         thumbnail: thumbnail,
//         duration: metadata.duration || 0,
//         view_count: metadata.view_count || 0,
//         upload_date: uploadDate,
//         uploader: metadata.uploader || "Unknown",
//         uploader_id: metadata.uploader_id || "",
//         uploader_verified: metadata.uploader_verified || false,
//         webpage_url: metadata.webpage_url || url,
//       };
//     } catch (error) {
//       console.error("Metadata extraction error:", error.message);
//       throw error;
//     }
//   }

//   validateDownloadRequest(options) {
//     const { url, quality, format } = options;
//     if (!url) return { valid: false, error: "URL is required" };

//     const detection = platformDetector.detectPlatform(url);
//     if (!detection.success) return { valid: false, error: detection.error };

//     const validQualities = ["highest", "high", "medium", "low"];
//     if (quality && !validQualities.includes(quality)) {
//       return {
//         valid: false,
//         error: `Invalid quality. Must be one of: ${validQualities.join(", ")}`,
//       };
//     }

//     const validFormats = ["mp4", "mp3", "webm"];
//     if (format && !validFormats.includes(format)) {
//       return {
//         valid: false,
//         error: `Invalid format. Must be one of: ${validFormats.join(", ")}`,
//       };
//     }

//     return { valid: true, detection };
//   }

//   getContentType(ext) {
//     const types = {
//       ".mp4": "video/mp4",
//       ".mp3": "audio/mpeg",
//       ".webm": "video/webm",
//       ".m4a": "audio/mp4",
//       ".mkv": "video/x-matroska",
//     };
//     return types[ext.toLowerCase()] || "application/octet-stream";
//   }

//   sanitizeFilename(filename) {
//     if (!filename) return "video";
//     return filename
//       .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
//       .replace(/\s+/g, "_")
//       .replace(/_+/g, "_")
//       .replace(/^_|_$/g, "")
//       .substring(0, 150)
//       .toLowerCase();
//   }

//   formatFileSize(bytes) {
//     const units = ["B", "KB", "MB", "GB"];
//     let size = bytes;
//     let unitIndex = 0;
//     while (size >= 1024 && unitIndex < units.length - 1) {
//       size /= 1024;
//       unitIndex++;
//     }
//     return `${size.toFixed(2)} ${units[unitIndex]}`;
//   }

//   getSupportedPlatforms() {
//     return platformDetector.getSupportedPlatforms();
//   }

//   getServerStats() {
//     return {
//       activeDownloads: this.activeDownloads.size,
//       maxConcurrent: this.maxConcurrentDownloads,
//       r2Status: this.r2Working ? "operational" : "degraded",
//       uptime: process.uptime(),
//     };
//   }
// }

// module.exports = new VideoDownloaderService();
const YTDlpWrap = require("yt-dlp-wrap").default;
const fs = require("fs-extra");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");

const {
  S3Client,
  PutObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  ListObjectsV2Command,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { GetObjectCommand } = require("@aws-sdk/client-s3");

const https = require("https");
const dns = require("dns");
const { Resolver } = require("dns").promises;
const platformDetector = require("./platformDetector");
const Download = require("../models/Download");
const cookieManager = require("./cookieManager"); // 🔥 ADD THIS LINE

dns.setServers(["8.8.8.8", "1.1.1.1"]);
const resolver = new Resolver();
resolver.setServers(["8.8.8.8", "1.1.1.1"]);

class VideoDownloaderService {
  constructor() {
    this.ytDlp = new YTDlpWrap();

    // Use /tmp on Railway/production, local paths in development
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

    // 🔥 ADD THIS: Print cookie status on startup
    console.log("\n🍪 Checking YouTube Cookie Status...");
    cookieManager.printStatus();
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
    // More aggressive cleanup on Railway (every 2 minutes)
    const cleanupInterval = process.env.RAILWAY_ENVIRONMENT
      ? 2 * 60 * 1000
      : 5 * 60 * 1000;

    setInterval(async () => {
      try {
        const now = Date.now();

        // Clean both temp and downloads directories
        for (const dir of [this.tempDir, this.downloadDir]) {
          try {
            const files = await fs.readdir(dir);

            for (const file of files) {
              const filePath = path.join(dir, file);
              const stats = await fs.stat(filePath);
              const age = now - stats.mtimeMs;

              // Delete files older than 15 minutes on Railway, 30 minutes locally
              const maxAge = process.env.RAILWAY_ENVIRONMENT
                ? 15 * 60 * 1000
                : 30 * 60 * 1000;

              if (age > maxAge) {
                await fs.remove(filePath);
                console.log(`🗑️ Cleaned up old file: ${file}`);
              }
            }
          } catch (error) {
            // Directory might not exist yet, ignore
          }
        }
      } catch (error) {
        console.error("Cleanup job error:", error.message);
      }
    }, cleanupInterval);

    console.log(`✓ Cleanup job started (interval: ${cleanupInterval / 1000}s)`);
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
          this.getVideoMetadata(url, detection.platform), // 🔥 Now passes platform
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
    const { url, quality, format, audioOnly, metadata, downloadId, detection } =
      options; // 🔥 Added detection

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
          platform: detection.platform, // 🔥 Pass platform
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
      platform: detection.platform, // 🔥 Pass platform
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
      platform, // 🔥 NEW
    } = options;

    const tempFile = path.join(this.tempDir, `${downloadId}.${format}`);
    const ytDlpArgs = this.buildDownloadOptions({
      quality,
      format,
      audioOnly,
      platform,
    }); // 🔥 Pass platform
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
    const { url, quality, format, audioOnly, fileName, downloadId, platform } =
      options; // 🔥 NEW

    const tempFile = path.join(this.tempDir, `${downloadId}.${format}`);
    const ytDlpArgs = this.buildDownloadOptions({
      quality,
      format,
      audioOnly,
      platform,
    }); // 🔥 Pass platform
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

  // 🔥🔥🔥 THIS IS THE KEY CHANGE - buildDownloadOptions now accepts platform
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
    } else {
      const heightMap = {
        highest: "2160",
        high: "1080",
        medium: "720",
        low: "480",
      };
      const maxHeight = heightMap[quality] || "1080";

      // 🔥 IMPROVED: Better fallback chain for compatibility with Shorts, live streams, etc.
      options.push(
        "-f",
        `bestvideo[height<=${maxHeight}]+bestaudio/best[height<=${maxHeight}]/bestvideo+bestaudio/best`,
      );

      if (format === "mp4") {
        options.push("--merge-output-format", "mp4");
        // 🔥 Removed "-c:v copy" to let ffmpeg auto-decide (more compatible)
        options.push("--postprocessor-args", "ffmpeg:-c:a aac -b:a 192k");
      }
    }

    options.push(
      "--no-playlist",
      "--no-warnings",
      "--user-agent",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "--socket-timeout",
      "30",
      "--retries",
      "10",
      "--fragment-retries",
      "10",
      "--hls-prefer-native",
    );

    // 🔥🔥🔥 ADD COOKIES FOR YOUTUBE ONLY
    if (platform === "youtube") {
      cookieManager.addCookieOptions(options);
    }

    return options;
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
      "sign in to confirm":
        "YouTube bot detection triggered. Please contact support.", // 🔥 Better error message
      bot: "YouTube bot detection triggered. Please contact support.",
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

  // 🔥 UPDATED: getVideoMetadata - DON'T use cookies (causes format bug with --dump-json)
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
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      ];

      // 🔥 DON'T ADD COOKIES FOR METADATA EXTRACTION
      // Metadata works fine without auth, and cookies cause format selection bugs
      // Cookies are ONLY used for actual video downloads (in buildDownloadOptions)

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
      cookieStatus: cookieManager.getStatus(), // 🔥 ADD COOKIE STATUS
    };
  }
}

module.exports = new VideoDownloaderService();
