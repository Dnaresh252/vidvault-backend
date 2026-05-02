const fs = require("fs-extra");
const path = require("path");

/**
 * ═══════════════════════════════════════════════════════════
 * PRODUCTION-READY MULTI-PLATFORM COOKIE MANAGER
 * ═══════════════════════════════════════════════════════════
 * Supports: YouTube, Instagram, TikTok, Twitter, Facebook
 * Features: Auto-load from env, validation, health checks
 */
class CookieManager {
  constructor() {
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

    // Platform-specific cookie files
    this.cookieFiles = {
      youtube: path.join(this.cookieDir, "youtube_cookies.txt"),
      instagram: path.join(this.cookieDir, "instagram_cookies.txt"),
      tiktok: path.join(this.cookieDir, "tiktok_cookies.txt"),
      twitter: path.join(this.cookieDir, "twitter_cookies.txt"),
      facebook: path.join(this.cookieDir, "facebook_cookies.txt"),
    };

    // ── Instagram cookie rotation ────────────────────────────────────────────
    // Pool of cookie files. We track which is active and rotate on auth failure.
    this.igPool = [
      path.join(this.cookieDir, "instagram_cookies_1.txt"),
      path.join(this.cookieDir, "instagram_cookies_2.txt"),
    ];
    this.igActiveIndex = 0;   // 0 = cookie 1, 1 = cookie 2
    this.igBothFailed = false; // true after both have auth-failed in same window

    // State tracking
    this.cookieStatus = {};
    this.initialized = false;

    // Initialize all platforms
    this.initializeSync();
    this.initInstagramRotation();
  }

  /**
   * ═══════════════════════════════════════════════════════════
   * INITIALIZE ALL PLATFORMS
   * ═══════════════════════════════════════════════════════════
   */
  initializeSync() {
    try {
      fs.ensureDirSync(this.cookieDir);

      // Initialize each platform
      const platforms = [
        "youtube",
        "instagram",
        "tiktok",
        "twitter",
        "facebook",
      ];

      platforms.forEach((platform) => {
        this.initializePlatform(platform);
      });

      this.initialized = true;
      this.printStatus();
    } catch (error) {
      console.error("❌ Cookie manager initialization error:", error.message);
      this.initialized = true;
    }
  }

  /**
   * ═══════════════════════════════════════════════════════════
   * INITIALIZE SINGLE PLATFORM
   * ═══════════════════════════════════════════════════════════
   */
  initializePlatform(platform) {
    const envVar = `${platform.toUpperCase()}_COOKIES`;
    const cookieFile = this.cookieFiles[platform];

    this.cookieStatus[platform] = {
      enabled: false,
      valid: false,
      source: null,
      lastCheck: null,
    };

    try {
      // Priority 1: Environment Variable
      if (process.env[envVar]) {
        const content = process.env[envVar].trim();
        fs.writeFileSync(cookieFile, content, "utf-8");

        if (this.validateCookieFile(platform, cookieFile)) {
          this.cookieStatus[platform] = {
            enabled: true,
            valid: true,
            source: "environment",
            lastCheck: Date.now(),
          };
          console.log(
            `✅ ${platform.toUpperCase()} cookies loaded from ${envVar}`,
          );
          return;
        }
      }

      // Priority 2: File System
      if (fs.existsSync(cookieFile)) {
        if (this.validateCookieFile(platform, cookieFile)) {
          this.cookieStatus[platform] = {
            enabled: true,
            valid: true,
            source: "file",
            lastCheck: Date.now(),
          };
          console.log(`✅ ${platform.toUpperCase()} cookies loaded from file`);
          return;
        }
      }

      // No cookies for this platform
      console.log(
        `⚠️  ${platform.toUpperCase()}: No cookies found (will use anonymous mode)`,
      );
    } catch (error) {
      console.error(
        `❌ ${platform.toUpperCase()} cookie init error:`,
        error.message,
      );
    }
  }

