const https = require("https");

// ═══════════════════════════════════════════════════════════
//  INSTAGRAM OEMBED SERVICE
//  Official Meta API — free, never expires, no cookies needed
//  Works for all public posts, reels, videos
// ═══════════════════════════════════════════════════════════

const APP_ID     = process.env.META_APP_ID     || "1844281683215496";
const APP_SECRET = process.env.META_APP_SECRET || "";

// Access token = App ID|App Secret (client credentials)
function getAccessToken() {
  return `${APP_ID}|${APP_SECRET}`;
}

// ─── Fetch from Meta oEmbed API ───────────────────────────
function fetchOembed(instagramUrl) {
  return new Promise((resolve, reject) => {
    const token   = getAccessToken();
    const encoded = encodeURIComponent(instagramUrl);
    const path    = `/v18.0/instagram_oembed?url=${encoded}&access_token=${token}&fields=thumbnail_url,title,html,author_name,provider_name`;

    const options = {
      hostname: "graph.facebook.com",
      path,
      method:  "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
        "Accept":     "application/json",
      },
      timeout: 10000,
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            reject(new Error(`oEmbed API error: ${parsed.error.message}`));
          } else {
            resolve(parsed);
          }
        } catch (e) {
          reject(new Error("Failed to parse oEmbed response"));
        }
      });
    });

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("oEmbed request timed out"));
    });

    req.end();
  });
}

// ─── Extract video/image URL from oEmbed HTML ─────────────
function extractMediaUrl(html) {
  if (!html) return null;

  // Try video src
  const videoMatch = html.match(/src="(https:\/\/[^"]+\.mp4[^"]*)"/i)
    || html.match(/src='(https:\/\/[^']+\.mp4[^']*)'/i)
    || html.match(/"video_url":"([^"]+)"/i)
    || html.match(/data-video-url="([^"]+)"/i);

  if (videoMatch) return decodeURIComponent(videoMatch[1].replace(/\\u0026/g, "&"));

  // Try CDN image
  const imgMatch = html.match(/src="(https:\/\/scontent[^"]+)"/i)
    || html.match(/src='(https:\/\/scontent[^']+)'/i);

  if (imgMatch) return decodeURIComponent(imgMatch[1].replace(/\\u0026/g, "&"));

  return null;
}

// ─── Main: Get Instagram metadata via oEmbed ──────────────
async function getInstagramData(url) {
  try {
    console.log(`📘 [oEmbed] Fetching Instagram data for: ${url}`);

    const data = await fetchOembed(url);

    const result = {
      success:      true,
      method:       "oembed",
      title:        data.title       || data.author_name || "Instagram Video",
      author:       data.author_name || "instagram",
      thumbnail:    data.thumbnail_url || null,
      mediaUrl:     extractMediaUrl(data.html),
      html:         data.html        || null,
      platform:     "Instagram",
    };

    console.log(`✅ [oEmbed] Success — author: ${result.author} | hasMedia: ${!!result.mediaUrl}`);
    return result;

  } catch (error) {
    console.log(`⚠️  [oEmbed] Failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}

module.exports = { getInstagramData };
