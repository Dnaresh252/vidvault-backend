const mongoose = require("mongoose");

const telegramUserSchema = new mongoose.Schema({
  telegramId: {
    type: String,
    unique: true,
    required: true,
  },
  username: String,
  firstName: String,
  lastName: String,
  plan: {
    type: String,
    enum: ["free", "premium"],
    default: "free",
  },
  downloadsThisMonth: {
    type: Number,
    default: 0,
  },
  monthResetDate: {
    type: Date,
    default: () => {
      const now = new Date();
      return new Date(now.getFullYear(), now.getMonth() + 1, 1);
    },
  },
  totalDownloads: {
    type: Number,
    default: 0,
  },
  premiumStartDate: Date,
  premiumEndDate: Date,
  referralCode: {
    type: String,
    unique: true,
    sparse: true,
  },
  referredBy: String,
  referralCount: {
    type: Number,
    default: 0,
  },
  joinedAt: {
    type: Date,
    default: Date.now,
  },
  lastActive: {
    type: Date,
    default: Date.now,
  },
  language: {
    type: String,
    default: "en",
  },
  languageSelected: {
    type: Boolean,
    default: false,
  },
});

// Auto reset monthly downloads
telegramUserSchema.methods.checkAndResetMonthly = function () {
  const now = new Date();
  if (now >= this.monthResetDate) {
    this.downloadsThisMonth = 0;
    this.monthResetDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  }
};

// Check if premium is expired
telegramUserSchema.methods.checkPremiumStatus = function () {
  if (this.plan === "premium" && this.premiumEndDate) {
    if (new Date() > this.premiumEndDate) {
      this.plan = "free";
    }
  }
};

// Generate referral code
telegramUserSchema.methods.generateReferralCode = function () {
  if (!this.referralCode) {
    this.referralCode =
      "VV" +
      this.telegramId.slice(-4) +
      Math.random().toString(36).substring(2, 6).toUpperCase();
  }
};

module.exports = mongoose.model("TelegramUser", telegramUserSchema);
