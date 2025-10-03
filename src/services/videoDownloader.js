const YTDlpWrap = require("yt-dlp-wrap").default;
const fs = require("fs-extra");
const path = require("path");
const crypto = require("crypto");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const https = require("https");
const platformDetector = require("./platformDetector");
const Download = require("../models/Download");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { GetObjectCommand } = require("@aws-sdk/client-s3");
const dns = require("dns");
const { Resolver } = require("dns").promises;

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

    this.qualityMap = {
      youtube: {
        highest: "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
        high: "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080]",
        medium:
          "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720]",
        low: "bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/best[height<=480]",
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
      default: {
        highest: "best",
        high: "best",
        medium: "best",
        low: "worst",
      },
    };
  }

  async testDNSResolution() {
    const hostname = `${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
    try {
      const addresses = await resolver.resolve4(hostname);
      this.r2IP = addresses[0];
    } catch (error) {
      this.r2IP = "172.64.66.1";
    }
  }

  async initializeR2Client() {
    if (!process.env.R2_ACCOUNT_ID || !process.env.R2_ACCESS_KEY_ID) {
      console.warn("R2 credentials not found - using local storage only");
      this.r2Client = null;
      return;
    }

    const httpsAgent = new https.Agent({
      keepAlive: true,
      maxSockets: 50,
      timeout: 60000,
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
      },
    });

    this.r2Working = await this.testR2Connection();
  }

  async testR2Connection() {
    if (!this.r2Client) return false;
    try {
      const { ListObjectsV2Command } = require("@aws-sdk/client-s3");
      await this.r2Client.send(
        new ListObjectsV2Command({
          Bucket: process.env.R2_BUCKET_NAME,
          MaxKeys: 1,
        })
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
    } catch (error) {
      console.error("Error creating directories:", error);
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

    try {
      const detection = platformDetector.detectPlatform(url);
      if (!detection.success) {
        throw new Error(detection.error);
      }

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
        metadata = await this.getVideoMetadata(url, detection.platform);
      } catch (metaError) {
        console.log("Metadata extraction failed, using defaults");
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

      const downloadResult = await this.performDownload({
        url,
        quality,
        format,
        audioOnly,
        customFilename,
        detection,
        metadata,
      });

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
      console.error("Download error:", error);

      let userMessage = this.getUserFriendlyError(error.message);

      if (downloadRecord) {
        await this.updateDownloadRecord(downloadRecord, {
          status: "failed",
          error: {
            message: userMessage,
            code: error.code || "DOWNLOAD_ERROR",
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
    if (errorMessage.includes("private") || errorMessage.includes("Private")) {
      return "This video is private and cannot be downloaded.";
    }
    if (
      errorMessage.includes("unavailable") ||
      errorMessage.includes("removed")
    ) {
      return "This video is no longer available.";
    }
    if (errorMessage.includes("age-restricted")) {
      return "This video is age-restricted and cannot be downloaded.";
    }
    if (errorMessage.includes("copyright")) {
      return "This video is protected by copyright.";
    }
    if (errorMessage.includes("geo-restricted")) {
      return "This video is not available in your region.";
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
      const options = ["--dump-json", "--no-playlist", "--skip-download"];

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
        } catch (e) {}
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

      const ytDlpOptions = this.buildDownloadOptions({
        platform: detection.platform,
        quality,
        format,
        audioOnly,
        downloadStartTime,
        tempDirAbs,
      });

      await this.ytDlp.execPromise([url, ...ytDlpOptions]);

      const foundFile = await this.findDownloadedFile(
        tempDirAbs,
        downloadStartTime
      );

      if (!foundFile) {
        throw new Error("Download completed but file not found");
      }

      const fileName = `${this.sanitizeFilename(
        metadata?.title || "video"
      )}.${format}`;
      const contentType = this.getContentType(`.${format}`);

      if (this.r2Client && this.r2Working) {
        try {
          const uploadResult = await this.uploadToR2(
            foundFile.path,
            fileName,
            contentType
          );

          await this.deleteVideoAndThumbnail(foundFile.path);

          return {
            success: true,
            downloadUrl: uploadResult.url,
            fileSize: foundFile.size,
            quality: quality,
            format: format,
          };
        } catch (r2Error) {
          console.log("R2 upload failed, using local storage");
          this.r2Working = false;
        }
      }

      const downloadsDir = path.resolve(this.downloadDir);
      const finalFileName = `${Date.now()}_${fileName}`;
      const finalPath = path.join(downloadsDir, finalFileName);

      await fs.move(foundFile.path, finalPath);

      return {
        success: true,
        downloadUrl: `/api/v1/download/file/${finalFileName}`,
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
    downloadStartTime,
    tempDirAbs,
  }) {
    const options = [];

    if (audioOnly || format === "mp3") {
      options.push("-f", "bestaudio/best");
    } else {
      const platformQualities =
        this.qualityMap[platform] || this.qualityMap.default;
      const qualitySelector =
        platformQualities[quality] || platformQualities.high || "best";
      options.push("-f", qualitySelector);
    }

    if (format === "mp3") {
      options.push(
        "--extract-audio",
        "--audio-format",
        "mp3",
        "--audio-quality",
        "192K"
      );
    }

    options.push(
      "-o",
      path.join(tempDirAbs, `%(title)s_${downloadStartTime}.%(ext)s`)
    );

    options.push("--no-mtime", "--no-playlist", "--write-thumbnail");

    if (platform === "youtube") {
      options.push("--extractor-args", "youtube:player_client=android");
    }

    return options;
  }

  async findDownloadedFile(tempDirAbs, downloadStartTime) {
    for (let attempt = 0; attempt < 10; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 2000));

      try {
        const files = await fs.readdir(tempDirAbs);

        const candidates = [];
        for (const file of files) {
          const ext = path.extname(file).toLowerCase();
          if (![".mp4", ".webm", ".mp3", ".m4a"].includes(ext)) continue;
          if (file.endsWith(".part") || file.endsWith(".tmp")) continue;

          const filePath = path.join(tempDirAbs, file);
          const stats = await fs.stat(filePath);

          if (
            stats.mtime.getTime() >= downloadStartTime - 60000 &&
            stats.size > 1000
          ) {
            candidates.push({
              path: filePath,
              size: stats.size,
              mtime: stats.mtime.getTime(),
            });
          }
        }

        if (candidates.length > 0) {
          candidates.sort((a, b) => b.mtime - a.mtime);
          return candidates[0];
        }
      } catch (error) {
        console.error("Error finding file:", error.message);
      }
    }

    return null;
  }

  async uploadToR2(filePath, fileName, contentType) {
    const fileContent = await fs.readFile(filePath);
    const key = `downloads/${Date.now()}_${fileName}`;

    await this.r2Client.send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: key,
        Body: fileContent,
        ContentType: contentType,
        ContentDisposition: `attachment; filename="${fileName}"`,
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
          [".webp", ".jpg", ".png"].includes(path.extname(file))
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

    return { valid: true, detection };
  }

  getContentType(ext) {
    const types = {
      ".mp4": "video/mp4",
      ".mp3": "audio/mpeg",
      ".webm": "video/webm",
      ".m4a": "audio/mp4",
    };
    return types[ext.toLowerCase()] || "application/octet-stream";
  }

  sanitizeFilename(filename) {
    if (!filename) return "video";
    return filename
      .replace(/[<>:"/\\|?*]/g, "_")
      .replace(/\s+/g, "_")
      .substring(0, 100)
      .toLowerCase();
  }

  getSupportedPlatforms() {
    return platformDetector.getSupportedPlatforms();
  }
}

module.exports = new VideoDownloaderService();
