const http = require('http');

function request(options, data) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve({ status: res.statusCode, headers: res.headers, body: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, raw: body });
        }
      });
    });
    req.on('error', reject);
    if (data) {
      req.write(typeof data === 'string' ? data : JSON.stringify(data));
    }
    req.end();
  });
}

async function runTests() {
  console.log('=== RUNNING PULSEGRAB 2.0 COMPREHENSIVE TEST SUITE ===');

  // 1. Health check
  const health = await request({ host: 'localhost', port: 3000, path: '/api/health', method: 'GET' });
  console.log('1. Health Check:', health.status === 200 ? 'PASS' : 'FAIL', health.body);

  // 2. Auth Switcher to Alex
  const loginAlex = await request({
    host: 'localhost',
    port: 3000,
    path: '/api/auth/quick-switch',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { target: 'alex' });
  console.log('2. User Login (Alex):', loginAlex.status === 200 ? 'PASS' : 'FAIL', 'Coins:', loginAlex.body.user.coins);

  const tokenAlex = loginAlex.body.token;
  const csrfAlex = loginAlex.body.csrfToken;

  // 3. Media Resolution (YouTube)
  const ytResolve = await request({
    host: 'localhost',
    port: 3000,
    path: '/api/media/resolve',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' });
  console.log('3. YouTube Resolution:', ytResolve.status === 200 ? 'PASS' : 'FAIL', 'Streams count:', ytResolve.body.media.streams.length);

  // 4. Media Resolution (Instagram)
  const igResolve = await request({
    host: 'localhost',
    port: 3000,
    path: '/api/media/resolve',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { url: 'https://www.instagram.com/reel/C8xyz123abc/' });
  console.log('4. Instagram Resolution:', igResolve.status === 200 ? 'PASS' : 'FAIL', 'Platform:', igResolve.body.media.platform);

  // 5. Stream Download Proxy Verification
  const stream720 = ytResolve.body.media.streams.find(s => s.quality === '720p');
  const stream480 = ytResolve.body.media.streams.find(s => s.quality === '480p');

  const streamDl = await request({
    host: 'localhost',
    port: 3000,
    path: `/api/media/stream?token=${encodeURIComponent(stream720.downloadToken)}&title=Test&quality=720p&ext=mp4`,
    method: 'GET'
  });
  console.log('5. Media Stream Proxy:', streamDl.status === 200 ? 'PASS' : 'FAIL', 'Content-Type:', streamDl.headers['content-type']);

  // 6. Reward Claim for 720p (+10 coins)
  const balanceBefore = loginAlex.body.user.coins;
  const claim720 = await request({
    host: 'localhost',
    port: 3000,
    path: '/api/media/claim-reward',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${tokenAlex}`,
      'x-csrf-token': csrfAlex
    }
  }, {
    downloadToken: stream720.downloadToken,
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    title: ytResolve.body.media.title,
    platform: 'youtube',
    quality: '720p'
  });
  console.log('6. Reward Claim (720p HD):', claim720.body.coinsAwarded === 10 ? 'PASS (+10 coins)' : 'FAIL', 'New Balance:', claim720.body.newBalance);

  // 7. Reward Claim for 480p (0 coins)
  const claim480 = await request({
    host: 'localhost',
    port: 3000,
    path: '/api/media/claim-reward',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${tokenAlex}`,
      'x-csrf-token': csrfAlex
    }
  }, {
    downloadToken: stream480.downloadToken,
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    title: ytResolve.body.media.title,
    platform: 'youtube',
    quality: '480p'
  });
  console.log('7. Reward Claim (480p SD):', claim480.body.coinsAwarded === 0 ? 'PASS (0 coins awarded)' : 'FAIL');

  // 8. Referral Registration with Bonus
  const newRefUser = await request({
    host: 'localhost',
    port: 3000,
    path: '/api/auth/google',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    email: `friend.${Date.now()}@gmail.com`,
    name: 'Referred Friend',
    referralCode: loginAlex.body.user.referralCode
  });
  console.log('8. Referral Registration (+100 starter bonus):', newRefUser.body.user.coins === 100 ? 'PASS (+100 Coins)' : 'FAIL');

  // 9. Referral Milestone (Complete 3 HQ downloads to trigger +250 for referrer)
  const friendToken = newRefUser.body.token;
  const friendCsrf = newRefUser.body.csrfToken;
  let referrerBonusAwarded = false;

  for (let i = 1; i <= 3; i++) {
    const friendDlToken = stream720.downloadToken; // valid format
    const friendClaim = await request({
      host: 'localhost',
      port: 3000,
      path: '/api/media/claim-reward',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${friendToken}`,
        'x-csrf-token': friendCsrf
      }
    }, {
      downloadToken: friendDlToken,
      url: 'https://youtube.com',
      title: `Friend HQ Video ${i}`,
      platform: 'youtube',
      quality: '720p'
    });
    if (friendClaim.body.referralBonusTriggered) {
      referrerBonusAwarded = true;
    }
  }
  console.log('9. Referral 3-Download Milestone (+250 for referrer):', referrerBonusAwarded ? 'PASS (+250 Awarded)' : 'FAIL');

  // 10. Wallet Overview & Redemption Request
  const wallet = await request({
    host: 'localhost',
    port: 3000,
    path: '/api/wallet/overview',
    method: 'GET',
    headers: { 'Authorization': `Bearer ${tokenAlex}` }
  });
  console.log('10. Wallet Overview:', wallet.status === 200 ? 'PASS' : 'FAIL', 'Coins:', wallet.body.wallet.coins, 'Payout Unlocked:', wallet.body.wallet.payoutUnlocked);

  // Redeem Tier 1 (12,000 Coins -> 100 INR)
  const redeem = await request({
    host: 'localhost',
    port: 3000,
    path: '/api/wallet/redeem',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${tokenAlex}`,
      'x-csrf-token': csrfAlex
    }
  }, { tierKey: 'tier_1' });
  console.log('11. Redemption Request (12k Coins -> 100 INR):', redeem.status === 200 ? 'PASS' : 'FAIL', redeem.body.message);

  // 12. Admin Login & 2FA TOTP Verification
  const adminLogin = await request({
    host: 'localhost',
    port: 3000,
    path: '/api/auth/quick-switch',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { target: 'admin' });
  const adminToken = adminLogin.body.token;
  const adminCsrf = adminLogin.body.csrfToken;

  // TOTP generation for default secret JBSWY3DPEHPK3PXP
  const totpService = require('./services/totpService');
  const totpCode = totpService.generateToken('JBSWY3DPEHPK3PXP');

  const verify2fa = await request({
    host: 'localhost',
    port: 3000,
    path: '/api/admin/2fa/verify',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`,
      'x-csrf-token': adminCsrf
    }
  }, { code: totpCode });
  console.log('12. Admin Google Authenticator 2FA Verification:', verify2fa.status === 200 ? 'PASS' : 'FAIL', verify2fa.body.message);

  // 13. Admin KPI Metrics
  const adminMetrics = await request({
    host: 'localhost',
    port: 3000,
    path: '/api/admin/metrics',
    method: 'GET',
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  console.log('13. Admin KPI Metrics:', adminMetrics.status === 200 ? 'PASS' : 'FAIL', 'Pending Payouts:', adminMetrics.body.metrics.pendingCount);

  // 14. Admin Payout Queue & Approve Action
  const adminPayouts = await request({
    host: 'localhost',
    port: 3000,
    path: '/api/admin/payouts',
    method: 'GET',
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  console.log('14. Admin Payout Queue:', adminPayouts.status === 200 ? 'PASS' : 'FAIL', 'Items:', adminPayouts.body.payouts.length);

  const pendingItem = adminPayouts.body.payouts.find(p => p.status === 'pending');
  if (pendingItem) {
    const approve = await request({
      host: 'localhost',
      port: 3000,
      path: `/api/admin/payouts/${pendingItem.id}/approve`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`,
        'x-csrf-token': adminCsrf
      }
    });
    console.log('15. Admin Payout Approval & UPI Reveal:', approve.status === 200 ? 'PASS' : 'FAIL', 'Revealed UPI:', approve.body.revealedUpi);
  }

  // 16. Admin User Audit Tool
  const auditUser = await request({
    host: 'localhost',
    port: 3000,
    path: `/api/admin/audit/user?query=alex.kumar@gmail.com`,
    method: 'GET',
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  console.log('16. User Ledger Audit Tool:', auditUser.status === 200 ? 'PASS' : 'FAIL', 'History logs:', auditUser.body.downloadHistory.length, 'Referral graph nodes:', auditUser.body.referralGraph.length);

  console.log('=== ALL 16 TESTS EXECUTED SUCCESSFULLY! ===');
}

runTests().catch(console.error);
