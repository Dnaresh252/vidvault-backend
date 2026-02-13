// const fs = require("fs-extra");
// const path = require("path");

// /**
//  * ═══════════════════════════════════════════════════════════
//  * BULLETPROOF COOKIE MANAGER FOR YOUTUBE
//  * ═══════════════════════════════════════════════════════════
//  * Purpose: Manage YouTube authentication cookies for yt-dlp
//  * Features: Auto-load from env, validate format, simple API
//  * Robust: Never crashes, always provides clear status
//  */
// class CookieManager {
//   constructor() {
//     // ═══════════════════════════════════════════════════════════
//     // CONFIGURATION
//     // ═══════════════════════════════════════════════════════════
//     const isProduction =
//       process.env.NODE_ENV === "production" || process.env.RAILWAY_ENVIRONMENT;

//     // Railway volume support
//     if (
//       process.env.RAILWAY_ENVIRONMENT &&
//       process.env.RAILWAY_VOLUME_MOUNT_PATH
//     ) {
//       this.cookieDir = process.env.RAILWAY_VOLUME_MOUNT_PATH;
//     } else if (isProduction) {
//       this.cookieDir = "/tmp/cookies";
//     } else {
//       this.cookieDir = path.join(__dirname, "../../cookies");
//     }

//     this.cookieFile = path.join(this.cookieDir, "youtube_cookies.txt");

//     // State
//     this.initialized = false;
//     this.hasCookies = false;
//     this.cookiesValid = false;
//     this.lastCheck = null;
//     this.source = null;

//     // Initialize synchronously
//     this.initializeSync();
//   }

//   /**
//    * ═══════════════════════════════════════════════════════════
//    * SYNCHRONOUS INITIALIZATION
//    * ═══════════════════════════════════════════════════════════
//    */
//   initializeSync() {
//     try {
//       // Ensure directory exists
//       fs.ensureDirSync(this.cookieDir);

//       // Priority 1: Environment Variable (Railway deployment)
//       if (process.env.YOUTUBE_COOKIES) {
//         try {
//           const content = process.env.YOUTUBE_COOKIES.trim();

//           // Write to file
//           fs.writeFileSync(this.cookieFile, content, "utf-8");

//           // Validate
//           if (this.validateCookieFileSync()) {
//             this.hasCookies = true;
//             this.cookiesValid = true;
//             this.source = "environment";
//             this.lastCheck = Date.now();

//             console.log(
//               "✅ YouTube cookies loaded from YOUTUBE_COOKIES environment variable",
//             );
//             this.initialized = true;
//             return;
//           } else {
//             console.log(
//               "⚠️  YOUTUBE_COOKIES environment variable exists but validation failed",
//             );
//           }
//         } catch (error) {
//           console.error("❌ Failed to process YOUTUBE_COOKIES:", error.message);
//         }
//       }

//       // Priority 2: File System
//       if (fs.existsSync(this.cookieFile)) {
//         if (this.validateCookieFileSync()) {
//           this.hasCookies = true;
//           this.cookiesValid = true;
//           this.source = "file";
//           this.lastCheck = Date.now();

//           console.log("✅ YouTube cookies loaded from file");
//           this.initialized = true;
//           return;
//         } else {
//           console.log("⚠️  Cookie file exists but validation failed");
//         }
//       }

//       // No cookies found
//       console.log(
//         "⚠️  ═══════════════════════════════════════════════════════",
//       );
//       console.log("⚠️  NO YOUTUBE COOKIES FOUND - Bot detection will occur!");
//       console.log(
//         "⚠️  ═══════════════════════════════════════════════════════",
//       );
//       console.log("💡 Solution:");
//       console.log("   1. Export cookies from YouTube using browser extension");
//       console.log("   2. Add YOUTUBE_COOKIES environment variable in Railway");
//       console.log("   3. Paste the entire cookie file content as the value");
//       console.log(
//         "⚠️  ═══════════════════════════════════════════════════════",
//       );

