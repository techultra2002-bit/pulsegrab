const db = require('./db');

const fraudService = {
  // Analyze a user for automated fraud risk flags
  analyzeUserRisk: (userId) => {
    const flags = [];
    const user = db.getUserById(userId);
    if (!user) return flags;

    const downloads = db.getUserDownloads(userId, 100);

    // Rule 1: Reached 25 downloads within less than 5 minutes (300 seconds)
    if (downloads.length >= 25) {
      // Find windows of 25 downloads
      for (let i = 0; i <= downloads.length - 25; i++) {
        const newestTime = new Date(downloads[i].timestamp).getTime();
        const oldestTime = new Date(downloads[i + 24].timestamp).getTime();
        const diffSeconds = Math.abs(newestTime - oldestTime) / 1000;

        if (diffSeconds < 300) { // less than 5 minutes
          flags.push({
            code: 'RAPID_DOWNLOAD_BOT',
            severity: 'CRITICAL',
            message: `Bot/Script Detection: Completed 25 downloads in ${Math.round(diffSeconds)} seconds (< 5 minutes)`
          });
          break;
        }
      }
    }

    // Rule 2: Referred users sharing the exact same IP address as referrer (self-referral abuse)
    const referrals = db.getUserReferrals(userId);
    if (referrals.length > 0) {
      const referrerIp = user.registrationIp;
      const sameIpCount = referrals.filter(ref => {
        const referredUser = db.getUserById(ref.referredUserId);
        return referredUser && referredUser.registrationIp && referredUser.registrationIp === referrerIp;
      }).length;

      if (sameIpCount >= 1) {
        flags.push({
          code: 'SAME_IP_REFERRAL_CLUSTER',
          severity: 'HIGH',
          message: `Self-Referral Abuse: ${sameIpCount} referral(s) registered from the same IP address (${referrerIp})`
        });
      }
    }

    return flags;
  }
};

module.exports = fraudService;
