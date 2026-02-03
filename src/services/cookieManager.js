const fs = require("fs-extra");
const path = require("path");
const https = require("https");

class CookieManager {
  constructor() {
    // Use /tmp in production for Railway (unless volume mounted)
    const isProduction =
      process.env.NODE_ENV === "production" || process.env.RAILWAY_ENVIRONMENT;

    // 🆕 RAILWAY VOLUME SUPPORT
    if (
      process.env.RAILWAY_ENVIRONMENT &&
      process.env.RAILWAY_VOLUME_MOUNT_PATH
    ) {
      // If Railway volume is mounted, use it
      this.cookieDir = process.env.RAILWAY_VOLUME_MOUNT_PATH;
      console.log(`📦 Using Railway volume: ${this.cookieDir}`);
    } else if (isProduction) {
      this.cookieDir = "/tmp/cookies";
    } else {
      this.cookieDir = path.join(__dirname, "../../cookies");
    }

    this.cookieFile = path.join(this.cookieDir, "youtube_cookies.txt");
    this.browserCookieFile = path.join(this.cookieDir, "browser_cookies.txt");

    this.lastRefresh = null;
    this.refreshInterval = 6 * 60 * 60 * 1000; // 6 hours
    this.cookieValid = false;

    this.initialize();
  }

  async initialize() {
    try {
      await fs.ensureDir(this.cookieDir);

      // 🆕 PRIORITY 1: Check environment variable (RAILWAY METHOD)
      if (process.env.YOUTUBE_COOKIES) {
        console.log("📦 Found cookies in environment variable");

        try {
          // Write environment cookies to file
          await fs.writeFile(
            this.cookieFile,
            process.env.YOUTUBE_COOKIES,
            "utf-8",
          );
          console.log("✓ YouTube cookies loaded from environment variable");

          // Validate the cookies
          const isValid = await this.validateCookies();

          if (isValid) {
            console.log("✓ Environment cookies validated successfully");
            this.cookieValid = true;
            this.lastRefresh = Date.now();
          } else {
            console.log("⚠️  Environment cookies failed validation");
            this.cookieValid = false;
          }

          this.startCookieValidation();
          return;
        } catch (error) {
          console.error(
            "❌ Failed to write environment cookies:",
            error.message,
          );
          // Continue to check file system
        }
      }

      // PRIORITY 2: Check if cookies exist in file system
      const hasManualCookies = await fs.pathExists(this.cookieFile);
      const hasBrowserCookies = await fs.pathExists(this.browserCookieFile);

      if (hasManualCookies) {
        console.log("✓ YouTube cookies found (file)");
        this.cookieValid = true;
        this.lastRefresh = Date.now();
      } else if (hasBrowserCookies) {
        console.log("✓ YouTube cookies found (browser export)");
        this.cookieValid = true;
        this.lastRefresh = Date.now();
      } else {
        console.log("⚠️  No YouTube cookies found - bot detection may occur");
        console.log("💡 Solutions:");
        console.log(
          "   1. Add YOUTUBE_COOKIES environment variable in Railway",
        );
        console.log("   2. Upload youtube_cookies.txt to:", this.cookieDir);
        console.log(
          "📖 Guide: https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp",
        );
        this.cookieValid = false;
      }

      // Start periodic validation
      this.startCookieValidation();
    } catch (error) {
      console.error("❌ Cookie initialization error:", error.message);
      this.cookieValid = false;
    }
  }

  /**
   * Get cookie file path for yt-dlp
   * Returns null if no valid cookies available
   */
  getCookieFile() {
    // Try manual cookies first (Netscape format)
    if (fs.existsSync(this.cookieFile)) {
      return this.cookieFile;
    }

    // Try browser export cookies
    if (fs.existsSync(this.browserCookieFile)) {
      return this.browserCookieFile;
    }

    return null;
  }

  /**
   * Add cookie file to yt-dlp options array
   */
  addCookieOptions(optionsArray) {
    const cookieFile = this.getCookieFile();

    if (cookieFile) {
      optionsArray.push("--cookies", cookieFile);
      console.log(`🍪 Using cookies: ${path.basename(cookieFile)}`);
      return true;
    } else {
      console.log(
        "⚠️  No cookies available - proceeding without authentication",
      );
      console.log(
        "💡 To fix: Add YOUTUBE_COOKIES environment variable in Railway",
      );
      return false;
    }
  }

  /**
   * Validate cookies are still working
   */
  async validateCookies() {
    const cookieFile = this.getCookieFile();
    if (!cookieFile) {
      this.cookieValid = false;
      return false;
    }

    try {
      const content = await fs.readFile(cookieFile, "utf-8");

      // Check if file has content
      if (!content || content.trim().length < 50) {
        console.log("⚠️  Cookie file exists but appears empty");
        this.cookieValid = false;
        return false;
      }

      // Check for Netscape format header
      const isNetscapeFormat = content.includes("# Netscape HTTP Cookie File");

      // Check for essential YouTube cookies
      const hasEssentialCookies =
        content.includes("youtube.com") &&
        (content.includes("CONSENT") || content.includes("VISITOR_INFO"));

      if (!hasEssentialCookies) {
        console.log("⚠️  Cookie file missing essential YouTube cookies");
        console.log("💡 Required cookies: CONSENT, VISITOR_INFO1_LIVE");
        this.cookieValid = false;
        return false;
      }

      this.cookieValid = true;
      this.lastRefresh = Date.now();
      return true;
    } catch (error) {
      console.error("Cookie validation error:", error.message);
      this.cookieValid = false;
      return false;
    }
  }

