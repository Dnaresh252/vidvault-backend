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
    this.tempDir = path.join(__dirname, "../../temp");
    this.downloadsDir = path.join(__dirname, "../../downloads");

    // Initialize R2 client for cleanup
    this.initializeR2Client();
  }

  /**
   * Initialize R2 client for file deletion
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
    // Clean temp files every 30 minutes
    cron.schedule("*/30 * * * *", () => {
      this.cleanTempFiles(1); // 1 hour old
      console.log("Temp cleanup completed");
    });

    // Clean R2 and downloaded files daily at 3 AM
    cron.schedule("0 3 * * *", async () => {
      await this.cleanR2Files(24); // Delete R2 files older than 24 hours
      await this.cleanDownloadedFiles(24); // Clean local downloads
      console.log("Daily cleanup completed (R2 + local)");
    });

    // Additional R2 cleanup every 6 hours (optional - for aggressive cleanup)
    cron.schedule("0 */6 * * *", async () => {
      await this.cleanR2Files(24);
      console.log("6-hour R2 cleanup completed");
    });

    console.log("Cleanup jobs scheduled (including R2 auto-deletion)");
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

      // List all objects in bucket
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

      // Delete old files
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

  async cleanTempFiles(maxAgeHours = 1) {
    try {
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
          console.error(`Error processing ${file}:`, error.message);
        }
      }

      console.log(`Temp cleanup: ${deletedCount} files deleted`);
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

      console.log(`Downloads cleanup: ${deletedCount} files deleted`);
      return deletedCount;
    } catch (error) {
      console.error("Downloads cleanup error:", error.message);
      return 0;
    }
  }

  /**
   * Delete file immediately after user downloads
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
      temp: await this.cleanTempFiles(1),
      downloads: await this.cleanDownloadedFiles(24),
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
        local: {
          temp: tempSize,
          downloads: downloadsSize,
          total: tempSize + downloadsSize,
          formatted: {
            temp: this.formatBytes(tempSize),
            downloads: this.formatBytes(downloadsSize),
            total: this.formatBytes(tempSize + downloadsSize),
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

  async getDirectorySize(directory) {
    try {
      const files = await fs.readdir(directory);
      let totalSize = 0;

      for (const file of files) {
        try {
          const filePath = path.join(directory, file);
          const stats = await fs.stat(filePath);
          totalSize += stats.size;
        } catch (error) {
          console.error(`Error getting size of ${file}:`, error.message);
        }
      }

      return totalSize;
    } catch (error) {
      console.error(`Error reading directory ${directory}:`, error.message);
      return 0;
    }
  }

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
}
module.exports = new CleanupService();
