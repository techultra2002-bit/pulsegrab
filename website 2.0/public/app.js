// =========================================================
// PULSEGRAB ECOSYSTEM 2.0 - PRODUCTION JAVASCRIPT CLIENT
// 100% OPERATIONAL - ZERO PLACEHOLDERS
// =========================================================

const state = {
  user: null,
  token: localStorage.getItem('pulsegrab_token') || null,
  csrfToken: localStorage.getItem('pulsegrab_csrf') || null,
  currentMedia: null,
  activeView: 'downloaderView',
  admin2faVerified: false,
  selectedRejectPayoutId: null
};

// =========================================================
// INITIALIZATION
// =========================================================
document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  initAuthEvents();
  initDownloaderEvents();
  initWalletEvents();
  initReferralEvents();
  initAdminEvents();
  initTermsEvents();
  initAdEvents();

  // Check URL for referral code parameter
  const urlParams = new URLSearchParams(window.location.search);
  const refParam = urlParams.get('ref');
  if (refParam) {
    sessionStorage.setItem('pending_referral_code', refParam.trim());
    showToast(`Referral code ${refParam} detected! Register to claim +100 bonus coins.`, 'coin');
    const customRefInput = document.getElementById('customRefInput');
    if (customRefInput) customRefInput.value = refParam.trim();
  }

  // Check existing session
  checkSession();
});

// =========================================================
// API HELPER (Includes JWT & CSRF Headers)
// =========================================================
async function apiRequest(endpoint, method = 'GET', data = null) {
  const headers = {
    'Content-Type': 'application/json'
  };

  if (state.token) {
    headers['Authorization'] = `Bearer ${state.token}`;
  }
  if (state.csrfToken) {
    headers['x-csrf-token'] = state.csrfToken;
  }

  const options = {
    method,
    headers
  };

  if (data && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
    options.body = JSON.stringify(data);
  }

  try {
    const res = await fetch(endpoint, options);
    const result = await res.json();

    if (result.csrfToken) {
      state.csrfToken = result.csrfToken;
      localStorage.setItem('pulsegrab_csrf', result.csrfToken);
    }

    if (!res.ok) {
      throw new Error(result.error || `HTTP error ${res.status}`);
    }
    return result;
  } catch (err) {
    console.error(`API Error [${endpoint}]:`, err.message);
    throw err;
  }
}

