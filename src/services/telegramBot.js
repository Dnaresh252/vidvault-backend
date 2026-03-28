const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const TelegramUser = require("../models/TelegramUser");
const { t, getLanguageKeyboard, detectLang } = require("./botTranslations");

// ─── Constants ────────────────────────────────────────────
const TOKEN         = process.env.TELEGRAM_BOT_TOKEN;
const PAYMENT_LINK  = process.env.RAZORPAY_PAYMENT_LINK;
const API_URL       = process.env.API_URL || "https://api.vidvaults.com";
const BOT_USERNAME  = "VidVaultFreeBot";
const FREE_LIMIT    = 5;
const RATE_LIMIT_SECONDS = 10;

// ─── In-memory state ──────────────────────────────────────
const activeUsers     = new Map(); // userId → true (currently downloading)
const rateLimiter     = new Map(); // userId → lastRequestTimestamp
const pendingDownloads = new Map(); // userId → { url, chatId, timestamp }

// Auto-clean pending downloads older than 10 minutes
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [key, val] of pendingDownloads) {
    if (val.timestamp < cutoff) pendingDownloads.delete(key);
  }
}, 60 * 1000);

// ─── Initialize bot ───────────────────────────────────────
const bot = new TelegramBot(TOKEN, { polling: true });
console.log("🤖 VidVault Telegram Bot starting...");

// ═══════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════

