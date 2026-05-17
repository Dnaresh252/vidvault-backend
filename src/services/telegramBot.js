const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const TelegramUser = require("../models/TelegramUser");
const { t, getLanguageKeyboard, detectLang } = require("./botTranslations");

// ─── Constants ────────────────────────────────────────────
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const PAYMENT_LINK = process.env.RAZORPAY_PAYMENT_LINK;
const ANNUAL_PAYMENT_LINK =
  process.env.RAZORPAY_ANNUAL_PAYMENT_LINK || process.env.RAZORPAY_PAYMENT_LINK;
const API_URL = process.env.API_URL || "https://api.vidvaults.com";
const BOT_USERNAME = "VidVaultFreeBot";
const FREE_LIMIT = 3;
const STARS_PRICE = 150;
const RATE_LIMIT_SECONDS = 10;
const FREE_COOLDOWN_MS = 12 * 60 * 60 * 1000; // 12 hours between free downloads
const MONTHLY_PRICE_INR = 79;
const ANNUAL_PRICE_INR = 499;

// Indian languages — show Razorpay first; all others → Stars first
const INDIAN_LANGS = new Set(["hi", "ta", "te", "bn", "ur", "kn", "ml"]);
function isIndianUser(user) {
  return INDIAN_LANGS.has(user.language || "");
}
// English users could be Indian or international — show both options equally
function isEnglishUser(user) {
  return (user.language || "en") === "en";
}

// Smart payment keyboard — inline upgrade prompt
// monthlyLink: Cashfree/Razorpay monthly URL
// annualLink:  Cashfree/Razorpay annual URL (optional — if missing, omit annual row)
function getPaymentKeyboard(
  monthlyLink,
  isIndian,
  isEnglish = false,
  annualLink = null,
) {
  if (isIndian) {
    const rows = [
      [
        {
          text: `🇮🇳 ₹${MONTHLY_PRICE_INR}/month — UPI / GPay / Cards`,
          url: monthlyLink,
        },
      ],
    ];
    if (annualLink)
      rows.push([
        {
          text: `🏆 ₹${ANNUAL_PRICE_INR}/year — Best Value 🔥`,
          url: annualLink,
        },
      ]);
    rows.push([
      { text: "⭐ Pay with Telegram Stars", callback_data: "stars_pay" },
    ]);
    return { inline_keyboard: rows };
  }
  if (isEnglish) {
    const rows = [
      [
        {
          text: `🇮🇳 India — ₹${MONTHLY_PRICE_INR}/month (UPI / Cards)`,
          url: monthlyLink,
        },
      ],
    ];
    if (annualLink)
      rows.push([
        {
          text: `🏆 India Annual — ₹${ANNUAL_PRICE_INR}/year 🔥`,
          url: annualLink,
        },
      ]);
    rows.push([
      {
        text: "🌍 International — ⭐ 150 Stars ($2)",
        callback_data: "stars_pay",
      },
    ]);
    return { inline_keyboard: rows };
  }
  return {
    inline_keyboard: [
      [
        {
          text: "⭐ Upgrade — 150 Stars ($2/month)",
          callback_data: "stars_pay",
        },
      ],
      [{ text: `🇮🇳 Pay ₹${MONTHLY_PRICE_INR} (India only)`, url: monthlyLink }],
    ],
  };
}

// ─── In-memory state ──────────────────────────────────────
const activeUsers = new Map(); // userId → true (currently downloading)
const rateLimiter = new Map(); // userId → lastRequestTimestamp
const pendingDownloads = new Map(); // userId → { url, chatId, timestamp }

// Auto-clean pending downloads older than 10 minutes
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [key, val] of pendingDownloads) {
    if (val.timestamp < cutoff) pendingDownloads.delete(key);
  }
}, 60 * 1000);

// ─── Renewal reminder — runs every 6 hours ────────────────
// Sends messages to users whose premium expired 0, 3, or 7 days ago
setInterval(
  async () => {
    try {
      const now = new Date();
      const windows = [
        { daysAgo: 0, label: "day0" },
        { daysAgo: 3, label: "day3" },
        { daysAgo: 7, label: "day7" },
      ];
      for (const { daysAgo } of windows) {
        const from = new Date(now - (daysAgo * 24 + 6) * 60 * 60 * 1000);
        const to = new Date(now - daysAgo * 24 * 60 * 60 * 1000);
        const expired = await TelegramUser.find({
          plan: "free",
          premiumEndDate: { $gte: from, $lt: to },
        }).lean();

        for (const u of expired) {
          try {
            const indian = INDIAN_LANGS.has(u.language || "");
            const paymentLink = PAYMENT_LINK;
            const msg =
              daysAgo === 0
                ? indian
                  ? `😔 *Your Premium just expired\\.*\n\nYou're back to *12\\-hour cooldowns* and *3 downloads/month*\\.\nRenew for *₹${MONTHLY_PRICE_INR}/month* and download anytime, unlimited\\.\n\n👇 /premium`
                  : `😔 *Your Premium just expired\\.*\n\nYou're back to *12\\-hour cooldowns* between downloads\\.\nRenew with *150 Stars* — one tap, instant access\\.\n\n👇 /premium`
                : daysAgo === 3
                  ? indian
                    ? `⚠️ *3 days without Premium\\.*\n\nEvery download has a *12\\-hour wait* now\\.\n\n*₹${MONTHLY_PRICE_INR}/month* → unlimited, instant, forever\n👇 /premium`
                    : `⚠️ *3 days without Premium\\.*\n\nStill waiting 12 hours between downloads\\?\n\n*150 Stars* → unlimited right now\n👇 /premium`
                  : indian
                    ? `🔥 *Final reminder — ₹${MONTHLY_PRICE_INR}/month*\n\nEvery download you wait 12 hours is *Premium calling you\\.*\nHundreds renewed this week\\. Your turn 👇\n/premium`
                    : `🔥 *Final reminder — 150 Stars*\n\nNo more 12\\-hour waits\\. Hundreds renewed this week\\.\n👇 /premium`;

            await bot.sendMessage(u.telegramId, msg, {
              parse_mode: "MarkdownV2",
            });
            await new Promise((r) => setTimeout(r, 100));
          } catch {}
        }
      }
    } catch (err) {
      console.error("Renewal reminder error:", err.message);
    }
  },
  6 * 60 * 60 * 1000,
);

// ─── Broadcast engine ─────────────────────────────────────
// In-memory guard: prevents duplicate fires within the same 30-min window.
// On bot restart, the DB field `lastBroadcastDate` acts as the real dedup guard
// so restarting mid-day never double-sends to users who already got it.
const broadcastSent = { friday: "", monthEnd: "", winBack: "" };