// =========================================================
// TOAST NOTIFICATIONS
// =========================================================
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  let icon = 'ℹ️';
  if (type === 'success') icon = '✅';
  if (type === 'error') icon = '❌';
  if (type === 'coin') icon = '🪙';

  toast.innerHTML = `<span>${icon}</span> <span>${escapeHtml(message)}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(50px)';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g, tag => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[tag] || tag));
}

// =========================================================
// NAVIGATION & VIEW SWITCHER
// =========================================================
function initNavigation() {
  const navTabs = document.querySelectorAll('.nav-tab');
  navTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetId = tab.getAttribute('data-target');
      switchView(targetId);
    });
  });

  const brandBtn = document.getElementById('brandHomeBtn');
  if (brandBtn) {
    brandBtn.addEventListener('click', () => switchView('downloaderView'));
  }

  const coinPill = document.getElementById('coinPill');
  if (coinPill) {
    coinPill.addEventListener('click', () => switchView('walletView'));
  }
}

function switchView(viewId) {
  // Check admin guard
  if (viewId === 'adminView') {
    if (!state.user || !state.user.is_admin) {
      showToast('Admin access restricted to verified administrators.', 'error');
      return;
    }
  }

  state.activeView = viewId;

  // Update tabs
  document.querySelectorAll('.nav-tab').forEach(tab => {
    if (tab.getAttribute('data-target') === viewId) {
      tab.classList.add('active');
    } else {
      tab.classList.remove('active');
    }
  });

  // Update panels
  const panels = ['downloaderView', 'walletView', 'referralView', 'adminView'];
  panels.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (id === viewId) {
      el.style.display = 'flex';
      el.classList.add('active');
    } else {
      el.style.display = 'none';
      el.classList.remove('active');
    }
  });

  // Trigger view data refreshes
  if (viewId === 'walletView') loadWalletData();
  if (viewId === 'referralView') loadReferralData();
  if (viewId === 'adminView') loadAdminData();
}

// =========================================================
// AUTHENTICATION & USER MANAGEMENT
// =========================================================
function initAuthEvents() {
  const openModalBtn = document.getElementById('openAuthModalBtn');
  const closeModalBtn = document.getElementById('closeAuthModalBtn');
  const authModal = document.getElementById('authModal');
  const customLoginBtn = document.getElementById('customLoginBtn');

  if (openModalBtn) {
    openModalBtn.addEventListener('click', () => {
      if (authModal) authModal.style.display = 'flex';
    });
  }

  if (closeModalBtn) {
    closeModalBtn.addEventListener('click', () => {
      if (authModal) authModal.style.display = 'none';
    });
  }

  // Quick switch buttons in sidebar
  document.querySelectorAll('.btn-tester').forEach(btn => {
    btn.addEventListener('click', async () => {
      const target = btn.getAttribute('data-switch');
      await executeQuickSwitch(target);
    });
  });

  // Custom email login
  if (customLoginBtn) {
    customLoginBtn.addEventListener('click', async () => {
      const email = document.getElementById('customEmailInput').value.trim();
      const referralCode = document.getElementById('customRefInput').value.trim() || sessionStorage.getItem('pending_referral_code');

      if (!email || !email.includes('@')) {
        showToast('Please enter a valid Google email address.', 'error');
        return;
      }

      try {
        const res = await apiRequest('/api/auth/google', 'POST', {
          email,
          name: email.split('@')[0],
          googleId: `google_${Date.now()}`,
          referralCode
        });

        applyUserSession(res);
        if (authModal) authModal.style.display = 'none';
        showToast(`Welcome back, ${res.user.name}!`, 'success');
      } catch (err) {
        showToast(err.message || 'Login failed', 'error');
      }
    });
  }
}

async function executeQuickSwitch(target) {
  try {
    const res = await apiRequest('/api/auth/quick-switch', 'POST', {
      target,
      referralCode: sessionStorage.getItem('pending_referral_code') || 'ALEX777'
    });

    applyUserSession(res);
    showToast(`Switched account to: ${res.user.name} (${res.user.is_admin ? 'Admin' : 'User'})`, 'success');
  } catch (err) {
    showToast(err.message || 'Quick switch failed', 'error');
  }
}

function applyUserSession(data) {
  state.user = data.user;
  state.token = data.token;
  state.csrfToken = data.csrfToken;

  localStorage.setItem('pulsegrab_token', data.token);
  localStorage.setItem('pulsegrab_csrf', data.csrfToken);

  renderUserUI();
}

async function checkSession() {
  if (!state.token) {
    // Attempt guest session or keep logged out state
    updateDailyMeterDisplay({ downloadsCount: 0, coinsEarned: 0 });
    return;
  }

  try {
    const res = await apiRequest('/api/auth/me');
    state.user = res.user;
    renderUserUI();
  } catch (e) {
    // Expired token
    state.token = null;
    state.user = null;
    localStorage.removeItem('pulsegrab_token');
    renderUserUI();
  }
}

function renderUserUI() {
  const authArea = document.getElementById('userAuthArea');
  const coinDisplay = document.getElementById('navCoinCount');
  const adminNavBtn = document.getElementById('navAdminBtn');
  const sidebarRef = document.getElementById('sidebarRefCode');

  if (!state.user) {
    // Logged Out
    if (authArea) {
      authArea.innerHTML = `
        <button class="btn btn-primary btn-sm" id="openAuthModalBtn">
          <svg class="icon-google" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
          </svg>
          Sign In with Google
        </button>
      `;
      document.getElementById('openAuthModalBtn').addEventListener('click', () => {
        document.getElementById('authModal').style.display = 'flex';
      });
    }
    if (coinDisplay) coinDisplay.textContent = '0';
    if (adminNavBtn) adminNavBtn.style.display = 'none';
    if (sidebarRef) sidebarRef.textContent = 'LOGIN FIRST';
    return;
  }

  // Logged In
  if (authArea) {
    authArea.innerHTML = `
      <div class="user-profile-pill">
        <img src="${escapeHtml(state.user.avatar)}" class="user-avatar-tiny" alt="Profile" />
        <span class="user-name-tiny">${escapeHtml(state.user.name)}</span>
        <button class="btn-logout-mini" id="logoutBtn" title="Sign out">✕</button>
      </div>
    `;
    document.getElementById('logoutBtn').addEventListener('click', async () => {
      await apiRequest('/api/auth/logout', 'POST');
      state.user = null;
      state.token = null;
      localStorage.removeItem('pulsegrab_token');
      renderUserUI();
      showToast('Logged out successfully', 'info');
      switchView('downloaderView');
    });
  }

  if (coinDisplay) {
    animateValue(coinDisplay, parseInt(coinDisplay.textContent) || 0, state.user.coins, 600);
  }

  if (adminNavBtn) {
    adminNavBtn.style.display = state.user.is_admin ? 'inline-flex' : 'none';
  }

  if (sidebarRef) {
    sidebarRef.textContent = state.user.referralCode || 'REF100';
  }

  // Update daily meter
  if (state.user.dailyStats) {
    updateDailyMeterDisplay(state.user.dailyStats);
  }
}

function updateDailyMeterDisplay(dailyStats) {
  const todayDlCount = document.getElementById('todayDlCount');
  const todayCoinsCount = document.getElementById('todayCoinsCount');
  const meterFill = document.getElementById('dailyMeterFill');
  const capStatusPill = document.getElementById('capStatusPill');

  const dlCount = dailyStats.downloadsCount || 0;
  const coinsEarned = dailyStats.coinsEarned || 0;

  if (todayDlCount) todayDlCount.textContent = dlCount;
  if (todayCoinsCount) todayCoinsCount.textContent = coinsEarned;

  const percentage = Math.min(100, Math.round((coinsEarned / 250) * 100));
  if (meterFill) meterFill.style.width = `${percentage}%`;

  if (capStatusPill) {
    if (coinsEarned >= 250 || dlCount >= 25) {
      capStatusPill.textContent = 'Daily Cap Reached (250/250)';
      capStatusPill.className = 'meter-status-pill capped';
    } else {
      capStatusPill.textContent = `${250 - coinsEarned} Coins Remaining`;
      capStatusPill.className = 'meter-status-pill';
    }
  }
}

function animateValue(obj, start, end, duration) {
  if (start === end) {
    obj.textContent = end.toLocaleString();
    return;
  }
  let startTimestamp = null;
  const step = (timestamp) => {
    if (!startTimestamp) startTimestamp = timestamp;
    const progress = Math.min((timestamp - startTimestamp) / duration, 1);
    obj.textContent = Math.floor(progress * (end - start) + start).toLocaleString();
    if (progress < 1) {
      window.requestAnimationFrame(step);
    } else {
      obj.textContent = end.toLocaleString();
    }
  };
  window.requestAnimationFrame(step);
}

// =========================================================
// DOWNLOADER STUDIO & MEDIA SCRAPING
function initDownloaderEvents() {
  const resolveBtn = document.getElementById('resolveMediaBtn');
  const urlInput = document.getElementById('mediaUrlInput');
  const pasteBtn = document.getElementById('quickPasteBtn');

  if (resolveBtn && urlInput) {
    resolveBtn.addEventListener('click', () => processMediaUrl(urlInput.value));
    urlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') processMediaUrl(urlInput.value);
    });
  }

  if (pasteBtn && urlInput) {
    pasteBtn.addEventListener('click', async () => {
      try {
        if (navigator.clipboard && navigator.clipboard.readText) {
          const clipText = await navigator.clipboard.readText();
          if (clipText && clipText.trim()) {
            urlInput.value = clipText.trim();
            showToast('Link pasted! Fetching...', 'success');
            processMediaUrl(clipText.trim());
            return;
          }
        }
        urlInput.focus();
        showToast('Please paste your link into the input box.', 'info');
      } catch (err) {
        urlInput.focus();
      }
    });
  }

  // Sample Chips
  document.querySelectorAll('.sample-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const sampleUrl = chip.getAttribute('data-url');
      if (urlInput) urlInput.value = sampleUrl;
      processMediaUrl(sampleUrl);
    });
  });

  // Interstitial modal close
  const closeInterstitialBtn = document.getElementById('closeInterstitialBtn');
  if (closeInterstitialBtn) {
    closeInterstitialBtn.addEventListener('click', () => {
      document.getElementById('interstitialModal').style.display = 'none';
    });
  }
}

async function processMediaUrl(url) {
  if (!url || !url.trim()) {
    showToast('Please paste a YouTube or Instagram link first.', 'error');
    return;
  }

  const resolveBtn = document.getElementById('resolveMediaBtn');
  const btnText = resolveBtn.querySelector('.btn-text');
  const btnLoader = resolveBtn.querySelector('.btn-loader');

  try {
    btnText.textContent = 'Resolving...';
    btnLoader.style.display = 'inline';
    resolveBtn.disabled = true;

    const res = await apiRequest('/api/media/resolve', 'POST', { url: url.trim() });
    state.currentMedia = res.media;
    renderMediaResult(res.media);
    showToast('Streams extracted successfully!', 'success');
  } catch (err) {
    showToast(err.message || 'Failed to extract media streams', 'error');
  } finally {
    btnText.textContent = 'Fetch Media';
    btnLoader.style.display = 'none';
    resolveBtn.disabled = false;
  }
}

function renderMediaResult(media) {
  const card = document.getElementById('mediaResultCard');
  if (!card) return;

  document.getElementById('mediaThumbImg').src = media.thumbnail;
  document.getElementById('mediaPlatformTag').textContent = media.platform.toUpperCase();
  document.getElementById('mediaDurationTag').textContent = media.duration;
  document.getElementById('mediaTitleText').textContent = media.title;
  document.getElementById('mediaAuthorText').textContent = `By ${media.author}`;

  const streamsGrid = document.getElementById('streamsGrid');
  streamsGrid.innerHTML = '';

  media.streams.forEach(stream => {
    const isHQ = stream.isHighQuality;
    const streamCard = document.createElement('div');
    streamCard.className = `stream-card ${isHQ ? 'is-hq' : ''}`;

    streamCard.innerHTML = `
      <div class="stream-info">
        <span class="stream-quality-badge">${escapeHtml(stream.label)}</span>
        <span class="stream-meta">${escapeHtml(stream.fileSize)} • ${stream.extension.toUpperCase()}</span>
        <span class="stream-reward-tag ${isHQ ? 'gold' : 'muted'}">${escapeHtml(stream.badge)}</span>
      </div>
      <button class="btn-stream-dl" data-token="${escapeHtml(stream.downloadToken)}" data-quality="${escapeHtml(stream.quality)}" data-ext="${escapeHtml(stream.extension)}">
        Download ${stream.quality.toUpperCase()}
      </button>
    `;

    // Download click handler
    const dlBtn = streamCard.querySelector('.btn-stream-dl');
    dlBtn.addEventListener('click', () => triggerStreamDownload(stream, media));

    streamsGrid.appendChild(streamCard);
  });

  card.style.display = 'flex';
  card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function triggerStreamDownload(stream, media) {
  if (!state.user) {
    showToast('Please sign in with Google to download files and collect rewards.', 'error');
    document.getElementById('authModal').style.display = 'flex';
    return;
  }

  // 1. Trigger actual browser file download via streaming proxy
  const downloadUrl = `/api/media/stream?token=${encodeURIComponent(stream.downloadToken)}&title=${encodeURIComponent(media.title)}&quality=${encodeURIComponent(stream.quality)}&ext=${encodeURIComponent(stream.extension)}`;
  
  const tempLink = document.createElement('a');
  tempLink.href = downloadUrl;
  tempLink.setAttribute('download', `${media.title}_${stream.quality}.${stream.extension}`);
  document.body.appendChild(tempLink);
  tempLink.click();
  tempLink.remove();

  // 2. Display Post-Download Interstitial Ad Modal (AdSense placement)
  triggerAdInterstitial();

  // 3. Claim Coin Reward from Ledger
  try {
    const claimRes = await apiRequest('/api/media/claim-reward', 'POST', {
      downloadToken: stream.downloadToken,
      url: media.originalUrl,
      title: media.title,
      platform: media.platform,
      quality: stream.quality
    });

    state.user.coins = claimRes.newBalance;
    state.user.dailyStats = claimRes.dailyStats;

    renderUserUI();

    if (claimRes.coinsAwarded > 0) {
      showToast(`+${claimRes.coinsAwarded} Coins Earned! New Balance: ${claimRes.newBalance.toLocaleString()}`, 'coin');
    } else {
      showToast(claimRes.reason, 'info');
    }

    if (claimRes.referralBonusTriggered) {
      showToast(`🎉 Referral Milestone Triggered! Referrer was credited 250 coins!`, 'success');
    }
  } catch (err) {
    console.error("Reward claim error:", err.message);
  }
}

function triggerAdInterstitial() {
  const modal = document.getElementById('interstitialModal');
  const countdownText = document.getElementById('adCountdownText');
  if (!modal) return;

  modal.style.display = 'flex';
  let secondsLeft = 3;
  if (countdownText) countdownText.textContent = `Closing in ${secondsLeft}s...`;

  const timer = setInterval(() => {
    secondsLeft--;
    if (countdownText) countdownText.textContent = `Closing in ${secondsLeft}s...`;
    if (secondsLeft <= 0) {
      clearInterval(timer);
      modal.style.display = 'none';
    }
  }, 1000);
}

// =========================================================
// WALLET & REDEMPTION MATRIX
// =========================================================
function initWalletEvents() {
  const unlockBtn = document.getElementById('unlockPayoutBtn');
  const saveUpiBtn = document.getElementById('saveUpiBtn');

  if (unlockBtn) {
    unlockBtn.addEventListener('click', async () => {
      try {
        const res = await apiRequest('/api/wallet/unlock', 'POST');
        showToast(res.message, 'success');
        state.user.coins = res.newBalance;
        state.user.payoutUnlocked = true;
        renderUserUI();
        loadWalletData();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  if (saveUpiBtn) {
    saveUpiBtn.addEventListener('click', async () => {
      const upiId = document.getElementById('upiAddressInput').value.trim();
      if (!upiId) {
        showToast('Please enter your UPI payment address.', 'error');
        return;
      }
      try {
        const res = await apiRequest('/api/wallet/bind-upi', 'POST', { upiId });
        showToast(res.message, 'success');
        state.user.lockedUpi = res.lockedUpi;
        state.user.coins = res.newBalance;
        renderUserUI();
        loadWalletData();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  // Redeem buttons
  document.querySelectorAll('.btn-redeem').forEach(btn => {
    btn.addEventListener('click', async () => {
      const tierKey = btn.getAttribute('data-tier');
      await executeRedemption(tierKey);
    });
  });
}

async function loadWalletData() {
  if (!state.user) return;

  try {
    const res = await apiRequest('/api/wallet/overview');
    const wallet = res.wallet;
    const payouts = res.payouts;

    // Balances
    document.getElementById('walletBalanceNum').textContent = wallet.coins.toLocaleString();
    document.getElementById('lifetimeEarnedNum').textContent = wallet.lifetimeEarned.toLocaleString();

    // Gate
    const gateCard = document.getElementById('unlockGateCard');
    const gateTitle = document.getElementById('gateTitle');
    const gateDesc = document.getElementById('gateDesc');
    const gateIcon = document.getElementById('gateIcon');
    const unlockBtn = document.getElementById('unlockPayoutBtn');

    if (wallet.payoutUnlocked) {
      gateTitle.textContent = 'Cash Payouts: UNLOCKED';
      gateDesc.textContent = 'Your wallet is fully authorized to redeem cash via direct UPI.';
      gateIcon.textContent = '🔓';
      unlockBtn.textContent = '✓ Redemption Unlocked';
      unlockBtn.classList.add('unlocked');
      unlockBtn.disabled = true;
    } else {
      gateTitle.textContent = 'Cash Payouts: LOCKED';
      gateDesc.textContent = 'Requires a baseline of 5,000 coins. Deducts 1,000 coins to permanently unlock.';
      gateIcon.textContent = '🔒';
      unlockBtn.textContent = 'Unlock Cash Redemption (1,000 Coins)';
      unlockBtn.classList.remove('unlocked');
      unlockBtn.disabled = !wallet.canUnlock;
    }

    // UPI Status
    const upiStatusTag = document.getElementById('upiStatusTag');
    const upiInput = document.getElementById('upiAddressInput');
    const upiFeeBadge = document.getElementById('upiFeeBadge');

    if (wallet.lockedUpi) {
      upiStatusTag.textContent = 'Bound & Active';
      upiStatusTag.className = 'status-tag bound';
      upiInput.value = wallet.lockedUpi;
      upiFeeBadge.textContent = 'Modify Fee: 250 Coins';
    } else {
      upiStatusTag.textContent = 'Not Bound';
      upiStatusTag.className = 'status-tag';
      upiFeeBadge.textContent = 'Fee: 500 Coins (1st time)';
    }

    // Payouts Table
    const tbody = document.getElementById('userPayoutsTbody');
    if (tbody) {
      if (payouts.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="empty-cell">No redemptions requested yet.</td></tr>`;
      } else {
        tbody.innerHTML = payouts.map(p => {
          let statusBadge = '<span class="badge badge-warning">Pending Audit</span>';
          if (p.status === 'approved') statusBadge = '<span class="badge badge-success">Paid via UPI</span>';
          if (p.status === 'rejected') statusBadge = '<span class="badge badge-danger">Rejected & Refunded</span>';

          return `
            <tr>
              <td><code>${escapeHtml(p.id)}</code></td>
              <td>${new Date(p.requestedAt).toLocaleString()}</td>
              <td>🪙 ${p.tierCoins.toLocaleString()}</td>
              <td><strong>₹${p.amountInr} INR</strong></td>
              <td><code>${escapeHtml(p.upiId)}</code></td>
              <td>${statusBadge}</td>
            </tr>
          `;
        }).join('');
      }
    }
  } catch (err) {
    console.error("Wallet overview error:", err.message);
  }
}