// Escape ALL MarkdownV2 special characters
function esc(text) {
  if (!text) return "";
  return String(text).replace(/[_*[\]()~`>#+=|{}.!\-\\]/g, "\\$&");
}

// Escape URL for MarkdownV2 — keeps it clickable, safe to embed in text
function escUrl(url) {
  if (!url) return "";
  return String(url).replace(/[_*[\]()~`>#+=|{}.!\-\\]/g, "\\$&");
}

function formatSize(bytes) {
  if (!bytes) return "Unknown size";
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function daysUntilReset(resetDate) {
  const diff = new Date(resetDate) - new Date();
  return Math.max(1, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

function formatDuration(seconds) {
  if (!seconds) return null;
  const m = Math.floor(seconds / 60);
  const s = String(seconds % 60).padStart(2, "0");
  return `${m}:${s}`;
}

function isRateLimited(userId) {
  const last = rateLimiter.get(userId);
  if (last && Date.now() - last < RATE_LIMIT_SECONDS * 1000) return true;
  rateLimiter.set(userId, Date.now());
  return false;
}

function isVideoURL(text) {
  if (!text) return false;
  try {
    new URL(text);
    return ["youtube", "youtu.be", "instagram", "tiktok", "twitter",
      "x.com", "facebook", "fb.watch", "reddit", "vimeo"].some(d => text.includes(d));
  } catch { return false; }
}

// Get or create user — always runs monthly reset + premium expiry check
async function getUser(msg) {
  const telegramId = msg.from.id.toString();
  let user = await TelegramUser.findOne({ telegramId });
  if (!user) {
    user = new TelegramUser({
      telegramId,
      username: msg.from.username,
      firstName: msg.from.first_name,
      lastName: msg.from.last_name,
    });
    user.generateReferralCode();
  }
  user.checkAndResetMonthly();
  user.checkPremiumStatus();
  user.lastActive = new Date();
  await user.save();
  return user;
}

// Create dynamic Razorpay payment link per user (telegram_id in notes)
// Falls back to static link if API keys not configured
async function createPaymentLink(user) {
  const keyId     = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret || keyId === "your_razorpay_key_id") return PAYMENT_LINK;
  try {
    const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
    const res  = await axios.post(
      "https://api.razorpay.com/v1/payment_links",
      {
        amount: 2900,
        currency: "INR",
        description: "VidVault Premium — 1 Month Unlimited Downloads",
        notes: {
          telegram_id: user.telegramId,
          username: user.username || user.firstName || "user",
        },
        reminder_enable: false,
        expire_by: Math.floor(Date.now() / 1000) + 3600, // link expires in 1hr
      },
      { headers: { Authorization: `Basic ${auth}` }, timeout: 5000 }
    );
    return res.data.short_url;
  } catch (err) {
    console.error("Razorpay link creation failed:", err.message);
    return PAYMENT_LINK;
  }
}

// Fetch instant metadata (title, thumbnail, duration, platform)
async function fetchMetadata(url) {
  try {
    const res = await axios.get(
      `${API_URL}/api/v1/instant/metadata?url=${encodeURIComponent(url)}`,
      { timeout: 15000 }
    );
    return res.data?.data || res.data || null;
  } catch {
    return null;
  }
}

// Inline keyboard — free users see locked premium buttons (FOMO)
function getQualityKeyboard(isPremium) {
  if (isPremium) {
    return {
      inline_keyboard: [
        [
          { text: "📱 480p",       callback_data: "q_480p"    },
          { text: "🎬 720p HD",    callback_data: "q_720p"    },
        ],
        [
          { text: "✨ 1080p FHD",  callback_data: "q_1080p"   },
          { text: "👑 4K Ultra",   callback_data: "q_4k"      },
        ],
        [
          { text: "🎵 MP3 128k",   callback_data: "q_mp3_128" },
          { text: "🎵 MP3 320k HQ",callback_data: "q_mp3_320" },
        ],
      ],
    };
  }
  return {
    inline_keyboard: [
      [
        { text: "📱 480p — Free",       callback_data: "q_480p"    },
        { text: "🎬 720p — Free",       callback_data: "q_720p"    },
      ],
      [
        { text: "🔒 1080p — Premium",   callback_data: "locked"    },
        { text: "🔒 4K — Premium",      callback_data: "locked"    },
      ],
      [
        { text: "🎵 MP3 128k — Free",   callback_data: "q_mp3_128" },
        { text: "🔒 MP3 320k — Premium",callback_data: "locked"    },
      ],
    ],
  };
}

// Map callback_data to API quality params
function qualityToParams(data) {
  const map = {
    q_480p:    { quality: "low",     format: "mp4", label: "480p"      },
    q_720p:    { quality: "medium",  format: "mp4", label: "720p HD"   },
    q_1080p:   { quality: "high",    format: "mp4", label: "1080p FHD" },
    q_4k:      { quality: "highest", format: "mp4", label: "4K Ultra"  },
    q_mp3_128: { quality: "medium",  format: "mp3", label: "MP3 128k"  },
    q_mp3_320: { quality: "high",    format: "mp3", label: "MP3 320k"  },
  };
  return map[data] || null;
}

// Psychology nudge after download — only when needed, payment link pre-generated
function getUpgradeNudge(downloadsUsed, paymentLink) {
  if (downloadsUsed === 3) {
    return (
      `\n━━━━━━━━━━━━━━━━━━━━\n` +
      `⚡ *You've used 3 of 5 free downloads*\n` +
      `Premium users never count downloads 😎\n` +
      `*₹29/month → Unlimited forever*\n` +
      `/premium to upgrade`
    );
  }
  if (downloadsUsed === 4) {
    return (
      `\n━━━━━━━━━━━━━━━━━━━━\n` +
      `🔥 *Last free download used this month\\!*\n` +
      `You clearly love VidVault 🎬\n` +
      `Join Premium for just *₹1/day*\n` +
      `👉 ${escUrl(paymentLink)}`
    );
  }
  return "";
}

// ═══════════════════════════════════════════════════════════
//  /start
// ═══════════════════════════════════════════════════════════
bot.onText(/\/start(.*)/, async (msg, match) => {
  const chatId = msg.chat.id;
  try {
    const user      = await getUser(msg);
    const firstName = esc(msg.from.first_name || "there");
    const lang      = user.language || "en";

    // Handle referral code from start param
    const referralCode = match[1]?.trim();
    if (referralCode && referralCode !== user.referralCode) {
      const referrer = await TelegramUser.findOne({ referralCode });
      if (referrer && !user.referredBy) {
        user.referredBy = referralCode;
        referrer.referralCount += 1;
        referrer.downloadsThisMonth = Math.max(0, referrer.downloadsThisMonth - 2);

        if (referrer.referralCount >= 10 && referrer.plan === "free") {
          referrer.plan             = "premium";
          referrer.premiumStartDate = new Date();
          referrer.premiumEndDate   = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
          await referrer.save();
          await bot.sendMessage(
            referrer.telegramId,
            `🎉 *CONGRATULATIONS\\!*\n\n` +
            `You referred 10 friends and unlocked *1 Month Premium FREE\\!* 🎁\n\n` +
            `✅ Unlimited downloads activated\n` +
            `✅ Valid for 30 days\n\n` +
            `Thank you for growing VidVault\\! 🙏`,
            { parse_mode: "MarkdownV2" }
          );
        } else {
          await referrer.save();
          const left = 10 - referrer.referralCount;
          await bot.sendMessage(
            referrer.telegramId,
            `🎉 *Someone joined using your referral\\!*\n\n` +
            `You got *\\+2 bonus downloads* this month\\!\n` +
            `Total referrals: *${referrer.referralCount}/10*\n\n` +
            `*${left} more* to unlock 1 month Premium FREE\\! 🎁`,
            { parse_mode: "MarkdownV2" }
          );
        }
        await user.save();
      }
    }

    // ── NEW USER: show language picker first ──────────────
    const isNewUser = user.totalDownloads === 0 && !user.languageSelected;
    if (isNewUser) {
      // Auto-detect from Telegram language_code
      const detected = detectLang(msg.from.language_code);
      if (detected && detected !== "en") {
        // Auto-set detected language, skip picker
        user.language         = detected;
        user.languageSelected = true;
        await user.save();
        await bot.sendMessage(
          chatId,
          t(detected, "languageSet"),
          { parse_mode: "MarkdownV2" }
        );
        await bot.sendMessage(
          chatId,
          t(detected, "welcome", { name: firstName, isReturning: false, limit: FREE_LIMIT }),
          { parse_mode: "MarkdownV2" }
        );
      } else {
        // Show full language picker
        await bot.sendMessage(
          chatId,
          t("en", "chooseLanguage"),
          { parse_mode: "MarkdownV2", reply_markup: getLanguageKeyboard() }
        );
      }
      return;
    }

    // ── RETURNING USER: welcome in their language ─────────
    const isReturning = user.totalDownloads > 0;
    await bot.sendMessage(
      chatId,
      t(lang, "welcome", { name: firstName, isReturning, limit: FREE_LIMIT }),
      { parse_mode: "MarkdownV2" }
    );
  } catch (err) {
    console.error("Start error:", err);
  }
});

// ═══════════════════════════════════════════════════════════
//  /status
// ═══════════════════════════════════════════════════════════
bot.onText(/\/status/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    const user      = await getUser(msg);
    const isPremium = user.plan === "premium";
    const remaining = isPremium ? "∞" : Math.max(0, FREE_LIMIT - user.downloadsThisMonth);
    const days      = daysUntilReset(user.monthResetDate);

    await bot.sendMessage(
      chatId,
      `📊 *Your VidVault Account*\n\n` +
      `👤 Plan: *${isPremium ? "⭐ Premium" : "🆓 Free"}*\n` +
      `📥 Used this month: *${user.downloadsThisMonth}*\n` +
      `✅ Remaining: *${remaining}*\n` +
      `🔄 Resets in: *${days} days*\n` +
      `📈 Total downloads: *${user.totalDownloads}*\n\n` +
      `🎁 Referral code: *${esc(user.referralCode)}*\n` +
      `👥 Friends referred: *${user.referralCount}/10*\n\n` +
      `${isPremium
        ? `✨ You're on Premium — enjoy unlimited downloads\\!`
        : `💡 Upgrade for ₹29/month — type /premium`
      }`,
      { parse_mode: "MarkdownV2" }
    );
  } catch (err) {
    console.error("Status error:", err);
  }
});

// ═══════════════════════════════════════════════════════════
//  /premium
// ═══════════════════════════════════════════════════════════
bot.onText(/\/premium/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    const user = await getUser(msg);

    if (user.plan === "premium") {
      const days = daysUntilReset(user.premiumEndDate || user.monthResetDate);
      await bot.sendMessage(
        chatId,
        `⭐ *You're already Premium\\!*\n\n` +
        `✅ Unlimited downloads active\n` +
        `✅ 1080p \\+ 4K quality\n` +
        `✅ Priority speed\n` +
        `✅ Valid for *${days} more days*\n\n` +
        `Keep downloading — you're a VIP\\! 🎬`,
        { parse_mode: "MarkdownV2" }
      );
      return;
    }

    const paymentLink = await createPaymentLink(user);

    await bot.sendMessage(
      chatId,
      `⭐ *VidVault Premium*\n\n` +
      `_Join 1,000\\+ users who never worry about limits_\n\n` +
      `✅ *Unlimited* downloads/month\n` +
      `✅ *1080p \\+ 4K* quality\n` +
      `✅ *2x faster* processing\n` +
      `✅ *Priority* queue\n` +
      `✅ *All* 25\\+ platforms\n` +
      `✅ *Auto\\-renews* — cancel anytime\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `💰 *Only ₹29/month*\n` +
      `That's just *₹1/day* — less than one chai ☕\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `👇 *Pay instantly — activates in seconds:*\n` +
      `${escUrl(paymentLink)}\n\n` +
      `_Secure payment via Razorpay • UPI • PhonePe • GPay_`,
      { parse_mode: "MarkdownV2" }
    );
  } catch (err) {
    console.error("Premium error:", err);
  }
});

