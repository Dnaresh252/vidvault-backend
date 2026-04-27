const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const TelegramUser = require('../models/TelegramUser');
const bot = require('../services/telegramBot');

const RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;

// ─── Dedup: track processed payment IDs to prevent double activation ─────────
const processedPayments = new Set();
// Auto-clear after 24 hours to prevent memory leak
setInterval(() => processedPayments.clear(), 24 * 60 * 60 * 1000);

// ─── Razorpay Webhook ─────────────────────────────────────────────────────────
router.post('/razorpay', async (req, res) => {
  try {
    // ── Step 1: Verify HMAC signature — only Razorpay can generate this ──────
    const signature = req.headers['x-razorpay-signature'];

    if (!signature) {
      console.log('❌ Webhook: missing signature header');
      return res.status(400).json({ error: 'Missing signature' });
    }

    const rawBody = req.body instanceof Buffer
      ? req.body.toString('utf8')
      : JSON.stringify(req.body);

    const expectedSignature = crypto
      .createHmac('sha256', RAZORPAY_WEBHOOK_SECRET)
      .update(rawBody)
      .digest('hex');

    if (signature !== expectedSignature) {
      console.log('❌ Webhook signature mismatch — blocked');
      return res.status(400).json({ error: 'Invalid signature' });
    }

    // ── Step 2: Parse event ───────────────────────────────────────────────────
    const event = JSON.parse(rawBody);
    console.log(`📦 Razorpay webhook: ${event.event}`);

    // ── Step 3: Payment captured or subscription activated ───────────────────
    if (
      event.event === 'payment.captured' ||
      event.event === 'subscription.activated'
    ) {
      const payment      = event.payload.payment?.entity;
      const subscription = event.payload.subscription?.entity;
      const notes        = payment?.notes || subscription?.notes || {};
      const telegramId   = notes.telegram_id;
      const paymentId    = payment?.id || subscription?.id;

      // Guard: must have telegram ID
      if (!telegramId) {
        console.log('⚠️ Webhook: no telegram_id in payment notes');
        return res.status(200).json({ status: 'ok' });
      }

      // Guard: dedup — Razorpay retries webhooks on failure, don't double-activate
      if (paymentId && processedPayments.has(paymentId)) {
        console.log(`⚠️ Webhook: duplicate event for ${paymentId} — skipped`);
        return res.status(200).json({ status: 'ok' });
      }
      if (paymentId) processedPayments.add(paymentId);

      // Guard: verify payment status is actually captured/active
      const status = payment?.status || subscription?.status;
      if (status && !['captured', 'active', 'authenticated'].includes(status)) {
        console.log(`⚠️ Webhook: payment status is ${status} — not activating`);
        return res.status(200).json({ status: 'ok' });
      }

      const isGift      = notes.is_gift === 'true';
      const giftFromId  = notes.gift_from_id || null;
      const isAnnual    = notes.plan_type === 'annual' || (payment?.amount >= 24900);
      const days        = isAnnual ? 365 : 30;

      // Activate premium for recipient (telegramId = recipient for gifts)
      let user = await TelegramUser.findOne({ telegramId });
      if (!user) {
        user = new TelegramUser({ telegramId });
        user.generateReferralCode();
      }

      const wasAlreadyPremium = user.plan === 'premium';
      // Extend from current expiry if still active — never lose remaining days
      const now           = Date.now();
      const currentExpiry = user.premiumEndDate ? new Date(user.premiumEndDate).getTime() : now;
      const base          = currentExpiry > now ? currentExpiry : now;
      user.plan             = 'premium';
      user.premiumStartDate = user.premiumStartDate || new Date();
      user.premiumEndDate   = new Date(base + days * 24 * 60 * 60 * 1000);
      await user.save();

      console.log(`✅ Premium ${isGift ? 'gift' : 'activated'} for Telegram ID: ${telegramId} | Payment: ${paymentId}`);

      // Notify recipient
      try {
        await bot.sendMessage(
          telegramId,
          isGift
            ? `🎁 *You received a VidVault Premium Gift\\!*\n\n` +
              `Someone gifted you *${days} days of Premium* 🎉\n\n` +
              `✅ Unlimited downloads — NOW ACTIVE\n` +
              `✅ 1080p \\+ 4K quality\n` +
              `✅ Valid for *${days} days*${isAnnual ? ' 🏆' : ''}\n\n` +
              `Just send any video link to start\\! 🎬`
            : `🎉 *Premium Activated\\!*\n\n` +
              `Welcome to VidVault Premium\\! ⭐\n\n` +
              `✅ Unlimited downloads\n` +
              `✅ 1080p \\+ 4K quality\n` +
              `✅ Priority speed\n` +
              `✅ Valid for *${days} days*${isAnnual ? ' 🏆' : ''}\n\n` +
              `Just send any video link to start\\! 🎬`,
          { parse_mode: 'MarkdownV2' }
        );
      } catch (err) {
        console.error('Failed to notify recipient:', err.message);
      }

      // If gift: confirm to the giver too
      if (isGift && giftFromId) {
        try {
          await bot.sendMessage(
            giftFromId,
            `✅ *Gift Sent\\!*\n\n` +
            `🎁 *${days} days of Premium* has been activated for your friend\\!\n` +
            `They've been notified 🎉\n\n` +
            `_Thank you for spreading VidVault\\! 💙_`,
            { parse_mode: 'MarkdownV2' }
          );
        } catch (err) {
          console.error('Failed to notify giver:', err.message);
        }
      }

      // Notify admin
      const adminId = process.env.TELEGRAM_ADMIN_ID;
      if (adminId) {
        try {
          await bot.sendMessage(
            adminId,
            isGift
              ? `🎁 *Gift Purchase\\!*\n\n` +
                `From: \`${giftFromId || 'Unknown'}\`\n` +
                `To: \`${telegramId}\`\n` +
                `Payment ID: \`${paymentId || 'N/A'}\`\n` +
                `Amount: ${isAnnual ? '₹249 \\(Annual\\)' : '₹29 \\(Monthly\\)'}`
              : `💰 *New Premium Subscription\\!*\n\n` +
                `Telegram ID: \`${telegramId}\`\n` +
                `Username: ${esc(notes.username || 'Unknown')}\n` +
                `Payment ID: \`${paymentId || 'N/A'}\`\n` +
                `Amount: ${isAnnual ? '₹249 \\(Annual\\)' : '₹29 \\(Monthly\\)'}\n` +
                `Renewal: ${wasAlreadyPremium ? 'Yes ♻️' : 'No 🆕'}\n` +
                `Status: Auto\\-activated ✅`,
            { parse_mode: 'MarkdownV2' }
          );
        } catch (err) {
          console.error('Failed to notify admin:', err.message);
        }
      }
    }

    // ── Step 4: Subscription charged (renewal) ────────────────────────────────
    if (event.event === 'subscription.charged') {
      const subscription = event.payload.subscription?.entity;
      const payment      = event.payload.payment?.entity;
      const notes        = subscription?.notes || payment?.notes || {};
      const telegramId   = notes.telegram_id;
      const paymentId    = payment?.id;

      if (telegramId) {
        if (paymentId && processedPayments.has(paymentId)) {
          return res.status(200).json({ status: 'ok' });
        }
        if (paymentId) processedPayments.add(paymentId);

        const user = await TelegramUser.findOne({ telegramId });
        if (user) {
          user.plan             = 'premium';
          user.premiumStartDate = new Date();
          user.premiumEndDate   = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
          await user.save();
          console.log(`♻️ Premium renewed for Telegram ID: ${telegramId}`);

          try {
            await bot.sendMessage(
              telegramId,
              `♻️ *Premium Renewed\\!*\n\n` +
              `Your VidVault Premium has been renewed for another 30 days\\. ⭐\n\n` +
              `Keep downloading\\! 🎬`,
              { parse_mode: 'MarkdownV2' }
            );
          } catch {}
        }
      }
    }

    // ── Step 5: Subscription cancelled ───────────────────────────────────────
    if (event.event === 'subscription.cancelled') {
      const subscription = event.payload.subscription?.entity;
      const notes        = subscription?.notes || {};
      const telegramId   = notes.telegram_id;

      if (telegramId) {
        const user = await TelegramUser.findOne({ telegramId });
        if (user && user.plan === 'premium') {
          // Don't immediately downgrade — let them use until period ends
          // Just log it; a cron job checks premiumEndDate daily
          console.log(`🔔 Subscription cancelled for: ${telegramId} — access until ${user.premiumEndDate}`);

          try {
            await bot.sendMessage(
              telegramId,
              `😢 *Subscription Cancelled*\n\n` +
              `Your VidVault Premium subscription has been cancelled\\.\n\n` +
              `You still have full access until *${user.premiumEndDate.toDateString()}*\\.\n\n` +
              `Type /premium to resubscribe anytime 🙏`,
              { parse_mode: 'MarkdownV2' }
            );
          } catch {}
        }
      }
    }

    // ── Step 6: Payment failed ────────────────────────────────────────────────
    if (event.event === 'payment.failed') {
      const payment    = event.payload.payment?.entity;
      const notes      = payment?.notes || {};
      const telegramId = notes.telegram_id;

      if (telegramId) {
        console.log(`❌ Payment failed for Telegram ID: ${telegramId}`);
        try {
          await bot.sendMessage(
            telegramId,
            `❌ *Payment Failed*\n\n` +
            `Your payment could not be processed\\.\n\n` +
            `Please try again: /premium`,
            { parse_mode: 'MarkdownV2' }
          );
        } catch {}
      }
    }

    res.status(200).json({ status: 'ok' });

  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: 'Internal error' });
  }
});

function esc(text) {
  if (!text) return '';
  return String(text).replace(/[_*[\]()~`>#+=|{}.!\-\\]/g, '\\$&');
}

module.exports = router;
