'use strict';

console.log('[PhotosDeleter] content.js loaded');

// ---- Selectors ----

const SEL = {
  photoItem: [
    'div[data-latest-bg]',
    'div[jsaction*="mouseenter"]',
    '[jsname="haAclf"]',
    '.yDSiEe',
    'a[href*="/photo/"]',
  ],
  checkbox: [
    '[aria-label*="選択"]',
    '[aria-label*="Select"]',
    'div[jsname="C8IUef"]',
    '[role="checkbox"]',
  ],
  toolbarDelete: [
    'button[aria-label="ゴミ箱に移動"]',
    'button[aria-label="削除"]',
    'button[aria-label="Move to trash"]',
    'button[aria-label="Delete"]',
    '[data-id="trash"]',
    'button[jsname="o6ZaF"]',
  ],
  confirmBtn: [
    '[jsname="j7LFlb"]',
    'button[jsname="dcxi1b"]',
    '[jsname="IVVmkb"]',
    'button[data-mdc-dialog-action="ok"]',
    '.VfPpkd-LgbsSe-bN97Pc-RLmnJb',
  ],
};

function queryFirst(sels, root = document) {
  for (const sel of sels) {
    try {
      const el = root.querySelector(sel);
      if (el) return el;
    } catch {}
  }
  return null;
}

function queryAll(sels, root = document) {
  for (const sel of sels) {
    try {
      const els = root.querySelectorAll(sel);
      if (els.length > 0) return Array.from(els);
    } catch {}
  }
  return [];
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function fireClick(el) {
  if (!el) return false;
  try {
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true, cancelable: true }));
    el.click();
    return true;
  } catch {
    return false;
  }
}

function isVisible(el) {
  const rect = el.getBoundingClientRect();
  return rect.width > 10 && rect.height > 10 && rect.top >= 0 && rect.top < window.innerHeight;
}

// ---- 状態 ----

let isRunning    = false;
let sessionCount = 0;
let dateFilter   = null;

// ---- デバッグ: 可視aria-labelを全出力 ----

function logVisibleAriaLabels(prefix = '') {
  const labels = [];
  for (const el of document.querySelectorAll('[aria-label]')) {
    const label = el.getAttribute('aria-label');
    const rect  = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0 && label) {
      labels.push(`<${el.tagName.toLowerCase()} aria-label="${label}">`);
    }
  }
  console.log(`[PhotosDeleter] ${prefix} visible aria-labels (${labels.length}):\n` + labels.join('\n'));
}

// ---- ホバーしてチェックボックスを出現させる ----

function hoverThumb(el) {
  const rect = el.getBoundingClientRect();
  const cx   = rect.left + rect.width  / 2;
  const cy   = rect.top  + rect.height / 2;
  const opts = { bubbles: true, cancelable: true, clientX: cx, clientY: cy, view: window };

  el.dispatchEvent(new MouseEvent('mouseenter', opts));
  el.dispatchEvent(new MouseEvent('mouseover',  opts));
  el.dispatchEvent(new MouseEvent('mousemove',  opts));
  if (el.parentElement) {
    el.parentElement.dispatchEvent(new MouseEvent('mouseenter', opts));
    el.parentElement.dispatchEvent(new MouseEvent('mouseover',  opts));
  }
}

// ---- チェックボックスをクリック ----

async function tryClickCheckbox(thumb) {
  // 近隣から探す
  const roots = [
    thumb,
    thumb.parentElement,
    thumb.parentElement?.parentElement,
  ].filter(Boolean);

  for (const root of roots) {
    const cb = queryFirst(SEL.checkbox, root);
    if (cb && cb !== thumb) {
      console.log(`[PhotosDeleter] checkbox found in ${root.tagName} → aria="${cb.getAttribute('aria-label')}"`);
      fireClick(cb);
      return true;
    }
  }

  // フォールバック①: elementFromPoint でサムネイル左上を直接クリック
  const rect = thumb.getBoundingClientRect();
  if (rect.width > 0) {
    const x  = rect.left + 20;
    const y  = rect.top  + 20;
    const el = document.elementFromPoint(x, y);
    if (el && el !== thumb) {
      console.log(`[PhotosDeleter] fallback①: point(${Math.round(x)},${Math.round(y)}) → <${el.tagName} aria="${el.getAttribute('aria-label')}">`);
      fireClick(el);
      return true;
    }
  }

  // フォールバック②: 全aria-labelをスキャンして「選択」を含む要素を探す
  for (const el of document.querySelectorAll('[aria-label]')) {
    const label = el.getAttribute('aria-label') || '';
    if (!(label.includes('選択') || label.includes('Select'))) continue;
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      console.log(`[PhotosDeleter] fallback②: aria scan → "${label}"`);
      fireClick(el);
      return true;
    }
  }

  console.log('[PhotosDeleter] checkbox NOT found');
  return false;
}

