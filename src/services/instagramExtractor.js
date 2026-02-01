const fetch = require("node-fetch");
const cheerio = require("cheerio");
const { spawn } = require("child_process");

class InstagramExtractor {
  constructor() {
    this.userAgents = [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1",
      "Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    ];
  }

  getRandomUserAgent() {
    return this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
  }

  // Extract shortcode from Instagram URL
  extractShortcode(url) {
    const patterns = [
      /instagram\.com\/p\/([A-Za-z0-9_-]+)/,
      /instagram\.com\/reel\/([A-Za-z0-9_-]+)/,
      /instagram\.com\/tv\/([A-Za-z0-9_-]+)/,
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) return match[1];
    }
    return null;
  }

  // ✅ Method 1: Use yt-dlp with special Instagram args (MOST RELIABLE NOW)
  async extractViaYtDlp(url) {
    return new Promise((resolve, reject) => {
      const ytDlpPath = process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";

      const args = [
        url,
        "--dump-json",
        "--no-warnings",
        "--no-playlist",
        "--skip-download",
        "--extractor-args",
        "instagram:api_mode=api",
        "--user-agent",
        this.getRandomUserAgent(),
        "--socket-timeout",
        "20",
      ];

      const process = spawn(ytDlpPath, args);
      let stdout = "";
      let stderr = "";

      process.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      process.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      process.on("close", (code) => {
        if (code === 0 && stdout) {
          try {
            const data = JSON.parse(stdout);
            if (data.url || data.formats) {
              // Get best video URL
              let videoUrl = data.url;

              if (data.formats && data.formats.length > 0) {
                // Find best video format
                const videoFormats = data.formats.filter(
                  (f) => f.vcodec && f.vcodec !== "none" && f.url,
                );

                if (videoFormats.length > 0) {
                  // Sort by height (quality)
                  videoFormats.sort(
                    (a, b) => (b.height || 0) - (a.height || 0),
                  );
                  videoUrl = videoFormats[0].url;
                }
              }

              if (videoUrl) {
                resolve({
                  success: true,
                  videoUrl: videoUrl,
                  method: "yt-dlp",
                  title: data.title || "Instagram Video",
                  thumbnail: data.thumbnail,
                });
                return;
              }
            }
            reject(new Error("No video URL in yt-dlp output"));
          } catch (e) {
            reject(new Error("Failed to parse yt-dlp JSON: " + e.message));
          }
        } else {
          reject(new Error(stderr || "yt-dlp extraction failed"));
        }
      });

      process.on("error", (err) => {
        reject(new Error("yt-dlp spawn error: " + err.message));
      });
    });
  }

  // ✅ Method 2: Instagram oEmbed API (PUBLIC, NO AUTH)
  async extractViaOEmbed(shortcode) {
    try {
      const url = `https://www.instagram.com/p/${shortcode}/`;
      const oembedUrl = `https://graph.facebook.com/v18.0/instagram_oembed?url=${encodeURIComponent(url)}&access_token=&fields=thumbnail_url,author_name,provider_url`;

      const response = await fetch(oembedUrl, {
        headers: {
          "User-Agent": this.getRandomUserAgent(),
        },
        timeout: 10000,
      });

      if (response.ok) {
        const data = await response.json();
        console.log("✓ oEmbed data received, now fetching video...");

        // oEmbed gives us thumbnail and metadata, but we need to scrape for video
        return await this.extractViaHTML(shortcode, data);
      }

      throw new Error("oEmbed fetch failed");
    } catch (error) {
      console.log("oEmbed method failed:", error.message);
      return { success: false, error: error.message };
    }
  }