//       this.initialized = true;
//     } catch (error) {
//       console.error("❌ Cookie manager initialization error:", error.message);
//       this.initialized = true; // Still mark as initialized to prevent crashes
//     }
//   }

//   /**
//    * ═══════════════════════════════════════════════════════════
//    * VALIDATE COOKIE FILE (SYNCHRONOUS)
//    * ═══════════════════════════════════════════════════════════
//    */
//   validateCookieFileSync() {
//     try {
//       if (!fs.existsSync(this.cookieFile)) {
//         return false;
//       }

//       const content = fs.readFileSync(this.cookieFile, "utf-8");

//       // Basic checks
//       if (!content || content.trim().length < 50) {
//         console.log("⚠️  Cookie file is too short or empty");
//         return false;
//       }

//       if (!content.includes("youtube.com")) {
//         console.log("⚠️  Cookie file doesn't contain youtube.com domain");
//         return false;
//       }

//       // Check for required authentication cookies
//       const hasAuth =
//         content.includes("__Secure-1PSID") ||
//         content.includes("__Secure-3PSID") ||
//         content.includes("SID");

//       if (!hasAuth) {
//         console.log("⚠️  Cookie file missing required auth cookies");
//         console.log(
//           "💡 Required cookies: __Secure-1PSID, __Secure-3PSID, or SID",
//         );
//         console.log("💡 These only exist when you're LOGGED IN to YouTube");
//         return false;
//       }

//       // Validate format (Netscape format: 7 tab-separated columns)
//       const lines = content.split("\n").filter((line) => {
//         const trimmed = line.trim();
//         return trimmed && !trimmed.startsWith("#");
//       });

//       if (lines.length === 0) {
//         console.log("⚠️  No valid cookie lines found");
//         return false;
//       }

//       // Check at least one line has proper format
//       let validLineFound = false;
//       for (const line of lines.slice(0, 5)) {
//         // Check first 5 lines
//         const parts = line.split("\t");
//         if (parts.length === 7) {
//           validLineFound = true;
//           break;
//         }
//       }

//       if (!validLineFound) {
//         console.log(
//           "⚠️  Cookie format invalid - must be Netscape format (7 tab-separated columns)",
//         );
//         return false;
//       }

//       return true;
//     } catch (error) {
//       console.error("Cookie validation error:", error.message);
//       return false;
//     }
//   }

//   /**
//    * ═══════════════════════════════════════════════════════════
//    * ADD COOKIES TO YT-DLP OPTIONS ARRAY
//    * ═══════════════════════════════════════════════════════════
//    * This is the MAIN method used by videoDownloader
//    *
//    * @param {Array} optionsArray - yt-dlp options array to modify
//    * @returns {boolean} - true if cookies were added, false otherwise
//    */
//   addCookieOptions(optionsArray) {
//     if (!this.hasCookies || !this.cookiesValid) {
//       console.log(
//         "⚠️  [YOUTUBE] No valid cookies - proceeding without authentication",
//       );
//       console.log("⚠️  [YOUTUBE] Bot detection may occur!");
//       return false;
//     }

//     if (!fs.existsSync(this.cookieFile)) {
//       console.log(
//         "⚠️  [YOUTUBE] Cookie file missing - proceeding without authentication",
//       );
//       return false;
//     }

//     // Add cookies to yt-dlp command
//     optionsArray.push("--cookies", this.cookieFile);
//     console.log(`🍪 [YOUTUBE] Using cookies from: ${this.cookieFile}`);

//     return true;
//   }

//   /**
//    * ═══════════════════════════════════════════════════════════
//    * GET STATUS
//    * ═══════════════════════════════════════════════════════════
//    */
//   getStatus() {
//     return {
//       initialized: this.initialized,
//       hasCookies: this.hasCookies,
//       valid: this.cookiesValid,
//       source: this.source,
//       cookieFile: this.cookieFile,
//       cookieFileExists: fs.existsSync(this.cookieFile),
//       lastCheck: this.lastCheck ? new Date(this.lastCheck).toISOString() : null,
//     };
//   }

