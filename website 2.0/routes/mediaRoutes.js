const express = require('express');
const router = express.Router();
const mediaService = require('../services/mediaService');
const db = require('../services/db');
const { requireAuth } = require('./authRoutes');

// Resolve media metadata & available qualities from input URL
router.post('/resolve', async (req, res) => {
  const { url } = req.body;
  const parsed = mediaService.parseUrl(url);

  if (!parsed.valid) {
    return res.status(400).json({ success: false, error: parsed.error });
  }

  try {
    const media = await mediaService.resolveMedia(parsed);

    // If user is authenticated, pre-generate secure signed download tokens for each quality
    let userId = 'anonymous';
    let tokenAuthHeader = req.headers['authorization'];
    // Optional auth extraction without blocking unauthenticated preview
    if (req.cookies?.token || (tokenAuthHeader && tokenAuthHeader.startsWith('Bearer '))) {
      try {
        const jwt = require('jsonwebtoken');
        const JWT_SECRET = process.env.JWT_SECRET || 'pulsegrab-super-secret-key-2026-secure';
        const raw = req.cookies?.token || tokenAuthHeader.substring(7);
        const decoded = jwt.verify(raw, JWT_SECRET);
        userId = decoded.id;
      } catch (e) {}
    }

    const streamsWithTokens = media.streams.map(stream => ({
      ...stream,
      downloadToken: mediaService.createDownloadToken(userId, media.id, stream.quality, stream.isHighQuality)
    }));

    res.json({
      success: true,
      media: {
        ...media,
        streams: streamsWithTokens
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to process media URL: ' + err.message });
  }
});

// Stream video/audio file for direct browser download
router.get('/stream', (req, res) => {
  const { token, title, quality, ext } = req.query;

  if (!token) {
    return res.status(400).send('Missing download verification token');
  }

  const verified = mediaService.verifyDownloadToken(token);
  if (!verified) {
    return res.status(403).send('Invalid or expired download token');
  }

  const fileExt = ext === 'mp3' ? 'mp3' : 'mp4';
  const cleanTitle = (title || 'PulseGrab_Media').replace(/[^a-zA-Z0-9_\-]/g, '_');
  const filename = `${cleanTitle}_${quality || '720p'}.${fileExt}`;
  const contentType = fileExt === 'mp3' ? 'audio/mpeg' : 'video/mp4';

  const buffer = mediaService.generateMediaBuffer(title || 'Media Video', quality || '720p', fileExt);

  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', buffer.length);
  res.setHeader('Cache-Control', 'no-cache');
  res.send(buffer);
});

// Secure endpoint to confirm download completion & claim coin reward
router.post('/claim-reward', requireAuth, (req, res) => {
  const { downloadToken, url, title, platform, quality } = req.body;
  const user = req.user;
  const userIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';

  if (!downloadToken) {
    return res.status(400).json({ success: false, error: 'Missing signed download token' });
  }

  const verified = mediaService.verifyDownloadToken(downloadToken);
  if (!verified) {
    return res.status(403).json({ success: false, error: 'Invalid or forged download verification signature' });
  }

  const isHighQuality = (quality === '720p' || quality === '1080p');
  const dailyStats = db.getUserDailyStats(user.id);

  let coinsToAward = 0;
  let reason = '';

  // Rule 1: Only 720p or 1080p yield coins (480p or audio yield 0 coins)
  if (!isHighQuality) {
    coinsToAward = 0;
    reason = 'Standard quality or audio download (0 coins)';
  } else {
    // Rule 2: Daily cap at 250 coins / 25 downloads counted
    if (dailyStats.coinsEarned >= 250 || dailyStats.downloadsCount >= 25) {
      coinsToAward = 0;
      reason = 'Daily reward limit reached (250/250 coins). Resets at 4:00 AM IST.';
    } else {
      coinsToAward = 10;
      reason = '+10 Coins awarded for High Definition download!';
    }
  }

  // Record daily stats
  db.recordUserDailyDownload(user.id, coinsToAward);

  // Add permanent download history record
  const downloadRecord = db.addDownload({
    userId: user.id,
    userIp,
    url: url || 'https://youtube.com',
    title: title || 'Video Stream',
    platform: platform || 'youtube',
    quality: quality || '720p',
    isHighQuality,
    coinsAwarded: coinsToAward
  });

  // Referral Verification Milestone Check:
  // "The user who shared the referral link earns 250 coins ONLY when their referred user successfully completes 3 high-quality downloads (720p or above)."
  let referralBonusTriggered = false;
  let referrerBonusInfo = null;

  if (isHighQuality && user.referredBy) {
    const referralRecord = db.getReferralByReferredUser(user.id);
    if (referralRecord && referralRecord.status === 'pending') {
      const updatedHQCount = (referralRecord.highQualityDownloadsCount || 0) + 1;
      db.updateReferral(referralRecord.id, {
        highQualityDownloadsCount: updatedHQCount
      });

      if (updatedHQCount >= 3) {
        // Milestone reached! Check referrer's daily referral limit (Cap of 1,000 coins per day)
        const referrer = db.getUserById(referralRecord.referrerId);
        if (referrer && !referrer.isBanned) {
          const referrerDailyStats = db.getUserDailyStats(referrer.id);
          const maxReferralCap = 1000;
          const currentReferralCoins = referrerDailyStats.referralCoinsEarned || 0;

          if (currentReferralCoins < maxReferralCap) {
            const bonus = Math.min(250, maxReferralCap - currentReferralCoins);
            referrer.coins = (referrer.coins || 0) + bonus;
            referrer.lifetimeEarned = (referrer.lifetimeEarned || 0) + bonus;
            db.recordUserDailyReferralBonus(referrer.id, bonus);

            db.updateReferral(referralRecord.id, {
              status: 'completed',
              bonusAwarded: bonus,
              completedAt: new Date().toISOString()
            });

            referralBonusTriggered = true;
            referrerBonusInfo = { referrerId: referrer.id, bonusAwarded: bonus };
          } else {
            // Referrer reached 1000 daily referral cap
            db.updateReferral(referralRecord.id, {
              status: 'completed',
              bonusAwarded: 0,
              completedAt: new Date().toISOString()
            });
          }
        }
      }
    }
  }

  // Reload updated user
  const updatedUser = db.getUserById(user.id);
  const updatedStats = db.getUserDailyStats(user.id);

  res.json({
    success: true,
    coinsAwarded: coinsToAward,
    reason,
    newBalance: updatedUser.coins,
    dailyStats: updatedStats,
    downloadRecord,
    referralBonusTriggered,
    referrerBonusInfo
  });
});

module.exports = router;