  // ✅ Method 3: Enhanced HTML scraping with multiple patterns
  async extractViaHTML(shortcode, oembedData = null) {
    try {
      const url = `https://www.instagram.com/p/${shortcode}/`;

      const response = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "Sec-Fetch-Dest": "document",
          "Sec-Fetch-Mode": "navigate",
          "Sec-Fetch-Site": "none",
          "Upgrade-Insecure-Requests": "1",
        },
        timeout: 15000,
      });

      const html = await response.text();

      // Pattern 1: Look for video_url in various script tags
      const videoUrlPatterns = [
        /"video_url":"([^"]+)"/g,
        /"playback_url":"([^"]+)"/g,
        /https:\/\/[^"]+\.cdninstagram\.com\/[^"]+\.mp4[^"]*/g,
        /https:\/\/scontent[^"]+\.cdninstagram\.com\/[^"]+\.mp4[^"]*/g,
      ];

      for (const pattern of videoUrlPatterns) {
        const matches = [...html.matchAll(pattern)];
        if (matches.length > 0) {
          for (const match of matches) {
            let videoUrl = match[1] || match[0];

            // Clean up the URL
            videoUrl = videoUrl
              .replace(/\\u0026/g, "&")
              .replace(/\\/g, "")
              .replace(/&amp;/g, "&");

            // Validate it's a real video URL
            if (videoUrl.includes(".mp4") && videoUrl.startsWith("http")) {
              console.log(`✓ Found video URL via HTML pattern`);
              return {
                success: true,
                videoUrl: videoUrl,
                method: "html-pattern",
                metadata: oembedData,
              };
            }
          }
        }
      }

      // Pattern 2: Try to extract from __additionalDataLoaded
      const additionalDataMatch = html.match(
        /window\.__additionalDataLoaded\([^,]+,({.+?})\);/,
      );
      if (additionalDataMatch) {
        try {
          const data = JSON.parse(additionalDataMatch[1]);
          const videoUrl = this.findVideoUrlInObject(data);
          if (videoUrl) {
            return {
              success: true,
              videoUrl: videoUrl,
              method: "html-additional-data",
            };
          }
        } catch (e) {}
      }

      throw new Error("No video URL found in HTML");
    } catch (error) {
      console.log("HTML scraping failed:", error.message);
      return { success: false, error: error.message };
    }
  }

  // Helper: Recursively search for video URL in object
  findVideoUrlInObject(obj) {
    if (typeof obj === "string") {
      if (obj.includes(".mp4") && obj.startsWith("http")) {
        return obj;
      }
      return null;
    }

    if (Array.isArray(obj)) {
      for (const item of obj) {
        const result = this.findVideoUrlInObject(item);
        if (result) return result;
      }
      return null;
    }

    if (typeof obj === "object" && obj !== null) {
      // Check common video URL keys first
      const videoKeys = [
        "video_url",
        "playback_url",
        "url",
        "src",
        "download_url",
      ];
      for (const key of videoKeys) {
        if (
          obj[key] &&
          typeof obj[key] === "string" &&
          obj[key].includes(".mp4")
        ) {
          return obj[key];
        }
      }

      // Recursively search all keys
      for (const key in obj) {
        const result = this.findVideoUrlInObject(obj[key]);
        if (result) return result;
      }
    }

    return null;
  }

  // ✅ Method 4: Try direct CDN patterns (sometimes works)
  async extractViaCDNPattern(shortcode) {
    try {
      // Some Instagram videos follow predictable CDN patterns
      // This is a last-resort method
      const possibleUrls = [
        `https://scontent.cdninstagram.com/v/t50.2886-16/${shortcode}.mp4`,
        `https://instagram.fvga12-1.fna.fbcdn.net/v/${shortcode}.mp4`,
      ];

      for (const testUrl of possibleUrls) {
        try {
          const response = await fetch(testUrl, {
            method: "HEAD",
            headers: {
              "User-Agent": this.getRandomUserAgent(),
              Referer: "https://www.instagram.com/",
            },
            timeout: 5000,
          });

          if (
            response.ok &&
            response.headers.get("content-type")?.includes("video")
          ) {
            return {
              success: true,
              videoUrl: testUrl,
              method: "cdn-pattern",
            };
          }
        } catch (e) {
          continue;
        }
      }

      throw new Error("CDN pattern not found");
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // Main extraction function - tries all methods in order
  async extractVideoUrl(url) {
    const shortcode = this.extractShortcode(url);

    if (!shortcode) {
      return {
        success: false,
        error: "Invalid Instagram URL",
      };
    }

    console.log(`📸 Extracting Instagram video: ${shortcode}`);

    // ✅ Try Method 1: yt-dlp (MOST RELIABLE after recent changes)
    try {
      const result = await this.extractViaYtDlp(url);
      if (result.success) {
        console.log(`✓ Instagram extraction successful (${result.method})`);
        return result;
      }
    } catch (error) {
      console.log("yt-dlp method failed:", error.message);
    }

    // ✅ Try Method 2: oEmbed + HTML
    const oembedResult = await this.extractViaOEmbed(shortcode);
    if (oembedResult.success) {
      console.log(`✓ Instagram extraction successful (${oembedResult.method})`);
      return oembedResult;
    }

    // ✅ Try Method 3: Pure HTML scraping
    const htmlResult = await this.extractViaHTML(shortcode);
    if (htmlResult.success) {
      console.log(`✓ Instagram extraction successful (${htmlResult.method})`);
      return htmlResult;
    }

    // ✅ Try Method 4: CDN pattern (last resort)
    const cdnResult = await this.extractViaCDNPattern(shortcode);
    if (cdnResult.success) {
      console.log(`✓ Instagram extraction successful (${cdnResult.method})`);
      return cdnResult;
    }

    // All methods failed
    return {
      success: false,
      error:
        "Could not extract Instagram video. The post may be private, deleted, or Instagram has updated their system. Falling back to standard download method.",
    };
  }

  // Download the video file
  async downloadVideo(videoUrl, outputPath) {
    try {
      const response = await fetch(videoUrl, {
        headers: {
          "User-Agent": this.getRandomUserAgent(),
          Referer: "https://www.instagram.com/",
          Accept: "*/*",
          "Accept-Encoding": "identity",
          Range: "bytes=0-", // Request full file
        },
        timeout: 60000,
      });

      if (!response.ok) {
        throw new Error(`Download failed: ${response.status}`);
      }

      const fs = require("fs-extra");
      const buffer = await response.buffer();
      await fs.writeFile(outputPath, buffer);

      return {
        success: true,
        fileSize: buffer.length,
      };
    } catch (error) {
      console.error("Instagram video download failed:", error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  }
}

module.exports = new InstagramExtractor();
