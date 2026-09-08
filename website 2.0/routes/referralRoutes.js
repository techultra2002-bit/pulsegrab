const express = require('express');
const router = express.Router();
const db = require('../services/db');
const { requireAuth } = require('./authRoutes');

// Get referral summary, stats, and referred list
router.get('/summary', requireAuth, (req, res) => {
  const user = db.getUserById(req.user.id);
  const referrals = db.getUserReferrals(user.id);
  const dailyStats = db.getUserDailyStats(user.id);

  // Detailed breakdown of each referred user
  const referralList = referrals.map(ref => {
    const referredUser = db.getUserById(ref.referredUserId);
    return {
      id: ref.id,
      name: referredUser ? referredUser.name : 'Unknown User',
      emailMasked: referredUser ? referredUser.email.replace(/(.{2})(.*)(?=@)/, '$1***') : '***@gmail.com',
      joinedAt: ref.createdAt,
      highQualityDownloadsCount: ref.highQualityDownloadsCount || 0,
      milestoneCompleted: (ref.highQualityDownloadsCount || 0) >= 3,
      status: ref.status,
      bonusAwarded: ref.bonusAwarded || 0,
      completedAt: ref.completedAt
    };
  });

  const completedCount = referralList.filter(r => r.milestoneCompleted).length;
  const pendingCount = referralList.length - completedCount;

  res.json({
    success: true,
    data: {
      referralCode: user.referralCode,
      referralLink: `${req.protocol}://${req.get('host')}?ref=${user.referralCode}`,
      totalReferrals: referralList.length,
      completedCount,
      pendingCount,
      dailyReferralCoinsEarned: dailyStats.referralCoinsEarned || 0,
      dailyReferralCap: 1000,
      referrals: referralList
    }
  });
});

module.exports = router;
