const { spawn } = require("child_process");
const fs = require("fs-extra");
const path = require("path");
const crypto = require("crypto");
const archiver = require("archiver");
const { Upload } = require("@aws-sdk/lib-storage");
const { GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const cookieManager = require("./cookieManager");

const isProduction =
  process.env.NODE_ENV === "production" || process.env.RAILWAY_ENVIRONMENT;

const TEMP_DIR = isProduction
  ? "/tmp/ig-images"
  : path.join(__dirname, "../../temp/ig-images");

const MAX_IMAGES = 20;
const DOWNLOAD_TIMEOUT_MS = 90000; // 90 seconds
const METADATA_TIMEOUT_MS = 20000; // 20 seconds

class InstagramImageService {
  constructor() {
    this.ensureDir();
  }

  async ensureDir() {
    await fs.ensureDir(TEMP_DIR);
  }

  // ============================================
  // 🔥 MAIN: Download Instagram images (gallery-dl only)
  // ============================================
  async downloadImages(url, options = {}) {
    const { r2Client } = options;
    const sessionId = crypto.randomBytes(8).toString("hex");
    const sessionDir = path.join(TEMP_DIR, sessionId);

    try {
      console.log(`\n📸 [${sessionId}] Instagram image download started`);
      console.log(`📸 [${sessionId}] URL: ${url}`);
      await fs.ensureDir(sessionDir);

      // Download with gallery-dl
      const images = await this.runGalleryDl(url, sessionDir, sessionId);

      if (!images || images.length === 0) {
        throw new Error("NO_IMAGES_FOUND");
      }

      console.log(`✅ [${sessionId}] Downloaded ${images.length} image(s)`);

      // Upload to R2
      let result;
      if (images.length === 1) {
        result = await this.uploadSingleImage(images[0], sessionId, r2Client);
      } else {
        result = await this.uploadAsZip(images, sessionId, r2Client);
      }

      // Cleanup temp files
      await fs.remove(sessionDir).catch(() => {});
      console.log(
        `✅ [${sessionId}] Complete — ${images.length} image(s) uploaded`,
      );

      return {
        success: true,
        imageCount: images.length,
        isCarousel: images.length > 1,
        ...result,
      };
    } catch (error) {
      await fs.remove(sessionDir).catch(() => {});
      console.error(`❌ [${sessionId}] Failed: ${error.message}`);
      throw error;
    }
  }

  // ============================================
  // Run gallery-dl
  // ============================================
  async runGalleryDl(url, outputDir, sessionId) {
    return new Promise((resolve, reject) => {
      const cookieFile = cookieManager.cookieFiles?.instagram;
      const hasCookies =
        cookieManager.cookieStatus?.instagram?.enabled &&
        cookieFile &&
        fs.existsSync(cookieFile);

      // Clean URL — strip tracking params that can confuse gallery-dl
      const cleanUrl = url.replace(/^httpss:\/\//, "https://");

      const args = [];

      // Cookies MUST come before URL
      if (hasCookies) {
        args.push("--cookies", cookieFile);
        console.log(`🍪 [${sessionId}] Using Instagram cookies`);
      } else {
        console.log(`⚠️  [${sessionId}] No cookies — anonymous mode`);
      }

      args.push(
        cleanUrl,
        "--dest",
        outputDir,
        "--no-mtime",
        "--filename",
        "{post_id}_{num}.{extension}",
        "--retries",
        "3",
      );

      console.log(`⬇️  [${sessionId}] Running gallery-dl...`);
      console.log(`⬇️  [${sessionId}] Command: gallery-dl ${args.join(" ")}`);
      const proc = spawn("gallery-dl", args);
      let stdout = "";
      let stderr = "";
      let timedOut = false;

      proc.stdout.on("data", (d) => {
        stdout += d.toString();
        d.toString()
          .split("\n")
          .filter((l) => l.trim())
          .forEach((l) => console.log(`  gallery-dl: ${l}`));
      });

      proc.stderr.on("data", (d) => {
        stderr += d.toString();
        // Log stderr for debugging
        const lines = d
          .toString()
          .split("\n")
          .filter((l) => l.trim());
        lines.forEach((l) => console.log(`  gallery-dl [err]: ${l}`));
      });

      proc.on("close", async (code) => {
        if (timedOut) return;

        try {
          const allFiles = await this.findImages(outputDir);
          console.log(
            `📁 [${sessionId}] Found ${allFiles.length} image file(s)`,
          );

          if (allFiles.length === 0) {
            // Parse stderr carefully — only flag private if explicitly stated
            const stderrLower = stderr.toLowerCase();
            if (
              stderrLower.includes("this is a private profile") ||
              stderrLower.includes("login required") ||
              stderrLower.includes("not accessible") ||
              stderrLower.includes("private profile")
            ) {
              return reject(new Error("PRIVATE_ACCOUNT"));
            }
            if (
              stderrLower.includes("404") ||
              stderrLower.includes("not found") ||
              stderrLower.includes("doesn't exist")
            ) {
              return reject(new Error("POST_NOT_FOUND"));
            }
            // Default — no images found
            return reject(new Error("NO_IMAGES_FOUND"));
          }

          resolve(allFiles.slice(0, MAX_IMAGES));
        } catch (e) {
          reject(e);
        }
      });

      proc.on("error", (err) => {
        if (timedOut) return;
        if (err.code === "ENOENT") {
          reject(new Error("GALLERY_DL_NOT_INSTALLED"));
        } else {
          reject(new Error(`GALLERY_DL_ERROR: ${err.message}`));
        }
      });

      // Timeout
      const timer = setTimeout(() => {
        timedOut = true;
        proc.kill("SIGTERM");
        setTimeout(() => proc.kill("SIGKILL"), 2000);
        reject(new Error("DOWNLOAD_TIMEOUT"));
      }, DOWNLOAD_TIMEOUT_MS);

      proc.on("close", () => clearTimeout(timer));
    });
  }

  // ============================================
  // Recursively find image files
  // ============================================
  async findImages(dir) {
    const imageExts = [".jpg", ".jpeg", ".png", ".webp", ".gif"];
    const files = [];

    const scan = async (currentDir) => {
      try {
        const entries = await fs.readdir(currentDir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(currentDir, entry.name);
          if (entry.isDirectory()) {
            await scan(fullPath);
          } else {
            const ext = path.extname(entry.name).toLowerCase();
            if (imageExts.includes(ext)) {
              files.push(fullPath);
            }
          }
        }
      } catch (e) {}
    };

    await scan(dir);
    return files.sort();
  }

  // ============================================
  // Upload single image to R2
  // ============================================
  async uploadSingleImage(imagePath, sessionId, r2Client) {
    const ext = path.extname(imagePath).toLowerCase();
    const fileName = `instagram_${sessionId}${ext}`;
    const contentType = this.getContentType(ext);
    const key = `downloads/ig/${Date.now()}_${sessionId}${ext}`;

    console.log(`☁️  [${sessionId}] Uploading image to R2...`);

    const [fileStream, stats] = await Promise.all([
      fs.createReadStream(imagePath),
      fs.stat(imagePath),
    ]);

    const upload = new Upload({
      client: r2Client,
      params: {
        Bucket: process.env.R2_BUCKET_NAME,
        Key: key,
        Body: fileStream,
        ContentType: contentType,
        ContentDisposition: `attachment; filename="${fileName}"`,
        CacheControl: "public, max-age=1800",
      },
      queueSize: 4,
      partSize: 10 * 1024 * 1024,
      leavePartsOnError: false,
    });

    await upload.done();
    console.log(
      `✅ [${sessionId}] Image uploaded: ${this.formatSize(stats.size)}`,
    );

    const downloadUrl = await getSignedUrl(
      r2Client,
      new GetObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: key,
      }),
      { expiresIn: 1800 },
    );

    return {
      downloadUrl,
      fileName,
      fileSize: stats.size,
      format: ext.replace(".", ""),
      expiresAt: new Date(Date.now() + 1800 * 1000).toISOString(),
    };
  }

  // ============================================
  // ZIP multiple images and upload to R2
  // ============================================
  async uploadAsZip(images, sessionId, r2Client) {
    const zipPath = path.join(TEMP_DIR, `${sessionId}.zip`);
    const fileName = `instagram_carousel_${sessionId}.zip`;
    const key = `downloads/ig/${Date.now()}_${sessionId}.zip`;

    console.log(
      `📦 [${sessionId}] Creating ZIP for ${images.length} images...`,
    );

    await new Promise((resolve, reject) => {
      const output = fs.createWriteStream(zipPath);
      const archive = archiver("zip", { zlib: { level: 6 } });

      output.on("close", resolve);
      archive.on("error", reject);
      archive.pipe(output);

      images.forEach((imgPath, i) => {
        const ext = path.extname(imgPath);
        archive.file(imgPath, {
          name: `image_${String(i + 1).padStart(2, "0")}${ext}`,
        });
      });

      archive.finalize();
    });

    const stats = await fs.stat(zipPath);
    console.log(`📦 [${sessionId}] ZIP ready: ${this.formatSize(stats.size)}`);

    console.log(`☁️  [${sessionId}] Uploading ZIP to R2...`);

    const upload = new Upload({
      client: r2Client,
      params: {
        Bucket: process.env.R2_BUCKET_NAME,
        Key: key,
        Body: fs.createReadStream(zipPath),
        ContentType: "application/zip",
        ContentDisposition: `attachment; filename="${fileName}"`,
        CacheControl: "public, max-age=1800",
      },
      queueSize: 4,
      partSize: 10 * 1024 * 1024,
      leavePartsOnError: false,
    });

    await upload.done();
    await fs.remove(zipPath).catch(() => {});

    console.log(`✅ [${sessionId}] ZIP uploaded successfully`);

    const downloadUrl = await getSignedUrl(
      r2Client,
      new GetObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: key,
      }),
      { expiresIn: 1800 },
    );

    return {
      downloadUrl,
      fileName,
      fileSize: stats.size,
      format: "zip",
      expiresAt: new Date(Date.now() + 1800 * 1000).toISOString(),
    };
  }

  // ============================================
  // Get post metadata via gallery-dl --dump-json
  // ============================================
  async getPostMetadata(url) {
    return new Promise((resolve) => {
      const defaultMeta = {
        username: "instagram",
        description: "",
        imageCount: 0,
        isCarousel: false,
      };

      const cookieFile = cookieManager.cookieFiles?.instagram;
      const hasCookies =
        cookieManager.cookieStatus?.instagram?.enabled &&
        cookieFile &&
        fs.existsSync(cookieFile);

      const cleanUrl = url.split("?")[0];
      const args = ["--dump-json", "--no-download", "-q", cleanUrl];
      if (hasCookies) args.push("--cookies", cookieFile);

      const proc = spawn("gallery-dl", args);
      let output = "";

      proc.stdout.on("data", (d) => (output += d.toString()));
      proc.stderr.on("data", () => {}); // suppress

      proc.on("close", () => {
        try {
          const lines = output.trim().split("\n").filter(Boolean);
          if (lines.length === 0) return resolve(defaultMeta);

          // gallery-dl outputs arrays: [category, subcategory, data]
          let parsed;
          try {
            const raw = JSON.parse(lines[0]);
            parsed = Array.isArray(raw) ? raw[2] : raw;
          } catch {
            return resolve(defaultMeta);
          }

          resolve({
            username:
              parsed?.owner?.username ||
              parsed?.username ||
              parsed?.user?.username ||
              "instagram",
            description:
              parsed?.description ||
              parsed?.caption ||
              parsed?.accessibility_caption ||
              "",
            imageCount: lines.length,
            isCarousel: lines.length > 1,
            // Thumbnail from first image
            thumbnail:
              parsed?.display_url ||
              parsed?.thumbnail_src ||
              parsed?.display_resources?.[0]?.src ||
              parsed?.image_versions2?.candidates?.[0]?.url ||
              null,
          });
        } catch {
          resolve(defaultMeta);
        }
      });

      proc.on("error", () => resolve(defaultMeta));

      const timer = setTimeout(() => {
        proc.kill();
        resolve(defaultMeta);
      }, METADATA_TIMEOUT_MS);

      proc.on("close", () => clearTimeout(timer));
    });
  }

  // ============================================
  // Helpers
  // ============================================
  getContentType(ext) {
    const types = {
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".webp": "image/webp",
      ".gif": "image/gif",
    };
    return types[ext] || "application/octet-stream";
  }

  formatSize(bytes) {
    if (!bytes) return "0B";
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
  }
}

module.exports = new InstagramImageService();
