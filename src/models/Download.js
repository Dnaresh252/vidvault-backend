const mongoose = require("mongoose");

const downloadSchema = new mongoose.Schema(
  {
    // Basic download info
    originalUrl: {
      type: String,
      required: true,
      trim: true,
    },
    platform: {
      type: String,
      required: true,
      enum: [
        "youtube",
        "instagram",
        "tiktok",
        "twitter",
        "facebook",
        "linkedin",
        "reddit",
        "vimeo",
        "other",
      ],
    },
    videoId: {
      type: String,
      required: true,
    },

    // Video metadata
    title: {
      type: String,
      trim: true,
      maxlength: 300,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 2000,
    },
    thumbnail: {
      type: String,
      trim: true,
    },
    duration: {
      type: Number,
      min: 0,
    },
    viewCount: {
      type: Number,
      min: 0,
    },
    uploadDate: {
      type: Date,
    },

    // Creator info
    creator: {
      name: {
        type: String,
        trim: true,
        maxlength: 100,
      },
      username: {
        type: String,
        trim: true,
        maxlength: 50,
      },
      verified: {
        type: Boolean,
        default: false,
      },
    },

    // Download specifications
    requestedQuality: {
      type: String,
      enum: [
        "highest",
        "high",
        "medium",
        "low",
        "1080p",
        "720p",
        "480p",
        "360p",
      ],
      default: "high",
    },
    requestedFormat: {
      type: String,
      enum: ["mp4", "mp3", "webm", "wav", "flac"],
      default: "mp4",
    },
    actualQuality: String,
    actualFormat: String,
    fileSize: {
      type: Number,
      min: 0,
    },

    // Processing info
    status: {
      type: String,
      enum: ["pending", "processing", "completed", "failed", "expired"],
      default: "pending",
    },
    processingStartTime: Date,
    processingEndTime: Date,

    // Download info
    downloadUrl: String,
    downloadExpires: {
      type: Date,
      default: function () {
        return new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
      },
    },
    downloadCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Anonymous tracking (no personal data)
    userIP: String, // Hashed for privacy
    userAgent: String,

    // Error info
    error: {
      message: String,
      code: String,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for performance
downloadSchema.index({ platform: 1, createdAt: -1 });
downloadSchema.index({ status: 1 });
downloadSchema.index({ downloadExpires: 1 });
downloadSchema.index({ originalUrl: 1 });
downloadSchema.index({ userIP: 1, createdAt: -1 });

// Virtual for checking if download has expired
downloadSchema.virtual("isExpired").get(function () {
  return this.downloadExpires < new Date();
});

// Method to increment download count
downloadSchema.methods.markAsDownloaded = async function () {
  this.downloadCount += 1;
  this.lastDownloadedAt = new Date();
  await this.save();
};

// Static method to clean expired downloads
downloadSchema.statics.cleanExpired = function () {
  return this.deleteMany({
    downloadExpires: { $lt: new Date() },
    status: { $in: ["completed", "failed"] },
  });
};

module.exports = mongoose.model("Download", downloadSchema);
