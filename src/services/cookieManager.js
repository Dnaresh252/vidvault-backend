const fs = require("fs-extra");
const path = require("path");

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

    this.cookieFile = path.join(this.cookieDir, "youtube_cookies.txt");
    this.browserCookieFile = path.join(this.cookieDir, "browser_cookies.txt");

    this.lastRefresh = null;
    this.refreshInterval = 6 * 60 * 60 * 1000; // 6 hours
    this.cookieValid = false;
    // ── track whether a LIVE test has ever passed ──
    this.liveValidated = false;

    this.initialize();
  }

  async initialize() {
    try {
      await fs.ensureDir(this.cookieDir);

      // Priority 1 – env var
      if (process.env.YOUTUBE_COOKIES) {
        console.log("📦 Found cookies in environment variable");
        try {
          await fs.writeFile(
            this.cookieFile,
            process.env.YOUTUBE_COOKIES,
            "utf-8",
          );
          console.log("✓ YouTube cookies loaded from environment variable");

          const formatOk = await this.validateCookieFormat();
          if (formatOk) {
            console.log("✓ Environment cookies validated successfully");
            this.cookieValid = true;
            this.lastRefresh = Date.now();
          } else {
            console.log("⚠️  Environment cookies failed format validation");
            this.cookieValid = false;
          }

          this.startCookieValidation();
          return;
        } catch (error) {
          console.error(
            "❌ Failed to write environment cookies:",
            error.message,
          );
        }
      }

      // Priority 2 – file system
      const hasManual = await fs.pathExists(this.cookieFile);
      const hasBrowser = await fs.pathExists(this.browserCookieFile);

      if (hasManual) {
        console.log("✓ YouTube cookies found (file)");
        this.cookieValid = true;
        this.lastRefresh = Date.now();
      } else if (hasBrowser) {
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
        this.cookieValid = false;
      }

      this.startCookieValidation();
    } catch (error) {
      console.error("❌ Cookie initialization error:", error.message);
      this.cookieValid = false;
    }
  }

  // ─── FORMAT-ONLY CHECK (fast, offline) ────────────────────────────
  // Previously called validateCookies — renamed so callers are explicit.
  async validateCookieFormat() {
    const cookieFile = this.getCookieFile();
    if (!cookieFile) {
      this.cookieValid = false;
      return false;
    }

    try {
      const content = await fs.readFile(cookieFile, "utf-8");
      if (!content || content.trim().length < 50) {
        console.log("⚠️  Cookie file exists but appears empty");
        this.cookieValid = false;
        return false;
      }

      // Must mention youtube.com at all
      if (!content.includes("youtube.com")) {
        console.log("⚠️  Cookie file missing youtube.com domain");
        this.cookieValid = false;
        return false;
      }

      // Must have at least one of the auth-level cookies that prove a logged-in session
      const hasAuth =
        content.includes("__Secure-1PSID") ||
        content.includes("__Secure-3PSID") ||
        content.includes("SID");

      if (!hasAuth) {
        console.log(
          "⚠️  Cookie file missing auth cookies (__Secure-1PSID / __Secure-3PSID / SID)",
        );
        console.log(
          "💡 These cookies only exist when you are LOGGED IN to YouTube",
        );
        console.log(
          "   → Export cookies WHILE logged in, then update YOUTUBE_COOKIES in Railway",
        );
        this.cookieValid = false;
        return false;
      }

      this.cookieValid = true;
      this.lastRefresh = Date.now();
      return true;
    } catch (error) {
      console.error("Cookie format validation error:", error.message);
      this.cookieValid = false;
      return false;
    }
  }

  // ─── BACKWARD COMPAT alias ───────────────────────────────────────
  async validateCookies() {
    return this.validateCookieFormat();
  }

  // ─── FILE PATH HELPERS ────────────────────────────────────────────
  getCookieFile() {
    if (fs.existsSync(this.cookieFile)) return this.cookieFile;
    if (fs.existsSync(this.browserCookieFile)) return this.browserCookieFile;
    return null;
  }

  addCookieOptions(optionsArray) {
    const cookieFile = this.getCookieFile();
    if (cookieFile) {
      optionsArray.push("--cookies", cookieFile);
      console.log(`🍪 Using cookies: ${path.basename(cookieFile)}`);
      return true;
    }
    console.log("⚠️  No cookies available - proceeding without authentication");
    return false;
  }

  // ─── PERIODIC VALIDATION ──────────────────────────────────────────
  startCookieValidation() {
    this.validateCookieFormat();

    setInterval(
      async () => {
        const isValid = await this.validateCookieFormat();
        if (!isValid && this.getCookieFile()) {
          console.log(
            "⚠️  Cookie validation failed - cookies may need refresh",
          );
          console.log(
            "💡 Update YOUTUBE_COOKIES environment variable in Railway",
          );
        }
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
    );
  }

  // ─── MANUAL UPDATE ────────────────────────────────────────────────
  async updateCookiesFromString(cookieContent, format = "netscape") {
    try {
      const targetFile =
        format === "netscape" ? this.cookieFile : this.browserCookieFile;
      if (
        format === "netscape" &&
        !cookieContent.includes("# Netscape HTTP Cookie File")
      ) {
        cookieContent = "# Netscape HTTP Cookie File\n" + cookieContent;
      }
      await fs.writeFile(targetFile, cookieContent, "utf-8");
      console.log(`✓ Cookies updated successfully (${format})`);
      const isValid = await this.validateCookieFormat();
      return {
        success: true,
        valid: isValid,
        message: isValid
          ? "Cookies updated and validated"
          : "Cookies updated but validation failed",
      };
    } catch (error) {
      console.error("Cookie update error:", error.message);
      return { success: false, error: error.message };
    }
  }

  // ─── STATUS ───────────────────────────────────────────────────────
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
      liveValidated: this.liveValidated,
      lastRefresh: this.lastRefresh
        ? new Date(this.lastRefresh).toISOString()
        : null,
      ageHours,
      needsRefresh: this.lastRefresh
        ? Date.now() - this.lastRefresh > this.refreshInterval
        : true,
      cookieDir: this.cookieDir,
    };
  }

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
        title:
          "Using yt-dlp Command (Advanced) — RUN ON YOUR OWN MACHINE, NOT RAILWAY",
        steps: [
          "1. Install yt-dlp on YOUR laptop/desktop: https://github.com/yt-dlp/yt-dlp/releases",
          "2. Login to YouTube in Chrome/Firefox on that same machine",
          "3. Open terminal ON THAT MACHINE and run:",
          "   yt-dlp --cookies-from-browser chrome --cookies youtube_cookies.txt https://youtube.com",
          "4. This creates youtube_cookies.txt in your current folder",
          "5. Open that file, copy ALL content",
          "6. Go to Railway → Variables → Update YOUTUBE_COOKIES",
        ],
      },
    };
  }

  async refreshFromEnvironment() {
    if (!process.env.YOUTUBE_COOKIES)
      return {
        success: false,
        message: "No YOUTUBE_COOKIES environment variable found",
      };
    try {
      await fs.writeFile(this.cookieFile, process.env.YOUTUBE_COOKIES, "utf-8");
      const isValid = await this.validateCookieFormat();
      if (isValid) {
        console.log("✓ Cookies refreshed from environment variable");
        this.lastRefresh = Date.now();
        return { success: true, message: "Cookies refreshed and validated" };
      }
      return {
        success: false,
        message: "Cookies refreshed but validation failed",
      };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }
}

module.exports = new CookieManager();