// ═══════════════════════════════════════════════════════════
//  /referral
// ═══════════════════════════════════════════════════════════
bot.onText(/\/referral/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    const user         = await getUser(msg);
    const referralLink = `https://t.me/${BOT_USERNAME}?start=${user.referralCode}`;
    const progress     = Math.min(user.referralCount, 10);
    const progressBar  = "▓".repeat(progress) + "░".repeat(10 - progress);

    await bot.sendMessage(
      chatId,
      `🎁 *Your Referral Program*\n\n` +
      `Share your link and earn free Premium\\!\n\n` +
      `🔗 *Your link:*\n${escUrl(referralLink)}\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🎯 *Rewards:*\n` +
      `• Every friend = *\\+2 bonus downloads*\n` +
      `• 10 friends = *1 month Premium FREE* 🎉\n\n` +
      `📊 *Your progress:*\n` +
      `${progressBar} ${user.referralCount}/10\n\n` +
      `${user.referralCount < 10
        ? `🎯 *${10 - user.referralCount} more* to unlock free Premium\\!`
        : `🏆 *Goal reached\\! You earned free Premium\\!*`
      }\n\n` +
      `_Share on WhatsApp, Instagram & more\\!_`,
      { parse_mode: "MarkdownV2" }
    );
  } catch (err) {
    console.error("Referral error:", err);
  }
});

