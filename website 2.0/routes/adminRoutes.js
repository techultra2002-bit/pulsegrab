const express = require('express');
const router = express.Router();
const db = require('../services/db');
const totpService = require('../services/totpService');
const fraudService = require('../services/fraudService');
const { requireAuth, requireCsrf } = require('./authRoutes');

// Admin role check middleware
function requireAdmin(req, res, next) {
  if (!req.user || !req.user.is_admin) {
    return res.status(403).json({ success: false, error: 'Access denied: Administrator privileges required.' });
  }
  next();
}

// Admin 2FA Setup - Generates QR code and Base32 secret for Google Authenticator
router.get('/2fa/setup', requireAuth, requireAdmin, async (req, res) => {
  const user = db.getUserById(req.user.id);
  // Default or existing secret, or generate new
  let secret = user.twoFactorSecret;
  if (!secret) {
    secret = totpService.generateSecret();
    user.twoFactorSecret = secret;
    db.save();
  }

  const { otpAuthUrl, qrDataUrl } = await totpService.generateQrCode(user.email, secret, 'PulseGrab Admin');

  res.json({
    success: true,
    secret,
    qrDataUrl,
    otpAuthUrl,
    twoFactorEnabled: user.twoFactorEnabled
  });
});

// Admin 2FA Verification Endpoint
router.post('/2fa/verify', requireAuth, requireAdmin, (req, res) => {
  const { code } = req.body;
  const user = db.getUserById(req.user.id);

  if (!user.twoFactorSecret) {
    return res.status(400).json({ success: false, error: '2FA has not been configured yet.' });
  }

  const isValid = totpService.verifyToken(user.twoFactorSecret, code);
  if (!isValid) {
    return res.status(401).json({ success: false, error: 'Invalid Google Authenticator 6-digit code. Please try again.' });
  }

  // Mark 2FA verified in user profile
  user.twoFactorEnabled = true;
  db.save();

  // Log audit
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
  db.addAuditLog({
    adminId: user.id,
    adminEmail: user.email,
    action: 'ADMIN_2FA_VERIFIED',
    details: 'Admin verified 2FA via Google Authenticator session',
    ipAddress: clientIp
  });

  res.json({
    success: true,
    message: '2FA verified successfully. Admin control center unlocked.',
    twoFactorVerified: true
  });
});

// Admin Dashboard Overview (KPI Metrics)
router.get('/metrics', requireAuth, requireAdmin, (req, res) => {
  const state = db.get();
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 3600000);

  const totalUsers = state.users.length;
  const activeTodayUsers = state.users.filter(u => new Date(u.lastLoginAt) >= oneDayAgo).length;

  const circulatingCoins = state.users.reduce((sum, u) => sum + (u.coins || 0), 0);

  const pendingPayouts = state.payouts.filter(p => p.status === 'pending');
  const pendingCount = pendingPayouts.length;
  const pendingInrValue = pendingPayouts.reduce((sum, p) => sum + (p.amountInr || 0), 0);

  const completedPayouts = state.payouts.filter(p => p.status === 'approved');
  const completedInrValue = completedPayouts.reduce((sum, p) => sum + (p.amountInr || 0), 0);

  res.json({
    success: true,
    metrics: {
      totalUsers,
      activeTodayUsers,
      circulatingCoins,
      pendingCount,
      pendingInrValue,
      completedCount: completedPayouts.length,
      completedInrValue
    }
  });
});

// Payout Management Queue (Core View)
router.get('/payouts', requireAuth, requireAdmin, (req, res) => {
  const state = db.get();

  const enrichedPayouts = state.payouts.map(p => {
    const user = db.getUserById(p.userId);
    const referrals = db.getUserReferrals(p.userId);
    const successfulReferrals = referrals.filter(r => (r.highQualityDownloadsCount || 0) >= 3).length;

    // Dynamically check fraud flags
    const flags = fraudService.analyzeUserRisk(p.userId);

    return {
      ...p,
      userDetails: {
        id: user ? user.id : p.userId,
        name: user ? user.name : p.userName,
        email: user ? user.email : p.userEmail,
        joinedAt: user ? user.createdAt : p.userJoinDate,
        isBanned: user ? user.isBanned : false
      },
      walletStats: {
        currentBalance: user ? user.coins : 0,
        lifetimeEarned: user ? user.lifetimeEarned : 0,
        successfulReferrals
      },
      fraudRiskFlags: flags
    };
  });

  res.json({
    success: true,
    payouts: enrichedPayouts
  });
});

// Action: Approve Payout
router.post('/payouts/:id/approve', requireAuth, requireAdmin, requireCsrf, (req, res) => {
  const payoutId = req.params.id;
  const admin = req.user;
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';

  const payout = db.get().payouts.find(p => p.id === payoutId);
  if (!payout) {
    return res.status(404).json({ success: false, error: 'Payout request not found' });
  }

  if (payout.status !== 'pending') {
    return res.status(400).json({ success: false, error: `Payout is already marked as ${payout.status}` });
  }

  payout.status = 'approved';
  payout.processedAt = new Date().toISOString();
  payout.processedBy = admin.email;
  db.save();

  db.addAuditLog({
    adminId: admin.id,
    adminEmail: admin.email,
    action: 'PAYOUT_APPROVED',
    targetUserId: payout.userId,
    details: `Approved payout ${payout.id} for ₹${payout.amountInr} to UPI: ${payout.upiId}`,
    ipAddress: clientIp
  });

  res.json({
    success: true,
    message: `Payout #${payout.id} marked as APPROVED. Transfer ₹${payout.amountInr} to UPI: ${payout.upiId}`,
    payout,
    revealedUpi: payout.upiId
  });
});

