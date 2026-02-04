const fs = require("fs-extra");
const path = require("path");

/**
 * ═══════════════════════════════════════════════════════════
 * BULLETPROOF COOKIE MANAGER FOR YOUTUBE
 * ═══════════════════════════════════════════════════════════
 * Purpose: Manage YouTube authentication cookies for yt-dlp
 * Features: Auto-load from env, validate format, simple API
 * Robust: Never crashes, always provides clear status
 */
class CookieManager {
  constructor() {
    // ═══════════════════════════════════════════════════════════
    // CONFIGURATION
    // ═══════════════════════════════════════════════════════════
    const isProduction =
      process.env.NODE_ENV === "production" || process.env.RAILWAY_ENVIRONMENT;

    // Railway volume support
    if (
      process.env.RAILWAY_ENVIRONMENT &&
      process.env.RAILWAY_VOLUME_MOUNT_PATH
    ) {
      this.cookieDir = process.env.RAILWAY_VOLUME_MOUNT_PATH;
    } else if (isProduction) {
      this.cookieDir = "/tmp/cookies";
    } else {
      this.cookieDir = path.join(__dirname, "../../cookies");
    }

    this.cookieFile = path.join(this.cookieDir, "youtube_cookies.txt");

    // State
    this.initialized = false;
    this.hasCookies = false;
    this.cookiesValid = false;
    this.lastCheck = null;
    this.source = null;

    // Initialize synchronously
    this.initializeSync();
  }

  /**
   * ═══════════════════════════════════════════════════════════
   * SYNCHRONOUS INITIALIZATION
   * ═══════════════════════════════════════════════════════════
   */
  initializeSync() {
    try {
      // Ensure directory exists
      fs.ensureDirSync(this.cookieDir);

      // Priority 1: Environment Variable (Railway deployment)
      if (process.env.YOUTUBE_COOKIES) {
        try {
          const content = process.env.YOUTUBE_COOKIES.trim();

          // Write to file
          fs.writeFileSync(this.cookieFile, content, "utf-8");

          // Validate
          if (this.validateCookieFileSync()) {
            this.hasCookies = true;
            this.cookiesValid = true;
            this.source = "environment";
            this.lastCheck = Date.now();

            console.log(
              "✅ YouTube cookies loaded from YOUTUBE_COOKIES environment variable",
            );
            this.initialized = true;
            return;
          } else {
            console.log(
              "⚠️  YOUTUBE_COOKIES environment variable exists but validation failed",
            );
          }
        } catch (error) {
          console.error("❌ Failed to process YOUTUBE_COOKIES:", error.message);
        }
      }

      // Priority 2: File System
      if (fs.existsSync(this.cookieFile)) {
        if (this.validateCookieFileSync()) {
          this.hasCookies = true;
          this.cookiesValid = true;
          this.source = "file";
          this.lastCheck = Date.now();

          console.log("✅ YouTube cookies loaded from file");
          this.initialized = true;
          return;
        } else {
          console.log("⚠️  Cookie file exists but validation failed");
        }
      }

      // No cookies found
      console.log(
        "⚠️  ═══════════════════════════════════════════════════════",
      );
      console.log("⚠️  NO YOUTUBE COOKIES FOUND - Bot detection will occur!");
      console.log(
        "⚠️  ═══════════════════════════════════════════════════════",
      );
      console.log("💡 Solution:");
      console.log("   1. Export cookies from YouTube using browser extension");
      console.log("   2. Add YOUTUBE_COOKIES environment variable in Railway");
      console.log("   3. Paste the entire cookie file content as the value");
      console.log(
        "⚠️  ═══════════════════════════════════════════════════════",
      );

      this.initialized = true;
    } catch (error) {
      console.error("❌ Cookie manager initialization error:", error.message);
      this.initialized = true; // Still mark as initialized to prevent crashes
    }
  }

  /**
   * ═══════════════════════════════════════════════════════════
   * VALIDATE COOKIE FILE (SYNCHRONOUS)
   * ═══════════════════════════════════════════════════════════
   */
  validateCookieFileSync() {
    try {
      if (!fs.existsSync(this.cookieFile)) {
        return false;
      }

      const content = fs.readFileSync(this.cookieFile, "utf-8");

      // Basic checks
      if (!content || content.trim().length < 50) {
        console.log("⚠️  Cookie file is too short or empty");
        return false;
      }

      if (!content.includes("youtube.com")) {
        console.log("⚠️  Cookie file doesn't contain youtube.com domain");
        return false;
      }

      // Check for required authentication cookies
      const hasAuth =
        content.includes("__Secure-1PSID") ||
        content.includes("__Secure-3PSID") ||
        content.includes("SID");

      if (!hasAuth) {
        console.log("⚠️  Cookie file missing required auth cookies");
        console.log(
          "💡 Required cookies: __Secure-1PSID, __Secure-3PSID, or SID",
        );
        console.log("💡 These only exist when you're LOGGED IN to YouTube");
        return false;
      }

      // Validate format (Netscape format: 7 tab-separated columns)
      const lines = content.split("\n").filter((line) => {
        const trimmed = line.trim();
        return trimmed && !trimmed.startsWith("#");
      });

      if (lines.length === 0) {
        console.log("⚠️  No valid cookie lines found");
        return false;
      }

      // Check at least one line has proper format
      let validLineFound = false;
      for (const line of lines.slice(0, 5)) {
        // Check first 5 lines
        const parts = line.split("\t");
        if (parts.length === 7) {
          validLineFound = true;
          break;
        }
      }

      if (!validLineFound) {
        console.log(
          "⚠️  Cookie format invalid - must be Netscape format (7 tab-separated columns)",
        );
        return false;
      }

      return true;
    } catch (error) {
      console.error("Cookie validation error:", error.message);
      return false;
    }
  }