// Core batch sender — 20 msgs/sec, marks blocked users, reports to admin
async function sendBroadcast(query, messageBuilder, label) {
  const adminId = process.env.TELEGRAM_ADMIN_ID;
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  let sent = 0,
    blockedCount = 0,
    errors = 0;

  // Count once upfront so offset doesn't drift as we update docs
  const total = await TelegramUser.countDocuments(query);

  for (let offset = 0; offset < total; offset += 30) {
    const batch = await TelegramUser.find(query).skip(offset).limit(30).lean();
    for (const u of batch) {
      try {
        const { text, opts } = messageBuilder(u);
        await bot.sendMessage(u.telegramId, text, opts);
        // Mark sent — atomically, don't re-read whole doc
        await TelegramUser.updateOne(
          { telegramId: u.telegramId },
          { lastBroadcastDate: new Date() },
        );
        sent++;
      } catch (err) {
        const code = err.response?.body?.error_code;
        if (code === 403) {
          // User blocked the bot — silence them permanently from broadcasts
          await TelegramUser.updateOne(
            { telegramId: u.telegramId },
            { blocked: true },
          );
          blockedCount++;
        } else {
          errors++;
        }
      }
      // Telegram limit: 30 msgs/sec. We use 50ms = 20/sec (safe headroom)
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  if (adminId) {
    bot
      .sendMessage(
        adminId,
        `📤 *Broadcast: ${esc(label)}*\n\n` +
          `• Total targets: *${total}*\n` +
          `• Sent: *${sent}*\n` +
          `• Blocked \\(cleaned\\): *${blockedCount}*\n` +
          `• Errors: *${errors}*`,
        { parse_mode: "MarkdownV2" },
      )
      .catch(() => {});
  }
  console.log(
    `📤 Broadcast "${label}": sent=${sent} blocked=${blockedCount} errors=${errors}`,
  );
}

// Base query shared by all broadcasts:
// skip premium users, blocked users, and users already messaged today
function baseBroadcastQuery(extra = {}) {
  const todayUTC = new Date();
  todayUTC.setUTCHours(0, 0, 0, 0);
  return {
    plan: "free",
    blocked: { $ne: true },
    lastBroadcastDate: { $not: { $gte: todayUTC } }, // null/undefined also passes
    ...extra,
  };
}

// ── Friday 6PM IST weekend deal ──────────────────────────
async function runFridayBroadcast() {
  console.log("📤 Friday broadcast starting...");
  await sendBroadcast(
    baseBroadcastQuery(),
    (u) => {
      const indian = INDIAN_LANGS.has(u.language || "");
      return {
        text: indian
          ? `🎉 *Weekend Deal — Download Unlimited\\!*\n\n` +
            `Tired of waiting 12 hours between downloads\\?\n\n` +
            `✅ *No cooldowns* — download anytime\n` +
            `✅ 4K Ultra \\+ 1080p \\+ MP3 320k\n` +
            `✅ YouTube, Instagram, TikTok \\+ 25 more\n\n` +
            `📅 *₹${MONTHLY_PRICE_INR}/month* · 🏆 *₹${ANNUAL_PRICE_INR}/year* \\(save ₹${MONTHLY_PRICE_INR * 12 - ANNUAL_PRICE_INR}\\)\n\n` +
            `👉 /premium`
          : `🎉 *Weekend Deal — Go Unlimited\\!*\n\n` +
            `No more 12\\-hour waits\\. Download instantly, every time\\.\n\n` +
            `✅ *No cooldowns* — instant downloads\n` +
            `✅ 4K Ultra \\+ 1080p \\+ MP3 320k\n` +
            `✅ Works in *50\\+ countries*\n\n` +
            `⭐ *150 Stars/month* — one tap, active immediately\\!\n\n` +
            `👉 /premium`,
        opts: { parse_mode: "MarkdownV2" },
      };
    },
    "Friday Weekend Deal",
  );
}

// ── 28th of month — urgency push ─────────────────────────
async function runMonthEndBroadcast() {
  console.log("📤 Month-end broadcast starting...");
  // Only target users who've actually used at least 1 download (engaged)
  await sendBroadcast(
    baseBroadcastQuery({ downloadsThisMonth: { $gte: 1 } }),
    (u) => {
      const indian = INDIAN_LANGS.has(u.language || "");
      const used = u.downloadsThisMonth || 0;
      const limit = FREE_LIMIT + (u.bonusDownloads || 0);
      const remaining = Math.max(0, limit - used);
      const usedLine =
        remaining === 0
          ? indian
            ? `You've hit your limit — upgrade to keep downloading this week\\!`
            : `You've hit your limit — go unlimited right now\\!`
          : indian
            ? `You have *${remaining} download${remaining !== 1 ? "s" : ""}* left — don't waste them\\!`
            : `*${remaining} download${remaining !== 1 ? "s" : ""}* left — make them count\\!`;

      return {
        text: indian
          ? `⚠️ *3 days left this month\\!*\n\n` +
            `You've used *${used}/${limit}* free downloads\\.\n` +
            `${usedLine}\n\n` +
            `⚡ *Premium removes every limit:*\n` +
            `• No cooldowns — download anytime\n` +
            `• 1080p \\+ 4K unlocked\n` +
            `• Unlimited downloads\n\n` +
            `📅 *₹${MONTHLY_PRICE_INR}/month* · 🏆 *₹${ANNUAL_PRICE_INR}/year*\n\n` +
            `👉 /premium`
          : `⚠️ *3 days left this month\\!*\n\n` +
            `You've used *${used}/${limit}* free downloads\\.\n` +
            `${usedLine}\n\n` +
            `⚡ *Premium removes every limit:*\n` +
            `• No cooldowns — download anytime\n` +
            `• 1080p \\+ 4K unlocked\n` +
            `• Unlimited downloads\n\n` +
            `⭐ *150 Stars* → unlimited right now\n\n` +
            `👉 /premium`,
        opts: { parse_mode: "MarkdownV2" },
      };
    },
    "Month-End Urgency",
  );
}

// ── 7-day inactive win-back ──────────────────────────────
async function runWinBackBroadcast() {
  console.log("📤 Win-back broadcast starting...");
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  await sendBroadcast(
    baseBroadcastQuery({
      lastActive: { $lt: sevenDaysAgo },
      totalDownloads: { $gte: 1 }, // only users who've used the bot at least once
    }),
    (u) => {
      const indian = INDIAN_LANGS.has(u.language || "");
      const streak = u.currentStreak || 0;
      const streakNote =
        streak >= 2
          ? indian
            ? `\n🔥 *Your ${streak}\\-day streak is still alive\\!* Don't break it\\.\n`
            : `\n🔥 *Your ${streak}\\-day streak is waiting\\!* Come back and keep it\\.\n`
          : "";

      return {
        text: indian
          ? `👋 *Hey, we miss you\\!*\n\n` +
            `You haven't downloaded in a while\\.\n` +
            `VidVault supports YouTube, Instagram, TikTok \\+ 25 more 🎬\n` +
            streakNote +
            `\nJust paste any video link — done in seconds 👇\n\n` +
            `/start`
          : `👋 *Hey, we miss you\\!*\n\n` +
            `You haven't downloaded in a while\\.\n` +
            `Millions of videos across 25\\+ platforms 🎬\n` +
            streakNote +
            `\nPaste any video link — download in seconds 👇\n\n` +
            `/start`,
        opts: { parse_mode: "MarkdownV2" },
      };
    },
    "7-Day Win-Back",
  );
}

// ── Scheduler — checks every 30 minutes ─────────────────
// Time windows (UTC):
//   Friday broadcast  → Fri 12:00 UTC (= 6:00 PM IST / 8:00 AM EST)
//   Month-end         → 28th of month, 07:00 UTC (= 12:30 PM IST)
//   Win-back          → Daily at 08:00 UTC (= 1:30 PM IST)
setInterval(
  async () => {
    const now = new Date();
    const utcDay = now.getUTCDay();
    const utcHour = now.getUTCHours();
    const utcDate = now.getUTCDate();
    const todayStr = now.toISOString().slice(0, 10);

    if (utcDay === 5 && utcHour === 12 && broadcastSent.friday !== todayStr) {
      broadcastSent.friday = todayStr;
      runFridayBroadcast().catch((e) =>
        console.error("Friday broadcast error:", e.message),
      );
    }

    if (
      utcDate === 28 &&
      utcHour === 7 &&
      broadcastSent.monthEnd !== todayStr
    ) {
      broadcastSent.monthEnd = todayStr;
      runMonthEndBroadcast().catch((e) =>
        console.error("Month-end broadcast error:", e.message),
      );
    }

    if (utcHour === 8 && broadcastSent.winBack !== todayStr) {
      broadcastSent.winBack = todayStr;
      runWinBackBroadcast().catch((e) =>
        console.error("Win-back broadcast error:", e.message),
      );
    }
  },
  30 * 60 * 1000,
);

// ─── Initialize bot ───────────────────────────────────────
if (process.env.DISABLE_TELEGRAM === "true") {
  console.log("🤖 Telegram Bot disabled for this worker");
  module.exports = null;
  return;
}

const bot = new TelegramBot(TOKEN, {
  polling: {
    interval: 2000,
    autoStart: true,
    params: { timeout: 10 }
  }
});
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
    return [
      "youtube",
      "youtu.be",
      "instagram",
      "tiktok",
      "twitter",
      "x.com",
      "facebook",
      "fb.watch",
      "reddit",
      "vimeo",
    ].some((d) => text.includes(d));
  } catch {
    return false;
  }
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

// Create dynamic Razorpay payment link per user
// extraNotes: { is_gift: "true", gift_from_id: "..." } for gift flows
async function createRazorpayLink(user, plan = "monthly", extraNotes = {}) {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  const isAnnual = plan === "annual";
  if (!keyId || !keySecret || keyId === "your_razorpay_key_id") {
    return isAnnual ? ANNUAL_PAYMENT_LINK : PAYMENT_LINK;
  }
  try {
    const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
    const res = await axios.post(
      "https://api.razorpay.com/v1/payment_links",
      {
        amount: isAnnual ? ANNUAL_PRICE_INR * 100 : MONTHLY_PRICE_INR * 100,
        currency: "INR",
        description: isAnnual
          ? `VidVault Premium — 1 Year Unlimited Downloads (Save ₹${MONTHLY_PRICE_INR * 12 - ANNUAL_PRICE_INR})`
          : "VidVault Premium — 1 Month Unlimited Downloads",
        notes: {
          telegram_id: user.telegramId,
          username: user.username || user.firstName || "user",
          plan_type: plan,
          ...extraNotes,
        },
        reminder_enable: false,
        expire_by: Math.floor(Date.now() / 1000) + 3600,
      },
      { headers: { Authorization: `Basic ${auth}` }, timeout: 5000 },
    );
    return res.data.short_url;
  } catch (err) {
    console.error("Razorpay link creation failed:", err.message);
    return isAnnual ? ANNUAL_PAYMENT_LINK : PAYMENT_LINK;
  }
}

// Aliases for clarity
async function createPaymentLink(user) {
  return createRazorpayLink(user, "monthly");
}
async function createAnnualPaymentLink(user) {
  return createRazorpayLink(user, "annual");
}

// Cashfree payment link — falls back to Razorpay on missing config
async function createCashfreePaymentLink(user, plan = "monthly") {
  const appId = process.env.CASHFREE_APP_ID;
  const secretKey = process.env.CASHFREE_SECRET_KEY;
  const env = process.env.CASHFREE_ENV || "PRODUCTION";
  const isAnnual = plan === "annual";

  if (!appId || !secretKey) {
    return isAnnual ? createAnnualPaymentLink(user) : createPaymentLink(user);
  }

  const baseUrl =
    env === "PRODUCTION"
      ? "https://api.cashfree.com/pg/links"
      : "https://sandbox.cashfree.com/pg/links";

  // Static fallback links (pre-created from dashboard) — used if API call fails
  const staticMonthly = process.env.CASHFREE_MONTHLY_LINK;
  const staticAnnual = process.env.CASHFREE_ANNUAL_LINK;

  try {
    const linkId = `VV_${user.telegramId}_${Date.now()}`;
    const res = await axios.post(
      baseUrl,
      {
        link_id: linkId,
        link_amount: isAnnual ? ANNUAL_PRICE_INR : MONTHLY_PRICE_INR,
        link_currency: "INR",
        link_purpose: isAnnual
          ? "VidVault Premium — 1 Year Unlimited Downloads"
          : "VidVault Premium — 1 Month Unlimited Downloads",
        customer_details: {
          customer_id: user.telegramId,
          customer_name: user.firstName || user.username || "VidVault User",
          customer_phone: "9999999999",
        },
        link_notify: { send_sms: false, send_email: false },
        link_auto_reminders: false,
        link_notes: {
          telegram_id: user.telegramId,
          username: user.username || user.firstName || "user",
          plan_type: plan,
        },
        link_expiry_time: new Date(Date.now() + 3600 * 1000).toISOString(),
      },
      {
        headers: {
          "x-client-id": appId,
          "x-client-secret": secretKey,
          "x-api-version": "2023-08-01",
          "Content-Type": "application/json",
        },
        timeout: 5000,
      },
    );
    return res.data.link_url;
  } catch (err) {
    console.error("Cashfree link creation failed:", err.message);
    // Fallback order: static Cashfree link → Razorpay
    if (isAnnual) return staticAnnual || createAnnualPaymentLink(user);
    return staticMonthly || createPaymentLink(user);
  }
}

// Stars invoice — monthly or annual
async function sendStarsInvoiceForPlan(chatId, user, plan = "monthly") {
  const isAnnual = plan === "annual";
  await bot.sendInvoice(
    chatId,
    isAnnual ? "VidVault Premium — 1 Year" : "VidVault Premium — 1 Month",
    isAnnual
      ? "✅ Unlimited downloads for 12 months  ✅ 4K + 1080p  ✅ MP3 320k  ✅ Save 800 Stars vs monthly"
      : "✅ Unlimited downloads  ✅ 4K + 1080p  ✅ MP3 320k  ✅ All 25+ platforms",
    `stars_${plan}_${user.telegramId}`,
    "",
    "XTR",
    [
      {
        label: isAnnual
          ? "VidVault Premium (1 Year)"
          : "VidVault Premium (1 Month)",
        amount: isAnnual ? 1000 : STARS_PRICE,
      },
    ],
  );
}

// Cached premium user count — refreshed every 30 min, never blocks UX
let _premiumCountCache = { count: 0, fetchedAt: 0 };
async function getPremiumCount() {
  if (Date.now() - _premiumCountCache.fetchedAt < 30 * 60 * 1000) {
    return _premiumCountCache.count;
  }
  try {
    const n = await TelegramUser.countDocuments({ plan: "premium" });
    _premiumCountCache = { count: n, fetchedAt: Date.now() };
    return n;
  } catch {
    return _premiumCountCache.count || 200;
  }
}

// Fetch instant metadata (title, thumbnail, duration, platform)
async function fetchMetadata(url) {
  try {
    const res = await axios.get(
      `${API_URL}/api/v1/instant/metadata?url=${encodeURIComponent(url)}`,
      { timeout: 15000 },
    );
    return res.data?.data || res.data || null;
  } catch {
    return null;
  }
}

// Inline keyboard
// hasTaste = user hasn't used their free 4K taste yet
function getQualityKeyboard(isPremium, hasTaste = false) {
  if (isPremium) {
    return {
      inline_keyboard: [
        [
          { text: "📱 480p", callback_data: "q_480p" },
          { text: "🎬 720p HD", callback_data: "q_720p" },
        ],
        [
          { text: "✨ 1080p FHD", callback_data: "q_1080p" },
          { text: "👑 4K Ultra", callback_data: "q_4k" },
        ],
        [
          { text: "🎵 MP3 128k", callback_data: "q_mp3_128" },
          { text: "🎵 MP3 320k HQ", callback_data: "q_mp3_320" },
        ],
      ],
    };
  }

  const baseRows = [
    [
      { text: "📱 480p — Free", callback_data: "q_480p" },
      { text: "🎬 720p — Free", callback_data: "q_720p" },
    ],
    [
      { text: "🔒 1080p — Premium", callback_data: "locked" },
      { text: "🔒 4K — Premium", callback_data: "locked" },
    ],
    [
      { text: "🎵 MP3 128k — Free", callback_data: "q_mp3_128" },
      { text: "🔒 MP3 320k — Premium", callback_data: "locked" },
    ],
  ];

  if (hasTaste) {
    return {
      inline_keyboard: [
        [{ text: "🎁 Try 4K FREE — Once Only!", callback_data: "q_4k_taste" }],
        ...baseRows,
      ],
    };
  }
  return { inline_keyboard: baseRows };
}

// Map callback_data → API params
// isTaste=true tells handleDownload to mark the taste as used after success
function qualityToParams(data) {
  const map = {
    q_480p: { quality: "low", format: "mp4", label: "480p" },
    q_720p: { quality: "medium", format: "mp4", label: "720p HD" },
    q_1080p: { quality: "high", format: "mp4", label: "1080p FHD" },
    q_4k: { quality: "highest", format: "mp4", label: "4K Ultra" },
    q_4k_taste: {
      quality: "highest",
      format: "mp4",
      label: "4K Ultra",
      isTaste: true,
    },
    q_mp3_128: { quality: "medium", format: "mp3", label: "MP3 128k" },
    q_mp3_320: { quality: "high", format: "mp3", label: "MP3 320k" },
  };
  return map[data] || null;
}

// Post-taste nudge — shown once after the free 4K taste download
function getTasteNudge(user) {
  const indian = isIndianUser(user);
  const english = isEnglishUser(user);
  return (
    `\n━━━━━━━━━━━━━━━━━━━━\n` +
    `👑 *That was 4K Ultra\\!*\n` +
    `_That's what Premium feels like — every single download\\._\n\n` +
    (indian
      ? `Get unlimited 4K forever:\n~₹99~ *₹79/month* → /premium`
      : english
        ? `Get unlimited 4K forever:\n🇮🇳 *₹79/month* · 🌍 *150 Stars* → /premium`
        : `Get unlimited 4K forever:\n⭐ *150 Stars/month* → /premium`)
  );
}

// Psychology nudge after download — language + streak aware
function getUpgradeNudge(downloadsUsed, user) {
  const indian = isIndianUser(user);
  const english = isEnglishUser(user);
  const effectiveLimit = FREE_LIMIT + (user.bonusDownloads || 0);
  const remaining = effectiveLimit - downloadsUsed;
  const streak = user.currentStreak || 0;
  const streakWarning =
    streak >= 2
      ? `🔥 Streak: *${streak} days* — upgrade to protect it\\!\n`
      : "";
  const bothPricing = `🇮🇳 *₹${MONTHLY_PRICE_INR}/month* · 🌍 *150 Stars* → /premium`;

  if (remaining === 1) {
    return indian
      ? `\n━━━━━━━━━━━━━━━━━━━━\n⚠️ *1 free download left this month\\!*\n${streakWarning}*₹${MONTHLY_PRICE_INR}/month* — unlimited forever → /premium`
      : english
        ? `\n━━━━━━━━━━━━━━━━━━━━\n⚠️ *1 free download left this month\\!*\n${streakWarning}${bothPricing}`
        : `\n━━━━━━━━━━━━━━━━━━━━\n⚠️ *1 free download left this month\\!*\n${streakWarning}⭐ *150 Stars/month* → /premium`;
  }
  if (remaining === 0) {
    return indian
      ? `\n━━━━━━━━━━━━━━━━━━━━\n🔥 *That was your last free download\\!*\n${streakWarning}*₹${MONTHLY_PRICE_INR}/month* — go unlimited now → /premium`
      : english
        ? `\n━━━━━━━━━━━━━━━━━━━━\n🔥 *That was your last free download\\!*\n${streakWarning}${bothPricing}`
        : `\n━━━━━━━━━━━━━━━━━━━━\n🔥 *That was your last free download\\!*\n${streakWarning}⭐ *150 Stars/month* → /premium`;
  }
  return "";
}

// ─── Streak helpers ───────────────────────────────────────

// Returns fire emoji tier based on streak length
function streakEmoji(streak) {
  if (streak >= 100) return "👑";
  if (streak >= 30) return "🏆";
  if (streak >= 7) return "🔥";
  if (streak >= 3) return "⚡";
  return "✨";
}

// Next streak milestone above current streak
const STREAK_MILESTONES = [3, 7, 30, 100];
function nextMilestone(streak) {
  return STREAK_MILESTONES.find((m) => m > streak) || null;
}

// Update streak in-memory (does NOT save — caller must save user)
// Returns { incremented: bool, milestone: string|null }
// Uses UTC midnight so users worldwide get fair streak windows
function updateStreak(user) {
  const todayUTC = new Date();
  todayUTC.setUTCHours(0, 0, 0, 0);

  const lastDate = user.lastStreakDate ? new Date(user.lastStreakDate) : null;
  if (lastDate) lastDate.setUTCHours(0, 0, 0, 0);

  // Already counted today — idempotent, no double-increment
  if (lastDate && lastDate.getTime() === todayUTC.getTime()) {
    return { incremented: false, milestone: null };
  }

  const yesterdayUTC = new Date(todayUTC);
  yesterdayUTC.setUTCDate(yesterdayUTC.getUTCDate() - 1);

  if (!lastDate || lastDate.getTime() < yesterdayUTC.getTime()) {
    // First download ever, or missed at least one day → reset streak
    user.currentStreak = 1;
  } else {
    // Consecutive day → extend streak
    user.currentStreak = (user.currentStreak || 0) + 1;
  }

  user.lastStreakDate = todayUTC;

  if (user.currentStreak > (user.longestStreak || 0)) {
    user.longestStreak = user.currentStreak;
  }

  // Check if this streak count is a milestone that hasn't been claimed yet
  const milestoneMap = {
    3: "streak_3",
    7: "streak_7",
    30: "streak_30",
    100: "streak_100",
  };
  const key = milestoneMap[user.currentStreak];
  if (key && !(user.streakMilestones || []).includes(key)) {
    if (!user.streakMilestones) user.streakMilestones = [];
    user.streakMilestones.push(key);
    return { incremented: true, milestone: key };
  }

  return { incremented: true, milestone: null };
}

// Apply milestone reward — sends message and modifies user (caller saves)
async function applyStreakMilestone(chatId, user, milestoneKey) {
  const adminId = process.env.TELEGRAM_ADMIN_ID;

  if (milestoneKey === "streak_3") {
    user.bonusDownloads = (user.bonusDownloads || 0) + 1;
    await bot.sendMessage(
      chatId,
      `⚡ *3\\-Day Streak Unlocked\\!* 🎉\n\n` +
        `You've downloaded 3 days in a row\\!\n\n` +
        `🎁 *\\+1 bonus download* added to your account\\!\n\n` +
        `Keep going — at *7 days* you get \\+3 more\\! 🔥`,
      { parse_mode: "MarkdownV2" },
    );
  } else if (milestoneKey === "streak_7") {
    user.bonusDownloads = (user.bonusDownloads || 0) + 3;
    await bot.sendMessage(
      chatId,
      `🔥 *7\\-Day Streak\\!* You're on fire\\!\n\n` +
        `A full week of daily downloads — incredible\\!\n\n` +
        `🎁 *\\+3 bonus downloads* added\\!\n\n` +
        `Next milestone: *30 days* → FREE 1\\-Month Premium 🏆\n` +
        `_Only ${30 - 7} more days\\. You've got this\\!_`,
      { parse_mode: "MarkdownV2" },
    );
  } else if (milestoneKey === "streak_30") {
    // Award 30 days free premium — extend from current expiry (never reset)
    const now = Date.now();
    const currentExpiry = user.premiumEndDate
      ? new Date(user.premiumEndDate).getTime()
      : now;
    const base = currentExpiry > now ? currentExpiry : now;
    user.plan = "premium";
    user.premiumStartDate = user.premiumStartDate || new Date();
    user.premiumEndDate = new Date(base + 30 * 24 * 60 * 60 * 1000);

    await bot.sendMessage(
      chatId,
      `🏆 *30\\-DAY LEGEND\\!*\n\n` +
        `You've used VidVault every single day for 30 days\\!\n` +
        `That's dedication — and we're rewarding it\\! 🙌\n\n` +
        `🎉 *1 MONTH PREMIUM — ABSOLUTELY FREE\\!*\n\n` +
        `✅ Unlimited downloads — NOW\n` +
        `✅ 4K Ultra \\+ 1080p \\+ MP3 320k — NOW\n` +
        `✅ Valid for 30 days\n\n` +
        `_You earned this\\. Next stop: *100 days → 3 Months FREE* 👑_`,
      { parse_mode: "MarkdownV2" },
    );

    // Notify admin — free premium was awarded
    if (adminId) {
      bot
        .sendMessage(
          adminId,
          `🏆 *30\\-Day Streak Reward Given\\!*\n\n` +
            `User: ${esc(user.firstName || user.username || user.telegramId)}\n` +
            `ID: \`${user.telegramId}\`\n` +
            `Streak: *30 days*\n` +
            `Reward: *30 days Premium FREE*\n` +
            `Expires: ${new Date(user.premiumEndDate).toDateString()}`,
          { parse_mode: "MarkdownV2" },
        )
        .catch(() => {});
    }
  } else if (milestoneKey === "streak_100") {
    // Give 3 months (90 days) free Premium — extend from current expiry (never reset)
    const now = Date.now();
    const currentExpiry = user.premiumEndDate
      ? new Date(user.premiumEndDate).getTime()
      : now;
    const base = currentExpiry > now ? currentExpiry : now;
    user.plan = "premium";
    user.premiumStartDate = user.premiumStartDate || new Date();
    user.premiumEndDate = new Date(base + 90 * 24 * 60 * 60 * 1000);

    await bot.sendMessage(
      chatId,
      `👑 *100\\-DAY LEGEND\\!*\n\n` +
        `You are in the top 0\\.1% of VidVault users ever\\!\n` +
        `100 consecutive days — ABSOLUTELY LEGENDARY\\! 🏆\n\n` +
        `🎉 *3 MONTHS PREMIUM — ABSOLUTELY FREE\\!*\n\n` +
        `✅ Unlimited downloads — NOW\n` +
        `✅ 4K Ultra \\+ 1080p \\+ MP3 320k — NOW\n` +
        `✅ Valid for *90 days*\n\n` +
        `_You are a VidVault Legend\\. Forever\\. 👑_`,
      { parse_mode: "MarkdownV2" },
    );

    if (adminId) {
      bot
        .sendMessage(
          adminId,
          `👑 *100\\-Day Streak Legend\\!*\n\n` +
            `User: ${esc(user.firstName || user.username || user.telegramId)}\n` +
            `ID: \`${user.telegramId}\`\n` +
            `Streak: *100 days*\n` +
            `Reward: *90 days Premium FREE*\n` +
            `Expires: ${new Date(user.premiumEndDate).toDateString()}`,
          { parse_mode: "MarkdownV2" },
        )
        .catch(() => {});
    }
  }
}

// Build the streak line appended to download confirmation
function getStreakLine(user, incremented) {
  const streak = user.currentStreak || 0;
  if (!incremented || streak < 2) return "";

  const emoji = streakEmoji(streak);
  const next = nextMilestone(streak);
  const daysTo = next ? next - streak : null;

  let line = `\n━━━━━━━━━━━━━━━━━━━━\n${emoji} *${streak}\\-Day Streak\\!*`;

  if (daysTo) {
    if (next === 30) {
      line += ` — _${daysTo} more → FREE 1\\-Month Premium 🏆_`;
    } else if (next === 100) {
      line += ` — _${daysTo} more → 3 months FREE Premium 👑_`;
    } else {
      line += ` — _${daysTo} more → bonus downloads\\!_`;
    }
  } else {
    line += ` — _LEGENDARY status\\! 👑_`;
  }

  return line;
}

// Build streak FOMO line for limit wall and nudge
function getStreakFomoLine(user) {
  const streak = user.currentStreak || 0;
  if (streak < 2) return "";

  const next = nextMilestone(streak);
  const daysTo = next ? next - streak : 0;

  if (next === 30 && daysTo <= 10) {
    return (
      `\n🔥 *Your ${streak}\\-day streak is at risk\\!*\n` +
      `_Just ${daysTo} more days → FREE 1\\-Month Premium\\!_\n`
    );
  }
  if (next === 30) {
    return (
      `\n🔥 *Don't break your ${streak}\\-day streak\\!*\n` +
      `_${daysTo} days to FREE Premium — you're ${streak} days in\\!_\n`
    );
  }
  if (next === 100 && daysTo <= 10) {
    return (
      `\n👑 *${streak}\\-day streak at risk\\!*\n` +
      `_${daysTo} more days → 3 months FREE Premium\\!_\n`
    );
  }
  return `\n🔥 *Your ${streak}\\-day streak is at risk\\!*\n`;
}

// ═══════════════════════════════════════════════════════════
//  /start
// ═══════════════════════════════════════════════════════════
bot.onText(/\/start(.*)/, async (msg, match) => {
  const chatId = msg.chat.id;
  try {
    const user = await getUser(msg);
    const firstName = esc(msg.from.first_name || "there");
    const lang = user.language || "en";

    // Handle referral code from start param
    const referralCode = match[1]?.trim();
    if (referralCode && referralCode !== user.referralCode) {
      const referrer = await TelegramUser.findOne({ referralCode });
      if (referrer && !user.referredBy) {
        user.referredBy = referralCode;
        referrer.referralCount += 1;
        referrer.downloadsThisMonth = Math.max(
          0,
          referrer.downloadsThisMonth - 2,
        );

        if (referrer.referralCount >= 10 && referrer.plan === "free") {
          referrer.plan = "premium";
          referrer.premiumStartDate = new Date();
          referrer.premiumEndDate = new Date(
            Date.now() + 30 * 24 * 60 * 60 * 1000,
          );
          await referrer.save();
          await bot.sendMessage(
            referrer.telegramId,
            `🎉 *CONGRATULATIONS\\!*\n\n` +
              `You referred 10 friends and unlocked *1 Month Premium FREE\\!* 🎁\n\n` +
              `✅ Unlimited downloads activated\n` +
              `✅ Valid for 30 days\n\n` +
              `Thank you for growing VidVault\\! 🙏`,
            { parse_mode: "MarkdownV2" },
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
            { parse_mode: "MarkdownV2" },
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
        user.language = detected;
        user.languageSelected = true;
        await user.save();
        await bot.sendMessage(chatId, t(detected, "languageSet"), {
          parse_mode: "MarkdownV2",
        });
        await bot.sendMessage(
          chatId,
          t(detected, "welcome", {
            name: firstName,
            isReturning: false,
            limit: FREE_LIMIT,
          }),
          { parse_mode: "MarkdownV2" },
        );
      } else {
        // Show full language picker
        await bot.sendMessage(chatId, t("en", "chooseLanguage"), {
          parse_mode: "MarkdownV2",
          reply_markup: getLanguageKeyboard(),
        });
      }
      return;
    }

    // ── RETURNING USER: welcome in their language ─────────
    const isReturning = user.totalDownloads > 0;
    await bot.sendMessage(
      chatId,
      t(lang, "welcome", { name: firstName, isReturning, limit: FREE_LIMIT }),
      { parse_mode: "MarkdownV2" },
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
    const user = await getUser(msg);
    const isPremium = user.plan === "premium";
    const effectiveLimit = FREE_LIMIT + (user.bonusDownloads || 0);
    const remaining = isPremium
      ? "∞"
      : Math.max(0, effectiveLimit - user.downloadsThisMonth);
    const days = daysUntilReset(user.monthResetDate);

    const indian = isIndianUser(user);
    const english = isEnglishUser(user);
    const upgradePrompt = indian
      ? `⚡ *Go unlimited for ₹${MONTHLY_PRICE_INR}/month* or ₹${ANNUAL_PRICE_INR}/year`
      : english
        ? `⚡ *Go unlimited:* 🇮🇳 ₹${MONTHLY_PRICE_INR}/month · 🌍 150 Stars`
        : `⚡ *Go unlimited for ⭐ 150 Stars/month*`;

    // Cooldown status for free users
    let cooldownLine = "";
    if (!isPremium && user.lastDownloadAt) {
      const elapsed = Date.now() - new Date(user.lastDownloadAt).getTime();
      const hoursLeft = Math.ceil(
        (FREE_COOLDOWN_MS - elapsed) / (60 * 60 * 1000),
      );
      if (elapsed < FREE_COOLDOWN_MS) {
        cooldownLine = `\n⏳ Next free download: *${hoursLeft}h*\n`;
      } else {
        cooldownLine = `\n✅ Ready to download\\!\n`;
      }
    } else if (!isPremium) {
      cooldownLine = `\n✅ Ready to download\\!\n`;
    }

    // Streak section
    const streak = user.currentStreak || 0;
    const longestStreak = user.longestStreak || 0;
    const sEmoji = streakEmoji(streak);
    const sNext = nextMilestone(streak);
    const sDaysTo = sNext ? sNext - streak : null;
    const streakSection =
      streak >= 1
        ? `\n━━━━━━━━━━━━━━━━━━━━\n` +
          `${sEmoji} *Download Streak: ${streak} days*\n` +
          `🏅 Best: *${longestStreak} days*\n` +
          `${
            sDaysTo
              ? sNext === 30
                ? `🎯 *${sDaysTo} more days → FREE 1\\-Month Premium\\!*`
                : sNext === 100
                  ? `🎯 *${sDaysTo} more days → 3 months FREE Premium 👑*`
                  : `🎯 *${sDaysTo} more days → bonus downloads\\!*`
              : `👑 *LEGENDARY — Max streak reached\\!*`
          }\n`
        : "";

    const statusMsg = isPremium
      ? `⭐ *Premium Member*\n\n` +
        `✅ Unlimited downloads — active\n` +
        `✅ 4K \\+ 1080p quality — unlocked\n` +
        `✅ MP3 320k — unlocked\n` +
        `✅ Valid until: *${user.premiumEndDate ? new Date(user.premiumEndDate).toDateString() : "Active"}*\n\n` +
        `📈 Total downloads: *${user.totalDownloads}*\n` +
        `🎁 Referral: *${esc(user.referralCode)}* \\| 👥 *${user.referralCount}/10* friends` +
        streakSection +
        `\n_You're a VIP\\. Keep downloading\\! 🎬_`
      : `🆓 *Free Plan*\n\n` +
        `📥 Used: *${user.downloadsThisMonth}/${effectiveLimit}* this month\n` +
        `✅ Remaining: *${remaining}* downloads\n` +
        `🔄 Resets in: *${days} days*\n` +
        cooldownLine +
        `📈 Total downloads: *${user.totalDownloads}*\n\n` +
        `🎁 Referral: *${esc(user.referralCode)}* \\| 👥 *${user.referralCount}/10* friends` +
        streakSection +
        `\n━━━━━━━━━━━━━━━━━━━━\n` +
        `${upgradePrompt}\n` +
        `/premium`;

    const statusOpts = { parse_mode: "MarkdownV2" };
    if (!isPremium) {
      statusOpts.reply_markup = {
        inline_keyboard: [
          [
            {
              text: `⭐ Upgrade to Premium — /premium`,
              callback_data: "upgrade",
            },
          ],
        ],
      };
    }
    await bot.sendMessage(chatId, statusMsg, statusOpts);
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
        { parse_mode: "MarkdownV2" },
      );
      return;
    }

    const paymentLink = await createPaymentLink(user);
    const annualPaymentLink = await createAnnualPaymentLink(user);
    const indian = isIndianUser(user);
    const english = isEnglishUser(user);

    const premiumMsg = indian
      ? `⭐ *VidVault Premium*\n` +
        `_Unlimited downloads\\. Zero limits\\. Forever\\._\n\n` +
        `✅ Unlimited downloads\n` +
        `✅ 4K Ultra \\+ 1080p \\+ MP3 320k\n` +
        `✅ All 25\\+ platforms\n` +
        `✅ Instant UPI / GPay / Cards\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `📅 *Monthly:* *₹${MONTHLY_PRICE_INR}/month*\n` +
        `🏆 *Annual:* *₹${ANNUAL_PRICE_INR}/year* — _save ₹${MONTHLY_PRICE_INR * 12 - ANNUAL_PRICE_INR}_ 🔥\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `Choose your plan 👇`
      : english
        ? `⭐ *VidVault Premium*\n` +
          `_Unlimited downloads\\. Zero limits\\._\n\n` +
          `✅ Unlimited downloads\n` +
          `✅ 4K Ultra \\+ 1080p \\+ MP3 320k\n` +
          `✅ All 25\\+ platforms\n` +
          `✅ Activates instantly\n\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `🇮🇳 *India — UPI / Cards:*\n` +
          `📅 Monthly: *₹${MONTHLY_PRICE_INR}/month*\n` +
          `🏆 Annual: *₹${ANNUAL_PRICE_INR}/year* — _save ₹${MONTHLY_PRICE_INR * 12 - ANNUAL_PRICE_INR}_ 🔥\n\n` +
          `🌍 *International — Telegram Stars:*\n` +
          `📅 Monthly: ⭐ *150 Stars* \\(≈ \\$2\\)\n` +
          `🏆 Annual: ⭐ *1000 Stars* — _save 800_ 🔥\n` +
          `━━━━━━━━━━━━━━━━━━━━\n\n` +
          `Choose your plan 👇`
        : `⭐ *VidVault Premium*\n` +
          `_Unlimited downloads\\. Zero limits\\. Worldwide\\._\n\n` +
          `✅ Unlimited downloads\n` +
          `✅ 4K Ultra \\+ 1080p \\+ MP3 320k\n` +
          `✅ All 25\\+ platforms\n` +
          `✅ Trusted in *50\\+ countries*\n\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `📅 *Monthly:* ⭐ *150 Stars* \\(≈ \\$2\\)\n` +
          `🏆 *Annual:* ⭐ *1000 Stars* — _save 800 Stars_ 🔥\n` +
          `━━━━━━━━━━━━━━━━━━━━\n\n` +
          `_One tap payment — no card needed_ 👇`;

    const keyboard = indian
      ? {
          inline_keyboard: [
            [
              {
                text: `📅 Monthly — ₹${MONTHLY_PRICE_INR}/month`,
                url: paymentLink,
              },
            ],
            [
              {
                text: `🏆 Annual — ₹${ANNUAL_PRICE_INR}/year (Best Value)`,
                url: annualPaymentLink,
              },
            ],
            [
              {
                text: "⭐ Pay with Telegram Stars",
                callback_data: "stars_plan_menu",
              },
            ],
          ],
        }
      : english
        ? {
            inline_keyboard: [
              [
                {
                  text: `🇮🇳 Monthly — ₹${MONTHLY_PRICE_INR}/month (India)`,
                  url: paymentLink,
                },
              ],
              [
                {
                  text: `🇮🇳 Annual — ₹${ANNUAL_PRICE_INR}/year (India · Best Value)`,
                  url: annualPaymentLink,
                },
              ],
              [
                {
                  text: "🌍 Monthly — ⭐ 150 Stars (International)",
                  callback_data: "stars_monthly",
                },
              ],
              [
                {
                  text: "🌍 Annual — ⭐ 1000 Stars (International)",
                  callback_data: "stars_annual",
                },
              ],
            ],
          }
        : {
            inline_keyboard: [
              [
                {
                  text: "📅 Monthly — 150 Stars",
                  callback_data: "stars_monthly",
                },
              ],
              [
                {
                  text: "🏆 Annual — 1000 Stars (Best Value)",
                  callback_data: "stars_annual",
                },
              ],
              [
                {
                  text: `🇮🇳 Pay ₹${MONTHLY_PRICE_INR} (India only)`,
                  url: paymentLink,
                },
              ],
            ],
          };

    await bot.sendMessage(chatId, premiumMsg, {
      parse_mode: "MarkdownV2",
      disable_web_page_preview: true,
      reply_markup: keyboard,
    });
  } catch (err) {
    console.error("Premium error:", err);
  }
});

// ═══════════════════════════════════════════════════════════
//  /streak
// ═══════════════════════════════════════════════════════════
bot.onText(/\/streak/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    const user = await getUser(msg);
    const streak = user.currentStreak || 0;
    const longest = user.longestStreak || 0;
    const claimed = user.streakMilestones || [];

    const sEmoji = streakEmoji(streak);
    const sNext = nextMilestone(streak);
    const sDaysTo = sNext ? sNext - streak : null;

    // Progress bar toward next milestone (20 chars wide)
    let progressBar = "";
    if (sNext) {
      const prev = STREAK_MILESTONES[STREAK_MILESTONES.indexOf(sNext) - 1] || 0;
      const total = sNext - prev;
      const done = streak - prev;
      const filled = Math.round((done / total) * 20);
      progressBar = "▓".repeat(filled) + "░".repeat(20 - filled);
    }

    // Last streak date display
    const lastDate = user.lastStreakDate
      ? new Date(user.lastStreakDate).toDateString()
      : "Never";

    // Check if streak is at risk (last download wasn't today)
    const todayUTC = new Date();
    todayUTC.setUTCHours(0, 0, 0, 0);
    const lastUTC = user.lastStreakDate ? new Date(user.lastStreakDate) : null;
    if (lastUTC) lastUTC.setUTCHours(0, 0, 0, 0);
    const downloadedToday = lastUTC && lastUTC.getTime() === todayUTC.getTime();
    const atRisk = streak > 0 && !downloadedToday;

    const milestoneStatus =
      `${claimed.includes("streak_3") ? "✅" : "⏳"} 3\\-day streak — \\+1 bonus download\n` +
      `${claimed.includes("streak_7") ? "✅" : "⏳"} 7\\-day streak — \\+3 bonus downloads\n` +
      `${claimed.includes("streak_30") ? "✅" : "⏳"} 30\\-day streak — 1 Month *FREE Premium* 🏆\n` +
      `${claimed.includes("streak_100") ? "✅" : "⏳"} 100\\-day streak — 3 Months *FREE Premium* 👑`;

    let streakMsg =
      `${sEmoji} *Your Download Streak*\n\n` +
      `🔥 Current streak: *${streak} day${streak !== 1 ? "s" : ""}*\n` +
      `🏅 Best streak: *${longest} days*\n` +
      `📅 Last download: *${downloadedToday ? "Today ✅" : atRisk ? lastDate + " ⚠️" : lastDate}*\n`;

    if (atRisk) {
      streakMsg += `\n⚠️ *Download today to keep your streak\\!*\n`;
    }

    if (sDaysTo && progressBar) {
      streakMsg +=
        `\n*Progress → ${sNext} days:*\n` +
        `${progressBar}\n` +
        (sNext === 30
          ? `🎯 *${sDaysTo} more days → FREE 1\\-Month Premium\\!*\n`
          : sNext === 100
            ? `🎯 *${sDaysTo} more days → 3 Months FREE Premium 👑*\n`
            : `🎯 *${sDaysTo} more days → bonus downloads\\!*\n`);
    }

    streakMsg +=
      `\n━━━━━━━━━━━━━━━━━━━━\n` + `🏆 *Milestones:*\n` + milestoneStatus;

    if (streak === 0) {
      streakMsg +=
        `\n\n━━━━━━━━━━━━━━━━━━━━\n` +
        `_Send a video link to start your streak\\!_`;
    }

    await bot.sendMessage(chatId, streakMsg, { parse_mode: "MarkdownV2" });
  } catch (err) {
    console.error("Streak command error:", err);
  }
});

