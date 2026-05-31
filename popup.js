'use strict';

const FREE_LIMIT = 200;
const GUMROAD_PRODUCT_ID = 'lbifjtnefJGVSFwYdVtIzQ==';

// ---- State ----

const state = {
  isPro: false,
  licenseKey: '',
  selectedSpeed: 'normal',
  isRunning: false,
  activeTab: 'main',
  dateFromY: '',
  dateFromM: '',
  dateToY: '',
  dateToM: '',
};

let progressTimer = null;

// ---- Init ----

document.addEventListener('DOMContentLoaded', async () => {
  const data = await chrome.storage.local.get([
    'isPro', 'licenseKey', 'dailyCount', 'lastReset',
    'dateFromY', 'dateFromM', 'dateToY', 'dateToM',
  ]);

  state.isPro      = data.isPro ?? false;
  state.licenseKey = data.licenseKey ?? '';
  if (state.licenseKey) state.isPro = true;

  state.dateFromY  = data.dateFromY  ?? '';
  state.dateFromM  = data.dateFromM  ?? '';
  state.dateToY    = data.dateToY    ?? '';
  state.dateToM    = data.dateToM    ?? '';

  await checkDailyReset();
  populateDateSelects();
  renderAll();
  bindEvents();

  await chrome.storage.local.set({ deletionStatus: 'idle', sessionCount: 0 });
});

// ---- Date select population ----

function populateDateSelects() {
  const currentYear = new Date().getFullYear();
  ['date-from-y', 'date-to-y'].forEach(id => {
    const sel = document.getElementById(id);
    for (let y = currentYear; y >= 2010; y--) {
      const opt = document.createElement('option');
      opt.value = y;
      opt.textContent = `${y}年`;
      sel.appendChild(opt);
    }
  });
  ['date-from-m', 'date-to-m'].forEach(id => {
    const sel = document.getElementById(id);
    for (let m = 1; m <= 12; m++) {
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = `${m}月`;
      sel.appendChild(opt);
    }
  });
  document.getElementById('date-from-y').value = state.dateFromY;
  document.getElementById('date-from-m').value = state.dateFromM;
  document.getElementById('date-to-y').value   = state.dateToY;
  document.getElementById('date-to-m').value   = state.dateToM;
}

// ---- Render ----

function renderAll() {
  renderPlanBadge();
  renderLimitInfo();
  renderSpeedBtns();
  renderLicenseStatus();
  renderProSections();
  renderTab();
}

function renderPlanBadge() {
  const badge = document.getElementById('plan-badge');
  if (state.isPro) {
    badge.textContent = 'PRO版';
    badge.classList.add('is-pro');
  } else {
    badge.textContent = '無料版';
    badge.classList.remove('is-pro');
  }
}

async function renderLimitInfo() {
  const el = document.getElementById('limit-info');
  if (state.isPro) {
    el.innerHTML = '<strong>削除枚数：無制限</strong>';
  } else {
    const { dailyCount = 0 } = await chrome.storage.local.get('dailyCount');
    const left = Math.max(0, FREE_LIMIT - dailyCount);
    el.innerHTML = `本日残り：<strong id="remaining-count">${left}</strong> 枚`;
  }
}

function renderSpeedBtns() {
  document.getElementById('btn-normal').classList.toggle('active', state.selectedSpeed === 'normal');
  document.getElementById('btn-fast').classList.toggle('active',   state.selectedSpeed === 'fast');
  document.getElementById('btn-fast').disabled = !state.isPro;
}

function renderProSections() {
  // Date section
  const dateLock = document.getElementById('date-lock');
  dateLock.classList.toggle('hidden', state.isPro);
  document.querySelectorAll('#date-section select').forEach(el => { el.disabled = !state.isPro; });
}

function renderTab() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === state.activeTab);
  });
  document.getElementById('tab-main').classList.toggle('hidden',    state.activeTab !== 'main');
  document.getElementById('tab-history').classList.toggle('hidden', state.activeTab !== 'history');
}