// ═══════════════════════════════════════════════════════════
//  /help
// ═══════════════════════════════════════════════════════════
bot.onText(/\/help/, async (msg) => {
  const chatId = msg.chat.id;
  await bot.sendMessage(
    chatId,
    `📖 *VidVault Help*\n\n` +
    `*How to download:*\n` +
    `1️⃣ Copy any video link\n` +
    `2️⃣ Paste it here\n` +
    `3️⃣ Pick your quality\n` +
    `4️⃣ Download in seconds\\!\n\n` +
    `*Supported:*\n` +
    `YouTube, Instagram, TikTok, Twitter,\n` +
    `Facebook, Reddit, Vimeo & 20\\+ more\n\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `*Commands:*\n` +
    `/start — Welcome\n` +
    `/status — Your account\n` +
    `/premium — Upgrade\n` +
    `/referral — Earn free downloads\n` +
    `/language — Change language 🌍\n` +
    `/help — This message\n` +
    `/support — Contact us\n\n` +
    `🌐 vidvaults\\.com`,
    { parse_mode: "MarkdownV2" }
  );
});

// ═══════════════════════════════════════════════════════════
//  /support
// ═══════════════════════════════════════════════════════════
bot.onText(/\/support/, async (msg) => {
  const chatId = msg.chat.id;
  await bot.sendMessage(
    chatId,
    `💬 *VidVault Support*\n\n` +
    `🌐 Website: vidvaults\\.com\n` +
    `📧 Email: support@vidvaults\\.com\n\n` +
    `*Common issues:*\n` +
    `• Private video → Cannot download\n` +
    `• Age restricted → Cannot download\n` +
    `• Slow → Try again in 30 seconds\n` +
    `• Not working → Try vidvaults\\.com\n\n` +
    `_Describe your issue and we'll help\\!_`,
    { parse_mode: "MarkdownV2" }
  );
});