  /**
   * ═══════════════════════════════════════════════════════════
   * VALIDATE COOKIE FILE
   * ═══════════════════════════════════════════════════════════
   */
  validateCookieFile(platform, filePath) {
    try {
      if (!fs.existsSync(filePath)) return false;

      const content = fs.readFileSync(filePath, "utf-8");

      if (!content || content.trim().length < 50) {
        console.log(`⚠️  ${platform}: Cookie file too short`);
        return false;
      }

      // Platform-specific domain checks
      const domainMap = {
        youtube: "youtube.com",
        instagram: "instagram.com",
        tiktok: "tiktok.com",
        twitter: "twitter.com",
        facebook: "facebook.com",
      };

      const requiredDomain = domainMap[platform];
      if (!content.includes(requiredDomain)) {
        console.log(`⚠️  ${platform}: Missing ${requiredDomain} domain`);
        return false;
      }

      // Platform-specific auth cookie checks
      const authCookieMap = {
        youtube: ["__Secure-1PSID", "__Secure-3PSID", "SID"],
        instagram: ["sessionid", "csrftoken"],
        tiktok: ["sessionid", "tt_webid"],
        twitter: ["auth_token", "ct0"],
        facebook: ["c_user", "xs"],
      };

      const requiredCookies = authCookieMap[platform] || [];
      const hasAuth = requiredCookies.some((cookie) =>
        content.includes(cookie),
      );

      if (!hasAuth) {
        console.log(
          `⚠️  ${platform}: Missing auth cookies: ${requiredCookies.join(", ")}`,
        );
        return false;
      }

      // Validate Netscape format
      const lines = content.split("\n").filter((line) => {
        const trimmed = line.trim();
        return trimmed && !trimmed.startsWith("#");
      });

      if (lines.length === 0) return false;

      // Check format
      let validLineFound = false;
      for (const line of lines.slice(0, 5)) {
        const parts = line.split("\t");
        if (parts.length === 7) {
          validLineFound = true;
          break;
        }
      }

      if (!validLineFound) {
        console.log(`⚠️  ${platform}: Invalid Netscape format`);
        return false;
      }

      return true;
    } catch (error) {
      console.error(`${platform} validation error:`, error.message);
      return false;
    }
  }

  /**
   * ═══════════════════════════════════════════════════════════
   * ADD COOKIES TO YT-DLP OPTIONS
   * ═══════════════════════════════════════════════════════════
   */
  addCookieOptions(optionsArray, platform) {
    if (!platform) {
      console.log("⚠️  No platform specified for cookies");
      return false;
    }

    const status = this.cookieStatus[platform];
    if (!status || !status.enabled || !status.valid) {
      console.log(
        `⚠️  [${platform.toUpperCase()}] No valid cookies - using anonymous mode`,
      );
      return false;
    }

    // Instagram uses the rotation pool; all other platforms use the static file.
    const cookieFile =
      platform === "instagram"
        ? this.getActiveInstagramCookiePath()
        : this.cookieFiles[platform];

    if (!fs.existsSync(cookieFile)) {
      // Instagram fallback: try the legacy active file before giving up
      if (platform === "instagram") {
        const legacy = this.cookieFiles.instagram;
        if (fs.existsSync(legacy)) {
          optionsArray.push("--cookies", legacy);
          console.log(`🍪 [INSTAGRAM] Using legacy cookie file (pool file missing)`);
          return true;
        }
      }
      console.log(`⚠️  [${platform.toUpperCase()}] Cookie file missing`);
      return false;
    }

    optionsArray.push("--cookies", cookieFile);
    console.log(
      platform === "instagram"
        ? `🍪 [INSTAGRAM] Using cookie ${this.igActiveIndex + 1} (${cookieFile})`
        : `🍪 [${platform.toUpperCase()}] Using authenticated cookies`,
    );
    return true;
  }

  /**
   * ═══════════════════════════════════════════════════════════
   * INSTAGRAM COOKIE ROTATION
   * ═══════════════════════════════════════════════════════════
   */
  initInstagramRotation() {
    this.igPool.forEach((file, i) => {
      const exists = fs.existsSync(file);
      console.log(
        `${exists ? "✅" : "⚠️ "} Instagram cookie ${i + 1}: ${exists ? "found" : "NOT found"} (${file})`,
      );
    });

    // Reset to cookie 1 every 24 hours to distribute load evenly
    setInterval(() => {
      const prev = this.igActiveIndex;
      this.igActiveIndex = 0;
      this.igBothFailed = false;
      if (prev !== 0) {
        console.log("🔄 [INSTAGRAM] 24h reset — switched back to cookie 1");
      }
    }, 24 * 60 * 60 * 1000);
  }

  getActiveInstagramCookiePath() {
    return this.igPool[this.igActiveIndex];
  }

  // Called by videoDownloader when an auth error is detected.
  // Returns { switched, allFailed, newIndex }.
  async switchInstagramCookie() {
    if (this.igBothFailed) {
      return { switched: false, allFailed: true, newIndex: this.igActiveIndex };
    }

    const nextIndex = (this.igActiveIndex + 1) % this.igPool.length;
    const nextFile = this.igPool[nextIndex];

    if (!fs.existsSync(nextFile)) {
      this.igBothFailed = true;
      console.log(`❌ [INSTAGRAM] Cookie ${nextIndex + 1} missing — all cookies exhausted`);
      return { switched: false, allFailed: true, newIndex: nextIndex };
    }

    this.igActiveIndex = nextIndex;
    this.igBothFailed = false;
    console.log(`🔄 [INSTAGRAM] Rotated to cookie ${nextIndex + 1}: ${nextFile}`);
    return { switched: true, allFailed: false, newIndex: nextIndex };
  }

