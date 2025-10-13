const fs = require("fs-extra");
const path = require("path");
const cron = require("node-cron");
const {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectCommand,
} = require("@aws-sdk/client-s3");
require("dotenv").config();

class CleanupService {
  constructor() {
    // FIXED: Use correct paths based on environment
    const isProduction =
      process.env.NODE_ENV === "production" || process.env.RAILWAY_ENVIRONMENT;

    if (isProduction) {
      this.tempDir = "/tmp/temp";
      this.downloadsDir = "/tmp/downloads";
      this.isProduction = true;
    } else {
      this.tempDir = path.join(__dirname, "../../temp");
      this.downloadsDir = path.join(__dirname, "../../downloads");
      this.isProduction = false;
    }

    this.initializeR2Client();
  }

  /**
   * Initialize R2 client for cleanup
   */
  initializeR2Client() {
    if (!process.env.R2_ACCOUNT_ID || !process.env.R2_ACCESS_KEY_ID) {
      console.log("R2 credentials not found - R2 cleanup disabled");
      this.r2Client = null;
      return;
    }

    try {
      this.r2Client = new S3Client({
        region: "auto",
        endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: process.env.R2_ACCESS_KEY_ID,
          secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
        },
      });
      console.log("R2 cleanup client initialized");
    } catch (error) {
      console.error("R2 cleanup client initialization failed:", error.message);
      this.r2Client = null;
    }
  }

  /**
   * Start automatic cleanup jobs
   */
  startCleanupJobs() {
    // CHANGED: Different schedules for production vs development
    if (this.isProduction) {
      // Production: More aggressive cleanup (Railway has limited space)

      // Clean temp files every 15 minutes
      cron.schedule("*/15 * * * *", () => {
        this.cleanTempFiles(2); // 2 hours old
        console.log("Temp cleanup completed");
      });

      // Clean downloads every 30 minutes (in case R2 upload failed)
      cron.schedule("*/30 * * * *", () => {
        this.cleanDownloadedFiles(2); // 2 hours old
        console.log("Downloads cleanup completed");
      });

      // Clean R2 files every 6 hours
      cron.schedule("0 */6 * * *", async () => {
        await this.cleanR2Files(24); // 24 hours
        console.log("R2 cleanup completed");
      });

      console.log("✓ Production cleanup jobs scheduled");
      console.log("  - Temp: Every 15min (files >2hrs)");
      console.log("  - Downloads: Every 30min (files >2hrs)");
      console.log("  - R2: Every 6hrs (files >24hrs)");
    } else {
      // Development: Less aggressive

      // Clean temp files every 30 minutes
      cron.schedule("*/30 * * * *", () => {
        this.cleanTempFiles(0.5); // 30 minutes old
        console.log("Temp cleanup completed");
      });

      // Clean downloads daily at 3 AM
      cron.schedule("0 3 * * *", async () => {
        await this.cleanDownloadedFiles(24);
        await this.cleanR2Files(24);
        console.log("Daily cleanup completed");
      });

      console.log("✓ Development cleanup jobs scheduled");
    }
  }

  /**
   * Clean R2 files older than specified hours
   */
  async cleanR2Files(maxAgeHours = 24) {
    if (!this.r2Client) {
      console.log("R2 client not available - skipping R2 cleanup");
      return 0;
    }

    try {
      console.log(
        `Starting R2 cleanup (files older than ${maxAgeHours} hours)...`
      );
      const cutoffTime = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000);

      const listCommand = new ListObjectsV2Command({
        Bucket: process.env.R2_BUCKET_NAME,
      });

      const list = await this.r2Client.send(listCommand);

      if (!list.Contents || list.Contents.length === 0) {
        console.log("No files in R2 bucket");
        return 0;
      }

      console.log(`Found ${list.Contents.length} files in R2 bucket`);
      let deletedCount = 0;

      for (const object of list.Contents) {
        if (object.LastModified < cutoffTime) {
          try {
            await this.r2Client.send(
              new DeleteObjectCommand({
                Bucket: process.env.R2_BUCKET_NAME,
                Key: object.Key,
              })
            );

            console.log(`Deleted from R2: ${object.Key}`);
            deletedCount++;
          } catch (deleteError) {
            console.error(`Error deleting ${object.Key}:`, deleteError.message);
          }
        }
      }

      console.log(
        `R2 cleanup: ${deletedCount} files deleted, ${
          list.Contents.length - deletedCount
        } files kept`
      );
      return deletedCount;
    } catch (error) {
      console.error("R2 cleanup error:", error.message);
      return 0;
    }
  }

  /**
   * Clean temp files older than specified hours
   */
  async cleanTempFiles(maxAgeHours = 1) {
    try {
      // Check if directory exists (important for /tmp on Railway)
      if (!(await fs.pathExists(this.tempDir))) {
        console.log(`Temp directory doesn't exist: ${this.tempDir}`);
        return 0;
      }

      const cutoffTime = Date.now() - maxAgeHours * 60 * 60 * 1000;
      const files = await fs.readdir(this.tempDir);
      let deletedCount = 0;

      for (const file of files) {
        try {
          const filePath = path.join(this.tempDir, file);
          const stats = await fs.stat(filePath);

          if (stats.mtime.getTime() < cutoffTime) {
            await fs.remove(filePath);
            console.log(`Deleted temp file: ${file}`);
            deletedCount++;
          }
        } catch (error) {
          // File might have been deleted by another process or is in use
          console.error(`Error processing ${file}:`, error.message);
        }
      }

      if (deletedCount > 0) {
        console.log(`Temp cleanup: ${deletedCount} files deleted`);
      }
      return deletedCount;
    } catch (error) {
      console.error("Temp cleanup error:", error.message);
      return 0;
    }
  }

  /**
   * Clean downloaded files older than specified hours
   */
  async cleanDownloadedFiles(maxAgeHours = 24) {
    try {
      // Check if directory exists
      if (!(await fs.pathExists(this.downloadsDir))) {
        console.log(`Downloads directory doesn't exist: ${this.downloadsDir}`);
        return 0;
      }

      const cutoffTime = Date.now() - maxAgeHours * 60 * 60 * 1000;
      const files = await fs.readdir(this.downloadsDir);
      let deletedCount = 0;

      for (const file of files) {
        try {
          const filePath = path.join(this.downloadsDir, file);
          const stats = await fs.stat(filePath);

          if (stats.mtime.getTime() < cutoffTime) {
            await fs.remove(filePath);
            deletedCount++;
          }
        } catch (error) {
          console.error(`Error processing ${file}:`, error.message);
        }
      }

      if (deletedCount > 0) {
        console.log(`Downloads cleanup: ${deletedCount} files deleted`);
      }
      return deletedCount;
    } catch (error) {
      console.error("Downloads cleanup error:", error.message);
      return 0;
    }
  }

  /**
   * Delete file immediately after user downloads (optional feature)
   */
  async deleteAfterDownload(filePath, delayMinutes = 5) {
    setTimeout(async () => {
      try {
        if (await fs.pathExists(filePath)) {
          await fs.remove(filePath);
          console.log(`Post-download cleanup: ${path.basename(filePath)}`);
        }
      } catch (error) {
        console.error("Post-download cleanup error:", error.message);
      }
    }, delayMinutes * 60 * 1000);
  }

  /**
   * Manual cleanup trigger (for testing or admin use)
   */
  async cleanupNow() {
    console.log("Manual cleanup triggered...");
    const results = {
      r2: await this.cleanR2Files(24),
      temp: await this.cleanTempFiles(this.isProduction ? 2 : 0.5),
      downloads: await this.cleanDownloadedFiles(2),
    };
    console.log("Manual cleanup completed:", results);
    return results;
  }

  /**
   * Get disk and storage usage statistics
   */
  async getStorageStats() {
    try {
      const tempSize = await this.getDirectorySize(this.tempDir);
      const downloadsSize = await this.getDirectorySize(this.downloadsDir);

      // Get R2 stats
      let r2Stats = { files: 0, size: 0 };
      if (this.r2Client) {
        try {
          const list = await this.r2Client.send(
            new ListObjectsV2Command({
              Bucket: process.env.R2_BUCKET_NAME,
            })
          );

          if (list.Contents) {
            r2Stats.files = list.Contents.length;
            r2Stats.size = list.Contents.reduce(
              (sum, obj) => sum + (obj.Size || 0),
              0
            );
          }
        } catch (error) {
          console.error("Error getting R2 stats:", error.message);
        }
      }

      return {
        environment: this.isProduction ? "production" : "development",
        local: {
          temp: tempSize,
          downloads: downloadsSize,
          total: tempSize + downloadsSize,
          formatted: {
            temp: this.formatBytes(tempSize),
            downloads: this.formatBytes(downloadsSize),
            total: this.formatBytes(tempSize + downloadsSize),
          },
          paths: {
            temp: this.tempDir,
            downloads: this.downloadsDir,
          },
        },
        r2: {
          files: r2Stats.files,
          size: r2Stats.size,
          formatted: this.formatBytes(r2Stats.size),
          estimatedCost: `$${(
            (r2Stats.size / (1024 * 1024 * 1024)) *
            0.015
          ).toFixed(4)}/month`,
        },
      };
    } catch (error) {
      console.error("Storage stats error:", error.message);
      return null;
    }
  }

  /**
   * Get directory size (with error handling for missing directories)
   */
  async getDirectorySize(directory) {
    try {
      if (!(await fs.pathExists(directory))) {
        return 0;
      }

      const files = await fs.readdir(directory);
      let totalSize = 0;

      for (const file of files) {
        try {
          const filePath = path.join(directory, file);
          const stats = await fs.stat(filePath);
          if (stats.isFile()) {
            totalSize += stats.size;
          }
        } catch (error) {
          // File might have been deleted, skip it
        }
      }

      return totalSize;
    } catch (error) {
      console.error(`Error reading directory ${directory}:`, error.message);
      return 0;
    }
  }

  /**
   * Format bytes to human-readable format
   */
  formatBytes(bytes) {
    const units = ["B", "KB", "MB", "GB"];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(2)} ${units[unitIndex]}`;
  }

  /**
   * Emergency cleanup - delete all files immediately (use with caution!)
   */
  async emergencyCleanup() {
    console.warn("⚠️ EMERGENCY CLEANUP - Deleting ALL files!");

    const results = {
      temp: 0,
      downloads: 0,
      r2: 0,
    };

    try {
      // Clean all temp files
      if (await fs.pathExists(this.tempDir)) {
        const tempFiles = await fs.readdir(this.tempDir);
        for (const file of tempFiles) {
          await fs.remove(path.join(this.tempDir, file)).catch(() => {});
          results.temp++;
        }
      }

      // Clean all downloaded files
      if (await fs.pathExists(this.downloadsDir)) {
        const downloadFiles = await fs.readdir(this.downloadsDir);
        for (const file of downloadFiles) {
          await fs.remove(path.join(this.downloadsDir, file)).catch(() => {});
          results.downloads++;
        }
      }

      // Clean ALL R2 files (be careful!)
      if (this.r2Client) {
        const list = await this.r2Client.send(
          new ListObjectsV2Command({
            Bucket: process.env.R2_BUCKET_NAME,
          })
        );

        if (list.Contents) {
          for (const object of list.Contents) {
            await this.r2Client
              .send(
                new DeleteObjectCommand({
                  Bucket: process.env.R2_BUCKET_NAME,
                  Key: object.Key,
                })
              )
              .catch(() => {});
            results.r2++;
          }
        }
      }

      console.log("Emergency cleanup completed:", results);
      return results;
    } catch (error) {
      console.error("Emergency cleanup error:", error.message);
      return results;
    }
  }
}

module.exports = new CleanupService();