// ---- ツールバーの削除ボタンをクリック ----

function clickToolbarDelete() {
  const deleteSelectors = [
    'button[aria-label="ゴミ箱に移動"]',
    'button[aria-label="削除"]',
    'button[aria-label="Move to trash"]',
    'button[aria-label="Delete"]',
    '[data-id="trash"]',
  ];

  for (const sel of deleteSelectors) {
    const btn = document.querySelector(sel);
    if (btn) {
      console.log(`[PhotosDeleter] toolbar delete found: ${sel}`);
      btn.click();
      return true;
    }
  }

  // フォールバック: 可視ボタンをスキャン
  for (const btn of document.querySelectorAll('button, [role="button"]')) {
    const label = btn.getAttribute('aria-label') || '';
    const rect  = btn.getBoundingClientRect();
    if (rect.width > 0 && (
      label === 'ゴミ箱に移動' || label === 'Move to trash' ||
      label === '削除'         || label === 'Delete'
    )) {
      console.log(`[PhotosDeleter] toolbar delete found via scan: "${label}"`);
      btn.click();
      return true;
    }
  }
  return false;
}

// ---- 確認ダイアログを承認 ----

async function tryConfirm() {
  for (let i = 0; i < 10; i++) {
    await sleep(200);
    let btn = queryFirst(SEL.confirmBtn);
    if (!btn) {
      for (const el of document.querySelectorAll('button, [role="button"]')) {
        const t = el.textContent.trim();
        if (t === 'ゴミ箱に移動' || t === 'Move to trash') { btn = el; break; }
      }
    }
    if (btn) {
      console.log(`[PhotosDeleter] confirm: "${btn.textContent.trim()}"`);
      fireClick(btn);
      return true;
    }
  }
  console.log('[PhotosDeleter] confirm button NOT found');
  return false;
}

// ---- バッチ選択 → 削除 ----

const BATCH_SIZE = 10;

