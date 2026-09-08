const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'store.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Initial Database State
const initialData = {
  users: [
    {
      id: "usr_admin_default",
      googleId: "google_admin_1001",
      email: "admin@pulsegrab.com",
      name: "PulseGrab Admin",
      avatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80",
      coins: 25000,
      lifetimeEarned: 35000,
      totalDownloads: 120,
      is_admin: true,
      twoFactorSecret: "JBSWY3DPEHPK3PXP", // Default Base32 secret for easy testing
      twoFactorEnabled: true,
      payoutUnlocked: true,
      lockedUpi: "admin@okhdfcbank",
      upiHistory: ["admin@okhdfcbank"],
      referralCode: "ADMIN01",
      referredBy: null,
      isBanned: false,
      registrationIp: "127.0.0.1",
      createdAt: new Date(Date.now() - 30 * 86400000).toISOString(),
      lastLoginAt: new Date().toISOString()
    },
    {
      id: "usr_demo_user1",
      googleId: "google_user_2001",
      email: "alex.kumar@gmail.com",
      name: "Alex Kumar",
      avatar: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80",
      coins: 13500,
      lifetimeEarned: 16000,
      totalDownloads: 42,
      is_admin: false,
      twoFactorSecret: null,
      twoFactorEnabled: false,
      payoutUnlocked: true,
      lockedUpi: "alexkumar@okaxis",
      upiHistory: ["alexkumar@okaxis"],
      referralCode: "ALEX777",
      referredBy: null,
      isBanned: false,
      registrationIp: "192.168.1.10",
      createdAt: new Date(Date.now() - 15 * 86400000).toISOString(),
      lastLoginAt: new Date().toISOString()
    }
  ],
  downloads: [],
  referrals: [],
  payouts: [
    {
      id: "pay_sample_01",
      userId: "usr_demo_user1",
      userName: "Alex Kumar",
      userEmail: "alex.kumar@gmail.com",
      userJoinDate: new Date(Date.now() - 15 * 86400000).toISOString(),
      tierCoins: 12000,
      amountInr: 100,
      upiId: "alexkumar@okaxis",
      status: "pending",
      rejectionReason: null,
      fraudFlags: [],
      requestedAt: new Date(Date.now() - 2 * 3600000).toISOString(),
      processedAt: null,
      processedBy: null
    }
  ],
  auditLogs: [
    {
      id: "log_init_01",
      adminId: "usr_admin_default",
      adminEmail: "admin@pulsegrab.com",
      action: "SYSTEM_INITIALIZED",
      targetUserId: null,
      details: "Reward & Downloader Ecosystem Database Initialized",
      ipAddress: "127.0.0.1",
      timestamp: new Date().toISOString()
    }
  ],
  dailyLedger: {} // userId -> { dateKey: "YYYY-MM-DD", downloadsCount: N, coinsEarned: N, referralCoinsEarned: N }
};

// Safe JSON Load
function loadDatabase() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const content = fs.readFileSync(DATA_FILE, 'utf-8');
      return JSON.parse(content);
    }
  } catch (err) {
    console.error("[DB] Error reading store.json, falling back to initial data:", err.message);
  }
  saveDatabase(initialData);
  return initialData;
}

// Atomic file save
function saveDatabase(data) {
  try {
    const tempFile = `${DATA_FILE}.tmp.${Date.now()}`;
    fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tempFile, DATA_FILE);
    return true;
  } catch (err) {
    console.error("[DB] Error saving store.json:", err.message);
    return false;
  }
}

// In-Memory state with automatic persistence
let dbState = loadDatabase();