// Action: Reject & Refund Payout
router.post('/payouts/:id/reject', requireAuth, requireAdmin, requireCsrf, (req, res) => {
  const payoutId = req.params.id;
  const { reason } = req.body;
  const admin = req.user;
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';

  const payout = db.get().payouts.find(p => p.id === payoutId);
  if (!payout) {
    return res.status(404).json({ success: false, error: 'Payout request not found' });
  }

  if (payout.status !== 'pending') {
    return res.status(400).json({ success: false, error: `Payout is already ${payout.status}` });
  }

  const rejectionReason = reason || 'UPI destination verification failed or fraud policy flag triggered.';

  // Refund the deducted coins to user
  const user = db.getUserById(payout.userId);
  if (user) {
    user.coins = (user.coins || 0) + payout.tierCoins;
  }

  payout.status = 'rejected';
  payout.rejectionReason = rejectionReason;
  payout.processedAt = new Date().toISOString();
  payout.processedBy = admin.email;
  db.save();

  // Template email logged
  const emailNotification = {
    to: payout.userEmail,
    subject: `Update regarding your PulseGrab redemption request #${payout.id}`,
    body: `Dear ${payout.userName},\n\nYour redemption request for ₹${payout.amountInr} (${payout.tierCoins} coins) could not be processed.\n\nReason: ${rejectionReason}\n\nAll ${payout.tierCoins} coins have been immediately refunded to your wallet.\n\nRegards,\nPulseGrab Audit Team`
  };

  db.addAuditLog({
    adminId: admin.id,
    adminEmail: admin.email,
    action: 'PAYOUT_REJECTED_REFUNDED',
    targetUserId: payout.userId,
    details: `Rejected payout ${payout.id}. Refunded ${payout.tierCoins} coins. Reason: ${rejectionReason}`,
    ipAddress: clientIp
  });

  res.json({
    success: true,
    message: `Payout rejected and ${payout.tierCoins} coins refunded to user. Automated notification recorded.`,
    payout,
    emailNotification
  });
});

// Action: Ban User
router.post('/users/:id/ban', requireAuth, requireAdmin, requireCsrf, (req, res) => {
  const targetUserId = req.params.id;
  const { reason } = req.body;
  const admin = req.user;
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';

  const user = db.getUserById(targetUserId);
  if (!user) {
    return res.status(404).json({ success: false, error: 'User not found' });
  }

  if (user.is_admin) {
    return res.status(400).json({ success: false, error: 'Cannot ban an administrative account.' });
  }

  // Freeze account, void coins, set banned
  const forfeitedCoins = user.coins;
  user.isBanned = true;
  user.coins = 0;
  db.save();

  db.addAuditLog({
    adminId: admin.id,
    adminEmail: admin.email,
    action: 'USER_BANNED',
    targetUserId: user.id,
    details: `Account frozen, ${forfeitedCoins} coins voided. Reason: ${reason || 'Anti-fraud system policy violation'}`,
    ipAddress: clientIp
  });

  res.json({
    success: true,
    message: `User ${user.email} permanently banned. Account frozen and active session invalidated.`,
    user
  });
});

// User Ledger Audit Tool (Lookup by email, ID or referral code)
router.get('/audit/user', requireAuth, requireAdmin, (req, res) => {
  const { query } = req.query;
  if (!query || typeof query !== 'string') {
    return res.status(400).json({ success: false, error: 'Please enter an email, User ID, or referral code to inspect.' });
  }

  const cleanQuery = query.trim().toLowerCase();
  const user = db.get().users.find(u =>
    u.id.toLowerCase() === cleanQuery ||
    u.email.toLowerCase() === cleanQuery ||
    (u.referralCode && u.referralCode.toLowerCase() === cleanQuery)
  );

  if (!user) {
    return res.status(404).json({ success: false, error: 'No user matching query found.' });
  }

  // Fetch last 100 downloads
  const downloads = db.getUserDownloads(user.id, 100);

  // Fetch referral graph tree
  const referrals = db.getUserReferrals(user.id).map(r => {
    const refUser = db.getUserById(r.referredUserId);
    return {
      referralId: r.id,
      referredUser: refUser ? {
        id: refUser.id,
        name: refUser.name,
        email: refUser.email,
        registrationIp: refUser.registrationIp,
        totalDownloads: refUser.totalDownloads,
        createdAt: refUser.createdAt
      } : null,
      highQualityDownloadsCount: r.highQualityDownloadsCount || 0,
      milestoneMet: (r.highQualityDownloadsCount || 0) >= 3,
      bonusAwarded: r.bonusAwarded || 0,
      completedAt: r.completedAt
    };
  });

  // Calculate risk flags
  const riskFlags = fraudService.analyzeUserRisk(user.id);

  res.json({
    success: true,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      avatar: user.avatar,
      coins: user.coins,
      lifetimeEarned: user.lifetimeEarned,
      totalDownloads: user.totalDownloads,
      payoutUnlocked: user.payoutUnlocked,
      lockedUpi: user.lockedUpi,
      upiHistory: user.upiHistory,
      referralCode: user.referralCode,
      referredBy: user.referredBy,
      registrationIp: user.registrationIp,
      isBanned: user.isBanned,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt
    },
    riskFlags,
    downloadHistory: downloads,
    referralGraph: referrals
  });
});

// Audit Logs
router.get('/audit/logs', requireAuth, requireAdmin, (req, res) => {
  const logs = db.get().auditLogs.slice(0, 100);
  res.json({ success: true, logs });
});

module.exports = router;
