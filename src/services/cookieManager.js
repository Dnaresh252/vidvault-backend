const fs = require("fs-extra");
const path = require("path");
const { execSync } = require("child_process");

class CookieManager {
  constructor() {
    const isProduction =
      process.env.NODE_ENV === "production" || process.env.RAILWAY_ENVIRONMENT;

    if (
      process.env.RAILWAY_ENVIRONMENT &&
      process.env.RAILWAY_VOLUME_MOUNT_PATH
    ) {
      this.cookieDir = process.env.RAILWAY_VOLUME_MOUNT_PATH;
      console.log(`📦 Using Railway volume: ${this.cookieDir}`);
    } else if (isProduction) {
      this.cookieDir = "/tmp/cookies";
    } else {
      this.cookieDir = path.join(__dirname, "../../cookies");
    }

    this.platformCookies = {
      youtube: {
        file: path.join(this.cookieDir, "youtube_cookies.txt"),
        envVar: "YOUTUBE_COOKIES",
        requiredCookies: ["__Secure-1PSID", "__Secure-3PSID", "SID"],
        domain: "youtube.com",
        enabled: true,
      },
    };

    this.platformStatus = {};
    this.refreshInterval = 6 * 60 * 60 * 1000;
    this.validationInterval = 60 * 60 * 1000;
    this.retryAttempts = 3;
    this.retryDelay = 2000;

    this.botDetectionPatterns = [
      "Sign in to confirm",
      "not a bot",
      "unusual traffic",
      "automated requests",
      "captcha",
      "rate limit",
      "429",
      "403 Forbidden",
    ];

    this.initialize();
  }

  // ═══════════════════════════════════════════════════════════
  // 🔥 NEW - FIX MALFORMED COOKIES
  // ═══════════════════════════════════════════════════════════
  fixMalformedCookies(content) {
    console.log("🔧 Checking cookie format...");

    const lines = content.split("\n");
    const fixedLines = [];
    let fixCount = 0;

    for (const line of lines) {
      // Keep comments and empty lines as-is
      if (line.startsWith("#") || line.trim() === "") {
        fixedLines.push(line);
        continue;
      }

      const parts = line.split("\t");

      // Netscape format should have EXACTLY 7 columns:
      // domain, flag, path, secure, expiration, name, value

      if (parts.length === 7) {
        // Already correct format
        fixedLines.push(line);
      } else if (parts.length === 8) {
        // PROBLEM: 8 columns (extra column in the middle)
        // This happens with cookies exported incorrectly

        // Fix: Merge columns 6 and 7 into the value (column 6)
        const fixedParts = [
          parts[0], // domain
          parts[1], // flag
          parts[2], // path
          parts[3], // secure
          parts[4], // expiration
          parts[5], // name
          parts[6] + parts[7], // value (merged)
        ];

        fixedLines.push(fixedParts.join("\t"));
        fixCount++;
        console.log(`   Fixed malformed cookie: ${parts[5]}`);
      } else if (parts.length > 8) {
        // Very broken - try to salvage
        const fixedParts = [
          parts[0], // domain
          parts[1], // flag
          parts[2], // path
          parts[3], // secure
          parts[4], // expiration
          parts[5], // name
          parts.slice(6).join(""), // value (everything else merged)
        ];

        fixedLines.push(fixedParts.join("\t"));
        fixCount++;
        console.log(`   Fixed severely malformed cookie: ${parts[5]}`);
      } else {
        // Too few columns - skip this line
        console.log(`   ⚠️  Skipping invalid line (${parts.length} columns)`);
        continue;
      }
    }

    if (fixCount > 0) {
      console.log(`✅ Fixed ${fixCount} malformed cookies`);
    } else {
      console.log(`✅ All cookies have correct format`);
    }

    return fixedLines.join("\n");
  }

  // ═══════════════════════════════════════════════════════════
  // INITIALIZATION
  // ═══════════════════════════════════════════════════════════
  async initialize() {
    try {
      await fs.ensureDir(this.cookieDir);
      console.log(`🍪 Cookie directory: ${this.cookieDir}`);

      for (const [platform, config] of Object.entries(this.platformCookies)) {
        if (config.enabled) {
          await this.initializePlatform(platform, config);
        }
      }

      this.startPeriodicValidation();
      console.log("✅ Cookie Manager initialized successfully");
      this.printStatus();
    } catch (error) {
      console.error("❌ Cookie Manager initialization error:", error.message);
    }
  }

