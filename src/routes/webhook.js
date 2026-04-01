const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const TelegramUser = require('../models/TelegramUser');
const bot = require('../services/telegramBot');

const RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;

// ─── Razorpay Webhook ─────────────────────────────────────
router.post('/razorpay', async (req, res) => {
  try {
    // ✅ Step 1: Verify signature (fraud prevention)
    const signature = req.headers['x-razorpay-signature'];
    const rawBody = req.body instanceof Buffer ? req.body.toString('utf8') : JSON.stringify(req.body);

    const expectedSignature = crypto
      .createHmac('sha256', RAZORPAY_WEBHOOK_SECRET)
      .update(rawBody)
      .digest('hex');

    if (signature !== expectedSignature) {
      console.log('❌ Webhook signature mismatch — possible fraud!');
      return res.status(400).json({ error: 'Invalid signature' });
    }

    // ✅ Step 2: Parse the event
    const event = JSON.parse(rawBody);
    console.log(`📦 Razorpay webhook: ${event.event}`);

    // ✅ Step 3: Handle payment captured / subscription activated
    if (
      event.event === 'subscription.activated' ||
      event.event === 'payment.captured'
    ) {
      const payment = event.payload.payment?.entity;
      const subscription = event.payload.subscription?.entity;

      const notes = payment?.notes || subscription?.notes || {};
      const telegramId = notes.telegram_id;

      if (!telegramId) {
        console.log('⚠️ No telegram ID in payment notes');
        return res.status(200).json({ status: 'ok' });
      }

      // ✅ Step 4: Activate premium
      let user = await TelegramUser.findOne({ telegramId });

      if (!user) {
        user = new TelegramUser({ telegramId });
        user.generateReferralCode();
      }

      user.plan = 'premium';
      user.premiumStartDate = new Date();
      user.premiumEndDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      await user.save();

      console.log(`✅ Premium activated for Telegram ID: ${telegramId}`);

      // ✅ Step 5: Notify user on Telegram
      try {
        await bot.sendMessage(
          telegramId,
          `🎉 *Premium Activated Successfully!*\n\n` +
          `Welcome to VidVault Premium! ⭐\n\n` +
          `✅ Unlimited downloads\n` +
          `✅ 1080p + 4K quality\n` +
          `✅ Priority speed\n` +
          `✅ Valid for 30 days\n\n` +
          `Start downloading now — just send any video link! 🎬`,
          { parse_mode: 'Markdown' }
        );
      } catch (err) {
        console.error('Failed to notify user:', err.message);
      }

      // ✅ Step 6: Notify admin
      const adminId = process.env.TELEGRAM_ADMIN_ID;
      if (adminId) {
        await bot.sendMessage(
          adminId,
          `💰 *New Premium Subscription!*\n\n` +
          `Telegram ID: \`${telegramId}\`\n` +
          `Username: ${notes.username || 'Unknown'}\n` +
          `Amount: ₹29\n` +
          `Status: Auto\\-activated ✅`,
          { parse_mode: 'Markdown' }
        );
      }
    }

    // ✅ Step 7: Handle subscription cancelled
    if (event.event === 'subscription.cancelled') {
      const subscription = event.payload.subscription?.entity;
      const notes = subscription?.notes || {};
      const telegramId = notes.telegram_id;

      if (telegramId) {
        const user = await TelegramUser.findOne({ telegramId });
        if (user) {
          user.plan = 'free';
          await user.save();

          await bot.sendMessage(
            telegramId,
            `😢 *Premium Cancelled*\n\n` +
            `Your VidVault Premium has been cancelled.\n\n` +
            `You still have access until your current period ends.\n\n` +
            `Type /premium to resubscribe anytime 🙏`,
            { parse_mode: 'Markdown' }
          );
        }
      }
    }

    res.status(200).json({ status: 'ok' });

  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: 'Internal error' });
  }
});

module.exports = router;