function renderLicenseStatus() {
  const input   = document.getElementById('license-input');
  const btn     = document.getElementById('license-btn');
  const status  = document.getElementById('license-status');
  const proLink = document.getElementById('pro-link');

  if (state.licenseKey) {
    input.value     = maskKey(state.licenseKey);
    input.disabled  = true;
    btn.textContent = '解除';
    btn.classList.add('revoke');
    status.textContent = '✅ Pro版認証済み';
    status.className   = 'license-status license-ok';
    proLink.style.display = 'none';
  } else {
    input.value     = '';
    input.disabled  = false;
    btn.textContent = '認証する';
    btn.classList.remove('revoke');
    status.textContent = '';
    status.className   = 'license-status';
    proLink.style.display = '';
  }
}

async function renderHistory() {
  const section = document.getElementById('history-section');
  const lock    = document.getElementById('history-lock');

  if (!state.isPro) {
    lock.classList.remove('hidden');
    section.innerHTML = '<div class="history-empty">削除履歴はありません</div>';
    return;
  }

  lock.classList.add('hidden');
  const { deleteHistory = [] } = await chrome.storage.local.get('deleteHistory');

  if (!deleteHistory.length) {
    section.innerHTML = '<div class="history-empty">削除履歴はありません</div>';
    return;
  }

  section.innerHTML = [...deleteHistory].reverse().map(h => `
    <div class="history-item">
      <span class="history-date">${h.date}</span>
      <span class="history-count">${h.count}枚削除</span>
      <span class="history-mode">${h.mode === 'fast' ? '高速' : '通常'}</span>
    </div>
  `).join('');
}

function maskKey(key) {
  return key.slice(0, 4) + '-****-****-****';
}

// ---- Events ----

function bindEvents() {
  // タブ切替
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.activeTab = btn.dataset.tab;
      renderTab();
      if (state.activeTab === 'history') renderHistory();
    });
  });

  // 速度ボタン
  document.getElementById('btn-normal').addEventListener('click', () => {
    state.selectedSpeed = 'normal';
    renderSpeedBtns();
  });
  document.getElementById('btn-fast').addEventListener('click', () => {
    if (!state.isPro) return;
    state.selectedSpeed = 'fast';
    renderSpeedBtns();
  });

  // 日付セレクト
  const dateKeyMap = {
    'date-from-y': 'dateFromY', 'date-from-m': 'dateFromM',
    'date-to-y':   'dateToY',   'date-to-m':   'dateToM',
  };
  Object.keys(dateKeyMap).forEach(id => {
    document.getElementById(id).addEventListener('change', async e => {
      state[dateKeyMap[id]] = e.target.value;
      await chrome.storage.local.set({ [dateKeyMap[id]]: e.target.value });
    });
  });

  // 開始・停止
  document.getElementById('start-btn').addEventListener('click', startDeletion);
  document.getElementById('stop-btn').addEventListener('click', stopDeletion);

  // ライセンス認証
  document.getElementById('license-btn').addEventListener('click', handleLicenseBtn);
  document.getElementById('license-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleLicenseBtn();
  });
}

// ---- Deletion control ----

async function startDeletion() {
  clearError();

  const tabs = await chrome.tabs.query({ url: 'https://photos.google.com/*' });
  if (!tabs.length) {
    showError('Google フォトを開いてから実行してください');
    return;
  }
  const tab = tabs[0];

  try {
    await chrome.tabs.sendMessage(tab.id, { action: 'ping' });
  } catch {
    showError('ページをリロードしてから再試行してください');
    return;
  }

  if (!state.isPro) {
    const { dailyCount = 0 } = await chrome.storage.local.get('dailyCount');
    if (dailyCount >= FREE_LIMIT) {
      showError(`本日の削除上限（${FREE_LIMIT}枚）に達しました。明日リセットされます。`);
      return;
    }
  }

  const { dailyCount = 0 } = await chrome.storage.local.get('dailyCount');
  const dailyLimit = state.isPro ? 0 : FREE_LIMIT;

  const dateFilter = state.isPro ? {
    fromY: state.dateFromY ? parseInt(state.dateFromY) : null,
    fromM: state.dateFromM ? parseInt(state.dateFromM) : null,
    toY:   state.dateToY   ? parseInt(state.dateToY)   : null,
    toM:   state.dateToM   ? parseInt(state.dateToM)   : null,
  } : null;

  console.log('[PhotosDeleter] sending message to tab');
  await chrome.tabs.sendMessage(tab.id, {
    action:       'start',
    speed:        state.selectedSpeed,
    dailyLimit,
    currentCount: dailyCount,
    dateFilter,
  });

  state.isRunning = true;
  document.getElementById('start-btn').classList.add('hidden');
  document.getElementById('stop-btn').classList.remove('hidden');
  clearError();

  startProgressPolling();
}