// ═══════════════════════════════════════════════════════════
//  /gift — send premium to any friend
// ═══════════════════════════════════════════════════════════
bot.onText(/\/gift(?:\s+(.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const giverId = msg.from.id.toString();
  try {
    const giver = await getUser(msg);
    const raw = (match[1] || "").trim();

    // No argument — show usage
    if (!raw) {
      await bot.sendMessage(
        chatId,
        `🎁 *Gift VidVault Premium*\n\n` +
          `Give the gift of unlimited downloads to any friend\\!\n\n` +
          `*How to use:*\n` +
          `\`/gift @username\`\n\n` +
          `_Your friend must have started @VidVaultFreeBot at least once\\._\n\n` +
          `💡 _Tip: They don't need to pay — you cover it for them\\!_`,
        { parse_mode: "MarkdownV2" },
      );
      return;
    }

    // Clean the username (strip leading @)
    const username = raw.replace(/^@/, "").trim();

    // Prevent self-gifting
    const myUsername = (msg.from.username || "").toLowerCase();
    if (username.toLowerCase() === myUsername || username === giverId) {
      await bot.sendMessage(
        chatId,
        `😄 *You can't gift yourself\\!*\n\nShare the love with a friend instead 💙`,
        { parse_mode: "MarkdownV2" },
      );
      return;
    }

    // Look up recipient — must have started the bot (exists in our DB)
    const recipient = await TelegramUser.findOne({
      username: { $regex: new RegExp(`^${username}$`, "i") },
    });

    if (!recipient) {
      await bot.sendMessage(
        chatId,
        `❌ *User @${esc(username)} not found\\!*\n\n` +
          `They haven't started @VidVaultFreeBot yet\\.\n\n` +
          `Ask them to send \`/start\` to @VidVaultFreeBot first, then try again\\!\n\n` +
          `_This is a great excuse to introduce them to VidVault 😊_`,
        { parse_mode: "MarkdownV2" },
      );
      return;
    }

    const recipientName = esc(
      recipient.firstName || recipient.username || "your friend",
    );
    const indian = isIndianUser(giver);

    // Create payment links — recipient's ID in notes so webhook activates them
    const monthlyLink = await createPaymentLink(recipient);
    const annualLink = await createAnnualPaymentLink(recipient);

    // callback_data encodes the recipient's telegramId (≤64 bytes — verified safe)
    const giftMsg =
      `🎁 *Gift Premium to ${recipientName}\\!*\n\n` +
      `✅ Unlimited downloads — instantly activated\n` +
      `✅ 4K Ultra \\+ 1080p \\+ MP3 320k\n` +
      `✅ Valid for 30 days \\(or 1 year\\)\n\n` +
      `_They'll get a surprise notification the moment you pay\\!_ 🎉\n\n` +
      `Choose a plan 👇`;

    const keyboard = indian
      ? {
          inline_keyboard: [
            [{ text: "🎁 Gift Monthly — ₹79", url: monthlyLink }],
            [{ text: "🎁 Gift Annual  — ₹499 (Best Value)", url: annualLink }],
            [
              {
                text: "⭐ Gift with Telegram Stars",
                callback_data: `gift_stars_menu_${recipient.telegramId}`,
              },
            ],
          ],
        }
      : {
          inline_keyboard: [
            [
              {
                text: "⭐ Gift Monthly — 150 Stars",
                callback_data: `gift_stars_monthly_${recipient.telegramId}`,
              },
            ],
            [
              {
                text: "⭐ Gift Annual  — 1000 Stars (Best)",
                callback_data: `gift_stars_annual_${recipient.telegramId}`,
              },
            ],
            [{ text: "🇮🇳 Gift ₹79 (India only)", url: monthlyLink }],
          ],
        };

    await bot.sendMessage(chatId, giftMsg, {
      parse_mode: "MarkdownV2",
      disable_web_page_preview: true,
      reply_markup: keyboard,
    });
  } catch (err) {
    console.error("Gift command error:", err);
  }
});

// ═══════════════════════════════════════════════════════════
//  /referral
// ═══════════════════════════════════════════════════════════
bot.onText(/\/referral/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    const user = await getUser(msg);
    const referralLink = `https://t.me/${BOT_USERNAME}?start=${user.referralCode}`;
    const progress = Math.min(user.referralCount, 10);
    const progressBar = "▓".repeat(progress) + "░".repeat(10 - progress);

    await bot.sendMessage(
      chatId,
      `🎁 *Your Referral Program*\n\n` +
        `Share your link and earn free Premium\\!\n\n` +
        `🔗 *Your link:*\n${escUrl(referralLink)}\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `🎯 *Rewards:*\n` +
        `• Every friend \\= *\\+2 bonus downloads*\n` +
        `• 10 friends \\= *1 month Premium FREE* 🎉\n\n` +
        `📊 *Your progress:*\n` +
        `${progressBar} ${user.referralCount}/10\n\n` +
        `${
          user.referralCount < 10
            ? `🎯 *${10 - user.referralCount} more* to unlock free Premium\\!`
            : `🏆 *Goal reached\\! You earned free Premium\\!*`
        }\n\n` +
        `_Share on WhatsApp, Instagram & more\\!_`,
      { parse_mode: "MarkdownV2" },
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
      `/streak — Your download streak 🔥\n` +
      `/premium — Upgrade\n` +
      `/gift @username — Gift premium to a friend 🎁\n` +
      `/referral — Earn free downloads\n` +
      `/language — Change language 🌍\n` +
      `/help — This message\n` +
      `/support — Contact us\n\n` +
      `🌐 vidvaults\\.com`,
    { parse_mode: "MarkdownV2" },
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
    { parse_mode: "MarkdownV2" },
  );
});

// ═══════════════════════════════════════════════════════════
//  /language  — change language anytime
// ═══════════════════════════════════════════════════════════
bot.onText(/\/language/, async (msg) => {
  const chatId = msg.chat.id;
  const user = await getUser(msg);
  const lang = user.language || "en";
  await bot.sendMessage(chatId, t(lang, "chooseLanguage"), {
    parse_mode: "MarkdownV2",
    reply_markup: getLanguageKeyboard(),
  });
});

// ═══════════════════════════════════════════════════════════
//  /stats  (admin only)
// ═══════════════════════════════════════════════════════════
bot.onText(/\/stats/, async (msg) => {
  if (msg.from.id.toString() !== process.env.TELEGRAM_ADMIN_ID) return;
  try {
    const now = new Date();
    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
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

    // Streak stats — aggregate in one query
    const streakAgg = await TelegramUser.aggregate([
      {
        $group: {
          _id: null,
          avgStreak: { $avg: "$currentStreak" },
          maxStreak: { $max: "$currentStreak" },
          usersOnStreak: {
            $sum: { $cond: [{ $gte: ["$currentStreak", 2] }, 1, 0] },
          },
          streak7plus: {
            $sum: { $cond: [{ $gte: ["$currentStreak", 7] }, 1, 0] },
          },
          streak30plus: {
            $sum: { $cond: [{ $gte: ["$currentStreak", 30] }, 1, 0] },
          },
        },
      },
    ]);
    const sa = streakAgg[0] || {};

    const [revenue, tasteUsed, tasteConverted] = await Promise.all([
      Promise.resolve(premiumUsers * 29),
      TelegramUser.countDocuments({ hasUsed4KTaste: true }),
      TelegramUser.countDocuments({ hasUsed4KTaste: true, plan: "premium" }),
    ]);
    const tasteRate =
      tasteUsed > 0 ? ((tasteConverted / tasteUsed) * 100).toFixed(1) : "0";

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
        `📈 *Conversion rate:* *${esc(totalUsers > 0 ? ((premiumUsers / totalUsers) * 100).toFixed(1) : "0")}%*\n\n` +
        `🎁 *4K Taste*\n` +
        `• Used taste: *${tasteUsed}*\n` +
        `• Converted after taste: *${tasteConverted}* \\(${esc(tasteRate)}%\\)\n\n` +
        `🔥 *Streaks*\n` +
        `• Users on streak \\(2\\+\\): *${sa.usersOnStreak || 0}*\n` +
        `• 7\\+ day streaks: *${sa.streak7plus || 0}*\n` +
        `• 30\\+ day streaks: *${sa.streak30plus || 0}*\n` +
        `• Avg streak: *${esc(sa.avgStreak ? sa.avgStreak.toFixed(1) : "0")} days*\n` +
        `• Longest streak: *${sa.maxStreak || 0} days*`,
      { parse_mode: "MarkdownV2" },
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
    user.plan = "premium";
    user.premiumStartDate = new Date();
    user.premiumEndDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
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
      { parse_mode: "MarkdownV2" },
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
  const text = msg.text?.trim();
  if (!text || text.startsWith("/")) return;

  try {
    const user = await getUser(msg);
    const userId = user.telegramId;

    // ── Video URL ─────────────────────────────────────────
    if (isVideoURL(text)) {
      if (isRateLimited(userId)) {
        await bot.sendMessage(
          chatId,
          t(user.language, "rateLimited", { sec: RATE_LIMIT_SECONDS }),
          { parse_mode: "MarkdownV2" },
        );
        return;
      }

      if (activeUsers.has(userId)) {
        await bot.sendMessage(chatId, t(user.language, "alreadyDownloading"), {
          parse_mode: "MarkdownV2",
        });
        return;
      }

      // Hard limit check — show upgrade wall
      const effectiveLimit = FREE_LIMIT + (user.bonusDownloads || 0);
      if (user.plan === "free" && user.downloadsThisMonth >= effectiveLimit) {
        const days = daysUntilReset(user.monthResetDate);
        const paymentLink = await createPaymentLink(user);
        const indian = isIndianUser(user);
        const english = isEnglishUser(user);
        const streakFomo = getStreakFomoLine(user);

        const wallMsg = indian
          ? `🚫 *Monthly limit reached\\!*\n\n` +
            `You've used all *${effectiveLimit} free downloads* this month\\.\n` +
            `You've downloaded *${user.totalDownloads} videos* total — you clearly love VidVault 💪\n` +
            streakFomo +
            `\n⏳ Wait *${days} days* for free reset\n\n` +
            `OR unlock everything right now:\n` +
            `✅ Unlimited downloads\n` +
            `✅ 4K \\+ 1080p \\+ MP3 320k\n\n` +
            `~₹99~ *₹79/month* — less than one chai ☕`
          : english
            ? `🚫 *Monthly limit reached\\!*\n\n` +
              `You've downloaded *${user.totalDownloads} videos* total 🎬\n` +
              streakFomo +
              `\n⏳ Wait *${days} days* for free reset\n\n` +
              `OR go unlimited right now:\n` +
              `✅ Unlimited downloads\n` +
              `✅ 4K \\+ 1080p \\+ MP3 320k\n\n` +
              `🇮🇳 *₹79/month* \\(India\\) · 🌍 *150 Stars* \\(International\\)`
            : `🚫 *You've reached your limit\\!*\n\n` +
              `You've downloaded *${user.totalDownloads} videos* total — great taste 🎬\n` +
              streakFomo +
              `\n⏳ Wait *${days} days* for free reset\n\n` +
              `OR go unlimited right now:\n` +
              `✅ Unlimited downloads\n` +
              `✅ 4K \\+ 1080p \\+ MP3 320k\n\n` +
              `⭐ *150 Stars/month* — less than a coffee ☕`;

        await bot.sendMessage(chatId, wallMsg, {
          parse_mode: "MarkdownV2",
          disable_web_page_preview: true,
          reply_markup: getPaymentKeyboard(paymentLink, indian, english),
        });
        return;
      }

      // Show loading while fetching metadata
      const loadingMsg = await bot.sendMessage(
        chatId,
        t(user.language, "fetching"),
        { parse_mode: "MarkdownV2" },
      );

      const meta = await fetchMetadata(text);
      const title = meta?.title || "Video";
      const duration = formatDuration(meta?.duration);
      const platform = meta?.platform || "Video";
      const thumb = meta?.thumbnail;

      // Store URL for when user taps quality button
      pendingDownloads.set(userId, {
        url: text,
        chatId,
        timestamp: Date.now(),
      });

      try {
        await bot.deleteMessage(chatId, loadingMsg.message_id);
      } catch {}

      const isPremium = user.plan === "premium";
      const hasTaste = !isPremium && !user.hasUsed4KTaste;
      const effectiveLimitDisplay = FREE_LIMIT + (user.bonusDownloads || 0);
      const remaining = effectiveLimitDisplay - user.downloadsThisMonth;

      const tasteHint = hasTaste
        ? `\n🎁 *Free 4K taste available — tap below\\!*`
        : "";

      const caption =
        `🎬 *${esc(title)}*\n\n` +
        `🌐 Platform: ${esc(platform)}` +
        `${duration ? `  •  ⏱ ${esc(duration)}` : ""}\n\n` +
        `${
          isPremium
            ? `⭐ *Premium* — All qualities unlocked`
            : `🆓 *Free* — ${remaining} download${remaining !== 1 ? "s" : ""} left this month${tasteHint}`
        }\n\n` +
        `👇 *Select quality:*`;

      const msgOptions = {
        parse_mode: "MarkdownV2",
        reply_markup: getQualityKeyboard(isPremium, hasTaste),
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

    // ── Transaction ID (auto-activated via webhook, just reassure user) ──────────
    if (
      !isVideoURL(text) &&
      (text.match(/^pay_[A-Z0-9]{14,}$/i) ||
        text.match(/^order_[A-Z0-9]{14,}$/i) ||
        text.match(/^sub_[A-Z0-9]{14,}$/i))
    ) {
      await bot.sendMessage(
        chatId,
        `✅ *Payment Received\\!*\n\n` +
          `Your premium is activated *automatically* after payment\\.\n\n` +
          `Type /status to check your current plan\\.\n\n` +
          `_If you just paid, it activates within seconds\\. No manual steps needed\\._`,
        { parse_mode: "MarkdownV2" },
      );
      return;
    }

    // ── Unknown message ───────────────────────────────────
    await bot.sendMessage(chatId, t(user.language, "pasteLink"), {
      parse_mode: "MarkdownV2",
    });
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
  const data = query.data;

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
      user.language = selectedLang;
      user.languageSelected = true;
      await user.save();

      await bot.answerCallbackQuery(query.id);
      try {
        await bot.deleteMessage(chatId, query.message.message_id);
      } catch {}

      const firstName = esc(query.from.first_name || "there");
      await bot.sendMessage(chatId, t(selectedLang, "languageSet"), {
        parse_mode: "MarkdownV2",
      });
      await bot.sendMessage(
        chatId,
        t(selectedLang, "welcome", {
          name: firstName,
          isReturning: user.totalDownloads > 0,
          limit: FREE_LIMIT,
        }),
        { parse_mode: "MarkdownV2" },
      );
      return;
    }

    // ── Locked premium button tapped ─────────────────────
    if (data === "locked") {
      await bot.answerCallbackQuery(query.id, {
        text: "👑 Premium quality — you have great taste!",
        show_alert: false,
      });
      const indian = isIndianUser(user);
      const english = isEnglishUser(user);
      const paymentLink = await createPaymentLink(user);
      const annualLink = await createAnnualPaymentLink(user);
      const premiumCount = await getPremiumCount();
      await bot.sendMessage(
        chatId,
        `👑 *You picked 1080p / 4K — great taste\\!*\n\n` +
          `This quality is locked to Premium\\.\n` +
          `*${premiumCount}\\+ members* are downloading in 4K right now\\.\n\n` +
          `✅ Unlimited downloads — no cooldowns\n` +
          `✅ 1080p \\+ 4K \\+ MP3 320k — all unlocked\n` +
          `✅ All 25\\+ platforms\n` +
          `✅ Activates the second you pay\n\n` +
          (indian
            ? `📅 Monthly: *₹${MONTHLY_PRICE_INR}* · 🏆 Annual: *₹${ANNUAL_PRICE_INR}/year*\n_Save ₹${MONTHLY_PRICE_INR * 12 - ANNUAL_PRICE_INR} with annual\\!_ 🔥\n\n`
            : english
              ? `🇮🇳 ₹${MONTHLY_PRICE_INR}/month · 🌍 150 Stars · 🏆 Annual ₹${ANNUAL_PRICE_INR}\n\n`
              : `⭐ 150 Stars/month · 🏆 1000 Stars/year\n\n`) +
          `👇 Choose your plan`,
        {
          parse_mode: "MarkdownV2",
          disable_web_page_preview: true,
          reply_markup: getPaymentKeyboard(
            paymentLink,
            indian,
            english,
            annualLink,
          ),
        },
      );
      return;
    }

    // ── Upgrade button ────────────────────────────────────
    if (data === "upgrade") {
      await bot.answerCallbackQuery(query.id);
      const indian = isIndianUser(user);
      const english = isEnglishUser(user);
      const paymentLink = await createPaymentLink(user);
      const annualLink = await createAnnualPaymentLink(user);
      const premiumCount = await getPremiumCount();
      await bot.sendMessage(
        chatId,
        `⭐ *VidVault Premium*\n\n` +
          `_${premiumCount}\\+ users downloading without limits right now\\._\n\n` +
          `✅ No cooldowns — download any time\n` +
          `✅ 1080p \\+ 4K \\+ MP3 320k\n` +
          `✅ All 25\\+ platforms\n` +
          `✅ Activates instantly after payment\n\n` +
          (indian
            ? `📅 Monthly: *₹${MONTHLY_PRICE_INR}* · 🏆 Annual: *₹${ANNUAL_PRICE_INR}*\n_Save ₹${MONTHLY_PRICE_INR * 12 - ANNUAL_PRICE_INR}/year\\!_ 🔥`
            : english
              ? `🇮🇳 *₹${MONTHLY_PRICE_INR}/month* · 🌍 *150 Stars* · 🏆 *₹${ANNUAL_PRICE_INR}/year*`
              : `⭐ *150 Stars/month* · 🏆 *1000 Stars/year*`),
        {
          parse_mode: "MarkdownV2",
          disable_web_page_preview: true,
          reply_markup: getPaymentKeyboard(
            paymentLink,
            indian,
            english,
            annualLink,
          ),
        },
      );
      return;
    }

    // ── Stars monthly ─────────────────────────────────────
    if (data === "stars_pay" || data === "stars_monthly") {
      await bot.answerCallbackQuery(query.id);
      await sendStarsInvoiceForPlan(chatId, user, "monthly");
      return;
    }

    // ── Stars annual ──────────────────────────────────────
    if (data === "stars_annual") {
      await bot.answerCallbackQuery(query.id);
      await sendStarsInvoiceForPlan(chatId, user, "annual");
      return;
    }

    // ── Stars plan menu (for Indian users who want Stars) ─
    if (data === "stars_plan_menu") {
      await bot.answerCallbackQuery(query.id);
      await bot.sendMessage(
        chatId,
        `⭐ *Pay with Telegram Stars*\n\n` +
          `📅 *Monthly:* 150 Stars \\(≈ \\$2\\)\n` +
          `🏆 *Annual:* 1000 Stars — _save 800 Stars_ 🔥\n\n` +
          `Choose your plan 👇`,
        {
          parse_mode: "MarkdownV2",
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "📅 Monthly — 150 Stars",
                  callback_data: "stars_monthly",
                },
              ],
              [
                {
                  text: "🏆 Annual — 1000 Stars (Best Value)",
                  callback_data: "stars_annual",
                },
              ],
            ],
          },
        },
      );
      return;
    }

    // ── Gift: Stars plan menu (Indian givers who prefer Stars) ───
    if (data.startsWith("gift_stars_menu_")) {
      const recipientId = data.slice("gift_stars_menu_".length);
      await bot.answerCallbackQuery(query.id);
      const rec = await TelegramUser.findOne({
        telegramId: recipientId,
      }).lean();
      const recName = esc(rec?.firstName || rec?.username || "your friend");
      await bot.sendMessage(
        chatId,
        `⭐ *Gift with Telegram Stars*\n\n` +
          `Gifting to: *${recName}*\n\n` +
          `📅 *Monthly:* 150 Stars \\(≈ \\$2\\)\n` +
          `🏆 *Annual:* 1000 Stars — _save 800 Stars_ 🔥\n\n` +
          `Choose a plan 👇`,
        {
          parse_mode: "MarkdownV2",
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "🎁 Gift Monthly — 150 Stars",
                  callback_data: `gift_stars_monthly_${recipientId}`,
                },
              ],
              [
                {
                  text: "🎁 Gift Annual  — 1000 Stars (Best)",
                  callback_data: `gift_stars_annual_${recipientId}`,
                },
              ],
            ],
          },
        },
      );
      return;
    }

    // ── Gift: Stars invoice ───────────────────────────────
    if (
      data.startsWith("gift_stars_monthly_") ||
      data.startsWith("gift_stars_annual_")
    ) {
      const isAnnualGift = data.startsWith("gift_stars_annual_");
      const prefix = isAnnualGift
        ? "gift_stars_annual_"
        : "gift_stars_monthly_";
      const recipientId = data.slice(prefix.length);
      await bot.answerCallbackQuery(query.id);

      const rec = await TelegramUser.findOne({
        telegramId: recipientId,
      }).lean();
      const recName = rec?.firstName || rec?.username || "your friend";

      await bot.sendInvoice(
        chatId,
        isAnnualGift
          ? `🎁 VidVault Premium Gift — 1 Year`
          : `🎁 VidVault Premium Gift — 1 Month`,
        `Gift unlimited downloads to ${recName}! Activates instantly on payment.`,
        `gift_${isAnnualGift ? "annual" : "monthly"}_${recipientId}`,
        "",
        "XTR",
        [
          {
            label: isAnnualGift
              ? "VidVault Premium Gift (1 Year)"
              : "VidVault Premium Gift (1 Month)",
            amount: isAnnualGift ? 1000 : STARS_PRICE,
          },
        ],
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
      await bot.sendMessage(chatId, t(user.language, "sessionExpired"), {
        parse_mode: "MarkdownV2",
      });
      return;
    }

    // Delete keyboard message (photo or text)
    try {
      await bot.deleteMessage(chatId, query.message.message_id);
    } catch {}

    await handleDownload(chatId, user, pending.url, params);
  } catch (err) {
    console.error("Callback query error:", err);
    try {
      await bot.answerCallbackQuery(query.id);
    } catch {}
  }
});