// ═══════════════════════════════════════════════════════════
//  /language  — change language anytime
// ═══════════════════════════════════════════════════════════
bot.onText(/\/language/, async (msg) => {
  const chatId = msg.chat.id;
  const user   = await getUser(msg);
  const lang   = user.language || "en";
  await bot.sendMessage(
    chatId,
    t(lang, "chooseLanguage"),
    { parse_mode: "MarkdownV2", reply_markup: getLanguageKeyboard() }
  );
});

// ═══════════════════════════════════════════════════════════
//  /stats  (admin only)
// ═══════════════════════════════════════════════════════════
bot.onText(/\/stats/, async (msg) => {
  if (msg.from.id.toString() !== process.env.TELEGRAM_ADMIN_ID) return;
  try {
    const now       = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekAgo   = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      totalUsers,
      activeToday,
      activeWeek,
      premiumUsers,
      newToday,
      newThisMonth,
    ] = await Promise.all([
      TelegramUser.countDocuments(),
      TelegramUser.countDocuments({ lastActive: { $gte: todayStart } }),
      TelegramUser.countDocuments({ lastActive: { $gte: weekAgo } }),
      TelegramUser.countDocuments({ plan: "premium" }),
      TelegramUser.countDocuments({ joinedAt: { $gte: todayStart } }),
      TelegramUser.countDocuments({ joinedAt: { $gte: monthStart } }),
    ]);

    const revenue = premiumUsers * 29;

    await bot.sendMessage(
      msg.chat.id,
      `📊 *VidVault Live Stats*\n\n` +
      `👥 *Users*\n` +
      `• Total: *${totalUsers}*\n` +
      `• Active today: *${activeToday}*\n` +
      `• Active this week: *${activeWeek}*\n` +
      `• New today: *${newToday}*\n` +
      `• New this month: *${newThisMonth}*\n\n` +
      `⭐ *Premium*\n` +
      `• Premium users: *${premiumUsers}*\n` +
      `• Monthly revenue: *₹${revenue}*\n\n` +
      `📈 *Conversion rate:* *${totalUsers > 0 ? ((premiumUsers / totalUsers) * 100).toFixed(1) : 0}%*`,
      { parse_mode: "MarkdownV2" }
    );
  } catch (err) {
    console.error("Stats error:", err);
    await bot.sendMessage(msg.chat.id, "❌ Failed to fetch stats");
  }
});

// ═══════════════════════════════════════════════════════════
//  /activate  (admin only)
// ═══════════════════════════════════════════════════════════
bot.onText(/\/activate (.+)/, async (msg, match) => {
  if (msg.from.id.toString() !== process.env.TELEGRAM_ADMIN_ID) return;
  const targetId = match[1].trim();
  try {
    const user = await TelegramUser.findOne({ telegramId: targetId });
    if (!user) {
      await bot.sendMessage(msg.chat.id, `❌ User ${targetId} not found`);
      return;
    }
    user.plan             = "premium";
    user.premiumStartDate = new Date();
    user.premiumEndDate   = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await user.save();

    await bot.sendMessage(msg.chat.id, `✅ Premium activated for ${targetId}`);
    await bot.sendMessage(
      targetId,
      `🎉 *Premium Activated\\!*\n\n` +
      `Welcome to VidVault Premium\\! ⭐\n\n` +
      `✅ Unlimited downloads\n` +
      `✅ 1080p \\+ 4K quality\n` +
      `✅ Priority speed\n` +
      `✅ Valid for 30 days\n\n` +
      `Just send any video link to start\\! 🎬`,
      { parse_mode: "MarkdownV2" }
    );
  } catch (err) {
    console.error("Activate error:", err);
  }
});

