const YTDlpWrap = require("yt-dlp-wrap").default;
const fs = require("fs-extra");
const path = require("path");
const crypto = require("crypto");
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
    this.downloadDir = path.join(__dirname, "../../downloads");
    this.tempDir = path.join(__dirname, "../../temp");

    this.ensureDirectories();
    this.testDNSResolution();
    this.initializeR2Client();

    // Enhanced quality mappings for true HD quality
    this.qualityMap = {
      youtube: {
        highest:
          "bestvideo[height<=2160][vcodec^=vp9]+bestaudio[acodec=opus]/bestvideo[height<=2160][vcodec^=avc1]+bestaudio/bestvideo[height<=2160]+bestaudio/best",
        high: "bestvideo[height<=1080][vcodec^=vp9]+bestaudio[acodec=opus]/bestvideo[height<=1080][vcodec^=avc1]+bestaudio/bestvideo[height<=1080]+bestaudio/best[height<=1080]",
        medium:
          "bestvideo[height<=720][vcodec^=vp9]+bestaudio[acodec=opus]/bestvideo[height<=720][vcodec^=avc1]+bestaudio/bestvideo[height<=720]+bestaudio/best[height<=720]",
        low: "bestvideo[height<=480]+bestaudio/best[height<=480]",
      },
      instagram: {
        highest: "best",
        high: "best",
        medium: "best",
        low: "worst",
      },
      tiktok: {
        highest: "best",
        high: "best",
        medium: "best",
        low: "worst",
      },
      twitter: {
        highest: "best",
        high: "best",
        medium: "best",
        low: "worst",
      },
      facebook: {
        highest: "best",
        high: "best",
        medium: "best",
        low: "worst",
      },
      default: {
        highest: "best",
        high: "best",
        medium: "best",
        low: "worst",
      },
    };

    // Download timeout configuration
    this.DOWNLOAD_TIMEOUT = 15 * 60 * 1000; // 15 minutes max
    this.FILE_SEARCH_TIMEOUT = 30000; // 30 seconds
    this.FILE_SEARCH_INTERVAL = 2000; // Check every 2 seconds
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
      console.log(`✗ R2 DNS fallback: ${this.r2IP}`);
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
        this.r2Working ? "✓ R2 connection working" : "✗ R2 connection failed"
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
        })
      );
      return true;
    } catch (error) {
      console.error("R2 connection test failed:", error.message);
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

  async downloadVideo(options = {}) {
    const {
      url,
      quality = "high",
      format = "mp4",
      audioOnly = false,
      customFilename = null,
      userIP = null,
      userAgent = null,
    } = options;

    let downloadRecord = null;
    const downloadStartTime = Date.now();

    try {
      // Validate URL and detect platform
      const detection = platformDetector.detectPlatform(url);
      if (!detection.success) {
        throw new Error(detection.error);
      }

      console.log(`\n📥 Starting download from ${detection.platformName}`);
      console.log(`⚙️ Quality: ${quality}, Format: ${format}`);

      // Create download record for tracking
      downloadRecord = await this.createDownloadRecord({
        url,
        detection,
        quality,
        format,
        userIP,
        userAgent,
      });

      // Extract video metadata
      let metadata;
      try {
        console.log("📋 Extracting metadata...");
        metadata = await this.getVideoMetadata(url, detection.platform);
        console.log(`✓ Metadata: "${metadata.title}" (${metadata.duration}s)`);
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
          uploader_id: "",
          uploader_verified: false,
        };
      }

      // Update record with metadata
      if (downloadRecord && metadata.title !== "Video") {
        try {
          await this.updateDownloadRecord(downloadRecord, {
            title: metadata.title,
            description: metadata.description,
            thumbnail: metadata.thumbnail,
            duration: metadata.duration,
            viewCount: metadata.view_count,
            uploadDate: metadata.upload_date,
            creator: {
              name: metadata.uploader,
              username: metadata.uploader_id,
              verified: metadata.uploader_verified,
            },
          });
        } catch (updateError) {
          console.error("Failed to update metadata:", updateError.message);
        }
      }

      // Perform the actual download
      console.log("⬇️ Downloading video...");
      const downloadResult = await this.performDownload({
        url,
        quality,
        format,
        audioOnly,
        customFilename,
        detection,
        metadata,
      });

      const downloadDuration = (
        (Date.now() - downloadStartTime) /
        1000
      ).toFixed(2);
      console.log(`✓ Download completed in ${downloadDuration}s`);
      console.log(
        `📦 File size: ${this.formatFileSize(downloadResult.fileSize)}`
      );

      // Update final record status
      if (downloadRecord) {
        await this.updateDownloadRecord(downloadRecord, {
          status: "completed",
          actualQuality: downloadResult.quality,
          actualFormat: downloadResult.format,
          fileSize: downloadResult.fileSize,
          downloadUrl: downloadResult.downloadUrl,
          processingEndTime: new Date(),
        });
      }

      return {
        success: true,
        data: {
          id: downloadRecord?._id,
          title: metadata.title,
          thumbnail: metadata.thumbnail,
          duration: metadata.duration,
          platform: detection.platformName,
          quality: downloadResult.quality,
          format: downloadResult.format,
          fileSize: downloadResult.fileSize,
          downloadUrl: downloadResult.downloadUrl,
          expiresAt:
            downloadRecord?.downloadExpires?.toISOString() ||
            new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        },
        message: "Video downloaded successfully!",
      };
    } catch (error) {
      const downloadDuration = (
        (Date.now() - downloadStartTime) /
        1000
      ).toFixed(2);
      console.error(
        `✗ Download failed after ${downloadDuration}s:`,
        error.message
      );

      let userMessage = this.getUserFriendlyError(error.message);

      if (downloadRecord) {
        await this.updateDownloadRecord(downloadRecord, {
          status: "failed",
          error: {
            message: userMessage,
            code: error.code || "DOWNLOAD_ERROR",
            technicalDetails: error.message,
          },
          processingEndTime: new Date(),
        });
      }

      return {
        success: false,
        error: userMessage,
        code: error.code || "DOWNLOAD_ERROR",
      };
    }
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
      "Video unavailable": "This video is unavailable or has been removed.",
      "Private video": "This video is private.",
      timeout:
        "Download timed out. The video may be too large or the connection is slow.",
      "ERROR: Unable to download":
        "Unable to download this video. It may be restricted or unavailable.",
    };

    for (const [key, message] of Object.entries(errorMap)) {
      if (errorMessage.toLowerCase().includes(key.toLowerCase())) {
        return message;
      }
    }

    return "Download failed. The video may be restricted or unavailable. Please try a different video.";
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
        "30",
      ];

      if (platform === "youtube") {
        options.push("--extractor-args", "youtube:player_client=android");
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
        } catch (e) {
          console.error("Date parsing error:", e.message);
        }
      }

      let description = metadata.description || "";
      if (description.length > 2000) {
        description = description.substring(0, 1997) + "...";
      }

      return {
        title: metadata.title || "Unknown Title",
        description: description,
        thumbnail: metadata.thumbnail || null,
        duration: metadata.duration || 0,
        view_count: metadata.view_count || 0,
        upload_date: uploadDate,
        uploader: metadata.uploader || "Unknown",
        uploader_id: metadata.uploader_id || "",
        uploader_verified: metadata.uploader_verified || false,
        webpage_url: metadata.webpage_url,
      };
    } catch (error) {
      console.error("Metadata extraction error:", error.message);
      throw error;
    }
  }

  async performDownload(options) {
    const { url, quality, format, audioOnly, detection, metadata } = options;

    try {
      const tempDirAbs = path.resolve(this.tempDir);
      const downloadStartTime = Date.now();
      const uniqueId = crypto.randomBytes(8).toString("hex");

      // Build download options with proper quality selection
      const ytDlpOptions = this.buildDownloadOptions({
        platform: detection.platform,
        quality,
        format,
        audioOnly,
        uniqueId,
        tempDirAbs,
      });

      console.log("⚙️ yt-dlp options:", ytDlpOptions.join(" "));

      // Execute download with timeout protection
      const downloadPromise = this.ytDlp.execPromise([url, ...ytDlpOptions]);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("Download timeout")),
          this.DOWNLOAD_TIMEOUT
        )
      );

      await Promise.race([downloadPromise, timeoutPromise]);

      console.log("✓ yt-dlp execution completed");

      // Find the downloaded file
      const foundFile = await this.findDownloadedFile(
        tempDirAbs,
        uniqueId,
        downloadStartTime
      );

      if (!foundFile) {
        throw new Error(
          "Download completed but file not found. The video may be too large or the download was interrupted."
        );
      }

      console.log(
        `✓ File found: ${path.basename(foundFile.path)} (${this.formatFileSize(
          foundFile.size
        )})`
      );

      // Generate final filename
      const fileName = `${this.sanitizeFilename(
        metadata?.title || "video"
      )}.${format}`;
      const contentType = this.getContentType(`.${format}`);

      // Upload to R2 if available, otherwise use local storage
      if (this.r2Client && this.r2Working) {
        try {
          console.log("☁️ Uploading to R2 cloud storage...");
          const uploadResult = await this.uploadToR2(
            foundFile.path,
            fileName,
            contentType
          );

          console.log("✓ Upload to R2 successful");

          // Clean up local files after successful upload
          await this.deleteVideoAndThumbnail(foundFile.path);

          return {
            success: true,
            downloadUrl: uploadResult.url,
            fileSize: foundFile.size,
            quality: quality,
            format: format,
          };
        } catch (r2Error) {
          console.error("R2 upload failed:", r2Error.message);
          console.log("⚠ Falling back to local storage");
          this.r2Working = false;
        }
      }

      // Fallback to local storage
      const downloadsDir = path.resolve(this.downloadDir);
      const finalFileName = `${Date.now()}_${uniqueId}_${fileName}`;
      const finalPath = path.join(downloadsDir, finalFileName);

      await fs.move(foundFile.path, finalPath, { overwrite: true });
      console.log("✓ File moved to local storage");

      return {
        success: true,
        downloadUrl: `/api/v1/download/file/${encodeURIComponent(
          finalFileName
        )}`,
        fileSize: foundFile.size,
        quality: quality,
        format: format,
      };
    } catch (error) {
      console.error("Download execution error:", error.message);
      throw error;
    }
  }

  buildDownloadOptions({
    platform,
    quality,
    format,
    audioOnly,
    uniqueId,
    tempDirAbs,
  }) {
    const options = [];

    // Format selection
    if (audioOnly || format === "mp3") {
      options.push(
        "-f",
        "bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio/best"
      );
    } else {
      const platformQualities =
        this.qualityMap[platform] || this.qualityMap.default;
      const qualitySelector =
        platformQualities[quality] || platformQualities.high || "best";
      options.push("-f", qualitySelector);
    }

    // Audio extraction for MP3
    if (format === "mp3") {
      options.push(
        "--extract-audio",
        "--audio-format",
        "mp3",
        "--audio-quality",
        "0",
        "--embed-thumbnail"
      );
    }

    // Video+Audio merging for MP4 with proper codecs
    if (format === "mp4" && !audioOnly) {
      options.push(
        "--merge-output-format",
        "mp4",
        "--remux-video",
        "mp4",
        "--postprocessor-args",
        "ffmpeg:-c:v copy -c:a aac -b:a 192k -movflags +faststart"
      );
    }

    // Output template
    options.push("-o", path.join(tempDirAbs, `video_${uniqueId}.%(ext)s`));

    // General options
    options.push(
      "--no-mtime",
      "--no-playlist",
      "--write-thumbnail",
      "--no-check-certificates",
      "--socket-timeout",
      "30",
      "--retries",
      "5",
      "--fragment-retries",
      "5",
      "--buffer-size",
      "16K",
      "--http-chunk-size",
      "10M"
    );

    // Platform-specific optimizations
    if (platform === "youtube") {
      options.push(
        "--extractor-args",
        "youtube:player_client=android",
        "--format-sort",
        "res,vcodec:vp9.2,acodec:opus"
      );
    }

    return options;
  }

  async findDownloadedFile(tempDirAbs, uniqueId, downloadStartTime) {
    const searchStartTime = Date.now();
    const validExtensions = [".mp4", ".webm", ".mp3", ".m4a", ".mkv"];

    console.log(`🔍 Searching for downloaded file with ID: ${uniqueId}`);

    while (Date.now() - searchStartTime < this.FILE_SEARCH_TIMEOUT) {
      try {
        const files = await fs.readdir(tempDirAbs);

        const candidates = [];
        for (const file of files) {
          const ext = path.extname(file).toLowerCase();

          // Skip invalid files
          if (!validExtensions.includes(ext)) continue;
          if (
            file.endsWith(".part") ||
            file.endsWith(".tmp") ||
            file.endsWith(".ytdl")
          )
            continue;
          if (!file.includes(uniqueId)) continue;

          const filePath = path.join(tempDirAbs, file);

          try {
            const stats = await fs.stat(filePath);

            // File must be created after download started and have reasonable size
            if (
              stats.mtime.getTime() >= downloadStartTime - 60000 &&
              stats.size > 10000 // At least 10KB
            ) {
              candidates.push({
                path: filePath,
                size: stats.size,
                mtime: stats.mtime.getTime(),
                name: file,
              });
            }
          } catch (statError) {
            // File might be being written, skip this iteration
            continue;
          }
        }

        if (candidates.length > 0) {
          // Sort by modification time (newest first) and size (largest first)
          candidates.sort((a, b) => {
            if (Math.abs(a.mtime - b.mtime) < 5000) {
              return b.size - a.size;
            }
            return b.mtime - a.mtime;
          });

          const selected = candidates[0];
          console.log(
            `✓ Found file: ${selected.name} (${this.formatFileSize(
              selected.size
            )})`
          );
          return selected;
        }

        console.log(
          `⏳ Waiting for file... (${Math.floor(
            (Date.now() - searchStartTime) / 1000
          )}s)`
        );
        await new Promise((resolve) =>
          setTimeout(resolve, this.FILE_SEARCH_INTERVAL)
        );
      } catch (error) {
        console.error("Error searching for file:", error.message);
        await new Promise((resolve) =>
          setTimeout(resolve, this.FILE_SEARCH_INTERVAL)
        );
      }
    }

    console.error("✗ File search timeout - no file found");
    return null;
  }

  async uploadToR2(filePath, fileName, contentType) {
    const fileContent = await fs.readFile(filePath);
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
          fileName
        )}`,
        CacheControl: "public, max-age=31536000",
      })
    );

    const url = await getSignedUrl(
      this.r2Client,
      new GetObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: key,
      }),
      { expiresIn: 86400 }
    );

    return { url, key };
  }

  async deleteVideoAndThumbnail(videoPath) {
    try {
      if (await fs.pathExists(videoPath)) {
        await fs.remove(videoPath);
      }

      const dir = path.dirname(videoPath);
      const basename = path.basename(videoPath, path.extname(videoPath));
      const files = await fs.readdir(dir);

      for (const file of files) {
        if (
          file.startsWith(basename) &&
          [".webp", ".jpg", ".png", ".jpeg"].includes(
            path.extname(file).toLowerCase()
          )
        ) {
          await fs.remove(path.join(dir, file));
        }
      }
    } catch (error) {
      console.error("Cleanup error:", error.message);
    }
  }

  validateDownloadRequest(options) {
    const { url, quality, format } = options;

    if (!url) {
      return { valid: false, error: "URL is required" };
    }

    const detection = platformDetector.detectPlatform(url);
    if (!detection.success) {
      return { valid: false, error: detection.error };
    }

    const validQualities = ["highest", "high", "medium", "low"];
    if (quality && !validQualities.includes(quality)) {
      return { valid: false, error: "Invalid quality option" };
    }

    const validFormats = ["mp4", "mp3", "webm"];
    if (format && !validFormats.includes(format)) {
      return { valid: false, error: "Invalid format option" };
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
}

module.exports = new VideoDownloaderService();