// ═══════════════════════════════════════════════════════════
//  DOWNLOAD HANDLER
// ═══════════════════════════════════════════════════════════
async function handleDownload(chatId, user, url, params) {
  const userId = user.telegramId;
  const { quality, format, label, isTaste = false } = params;

  if (activeUsers.has(userId)) {
    await bot.sendMessage(
      chatId,
      `⏳ Already downloading\\. Please wait for it to finish\\.`,
      { parse_mode: "MarkdownV2" },
    );
    return;
  }
  activeUsers.set(userId, true);

  // Race condition safety — re-check limit
  const effectiveLimit = FREE_LIMIT + (user.bonusDownloads || 0);
  if (user.plan === "free" && user.downloadsThisMonth >= effectiveLimit) {
    activeUsers.delete(userId);
    const days = daysUntilReset(user.monthResetDate);
    const indian = isIndianUser(user);
    const english = isEnglishUser(user);
    const paymentLink = await createPaymentLink(user);
    const annualLink = await createAnnualPaymentLink(user);
    const streakFomo = getStreakFomoLine(user);
    await bot.sendMessage(
      chatId,
      `🚫 *Monthly limit reached\\!*\n\n` +
        `You've used all *${effectiveLimit} free downloads* this month\\.\n` +
        `Resets in *${days} days* — or go unlimited right now 👇\n` +
        streakFomo,
      {
        parse_mode: "MarkdownV2",
        disable_web_page_preview: true,
        reply_markup: getPaymentKeyboard(
          paymentLink,
          indian,
          english,
          annualLink,
        ),
      },
    );
    return;
  }

  // 12-hour cooldown for free users
  if (user.plan === "free") {
    const lastDl = user.lastDownloadAt
      ? new Date(user.lastDownloadAt).getTime()
      : 0;
    const elapsed = Date.now() - lastDl;
    if (elapsed < FREE_COOLDOWN_MS) {
      activeUsers.delete(userId);
      const hoursLeft = Math.ceil(
        (FREE_COOLDOWN_MS - elapsed) / (60 * 60 * 1000),
      );
      const indian = isIndianUser(user);
      const english = isEnglishUser(user);
      const paymentLink = await createPaymentLink(user);
      const annualLink = await createAnnualPaymentLink(user);
      const streakFomo = getStreakFomoLine(user);
      await bot.sendMessage(
        chatId,
        `⏳ *Cooldown — ${hoursLeft}h remaining*\n\n` +
          `Free users can download once every *12 hours*\\.\n` +
          `Next free download in *${hoursLeft} hour${hoursLeft !== 1 ? "s" : ""}*\\.\n\n` +
          `⭐ *Premium* removes all limits — download instantly, unlimited\\.\n` +
          streakFomo,
        {
          parse_mode: "MarkdownV2",
          disable_web_page_preview: true,
          reply_markup: getPaymentKeyboard(
            paymentLink,
            indian,
            english,
            annualLink,
          ),
        },
      );
      return;
    }
  }

  const processingMsg = await bot.sendMessage(
    chatId,
    t(user.language, "processing", { label: esc(label) }),
    { parse_mode: "MarkdownV2" },
  );

  try {
    const response = await axios.post(
      `${API_URL}/api/v1/download/video`,
      { url, quality, format },
      { timeout: 120000 },
    );

    if (response.data.status === "success") {
      const data = response.data.data;

      user.downloadsThisMonth += 1;
      user.totalDownloads += 1;
      user.lastDownloadAt = new Date();

      // Mark taste used — only on successful download, never on failure
      if (isTaste) user.hasUsed4KTaste = true;

      // Update streak before saving — updateStreak mutates user in-place
      const { incremented, milestone } = updateStreak(user);
      await user.save();

      // Milestone reward (async send, don't block download confirmation)
      if (milestone) {
        applyStreakMilestone(chatId, user, milestone)
          .then(() => user.save())
          .catch((err) =>
            console.error("Streak milestone error:", err.message),
          );
      }

      pendingDownloads.delete(userId);
      try {
        await bot.deleteMessage(chatId, processingMsg.message_id);
      } catch {}

      const isPremium = user.plan === "premium";
      const safeTitle = esc(data.title || "Your video");
      const safeUrl = escUrl(encodeURI(data.downloadUrl));

      // Streak line only on day 2+ and only when streak actually incremented today
      const streakLine = getStreakLine(user, incremented);
      // Premium first-download WOW line — only on first ever premium download
      const isFirstPremiumDownload =
        isPremium &&
        user.totalDownloads === 1 &&
        (quality === "high" || quality === "highest");
      // Taste nudge overrides the regular nudge — it's more targeted
      const nudge = isPremium
        ? isFirstPremiumDownload
          ? `\n━━━━━━━━━━━━━━━━━━━━\n👑 *Welcome to Premium\\!*\n_No limits\\. No cooldowns\\. No compromises\\._\n_This is what you unlocked\\. Enjoy every download\\! 🎬_`
          : ""
        : isTaste
          ? getTasteNudge(user)
          : getUpgradeNudge(user.downloadsThisMonth, user);

      await bot.sendMessage(
        chatId,
        t(user.language, "downloadReady", {
          title: safeTitle,
          label: esc(label),
          size: esc(formatSize(data.fileSize)),
          platform: esc(data.platform || "Video"),
          url: safeUrl,
          used: user.downloadsThisMonth,
          limit: FREE_LIMIT + (user.bonusDownloads || 0),
          isPremium,
        }) +
          streakLine +
          nudge,
        { parse_mode: "MarkdownV2" },
      );
    } else {
      throw new Error(response.data.error || "Download failed");
    }
  } catch (err) {
    console.error("Download error:", err.message);
    try {
      await bot.deleteMessage(chatId, processingMsg.message_id);
    } catch {}
    await bot.sendMessage(
      chatId,
      `⚠️ *Couldn't fetch that video right now*\n\n` +
        `This sometimes happens with:\n` +
        `• Private or age\\-restricted videos\n` +
        `• Expired or invalid links\n\n` +
        `Please try again in a moment\\.\n` +
        `Or try on vidvaults\\.com 🌐`,
      { parse_mode: "MarkdownV2" },
    );
  } finally {
    activeUsers.delete(userId);
  }
}

