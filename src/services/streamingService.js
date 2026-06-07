const { spawn } = require("child_process");
const { Upload } = require("@aws-sdk/lib-storage");
const { PassThrough } = require("stream");
const crypto = require("crypto");
const cacheService = require("./cacheService");

const JS_RUNTIME = process.platform === "win32" ? "node" : "node:/usr/local/bin/node";

// Quality to format ID mapping
const QUALITY_MAP = {
  highest: { video: "137", audio: "140", height: "1080" },
  high:    { video: "136", audio: "140", height: "720" },
  medium:  { video: "135", audio: "140", height: "480" },
  low:     { video: "18", audio: null,   height: "360" }, // pre-merged
};

const AUDIO_MAP = {
  mp3: { format: "140", ffmpegCodec: "libmp3lame", ext: "mp3" },
  m4a: { format: "140", ffmpegCodec: "copy",       ext: "m4a" },
};

class StreamingService {
  constructor() {
    this.activeStreams = new Map();
    this.r2Client = null;
    this.r2Working = false;
    console.log("✅ StreamingService initialized");
  }

  setR2Client(client, working) {
    this.r2Client = client;
    this.r2Working = working;
  }

  // Extract direct URLs from YouTube using yt-dlp
  async extractDirectUrls(url, quality, format, audioOnly) {
    return new Promise((resolve, reject) => {
      let formatStr;

      if (audioOnly || format === "mp3" || format === "m4a") {
        formatStr = "140/bestaudio";
      } else if (quality === "low") {
        formatStr = "18/best[height<=360]";
      } else {
        const q = QUALITY_MAP[quality] || QUALITY_MAP.high;
        formatStr = `${q.video}+${q.audio}/best[height<=${q.height}]`;
      }

      const proc = spawn("yt-dlp", [
        url,
        "--no-playlist",
        "--get-url",
        "-f", formatStr,
        "--socket-timeout", "15",
        "--extractor-args", "youtube:player_client=web,default",
        "--js-runtimes", JS_RUNTIME,
        "--cookies", "/tmp/cookies/youtube_cookies.txt",
        "--geo-bypass-country", "US",
        "--user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      ]);

      let output = "";
      let stderr = "";

      proc.stdout.on("data", d => { output += d.toString(); });
      proc.stderr.on("data", d => { stderr += d.toString(); });

      proc.on("close", code => {
        const urls = output.trim().split("\n").filter(Boolean);
        if (urls.length > 0 && urls[0].startsWith("http")) {
          return resolve({ videoUrl: urls[0], audioUrl: urls[1] || null, isMerged: urls.length === 1 });
        }
        if (code !== 0 || !output.trim()) {
          return reject(new Error("Failed to extract URLs: " + stderr.slice(0, 200)));
        }
      });

      proc.on("error", reject);
      setTimeout(() => { proc.kill(); reject(new Error("URL extraction timeout")); }, 60000);
    });
  }

  // Build FFmpeg args for muxing or passthrough
  buildFFmpegArgs(videoUrl, audioUrl, format, audioOnly) {
    const args = ["-hide_banner", "-loglevel", "error"];

    if (audioOnly || format === "mp3") {
      args.push("-i", videoUrl);
      args.push("-vn", "-c:a", "libmp3lame", "-q:a", "0");
      args.push("-f", "mp3");
    } else if (!audioUrl) {
      // Pre-merged (format 18) — just passthrough
      args.push("-i", videoUrl);
      args.push("-c", "copy");
      args.push("-f", "mp4", "-movflags", "frag_keyframe+empty_moov+faststart");
    } else if (format === "webm") {
      args.push("-i", videoUrl);
      if (audioUrl) args.push("-i", audioUrl);
      args.push("-c:v", "copy", "-c:a", "libopus");
      args.push("-f", "webm");
    } else {
      // Default mp4 mux
      args.push("-i", videoUrl);
      if (audioUrl) args.push("-i", audioUrl);
      args.push("-c", "copy");
      args.push("-f", "mp4", "-movflags", "frag_keyframe+empty_moov+faststart");
    }

    args.push("pipe:1"); // output to stdout
    return args;
  }

  // Main streaming method
  async streamToResponse(options) {
    const {
      url,
      quality = "high",
      format = "mp4",
      audioOnly = false,
      title = "video",
      res,
      onCached,
    } = options;

    // Hard block — reject videos over 1 hour
    try {
      const instantMetadataService = require('./instantMetadataService');
      const meta = await instantMetadataService.getInstantMetadata(url);
      if (meta?.data?.duration && meta.data.duration > 3600) {
        console.log(`🚫 Stream blocked — video too long: ${meta.data.duration}s`);
        if (!res.headersSent) {
          res.status(400).json({
            status: "error",
            message: "This video is too long. Maximum duration is 1 hour.",
            code: "VIDEO_TOO_LONG"
          });
        }
        return;
      }
      if (meta?.data?.is_live || meta?.data?.live_status === "is_live" || meta?.data?.duration === 0) {
        console.log(`🚫 Stream blocked — live stream`);
        if (!res.headersSent) {
          res.status(400).json({ status: "error", message: "Live streams cannot be downloaded.", code: "LIVE_STREAM" });
        }
        return;
      }
    } catch (e) {
      // metadata check failed — continue
    }

    const streamId = crypto.randomBytes(8).toString("hex");
    console.log(`🌊 [${streamId}] Starting mux stream: ${quality} ${format}`);

    try {
      // Step 1: Extract direct URLs
      console.log(`🔗 [${streamId}] Extracting direct URLs...`);
      const { videoUrl, audioUrl, isMerged } = await this.extractDirectUrls(
        url, quality, format, audioOnly
      );
      console.log(`✅ [${streamId}] URLs extracted. Merged: ${isMerged}`);

      // Step 2: Set response headers
      const ext = audioOnly || format === "mp3" ? "mp3" : "mp4";
      const contentType = ext === "mp3" ? "audio/mpeg" : "video/mp4";
      const safeTitle = title.replace(/[^a-z0-9\s-]/gi, "_").substring(0, 100);
      const filename = `${safeTitle}.${ext}`;

      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
      res.setHeader("Transfer-Encoding", "chunked");
      res.setHeader("X-Stream-Id", streamId);
      res.setHeader("Cache-Control", "no-cache");

      // Step 3: Start FFmpeg
      const ffmpegArgs = this.buildFFmpegArgs(videoUrl, audioUrl, format, audioOnly);
      console.log(`🎬 [${streamId}] Starting FFmpeg mux...`);
      const ffmpeg = spawn("ffmpeg", ffmpegArgs);

      this.activeStreams.set(streamId, { ffmpeg, startTime: Date.now() });

      // Auto-kill ffmpeg after 10 minutes max
      const maxTimer = setTimeout(() => {
        console.log(`⏰ [${streamId}] FFmpeg timeout — killing`);
        ffmpeg.kill("SIGKILL");
      }, 10 * 60 * 1000);

      ffmpeg.on("close", () => {
        clearTimeout(maxTimer);
      });

      // Step 4: Pipe to user + R2 simultaneously
      const passThrough = new PassThrough();
      ffmpeg.stdout.pipe(passThrough);

      // Pipe to user browser
      passThrough.pipe(res, { end: true });

      // Simultaneously upload to R2 (fire and forget)
      if (this.r2Client && this.r2Working && onCached) {
        const r2PassThrough = new PassThrough();
        ffmpeg.stdout.pipe(r2PassThrough);
        this._uploadToR2(r2PassThrough, url, quality, format, filename, contentType, streamId)
          .then(r2Url => {
            if (r2Url && onCached) onCached(r2Url);
          })
          .catch(err => console.error(`⚠️ [${streamId}] R2 upload failed (non-critical):`, err.message));
      }

      // Handle errors
      ffmpeg.stderr.on("data", d => {
        const msg = d.toString();
        if (msg.includes("Error") || msg.includes("error")) {
          console.error(`⚠️ [${streamId}] FFmpeg: ${msg.slice(0, 100)}`);
        }
      });

      // Handle completion
      await new Promise((resolve, reject) => {
        ffmpeg.on("close", code => {
          const streamData = this.activeStreams.get(streamId);
          const duration = ((Date.now() - (streamData?.startTime || Date.now())) / 1000).toFixed(1);
          this.activeStreams.delete(streamId);
          if (code === 0) {
            console.log(`✅ [${streamId}] Stream complete`);
            resolve();
          } else {
            reject(new Error(`FFmpeg exited with code ${code}`));
          }
        });
        ffmpeg.on("error", reject);
        res.on("close", () => {
          console.log(`📡 [${streamId}] Client disconnected — killing FFmpeg`);
          ffmpeg.kill("SIGKILL");
          this.activeStreams.delete(streamId);
          resolve();
        });
      });

    } catch (error) {
      this.activeStreams.delete(streamId);
      console.error(`❌ [${streamId}] Stream error:`, error.message);
      if (!res.headersSent) {
        res.status(500).json({ error: "Stream failed. Please try again." });
      }
      throw error;
    }
  }

  // Upload stream to R2 while streaming to user
  async _uploadToR2(stream, url, quality, format, filename, contentType, streamId) {
    try {
      const key = `downloads/${Date.now()}_${crypto.randomBytes(8).toString("hex")}_${filename}`;
      const upload = new Upload({
        client: this.r2Client,
        params: {
          Bucket: process.env.R2_BUCKET_NAME,
          Key: key,
          Body: stream,
          ContentType: contentType,
          ContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
          CacheControl: "public, max-age=21600",
        },
        queueSize: 4,
        partSize: 50 * 1024 * 1024,
        leavePartsOnError: false,
      });
      await upload.done();
      const r2Url = `https://downloads.vidvaults.com/${key}`;
      console.log(`☁️ [${streamId}] Cached to R2: ${r2Url.slice(0, 60)}`);
      // Cache in Redis for next users
      await cacheService.setR2Url(url, quality, format, r2Url, 0, 55 * 60); // 55 minutes
      return r2Url;
    } catch (err) {
      console.error(`⚠️ [${streamId}] R2 upload error:`, err.message);
      return null;
    }
  }

  getStats() {
    return {
      activeStreams: this.activeStreams.size,
    };
  }
}

module.exports = new StreamingService();