  async initializePlatform(platform, config) {
    this.platformStatus[platform] = {
      hasCookies: false,
      valid: false,
      liveValidated: false,
      lastRefresh: null,
      lastValidation: null,
      source: null,
      failureCount: 0,
      lastError: null,
    };

    try {
      // Priority 1: Environment Variable
      if (process.env[config.envVar]) {
        console.log(
          `📦 [${platform.toUpperCase()}] Found cookies in environment variable`,
        );
        try {
          let cookieContent = process.env[config.envVar];

          // 🔥 FIX MALFORMED COOKIES FIRST
          cookieContent = this.fixMalformedCookies(cookieContent);

          // Ensure Netscape format header
          if (!cookieContent.includes("# Netscape HTTP Cookie File")) {
            cookieContent = "# Netscape HTTP Cookie File\n" + cookieContent;
          }

          await fs.writeFile(config.file, cookieContent, "utf-8");

          const isValid = await this.validateCookieFormat(platform);
          if (isValid) {
            console.log(
              `✅ [${platform.toUpperCase()}] Cookies loaded and fixed from environment`,
            );
            this.platformStatus[platform].hasCookies = true;
            this.platformStatus[platform].valid = true;
            this.platformStatus[platform].source = "environment";
            this.platformStatus[platform].lastRefresh = Date.now();
            return;
          } else {
            console.log(
              `⚠️  [${platform.toUpperCase()}] Environment cookies failed validation after fix`,
            );
          }
        } catch (error) {
          console.error(
            `❌ [${platform.toUpperCase()}] Failed to write environment cookies:`,
            error.message,
          );
        }
      }

      // Priority 2: File System
      if (await fs.pathExists(config.file)) {
        console.log(`📁 [${platform.toUpperCase()}] Found cookies in file`);

        // 🔥 FIX FILE COOKIES TOO
        try {
          let fileContent = await fs.readFile(config.file, "utf-8");
          fileContent = this.fixMalformedCookies(fileContent);
          await fs.writeFile(config.file, fileContent, "utf-8");
        } catch (error) {
          console.log(`⚠️  Could not fix file cookies: ${error.message}`);
        }

        const isValid = await this.validateCookieFormat(platform);
        if (isValid) {
          this.platformStatus[platform].hasCookies = true;
          this.platformStatus[platform].valid = true;
          this.platformStatus[platform].source = "file";
          this.platformStatus[platform].lastRefresh = Date.now();
        }
      } else {
        console.log(
          `⚠️  [${platform.toUpperCase()}] No cookies found - bot detection may occur`,
        );
        console.log(`💡 Add ${config.envVar} environment variable in Railway`);
      }
    } catch (error) {
      console.error(
        `❌ [${platform.toUpperCase()}] Initialization error:`,
        error.message,
      );
      this.platformStatus[platform].lastError = error.message;
    }
  }

  async validateCookieFormat(platform) {
    const config = this.platformCookies[platform];
    if (!config) return false;

    try {
      if (!(await fs.pathExists(config.file))) {
        return false;
      }

      const content = await fs.readFile(config.file, "utf-8");

      if (!content || content.trim().length < 50) {
        console.log(
          `⚠️  [${platform.toUpperCase()}] Cookie file exists but appears empty`,
        );
        return false;
      }

      if (!content.includes(config.domain)) {
        console.log(
          `⚠️  [${platform.toUpperCase()}] Cookie file missing ${config.domain} domain`,
        );
        return false;
      }

      const hasRequiredCookies = config.requiredCookies.some((cookie) =>
        content.includes(cookie),
      );

      if (!hasRequiredCookies) {
        console.log(
          `⚠️  [${platform.toUpperCase()}] Missing required auth cookies: ${config.requiredCookies.join(", ")}`,
        );
        console.log(
          `💡 These cookies only exist when logged in to ${config.domain}`,
        );
        return false;
      }

      // 🔥 VALIDATE COLUMN COUNT
      const lines = content
        .split("\n")
        .filter((line) => !line.startsWith("#") && line.trim());
      let invalidCount = 0;

      for (const line of lines) {
        const parts = line.split("\t");
        if (parts.length !== 7) {
          invalidCount++;
          console.log(
            `⚠️  Invalid cookie format (${parts.length} columns): ${parts[5] || "unknown"}`,
          );
        }
      }

      if (invalidCount > 0) {
        console.log(`❌ Found ${invalidCount} cookies with invalid format`);
        return false;
      }

      // Check for expired cookies
      let hasValidCookie = false;
      for (const line of lines) {
        const parts = line.split("\t");
        if (parts.length === 7) {
          const expiry = parseInt(parts[4]);
          if (expiry && expiry > Date.now() / 1000) {
            hasValidCookie = true;
            break;
          }
        }
      }

      if (!hasValidCookie) {
        console.log(
          `⚠️  [${platform.toUpperCase()}] All cookies appear to be expired`,
        );
        return false;
      }

      this.platformStatus[platform].lastValidation = Date.now();
      return true;
    } catch (error) {
      console.error(
        `❌ [${platform.toUpperCase()}] Format validation error:`,
        error.message,
      );
      return false;
    }
  }