// ═══════════════════════════════════════════════════════════
//  MESSAGE HANDLER — URL → metadata preview → quality keyboard
// ═══════════════════════════════════════════════════════════
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text   = msg.text?.trim();
  if (!text || text.startsWith("/")) return;

  try {
    const user   = await getUser(msg);
    const userId = user.telegramId;

    // ── Video URL ─────────────────────────────────────────
    if (isVideoURL(text)) {

      if (isRateLimited(userId)) {
        await bot.sendMessage(chatId,
          t(user.language, "rateLimited", { sec: RATE_LIMIT_SECONDS }),
          { parse_mode: "MarkdownV2" }
        );
        return;
      }

      if (activeUsers.has(userId)) {
        await bot.sendMessage(chatId,
          t(user.language, "alreadyDownloading"),
          { parse_mode: "MarkdownV2" }
        );
        return;
      }

      // Hard limit check — show upgrade wall
      if (user.plan === "free" && user.downloadsThisMonth >= FREE_LIMIT) {
        const days        = daysUntilReset(user.monthResetDate);
        const paymentLink = await createPaymentLink(user);
        await bot.sendMessage(
          chatId,
          t(user.language, "limitReached", {
            total: user.totalDownloads,
            days,
            link: escUrl(paymentLink),
          }),
          {
            parse_mode: "MarkdownV2",
            reply_markup: {
              inline_keyboard: [[
                { text: "⭐ Upgrade Now — ₹29/month", callback_data: "upgrade" }
              ]]
            }
          }
        );
        return;
      }

      // Show loading while fetching metadata
      const loadingMsg = await bot.sendMessage(chatId,
        t(user.language, "fetching"),
        { parse_mode: "MarkdownV2" }
      );

      const meta     = await fetchMetadata(text);
      const title    = meta?.title || "Video";
      const duration = formatDuration(meta?.duration);
      const platform = meta?.platform || "Video";
      const thumb    = meta?.thumbnail;

      // Store URL for when user taps quality button
      pendingDownloads.set(userId, { url: text, chatId, timestamp: Date.now() });

      try { await bot.deleteMessage(chatId, loadingMsg.message_id); } catch {}

      const isPremium = user.plan === "premium";
      const remaining = FREE_LIMIT - user.downloadsThisMonth;

      const caption =
        `🎬 *${esc(title)}*\n\n` +
        `🌐 Platform: ${esc(platform)}` +
        `${duration ? `  •  ⏱ ${esc(duration)}` : ""}\n\n` +
        `${isPremium
          ? `⭐ *Premium* — All qualities unlocked`
          : `🆓 *Free* — ${remaining} download${remaining !== 1 ? "s" : ""} left this month`
        }\n\n` +
        `👇 *Select quality:*`;

      const msgOptions = {
        parse_mode: "MarkdownV2",
        reply_markup: getQualityKeyboard(isPremium),
      };

      // Show thumbnail if available — creates desire before quality selection
      if (thumb && !thumb.includes("default-thumbnail")) {
        try {
          await bot.sendPhoto(chatId, thumb, { caption, ...msgOptions });
        } catch {
          await bot.sendMessage(chatId, caption, msgOptions);
        }
      } else {
        await bot.sendMessage(chatId, caption, msgOptions);
      }
      return;
    }

    // ── Transaction ID (manual payment fallback) ──────────
    if (
      text.length >= 12 &&
      !isVideoURL(text) &&
      (text.match(/^[A-Z0-9]{12,}$/i) || text.match(/^\d{12,}$/) ||
       text.toLowerCase().includes("upi") || text.toLowerCase().includes("transaction"))
    ) {
      await bot.sendMessage(
        chatId,
        `🔍 *Payment Verification*\n\n` +
        `Transaction ID: \`${esc(text)}\`\n\n` +
        `⏳ Verifying\\.\\.\\. Premium will activate within *2 minutes*\\.\n\n` +
        `_We verify manually to ensure security\\._`,
        { parse_mode: "MarkdownV2" }
      );
      const adminId = process.env.TELEGRAM_ADMIN_ID;
      if (adminId) {
        await bot.sendMessage(
          adminId,
          `💰 *New Payment Received\\!*\n\n` +
          `User: @${esc(user.username || user.firstName)}\n` +
          `Telegram ID: \`${user.telegramId}\`\n` +
          `Transaction: \`${esc(text)}\`\n\n` +
          `To activate: /activate ${user.telegramId}`,
          { parse_mode: "MarkdownV2" }
        );
      }
      return;
    }

    // ── Unknown message ───────────────────────────────────
    await bot.sendMessage(
      chatId,
      t(user.language, "pasteLink"),
      { parse_mode: "MarkdownV2" }
    );
  } catch (err) {
    console.error("Message error:", err);
  }
});

