const fs = require("fs-extra");
const path = require("path");

class CookieManager {
  constructor() {
    this.cookiesDir = path.join(__dirname, "../../cookies");
    this.ensureCookiesDir();
  }

  async ensureCookiesDir() {
    try {
      await fs.ensureDir(this.cookiesDir);
    } catch (error) {
      console.error("Error creating cookies directory:", error);
    }
  }

  getYouTubeCookiesPath() {
    return path.join(this.cookiesDir, "youtube.txt");
  }

  async hasYouTubeCookies() {
    try {
      const cookiePath = this.getYouTubeCookiesPath();
      return await fs.pathExists(cookiePath);
    } catch {
      return false;
    }
  }

  async initialize() {
    const hasCookies = await this.hasYouTubeCookies();
    console.log(
      hasCookies
        ? "✓ YouTube cookies found"
        : "⚠ No YouTube cookies - bot detection may occur",
    );
    return hasCookies;
  }
}

module.exports = new CookieManager();
