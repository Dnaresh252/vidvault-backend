const Queue = require("bull");
const videoDownloader = require("../services/videoDownloader");

// Initialize Redis-based queue
const downloadQueue = new Queue("video-downloads", {
  redis: {
    host: process.env.REDIS_HOST || "localhost",
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
  },
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 5000,
    },
    removeOnComplete: 50,
    removeOnFail: 100,
  },
});

// Process download jobs - only 2 concurrent to prevent overload
downloadQueue.process(2, async (job) => {
  const { url, quality, format, audioOnly, userIP, userAgent, jobId } =
    job.data;

  console.log(`[Worker ${process.pid}] Processing job ${job.id}`);

  try {
    // Update progress - starting
    await job.progress(10);

    // Get metadata first for immediate feedback
    const metadata = await videoDownloader.getVideoMetadata(url);
    await job.progress(25);

    // Perform actual download
    const result = await videoDownloader.downloadVideo({
      url,
      quality,
      format,
      audioOnly,
      userIP,
      userAgent,
      skipMetadata: true, // Already got it
      metadata: metadata, // Pass it along
    });

    await job.progress(90);

    if (!result.success) {
      throw new Error(result.error);
    }

    await job.progress(100);

    return {
      success: true,
      data: {
        ...result.data,
        metadata: {
          title: metadata.title,
          thumbnail: metadata.thumbnail,
          duration: metadata.duration,
          uploader: metadata.uploader,
        },
      },
      message: result.message,
    };
  } catch (error) {
    console.error(`Job ${job.id} failed:`, error.message);
    throw error;
  }
});

// Event listeners for monitoring
downloadQueue.on("completed", (job, result) => {
  console.log(`Job ${job.id} completed successfully`);
});

downloadQueue.on("failed", (job, err) => {
  console.error(`Job ${job.id} failed:`, err.message);
});

downloadQueue.on("stalled", (job) => {
  console.warn(`Job ${job.id} stalled - will retry`);
});

downloadQueue.on("progress", (job, progress) => {
  console.log(`Job ${job.id} progress: ${progress}%`);
});

// Clean up function
downloadQueue.on("ready", () => {
  console.log("Download queue is ready");
});

// Export queue for use in controllers
module.exports = downloadQueue;