const db = {
  // Direct state access
  get: () => dbState,

  save: () => saveDatabase(dbState),

  // Users
  getUserById: (id) => dbState.users.find(u => u.id === id),
  getUserByEmail: (email) => dbState.users.find(u => u.email.toLowerCase() === email.toLowerCase()),
  getUserByGoogleId: (gid) => dbState.users.find(u => u.googleId === gid),
  getUserByReferralCode: (code) => dbState.users.find(u => u.referralCode && u.referralCode.toUpperCase() === code.toUpperCase()),
  
  createUser: (userData) => {
    const newUser = {
      id: `usr_${crypto.randomBytes(6).toString('hex')}`,
      googleId: userData.googleId || `google_${Date.now()}`,
      email: userData.email,
      name: userData.name || "User",
      avatar: userData.avatar || "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80",
      coins: userData.coins || 0,
      lifetimeEarned: userData.lifetimeEarned || userData.coins || 0,
      totalDownloads: 0,
      is_admin: !!userData.is_admin,
      twoFactorSecret: userData.twoFactorSecret || null,
      twoFactorEnabled: !!userData.twoFactorEnabled,
      payoutUnlocked: false,
      lockedUpi: null,
      upiHistory: [],
      referralCode: (userData.name ? userData.name.substring(0, 4).replace(/[^a-zA-Z]/g, '').toUpperCase() : 'USER') + Math.floor(1000 + Math.random() * 9000),
      referredBy: userData.referredBy || null,
      isBanned: false,
      registrationIp: userData.registrationIp || "127.0.0.1",
      createdAt: new Date().toISOString(),
      lastLoginAt: new Date().toISOString()
    };
    dbState.users.push(newUser);
    saveDatabase(dbState);
    return newUser;
  },

  updateUser: (id, updates) => {
    const user = dbState.users.find(u => u.id === id);
    if (!user) return null;
    Object.assign(user, updates);
    saveDatabase(dbState);
    return user;
  },

  // Daily reset key calculated based on Indian Standard Time (UTC+5:30) with 4:00 AM cutoff
  getCurrentIstCycleKey: () => {
    const now = new Date();
    // Shift date to IST (UTC + 5.5 hours)
    const istOffsetMs = 5.5 * 60 * 60 * 1000;
    const istTime = new Date(now.getTime() + istOffsetMs);

    // If IST time is before 4:00 AM, it counts toward the previous cycle day
    if (istTime.getUTCHours() < 4) {
      istTime.setUTCDate(istTime.getUTCDate() - 1);
    }
    const year = istTime.getUTCFullYear();
    const month = String(istTime.getUTCMonth() + 1).padStart(2, '0');
    const day = String(istTime.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  },

  getNextIstResetTime: () => {
    const now = new Date();
    const istOffsetMs = 5.5 * 60 * 60 * 1000;
    const istTime = new Date(now.getTime() + istOffsetMs);

    // Target is today 4:00 AM IST or tomorrow 4:00 AM IST
    const targetIst = new Date(istTime);
    if (istTime.getUTCHours() >= 4) {
      targetIst.setUTCDate(targetIst.getUTCDate() + 1);
    }
    targetIst.setUTCHours(4, 0, 0, 0);
    // Convert back to UTC / local
    return new Date(targetIst.getTime() - istOffsetMs).toISOString();
  },

  getUserDailyStats: (userId) => {
    const cycleKey = db.getCurrentIstCycleKey();
    if (!dbState.dailyLedger[userId]) {
      dbState.dailyLedger[userId] = {};
    }
    if (!dbState.dailyLedger[userId][cycleKey]) {
      dbState.dailyLedger[userId][cycleKey] = {
        cycleKey,
        downloadsCount: 0,
        coinsEarned: 0,
        referralCoinsEarned: 0
      };
    }
    return dbState.dailyLedger[userId][cycleKey];
  },

  recordUserDailyDownload: (userId, coinsAwarded) => {
    const stats = db.getUserDailyStats(userId);
    stats.downloadsCount += 1;
    stats.coinsEarned += coinsAwarded;
    saveDatabase(dbState);
    return stats;
  },

  recordUserDailyReferralBonus: (userId, coinsAwarded) => {
    const stats = db.getUserDailyStats(userId);
    stats.referralCoinsEarned += coinsAwarded;
    saveDatabase(dbState);
    return stats;
  },

  // Downloads
  addDownload: (record) => {
    const downloadEntry = {
      id: `dl_${crypto.randomBytes(6).toString('hex')}`,
      userId: record.userId,
      userIp: record.userIp || "127.0.0.1",
      url: record.url,
      title: record.title || "Online Video",
      platform: record.platform || "generic",
      quality: record.quality,
      isHighQuality: record.isHighQuality,
      coinsAwarded: record.coinsAwarded,
      timestamp: new Date().toISOString()
    };
    dbState.downloads.push(downloadEntry);

    // Update user stats
    const user = db.getUserById(record.userId);
    if (user) {
      user.totalDownloads = (user.totalDownloads || 0) + 1;
      if (record.coinsAwarded > 0) {
        user.coins = (user.coins || 0) + record.coinsAwarded;
        user.lifetimeEarned = (user.lifetimeEarned || 0) + record.coinsAwarded;
      }
    }

    saveDatabase(dbState);
    return downloadEntry;
  },

  getUserDownloads: (userId, limit = 100) => {
    return dbState.downloads
      .filter(d => d.userId === userId)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, limit);
  },

  // Referrals
  addReferral: (referrerId, referredUserId) => {
    const ref = {
      id: `ref_${crypto.randomBytes(6).toString('hex')}`,
      referrerId,
      referredUserId,
      highQualityDownloadsCount: 0,
      status: "pending", // "pending" | "completed"
      bonusAwarded: 0,
      createdAt: new Date().toISOString(),
      completedAt: null
    };
    dbState.referrals.push(ref);
    saveDatabase(dbState);
    return ref;
  },

  getReferralByReferredUser: (referredUserId) => {
    return dbState.referrals.find(r => r.referredUserId === referredUserId);
  },

  getUserReferrals: (referrerId) => {
    return dbState.referrals.filter(r => r.referrerId === referrerId);
  },

  updateReferral: (id, updates) => {
    const ref = dbState.referrals.find(r => r.id === id);
    if (!ref) return null;
    Object.assign(ref, updates);
    saveDatabase(dbState);
    return ref;
  },

  // Payouts
  addPayoutRequest: (requestData) => {
    const payout = {
      id: `pay_${crypto.randomBytes(6).toString('hex')}`,
      userId: requestData.userId,
      userName: requestData.userName,
      userEmail: requestData.userEmail,
      userJoinDate: requestData.userJoinDate,
      tierCoins: requestData.tierCoins,
      amountInr: requestData.amountInr,
      upiId: requestData.upiId,
      status: "pending",
      rejectionReason: null,
      fraudFlags: requestData.fraudFlags || [],
      requestedAt: new Date().toISOString(),
      processedAt: null,
      processedBy: null
    };
    dbState.payouts.push(payout);
    saveDatabase(dbState);
    return payout;
  },

  updatePayout: (id, updates) => {
    const payout = dbState.payouts.find(p => p.id === id);
    if (!payout) return null;
    Object.assign(payout, updates);
    saveDatabase(dbState);
    return payout;
  },

  // Audit Logs
  addAuditLog: (logData) => {
    const log = {
      id: `log_${crypto.randomBytes(6).toString('hex')}`,
      adminId: logData.adminId,
      adminEmail: logData.adminEmail,
      action: logData.action,
      targetUserId: logData.targetUserId || null,
      details: logData.details,
      ipAddress: logData.ipAddress || "127.0.0.1",
      timestamp: new Date().toISOString()
    };
    dbState.auditLogs.unshift(log); // newest first
    if (dbState.auditLogs.length > 500) {
      dbState.auditLogs.pop();
    }
    saveDatabase(dbState);
    return log;
  }
};

module.exports = db;
