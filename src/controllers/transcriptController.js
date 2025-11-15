const transcriptService = require("../services/transcriptService");

/**
 * POST /api/v1/transcript
 * Get transcript for a YouTube video
 */
exports.getTranscript = async (req, res) => {
  try {
    const { url, language = "en", format = "json" } = req.body;

    // Validate URL
    if (!url || !url.trim()) {
      return res.status(400).json({
        status: "error",
        message: "URL is required",
      });
    }

    // Check if it's a YouTube URL
    if (!transcriptService.isYouTubeUrl(url)) {
      return res.status(400).json({
        status: "error",
        message:
          "Only YouTube videos are supported for transcripts. Instagram, TikTok, and other platforms do not provide caption data.",
        supportedPlatforms: ["YouTube", "YouTube Shorts"],
      });
    }

    console.log(`\n📝 Transcript Request:`);
    console.log(`   URL: ${url}`);
    console.log(`   Language: ${language}`);
    console.log(`   Format: ${format}`);

    // Fetch transcript
    const result = await transcriptService.getTranscript(url, language);

    if (!result.success) {
      return res.status(400).json({
        status: "error",
        message: result.error,
        code: result.code,
        videoId: result.videoId,
      });
    }

    // Format transcript
    let formattedTranscript = result.transcript;
    if (format === "text") {
      formattedTranscript = transcriptService.formatAsText(result.transcript);
    } else if (format === "srt") {
      formattedTranscript = transcriptService.formatAsSRT(result.transcript);
    }

    // Success response
    res.status(200).json({
      status: "success",
      data: {
        videoId: result.videoId,
        transcript: formattedTranscript,
        metadata: result.metadata,
        format: format,
      },
    });
  } catch (error) {
    console.error("❌ Controller Error:", error);
    res.status(500).json({
      status: "error",
      message: "An unexpected error occurred while fetching the transcript",
    });
  }
};

/**
 * GET /api/v1/transcript/download
 * Download transcript as file
 */
exports.downloadTranscript = async (req, res) => {
  try {
    const { url, language = "en", format = "txt" } = req.query;

    if (!url) {
      return res.status(400).json({
        status: "error",
        message: "URL is required",
      });
    }

    // Fetch transcript
    const result = await transcriptService.getTranscript(url, language);

    if (!result.success) {
      return res.status(400).json({
        status: "error",
        message: result.error,
      });
    }

    // Format based on requested type
    let content;
    let mimeType;
    let extension;

    if (format === "srt") {
      content = transcriptService.formatAsSRT(result.transcript);
      mimeType = "application/x-subrip";
      extension = "srt";
    } else {
      content = transcriptService.formatAsText(result.transcript);
      mimeType = "text/plain";
      extension = "txt";
    }

    // Set download headers
    const filename = `transcript_${result.videoId}.${extension}`;
    res.setHeader("Content-Type", mimeType);
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(content);
  } catch (error) {
    console.error("❌ Download Error:", error);
    res.status(500).json({
      status: "error",
      message: "Failed to download transcript",
    });
  }
};