// ═══════════════════════════════════════════════════════════
//  CALLBACK QUERY — button taps
// ═══════════════════════════════════════════════════════════
bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;
  const userId = query.from.id.toString();
  const data   = query.data;

  try {
    const user = await TelegramUser.findOne({ telegramId: userId });
    if (!user) {
      await bot.answerCallbackQuery(query.id);
      return;
    }

    // Keep user active timestamp fresh
    user.checkAndResetMonthly();
    user.checkPremiumStatus();
    user.lastActive = new Date();
    await user.save();

    // ── Language selection ────────────────────────────────
    if (data.startsWith("lang_")) {
      const selectedLang = data.replace("lang_", "");
      user.language         = selectedLang;
      user.languageSelected = true;
      await user.save();

      await bot.answerCallbackQuery(query.id);
      try { await bot.deleteMessage(chatId, query.message.message_id); } catch {}

      const firstName = esc(query.from.first_name || "there");
      await bot.sendMessage(
        chatId,
        t(selectedLang, "languageSet"),
        { parse_mode: "MarkdownV2" }
      );
      await bot.sendMessage(
        chatId,
        t(selectedLang, "welcome", {
          name: firstName,
          isReturning: user.totalDownloads > 0,
          limit: FREE_LIMIT,
        }),
        { parse_mode: "MarkdownV2" }
      );
      return;
    }

    // ── Locked premium button tapped ─────────────────────
    if (data === "locked") {
      // Answer with popup alert FIRST (only one answerCallbackQuery allowed)
      await bot.answerCallbackQuery(query.id, {
        text: "🔒 Premium quality — upgrade for ₹29/month!",
        show_alert: true,
      });
      const paymentLink = await createPaymentLink(user);
      await bot.sendMessage(
        chatId,
        `🔒 *This quality requires Premium*\n\n` +
        `You just tapped a premium quality\\!\n` +
        `That means you already know what you want 😎\n\n` +
        `*Unlock for ₹1/day:*\n` +
        `⭐ 1080p \\+ 4K \\+ MP3 320k\n` +
        `⭐ Unlimited downloads\n` +
        `⭐ Priority speed\n\n` +
        `👇 ${escUrl(paymentLink)}`,
        { parse_mode: "MarkdownV2" }
      );
      return;
    }

    // ── Upgrade button ────────────────────────────────────
    if (data === "upgrade") {
      await bot.answerCallbackQuery(query.id);
      const paymentLink = await createPaymentLink(user);
      await bot.sendMessage(
        chatId,
        `⭐ *VidVault Premium — ₹29/month*\n\n` +
        `✅ Unlimited downloads\n` +
        `✅ 1080p \\+ 4K quality\n` +
        `✅ Activates in seconds\n` +
        `✅ Cancel anytime\n\n` +
        `👇 ${escUrl(paymentLink)}\n\n` +
        `_Less than one chai per day ☕_`,
        { parse_mode: "MarkdownV2" }
      );
      return;
    }

    // ── Quality selected ──────────────────────────────────
    const params = qualityToParams(data);
    if (!params) {
      await bot.answerCallbackQuery(query.id);
      return;
    }

    await bot.answerCallbackQuery(query.id);

    const pending = pendingDownloads.get(userId);
    if (!pending) {
      await bot.sendMessage(chatId,
        t(user.language, "sessionExpired"),
        { parse_mode: "MarkdownV2" }
      );
      return;
    }

    // Delete keyboard message (photo or text)
    try { await bot.deleteMessage(chatId, query.message.message_id); } catch {}

    await handleDownload(chatId, user, pending.url, params);

  } catch (err) {
    console.error("Callback query error:", err);
    try { await bot.answerCallbackQuery(query.id); } catch {}
  }
});