async function stopDeletion() {
  const tabs = await chrome.tabs.query({ url: 'https://photos.google.com/*' });
  if (tabs.length) {
    try { await chrome.tabs.sendMessage(tabs[0].id, { action: 'stop' }); } catch {}
  }
  finishRunning();
}

function finishRunning() {
  state.isRunning = false;
  clearInterval(progressTimer);
  progressTimer = null;
  document.getElementById('start-btn').classList.remove('hidden');
  document.getElementById('stop-btn').classList.add('hidden');
  renderLimitInfo();
  if (state.isPro) saveHistory();
}

async function saveHistory() {
  const { sessionCount = 0 } = await chrome.storage.local.get('sessionCount');
  if (sessionCount <= 0) return;

  const { deleteHistory = [] } = await chrome.storage.local.get('deleteHistory');
  const now = new Date();
  const entry = {
    date:  `${now.getMonth() + 1}/${now.getDate()} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`,
    count: sessionCount,
    mode:  state.selectedSpeed,
  };
  deleteHistory.push(entry);
  if (deleteHistory.length > 100) deleteHistory.splice(0, deleteHistory.length - 100);
  await chrome.storage.local.set({ deleteHistory });
}

// ---- Progress polling ----

function startProgressPolling() {
  progressTimer = setInterval(async () => {
    const data = await chrome.storage.local.get(['sessionCount', 'deletionStatus']);
    const count  = data.sessionCount ?? 0;
    const status = data.deletionStatus ?? 'idle';

    document.getElementById('progress-count').textContent = count;

    if (status === 'stopped' || status === 'limit_reached' || status === 'error') {
      if (status === 'limit_reached') {
        showError(`本日の削除上限（${FREE_LIMIT}枚）に達しました。`);
      } else if (status === 'error') {
        showError('削除対象の写真が見つかりませんでした。ページを確認してください。');
      }
      finishRunning();
    }
  }, 600);
}

// ---- Daily reset ----

async function checkDailyReset() {
  const { dailyCount, lastReset } = await chrome.storage.local.get(['dailyCount', 'lastReset']);
  const today = new Date().toDateString();
  if (lastReset !== today) {
    await chrome.storage.local.set({ dailyCount: 0, lastReset: today });
  }
}

// ---- License ----

async function handleLicenseBtn() {
  if (state.licenseKey) {
    state.licenseKey = '';
    state.isPro      = false;
    await chrome.storage.local.set({ isPro: false, licenseKey: '' });
    renderAll();
    return;
  }

  const input  = document.getElementById('license-input');
  const btn    = document.getElementById('license-btn');
  const status = document.getElementById('license-status');
  const key    = input.value.trim();
  if (!key) return;

  btn.disabled    = true;
  btn.textContent = '確認中…';
  status.textContent = '';
  status.className   = 'license-status';

  try {
    const res  = await fetch('https://api.gumroad.com/v2/licenses/verify', {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    new URLSearchParams({ product_id: GUMROAD_PRODUCT_ID, license_key: key }),
    });
    const data = await res.json();

    if (data.success) {
      state.licenseKey = key;
      state.isPro      = true;
      await chrome.storage.local.set({ isPro: true, licenseKey: key });
      renderAll();
    } else {
      status.textContent = '❌ ライセンスキーが無効です';
      status.className   = 'license-status license-error';
      btn.disabled       = false;
      btn.textContent    = '認証する';
    }
  } catch {
    status.textContent = '❌ 認証に失敗しました（通信エラー）';
    status.className   = 'license-status license-error';
    btn.disabled       = false;
    btn.textContent    = '認証する';
  }
}

// ---- Helpers ----

function showError(msg) {
  const el = document.getElementById('error-msg');
  el.textContent = msg;
  el.classList.remove('hidden');
}

function clearError() {
  const el = document.getElementById('error-msg');
  el.textContent = '';
  el.classList.add('hidden');
}
