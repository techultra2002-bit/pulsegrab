const express = require('express');
const router = express.Router();
const mediaService = require('../services/mediaService');
const db = require('../services/db');
const { requireAuth } = require('./authRoutes');

// =========================================================
// POST /api/media/resolve
// Accepts user's URL, resolves real metadata + download tokens.
// All state is LOCAL to this handler. Zero global pollution.
// =========================================================
router.post('/resolve', async (req, res) => {
  // Isolate URL from request body only (no global variables touched)
  const { url } = req.body;

  if (!url || typeof url !== 'string' || !url.trim()) {
    return res.status(400).json({ success: false, error: 'Please provide a valid URL.' });
  }

  const parsed = mediaService.parseUrl(url.trim());

  if (!parsed.valid) {
    return res.status(400).json({ success: false, error: parsed.error });
  }

  try {
    // Fresh lookup on every request - no caching, no shared state
    const media = await mediaService.resolveMedia(parsed);

    // Authenticate user if token present (optional - doesn't block preview)
    let userId = 'anonymous';
    const authHeader = req.headers['authorization'];
    if (req.cookies?.token || (authHeader && authHeader.startsWith('Bearer '))) {
      try {
        const jwt = require('jsonwebtoken');
        const JWT_SECRET = process.env.JWT_SECRET || 'pulsegrab-super-secret-key-2026-secure';
        const raw = req.cookies?.token || authHeader.substring(7);
        const decoded = jwt.verify(raw, JWT_SECRET);
        userId = decoded.id;
      } catch (e) {
        // Token invalid/expired - continue as anonymous
      }
    }

    // Attach a fresh signed token per quality stream (carries formatId + directUrl + originalUrl)
    const streamsWithTokens = media.streams.map(stream => ({
      ...stream,
      downloadToken: mediaService.createDownloadToken(
        userId,
        media.id,
        stream.quality,
        stream.isHighQuality,
        parsed.url,            // original URL for re-fetching
        stream.formatId,       // yt-dlp format_id
        stream.directUrl,      // Instagram direct CDN URL
        stream.audioFormatId   // audio-only format_id for adaptive mux
      )
    }));

    return res.json({
      success: true,
      media: {
        ...media,
        streams: streamsWithTokens
      }
    });
  } catch (err) {
    console.error('[MediaResolve Error]', err.message);
    return res.status(500).json({
      success: false,
      error: 'Failed to process media. ' + (err.message || 'Please try again.')
    });
  }
});

// =========================================================
// GET /api/media/stream
// Streams the actual file using verified token data.
// Uses itag / directUrl embedded in token - zero global state.
// =========================================================
router.get('/stream', async (req, res) => {
  const { token, title, quality, ext } = req.query;

  if (!token) {
    return res.status(400).send('Missing download verification token');
  }

  const payload = mediaService.verifyDownloadToken(token);
  if (!payload) {
    return res.status(403).send('Invalid or expired download token. Please resolve the media again.');
  }

  const fileExt = ext === 'mp3' ? 'mp3' : 'mp4';
  const cleanTitle = (title || 'PulseGrab_Media').replace(/[^a-zA-Z0-9_\- ]/g, '_').trim().replace(/ /g, '_');
  const filename = `${cleanTitle}_${quality || '720p'}.${fileExt}`;
  const contentType = fileExt === 'mp3' ? 'audio/mpeg' : 'video/mp4';

  // Determine platform from token payload
  // Instagram tokens carry directUrl; YouTube tokens carry originalUrl + itag
  if (payload.directUrl) {
    // Instagram stream
    await mediaService.streamInstagram(res, payload, filename, contentType);
  } else if (payload.originalUrl && payload.originalUrl.includes('youtube')) {
    // YouTube stream
    await mediaService.streamYouTube(res, payload, filename, contentType);
  } else if (payload.originalUrl && payload.originalUrl.includes('youtu.be')) {
    // YouTube short link
    await mediaService.streamYouTube(res, payload, filename, contentType);
  } else {
    return res.status(400).send('Cannot determine media platform from token. Please resolve the link again.');
  }
});

// =========================================================
// POST /api/media/claim-reward
// Awards coins after confirmed download (authenticated users only)
// =========================================================
router.post('/claim-reward', requireAuth, (req, res) => {
  const { downloadToken, url, title, platform, quality } = req.body;
  const user = req.user;
  const userIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '127.0.0.1';

  if (!downloadToken) {
    return res.status(400).json({ success: false, error: 'Missing signed download token' });
  }

  const verified = mediaService.verifyDownloadToken(downloadToken);
  if (!verified) {
    return res.status(403).json({ success: false, error: 'Invalid or expired download verification token' });
  }

  const isHighQuality = (quality === '720p' || quality === '1080p');
  const dailyStats = db.getUserDailyStats(user.id);

  let coinsToAward = 0;
  let reason = '';

  if (!isHighQuality) {
    coinsToAward = 0;
    reason = 'Standard quality or audio download earns 0 coins.';
  } else if (dailyStats.coinsEarned >= 250 || dailyStats.downloadsCount >= 25) {
    coinsToAward = 0;
    reason = 'Daily reward limit reached (250 coins / 25 downloads). Resets at 4:00 AM IST.';
  } else {
    coinsToAward = 10;
    reason = '+10 Coins awarded for HD download!';
  }

  db.recordUserDailyDownload(user.id, coinsToAward);

  const downloadRecord = db.addDownload({
    userId: user.id,
    userIp,
    url: url || verified.originalUrl || '',
    title: title || 'Media File',
    platform: platform || (verified.originalUrl?.includes('instagram') ? 'instagram' : 'youtube'),
    quality: quality || verified.q,
    isHighQuality,
    coinsAwarded: coinsToAward
  });

  // Check referral milestone (3 HQ downloads from referred user triggers 250 coin bonus)
  let referralBonusTriggered = false;
  let referrerBonusInfo = null;

  if (isHighQuality && user.referredBy) {
    const referralRecord = db.getReferralByReferredUser(user.id);
    if (referralRecord && referralRecord.status === 'pending') {
      const updatedHQCount = (referralRecord.highQualityDownloadsCount || 0) + 1;
      db.updateReferral(referralRecord.id, { highQualityDownloadsCount: updatedHQCount });

      if (updatedHQCount >= 3) {
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

  const updatedUser = db.getUserById(user.id);
  const updatedStats = db.getUserDailyStats(user.id);

  return res.json({
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