async function deleteBatch(maxSelect, isFast = false) {
  // 速度に応じた待機時間
  const T = {
    hover:        isFast ?  300 :  800,  // ホバー後チェックボックス出現待ち
    selectGap:    isFast ?  150 :  300,  // 写真選択間インターバル
    postSelect:   isFast ?  200 :  500,  // 全選択後の落ち着き待ち
    postDelete:   isFast ?  500 :  800,  // 削除ボタン後の確認ダイアログ出現待ち
    postConfirm:  isFast ?  500 : 1000,  // 確認後グリッド更新待ち
  };

  // ビューワーにいたら戻る
  if (window.location.pathname.startsWith('/photo/')) {
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true,
    }));
    await sleep(600);
  }

  const thumbs = queryAll(SEL.photoItem);
  console.log(`[PhotosDeleter] thumbnails in DOM: ${thumbs.length}`);
  if (!thumbs.length) return { success: false, reason: 'no_photos_in_grid', count: 0 };

  const visibleThumbs = thumbs.filter(isVisible);
  console.log(`[PhotosDeleter] visible thumbnails: ${visibleThumbs.length}`);
  if (!visibleThumbs.length) return { success: false, reason: 'no_visible_thumb', count: 0 };

  let selectedCount = 0;
  const limit = Math.min(maxSelect, BATCH_SIZE, visibleThumbs.length);

  for (let i = 0; i < visibleThumbs.length && selectedCount < limit; i++) {
    const thumb = visibleThumbs[i];

    // 日付フィルターチェック：ホバー前に aria-label から日付を取得して判定
    if (dateFilter && (dateFilter.fromY !== null || dateFilter.toY !== null)) {
      const { date: photoDate, source } = extractDateFromThumb(thumb);
      const fromStr  = dateFilter.fromY ? `${dateFilter.fromY}/${String(dateFilter.fromM ?? 1).padStart(2,'0')}` : '?';
      const toStr    = dateFilter.toY   ? `${dateFilter.toY}/${String(dateFilter.toM ?? 12).padStart(2,'0')}` : '?';
      const rangeStr = `${fromStr} - ${toStr}`;

      if (!photoDate) {
        console.log(`[PhotosDeleter] SKIP: date unknown, aria="${source.slice(0, 80)}"`);
        continue;
      }

      const dateStr = `${photoDate.year}/${String(photoDate.month).padStart(2,'0')}/${String(photoDate.day).padStart(2,'0')}`;
      const inRange = isDateInRange(photoDate);

      if (!inRange) {
        console.log(`[PhotosDeleter] SKIP: date ${dateStr} out of range (${rangeStr})`);
        continue;
      }

      console.log(`[PhotosDeleter] IN RANGE: date ${dateStr}, selecting...`);
    }

    // ホバーしてチェックボックスを出現させる
    hoverThumb(thumb);
    await sleep(T.hover);

    const clicked = await tryClickCheckbox(thumb);
    if (clicked) {
      selectedCount++;
      console.log(`[PhotosDeleter] selected ${selectedCount}/${limit}`);
      await sleep(T.selectGap);
    }
  }

  if (selectedCount === 0) {
    console.log('[PhotosDeleter] 0 photos selected');
    logVisibleAriaLabels('after failed selection');
    return { success: false, reason: 'no_photos_selected', count: 0 };
  }

  console.log(`[PhotosDeleter] batch selected: ${selectedCount} photos`);
  await sleep(T.postSelect);

  // ツールバーの削除ボタンをクリック
  const clicked = clickToolbarDelete();
  if (!clicked) {
    console.log('[PhotosDeleter] toolbar delete NOT found — dumping DOM state:');
    logVisibleAriaLabels('toolbar missing');
    return { success: false, reason: 'toolbar_delete_not_found', count: 0 };
  }

  await sleep(T.postDelete);

  const confirmed = await tryConfirm();
  if (!confirmed) {
    logVisibleAriaLabels('confirm missing');
    return { success: false, reason: 'confirm_failed', count: 0 };
  }

  await sleep(T.postConfirm);
  return { success: true, count: selectedCount };
}

// ---- 日付パース ----

// 「写真 - 横向き - 2021/03/26 9:16:00」形式から日付を取得
function parseDateFromAriaLabel(ariaLabel) {
  if (!ariaLabel) return null;
  const match = ariaLabel.match(/(\d{4})\/(\d{2})\/(\d{2})/);
  if (match) {
    return { year: parseInt(match[1]), month: parseInt(match[2]), day: parseInt(match[3]) };
  }
  return null;
}

// サムネイル要素とその周辺から日付を取得する
function extractDateFromThumb(thumb) {
  // 自身・親・祖父母の aria-label を順に確認
  const candidates = [
    thumb,
    thumb.parentElement,
    thumb.parentElement?.parentElement,
  ].filter(Boolean);

  for (const el of candidates) {
    const label = el.getAttribute('aria-label') || '';
    const d = parseDateFromAriaLabel(label);
    if (d) return { date: d, source: label };
  }

  // 子孫要素の aria-label も確認
  for (const el of thumb.querySelectorAll('[aria-label]')) {
    const label = el.getAttribute('aria-label') || '';
    const d = parseDateFromAriaLabel(label);
    if (d) return { date: d, source: label };
  }

  return { date: null, source: '' };
}

