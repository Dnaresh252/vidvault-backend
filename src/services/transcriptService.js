const { YoutubeTranscript } = require("youtube-transcript");

class TranscriptService {
  /**
   * Extract YouTube video ID from any URL format
   */
  extractVideoId(url) {
    // Test all possible YouTube URL formats
    const patterns = [
      /(?:youtube\.com\/watch\?v=)([^&\n?#]+)/, // youtube.com/watch?v=VIDEO_ID
      /(?:youtu\.be\/)([^&\n?#]+)/, // youtu.be/VIDEO_ID
      /(?:youtube\.com\/embed\/)([^&\n?#]+)/, // youtube.com/embed/VIDEO_ID
      /(?:youtube\.com\/v\/)([^&\n?#]+)/, // youtube.com/v/VIDEO_ID
      /(?:youtube\.com\/shorts\/)([^&\n?#]+)/, // youtube.com/shorts/VIDEO_ID
      /^([a-zA-Z0-9_-]{11})$/, // Just VIDEO_ID
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match && match[1]) {
        return match[1];
      }
    }

    return null;
  }

  /**
   * Main function: Get transcript
   */
  async getTranscript(url, language = "en") {
    try {
      // Step 1: Extract video ID
      const videoId = this.extractVideoId(url);

      if (!videoId) {
        return {
          success: false,
          error: "Invalid YouTube URL. Please check the URL and try again.",
          code: "INVALID_URL",
        };
      }

      console.log(`📝 Fetching transcript for: ${videoId}`);

      // Step 2: Fetch transcript from YouTube
      const transcript = await YoutubeTranscript.fetchTranscript(videoId, {
        lang: language,
        country: "US",
      });

      // Step 3: Check if transcript exists
      if (!transcript || transcript.length === 0) {
        return {
          success: false,
          error:
            "No transcript available. This video may not have captions enabled.",
          code: "NO_TRANSCRIPT",
          videoId: videoId,
        };
      }

      console.log(`✅ Transcript fetched: ${transcript.length} segments`);

      // Step 4: Return formatted data
      return {
        success: true,
        videoId: videoId,
        transcript: transcript,
        metadata: {
          totalSegments: transcript.length,
          totalDuration: this.calculateTotalDuration(transcript),
          language: language,
          estimatedWords: this.countWords(transcript),
        },
      };
    } catch (error) {
      console.error("❌ Transcript Error:", error.message);

      return {
        success: false,
        error: this.handleError(error),
        code: "FETCH_ERROR",
        details:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      };
    }
  }

  /**
   * Calculate total video duration from transcript
   */
  calculateTotalDuration(transcript) {
    if (!transcript || transcript.length === 0) return 0;

    const lastSegment = transcript[transcript.length - 1];
    const totalMs = lastSegment.offset + (lastSegment.duration || 0);
    return Math.floor(totalMs / 1000); // Convert to seconds
  }

  /**
   * Count total words in transcript
   */
  countWords(transcript) {
    return transcript.reduce((count, segment) => {
      return count + segment.text.split(" ").length;
    }, 0);
  }

  /**
   * Format timestamp for display (00:00 or 00:00:00)
   */
  formatTimestamp(milliseconds) {
    const totalSeconds = Math.floor(milliseconds / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, "0")}:${String(
        seconds
      ).padStart(2, "0")}`;
    }
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }

  /**
   * Format as plain text
   */
  formatAsText(transcript) {
    return transcript
      .map((segment) => {
        const time = this.formatTimestamp(segment.offset);
        return `[${time}] ${segment.text}`;
      })
      .join("\n\n");
  }

  /**
   * Format as SRT (subtitle file)
   */
  formatAsSRT(transcript) {
    return transcript
      .map((segment, index) => {
        const startTime = this.formatSRTTime(segment.offset);
        const endTime = this.formatSRTTime(
          segment.offset + (segment.duration || 0)
        );

        return `${index + 1}\n${startTime} --> ${endTime}\n${segment.text}\n`;
      })
      .join("\n");
  }

  /**
   * Format time for SRT (00:00:00,000)
   */
  formatSRTTime(milliseconds) {
    const totalSeconds = Math.floor(milliseconds / 1000);
    const ms = milliseconds % 1000;
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(
      2,
      "0"
    )}:${String(seconds).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
  }

  /**
   * Handle errors with user-friendly messages
   */
  handleError(error) {
    const errorMessage = error.message.toLowerCase();

    if (
      errorMessage.includes("could not retrieve") ||
      errorMessage.includes("transcript")
    ) {
      return "No captions available for this video. The creator may not have enabled subtitles.";
    }

    if (errorMessage.includes("private")) {
      return "Cannot access transcript for private videos.";
    }

    if (errorMessage.includes("unavailable")) {
      return "This video is unavailable or has been removed.";
    }

    if (errorMessage.includes("disabled")) {
      return "Transcripts are disabled for this video.";
    }

    return "Unable to fetch transcript. Please ensure the video has captions enabled.";
  }

  /**
   * Check if URL is YouTube
   */
  isYouTubeUrl(url) {
    return /(?:youtube\.com|youtu\.be)/.test(url);
  }
}

module.exports = new TranscriptService();
