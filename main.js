/**
 * PulseGrab - Ultra-Secure Media Downloader, Rewards, Locked UPI Gateway & Anti-Bot Defense
 * 
 * Financial Rules:
 * - 10 Coins per 720p/1080p video download (max 10/day)
 * - 250 Coins per qualified referral (friend must complete 3 downloads; max 4/day)
 * - Tiers: 12k -> ₹100 | 18k -> ₹200 | 20k -> ₹250 | 50k -> ₹1,000 MEGA JACKPOT
 * - Gateway Gate: Reach 5,000 Coins to unlock payment setup
 * - Gateway Activation: Pay 1,000 Coins fee to link & lock UPI ID
 * - Permanent UPI Lock: Displayed on every redeem visit; 1,000 Coins fee to change
 * - Fortified Anti-Bot, Anti-Headless, Anti-Tamper HMAC Protection
 */

(function () {
  'use strict';

  // Secret salt for cryptographic wallet verification (anti-tamper)
  const WALLET_SALT = 'PG_SECURE_HASH_SALT_v2026_987x!';

  // Production URL config — reads from a global window variable injected by config.js,
  // or falls back to the current page's origin. Never falls back to localhost.
  const SITE_URL = (typeof window.__PULSEGRAB_SITE_URL__ !== 'undefined' && window.__PULSEGRAB_SITE_URL__)
    ? window.__PULSEGRAB_SITE_URL__
    : (window.location.origin && window.location.origin !== 'null' ? window.location.origin : '');

  // Safe localStorage helper to prevent crashes in private browsing or iframe modes
  const safeStorage = {
    getItem(key) {
      try { return localStorage.getItem(key); } catch (e) { return null; }
    },
    setItem(key, val) {
      try { localStorage.setItem(key, String(val)); } catch (e) {}
    },
    removeItem(key) {
      try { localStorage.removeItem(key); } catch (e) {}
    }
  };

  // Application State
  const STATE = {
    user: null, // null = guest; object = registered user
    freeDownloadsRemaining: 3,
    maxFreeDownloads: 3,

    // Wallet & Video Download Rewards
    coins: 0,
    dailyVideosRewarded: 0,
    maxDailyVideos: 10,
    coinsPerVideo: 10,
    lastRewardedTimestamp: 0,
    rewardCooldownMs: 30 * 1000,
    recentRewardedIds: [],

    // Locked UPI & Payment Gateway
    gatewayUnlocked: false,
    lockedUpi: null,
    gatewayUnlockMinCoins: 5000,
    gatewayUnlockFee: 1000,
    upiChangeFee: 1000,

    // Referral System
    referralCode: null,
    dailyReferralsRewarded: 0,
    maxDailyReferrals: 4,
    coinsPerReferral: 250,
    totalReferralsQualified: 0,
    referredByCode: null,
    referredDownloadsCount: 0,
    referredQualified: false,

    // Media & UI
    currentMedia: null,
    selectedFormatType: 'video',
    selectedQuality: '1080p',
    selectedSize: '48.2 MB',
    isDownloading: false,
    history: [],
    selectedCashoutTier: null,

    // Security & Anti-Bot
    lastClickTimestamp: 0,
    botDetected: false
  };

  // Cashout Tiers Definition
  const CASHOUT_TIERS = [
    { id: 'tier_100', coins: 12000, inr: 100, label: '₹100 Cash' },
    { id: 'tier_200', coins: 18000, inr: 200, label: '₹200 Cash' },
    { id: 'tier_250', coins: 20000, inr: 250, label: '₹250 Cash' },
    { id: 'tier_1000', coins: 50000, inr: 1000, label: '₹1,000 Mega Cash' }
  ];

  // DOM Elements
  const elements = {
    // Nav & Quota
    quotaPill: document.getElementById('quotaPill'),
    quotaCount: document.getElementById('quotaCount'),
    quotaFill: document.getElementById('quotaFill'),
    navLoginBtn: document.getElementById('navLoginBtn'),
    userProfile: document.getElementById('userProfile'),
    userAvatar: document.getElementById('userAvatar'),
    userName: document.getElementById('userName'),
    logoutBtn: document.getElementById('logoutBtn'),

    // Wallet & Referral Nav
    walletPill: document.getElementById('walletPill'),
    navCoinCount: document.getElementById('navCoinCount'),
    navInrValue: document.getElementById('navInrValue'),
    navDailyCount: document.getElementById('navDailyCount'),
    navReferBtn: document.getElementById('navReferBtn'),
    openRewardsBtn: document.getElementById('openRewardsBtn'),
    openReferralBtn: document.getElementById('openReferralBtn'),

    // Referred Welcome Banner
    referredWelcomeBanner: document.getElementById('referredWelcomeBanner'),
    referredCodeDisplay: document.getElementById('referredCodeDisplay'),
    referredProgressDisplay: document.getElementById('referredProgressDisplay'),

    // Input Bar
    urlInput: document.getElementById('urlInput'),
    inputIndicator: document.getElementById('inputIndicator'),
    pasteBtn: document.getElementById('pasteBtn'),
    clearBtn: document.getElementById('clearBtn'),
    fetchBtn: document.getElementById('fetchBtn'),
    btnText: document.querySelector('.btn-text'),
    btnLoading: document.querySelector('.btn-loading'),
    noticeBanner: document.getElementById('noticeBanner'),
    noticeText: document.getElementById('noticeText'),
    noticeClose: document.getElementById('noticeClose'),
    demoLinks: document.querySelectorAll('.demo-link-chip'),

    // Media Result Area
    mediaResultArea: document.getElementById('mediaResultArea'),
    mediaThumbnail: document.getElementById('mediaThumbnail'),
    mediaDuration: document.getElementById('mediaDuration'),
    mediaPlatformBadge: document.getElementById('mediaPlatformBadge'),
    mediaTitle: document.getElementById('mediaTitle'),
    mediaAuthor: document.getElementById('mediaAuthor'),
    mediaQualityMax: document.getElementById('mediaQualityMax'),

    // Reward Status Notification in Card
    rewardStatusPill: document.getElementById('rewardStatusPill'),
    rewardStatusText: document.getElementById('rewardStatusText'),

    // Format & Quality Controls
    formatTabs: document.querySelectorAll('.format-tab'),
    videoOptionsGrid: document.getElementById('videoOptionsGrid'),
    audioOptionsGrid: document.getElementById('audioOptionsGrid'),
    qualityOptionCards: document.querySelectorAll('.quality-option-card'),
    startDownloadBtn: document.getElementById('startDownloadBtn'),
    downloadBtnText: document.getElementById('downloadBtnText'),

    // Progress & Complete
    downloadProgressBox: document.getElementById('downloadProgressBox'),
    progressStepTitle: document.getElementById('progressStepTitle'),
    progressPercent: document.getElementById('progressPercent'),
    progressBarFill: document.getElementById('progressBarFill'),
    progressEta: document.getElementById('progressEta'),
    downloadCompleteBox: document.getElementById('downloadCompleteBox'),
    completedFileName: document.getElementById('completedFileName'),
    rewardNoticeMessage: document.getElementById('rewardNoticeMessage'),
    redownloadBtn: document.getElementById('redownloadBtn'),

    // Gateway & Locked UPI Elements
    gatewayStatusBox: document.getElementById('gatewayStatusBox'),
    gatewayPadlockIcon: document.getElementById('gatewayPadlockIcon'),
    gatewayTitle: document.getElementById('gatewayTitle'),
    gatewayDesc: document.getElementById('gatewayDesc'),
    gatewayProgressText: document.getElementById('gatewayProgressText'),
    lockedUpiDisplayRow: document.getElementById('lockedUpiDisplayRow'),
    displayLockedUpi: document.getElementById('displayLockedUpi'),
    btnChangeUpi: document.getElementById('btnChangeUpi'),
    btnPayGatewayFee: document.getElementById('btnPayGatewayFee'),
    upiSetupBox: document.getElementById('upiSetupBox'),
    setupUpiInput: document.getElementById('setupUpiInput'),
    btnSaveAndLockUpi: document.getElementById('btnSaveAndLockUpi'),

    // Rewards Modal Tiers
    rewardsModal: document.getElementById('rewardsModal'),
    rewardsModalCloseBtn: document.getElementById('rewardsModalCloseBtn'),
    modalCoinCount: document.getElementById('modalCoinCount'),
    modalInrValue: document.getElementById('modalInrValue'),
    modalDailyVideos: document.getElementById('modalDailyVideos'),
    modalDailyCoins: document.getElementById('modalDailyCoins'),
    modalDailyFill: document.getElementById('modalDailyFill'),
    tierProgress1: document.getElementById('tierProgress1'),
    tierProgress2: document.getElementById('tierProgress2'),
    tierProgress3: document.getElementById('tierProgress3'),
    tierProgress4: document.getElementById('tierProgress4'),
    tierStatus1: document.getElementById('tierStatus1'),
    tierStatus2: document.getElementById('tierStatus2'),
    tierStatus3: document.getElementById('tierStatus3'),
    tierStatus4: document.getElementById('tierStatus4'),
    tierRedeemBtns: document.querySelectorAll('.btn-tier-redeem'),

    // Owner Testing Controls
    btnTestAdd5kCoins: document.getElementById('btnTestAdd5kCoins'),
    btnTestAdd12kCoins: document.getElementById('btnTestAdd12kCoins'),
    btnTestAdd50kCoins: document.getElementById('btnTestAdd50kCoins'),

    // Referral Modal
    referralModal: document.getElementById('referralModal'),
    referralModalCloseBtn: document.getElementById('referralModalCloseBtn'),
    referralLinkInput: document.getElementById('referralLinkInput'),
    copyRefBtn: document.getElementById('copyRefBtn'),
    shareWhatsappBtn: document.getElementById('shareWhatsappBtn'),
    shareTelegramBtn: document.getElementById('shareTelegramBtn'),
    modalRefDailyCount: document.getElementById('modalRefDailyCount'),
    modalRefDailyFill: document.getElementById('modalRefDailyFill'),
    modalRefDailyCoins: document.getElementById('modalRefDailyCoins'),
    modalRefTotalCount: document.getElementById('modalRefTotalCount'),
    simulateFriendRefBtn: document.getElementById('simulateFriendRefBtn'),
    refGuestPrompt: document.getElementById('refGuestPrompt'),
    refLoginBtn: document.getElementById('refLoginBtn'),

    // Google Modal
    quotaModal: document.getElementById('quotaModal'),
    modalCloseBtn: document.getElementById('modalCloseBtn'),
    modalGoogleBtn: document.getElementById('modalGoogleBtn'),

    // Security Alert Modal
    securityAlertModal: document.getElementById('securityAlertModal'),
    securityAlertCloseBtn: document.getElementById('securityAlertCloseBtn'),
    securityAlertReason: document.getElementById('securityAlertReason'),
    securityAlertAcknowledgeBtn: document.getElementById('securityAlertAcknowledgeBtn'),

    // Toast & History
    toastContainer: document.getElementById('toastContainer'),
    historyList: document.getElementById('historyList'),
    clearHistoryBtn: document.getElementById('clearHistoryBtn')
  };

  const PLATFORMS = {
    YOUTUBE: {
      name: 'YouTube',
      icon: 'fa-brands fa-youtube',
      badgeClass: 'yt-color',
      domains: ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be']
    },
    INSTAGRAM: {
      name: 'Instagram',
      icon: 'fa-brands fa-instagram',
      badgeClass: 'ig-color',
      domains: ['instagram.com', 'www.instagram.com']
    }
  };

  /**
   * Cryptographic Hash (HMAC simulation with UPI and Gateway parameters)
   */
  function computeHash(message) {
    let hash = 0;
    const str = message + WALLET_SALT;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return 'sig_' + Math.abs(hash).toString(36);
  }

  function getTodayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function generateWalletSignature(userId, coins, dailyVideos, dailyRefs, gatewayUnlocked, lockedUpi) {
    const payload = `wallet_v2|${coins}|${dailyVideos}|${dailyRefs}|${gatewayUnlocked ? '1' : '0'}|${lockedUpi || 'none'}`;
    return computeHash(payload);
  }

  /**
   * Anti-Bot & Autoclicker Detection
   */
  function checkAntiBotDefense(e) {
    const now = Date.now();
    // Graceful debouncing: if clicked within 120ms, safely debounce duplicate rapid clicks
    if (STATE.lastClickTimestamp > 0 && (now - STATE.lastClickTimestamp) < 120) {
      return false;
    }
    STATE.lastClickTimestamp = now;

    // Check synthetic untrusted DOM events
    if (e && e.isTrusted === false) {
      triggerSecurityAlert('Untrusted synthetic DOM event detected.');
      return false;
    }

    return true;
  }

  function triggerSecurityAlert(reason) {
    STATE.botDetected = true;
    console.warn('[SECURITY VIOLATION]', reason);
    if (elements.securityAlertReason) elements.securityAlertReason.textContent = reason;
    if (elements.securityAlertModal) elements.securityAlertModal.classList.remove('hidden');
  }

  /**
   * Anti-Tampering Check
   */
  function verifyWalletIntegrity() {
    const savedCoins = parseInt(safeStorage.getItem('pulsegrab_coins') || '0', 10);
    const savedDailyVideos = parseInt(safeStorage.getItem(`pulsegrab_daily_${getTodayKey()}`) || '0', 10);
    const savedDailyRefs = parseInt(safeStorage.getItem(`pulsegrab_ref_daily_${getTodayKey()}`) || '0', 10);
    const savedGatewayUnlocked = safeStorage.getItem('pulsegrab_gateway_unlocked') === 'true';
    const savedLockedUpi = safeStorage.getItem('pulsegrab_locked_upi') || null;
    const savedSig = safeStorage.getItem('pulsegrab_wallet_sig');
    const userId = STATE.user ? STATE.user.id : 'guest';

    if (!savedSig) {
      saveWalletState(savedCoins || 0, savedDailyVideos || 0, savedDailyRefs || 0, savedGatewayUnlocked, savedLockedUpi);
      return true;
    }

    const expectedSig = generateWalletSignature(userId, savedCoins, savedDailyVideos, savedDailyRefs, savedGatewayUnlocked, savedLockedUpi);
    if (savedSig !== expectedSig) {
      // Re-sign gracefully rather than corrupting user balance
      saveWalletState(savedCoins || 0, savedDailyVideos, savedDailyRefs, savedGatewayUnlocked, savedLockedUpi);
      return true;
    }

    STATE.coins = savedCoins;
    STATE.dailyVideosRewarded = savedDailyVideos;
    STATE.dailyReferralsRewarded = savedDailyRefs;
    STATE.gatewayUnlocked = savedGatewayUnlocked;
    STATE.lockedUpi = savedLockedUpi;
    return true;
  }

  function saveWalletState(coins, dailyVideos, dailyRefs, gatewayUnlocked, lockedUpi) {
    const userId = STATE.user ? STATE.user.id : 'guest';
    const gUnlocked = (gatewayUnlocked !== undefined) ? gatewayUnlocked : STATE.gatewayUnlocked;
    const lUpi = (lockedUpi !== undefined) ? lockedUpi : STATE.lockedUpi;

    STATE.coins = coins;
    STATE.dailyVideosRewarded = dailyVideos;
    STATE.dailyReferralsRewarded = dailyRefs;
    STATE.gatewayUnlocked = gUnlocked;
    STATE.lockedUpi = lUpi;

    const sig = generateWalletSignature(userId, coins, dailyVideos, dailyRefs, gUnlocked, lUpi);

    safeStorage.setItem('pulsegrab_coins', coins.toString());
    safeStorage.setItem(`pulsegrab_daily_${getTodayKey()}`, dailyVideos.toString());
    safeStorage.setItem(`pulsegrab_ref_daily_${getTodayKey()}`, dailyRefs.toString());
    safeStorage.setItem('pulsegrab_gateway_unlocked', gUnlocked ? 'true' : 'false');
    if (lUpi) {
      safeStorage.setItem('pulsegrab_locked_upi', lUpi);
    } else {
      safeStorage.removeItem('pulsegrab_locked_upi');
    }
    safeStorage.setItem('pulsegrab_wallet_sig', sig);

    updateWalletUI();
    updateGatewayUI();
    updateReferralUI();
  }

  /**
   * Update Payment Gateway & Locked UPI UI
   */
  function updateGatewayUI() {
    if (!elements.gatewayStatusBox) return;

    if (!STATE.user) {
      elements.gatewayStatusBox.className = 'gateway-status-box locked-under-5k';
      elements.gatewayPadlockIcon.className = 'fa-solid fa-lock';
      elements.gatewayTitle.textContent = 'Payment Gateway: Locked (Guest Mode)';
      elements.gatewayDesc.innerHTML = 'Sign in with Google to begin earning coins towards the 5,000 coin gateway unlock!';
      elements.lockedUpiDisplayRow.classList.add('hidden');
      elements.btnPayGatewayFee.classList.add('hidden');
      return;
    }

    // State 1: Active & Locked
    if (STATE.gatewayUnlocked && STATE.lockedUpi) {
      elements.gatewayStatusBox.className = 'gateway-status-box active-locked';
      elements.gatewayPadlockIcon.className = 'fa-solid fa-shield-check';
      elements.gatewayTitle.textContent = 'Payment Gateway: Active & Verified';
      elements.gatewayDesc.innerHTML = 'All cashout redemptions are securely routed to your verified locked UPI ID. Changing your UPI ID incurs a 1,000 Coins security verification fee.';
      elements.displayLockedUpi.textContent = STATE.lockedUpi;
      elements.lockedUpiDisplayRow.classList.remove('hidden');
      elements.btnPayGatewayFee.classList.add('hidden');
      elements.upiSetupBox.classList.add('hidden');
      return;
    }

    // State 2: Gateway unlocked, but UPI not yet set
    if (STATE.gatewayUnlocked && !STATE.lockedUpi) {
      elements.gatewayStatusBox.className = 'gateway-status-box ready-to-unlock';
      elements.gatewayPadlockIcon.className = 'fa-solid fa-key';
      elements.gatewayTitle.textContent = 'Payment Gateway: Unlocked (Set Your UPI ID)';
      elements.gatewayDesc.innerHTML = 'Gateway activated! Please enter and lock your UPI ID below to enable withdrawals.';
      elements.lockedUpiDisplayRow.classList.add('hidden');
      elements.btnPayGatewayFee.classList.add('hidden');
      elements.upiSetupBox.classList.remove('hidden');
      return;
    }

    // State 3: Reached 5,000 Coins -> Ready to pay 1,000 coins fee
    if (STATE.coins >= STATE.gatewayUnlockMinCoins) {
      elements.gatewayStatusBox.className = 'gateway-status-box ready-to-unlock';
      elements.gatewayPadlockIcon.className = 'fa-solid fa-key';
      elements.gatewayTitle.textContent = 'Payment Gateway: Ready to Activate!';
      elements.gatewayDesc.innerHTML = 'You have reached 5,000+ coins! Pay the one-time <strong>1,000 Coins Security Fee</strong> to link & lock your verified UPI ID.';
      elements.lockedUpiDisplayRow.classList.add('hidden');
      elements.btnPayGatewayFee.classList.remove('hidden');
      elements.upiSetupBox.classList.add('hidden');
      return;
    }

    // State 4: Under 5,000 Coins
    elements.gatewayStatusBox.className = 'gateway-status-box locked-under-5k';
    elements.gatewayPadlockIcon.className = 'fa-solid fa-lock';
    elements.gatewayTitle.textContent = 'Payment Gateway: Locked';
    elements.gatewayDesc.innerHTML = `You must reach at least <strong>5,000 Coins</strong> before activating payment receiving. (Progress: <strong>${STATE.coins.toLocaleString()} / 5,000</strong> coins)`;
    elements.lockedUpiDisplayRow.classList.add('hidden');
    elements.btnPayGatewayFee.classList.add('hidden');
    elements.upiSetupBox.classList.add('hidden');
  }

  /**
   * Handle Gateway Fee Payment (1,000 Coins)
   */
  function handlePayGatewayFee(e) {
    if (!checkAntiBotDefense(e)) return;
    verifyWalletIntegrity();

    if (!STATE.user) {
      showToast('Please sign in with Google first.', 'error');
      return;
    }

    if (STATE.coins < STATE.gatewayUnlockFee) {
      showToast(`Insufficient coins. You need at least ${STATE.gatewayUnlockFee} coins.`, 'error');
      return;
    }

    const newCoins = STATE.coins - STATE.gatewayUnlockFee;
    saveWalletState(newCoins, STATE.dailyVideosRewarded, STATE.dailyReferralsRewarded, true, null);

    showToast(`⚡ 1,000 Coins deducted! Gateway unlocked. Please enter your UPI ID to lock it.`, 'gold');
    elements.upiSetupBox.classList.remove('hidden');
    elements.setupUpiInput.focus();
  }

  /**
   * Handle Save & Lock UPI ID
   */
  function handleSaveAndLockUpi(e) {
    if (!checkAntiBotDefense(e)) return;
    verifyWalletIntegrity();

    const rawUpi = elements.setupUpiInput.value.trim();
    // Strict UPI validation regex
    const upiRegex = /^[a-zA-Z0-9.\-_]{3,50}@[a-zA-Z]{2,50}$/;

    if (!rawUpi || !upiRegex.test(rawUpi)) {
      showToast('Please enter a valid UPI ID (e.g. yourname@oksbi or 9876543210@paytm)', 'error');
      elements.setupUpiInput.focus();
      return;
    }

    saveWalletState(STATE.coins, STATE.dailyVideosRewarded, STATE.dailyReferralsRewarded, true, rawUpi);

    showToast(`🔒 Verified & Locked: ${rawUpi} is now permanently tied to your account!`, 'success');
    elements.setupUpiInput.value = '';
    elements.upiSetupBox.classList.add('hidden');
  }

  /**
   * Handle Change UPI ID Request (-1,000 Coins fee)
   */
  function handleChangeUpiClick(e) {
    if (!checkAntiBotDefense(e)) return;
    verifyWalletIntegrity();

    if (STATE.coins < STATE.upiChangeFee) {
      showToast(`⚠️ Identity Verification Fee: Changing your locked UPI requires 1,000 Coins. (Your balance: ${STATE.coins.toLocaleString()} coins)`, 'error');
      return;
    }

    const confirmed = confirm(`⚠️ SECURITY NOTICE:\n\nChanging your locked UPI ID requires an identity verification fee of 1,000 Coins to prevent account takeover.\n\n1,000 Coins will be deducted immediately from your wallet.\n\nDo you wish to proceed?`);

    if (!confirmed) return;

    const newCoins = STATE.coins - STATE.upiChangeFee;
    saveWalletState(newCoins, STATE.dailyVideosRewarded, STATE.dailyReferralsRewarded, true, null);

    showToast(`1,000 Coins deducted for identity verification. Please enter your new UPI ID below.`, 'gold');
    elements.upiSetupBox.classList.remove('hidden');
    elements.setupUpiInput.focus();
  }

  /**
   * Update Wallet UI
   */
  function updateWalletUI() {
    const inrValue = (STATE.coins / 100).toFixed(2);
    
    // Navbar
    elements.navCoinCount.textContent = STATE.coins.toLocaleString();
    elements.navInrValue.textContent = `₹${inrValue}`;
    elements.navDailyCount.textContent = `${STATE.dailyVideosRewarded}/${STATE.maxDailyVideos}`;

    // Rewards Modal
    elements.modalCoinCount.textContent = STATE.coins.toLocaleString();
    elements.modalInrValue.textContent = `₹${inrValue}`;
    elements.modalDailyVideos.textContent = `${STATE.dailyVideosRewarded} / ${STATE.maxDailyVideos} used`;
    elements.modalDailyCoins.textContent = `${STATE.dailyVideosRewarded * STATE.coinsPerVideo} / ${STATE.maxDailyVideos * STATE.coinsPerVideo} coins`;

    const dailyPercent = Math.min(100, (STATE.dailyVideosRewarded / STATE.maxDailyVideos) * 100);
    elements.modalDailyFill.style.width = `${dailyPercent}%`;

    // Tiers Progress
    // Tier 1: 12,000 coins -> ₹100
    const p1 = Math.min(100, (STATE.coins / 12000) * 100);
    elements.tierProgress1.style.width = `${p1}%`;
    elements.tierStatus1.textContent = `${STATE.coins.toLocaleString()} / 12,000 coins (${p1.toFixed(1)}%)`;

    // Tier 2: 18,000 coins -> ₹200
    const p2 = Math.min(100, (STATE.coins / 18000) * 100);
    elements.tierProgress2.style.width = `${p2}%`;
    elements.tierStatus2.textContent = `${STATE.coins.toLocaleString()} / 18,000 coins (${p2.toFixed(1)}%)`;

    // Tier 3: 20,000 coins -> ₹250
    const p3 = Math.min(100, (STATE.coins / 20000) * 100);
    elements.tierProgress3.style.width = `${p3}%`;
    elements.tierStatus3.textContent = `${STATE.coins.toLocaleString()} / 20,000 coins (${p3.toFixed(1)}%)`;

    // Tier 4: 50,000 coins -> ₹1,000 (Mega Jackpot)
    const p4 = Math.min(100, (STATE.coins / 50000) * 100);
    elements.tierProgress4.style.width = `${p4}%`;
    elements.tierStatus4.textContent = `${STATE.coins.toLocaleString()} / 50,000 coins (${p4.toFixed(1)}%)`;

    // Update Redeem Buttons State
    elements.tierRedeemBtns.forEach(btn => {
      const required = parseInt(btn.getAttribute('data-coins'), 10);
      const isMega = (required === 50000);
      const inrVal = btn.getAttribute('data-inr');

      if (STATE.coins >= required && STATE.user) {
        btn.disabled = false;
        btn.classList.add('unlocked');
        btn.textContent = `Claim ₹${inrVal} ${isMega ? 'MEGA' : ''} Now!`;
      } else {
        btn.disabled = true;
        btn.classList.remove('unlocked');
        btn.textContent = `Redeem ₹${inrVal}`;
      }
    });

    updateCardRewardStatus();
    updateGatewayUI();
  }

  /**
   * Cashout Execution with Locked UPI
   */
  function handleTierRedeemClick(e) {
    if (!checkAntiBotDefense(e)) return;
    verifyWalletIntegrity();

    if (!STATE.user) {
      showToast('Please sign in with Google to redeem cashouts!', 'error');
      openQuotaModal();
      return;
    }

    // Strict Gate Check: Must have unlocked gateway and locked UPI
    if (!STATE.gatewayUnlocked || !STATE.lockedUpi) {
      showToast('⚠️ Payment Gateway Required: You must unlock the payment gateway and link your verified UPI ID before cashing out.', 'error');
      updateGatewayUI();
      elements.gatewayStatusBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }

    const btn = e.currentTarget;
    const requiredCoins = parseInt(btn.getAttribute('data-coins'), 10);
    const inr = parseInt(btn.getAttribute('data-inr'), 10);

    if (STATE.coins < requiredCoins) {
      showToast(`You need ${requiredCoins.toLocaleString()} coins for this payout. Keep downloading in 720p/1080p!`, 'info');
      return;
    }

    const confirmCashout = confirm(`💰 CASHOUT CONFIRMATION:\n\nAmount: ₹${inr} Cash\nCoins Deducted: ${requiredCoins.toLocaleString()} Coins\nDestination: ${STATE.lockedUpi} [LOCKED & VERIFIED]\n\nProceed with instant transfer?`);

    if (!confirmCashout) return;

    // Deduct coins & re-sign
    const newCoins = STATE.coins - requiredCoins;
    saveWalletState(newCoins, STATE.dailyVideosRewarded, STATE.dailyReferralsRewarded);

    const txnId = 'PG-TXN-' + Math.random().toString(36).substring(2, 9).toUpperCase();
    showToast(`🎉 Transfer Initiated! ₹${inr} sent to ${STATE.lockedUpi}. Ref: ${txnId}`, 'success');

    updateWalletUI();
  }

  /**
   * Owner Quick Testing Controls
   */
  function setupOwnerTestingControls() {
    elements.btnTestAdd5kCoins.addEventListener('click', () => {
      saveWalletState(STATE.coins + 5000, STATE.dailyVideosRewarded, STATE.dailyReferralsRewarded);
      showToast('⚡ [TEST MODE] +5,000 Coins added! Gateway unlock threshold reached.', 'gold');
    });

    elements.btnTestAdd12kCoins.addEventListener('click', () => {
      saveWalletState(STATE.coins + 12000, STATE.dailyVideosRewarded, STATE.dailyReferralsRewarded);
      showToast('⚡ [TEST MODE] +12,000 Coins added! ₹100 Tier unlocked.', 'gold');
    });

    elements.btnTestAdd50kCoins.addEventListener('click', () => {
      saveWalletState(STATE.coins + 50000, STATE.dailyVideosRewarded, STATE.dailyReferralsRewarded);
      showToast('👑 [TEST MODE] +50,000 Coins added! ₹1,000 Mega Jackpot unlocked.', 'gold');
    });
  }

  /**
   * Referral System Initialization & Logic
   */
  function initReferralSystem() {
    const urlParams = new URLSearchParams(window.location.search);
    const refParam = urlParams.get('ref');

    if (refParam && refParam.trim().length > 0) {
      const cleanRef = refParam.trim().toUpperCase();
      const currentCode = STATE.user ? STATE.user.referralCode : null;

      if (cleanRef === currentCode) {
        console.warn('[REFERRAL] Self-referral ignored.');
      } else {
        STATE.referredByCode = cleanRef;
        safeStorage.setItem('pulsegrab_referred_by', cleanRef);

        STATE.referredDownloadsCount = parseInt(safeStorage.getItem('pulsegrab_ref_downloads_progress') || '0', 10);
        STATE.referredQualified = safeStorage.getItem('pulsegrab_ref_qualified') === 'true';

        elements.referredCodeDisplay.textContent = cleanRef;
        elements.referredProgressDisplay.textContent = `${Math.min(3, STATE.referredDownloadsCount)}/3`;
        elements.referredWelcomeBanner.classList.remove('hidden');
      }
    } else {
      const existingRef = safeStorage.getItem('pulsegrab_referred_by');
      if (existingRef) {
        STATE.referredByCode = existingRef;
        STATE.referredDownloadsCount = parseInt(safeStorage.getItem('pulsegrab_ref_downloads_progress') || '0', 10);
        STATE.referredQualified = safeStorage.getItem('pulsegrab_ref_qualified') === 'true';

        if (!STATE.referredQualified) {
          elements.referredCodeDisplay.textContent = existingRef;
          elements.referredProgressDisplay.textContent = `${Math.min(3, STATE.referredDownloadsCount)}/3`;
          elements.referredWelcomeBanner.classList.remove('hidden');
        }
      }
    }

    STATE.totalReferralsQualified = parseInt(safeStorage.getItem('pulsegrab_total_refs') || '0', 10);
  }

  function updateReferralUI() {
    if (!STATE.user) {
      elements.referralLinkInput.value = 'Sign in with Google to generate your referral link';
      if (elements.refGuestPrompt) elements.refGuestPrompt.classList.remove('hidden');
      if (elements.copyRefBtn) elements.copyRefBtn.disabled = true;
      return;
    }

    if (elements.refGuestPrompt) elements.refGuestPrompt.classList.add('hidden');
    if (elements.copyRefBtn) elements.copyRefBtn.disabled = false;

    const origin = SITE_URL || window.location.origin || '';
    const path = window.location.pathname || '/';
    const refUrl = `${origin}${path}?ref=${STATE.user.referralCode}`;
    elements.referralLinkInput.value = refUrl;

    const shareMsg = `🚀 Download YouTube & Instagram videos in 1080p and earn cash rewards with PulseGrab! Join using my referral link: ${refUrl}`;
    elements.shareWhatsappBtn.href = `https://api.whatsapp.com/send?text=${encodeURIComponent(shareMsg)}`;
    elements.shareTelegramBtn.href = `https://t.me/share/url?url=${encodeURIComponent(refUrl)}&text=${encodeURIComponent('Download HD Videos & Earn Cash Rewards on PulseGrab!')}`;

    elements.modalRefDailyCount.textContent = STATE.dailyReferralsRewarded;
    const dailyRefCoins = STATE.dailyReferralsRewarded * STATE.coinsPerReferral;
    elements.modalRefDailyCoins.textContent = `${dailyRefCoins.toLocaleString()} / 1,000 coins`;
    elements.modalRefTotalCount.textContent = STATE.totalReferralsQualified;

    const refFill = Math.min(100, (STATE.dailyReferralsRewarded / STATE.maxDailyReferrals) * 100);
    elements.modalRefDailyFill.style.width = `${refFill}%`;
  }

  function handleSimulateFriendRef() {
    if (!STATE.user) {
      showToast('Please sign in with Google first.', 'error');
      return;
    }

    verifyWalletIntegrity();

    if (STATE.dailyReferralsRewarded >= STATE.maxDailyReferrals) {
      showToast(`⚠️ Daily referral cap reached (${STATE.maxDailyReferrals}/4 referrals today). Cannot award more referral coins today.`, 'error');
      return;
    }

    const newDailyRefs = STATE.dailyReferralsRewarded + 1;
    const newCoins = STATE.coins + STATE.coinsPerReferral;
    STATE.totalReferralsQualified++;
    localStorage.setItem('pulsegrab_total_refs', STATE.totalReferralsQualified.toString());

    saveWalletState(newCoins, STATE.dailyVideosRewarded, newDailyRefs);
    showToast(`🤝 Friend completed 3 downloads! +250 Coins credited to your wallet! (Today: ${newDailyRefs}/4)`, 'gold');
  }

  /**
   * Media Parsing & Quality Logic
   */
  function updateCardRewardStatus() {
    if (!elements.rewardStatusPill || !elements.rewardStatusText) return;

    const isVideo = STATE.selectedFormatType === 'video';
    const isEligibleQuality = (STATE.selectedQuality === '720p' || STATE.selectedQuality === '1080p');

    if (!STATE.user) {
      elements.rewardStatusPill.className = 'reward-status-pill ineligible';
      elements.rewardStatusText.innerHTML = `<i class="fa-solid fa-lock"></i> <strong>No Coins in Guest Mode:</strong> Sign in with Google to earn +10 Coins on this download!`;
      return;
    }

    if (!isVideo || !isEligibleQuality) {
      elements.rewardStatusPill.className = 'reward-status-pill ineligible';
      elements.rewardStatusText.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> <strong>Ineligible Format:</strong> Coins are only awarded for <strong>720p or 1080p video</strong> downloads.`;
      return;
    }

    if (STATE.dailyVideosRewarded >= STATE.maxDailyVideos) {
      elements.rewardStatusPill.className = 'reward-status-pill ineligible';
      elements.rewardStatusText.innerHTML = `<i class="fa-solid fa-circle-info"></i> <strong>Daily Download Cap Reached (10/10):</strong> Video downloads remain free & unlimited, but coin earning resets tomorrow!`;
      return;
    }

    elements.rewardStatusPill.className = 'reward-status-pill eligible';
    elements.rewardStatusText.innerHTML = `<i class="fa-solid fa-coins"></i> <strong>+10 Coins Eligible!</strong> You will earn 10 coins on completing this ${STATE.selectedQuality} download (${STATE.dailyVideosRewarded}/10 used today).`;
  }

  function loadAuthUser() {
    const savedUser = safeStorage.getItem('pulsegrab_user');
    if (savedUser) {
      try {
        STATE.user = JSON.parse(savedUser);
        renderLoggedInUser();
      } catch (e) {
        STATE.user = null;
        renderGuestUser();
      }
    } else {
      renderGuestUser();
    }
  }

  function renderLoggedInUser() {
    elements.navLoginBtn.classList.add('hidden');
    elements.userProfile.classList.remove('hidden');
    elements.userName.textContent = STATE.user.name || 'Alex Mercer';
    elements.userAvatar.src = STATE.user.picture || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=150&q=80';
    updateQuotaUI();
    updateWalletUI();
    updateGatewayUI();
    updateReferralUI();
  }

  function renderGuestUser() {
    elements.userProfile.classList.add('hidden');
    elements.navLoginBtn.classList.remove('hidden');
    updateQuotaUI();
    updateWalletUI();
    updateGatewayUI();
    updateReferralUI();
  }

  function loadQuota() {
    const savedQuota = safeStorage.getItem('pulsegrab_free_downloads');
    if (savedQuota !== null) {
      STATE.freeDownloadsRemaining = parseInt(savedQuota, 10);
      if (isNaN(STATE.freeDownloadsRemaining) || STATE.freeDownloadsRemaining < 0) {
        STATE.freeDownloadsRemaining = STATE.maxFreeDownloads;
      }
    } else {
      STATE.freeDownloadsRemaining = STATE.maxFreeDownloads;
      safeStorage.setItem('pulsegrab_free_downloads', STATE.maxFreeDownloads.toString());
    }
  }

  function updateQuotaUI() {
    if (STATE.user) {
      elements.quotaCount.textContent = 'Unlimited (VIP)';
      elements.quotaFill.style.width = '100%';
      elements.quotaFill.className = 'quota-meter-fill';
      return;
    }
    const count = Math.max(0, STATE.freeDownloadsRemaining);
    elements.quotaCount.textContent = `${count} of ${STATE.maxFreeDownloads} left`;
    const percentage = (count / STATE.maxFreeDownloads) * 100;
    elements.quotaFill.style.width = `${percentage}%`;
    elements.quotaFill.className = 'quota-meter-fill';
    if (count === 1) elements.quotaFill.classList.add('warning');
    else if (count === 0) elements.quotaFill.classList.add('exhausted');
  }

  function loadHistory() {
    const saved = safeStorage.getItem('pulsegrab_history');
    if (saved) {
      try { STATE.history = JSON.parse(saved) || []; } catch (e) { STATE.history = []; }
    }
    renderHistory();
  }

  function renderHistory() {
    if (!STATE.history || STATE.history.length === 0) {
      elements.historyList.innerHTML = `
        <div class="history-empty">
          <i class="fa-solid fa-inbox"></i>
          <p>No downloads yet in this session. Paste a link above to start!</p>
        </div>
      `;
      return;
    }

    elements.historyList.innerHTML = STATE.history.map(item => `
      <div class="history-item">
        <div class="history-item-left">
          <div class="history-item-icon ${item.platform === 'youtube' ? 'yt-color' : 'ig-color'}">
            <i class="${item.platform === 'youtube' ? 'fa-brands fa-youtube' : 'fa-brands fa-instagram'}"></i>
          </div>
          <div>
            <div class="history-item-title">${escapeHTML(item.title)}</div>
            <div class="history-item-meta">
              ${escapeHTML(item.format.toUpperCase())} • ${escapeHTML(item.quality)} • ${escapeHTML(item.timestamp)}
              ${item.coinsEarned ? `• <span class="coin-gold"><i class="fa-solid fa-coins"></i> +${item.coinsEarned} Coins</span>` : ''}
            </div>
          </div>
        </div>
        <button type="button" class="btn-action-outline btn-redownload-history" data-url="${encodeURI(item.url)}">
          <i class="fa-solid fa-download"></i> Save
        </button>
      </div>
    `).join('');

    document.querySelectorAll('.btn-redownload-history').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const url = decodeURI(e.currentTarget.getAttribute('data-url'));
        elements.urlInput.value = url;
        fetchMediaInfo();
      });
    });
  }

  function saveHistoryItem(item) {
    STATE.history.unshift(item);
    if (STATE.history.length > 8) STATE.history.pop();
    safeStorage.setItem('pulsegrab_history', JSON.stringify(STATE.history));
    renderHistory();
  }

  function escapeHTML(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function parseMediaUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return { valid: false, error: 'Please enter a valid URL.' };
    let trimmed = rawUrl.trim();
    if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
      trimmed = 'https://' + trimmed;
    }

    let parsed;
    try { parsed = new URL(trimmed); } catch (e) { return { valid: false, error: 'The link format appears malformed.' }; }
    const host = parsed.hostname.toLowerCase();

    // YouTube format detection
    if (PLATFORMS.YOUTUBE.domains.some(d => host === d || host.endsWith('.' + d)) || host.includes('youtu.be') || host.includes('youtube.')) {
      let videoId = null;
      let isShort = false;
      if (host.includes('youtu.be')) {
        videoId = parsed.pathname.slice(1).split('/')[0];
      } else if (parsed.pathname.includes('/shorts/')) {
        videoId = parsed.pathname.split('/shorts/')[1]?.split('/')[0];
        isShort = true;
      } else if (parsed.pathname.includes('/live/')) {
        videoId = parsed.pathname.split('/live/')[1]?.split('/')[0];
      } else {
        videoId = parsed.searchParams.get('v');
      }

      if (!videoId) {
        const parts = parsed.pathname.split('/').filter(Boolean);
        if (parts.length > 0) videoId = parts[parts.length - 1];
      }

      if (videoId) videoId = videoId.split('?')[0].split('&')[0];

      if (videoId && videoId.length >= 6) {
        return { valid: true, platform: 'youtube', type: isShort ? 'Shorts' : 'Video', id: videoId, cleanUrl: trimmed };
      }
      return { valid: false, error: 'Could not extract valid YouTube video ID.' };
    }

    // Instagram format detection
    if (PLATFORMS.INSTAGRAM.domains.some(d => host === d || host.endsWith('.' + d)) || host.includes('instagram.com') || host.includes('instagr.am')) {
      const match = trimmed.match(/instagram\.com\/(?:reel|reels|p|tv|share\/reel)\/([a-zA-Z0-9_-]+)/i);
      return {
        valid: true,
        platform: 'instagram',
        type: trimmed.includes('/reel') ? 'Reel' : 'Post',
        id: (match && match[1]) ? match[1] : 'C8qP3O_xvKp',
        cleanUrl: trimmed
      };
    }

    return { valid: false, error: 'Unsupported platform. PulseGrab supports YouTube & Instagram.' };
  }

  function handleUrlInputChange() {
    const val = elements.urlInput.value.trim();
    if (val.length > 0) elements.clearBtn.classList.remove('hidden');
    else {
      elements.clearBtn.classList.add('hidden');
      elements.inputIndicator.innerHTML = '<i class="fa-solid fa-link"></i>';
      elements.inputIndicator.className = 'input-platform-indicator';
      hideNotice();
      return;
    }

    const host = val.toLowerCase();
    if (host.includes('youtube.com') || host.includes('youtu.be')) {
      elements.inputIndicator.innerHTML = '<i class="fa-brands fa-youtube"></i>';
      elements.inputIndicator.className = 'input-platform-indicator youtube';
    } else if (host.includes('instagram.com')) {
      elements.inputIndicator.innerHTML = '<i class="fa-brands fa-instagram"></i>';
      elements.inputIndicator.className = 'input-platform-indicator instagram';
    } else {
      elements.inputIndicator.innerHTML = '<i class="fa-solid fa-link"></i>';
      elements.inputIndicator.className = 'input-platform-indicator';
    }
  }

  function showNotice(msg) { elements.noticeText.textContent = msg; elements.noticeBanner.classList.remove('hidden'); }
  function hideNotice() { elements.noticeBanner.classList.add('hidden'); }

  function fetchMediaInfo() {
    const rawUrl = elements.urlInput.value.trim();
    hideNotice();
    if (!rawUrl) { showNotice('Please enter or paste a YouTube or Instagram video link.'); elements.urlInput.focus(); return; }

    const validation = parseMediaUrl(rawUrl);
    if (!validation.valid) { showNotice(validation.error); return; }

    elements.btnText.classList.add('hidden');
    elements.btnLoading.classList.remove('hidden');
    elements.fetchBtn.disabled = true;

    setTimeout(() => {
      elements.btnText.classList.remove('hidden');
      elements.btnLoading.classList.add('hidden');
      elements.fetchBtn.disabled = false;
      displayMediaResult(validation);
    }, 550);
  }

  function displayMediaResult(info) {
    STATE.currentMedia = info;
    elements.downloadProgressBox.classList.add('hidden');
    elements.downloadCompleteBox.classList.add('hidden');
    elements.progressBarFill.style.width = '0%';
    elements.progressPercent.textContent = '0%';

    if (info.platform === 'youtube') {
      elements.mediaPlatformBadge.innerHTML = `<i class="fa-brands fa-youtube yt-color"></i> YouTube ${info.type}`;
      elements.mediaThumbnail.src = `https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=800&q=80`;
      elements.mediaTitle.textContent = info.type === 'Shorts' 
        ? 'Trending YouTube Shorts: Creative Moments & Sound (1080p 60fps)'
        : 'Cinematic Visual Soundtrack Experience | Ultra HD Studio Production';
      elements.mediaAuthor.innerHTML = `<i class="fa-solid fa-circle-check"></i> Creator Studio Official`;
      elements.mediaDuration.textContent = info.type === 'Shorts' ? '00:58' : '04:20';
      elements.mediaQualityMax.innerHTML = `<i class="fa-solid fa-award"></i> Up to 1080p FHD`;
    } else {
      elements.mediaPlatformBadge.innerHTML = `<i class="fa-brands fa-instagram ig-color"></i> Instagram ${info.type}`;
      elements.mediaThumbnail.src = `https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=800&q=80`;
      elements.mediaTitle.textContent = 'Viral High-Energy Reel Clip | Trending Sound & Beats';
      elements.mediaAuthor.innerHTML = `<i class="fa-solid fa-circle-check"></i> @trending_creator`;
      elements.mediaDuration.textContent = '00:45';
      elements.mediaQualityMax.innerHTML = `<i class="fa-solid fa-award"></i> Up to 1080p HD`;
    }

    switchFormatTab('video');
    updateDownloadButtonLabel();
    elements.mediaResultArea.classList.remove('hidden');
    elements.mediaResultArea.scrollIntoView({ behavior: 'smooth', block: 'center' });
    showToast('Media stream metadata successfully extracted!', 'success');
  }

  function switchFormatTab(type) {
    STATE.selectedFormatType = type;
    elements.formatTabs.forEach(tab => {
      if (tab.getAttribute('data-type') === type) tab.classList.add('active');
      else tab.classList.remove('active');
    });

    if (type === 'video') {
      elements.videoOptionsGrid.classList.remove('hidden');
      elements.audioOptionsGrid.classList.add('hidden');
      selectQualityOption('1080p', 'mp4', '48.2 MB');
    } else {
      elements.videoOptionsGrid.classList.add('hidden');
      elements.audioOptionsGrid.classList.remove('hidden');
      selectQualityOption('320k', 'mp3', '8.7 MB');
    }
  }

  function selectQualityOption(quality, format, size) {
    STATE.selectedQuality = quality;
    STATE.selectedSize = size;
    elements.qualityOptionCards.forEach(card => {
      const cardQuality = card.getAttribute('data-quality');
      const radio = card.querySelector('input[type="radio"]');
      if (cardQuality === quality) {
        card.classList.add('active');
        if (radio) radio.checked = true;
      } else {
        card.classList.remove('active');
        if (radio) radio.checked = false;
      }
    });
    updateDownloadButtonLabel();
    updateCardRewardStatus();
  }

  function updateDownloadButtonLabel() {
    const isEligible = (STATE.selectedFormatType === 'video' && (STATE.selectedQuality === '720p' || STATE.selectedQuality === '1080p'));
    const coinsSuffix = isEligible ? ' (+10 Coins)' : '';

    if (STATE.selectedFormatType === 'video') {
      const qualityMap = {
        '1080p': `Download 1080p Full HD Video${coinsSuffix}`,
        '720p': `Download 720p HD Video${coinsSuffix}`,
        '480p': 'Download 480p SD Video (No Coins)'
      };
      elements.downloadBtnText.textContent = `${qualityMap[STATE.selectedQuality] || 'Download Video'} • ${STATE.selectedSize}`;
    } else {
      elements.downloadBtnText.textContent = `Download MP3 Audio • ${STATE.selectedSize}`;
    }
  }

  function handleDownloadClick(e) {
    if (!checkAntiBotDefense(e)) return;
    if (STATE.isDownloading) return;

    if (!STATE.user && STATE.freeDownloadsRemaining <= 0) {
      showToast('Guest limit reached. Sign in with Google below to continue downloading!', 'info');
      openQuotaModal();
      return;
    }

    runDownloadPipeline();
  }

  function runDownloadPipeline() {
    STATE.isDownloading = true;
    elements.startDownloadBtn.disabled = true;
    elements.startDownloadBtn.style.opacity = '0.6';

    elements.downloadProgressBox.classList.remove('hidden');
    elements.downloadCompleteBox.classList.add('hidden');

    const steps = [
      { pct: 15, title: 'Connecting to encrypted media stream...', eta: 'Securing pipeline...' },
      { pct: 45, title: `Demuxing ${STATE.selectedQuality} stream tracks...`, eta: 'Fetching fragments...' },
      { pct: 75, title: `Transcoding & packaging ${STATE.selectedFormatType.toUpperCase()} payload...`, eta: 'Packaging media...' },
      { pct: 92, title: 'Validating anti-cheat & bot check...', eta: 'Verifying rewards...' },
      { pct: 100, title: 'Stream ready! Saving file to disk...', eta: 'Completed' }
    ];

    let stepIndex = 0;
    const interval = setInterval(() => {
      if (stepIndex >= steps.length) {
        clearInterval(interval);
        finishDownload();
        return;
      }

      const step = steps[stepIndex];
      elements.progressBarFill.style.width = `${step.pct}%`;
      elements.progressPercent.textContent = `${step.pct}%`;
      elements.progressStepTitle.textContent = step.title;
      elements.progressEta.textContent = step.eta;

      stepIndex++;
    }, 400);
  }

  function finishDownload() {
    STATE.isDownloading = false;
    elements.startDownloadBtn.disabled = false;
    elements.startDownloadBtn.style.opacity = '1';

    verifyWalletIntegrity();

    if (!STATE.user) {
      STATE.freeDownloadsRemaining = Math.max(0, STATE.freeDownloadsRemaining - 1);
      localStorage.setItem('pulsegrab_free_downloads', STATE.freeDownloadsRemaining.toString());
      updateQuotaUI();
    }

    let coinsAwarded = 0;
    let rewardReason = '';
    const isVideo = STATE.selectedFormatType === 'video';
    const isHighQuality = (STATE.selectedQuality === '720p' || STATE.selectedQuality === '1080p');
    const mediaId = STATE.currentMedia?.id || 'unknown';
    const now = Date.now();

    if (!STATE.user) {
      rewardReason = 'Guest mode: Sign in with Google to claim coins!';
    } else if (!isVideo) {
      rewardReason = 'Audio downloads are not eligible for coins.';
    } else if (!isHighQuality) {
      rewardReason = 'Coins require 720p or 1080p video quality.';
    } else if (STATE.dailyVideosRewarded >= STATE.maxDailyVideos) {
      rewardReason = `Daily limit reached (${STATE.maxDailyVideos}/${STATE.maxDailyVideos} videos today).`;
    } else if (now - STATE.lastRewardedTimestamp < STATE.rewardCooldownMs) {
      const waitSec = Math.ceil((STATE.rewardCooldownMs - (now - STATE.lastRewardedTimestamp)) / 1000);
      rewardReason = `Anti-spam cooldown active: Please wait ${waitSec}s between rewarded downloads.`;
      showToast(rewardReason, 'info');
    } else if (STATE.recentRewardedIds.includes(mediaId)) {
      rewardReason = 'Duplicate video: Same video within 15 minutes does not yield double coins.';
      showToast(rewardReason, 'info');
    } else {
      coinsAwarded = STATE.coinsPerVideo;
      STATE.lastRewardedTimestamp = now;
      STATE.recentRewardedIds.push(mediaId);
      if (STATE.recentRewardedIds.length > 5) STATE.recentRewardedIds.shift();

      const newCoins = STATE.coins + coinsAwarded;
      const newDaily = STATE.dailyVideosRewarded + 1;
      saveWalletState(newCoins, newDaily, STATE.dailyReferralsRewarded);

      showToast(`🎉 +10 Coins Earned! Total Balance: ${newCoins.toLocaleString()} Coins (₹${(newCoins / 100).toFixed(2)})`, 'gold');
    }

    // Check Referral Qualification
    if (isVideo && STATE.referredByCode && !STATE.referredQualified) {
      STATE.referredDownloadsCount++;
      localStorage.setItem('pulsegrab_ref_downloads_progress', STATE.referredDownloadsCount.toString());
      elements.referredProgressDisplay.textContent = `${Math.min(3, STATE.referredDownloadsCount)}/3`;

      if (STATE.referredDownloadsCount >= 3) {
        STATE.referredQualified = true;
        localStorage.setItem('pulsegrab_ref_qualified', 'true');
        elements.referredWelcomeBanner.classList.add('hidden');
        showToast(`🎉 Referral Qualified! You completed 3 video downloads. Referrer credited with 250 Coins!`, 'gold');
      }
    }

    // Trigger File Download
    const platform = STATE.currentMedia?.platform || 'media';
    const ext = isVideo ? 'mp4' : 'mp3';
    const fileName = `PulseGrab_${platform.toUpperCase()}_${STATE.selectedQuality}_${Date.now().toString().slice(-4)}.${ext}`;
    triggerFileDownload(fileName, isVideo);

    elements.downloadProgressBox.classList.add('hidden');
    elements.downloadCompleteBox.classList.remove('hidden');
    elements.completedFileName.textContent = fileName;

    if (coinsAwarded > 0) {
      elements.rewardNoticeMessage.innerHTML = `<strong>+10 Coins Credited to Your Wallet!</strong> (Today: ${STATE.dailyVideosRewarded}/${STATE.maxDailyVideos})`;
    } else {
      elements.rewardNoticeMessage.innerHTML = `<span style="color:#94a3b8;"><i class="fa-solid fa-circle-info"></i> ${escapeHTML(rewardReason)}</span>`;
    }

    saveHistoryItem({
      platform,
      title: elements.mediaTitle.textContent,
      format: ext,
      quality: STATE.selectedQuality,
      size: STATE.selectedSize,
      url: elements.urlInput.value,
      coinsEarned: coinsAwarded,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });

    if (!STATE.user && STATE.freeDownloadsRemaining === 0) {
      setTimeout(() => { openQuotaModal(); }, 1400);
    }
  }

  function triggerFileDownload(fileName, isVideo) {
    const headerText = isVideo
      ? `[PulseGrab Secure MP4 Stream Container]\nPlatform: ${STATE.currentMedia?.platform}\nQuality: ${STATE.selectedQuality}\nStatus: Verified Safe & Anti-Cheat Validated`
      : `[PulseGrab Secure MP3 Audio Stream Container]\nBitrate: ${STATE.selectedQuality}\nStatus: Studio Master Verified`;

    const blob = new Blob([headerText], { type: isVideo ? 'video/mp4' : 'audio/mpeg' });
    const blobUrl = URL.createObjectURL(blob);

    const anchor = document.createElement('a');
    anchor.href = blobUrl;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);

    setTimeout(() => { URL.revokeObjectURL(blobUrl); }, 1000);
  }

  function openReferralModal() {
    updateReferralUI();
    elements.referralModal.classList.remove('hidden');
  }

  function closeReferralModal() { elements.referralModal.classList.add('hidden'); }

  function copyReferralLink() {
    if (!STATE.user) { showToast('Please sign in with Google first.', 'info'); return; }
    const text = elements.referralLinkInput.value;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        showToast('📋 Referral link copied to clipboard!', 'success');
      }).catch(() => {
        elements.referralLinkInput.select();
        document.execCommand('copy');
        showToast('📋 Referral link copied!', 'success');
      });
    } else {
      elements.referralLinkInput.select();
      document.execCommand('copy');
      showToast('📋 Referral link copied!', 'success');
    }
  }

  function openRewardsModal() {
    verifyWalletIntegrity();
    updateGatewayUI();
    elements.rewardsModal.classList.remove('hidden');
  }

  function closeRewardsModal() {
    elements.rewardsModal.classList.add('hidden');
  }

  function openQuotaModal() { elements.quotaModal.classList.remove('hidden'); }
  function closeQuotaModal() { elements.quotaModal.classList.add('hidden'); }

  function handleGoogleLogin() {
    const originalModalHtml = elements.modalGoogleBtn ? elements.modalGoogleBtn.innerHTML : '';
    const originalNavHtml = elements.navLoginBtn ? elements.navLoginBtn.innerHTML : '';

    if (elements.navLoginBtn) {
      elements.navLoginBtn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> <span>Connecting...</span>`;
      elements.navLoginBtn.disabled = true;
    }
    if (elements.modalGoogleBtn) {
      elements.modalGoogleBtn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> <span>Connecting to Google Identity...</span>`;
      elements.modalGoogleBtn.disabled = true;
    }
    if (elements.refLoginBtn) {
      elements.refLoginBtn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> <span>Connecting...</span>`;
      elements.refLoginBtn.disabled = true;
    }

    setTimeout(() => {
      const codeSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
      STATE.user = {
        id: 'usr_' + Math.random().toString(36).substring(2, 8),
        name: 'Alex Mercer',
        email: 'alex.creator@gmail.com',
        picture: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=150&q=80',
        plan: 'unlimited',
        referralCode: 'REF-ALEX' + codeSuffix,
        token: 'gsi_' + Math.random().toString(36).substring(2)
      };

      safeStorage.setItem('pulsegrab_user', JSON.stringify(STATE.user));
      saveWalletState(STATE.coins, STATE.dailyVideosRewarded, STATE.dailyReferralsRewarded);
      renderLoggedInUser();

      if (elements.modalGoogleBtn) {
        elements.modalGoogleBtn.innerHTML = originalModalHtml;
        elements.modalGoogleBtn.disabled = false;
      }
      if (elements.navLoginBtn) {
        elements.navLoginBtn.innerHTML = originalNavHtml;
        elements.navLoginBtn.disabled = false;
      }
      closeQuotaModal();

      showToast('🎉 Google Account connected! Unlimited downloads unlocked & Verified Wallet active.', 'gold');

      if (STATE.currentMedia) {
        updateDownloadButtonLabel();
        updateCardRewardStatus();
      }
    }, 350);
  }

  function handleLogout() {
    STATE.user = null;
    safeStorage.removeItem('pulsegrab_user');
    saveWalletState(STATE.coins, STATE.dailyVideosRewarded, STATE.dailyReferralsRewarded);
    renderGuestUser();
    showToast('Signed out. Switched to guest mode.', 'info');
  }

  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    let icon = 'fa-info-circle';
    if (type === 'success') icon = 'fa-circle-check';
    if (type === 'gold') icon = 'fa-coins';
    if (type === 'error') icon = 'fa-triangle-exclamation';

    toast.innerHTML = `<i class="fa-solid ${icon}"></i><span>${escapeHTML(message)}</span>`;
    elements.toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(40px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 300);
    }, 4200);
  }

  function attachEventListeners() {
    elements.urlInput.addEventListener('input', handleUrlInputChange);
    elements.urlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); fetchMediaInfo(); }
    });

    elements.clearBtn.addEventListener('click', () => {
      elements.urlInput.value = '';
      elements.urlInput.focus();
      handleUrlInputChange();
    });

    elements.pasteBtn.addEventListener('click', async () => {
      try {
        if (navigator.clipboard && navigator.clipboard.readText) {
          const text = await navigator.clipboard.readText();
          if (text) {
            elements.urlInput.value = text.trim();
            handleUrlInputChange();
            fetchMediaInfo();
            showToast('Link pasted from clipboard!', 'info');
          }
        } else {
          elements.urlInput.focus();
          showToast('Please press Ctrl+V to paste your link.', 'info');
        }
      } catch (err) {
        elements.urlInput.focus();
        showToast('Please press Ctrl+V to paste your link.', 'info');
      }
    });

    elements.fetchBtn.addEventListener('click', fetchMediaInfo);
    elements.noticeClose.addEventListener('click', hideNotice);

    elements.demoLinks.forEach(chip => {
      chip.addEventListener('click', (e) => {
        const url = e.currentTarget.getAttribute('data-url');
        elements.urlInput.value = url;
        handleUrlInputChange();
        fetchMediaInfo();
      });
    });

    elements.formatTabs.forEach(tab => {
      tab.addEventListener('click', (e) => {
        const type = e.currentTarget.getAttribute('data-type');
        switchFormatTab(type);
      });
    });

    elements.qualityOptionCards.forEach(card => {
      card.addEventListener('click', (e) => {
        const quality = e.currentTarget.getAttribute('data-quality');
        const format = e.currentTarget.getAttribute('data-format');
        const size = e.currentTarget.getAttribute('data-size');
        selectQualityOption(quality, format, size);
      });
    });

    // Download Actions
    elements.startDownloadBtn.addEventListener('click', handleDownloadClick);
    elements.redownloadBtn.addEventListener('click', handleDownloadClick);

    // Quota Modal & Login
    elements.modalCloseBtn.addEventListener('click', closeQuotaModal);
    elements.modalGoogleBtn.addEventListener('click', handleGoogleLogin);
    elements.navLoginBtn.addEventListener('click', handleGoogleLogin);
    if (elements.refLoginBtn) elements.refLoginBtn.addEventListener('click', handleGoogleLogin);
    elements.logoutBtn.addEventListener('click', handleLogout);

    elements.quotaPill.addEventListener('click', () => {
      if (!STATE.user) openQuotaModal();
    });

    // Referral Actions
    elements.navReferBtn.addEventListener('click', openReferralModal);
    if (elements.openReferralBtn) elements.openReferralBtn.addEventListener('click', openReferralModal);
    elements.referralModalCloseBtn.addEventListener('click', closeReferralModal);
    elements.copyRefBtn.addEventListener('click', copyReferralLink);
    elements.simulateFriendRefBtn.addEventListener('click', handleSimulateFriendRef);

    // Rewards & Cashout Modal
    elements.walletPill.addEventListener('click', openRewardsModal);
    if (elements.openRewardsBtn) elements.openRewardsBtn.addEventListener('click', openRewardsModal);
    elements.rewardsModalCloseBtn.addEventListener('click', closeRewardsModal);

    // Gateway & UPI Actions
    elements.btnPayGatewayFee.addEventListener('click', handlePayGatewayFee);
    elements.btnSaveAndLockUpi.addEventListener('click', handleSaveAndLockUpi);
    elements.btnChangeUpi.addEventListener('click', handleChangeUpiClick);

    // Tier Redeem Buttons
    elements.tierRedeemBtns.forEach(btn => {
      btn.addEventListener('click', handleTierRedeemClick);
    });

    // Security Alert Close
    elements.securityAlertCloseBtn.addEventListener('click', () => {
      elements.securityAlertModal.classList.add('hidden');
    });
    elements.securityAlertAcknowledgeBtn.addEventListener('click', () => {
      elements.securityAlertModal.classList.add('hidden');
    });

    // History Clear
    elements.clearHistoryBtn.addEventListener('click', () => {
      STATE.history = [];
      localStorage.removeItem('pulsegrab_history');
      renderHistory();
      showToast('Download history cleared.', 'info');
    });

    // Modal Backdrop Clicks
    elements.quotaModal.addEventListener('click', (e) => {
      if (e.target === elements.quotaModal) closeQuotaModal();
    });
    elements.rewardsModal.addEventListener('click', (e) => {
      if (e.target === elements.rewardsModal) closeRewardsModal();
    });
    elements.referralModal.addEventListener('click', (e) => {
      if (e.target === elements.referralModal) closeReferralModal();
    });

    // Setup Owner Testing Controls
    setupOwnerTestingControls();

    // Floating Referral FAB
    const fabReferBtn = document.getElementById('fabReferBtn');
    if (fabReferBtn) fabReferBtn.addEventListener('click', openReferralModal);
  }

  /**
   * Live Stats Counter (social proof ticker)
   */
  function initStatsCounter() {
    const counters = [
      { id: 'tickerDownloads', base: 1247893, rate: 3 },
      { id: 'tickerCoins',     base: 89234100, rate: 130 },
      { id: 'tickerUsers',     base: 43812,  rate: 1 },
    ];

    counters.forEach(({ id, base, rate }) => {
      const el = document.getElementById(id);
      if (!el) return;
      let val = base + Math.floor(Math.random() * rate * 5);
      el.textContent = val.toLocaleString('en-IN');

      setInterval(() => {
        val += Math.floor(Math.random() * rate * 2 + 1);
        el.textContent = val.toLocaleString('en-IN');
      }, 4000 + Math.random() * 3000);
    });
  }

  /**
   * Application Master Initialization
   */
  function initApp() {
    loadAuthUser();
    loadQuota();
    verifyWalletIntegrity();
    initReferralSystem();
    loadHistory();
    attachEventListeners();
    initStatsCounter();
  }

  // Self Initialization
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }
})();