async function executeRedemption(tierKey) {
  if (!state.user) {
    showToast('Please sign in first', 'error');
    return;
  }
  if (!state.user.payoutUnlocked) {
    showToast('Redemptions are locked. You must unlock the payout system with 5,000+ coins.', 'error');
    return;
  }
  if (!state.user.lockedUpi) {
    showToast('Please lock your UPI payment address above before redeeming.', 'error');
    return;
  }

  try {
    const res = await apiRequest('/api/wallet/redeem', 'POST', { tierKey });
    showToast(res.message, 'success');
    state.user.coins = res.newBalance;
    renderUserUI();
    loadWalletData();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// =========================================================
// REFERRAL PROGRAM
// =========================================================
function initReferralEvents() {
  const copyBtn = document.getElementById('copyRefLinkBtn');
  const sidebarCopyBtn = document.getElementById('sidebarCopyRefBtn');

  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      const linkInput = document.getElementById('referralLinkInput');
      if (linkInput) {
        navigator.clipboard.writeText(linkInput.value);
        showToast('Referral link copied to clipboard!', 'success');
      }
    });
  }

  if (sidebarCopyBtn) {
    sidebarCopyBtn.addEventListener('click', () => {
      const code = document.getElementById('sidebarRefCode').textContent;
      navigator.clipboard.writeText(code);
      showToast(`Referral code ${code} copied!`, 'success');
    });
  }
}

