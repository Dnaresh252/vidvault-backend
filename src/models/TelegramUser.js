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
  // Bonus downloads from coupons/referrals
  bonusDownloads: {
    type: Number,
    default: 0,
  },
  // Track which coupons user has already redeemed (one use per user)
  usedCoupons: {
    type: [String],
    default: [],
  },
  // ─── Streak tracking ────────────────────────────────────────────────
  currentStreak:    { type: Number, default: 0 },
  longestStreak:    { type: Number, default: 0 },
  lastStreakDate:   { type: Date },              // UTC midnight of last streak day
  streakMilestones: { type: [String], default: [] }, // ["streak_3", "streak_7", "streak_30", "streak_100"]
  // ─── Broadcast management ───────────────────────────────────────────
  blocked:           { type: Boolean, default: false }, // true = user blocked the bot
  lastBroadcastDate: { type: Date },                    // last time any broadcast was sent
  // ─── 4K taste ───────────────────────────────────────────────────────
  hasUsed4KTaste: { type: Boolean, default: false },    // one-time free 4K download
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

// ─── Performance indexes ─────────────────────────────────────────────────────
// Broadcast: plan + blocked + lastBroadcastDate (all 3 in every broadcast query)
telegramUserSchema.index({ plan: 1, blocked: 1, lastBroadcastDate: 1 });
// Win-back broadcast: lastActive + totalDownloads
telegramUserSchema.index({ lastActive: -1, totalDownloads: 1 });
// Gift lookup by @username (case-insensitive regex query)
telegramUserSchema.index({ username: 1 });
// Premium expiry reminders
telegramUserSchema.index({ premiumEndDate: 1, plan: 1 });

module.exports = mongoose.model("TelegramUser", telegramUserSchema);