// ═══════════════════════════════════════════════════════════
//  DOWNLOAD HANDLER
// ═══════════════════════════════════════════════════════════
async function handleDownload(chatId, user, url, params) {
  const userId           = user.telegramId;
  const { quality, format, label } = params;

  if (activeUsers.has(userId)) {
    await bot.sendMessage(chatId,
      `⏳ Already downloading\\. Please wait for it to finish\\.`,
      { parse_mode: "MarkdownV2" }
    );
    return;
  }
  activeUsers.set(userId, true);

  // Race condition safety — re-check limit
  if (user.plan === "free" && user.downloadsThisMonth >= FREE_LIMIT) {
    activeUsers.delete(userId);
    const days        = daysUntilReset(user.monthResetDate);
    const paymentLink = await createPaymentLink(user);
    await bot.sendMessage(
      chatId,
      `⚠️ *Monthly limit reached\\!*\n\n` +
      `Resets in *${days} days* OR upgrade now:\n` +
      `👉 ${escUrl(paymentLink)}`,
      { parse_mode: "MarkdownV2" }
    );
    return;
  }

  const processingMsg = await bot.sendMessage(
    chatId,
    t(user.language, "processing", { label: esc(label) }),
    { parse_mode: "MarkdownV2" }
  );

  try {
    const response = await axios.post(
      `${API_URL}/api/v1/download/video`,
      { url, quality, format },
      { timeout: 180000 }
    );

    if (response.data.status === "success") {
      const data = response.data.data;

      user.downloadsThisMonth += 1;
      user.totalDownloads     += 1;
      await user.save();

      pendingDownloads.delete(userId);
      try { await bot.deleteMessage(chatId, processingMsg.message_id); } catch {}

      const isPremium  = user.plan === "premium";
      const safeTitle  = esc(data.title || "Your video");
      const safeUrl    = escUrl(encodeURI(data.downloadUrl));

      // Create payment link only if nudge will actually use it (download 4)
      let paymentLink = null;
      if (!isPremium && user.downloadsThisMonth === 4) {
        paymentLink = await createPaymentLink(user);
      }

      const nudge = isPremium ? "" : getUpgradeNudge(user.downloadsThisMonth, paymentLink);

      await bot.sendMessage(
        chatId,
        t(user.language, "downloadReady", {
          title:    safeTitle,
          label:    esc(label),
          size:     esc(formatSize(data.fileSize)),
          platform: esc(data.platform || "Video"),
          url:      safeUrl,
          used:     user.downloadsThisMonth,
          limit:    FREE_LIMIT,
          isPremium,
        }) + nudge,
        { parse_mode: "MarkdownV2" }
      );

    } else {
      throw new Error(response.data.error || "Download failed");
    }
  } catch (err) {
    console.error("Download error:", err.message);
    try { await bot.deleteMessage(chatId, processingMsg.message_id); } catch {}
    await bot.sendMessage(
      chatId,
      `⚠️ *Couldn't fetch that video right now*\n\n` +
      `This sometimes happens with:\n` +
      `• Private or age\\-restricted videos\n` +
      `• Expired or invalid links\n\n` +
      `Please try again in a moment\\.\n` +
      `Or try on vidvaults\\.com 🌐`,
      { parse_mode: "MarkdownV2" }
    );
  } finally {
    activeUsers.delete(userId);
  }
}

// ═══════════════════════════════════════════════════════════
//  GROUP CHAT
// ═══════════════════════════════════════════════════════════
bot.on("new_chat_members", async (msg) => {
  if (msg.new_chat_members?.some(m => m.is_bot && m.username === BOT_USERNAME)) {
    await bot.sendMessage(
      msg.chat.id,
      `👋 Hi\\! I'm VidVault Bot\\!\n\nI work best in private chat\\.\n👉 @${BOT_USERNAME}`,
      { parse_mode: "MarkdownV2" }
    );
  }
});

module.exports = bot;