function parseDateFromText(text) {
  if (!text) return null;
  const jp = text.match(/(\d{4})年(\d{1,2})月/);
  if (jp) return { year: parseInt(jp[1]), month: parseInt(jp[2]) };
  const monthNames  = ['January','February','March','April','May','June',
                       'July','August','September','October','November','December'];
  const shortMonths = ['Jan','Feb','Mar','Apr','May','Jun',
                       'Jul','Aug','Sep','Oct','Nov','Dec'];
  for (let i = 0; i < 12; i++) {
    const m = text.match(new RegExp(`${monthNames[i]}[^\\d]*(\\d{4})`))
           || text.match(new RegExp(`${shortMonths[i]}\\.?[^\\d]*(\\d{4})`));
    if (m) return { year: parseInt(m[1]), month: i + 1 };
  }
  const iso = text.match(/(\d{4})[\/\-](\d{1,2})[\/\-]\d{1,2}/);
  if (iso) return { year: parseInt(iso[1]), month: parseInt(iso[2]) };
  return null;
}

function isDateInRange(photoDate) {
  if (!dateFilter) return true;
  if (!photoDate)  return false; // 日付不明はフィルター有効時にスキップ
  const { fromY, fromM, toY, toM } = dateFilter;
  const photoYM = photoDate.year * 12 + (photoDate.month - 1);
  if (fromY !== null && photoYM < fromY * 12 + ((fromM ?? 1)  - 1)) return false;
  if (toY   !== null && photoYM > toY   * 12 + ((toM   ?? 12) - 1)) return false;
  return true;
}

// ---- メイン削除ループ ----

async function runDeletionLoop(speed, dailyLimit, startCount) {
  const isFast     = speed === 'fast';
  const batchDelay = isFast ? 500 : 2000;
  console.log(`[PhotosDeleter] speed mode: ${isFast ? 'fast (500ms)' : 'normal (2000ms)'}`);

  let totalCount       = startCount;
  sessionCount         = 0;
  let consecutiveFails = 0;
  const MAX_FAILS      = 5;

  await chrome.storage.local.set({ deletionStatus: 'running', sessionCount: 0 });

  while (isRunning) {
    // バッチサイズを日次上限に合わせて調整
    const remaining  = dailyLimit > 0 ? dailyLimit - totalCount : BATCH_SIZE;
    const batchLimit = Math.min(BATCH_SIZE, remaining > 0 ? remaining : BATCH_SIZE);

    if (dailyLimit > 0 && totalCount >= dailyLimit) {
      await chrome.storage.local.set({ deletionStatus: 'limit_reached' });
      break;
    }

    const result = await deleteBatch(batchLimit, isFast);

    if (result.success && result.count > 0) {
      sessionCount    += result.count;
      totalCount      += result.count;
      consecutiveFails = 0;
      console.log(`[PhotosDeleter] batch done: +${result.count} session=${sessionCount} total=${totalCount}`);
      await chrome.storage.local.set({ dailyCount: totalCount, sessionCount, deletionStatus: 'running' });
      await sleep(batchDelay);
    } else {
      consecutiveFails++;
      console.log(`[PhotosDeleter] batch fail (${consecutiveFails}/${MAX_FAILS}): ${result.reason}`);
      if (consecutiveFails >= MAX_FAILS) {
        await chrome.storage.local.set({ deletionStatus: 'error', sessionCount });
        break;
      }
      await sleep(1500);
    }
  }

  isRunning = false;
  await chrome.storage.local.set({ deletionStatus: 'stopped', sessionCount });
  console.log(`[PhotosDeleter] loop ended. session total: ${sessionCount}`);
}

// ---- メッセージリスナー ----

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'ping') {
    sendResponse({ ok: true });

  } else if (msg.action === 'start') {
    if (!isRunning) {
      isRunning  = true;
      dateFilter = msg.dateFilter ?? null;
      console.log(`[PhotosDeleter] start: speed=${msg.speed} limit=${msg.dailyLimit}`);
      logVisibleAriaLabels('on start');
      runDeletionLoop(msg.speed, msg.dailyLimit, msg.currentCount);
    }
    sendResponse({ ok: true });

  } else if (msg.action === 'stop') {
    isRunning = false;
    console.log('[PhotosDeleter] stop requested');
    sendResponse({ ok: true });
  }

  return true;
});