  addCookieOptions(optionsArray, platform = "youtube") {
    const config = this.platformCookies[platform];
    if (!config || !config.enabled) {
      console.log(
        `⚠️  [${platform.toUpperCase()}] Platform not enabled or configured`,
      );
      return false;
    }

    const status = this.platformStatus[platform];
    if (!status || !status.hasCookies || !status.valid) {
      console.log(
        `⚠️  [${platform.toUpperCase()}] No valid cookies available - proceeding without authentication`,
      );
      console.log(`💡 Add ${config.envVar} environment variable in Railway`);
      return false;
    }

    if (fs.existsSync(config.file)) {
      optionsArray.push("--cookies", config.file);
      console.log(
        `🍪 [${platform.toUpperCase()}] Using cookies: ${path.basename(config.file)}`,
      );
      return true;
    }

    console.log(
      `⚠️  [${platform.toUpperCase()}] Cookie file not found - proceeding without authentication`,
    );
    return false;
  }

  async refreshFromEnvironment(platform = "youtube") {
    const config = this.platformCookies[platform];
    if (!config) {
      return {
        success: false,
        message: `Platform ${platform} not configured`,
      };
    }

    if (!process.env[config.envVar]) {
      return {
        success: false,
        message: `No ${config.envVar} environment variable found`,
      };
    }

    try {
      let cookieContent = process.env[config.envVar];

      // 🔥 FIX MALFORMED COOKIES
      cookieContent = this.fixMalformedCookies(cookieContent);

      // Ensure Netscape format
      if (!cookieContent.includes("# Netscape HTTP Cookie File")) {
        cookieContent = "# Netscape HTTP Cookie File\n" + cookieContent;
      }

      await fs.writeFile(config.file, cookieContent, "utf-8");

      const isValid = await this.validateCookieFormat(platform);
      if (isValid) {
        console.log(
          `✅ [${platform.toUpperCase()}] Cookies refreshed from environment`,
        );
        this.platformStatus[platform].lastRefresh = Date.now();
        this.platformStatus[platform].valid = true;
        this.platformStatus[platform].failureCount = 0;
        return { success: true, message: "Cookies refreshed and validated" };
      }

      return {
        success: false,
        message: "Cookies refreshed but validation failed",
      };
    } catch (error) {
      console.error(
        `❌ [${platform.toUpperCase()}] Refresh error:`,
        error.message,
      );
      return { success: false, message: error.message };
    }
  }

  isBotDetectionError(errorMessage) {
    if (!errorMessage) return false;
    return this.botDetectionPatterns.some((pattern) =>
      errorMessage.toLowerCase().includes(pattern.toLowerCase()),
    );
  }

  async handleBotDetection(platform = "youtube", retryCallback = null) {
    console.log(`🤖 [${platform.toUpperCase()}] Bot detection triggered!`);

    const status = this.platformStatus[platform];
    status.failureCount = (status.failureCount || 0) + 1;

    console.log(
      `🔄 [${platform.toUpperCase()}] Attempting auto-recovery (attempt ${status.failureCount}/${this.retryAttempts})...`,
    );

    const refreshResult = await this.refreshFromEnvironment(platform);
    if (refreshResult.success) {
      console.log(`✅ [${platform.toUpperCase()}] Cookies refreshed`);
      await this.sleep(this.retryDelay);

      if (retryCallback && status.failureCount <= this.retryAttempts) {
        try {
          console.log(`🔄 [${platform.toUpperCase()}] Retrying download...`);
          return await retryCallback();
        } catch (retryError) {
          if (this.isBotDetectionError(retryError.message)) {
            if (status.failureCount < this.retryAttempts) {
              return await this.handleBotDetection(platform, retryCallback);
            }
          }
          throw retryError;
        }
      }
    }

    console.log(
      `❌ [${platform.toUpperCase()}] Auto-recovery failed after ${status.failureCount} attempts`,
    );
    console.log(`💡 Manual action required:`);
    console.log(
      `   1. Export FRESH cookies from ${this.platformCookies[platform].domain}`,
    );
    console.log(
      `   2. Update ${this.platformCookies[platform].envVar} in Railway`,
    );
    console.log(`   3. Redeploy or restart service`);

    throw new Error(
      `Bot detection - cookies may be expired. Please update ${this.platformCookies[platform].envVar}`,
    );
  }