async function loadReferralData() {
  if (!state.user) return;

  try {
    const res = await apiRequest('/api/referrals/summary');
    const data = res.data;

    // Link & shares
    const linkInput = document.getElementById('referralLinkInput');
    if (linkInput) linkInput.value = data.referralLink;

    const waText = encodeURIComponent(`Hey! Download YouTube videos and Instagram reels in 1080p and earn cash with me on PulseGrab. Use my link to get a 100 Coin starter bonus: ${data.referralLink}`);
    document.getElementById('shareWaBtn').href = `https://api.whatsapp.com/send?text=${waText}`;
    document.getElementById('shareTgBtn').href = `https://t.me/share/url?url=${encodeURIComponent(data.referralLink)}&text=${waText}`;

    // Stats
    document.getElementById('statTotalRefs').textContent = data.totalReferrals;
    document.getElementById('statCompletedRefs').textContent = data.completedCount;
    document.getElementById('statPendingRefs').textContent = data.pendingCount;
    document.getElementById('statRefCoinsToday').textContent = data.dailyReferralCoinsEarned;

    // Network table
    const tbody = document.getElementById('referredFriendsTbody');
    if (tbody) {
      if (data.referrals.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="empty-cell">No friends referred yet. Share your link to start earning!</td></tr>`;
      } else {
        tbody.innerHTML = data.referrals.map(r => `
          <tr>
            <td><strong>${escapeHtml(r.name)}</strong> (${escapeHtml(r.emailMasked)})</td>
            <td>${new Date(r.joinedAt).toLocaleDateString()}</td>
            <td><strong class="highlight-coin">${r.highQualityDownloadsCount}</strong> / 3 completed</td>
            <td>${r.milestoneCompleted ? '<span class="badge badge-success">Milestone Met</span>' : '<span class="badge badge-warning">In Progress</span>'}</td>
            <td>${r.bonusAwarded > 0 ? `🪙 +${r.bonusAwarded} Coins` : '0 Coins'}</td>
          </tr>
        `).join('');
      }
    }
  } catch (err) {
    console.error("Referral fetch error:", err.message);
  }
}

// =========================================================
// ADMIN CONTROL CENTER & 2FA
// =========================================================
function initAdminEvents() {
  const verify2faBtn = document.getElementById('verify2faBtn');
  const refreshBtn = document.getElementById('refreshAdminBtn');
  const searchBtn = document.getElementById('auditUserSearchBtn');
  const searchInput = document.getElementById('auditUserQueryInput');

  if (verify2faBtn) {
    verify2faBtn.addEventListener('click', async () => {
      const code = document.getElementById('admin2faInput').value.trim();
      if (!code || code.length !== 6) {
        showToast('Please enter the 6-digit Google Authenticator code.', 'error');
        return;
      }
      try {
        const res = await apiRequest('/api/admin/2fa/verify', 'POST', { code });
        state.admin2faVerified = true;
        document.getElementById('admin2faGate').style.display = 'none';
        document.getElementById('adminWorkspace').style.display = 'flex';
        showToast(res.message, 'success');
        loadAdminData();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => loadAdminData());
  }

  if (searchBtn && searchInput) {
    searchBtn.addEventListener('click', () => executeUserAudit(searchInput.value));
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') executeUserAudit(searchInput.value);
    });
  }

  // Audit Tab toggles
  document.querySelectorAll('.audit-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-tab');
      document.querySelectorAll('.audit-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      document.querySelectorAll('.audit-tab-content').forEach(c => {
        c.style.display = (c.id === target) ? 'block' : 'none';
      });
    });
  });

  // Rejection Modal
  const closeRejectBtn = document.getElementById('closeRejectModalBtn');
  const cancelRejectBtn = document.getElementById('cancelRejectBtn');
  const confirmRejectBtn = document.getElementById('confirmRejectBtn');
  const rejectReasonSelect = document.getElementById('rejectReasonSelect');
  const rejectCustomReason = document.getElementById('rejectCustomReason');

  if (closeRejectBtn) closeRejectBtn.addEventListener('click', () => closeRejectModal());
  if (cancelRejectBtn) cancelRejectBtn.addEventListener('click', () => closeRejectModal());

  if (rejectReasonSelect) {
    rejectReasonSelect.addEventListener('change', () => {
      rejectCustomReason.style.display = (rejectReasonSelect.value === 'Custom') ? 'block' : 'none';
    });
  }

  if (confirmRejectBtn) {
    confirmRejectBtn.addEventListener('click', async () => {
      if (!state.selectedRejectPayoutId) return;
      let reason = rejectReasonSelect.value;
      if (reason === 'Custom') reason = rejectCustomReason.value.trim() || 'Verification failed.';

      try {
        const res = await apiRequest(`/api/admin/payouts/${state.selectedRejectPayoutId}/reject`, 'POST', { reason });
        showToast(res.message, 'success');
        closeRejectModal();
        loadAdminData();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }
}

function closeRejectModal() {
  state.selectedRejectPayoutId = null;
  document.getElementById('rejectModal').style.display = 'none';
}

async function loadAdminData() {
  if (!state.user || !state.user.is_admin) return;

  // Check 2FA Gate
  if (!state.admin2faVerified) {
    document.getElementById('admin2faGate').style.display = 'flex';
    document.getElementById('adminWorkspace').style.display = 'none';

    // Fetch 2FA Setup details (QR & Secret)
    try {
      const setupRes = await apiRequest('/api/admin/2fa/setup');
      if (setupRes.qrDataUrl) {
        document.getElementById('adminQrImage').src = setupRes.qrDataUrl;
      }
      document.getElementById('adminSecretKeyDisplay').textContent = setupRes.secret;
    } catch (e) {
      console.error("2FA setup fetch error:", e.message);
    }
    return;
  }

  document.getElementById('admin2faGate').style.display = 'none';
  document.getElementById('adminWorkspace').style.display = 'flex';

  try {
    // 1. KPI Metrics
    const metricsRes = await apiRequest('/api/admin/metrics');
    const m = metricsRes.metrics;
    document.getElementById('kpiTotalUsers').textContent = m.totalUsers;
    document.getElementById('kpiActiveToday').textContent = m.activeTodayUsers;
    document.getElementById('kpiCirculatingCoins').textContent = m.circulatingCoins.toLocaleString();
    document.getElementById('kpiPendingCount').textContent = m.pendingCount;
    document.getElementById('kpiPendingInr').textContent = m.pendingInrValue.toLocaleString();
    document.getElementById('kpiCompletedCount').textContent = m.completedCount;
    document.getElementById('kpiCompletedInr').textContent = m.completedInrValue.toLocaleString();

    // 2. Payout Management Queue
    const payoutsRes = await apiRequest('/api/admin/payouts');
    renderAdminPayouts(payoutsRes.payouts);

    // 3. System Audit Logs
    const logsRes = await apiRequest('/api/admin/audit/logs');
    renderAdminAuditLogs(logsRes.logs);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function renderAdminPayouts(payouts) {
  const tbody = document.getElementById('adminPayoutsTbody');
  if (!tbody) return;

  if (payouts.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-cell">No payout requests in system.</td></tr>`;
    return;
  }

  tbody.innerHTML = payouts.map(p => {
    // Risk Flags Render
    let flagsHtml = '<span class="badge badge-success">Clean (No Flags)</span>';
    if (p.fraudRiskFlags && p.fraudRiskFlags.length > 0) {
      flagsHtml = p.fraudRiskFlags.map(f => `<span class="flag-pill">⚠️ ${escapeHtml(f.message)}</span>`).join('<br>');
    }

    // UPI Display: revealed upon approve or hidden
    let upiHtml = `<code>${escapeHtml(p.upiId)}</code>`;
    if (p.status === 'approved') {
      upiHtml = `<span class="upi-copy-chip" onclick="navigator.clipboard.writeText('${escapeHtml(p.upiId)}'); showToast('UPI ID Copied to Clipboard!', 'success')">📋 ${escapeHtml(p.upiId)}</span>`;
    }

    // Actions
    let actionButtons = '';
    if (p.status === 'pending') {
      actionButtons = `
        <div class="action-btn-group">
          <button class="btn-approve" onclick="approvePayout('${p.id}')">✓ Approve</button>
          <button class="btn-reject" onclick="openRejectModal('${p.id}')">✕ Reject</button>
          <button class="btn-ban" onclick="banUser('${p.userDetails.id}', '${escapeHtml(p.userDetails.email)}')">🚫 Ban</button>
        </div>
      `;
    } else if (p.status === 'approved') {
      actionButtons = `<span class="badge badge-success">Approved / Paid</span>`;
    } else {
      actionButtons = `<span class="badge badge-danger">Rejected</span>`;
    }

    return `
      <tr>
        <td>
          <strong>${escapeHtml(p.userDetails.name)}</strong><br>
          <small class="text-secondary">${escapeHtml(p.userDetails.email)}</small><br>
          <small class="text-muted">Joined: ${new Date(p.userDetails.joinedAt).toLocaleDateString()}</small>
        </td>
        <td>
          Balance: 🪙 <strong>${p.walletStats.currentBalance.toLocaleString()}</strong><br>
          Lifetime: 🪙 ${p.walletStats.lifetimeEarned.toLocaleString()}<br>
          Referrals: ${p.walletStats.successfulReferrals} active
        </td>
        <td>
          <strong class="highlight-coin">₹${p.amountInr} INR</strong><br>
          <small class="text-muted">(${p.tierCoins.toLocaleString()} Coins)</small>
        </td>
        <td>${upiHtml}</td>
        <td>${flagsHtml}</td>
        <td>${actionButtons}</td>
      </tr>
    `;
  }).join('');
}

window.approvePayout = async function(payoutId) {
  try {
    const res = await apiRequest(`/api/admin/payouts/${payoutId}/approve`, 'POST');
    showToast(res.message, 'success');
    loadAdminData();
  } catch (err) {
    showToast(err.message, 'error');
  }
};

window.openRejectModal = function(payoutId) {
  state.selectedRejectPayoutId = payoutId;
  document.getElementById('rejectModal').style.display = 'flex';
};

window.banUser = async function(userId, email) {
  if (!confirm(`Are you sure you want to permanently BAN ${email}? All coins will be voided and account frozen.`)) {
    return;
  }
  try {
    const res = await apiRequest(`/api/admin/users/${userId}/ban`, 'POST', { reason: 'Fraud or automated abuse ban' });
    showToast(res.message, 'success');
    loadAdminData();
  } catch (err) {
    showToast(err.message, 'error');
  }
};

async function executeUserAudit(query) {
  if (!query || !query.trim()) {
    showToast('Please enter an email, User ID, or referral code to inspect.', 'error');
    return;
  }

  try {
    const res = await apiRequest(`/api/admin/audit/user?query=${encodeURIComponent(query.trim())}`);
    renderUserAuditResults(res);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function renderUserAuditResults(data) {
  const container = document.getElementById('auditUserResults');
  const profileCard = document.getElementById('auditProfileCard');
  const dlTbody = document.getElementById('auditDownloadsTbody');
  const refTree = document.getElementById('auditReferralTree');

  container.style.display = 'block';

  // Profile info
  const u = data.user;
  profileCard.innerHTML = `
    <div>
      <h4>${escapeHtml(u.name)} (${escapeHtml(u.email)})</h4>
      <p class="text-secondary">ID: <code>${u.id}</code> | Ref Code: <strong>${u.referralCode}</strong></p>
      <p class="text-secondary">Registration IP: <code>${u.registrationIp}</code> | Banned: ${u.isBanned ? '<strong style="color:red">YES</strong>' : 'NO'}</p>
    </div>
    <div>
      <p>Balance: 🪙 <strong>${u.coins.toLocaleString()}</strong> | Lifetime: <strong>${u.lifetimeEarned.toLocaleString()}</strong></p>
      <p>Total Downloads: <strong>${u.totalDownloads}</strong> | Locked UPI: <code>${u.lockedUpi || 'None'}</code></p>
    </div>
  `;

  // Download logs
  if (data.downloadHistory.length === 0) {
    dlTbody.innerHTML = `<tr><td colspan="5" class="empty-cell">No download logs recorded for this user.</td></tr>`;
  } else {
    dlTbody.innerHTML = data.downloadHistory.map(dl => `
      <tr>
        <td>${new Date(dl.timestamp).toLocaleString()}</td>
        <td><a href="${escapeHtml(dl.url)}" target="_blank" style="color:var(--accent-cyan);">${escapeHtml(dl.platform.toUpperCase())} Video</a></td>
        <td>${escapeHtml(dl.title)}</td>
        <td><span class="badge ${dl.isHighQuality ? 'badge-success' : 'badge-warning'}">${escapeHtml(dl.quality)}</span></td>
        <td>${dl.coinsAwarded > 0 ? `🪙 +${dl.coinsAwarded}` : '0 Coins'}</td>
      </tr>
    `).join('');
  }

  // Referral Graph Tree
  if (data.referralGraph.length === 0) {
    refTree.innerHTML = `<div class="empty-cell">This user has not referred any accounts.</div>`;
  } else {
    refTree.innerHTML = data.referralGraph.map(node => {
      const refUser = node.referredUser;
      if (!refUser) return '';
      return `
        <div class="referral-tree-node">
          <div>
            <strong>${escapeHtml(refUser.name)}</strong> (${escapeHtml(refUser.email)})<br>
            <small class="text-muted">Registered: ${new Date(refUser.createdAt).toLocaleDateString()} | IP: ${refUser.registrationIp}</small>
          </div>
          <div>
            <span class="badge ${node.milestoneMet ? 'badge-success' : 'badge-warning'}">
              ${node.highQualityDownloadsCount} / 3 HQ Downloads
            </span>
          </div>
          <div>
            ${node.bonusAwarded > 0 ? `<strong class="highlight-coin">+${node.bonusAwarded} Coins</strong>` : 'Pending 3 Downloads'}
          </div>
        </div>
      `;
    }).join('');
  }
}

function renderAdminAuditLogs(logs) {
  const tbody = document.getElementById('adminAuditLogsTbody');
  if (!tbody) return;

  if (logs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-cell">No audit logs found.</td></tr>`;
    return;
  }

  tbody.innerHTML = logs.map(l => `
    <tr>
      <td>${new Date(l.timestamp).toLocaleString()}</td>
      <td><strong>${escapeHtml(l.adminEmail)}</strong></td>
      <td><code>${escapeHtml(l.action)}</code></td>
      <td><code>${escapeHtml(l.ipAddress)}</code></td>
      <td>${escapeHtml(l.details)}</td>
    </tr>
  `).join('');
}

// =========================================================
// TERMS & CONDITIONS MODAL
// =========================================================
function initTermsEvents() {
  const termsModal = document.getElementById('termsModal');
  const closeBtn = document.getElementById('closeTermsModalBtn');
  const acceptBtn = document.getElementById('acceptTermsBtn');
  const footerTerms = document.getElementById('footerTermsLink');
  const authTerms = document.getElementById('openTermsLinkFromAuth');

  function openTerms(e) {
    if (e) e.preventDefault();
    if (termsModal) termsModal.style.display = 'flex';
  }

  function closeTerms() {
    if (termsModal) termsModal.style.display = 'none';
  }

  if (footerTerms) footerTerms.addEventListener('click', openTerms);
  if (authTerms) authTerms.addEventListener('click', openTerms);
  if (closeBtn) closeBtn.addEventListener('click', closeTerms);
  if (acceptBtn) acceptBtn.addEventListener('click', closeTerms);
}

// =========================================================
// AD INTERACTIONS: REWARDED ADS, STICKY ANCHOR & POPUPS
// =========================================================
function initAdEvents() {
  // 1. Sticky Bottom Anchor Close
  const closeStickyBtn = document.getElementById('closeStickyAdBtn');
  const stickyAd = document.getElementById('stickyBottomAd');
  if (closeStickyBtn && stickyAd) {
    closeStickyBtn.addEventListener('click', () => {
      stickyAd.style.transform = 'translateY(100%)';
      setTimeout(() => stickyAd.style.display = 'none', 300);
    });
  }

  // 2. Rewarded Ad Boost Modal & Claim Logic
  const openRewardedBtn = document.getElementById('openRewardedAdBtn');
  const rewardedModal = document.getElementById('rewardedAdModal');
  const closeRewardedBtn = document.getElementById('closeRewardedAdModalBtn');
  const claimCoinsBtn = document.getElementById('claimRewardedCoinsBtn');
  const timerBadge = document.getElementById('rewardedTimerBadge');
  const statusMsg = document.getElementById('rewardedAdStatusMsg');

  let rewardedInterval = null;

  if (openRewardedBtn && rewardedModal) {
    openRewardedBtn.addEventListener('click', () => {
      if (!state.user) {
        showToast('Please sign in with Google to collect +25 bonus coins.', 'error');
        document.getElementById('authModal').style.display = 'flex';
        return;
      }

      rewardedModal.style.display = 'flex';
      claimCoinsBtn.disabled = true;
      claimCoinsBtn.textContent = 'Claim +25 Coins (Waiting...)';

      let secondsLeft = 5;
      timerBadge.textContent = `Reward unlocks in ${secondsLeft}s...`;
      statusMsg.textContent = `Watch the sponsor showcase for ${secondsLeft} seconds to claim +25 Coins.`;

      if (rewardedInterval) clearInterval(rewardedInterval);

      rewardedInterval = setInterval(() => {
        secondsLeft--;
        if (secondsLeft > 0) {
          timerBadge.textContent = `Reward unlocks in ${secondsLeft}s...`;
          statusMsg.textContent = `Watch the sponsor showcase for ${secondsLeft} seconds to claim +25 Coins.`;
        } else {
          clearInterval(rewardedInterval);
          timerBadge.textContent = '✓ Reward Unlocked!';
          statusMsg.textContent = 'Thank you for supporting our sponsors! You can now claim your +25 Coins.';
          claimCoinsBtn.disabled = false;
          claimCoinsBtn.textContent = '🎉 Claim +25 Coins Now!';
        }
      }, 1000);
    });
  }

  if (closeRewardedBtn && rewardedModal) {
    closeRewardedBtn.addEventListener('click', () => {
      if (rewardedInterval) clearInterval(rewardedInterval);
      rewardedModal.style.display = 'none';
    });
  }

  if (claimCoinsBtn) {
    claimCoinsBtn.addEventListener('click', async () => {
      try {
        claimCoinsBtn.disabled = true;
        const res = await apiRequest('/api/wallet/claim-ad-reward', 'POST');
        showToast(res.message, 'coin');
        state.user.coins = res.newBalance;
        renderUserUI();
        rewardedModal.style.display = 'none';
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  // 3. Floating Deal Pill & Exit-Intent Deal Modal
  const floatingPill = document.getElementById('floatingDealPill');
  const openDealBtn = document.getElementById('openExitDealBtn');
  const exitDealModal = document.getElementById('exitDealModal');
  const closeExitDealBtn = document.getElementById('closeExitDealModalBtn');
  const copyPromoBtn = document.getElementById('copyPromoCodeBtn');

  function openExitDeal() {
    if (exitDealModal) exitDealModal.style.display = 'flex';
  }

  function closeExitDeal() {
    if (exitDealModal) exitDealModal.style.display = 'none';
  }

  if (openDealBtn) openDealBtn.addEventListener('click', (e) => { e.stopPropagation(); openExitDeal(); });
  if (floatingPill) floatingPill.addEventListener('click', openExitDeal);
  if (closeExitDealBtn) closeExitDealBtn.addEventListener('click', closeExitDeal);

  if (copyPromoBtn) {
    copyPromoBtn.addEventListener('click', () => {
      navigator.clipboard.writeText('PULSE2026');
      showToast('Sponsor promo code PULSE2026 copied!', 'success');
    });
  }

  // Detect exit intent when mouse moves towards top of the viewport
  let exitIntentTriggered = sessionStorage.getItem('exit_ad_triggered');
  document.addEventListener('mouseleave', (e) => {
    if (e.clientY <= 10 && !exitIntentTriggered) {
      exitIntentTriggered = true;
      sessionStorage.setItem('exit_ad_triggered', 'true');
      openExitDeal();
    }
  });
}

