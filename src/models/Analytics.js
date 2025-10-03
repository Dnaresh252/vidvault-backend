const mongoose = require("mongoose");

const analyticsSchema = new mongoose.Schema(
  {
    // Date for daily analytics
    date: {
      type: Date,
      required: true,
      index: true,
    },

    // Download statistics
    downloads: {
      total: { type: Number, default: 0 },
      successful: { type: Number, default: 0 },
      failed: { type: Number, default: 0 },
      byPlatform: {
        youtube: { type: Number, default: 0 },
        instagram: { type: Number, default: 0 },
        tiktok: { type: Number, default: 0 },
        twitter: { type: Number, default: 0 },
        facebook: { type: Number, default: 0 },
        other: { type: Number, default: 0 },
      },
      byQuality: {
        highest: { type: Number, default: 0 },
        high: { type: Number, default: 0 },
        medium: { type: Number, default: 0 },
        low: { type: Number, default: 0 },
      },
      byFormat: {
        mp4: { type: Number, default: 0 },
        mp3: { type: Number, default: 0 },
        webm: { type: Number, default: 0 },
        other: { type: Number, default: 0 },
      },
    },

    // Traffic statistics
    visitors: {
      unique: { type: Number, default: 0 },
      total: { type: Number, default: 0 },
      returning: { type: Number, default: 0 },
    },

    // Performance metrics
    performance: {
      averageDownloadTime: { type: Number, default: 0 },
      errorRate: { type: Number, default: 0 },
      popularUrls: [
        {
          url: String,
          count: Number,
        },
      ],
    },
  },
  {
    timestamps: true,
  }
);

// Ensure unique daily records
analyticsSchema.index({ date: 1 }, { unique: true });

module.exports = mongoose.model("Analytics", analyticsSchema);