//   /**
//    * ═══════════════════════════════════════════════════════════
//    * PRINT STATUS (FOR LOGGING)
//    * ═══════════════════════════════════════════════════════════
//    */
//   printStatus() {
//     console.log("\n🍪 ═══════════════════════════════════════════");
//     console.log("   YOUTUBE COOKIE MANAGER STATUS");
//     console.log("═══════════════════════════════════════════\n");

//     const status = this.getStatus();

//     console.log(`Initialized: ${status.initialized ? "✅" : "❌"}`);
//     console.log(`Has Cookies: ${status.hasCookies ? "✅" : "❌"}`);
//     console.log(`Valid: ${status.valid ? "✅" : "❌"}`);
//     console.log(`Source: ${status.source || "none"}`);
//     console.log(`File Exists: ${status.cookieFileExists ? "✅" : "❌"}`);

//     if (status.lastCheck) {
//       console.log(`Last Check: ${status.lastCheck}`);
//     }

//     console.log("\n═══════════════════════════════════════════\n");
//   }

//   /**
//    * ═══════════════════════════════════════════════════════════
//    * REFRESH FROM ENVIRONMENT (FOR MANUAL REFRESH)
//    * ═══════════════════════════════════════════════════════════
//    */
//   refreshFromEnvironment() {
//     if (!process.env.YOUTUBE_COOKIES) {
//       console.log("⚠️  YOUTUBE_COOKIES environment variable not found");
//       return false;
//     }

//     try {
//       const content = process.env.YOUTUBE_COOKIES.trim();
//       fs.writeFileSync(this.cookieFile, content, "utf-8");

//       if (this.validateCookieFileSync()) {
//         this.hasCookies = true;
//         this.cookiesValid = true;
//         this.source = "environment";
//         this.lastCheck = Date.now();

//         console.log("✅ Cookies refreshed from environment variable");
//         return true;
//       } else {
//         console.log("❌ Refreshed cookies failed validation");
//         return false;
//       }
//     } catch (error) {
//       console.error("❌ Cookie refresh error:", error.message);
//       return false;
//     }
//   }

//   /**
//    * ═══════════════════════════════════════════════════════════
//    * SETUP INSTRUCTIONS (STATIC METHOD)
//    * ═══════════════════════════════════════════════════════════
//    */
//   static getInstructions() {
//     return {
//       step1: "Install 'Get cookies.txt LOCALLY' browser extension",
//       step2: "Login to YouTube in your browser",
//       step3: "Click extension icon → Export cookies for current site",
//       step4: "Open the downloaded file → Copy ALL content (Ctrl+A, Ctrl+C)",
//       step5: "Go to Railway Dashboard → Your Service → Variables",
//       step6: "Add variable: YOUTUBE_COOKIES",
//       step7: "Paste cookie content as the value",
//       step8: "Save → Railway will auto-redeploy",
//       step9:
//         "Check logs for: ✅ YouTube cookies loaded from YOUTUBE_COOKIES environment variable",

//       links: {
//         chromeExtension:
//           "https://chrome.google.com/webstore/detail/cclelndahbckbenkjhflpdbgdldlbecc",
//         firefoxExtension:
//           "https://addons.mozilla.org/firefox/addon/get-cookies-txt-locally/",
//       },
//     };
//   }
// }

// // Export singleton instance
// module.exports = new CookieManager();
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

    // State tracking
    this.cookieStatus = {};
    this.initialized = false;

    // Initialize all platforms
    this.initializeSync();
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

    const cookieFile = this.cookieFiles[platform];
    if (!fs.existsSync(cookieFile)) {
      console.log(`⚠️  [${platform.toUpperCase()}] Cookie file missing`);
      return false;
    }

    optionsArray.push("--cookies", cookieFile);
    console.log(`🍪 [${platform.toUpperCase()}] Using authenticated cookies`);
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