/**
 * Streaming Response Middleware
 * Sends progress updates to users in real-time
 * Makes downloads feel instant even if they take a few seconds
 */

class StreamingResponse {
  // Send immediate acknowledgment to user
  static sendInstantAck(res, data) {
    // Set headers for streaming
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Transfer-Encoding", "chunked");
    res.setHeader("X-Accel-Buffering", "no"); // Disable nginx buffering

    // Send immediate response
    const ack = {
      status: "processing",
      message: "Download started! Getting your video...",
      requestId: data.requestId,
      estimatedTime: "3-5 seconds",
      timestamp: new Date().toISOString(),
    };

    return ack;
  }

  // Send progress update
  static sendProgress(progressData) {
    return {
      status: "progress",
      progress: progressData.percentage || 0,
      message: progressData.message,
      step: progressData.step,
      timestamp: new Date().toISOString(),
    };
  }

  // Send final result
  static sendComplete(result) {
    return {
      status: "success",
      message: "Video ready for download!",
      data: result,
      timestamp: new Date().toISOString(),
    };
  }

  // Send error
  static sendError(error) {
    return {
      status: "error",
      message: error.message || "Download failed",
      code: error.code,
      timestamp: new Date().toISOString(),
    };
  }
}

module.exports = StreamingResponse;
