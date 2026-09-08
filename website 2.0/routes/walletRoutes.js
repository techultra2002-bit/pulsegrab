const express = require('express');
const router = express.Router();
const db = require('../services/db');
const fraudService = require('../services/fraudService');
const { requireAuth, requireCsrf } = require('./authRoutes');

// Supported Payout Tiers Definition
const PAYOUT_TIERS = {
  tier_1: { coins: 12000, inr: 100, label: 'Standard Starter' },
  tier_2: { coins: 18000, inr: 200, label: 'Silver Pro' },
  tier_3: { coins: 20000, inr: 250, label: 'Gold Executive' },
  tier_4: { coins: 50000, inr: 1000, label: 'Mega Reward' }
};

// Validate standard UPI ID format (e.g., alex@oksbi, name99@paytm, user@upi)
function isValidUpi(upi) {
  if (!upi || typeof upi !== 'string') return false;
  const regex = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/;
  return regex.test(upi.trim());
}

// Get user's wallet overview, payout status, and transaction history
router.get('/overview', requireAuth, (req, res) => {
  const user = db.getUserById(req.user.id);
  const userPayouts = db.get().payouts
    .filter(p => p.userId === user.id)
    .sort((a, b) => new Date(b.requestedAt) - new Date(a.requestedAt));

  res.json({
    success: true,
    wallet: {
      coins: user.coins,
      lifetimeEarned: user.lifetimeEarned,
      payoutUnlocked: user.payoutUnlocked,
      lockedUpi: user.lockedUpi,
      upiHistory: user.upiHistory || [],
      canUnlock: user.coins >= 5000,
      unlockCost: 1000,
      upiBindCost: 500,
      upiModifyCost: 250,
      availableTiers: PAYOUT_TIERS
    },
    payouts: userPayouts
  });
});

// Unlock Payout System
// Rule: Locked by default. Must reach >= 5,000 coins. Costs 1,000 coins deducted from balance.
router.post('/unlock', requireAuth, requireCsrf, (req, res) => {
  const user = db.getUserById(req.user.id);

  if (user.payoutUnlocked) {
    return res.status(400).json({ success: false, error: 'Payout feature is already unlocked on this account.' });
  }

  if (user.coins < 5000) {
    return res.status(400).json({
      success: false,
      error: `Insufficient balance. A minimum balance of 5,000 coins is required to unlock payouts (Current: ${user.coins} coins).`
    });
  }

  // Deduct 1,000 coin unlock fee
  user.coins -= 1000;
  user.payoutUnlocked = true;
  db.save();

  res.json({
    success: true,
    message: 'Payout system successfully unlocked! 1,000 coins deducted.',
    newBalance: user.coins,
    payoutUnlocked: true
  });
});

// Bind or Modify Locked UPI ID
// Rule: First-time binding costs 500 coins. Changing previously locked UPI costs 250 coins.
router.post('/bind-upi', requireAuth, requireCsrf, (req, res) => {
  const { upiId } = req.body;
  const user = db.getUserById(req.user.id);

  if (!isValidUpi(upiId)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid UPI ID format. Format must be like username@bank or mobile@upi (e.g., user@okhdfcbank).'
    });
  }

  const cleanUpi = upiId.trim().toLowerCase();
  const isFirstTime = !user.lockedUpi;
  const cost = isFirstTime ? 500 : 250;

  if (user.lockedUpi === cleanUpi) {
    return res.status(400).json({ success: false, error: 'This UPI ID is already bound to your account.' });
  }

  if (user.coins < cost) {
    return res.status(400).json({
      success: false,
      error: `Insufficient coins. ${isFirstTime ? 'Initial UPI binding' : 'Modifying UPI ID'} costs ${cost} coins (Current balance: ${user.coins} coins).`
    });
  }

  // Deduct fee and save UPI
  user.coins -= cost;
  user.lockedUpi = cleanUpi;
  if (!user.upiHistory) user.upiHistory = [];
  user.upiHistory.push(cleanUpi);
  db.save();

  res.json({
    success: true,
    message: isFirstTime
      ? `UPI ID ${cleanUpi} successfully locked! (500 coins deducted)`
      : `UPI ID successfully updated to ${cleanUpi}! (250 coins deducted)`,
    lockedUpi: user.lockedUpi,
    newBalance: user.coins
  });
});

// Redeem / Withdraw Coins for Cash (INR)
// Rule: Payouts must be unlocked, UPI must be bound, and user must have enough coins for the tier.
router.post('/redeem', requireAuth, requireCsrf, (req, res) => {
  const { tierKey } = req.body;
  const user = db.getUserById(req.user.id);

  if (!user.payoutUnlocked) {
    return res.status(403).json({
      success: false,
      error: 'Withdrawals are locked. You must unlock the payout system with 5,000+ coins before redeeming.'
    });
  }

  if (!user.lockedUpi) {
    return res.status(400).json({
      success: false,
      error: 'No UPI ID locked. You must bind and lock your UPI payment address before requesting a withdrawal.'
    });
  }

  const tier = PAYOUT_TIERS[tierKey];
  if (!tier) {
    return res.status(400).json({ success: false, error: 'Invalid payout tier selected.' });
  }

  if (user.coins < tier.coins) {
    return res.status(400).json({
      success: false,
      error: `Insufficient balance for this tier. Requires ${tier.coins.toLocaleString()} coins (You have: ${user.coins.toLocaleString()}).`
    });
  }

  // Analyze automated fraud flags
  const fraudFlags = fraudService.analyzeUserRisk(user.id);

  // Deduct coins permanently for redemption queue
  user.coins -= tier.coins;
  db.save();

  // Create payout record
  const payout = db.addPayoutRequest({
    userId: user.id,
    userName: user.name,
    userEmail: user.email,
    userJoinDate: user.createdAt,
    tierCoins: tier.coins,
    amountInr: tier.inr,
    upiId: user.lockedUpi,
    fraudFlags
  });

  res.json({
    success: true,
    message: `Redemption request for ₹${tier.inr} (${tier.coins.toLocaleString()} Coins) submitted successfully! Pending admin audit.`,
    payout,
    newBalance: user.coins
  });
});

// Rewarded Ad Bonus Claim (+25 coins for engaging with sponsor showcase)
router.post('/claim-ad-reward', requireAuth, requireCsrf, (req, res) => {
  const user = db.getUserById(req.user.id);
  const now = Date.now();

  // Cooldown check (minimum 60 seconds between rewarded ads)
  if (user.lastAdClaimAt && (now - user.lastAdClaimAt < 60 * 1000)) {
    const waitSec = Math.ceil((60 * 1000 - (now - user.lastAdClaimAt)) / 1000);
    return res.status(429).json({
      success: false,
      error: `Next rewarded ad available in ${waitSec} seconds.`
    });
  }

  const bonusCoins = 25;
  user.coins = (user.coins || 0) + bonusCoins;
  user.lifetimeEarned = (user.lifetimeEarned || 0) + bonusCoins;
  user.lastAdClaimAt = now;
  db.save();

  res.json({
    success: true,
    message: `+25 Bonus Coins credited for viewing sponsor offer!`,
    newBalance: user.coins,
    bonusCoins
  });
});

module.exports = router;