  // Fires a Telegram message to TELEGRAM_ADMIN_ID when all cookies have failed.
  async notifyAllCookiesExpired() {
    this.igBothFailed = true;
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const adminId = process.env.TELEGRAM_ADMIN_ID;

    console.error("🚨 [INSTAGRAM] ALL cookies expired! Telegram alert sending...");

    if (!botToken || !adminId) {
      console.error("🚨 [INSTAGRAM] No Telegram credentials — alert skipped");
      return;
    }

    try {
      const body = JSON.stringify({
        chat_id: adminId,
        text:
          "🚨 *All Instagram cookies expired\\!*\n\n" +
          "Both cookie files have failed auth\\.\n" +
          "Please update immediately:\n\n" +
          "• `instagram_cookies_1\\.txt`\n" +
          "• `instagram_cookies_2\\.txt`\n\n" +
          "Then redeploy the backend\\.",
        parse_mode: "MarkdownV2",
      });

      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      console.log("🚨 [INSTAGRAM] Telegram alert sent");
    } catch (e) {
      console.error("🚨 [INSTAGRAM] Telegram alert failed:", e.message);
    }
  }

  /**
   * ═══════════════════════════════════════════════════════════
   * GET STATUS
   * ═══════════════════════════════════════════════════════════
   */
  getStatus() {
    return {
      initialized: this.initialized,
      platforms: this.cookieStatus,
      cookieDir: this.cookieDir,
    };
  }

  /**
   * ═══════════════════════════════════════════════════════════
   * PRINT STATUS
   * ═══════════════════════════════════════════════════════════
   */
  printStatus() {
    console.log("\n🍪 ═══════════════════════════════════════════");
    console.log("   MULTI-PLATFORM COOKIE MANAGER STATUS");
    console.log("═══════════════════════════════════════════\n");

    Object.entries(this.cookieStatus).forEach(([platform, status]) => {
      const icon = status.enabled ? "✅" : "❌";
      const sourceText = status.source ? `(from ${status.source})` : "";
      console.log(`${icon} ${platform.toUpperCase().padEnd(12)} ${sourceText}`);
    });

    console.log("\n═══════════════════════════════════════════\n");
  }

  /**
   * ═══════════════════════════════════════════════════════════
   * HEALTH CHECK
   * ═══════════════════════════════════════════════════════════
   */
  healthCheck() {
    const health = {
      healthy: true,
      platforms: {},
    };

    Object.entries(this.cookieStatus).forEach(([platform, status]) => {
      health.platforms[platform] = {
        enabled: status.enabled,
        valid: status.valid,
        ageHours: status.lastCheck
          ? Math.floor((Date.now() - status.lastCheck) / (1000 * 60 * 60))
          : null,
      };
    });

    return health;
  }

  /**
   * ═══════════════════════════════════════════════════════════
   * SETUP INSTRUCTIONS
   * ═══════════════════════════════════════════════════════════
   */
  static getInstructions() {
    return {
      extensionLinks: {
        chrome:
          "https://chrome.google.com/webstore/detail/cclelndahbckbenkjhflpdbgdldlbecc",
        firefox:
          "https://addons.mozilla.org/firefox/addon/get-cookies-txt-locally/",
      },
      steps: [
        "1. Install 'Get cookies.txt LOCALLY' browser extension",
        "2. Login to the platform (Instagram, YouTube, etc.)",
        "3. Click extension icon → Export cookies",
        "4. Copy entire file content",
        "5. In Railway: Add environment variable",
        "6. Variable names: INSTAGRAM_COOKIES, YOUTUBE_COOKIES, etc.",
        "7. Paste cookie content as value",
        "8. Save & redeploy",
      ],
      platforms: {
        instagram: {
          url: "https://www.instagram.com",
          envVar: "INSTAGRAM_COOKIES",
          requiredCookies: ["sessionid", "csrftoken"],
        },
        youtube: {
          url: "https://www.youtube.com",
          envVar: "YOUTUBE_COOKIES",
          requiredCookies: ["__Secure-1PSID", "__Secure-3PSID"],
        },
        tiktok: {
          url: "https://www.tiktok.com",
          envVar: "TIKTOK_COOKIES",
          requiredCookies: ["sessionid", "tt_webid"],
        },
      },
    };
  }
}

module.exports = new CookieManager();
