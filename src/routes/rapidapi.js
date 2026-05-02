const express = require("express");
const router = express.Router();
const rapidApiAuth = require("../middleware/rapidApiAuth");
const instantMetadataService = require("../services/instantMetadataService");
const videoDownloader = require("../services/videoDownloader");

// Apply auth middleware to every route in this file
router.use(rapidApiAuth);

// ── Supported platforms ───────────────────────────────────────────────────────
const SUPPORTED_PLATFORMS = [
  {
    id: "youtube",
    name: "YouTube",
    domains: ["youtube.com", "youtu.be"],
    formats: ["mp4", "mp3", "webm"],
    qualities: ["highest", "high", "medium", "low"],
    maxQuality: "4K (2160p)",
    notes: "Supports videos, Shorts, live streams and playlists",
  },
  {
    id: "instagram",
    name: "Instagram",
    domains: ["instagram.com"],
    formats: ["mp4"],
    qualities: ["high", "medium", "low"],
    maxQuality: "1080p",
    notes: "Supports Reels, posts, stories and IGTV",
  },
  {
    id: "tiktok",
    name: "TikTok",
    domains: ["tiktok.com"],
    formats: ["mp4", "mp3"],
    qualities: ["high", "medium", "low"],
    maxQuality: "1080p",
    notes: "Downloads without watermark",
  },
  {
    id: "twitter",
    name: "Twitter/X",
    domains: ["twitter.com", "x.com"],
    formats: ["mp4"],
    qualities: ["high", "medium", "low"],
    maxQuality: "1080p",
    notes: "Supports videos and GIFs",
  },
  {
    id: "facebook",
    name: "Facebook",
    domains: ["facebook.com", "fb.watch"],
    formats: ["mp4"],
    qualities: ["high", "medium", "low"],
    maxQuality: "1080p",
    notes: "Supports videos, Reels and Watch videos",
  },
  {
    id: "reddit",
    name: "Reddit",
    domains: ["reddit.com", "v.redd.it"],
    formats: ["mp4"],
    qualities: ["high", "medium", "low"],
    maxQuality: "1080p",
    notes: "Downloads with audio merged",
  },
  {
    id: "vimeo",
    name: "Vimeo",
    domains: ["vimeo.com"],
    formats: ["mp4", "webm"],
    qualities: ["highest", "high", "medium", "low"],
    maxQuality: "4K (2160p)",
    notes: "Supports public videos",
  },
  {
    id: "linkedin",
    name: "LinkedIn",
    domains: ["linkedin.com"],
    formats: ["mp4"],
    qualities: ["high", "medium", "low"],
    maxQuality: "1080p",
    notes: "Supports public video posts",
  },
  {
    id: "threads",
    name: "Threads",
    domains: ["threads.net"],
    formats: ["mp4"],
    qualities: ["high", "medium", "low"],
    maxQuality: "1080p",
    notes: "Supports video posts",
  },
];

const VALID_QUALITIES = ["highest", "high", "medium", "low"];
const VALID_FORMATS = ["mp4", "mp3", "webm"];

// ── GET /api/v1/rapidapi/platforms ────────────────────────────────────────────
router.get("/platforms", (req, res) => {
  res.json({
    status: "success",
    count: SUPPORTED_PLATFORMS.length,
    platforms: SUPPORTED_PLATFORMS,
  });
});

// ── POST /api/v1/rapidapi/metadata ────────────────────────────────────────────
router.post("/metadata", async (req, res) => {
  const { url } = req.body;

  if (!url || typeof url !== "string" || !url.trim()) {
    return res.status(400).json({
      status: "error",
      message: "url is required",
    });
  }

  try {
    const result = await instantMetadataService.getInstantMetadata(url.trim());

    if (!result.success) {
      return res.status(422).json({
        status: "error",
        message: result.error || "Could not fetch metadata for this URL",
      });
    }

    const { data } = result;
    res.json({
      status: "success",
      cached: result.cached,
      data: {
        title: data.title,
        description: data.description || null,
        thumbnail: data.thumbnail || null,
        duration: data.duration || null,
        durationFormatted: data.durationFormatted || null,
        platform: data.platform,
        platformKey: data.platformKey,
        videoId: data.videoId || null,
        uploader: data.uploader || null,
        uploadDate: data.upload_date || null,
        viewCount: data.view_count || null,
      },
    });
  } catch (err) {
    console.error("[RapidAPI /metadata]", err.message);
    res.status(500).json({
      status: "error",
      message: "Failed to fetch video metadata",
    });
  }
});

// ── POST /api/v1/rapidapi/download ────────────────────────────────────────────
router.post("/download", async (req, res) => {
  const { url, quality = "medium", format = "mp4" } = req.body;

  if (!url || typeof url !== "string" || !url.trim()) {
    return res.status(400).json({
      status: "error",
      message: "url is required",
    });
  }

  if (!VALID_QUALITIES.includes(quality)) {
    return res.status(400).json({
      status: "error",
      message: `Invalid quality. Allowed values: ${VALID_QUALITIES.join(", ")}`,
    });
  }

  if (!VALID_FORMATS.includes(format)) {
    return res.status(400).json({
      status: "error",
      message: `Invalid format. Allowed values: ${VALID_FORMATS.join(", ")}`,
    });
  }

  try {
    const result = await videoDownloader.downloadVideoWithProgress({
      url: url.trim(),
      quality,
      format,
      audioOnly: format === "mp3",
    });

    if (!result.success) {
      const code = result.code;
      if (code === "SERVER_BUSY") {
        return res.status(503).json({ status: "error", message: result.error });
      }
      if (code === "FILE_TOO_LARGE") {
        return res.status(422).json({ status: "error", message: result.error });
      }
      return res.status(422).json({ status: "error", message: result.error });
    }

    const { data } = result;
    res.json({
      status: "success",
      cached: data.cached || false,
      data: {
        downloadUrl: data.downloadUrl,
        expiresAt: data.expiresAt,
        title: data.title,
        thumbnail: data.thumbnail || null,
        duration: data.duration || null,
        platform: data.platform,
        quality: data.quality,
        format: data.format,
        fileSize: data.fileSize || null,
      },
    });
  } catch (err) {
    console.error("[RapidAPI /download]", err.message);
    res.status(500).json({
      status: "error",
      message: err.message || "Download failed",
    });
  }
});

module.exports = router;