  startPeriodicValidation() {
    setInterval(async () => {
      for (const [platform, config] of Object.entries(this.platformCookies)) {
        if (!config.enabled) continue;

        const status = this.platformStatus[platform];
        if (!status || !status.hasCookies) continue;

        const isValid = await this.validateCookieFormat(platform);
        status.valid = isValid;

        if (!isValid) {
          console.log(
            `⚠️  [${platform.toUpperCase()}] Cookie validation failed - attempting refresh...`,
          );
          await this.refreshFromEnvironment(platform);
        }

        if (
          status.lastRefresh &&
          Date.now() - status.lastRefresh > this.refreshInterval
        ) {
          console.log(
            `⚠️  [${platform.toUpperCase()}] Cookies are older than 6 hours - consider refreshing`,
          );
          console.log(
            `📅 Last refresh: ${new Date(status.lastRefresh).toISOString()}`,
          );
        }
      }
    }, this.validationInterval);
  }

  getStatus(platform = null) {
    if (platform) {
      const status = this.platformStatus[platform];
      const config = this.platformCookies[platform];

      if (!status || !config) {
        return { error: "Platform not found" };
      }

      const ageHours = status.lastRefresh
        ? ((Date.now() - status.lastRefresh) / (1000 * 60 * 60)).toFixed(1)
        : null;

      return {
        platform,
        hasCookies: status.hasCookies,
        valid: status.valid,
        liveValidated: status.liveValidated,
        source: status.source,
        lastRefresh: status.lastRefresh
          ? new Date(status.lastRefresh).toISOString()
          : null,
        ageHours,
        needsRefresh: status.lastRefresh
          ? Date.now() - status.lastRefresh > this.refreshInterval
          : true,
        failureCount: status.failureCount,
        lastError: status.lastError,
      };
    }

    const allStatus = {};
    for (const platform of Object.keys(this.platformCookies)) {
      allStatus[platform] = this.getStatus(platform);
    }
    return allStatus;
  }

  printStatus() {
    console.log("\n🍪 ═══════════════════════════════════════════");
    console.log("   COOKIE MANAGER STATUS");
    console.log("═══════════════════════════════════════════\n");

    for (const [platform, config] of Object.entries(this.platformCookies)) {
      if (!config.enabled) continue;

      const status = this.platformStatus[platform];
      const icon = status.valid ? "✅" : "❌";

      console.log(`${icon} ${platform.toUpperCase()}`);
      console.log(`   Cookies: ${status.hasCookies ? "Yes" : "No"}`);
      console.log(`   Valid: ${status.valid ? "Yes" : "No"}`);
      console.log(`   Source: ${status.source || "N/A"}`);
      if (status.lastRefresh) {
        const ageHours = (
          (Date.now() - status.lastRefresh) /
          (1000 * 60 * 60)
        ).toFixed(1);
        console.log(`   Age: ${ageHours}h`);
      }
      console.log("");
    }

    console.log("═══════════════════════════════════════════\n");
  }

  async validateCookies() {
    return this.validateCookieFormat("youtube");
  }

  getCookieFile() {
    const config = this.platformCookies["youtube"];
    if (fs.existsSync(config.file)) return config.file;
    return null;
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  static getInstructions() {
    return {
      railway: {
        title: "🚂 Railway Deployment (CORRECT METHOD)",
        steps: [
          "1. Install 'Get cookies.txt LOCALLY' extension:",
          "   Chrome: https://chrome.google.com/webstore/detail/cclelndahbckbenkjhflpdbgdldlbecc",
          "",
          "2. Login to YouTube (MUST BE LOGGED IN!)",
          "",
          "3. Click extension → Export for current site",
          "",
          "4. Open downloaded file → Copy ALL content",
          "",
          "5. Railway Dashboard → Variables → Add:",
          "   Name: YOUTUBE_COOKIES",
          "   Value: [Paste content]",
          "",
          "6. Save → Auto-redeploys ✅",
          "",
          "7. Check logs for: ✅ Fixed X malformed cookies",
        ],
      },
    };
  }
}

module.exports = new CookieManager();