// ═══════════════════════════════════════════════════════════
//  /redeem — coupon code redemption
//  Usage: /redeem VIDVAULT10K
// ═══════════════════════════════════════════════════════════
const COUPONS = {
  VIDVAULT10K: {
    bonus: 10,
    description: "10K Downloads Celebration — 10 bonus downloads",
    expiresAt: new Date("2026-04-13T23:59:59Z").getTime(), // expires April 13
  },
};

bot.onText(/\/redeem(?:\s+(.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  try {
    const user = await getUser(msg);
    const code = match[1]?.trim().toUpperCase();

    if (!code) {
      await bot.sendMessage(
        chatId,
        `🎟 *Redeem a Coupon Code*\n\n` +
          `Usage: \`/redeem CODE\`\n\n` +
          `Example: \`/redeem VIDVAULT10K\``,
        { parse_mode: "MarkdownV2" },
      );
      return;
    }

    const coupon = COUPONS[code];
    if (!coupon) {
      await bot.sendMessage(
        chatId,
        `❌ *Invalid coupon code*\n\nCode \`${esc(code)}\` not found\\.\nCheck spelling and try again\\.`,
        { parse_mode: "MarkdownV2" },
      );
      return;
    }

    // Check expiry
    if (coupon.expiresAt && Date.now() > coupon.expiresAt) {
      await bot.sendMessage(
        chatId,
        `⏰ *Coupon expired*\n\nCode \`${esc(code)}\` was a limited\\-time offer and has now expired\\.\n\nStay tuned for future promotions\\! 🎁`,
        { parse_mode: "MarkdownV2" },
      );
      return;
    }

    // Check if already used
    if ((user.usedCoupons || []).includes(code)) {
      await bot.sendMessage(
        chatId,
        `⚠️ *Already redeemed*\n\nYou've already used coupon \`${esc(code)}\`\\.\nEach code can only be used once per account\\.`,
        { parse_mode: "MarkdownV2" },
      );
      return;
    }

    // Apply bonus
    user.bonusDownloads = (user.bonusDownloads || 0) + coupon.bonus;
    if (!user.usedCoupons) user.usedCoupons = [];
    user.usedCoupons.push(code);
    await user.save();

    const newLimit = FREE_LIMIT + user.bonusDownloads;
    await bot.sendMessage(
      chatId,
      `🎉 *Coupon redeemed\\!*\n\n` +
        `✅ Code: \`${esc(code)}\`\n` +
        `🎁 Bonus: *\\+${coupon.bonus} downloads* added\\!\n\n` +
        `📊 Your new monthly limit: *${newLimit} downloads*\n\n` +
        `Thank you for being part of VidVault\\! 🙏`,
      { parse_mode: "MarkdownV2" },
    );
  } catch (err) {
    console.error("Redeem error:", err.message);
    await bot.sendMessage(
      chatId,
      `❌ Something went wrong\\. Please try again\\.`,
      { parse_mode: "MarkdownV2" },
    );
  }
});

// ═══════════════════════════════════════════════════════════
//  /broadcast — admin manual broadcast trigger
// ═══════════════════════════════════════════════════════════
bot.onText(/\/broadcast(?:\s+(.+))?/, async (msg, match) => {
  if (msg.from.id.toString() !== process.env.TELEGRAM_ADMIN_ID) return;
  const chatId = msg.chat.id;
  const sub = (match[1] || "").trim().toLowerCase();

  if (sub === "friday") {
    await bot.sendMessage(chatId, `📤 Starting Friday broadcast\\.\\.\\.`, {
      parse_mode: "MarkdownV2",
    });
    runFridayBroadcast().catch((e) =>
      bot.sendMessage(chatId, `❌ ${esc(e.message)}`),
    );
  } else if (sub === "monthend") {
    await bot.sendMessage(
      chatId,
      `📤 Starting month\\-end broadcast\\.\\.\\.`,
      { parse_mode: "MarkdownV2" },
    );
    runMonthEndBroadcast().catch((e) =>
      bot.sendMessage(chatId, `❌ ${esc(e.message)}`),
    );
  } else if (sub === "winback") {
    await bot.sendMessage(chatId, `📤 Starting win\\-back broadcast\\.\\.\\.`, {
      parse_mode: "MarkdownV2",
    });
    runWinBackBroadcast().catch((e) =>
      bot.sendMessage(chatId, `❌ ${esc(e.message)}`),
    );
  } else if (sub === "test") {
    // Preview: send only to admin
    await bot.sendMessage(
      chatId,
      `🎉 *Weekend Special\\!*\n\n` +
        `✅ Unlimited downloads\n` +
        `✅ 4K Ultra \\+ 1080p \\+ MP3 320k\n\n` +
        `~₹99~ *₹79/month* — less than one chai ☕\n\n👉 /premium`,
      { parse_mode: "MarkdownV2" },
    );
    await bot.sendMessage(
      chatId,
      `_This is what the Friday broadcast looks like\\._`,
      { parse_mode: "MarkdownV2" },
    );
  } else {
    await bot.sendMessage(
      chatId,
      `📤 *Manual Broadcast Commands:*\n\n` +
        `/broadcast friday — Weekend deal to all free users\n` +
        `/broadcast monthend — Month\\-end urgency \\(28th\\)\n` +
        `/broadcast winback — 7\\-day inactive users\n` +
        `/broadcast test — Preview the message \\(admin only\\)\n\n` +
        `_All broadcasts skip premium and blocked users\\._\n` +
        `_Each user gets at most 1 broadcast per day\\._`,
      { parse_mode: "MarkdownV2" },
    );
  }
});

// ═══════════════════════════════════════════════════════════
//  /broadcast10k — admin-only mass celebration message
//  Only works for TELEGRAM_ADMIN_ID
// ═══════════════════════════════════════════════════════════
bot.onText(/\/broadcast10k/, async (msg) => {
  const chatId = msg.chat.id;
  const senderId = msg.from.id.toString();
  const adminId = process.env.TELEGRAM_ADMIN_ID;

  if (senderId !== adminId) {
    await bot.sendMessage(chatId, `❌ Admin only command\\.`, {
      parse_mode: "MarkdownV2",
    });
    return;
  }

  await bot.sendMessage(
    chatId,
    `📤 Starting broadcast to all users\\. This will take a few minutes\\.`,
    { parse_mode: "MarkdownV2" },
  );

  const celebrationMessage =
    `🎉 *VidVault just hit 10,000 Downloads\\!*\n\n` +
    `Thank you for being part of this journey\\! 🙏\n\n` +
    `To celebrate, we're giving *every user 10 bonus downloads* FREE\\!\n\n` +
    `👉 Use coupon code: \`VIDVAULT10K\`\n` +
    `Just type: \`/redeem VIDVAULT10K\`\n\n` +
    `🎁 *\\+10 free downloads added instantly\\!*\n\n` +
    `Share VidVault with friends:\n` +
    `🌐 vidvaults\\.com\n` +
    `📱 @VidVaultFreeBot`;

  try {
    // Fetch all users in batches to avoid memory issues
    // TelegramUser is already imported at the top of this file
    const totalUsers = await TelegramUser.countDocuments({});
    let sent = 0,
      failed = 0,
      batchSize = 30;

    for (let skip = 0; skip < totalUsers; skip += batchSize) {
      const users = await TelegramUser.find({})
        .skip(skip)
        .limit(batchSize)
        .lean();
      for (const u of users) {
        try {
          await bot.sendMessage(u.telegramId, celebrationMessage, {
            parse_mode: "MarkdownV2",
          });
          sent++;
          // Telegram rate limit: 30 messages/sec max — add small delay
          await new Promise((r) => setTimeout(r, 50));
        } catch {
          failed++;
        }
      }
    }

    await bot.sendMessage(
      chatId,
      `✅ *Broadcast complete\\!*\n\n📤 Sent: *${sent}*\n❌ Failed: *${failed}*\n👥 Total: *${totalUsers}*`,
      { parse_mode: "MarkdownV2" },
    );
  } catch (err) {
    console.error("Broadcast error:", err.message);
    await bot.sendMessage(chatId, `❌ Broadcast failed: ${esc(err.message)}`, {
      parse_mode: "MarkdownV2",
    });
  }
});

// ═══════════════════════════════════════════════════════════
//  TELEGRAM STARS — pre_checkout_query
//  Telegram calls this before charging — we MUST answer within 10s
// ═══════════════════════════════════════════════════════════
bot.on("pre_checkout_query", async (query) => {
  try {
    // Always approve — Telegram requires this within 10 seconds
    await bot.answerPreCheckoutQuery(query.id, true);
  } catch (err) {
    console.error("pre_checkout_query error:", err.message);
    // If we fail to answer, Telegram will cancel the payment automatically
  }
});

// ═══════════════════════════════════════════════════════════
//  TELEGRAM STARS — successful_payment
//  Fires after Stars are actually charged — activate premium here
// ═══════════════════════════════════════════════════════════
bot.on("message", async (msg) => {
  if (!msg.successful_payment) return;

  const chatId = msg.chat.id;
  const giverId = msg.from.id.toString();
  const payment = msg.successful_payment;

  try {
    if (payment.currency !== "XTR") return;

    const payload = payment.invoice_payload || "";
    const isGift = payload.startsWith("gift_");
    const isAnnual = payload.includes("annual");
    const days = isAnnual ? 365 : 30;
    const adminId = process.env.TELEGRAM_ADMIN_ID;

    // Determine who receives premium: recipient for gifts, giver for self-purchase
    let recipientId;
    if (isGift) {
      // payload format: "gift_monthly_123456789" or "gift_annual_123456789"
      const parts = payload.split("_");
      recipientId = parts[parts.length - 1];
    } else {
      recipientId = giverId;
    }

    // Find or create recipient account
    let recipient = await TelegramUser.findOne({ telegramId: recipientId });
    if (!recipient) {
      recipient = new TelegramUser({ telegramId: recipientId });
      recipient.generateReferralCode();
    }

    // EXTEND premium — never reset remaining days
    const now = Date.now();
    const currentExpiry = recipient.premiumEndDate
      ? new Date(recipient.premiumEndDate).getTime()
      : now;
    const base = currentExpiry > now ? currentExpiry : now;
    recipient.plan = "premium";
    recipient.premiumStartDate = recipient.premiumStartDate || new Date();
    recipient.premiumEndDate = new Date(base + days * 24 * 60 * 60 * 1000);
    await recipient.save();

    console.log(
      `⭐ Stars ${isGift ? "gift" : "purchase"}: ${giverId} paid ${payment.total_amount} Stars → ${recipientId} premium activated`,
    );

    if (isGift && recipientId !== giverId) {
      // ── Gift flow ──────────────────────────────────────────
      const giver = await TelegramUser.findOne({ telegramId: giverId }).lean();
      const giverName = esc(giver?.firstName || giver?.username || "Someone");

      // Notify recipient — surprise!
      bot
        .sendMessage(
          recipientId,
          `🎁 *You received a VidVault Premium Gift\\!*\n\n` +
            `*${giverName}* gifted you *${days} days of Premium* 🎉\n\n` +
            `✅ Unlimited downloads — NOW ACTIVE\n` +
            `✅ 4K Ultra \\+ 1080p \\+ MP3 320k\n` +
            `✅ Valid for *${days} days*${isAnnual ? " 🏆" : ""}\n\n` +
            `Just send any video link to start\\! 🎬\n` +
            `_Type /status to see your account_`,
          { parse_mode: "MarkdownV2" },
        )
        .catch(() => {});

      // Confirm to giver
      await bot.sendMessage(
        chatId,
        `✅ *Gift Sent Successfully\\!*\n\n` +
          `🎁 *${days} days of Premium* has been gifted\\!\n` +
          `They've been notified instantly 🎉\n\n` +
          `_Thank you for spreading VidVault\\! 💙_`,
        { parse_mode: "MarkdownV2" },
      );

      // Notify admin
      if (adminId) {
        bot
          .sendMessage(
            adminId,
            `🎁 *Gift Purchase\\!*\n\n` +
              `From: \`${giverId}\`\n` +
              `To: \`${recipientId}\`\n` +
              `⭐ Stars: *${payment.total_amount}*\n` +
              `📦 Plan: *${isAnnual ? "Annual 🏆" : "Monthly"}*`,
            { parse_mode: "MarkdownV2" },
          )
          .catch(() => {});
      }
    } else {
      // ── Normal self-purchase ───────────────────────────────
      if (adminId) {
        bot
          .sendMessage(
            adminId,
            `⭐ *Stars Payment Received\\!*\n\n` +
              `👤 User: ${esc(recipient.firstName || recipient.username || giverId)} \\(@${esc(recipient.username || "unknown")}\\)\n` +
              `🆔 ID: \`${giverId}\`\n` +
              `⭐ Stars: *${payment.total_amount}*\n` +
              `📦 Plan: *${isAnnual ? "Annual 🏆" : "Monthly"}*\n` +
              `📅 Expires: ${new Date(recipient.premiumEndDate).toDateString()}`,
            { parse_mode: "MarkdownV2" },
          )
          .catch(() => {});
      }

      await bot.sendMessage(
        chatId,
        `🎉 *Payment Successful\\!*\n\n` +
          `⭐ Thank you for *${payment.total_amount} Stars\\!*\n\n` +
          `✅ *VidVault Premium is now ACTIVE*\n\n` +
          `🚀 Unlimited downloads\n` +
          `🎬 4K Ultra \\+ 1080p quality\n` +
          `🎵 MP3 320k audio\n` +
          `✅ Valid for *${days} days*${isAnnual ? " 🏆" : ""}\n\n` +
          `Just send any video link to start\\! 🎬\n` +
          `_Type /status to check your account_`,
        { parse_mode: "MarkdownV2" },
      );
    }
  } catch (err) {
    console.error("successful_payment error:", err.message);
  }
});

// ═══════════════════════════════════════════════════════════
//  GROUP CHAT
// ═══════════════════════════════════════════════════════════
bot.on("new_chat_members", async (msg) => {
  if (
    msg.new_chat_members?.some((m) => m.is_bot && m.username === BOT_USERNAME)
  ) {
    await bot.sendMessage(
      msg.chat.id,
      `👋 Hi\\! I'm VidVault Bot\\!\n\nI work best in private chat\\.\n👉 @${BOT_USERNAME}`,
      { parse_mode: "MarkdownV2" },
    );
  }
});

module.exports = bot;