  /**
   * ═══════════════════════════════════════════════════════════
   * ADD COOKIES TO YT-DLP OPTIONS ARRAY
   * ═══════════════════════════════════════════════════════════
   * This is the MAIN method used by videoDownloader
   *
   * @param {Array} optionsArray - yt-dlp options array to modify
   * @returns {boolean} - true if cookies were added, false otherwise
   */
  addCookieOptions(optionsArray) {
    if (!this.hasCookies || !this.cookiesValid) {
      console.log(
        "⚠️  [YOUTUBE] No valid cookies - proceeding without authentication",
      );
      console.log("⚠️  [YOUTUBE] Bot detection may occur!");
      return false;
    }

    if (!fs.existsSync(this.cookieFile)) {
      console.log(
        "⚠️  [YOUTUBE] Cookie file missing - proceeding without authentication",
      );
      return false;
    }

    // Add cookies to yt-dlp command
    optionsArray.push("--cookies", this.cookieFile);
    console.log(`🍪 [YOUTUBE] Using cookies from: ${this.cookieFile}`);

    return true;
  }

  /**
   * ═══════════════════════════════════════════════════════════
   * GET STATUS
   * ═══════════════════════════════════════════════════════════
   */
  getStatus() {
    return {
      initialized: this.initialized,
      hasCookies: this.hasCookies,
      valid: this.cookiesValid,
      source: this.source,
      cookieFile: this.cookieFile,
      cookieFileExists: fs.existsSync(this.cookieFile),
      lastCheck: this.lastCheck ? new Date(this.lastCheck).toISOString() : null,
    };
  }

  /**
   * ═══════════════════════════════════════════════════════════
   * PRINT STATUS (FOR LOGGING)
   * ═══════════════════════════════════════════════════════════
   */
  printStatus() {
    console.log("\n🍪 ═══════════════════════════════════════════");
    console.log("   YOUTUBE COOKIE MANAGER STATUS");
    console.log("═══════════════════════════════════════════\n");

    const status = this.getStatus();

    console.log(`Initialized: ${status.initialized ? "✅" : "❌"}`);
    console.log(`Has Cookies: ${status.hasCookies ? "✅" : "❌"}`);
    console.log(`Valid: ${status.valid ? "✅" : "❌"}`);
    console.log(`Source: ${status.source || "none"}`);
    console.log(`File Exists: ${status.cookieFileExists ? "✅" : "❌"}`);

    if (status.lastCheck) {
      console.log(`Last Check: ${status.lastCheck}`);
    }

    console.log("\n═══════════════════════════════════════════\n");
  }

  /**
   * ═══════════════════════════════════════════════════════════
   * REFRESH FROM ENVIRONMENT (FOR MANUAL REFRESH)
   * ═══════════════════════════════════════════════════════════
   */
  refreshFromEnvironment() {
    if (!process.env.YOUTUBE_COOKIES) {
      console.log("⚠️  YOUTUBE_COOKIES environment variable not found");
      return false;
    }

    try {
      const content = process.env.YOUTUBE_COOKIES.trim();
      fs.writeFileSync(this.cookieFile, content, "utf-8");

      if (this.validateCookieFileSync()) {
        this.hasCookies = true;
        this.cookiesValid = true;
        this.source = "environment";
        this.lastCheck = Date.now();

        console.log("✅ Cookies refreshed from environment variable");
        return true;
      } else {
        console.log("❌ Refreshed cookies failed validation");
        return false;
      }
    } catch (error) {
      console.error("❌ Cookie refresh error:", error.message);
      return false;
    }
  }

  /**
   * ═══════════════════════════════════════════════════════════
   * SETUP INSTRUCTIONS (STATIC METHOD)
   * ═══════════════════════════════════════════════════════════
   */
  static getInstructions() {
    return {
      step1: "Install 'Get cookies.txt LOCALLY' browser extension",
      step2: "Login to YouTube in your browser",
      step3: "Click extension icon → Export cookies for current site",
      step4: "Open the downloaded file → Copy ALL content (Ctrl+A, Ctrl+C)",
      step5: "Go to Railway Dashboard → Your Service → Variables",
      step6: "Add variable: YOUTUBE_COOKIES",
      step7: "Paste cookie content as the value",
      step8: "Save → Railway will auto-redeploy",
      step9:
        "Check logs for: ✅ YouTube cookies loaded from YOUTUBE_COOKIES environment variable",

      links: {
        chromeExtension:
          "https://chrome.google.com/webstore/detail/cclelndahbckbenkjhflpdbgdldlbecc",
        firefoxExtension:
          "https://addons.mozilla.org/firefox/addon/get-cookies-txt-locally/",
      },
    };
  }
}

// Export singleton instance
module.exports = new CookieManager();
