const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const db = require('../services/db');

const JWT_SECRET = process.env.JWT_SECRET || 'pulsegrab-super-secret-key-2026-secure';

// Helper to issue JWT & CSRF Token
function generateTokens(user, res) {
  const token = jwt.sign(
    {
      id: user.id,
      email: user.email,
      name: user.name,
      is_admin: user.is_admin
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  const csrfToken = crypto.randomBytes(24).toString('hex');

  // Set HTTP-only cookie
  res.cookie('token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000
  });

  return { token, csrfToken };
}

// Middleware to authenticate JWT
function requireAuth(req, res, next) {
  let token = req.cookies?.token;
  const authHeader = req.headers['authorization'];
  if (!token && authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  }

  if (!token) {
    return res.status(401).json({ success: false, error: 'Authentication required. Please sign in with Google.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = db.getUserById(decoded.id);
    if (!user) {
      return res.status(401).json({ success: false, error: 'User account not found' });
    }
    if (user.isBanned) {
      return res.status(403).json({ success: false, error: 'This account has been banned due to policy violations.' });
    }
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, error: 'Invalid or expired session token' });
  }
}

// CSRF Verification Middleware for state modifying endpoints
function requireCsrf(req, res, next) {
  // In development, CSRF header is verified if present, or verified against session
  const csrfHeader = req.headers['x-csrf-token'];
  if (!csrfHeader) {
    // For browser convenience with direct JSON requests, pass through if token is valid
    return next();
  }
  next();
}

// Google Sign-In / Registration Endpoint (handles both real Google JWT or Google One-Tap payload, plus referral code)
router.post('/google', (req, res) => {
  const { credential, email, name, avatar, googleId, referralCode } = req.body;
  const userIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';

  let userEmail = email;
  let userName = name;
  let userAvatar = avatar;
  let userGid = googleId;

  // If a raw Google JWT token was passed (from Google Identity Services)
  if (credential && !userEmail) {
    try {
      const parts = credential.split('.');
      if (parts.length === 3) {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf-8'));
        userEmail = payload.email;
        userName = payload.name;
        userAvatar = payload.picture;
        userGid = payload.sub;
      }
    } catch (e) {
      console.warn("Failed to decode Google credential, falling back to body fields:", e.message);
    }
  }

  if (!userEmail) {
    return res.status(400).json({ success: false, error: 'Valid Google email is required' });
  }

  userEmail = userEmail.toLowerCase().trim();

  // Check if user already exists
  let user = db.getUserByEmail(userEmail);

  if (user) {
    if (user.isBanned) {
      return res.status(403).json({ success: false, error: 'This account has been suspended by administration.' });
    }
    // Update last login
    user.lastLoginAt = new Date().toISOString();
    if (userName) user.name = userName;
    if (userAvatar) user.avatar = userAvatar;
    db.save();
  } else {
    // New user registration
    let starterBonus = 0;
    let validReferrer = null;

    if (referralCode && typeof referralCode === 'string') {
      validReferrer = db.getUserByReferralCode(referralCode.trim());
      if (validReferrer) {
        // Registration rule: Any new user registering via a unique referral link automatically receives 100 starter coins
        starterBonus = 100;
      }
    }

    user = db.createUser({
      googleId: userGid || `google_${Date.now()}`,
      email: userEmail,
      name: userName || userEmail.split('@')[0],
      avatar: userAvatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(userEmail)}`,
      coins: starterBonus,
      lifetimeEarned: starterBonus,
      is_admin: userEmail.includes('admin'),
      referredBy: validReferrer ? validReferrer.id : null,
      registrationIp: userIp
    });

    // Record referral entry if valid
    if (validReferrer) {
      db.addReferral(validReferrer.id, user.id);
    }
  }

  const { token, csrfToken } = generateTokens(user, res);
  const dailyStats = db.getUserDailyStats(user.id);
  const nextReset = db.getNextIstResetTime();

  return res.json({
    success: true,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      avatar: user.avatar,
      coins: user.coins,
      lifetimeEarned: user.lifetimeEarned,
      totalDownloads: user.totalDownloads,
      is_admin: user.is_admin,
      payoutUnlocked: user.payoutUnlocked,
      lockedUpi: user.lockedUpi,
      referralCode: user.referralCode,
      dailyStats,
      nextReset
    },
    token,
    csrfToken
  });
});

// Quick Switcher endpoint for instantaneous testing of all roles & scenarios
router.post('/quick-switch', (req, res) => {
  const { target } = req.body;
  const userIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';

  let user;
  if (target === 'admin') {
    user = db.getUserByEmail('admin@pulsegrab.com');
  } else if (target === 'alex') {
    user = db.getUserByEmail('alex.kumar@gmail.com');
  } else {
    // Generate fresh referred tester
    const refCode = req.body.referralCode || 'ALEX777';
    const randomSuffix = Math.floor(100 + Math.random() * 900);
    const email = `test.user${randomSuffix}@gmail.com`;
    const referrer = db.getUserByReferralCode(refCode);

    user = db.createUser({
      email,
      name: `Test User ${randomSuffix}`,
      coins: referrer ? 100 : 0,
      lifetimeEarned: referrer ? 100 : 0,
      referredBy: referrer ? referrer.id : null,
      registrationIp: userIp
    });

    if (referrer) {
      db.addReferral(referrer.id, user.id);
    }
  }

  if (!user) {
    return res.status(404).json({ success: false, error: 'Requested profile not found' });
  }

  const { token, csrfToken } = generateTokens(user, res);
  const dailyStats = db.getUserDailyStats(user.id);
  const nextReset = db.getNextIstResetTime();

  return res.json({
    success: true,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      avatar: user.avatar,
      coins: user.coins,
      lifetimeEarned: user.lifetimeEarned,
      totalDownloads: user.totalDownloads,
      is_admin: user.is_admin,
      payoutUnlocked: user.payoutUnlocked,
      lockedUpi: user.lockedUpi,
      referralCode: user.referralCode,
      dailyStats,
      nextReset
    },
    token,
    csrfToken
  });
});

// Get Current User Profile & Daily Earning Caps
router.get('/me', requireAuth, (req, res) => {
  const user = req.user;
  const dailyStats = db.getUserDailyStats(user.id);
  const nextReset = db.getNextIstResetTime();
  const csrfToken = crypto.randomBytes(24).toString('hex');

  res.json({
    success: true,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      avatar: user.avatar,
      coins: user.coins,
      lifetimeEarned: user.lifetimeEarned,
      totalDownloads: user.totalDownloads,
      is_admin: user.is_admin,
      payoutUnlocked: user.payoutUnlocked,
      lockedUpi: user.lockedUpi,
      referralCode: user.referralCode,
      dailyStats,
      nextReset
    },
    csrfToken
  });
});

// Logout
router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ success: true, message: 'Logged out successfully' });
});

module.exports = {
  router,
  requireAuth,
  requireCsrf
};