  /**
   * Periodic cookie validation
   */
  startCookieValidation() {
    // Validate immediately
    this.validateCookies();

    // Then validate every hour
    setInterval(
      async () => {
        const isValid = await this.validateCookies();

        if (!isValid && this.getCookieFile()) {
          console.log(
            "⚠️  Cookie validation failed - cookies may need refresh",
          );
          console.log(
            "💡 Update YOUTUBE_COOKIES environment variable in Railway",
          );
        }

        // Check if cookies need refresh (> 6 hours old)
        if (
          this.lastRefresh &&
          Date.now() - this.lastRefresh > this.refreshInterval
        ) {
          console.log(
            "⚠️  Cookies are older than 6 hours - consider refreshing",
          );
          console.log(
            `📅 Last refresh: ${new Date(this.lastRefresh).toISOString()}`,
          );
        }
      },
      60 * 60 * 1000,
    ); // Check every hour
  }

  /**
   * Manual cookie update from string (for admin panel or API)
   */
  async updateCookiesFromString(cookieContent, format = "netscape") {
    try {
      const targetFile =
        format === "netscape" ? this.cookieFile : this.browserCookieFile;

      // Validate format
      if (
        format === "netscape" &&
        !cookieContent.includes("# Netscape HTTP Cookie File")
      ) {
        // Add header if missing
        cookieContent = "# Netscape HTTP Cookie File\n" + cookieContent;
      }

      await fs.writeFile(targetFile, cookieContent, "utf-8");
      console.log(`✓ Cookies updated successfully (${format})`);

      // Validate new cookies
      const isValid = await this.validateCookies();

      return {
        success: true,
        valid: isValid,
        message: isValid
          ? "Cookies updated and validated"
          : "Cookies updated but validation failed - check cookie format",
      };
    } catch (error) {
      console.error("Cookie update error:", error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get cookie status for monitoring
   */
  getStatus() {
    const cookieFile = this.getCookieFile();
    const ageHours = this.lastRefresh
      ? ((Date.now() - this.lastRefresh) / (1000 * 60 * 60)).toFixed(1)
      : null;

    return {
      hasCookies: cookieFile !== null,
      cookieFile: cookieFile ? path.basename(cookieFile) : null,
      cookieSource: process.env.YOUTUBE_COOKIES ? "environment" : "file",
      valid: this.cookieValid,
      lastRefresh: this.lastRefresh
        ? new Date(this.lastRefresh).toISOString()
        : null,
      ageHours: ageHours,
      needsRefresh: this.lastRefresh
        ? Date.now() - this.lastRefresh > this.refreshInterval
        : true,
      cookieDir: this.cookieDir,
    };
  }

  /**
   * Instructions for getting cookies
   */
  static getInstructions() {
    return {
      railway: {
        title: "Railway Deployment (Recommended)",
        steps: [
          "1. Install browser extension: https://chrome.google.com/webstore/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc",
          "2. Login to YouTube in your browser",
          "3. Click extension icon → Export cookies",
          "4. Open the downloaded youtube_cookies.txt file",
          "5. Copy ALL content (Ctrl+A, Ctrl+C)",
          "6. Go to Railway Dashboard → Your Service → Variables",
          "7. Add new variable: YOUTUBE_COOKIES",
          "8. Paste cookie content as the value",
          "9. Railway will auto-redeploy with cookies ✅",
        ],
      },
      local: {
        title: "Local Development",
        steps: [
          "1. Get cookies using browser extension (see Railway method)",
          "2. Create folder: cookies/ in your project root",
          "3. Save as: cookies/youtube_cookies.txt",
          "4. Restart your server",
          "5. Check logs for: ✓ YouTube cookies found",
        ],
      },
      method2: {
        title: "Using yt-dlp Command (Advanced)",
        steps: [
          "1. Login to YouTube in Chrome/Firefox",
          "2. Run: yt-dlp --cookies-from-browser chrome --cookies youtube_cookies.txt https://youtube.com",
          "3. Railway: Add file content to YOUTUBE_COOKIES env variable",
          "4. Local: Copy file to cookies/ folder",
        ],
      },
      format: {
        title: "Cookie File Format (Netscape)",
        example: `# Netscape HTTP Cookie File
.youtube.com\tTRUE\t/\tTRUE\t0\tCONSENT\tYES+
.youtube.com\tTRUE\t/\tFALSE\t0\tVISITOR_INFO1_LIVE\txxx
.youtube.com\tTRUE\t/\tTRUE\t0\tSID\txxx`,
      },
    };
  }

  /**
   * 🆕 Refresh cookies from environment variable (for periodic updates)
   */
  async refreshFromEnvironment() {
    if (!process.env.YOUTUBE_COOKIES) {
      return {
        success: false,
        message: "No YOUTUBE_COOKIES environment variable found",
      };
    }

    try {
      await fs.writeFile(this.cookieFile, process.env.YOUTUBE_COOKIES, "utf-8");
      const isValid = await this.validateCookies();

      if (isValid) {
        console.log("✓ Cookies refreshed from environment variable");
        this.lastRefresh = Date.now();
        return {
          success: true,
          message: "Cookies refreshed and validated",
        };
      } else {
        return {
          success: false,
          message: "Cookies refreshed but validation failed",
        };
      }
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }
}

module.exports = new CookieManager();
