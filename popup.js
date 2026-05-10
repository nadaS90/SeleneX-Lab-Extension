/**
 * popup.js - SeleneX Lab v1
 *
 * Smart locator engine with tier-based scoring, async uniqueness checking,
 * quality badges, Nada-style C# code generation, and GitHub attribution.
 */

'use strict';

// ============================================================
//  CONSTANTS
// ============================================================
const STORAGE_KEY_PENDING = 'selenexLabPendingElement';
const STORAGE_KEY_HISTORY = 'selenexLabHistory';
const MAX_HISTORY_ITEMS   = 10;
const GITHUB_URL          = 'https://github.com/nadaS90';

// ============================================================
//  STATE
// ============================================================
let currentElement = null;   // Full element data from content.js
let currentLocator = null;   // Active { type, value, score, status, cssQuery, displayLabel }
let locators       = [];     // All ranked locator options
let lastProcessedSelectionId = null;

// ============================================================
//  DOM REFERENCES
// ============================================================
const btnSelectElement    = document.getElementById('btnSelectElement');
const btnClear            = document.getElementById('btnClear');
const actionSelect        = document.getElementById('actionSelect');
const sendKeysGroup       = document.getElementById('sendKeysGroup');
const sendKeysInput       = document.getElementById('sendKeysInput');
const outputModeSelect    = document.getElementById('outputModeSelect');
const chkUseJsClick       = document.getElementById('chkUseJsClick');
const chkGenerateAssert   = document.getElementById('chkGenerateAssert');
const chkIncludeDefaultText = document.getElementById('chkIncludeDefaultText');
const chkUseJsClickWrapper = document.getElementById('chkUseJsClickWrapper');
const chkGenerateAssertWrapper = document.getElementById('chkGenerateAssertWrapper');
const chkIncludeDefaultTextWrapper = document.getElementById('chkIncludeDefaultTextWrapper');
const codeArea            = document.getElementById('codeArea');
const btnCopyCode         = document.getElementById('btnCopyCode');
const locatorList         = document.getElementById('locatorList');
const locatorCountLabel   = document.getElementById('locatorCountLabel');
const historyList         = document.getElementById('historyList');
const btnClearHistory     = document.getElementById('btnClearHistory');
const svgWarning          = document.getElementById('svgWarning');
const svgWarningText      = document.getElementById('svgWarningText');
const toast               = document.getElementById('toast');
const modalOverlay        = document.getElementById('modalOverlay');
const modalErrorText      = document.getElementById('modalErrorText');
const btnCopyError        = document.getElementById('btnCopyError');
const btnModalOk          = document.getElementById('btnModalOk');
const githubBtn           = document.getElementById('githubBtn');

// ============================================================
//  INITIALISATION
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  loadHistory();
  checkPendingElement();
  setupEventListeners();
});

// ============================================================
//  EVENT LISTENERS
// ============================================================
function setupEventListeners() {

  btnSelectElement.addEventListener('click', startSelection);
  btnClear.addEventListener('click', clearSelection);

  actionSelect.addEventListener('change', () => {
    toggleSendKeysInput();
    regenerateCode();
  });

  sendKeysInput.addEventListener('input', regenerateCode);

  outputModeSelect.addEventListener('change', regenerateCode);

  chkUseJsClick.addEventListener('change', () => {
    updateCheckboxStyles();
    regenerateCode();
  });

  chkGenerateAssert.addEventListener('change', () => {
    updateCheckboxStyles();
    regenerateCode();
  });

  chkIncludeDefaultText.addEventListener('change', () => {
    updateCheckboxStyles();
    regenerateCode();
  });

  btnCopyCode.addEventListener('click', copyCode);
  btnClearHistory.addEventListener('click', clearHistory);

  btnCopyError.addEventListener('click', () => {
    const txt = modalErrorText.textContent;
    if (txt) navigator.clipboard.writeText(txt).then(showToast).catch(() => {});
  });

  btnModalOk.addEventListener('click', hideModal);

  githubBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: GITHUB_URL });
  });
}

// ============================================================
//  STORAGE CHANGE LISTENER (primary channel for element data)
// ============================================================
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[STORAGE_KEY_PENDING]) {
    const newVal = changes[STORAGE_KEY_PENDING].newValue;
    if (newVal) {
      processElement(newVal);
      chrome.storage.local.remove(STORAGE_KEY_PENDING);
    }
  }
});

// ============================================================
//  RUNTIME MESSAGE LISTENER (secondary channel when popup open)
// ============================================================
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg && msg.type === 'ELEMENT_SELECTED' && msg.data) {
    processElement(msg.data, {
      frameId: Number.isInteger(sender.frameId) ? sender.frameId : null,
      tabId: sender.tab ? sender.tab.id : null,
    });
    chrome.storage.local.remove(STORAGE_KEY_PENDING);
  }
  return false;
});

// ============================================================
//  CHECK FOR PENDING ELEMENT ON POPUP OPEN
// ============================================================
function checkPendingElement() {
  chrome.storage.local.get(STORAGE_KEY_PENDING, (result) => {
    const data = result[STORAGE_KEY_PENDING];
    if (data) {
      processElement(data);
      chrome.storage.local.remove(STORAGE_KEY_PENDING);
    }
  });
}

// ============================================================
//  START ELEMENT SELECTION
// ============================================================
async function startSelection() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs || tabs.length === 0) {
      showError('Could not locate the active tab. Please try again.');
      return;
    }

    await sendStartSelectionMessage(tabs[0].id, createPopupSelectionSessionId());

    btnSelectElement.textContent = '⏳ Selecting…';
    btnSelectElement.disabled    = true;

  } catch (err) {
    showError(err.message || 'Failed to start element selection.');
    resetSelectButton();
  }
}

function resetSelectButton() {
  btnSelectElement.textContent = '▶ Select Element';
  btnSelectElement.disabled    = false;
}

async function sendStartSelectionMessage(tabId, sessionId) {
  const sendRuntimeStartMessage = async () => {
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'START_SELECTION', sessionId });
      return true;
    } catch (_) {
      return false;
    }
  };

  const activateSelectionInFrames = async () => {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => {
        const helper = window.__selenexLabContentV1;
        if (helper && typeof helper.start === 'function') {
          helper.start(sessionId);
          return true;
        }
        return false;
      },
    });

    return results.some((item) => item && item.result === true);
  };

  let activated = false;

  try {
    activated = await activateSelectionInFrames();
  } catch (_) {
    activated = false;
  }

  if (!activated) {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ['content.js'],
    });

    try {
      activated = await activateSelectionInFrames();
    } catch (_) {
      activated = false;
    }

    if (!activated) {
      activated = await sendRuntimeStartMessage();
    }
  }

  if (!activated) {
    throw new Error('Could not start element selection on this page.');
  }
}

function createPopupSelectionSessionId() {
  const randomPart = Math.random().toString(36).slice(2);
  return `popup-${Date.now()}-${randomPart}`;
}

function isMissingContentScriptError(err) {
  const message = err && err.message ? err.message : String(err || '');
  return BENIGN_ERRORS.some((p) => message.includes(p));
}

// ============================================================
//  PROCESS A SELECTED ELEMENT  (async — runs uniqueness checks)
// ============================================================
async function processElement(data, source = {}) {
  if (!data) return;
  if (data.selectionId && data.selectionId === lastProcessedSelectionId) {
    return;
  }
  if (data.selectionId) {
    lastProcessedSelectionId = data.selectionId;
  }

  currentElement = data;
  resetSelectButton();
  hideSvgWarning();

  // Show SVG warning if element was originally SVG and was climbed
  if (data.isSvgElement) {
    showSvgWarning(data.climbedFrom || data.tag);
  }

  // Build initial candidate list synchronously
  const candidates = buildAllCandidates(data);

  // Show initial render while async uniqueness check runs
  locators       = candidates;
  currentLocator = locators[0] || null;
  renderLocators(false); // false = "checking" mode
  regenerateCode();

  // Run uniqueness checks asynchronously
  try {
    const target = await getUniquenessTarget(data, source);
    if (target) {
      await runUniquenessCheck(target.tabId, candidates, target.frameId);
    }
  } catch (_) {
    // Proceed without uniqueness data — not critical
  }

  // Re-rank after uniqueness data is in
  locators       = finalizeLocators(candidates);
  currentLocator = locators[0] || null;
  renderLocators(true);   // true = checks complete
  regenerateCode();

  addToHistory(data);
}

async function getUniquenessTarget(data, source = {}) {
  let tabId = Number.isInteger(source.tabId) ? source.tabId : null;
  let frameId = Number.isInteger(source.frameId) ? source.frameId : null;

  if (!tabId) {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = tabs && tabs[0] ? tabs[0].id : null;
  }

  if (!tabId) return null;

  const isFramedElement = data.framePath && data.framePath.length > 0;
  if (isFramedElement && !Number.isInteger(frameId)) {
    return null;
  }

  return { tabId, frameId };
}

// ============================================================
//  SMART LOCATOR ENGINE
// ============================================================

/**
 * Build ALL possible locator candidates for the selected element.
 * Each candidate:
 *  {
 *    type:         string  — 'id' | 'testid' | 'testattr' | 'qa' | 'cy' |
 *                            'aria' | 'name' | 'placeholder' | 'title' |
 *                            'role' | 'css'
 *    value:        string  — raw attribute value (used to build By.xxx)
 *    cssQuery:     string  — CSS selector string for DOM uniqueness check
 *    score:        number  — initial 1–5 score
 *    status:       string  — quality badge key
 *    matchCount:   number|null — null until uniqueness check runs
 *    displayLabel: string  — human-readable type label in popup
 *  }
 */
function buildAllCandidates(el) {
  const candidates = [];

  /** Helper: push a candidate only if the value is non-empty */
  const add = (type, value, score, status, cssQuery, displayLabel) => {
    if (!value || !String(value).trim()) return;
    const v = String(value).trim();
    candidates.push({
      type,
      value:        v,
      cssQuery:     cssQuery  || null,
      score,
      status,
      matchCount:   null,
      displayLabel: displayLabel || type.toUpperCase(),
    });
  };

  // ── TIER 1: Automation-safe test attributes (score 5) ──────────────────
  if (el.dataTestId) add('testid', el.dataTestId, 5, 'test-ready',
    `[data-testid="${cssAttrEscape(el.dataTestId)}"]`, 'data-testid');

  if (el.dataTest)   add('testattr', el.dataTest, 5, 'test-ready',
    `[data-test="${cssAttrEscape(el.dataTest)}"]`, 'data-test');

  if (el.dataQa)     add('qa', el.dataQa, 5, 'test-ready',
    `[data-qa="${cssAttrEscape(el.dataQa)}"]`, 'data-qa');

  if (el.dataCy)     add('cy', el.dataCy, 5, 'test-ready',
    `[data-cy="${cssAttrEscape(el.dataCy)}"]`, 'data-cy');

  // ── Non-volatile unique ID (score 5 if clean, 1 if volatile) ───────────
  if (el.id) {
    if (!isVolatileId(el.id)) {
      add('id', el.id, 5, 'excellent', `#${cssIdEscape(el.id)}`, 'id');
    } else {
      add('id', el.id, 1, 'volatile', `#${cssIdEscape(el.id)}`, 'id (volatile)');
    }
  }

  // ── TIER 2: Semantic descriptive attributes (score 4) ──────────────────
  if (el.ariaLabel && !isGenericText(el.ariaLabel)) {
    add('aria', el.ariaLabel, 4, 'good',
      `[aria-label="${cssAttrEscape(el.ariaLabel)}"]`, 'aria-label');
  }

  if (el.name && !isGenericText(el.name)) {
    add('name', el.name, 4, 'good',
      `[name="${cssAttrEscape(el.name)}"]`, 'name');
  }

  if (el.placeholder && !isGenericText(el.placeholder)) {
    add('placeholder', el.placeholder, 4, 'good',
      `[placeholder="${cssAttrEscape(el.placeholder)}"]`, 'placeholder');
  }

  // Linked label text (for <label for="..."> associated inputs) — score 4
  if (el.linkedLabel && !isGenericText(el.linkedLabel)) {
    add('linkedLabel', el.linkedLabel, 4, 'good',
      `[id="${cssAttrEscape(el.id || '')}"]`, 'linked label');
  }

  // ── TIER 3: Supplementary attributes (score 3) ─────────────────────────
  if (el.title && !isGenericText(el.title)) {
    add('title', el.title, 3, 'acceptable',
      `[title="${cssAttrEscape(el.title)}"]`, 'title');
  }

  if (el.href && isStableHref(el.href)) {
    add('href', el.href, 3, 'acceptable',
      `${el.tag || 'a'}[href="${cssAttrEscape(el.href)}"]`, 'href');
  }

  if (isTextLocatorCandidate(el)) {
    add('xpath', buildNormalizedTextXPath(el.tag || '*', el.textContent), 2, 'text-xpath',
      null, 'text XPath');
  }

  if (el.role && el.role !== 'presentation' && el.role !== 'none') {
    add('role', el.role, 3, 'acceptable',
      `[role="${cssAttrEscape(el.role)}"]`, 'role');
  }

  // ── Smart CSS combinations ─────────────────────────────────────────────
  const smartCss = buildSmartCss(el);
  smartCss.forEach((s) => {
    add('css', s.value, s.score, s.status, s.value, s.label);
  });

  // ── Tag fallback (always last resort, score 1) ─────────────────────────
  const tag = el.tag || 'div';
  if (!['svg', 'path', 'circle', 'rect', 'g', 'a'].includes(tag)) {
    add('css', tag, 1, 'weak', tag, 'tag (fallback)');
  }

  return candidates;
}

/**
 * Build smart CSS selector candidates from multiple strategies.
 * Returns array of { value, score, status, label } objects.
 */
function buildSmartCss(el) {
  const tag     = el.tag || '*';
  const results = [];

  const push = (value, score, status, label) => {
    results.push({ value, score, status, label });
  };

  // tag[type="submit"] — very specific for buttons/inputs
  if (el.type && (tag === 'input' || tag === 'button')) {
    const meaningfulTypes = ['submit', 'reset', 'checkbox', 'radio', 'file', 'image', 'range', 'color', 'date', 'datetime-local', 'email', 'month', 'number', 'search', 'tel', 'time', 'url', 'week'];
    if (meaningfulTypes.includes(el.type)) {
      push(`${tag}[type="${el.type}"]`, 3, 'acceptable', `${tag}[type]`);
    }
  }

  // tag[placeholder="..."] — good for inputs
  if (el.placeholder && tag === 'input') {
    push(`input[placeholder="${cssAttrEscape(el.placeholder)}"]`, 3, 'acceptable', 'input[placeholder]');
  }

  // tag[aria-label="..."] — smart CSS alternative to aria strategy
  if (el.ariaLabel) {
    push(`${tag}[aria-label="${cssAttrEscape(el.ariaLabel)}"]`, 3, 'acceptable', `${tag}[aria-label]`);
  }

  // Parent > tag — if parent has a stable non-volatile ID
  if (el.parentId && !isVolatileId(el.parentId) && tag !== 'div' && tag !== 'span') {
    push(`#${cssIdEscape(el.parentId)} > ${tag}`, 2, 'acceptable', 'parent > child');
  }

  // Role-qualified CSS
  if (el.role && el.role !== 'presentation') {
    push(`${tag}[role="${el.role}"]`, 2, 'acceptable', `${tag}[role]`);
  }

  return results;
}

// ============================================================
//  UNIQUENESS CHECK  (async, runs in active tab page)
// ============================================================

/**
 * Executes CSS querySelectorAll for each candidate in the live page,
 * then updates each candidate's matchCount and status in-place.
 */
async function runUniquenessCheck(tabId, candidates, frameId = null) {
  // Build a simple list of CSS query strings in the same order as candidates
  const queries = candidates.map((c) => c.cssQuery || null);

  // Script that runs inside the active tab's main frame
  const pageScript = (queryList) => {
    return queryList.map((q) => {
      if (!q) return null;
      try {
        return document.querySelectorAll(q).length;
      } catch (e) {
        return -1; // invalid CSS
      }
    });
  };

  const target = Number.isInteger(frameId)
    ? { tabId, frameIds: [frameId] }
    : { tabId, allFrames: false };

  const results = await chrome.scripting.executeScript({
    target,
    func:    pageScript,
    args:    [queries],
  });

  const counts = results && results[0] && results[0].result;
  if (!counts) return;

  // Update each candidate with real uniqueness data
  candidates.forEach((candidate, i) => {
    const count = counts[i];
    candidate.matchCount = count;

    // Test-ready attributes always keep their badge regardless
    if (['testid', 'testattr', 'qa', 'cy'].includes(candidate.type)) return;

    if (count === null)       { /* no query — keep initial status */ return; }
    if (count === -1)         { candidate.status = 'invalid'; candidate.score = 0; return; }
    if (count === 0)          { candidate.status = 'invalid'; candidate.score = 0; return; }
    if (count === 1) {
      // Unique — upgrade status based on original tier
      if (['excellent', 'good'].includes(candidate.status)) {
        // keep original excellent/good
      } else if (candidate.status === 'acceptable') {
        candidate.status = 'stable';  // acceptable + unique = stable
      } else if (candidate.status === 'weak') {
        candidate.status = 'unique';  // weak + unique = unique is fine
      } else {
        candidate.status = 'unique';
      }
      return;
    }
    if (count > 1) {
      // Not unique — downgrade
      candidate.status = 'multiple';
      candidate.score  = Math.max(1, candidate.score - 2);
    }
  });
}

/**
 * After uniqueness data is populated, sort and deduplicate candidates.
 * Returns a clean ranked list.
 */
function finalizeLocators(candidates) {
  // Remove invalid selectors
  const valid = candidates.filter((c) => c.status !== 'invalid' && c.score > 0);

  // Deduplicate: if two candidates have the exact same cssQuery, keep the one with higher score
  const seen = new Set();
  const deduped = valid.filter((c) => {
    const key = c.cssQuery || (c.type + ':' + c.value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Sort: score descending, then by tier preference
  const tierOrder = ['test-ready', 'excellent', 'unique', 'good', 'stable', 'acceptable', 'text-xpath', 'multiple', 'weak', 'volatile'];
  deduped.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return tierOrder.indexOf(a.status) - tierOrder.indexOf(b.status);
  });

  return deduped;
}

// ============================================================
//  VOLATILE / GENERIC DETECTION HELPERS
// ============================================================

/** Returns true if the ID looks auto-generated / unstable. */
function isVolatileId(id) {
  if (!id) return true;
  const s = String(id);
  if (s.length <= 2)                            return true;  // too short
  if (/^\d+$/.test(s))                          return true;  // pure number
  if (/[a-f0-9]{8,}/i.test(s))                  return true;  // hash-like
  if (/\d{5,}/.test(s))                         return true;  // many digits
  if (/^(ng-|react-|ember-|vue-|_ng|auto)/.test(s)) return true; // framework prefix
  if (/^[a-z]{1,2}[0-9]{4,}$/i.test(s))        return true;  // e.g. a12345
  if (isRandomLookingId(s))                     return true;
  return false;
}

function isRandomLookingId(id) {
  const s = String(id);
  if (!/^[A-Za-z]{5,10}$/.test(s)) return false;
  if (!/[A-Z]/.test(s) || !/[a-z]/.test(s)) return false;

  const semanticWords = [
    'login', 'logout', 'search', 'submit', 'cancel', 'save', 'email',
    'user', 'password', 'country', 'name', 'button', 'btn', 'link',
    'text', 'input', 'field', 'menu', 'nav', 'form',
  ];

  return !semanticWords.some((word) => s.toLowerCase().includes(word));
}

/** Returns true if the text is too generic to be a useful locator. */
function isGenericText(text) {
  if (!text) return true;
  const t = String(text).trim().toLowerCase();
  if (t.length <= 1)       return true;
  // Very short common words that aren't distinguishing
  const generic = new Set(['ok', 'go', 'x', 'no', 'yes', 'on', 'off', 'up', 'down', 'left', 'right', 'next', 'back']);
  if (generic.has(t))      return true;
  // Pure whitespace
  if (!t.replace(/\s/g, '')) return true;
  return false;
}

function isStableHref(href) {
  if (!href) return false;
  const value = String(href).trim();
  if (!value || value === '#' || value.toLowerCase().startsWith('javascript:')) return false;
  if (value.length > 180) return false;
  return true;
}

function isTextLocatorCandidate(el) {
  const tag = (el.tag || '').toLowerCase();
  if (!['a', 'button', 'label', 'span', 'div'].includes(tag)) return false;
  if (!el.textContent || isGenericText(el.textContent)) return false;
  if (String(el.textContent).length > 80) return false;
  return true;
}

function buildNormalizedTextXPath(tag, text) {
  const safeTag = /^[a-z][a-z0-9-]*$/i.test(tag) ? tag.toLowerCase() : '*';
  return `//${safeTag}[normalize-space(.)="${escapeXPathDoubleQuotedText(text)}"]`;
}

function escapeXPathDoubleQuotedText(text) {
  return String(text || '').replace(/"/g, '\\"');
}

// ============================================================
//  RENDER LOCATORS LIST
// ============================================================

/**
 * Renders the locator items into the popup.
 * @param {boolean} checksComplete  — if false, show "checking" badge
 */
function renderLocators(checksComplete = true) {
  locatorList.innerHTML = '';
  locatorCountLabel.textContent = '';

  if (!locators || locators.length === 0) {
    locatorList.innerHTML = '<div class="locator-empty">No locators found</div>';
    return;
  }

  locatorCountLabel.textContent = `${locators.length} found`;

  locators.forEach((loc, idx) => {
    const isActive = (loc === currentLocator);
    const isBest   = (idx === 0);

    const item = document.createElement('div');
    item.className = 'locator-item' +
      (isActive ? ' active' : '') +
      (isBest   ? ' best-match' : '');

    // ── Top row: type badge + quality chip + stars ────────────────────
    const topRow = document.createElement('div');
    topRow.className = 'locator-item-top';

    // Type badge
    const typeBadge = document.createElement('span');
    typeBadge.className = 'locator-type-badge';
    typeBadge.textContent = escapeHtml(loc.displayLabel || loc.type);

    // Quality chip
    const qBadge = document.createElement('span');
    const status = checksComplete ? loc.status : 'checking';
    qBadge.className = `quality-badge qb-${status}`;
    qBadge.textContent = qualityBadgeLabel(status, loc.matchCount);

    // Stars
    const stars = document.createElement('span');
    stars.className = 'locator-stars';
    stars.style.color = starsColor(loc.score);
    stars.textContent = renderStars(loc.score);

    topRow.appendChild(typeBadge);
    topRow.appendChild(qBadge);
    topRow.appendChild(stars);

    // ── Value preview row ─────────────────────────────────────────────
    const valueRow = document.createElement('div');
    valueRow.className = 'locator-value';
    valueRow.title     = loc.value;
    valueRow.textContent = loc.value;

    item.appendChild(topRow);
    item.appendChild(valueRow);

    // Click handler — make active, regenerate code
    item.addEventListener('click', () => {
      currentLocator = loc;
      renderLocators(checksComplete);
      regenerateCode();
    });

    locatorList.appendChild(item);
  });
}

/** Maps a status key to a display label string. */
function qualityBadgeLabel(status, count) {
  switch (status) {
    case 'test-ready':  return '⚡ Test-Ready';
    case 'excellent':   return '★ Excellent';
    case 'unique':      return '✓ Unique';
    case 'good':        return '✓ Good';
    case 'stable':      return '◎ Stable';
    case 'acceptable':  return '· Acceptable';
    case 'text-xpath':  return 'Text Match';
    case 'multiple':    return count != null ? `⚠ Multiple (${count})` : '⚠ Multiple';
    case 'weak':        return '⚠ Weak';
    case 'volatile':    return '✗ Volatile';
    case 'invalid':     return '✗ Invalid';
    case 'checking':    return '⟳ Checking…';
    default:            return '· Unknown';
  }
}

// ============================================================
//  STARS
// ============================================================
function renderStars(score) {
  const s = Math.max(0, Math.min(5, score));
  return '★'.repeat(s) + '☆'.repeat(5 - s);
}
function starsColor(score) {
  if (score >= 5) return '#f26700';
  if (score >= 4) return '#ff8a2a';
  if (score >= 3) return '#f59e0b';
  if (score >= 2) return '#fb923c';
  return '#ef4444';
}

// ============================================================
//  NADA FRAMEWORK CODE GENERATION
// ============================================================
function regenerateCode() {
  if (!currentElement || !currentLocator) {
    codeArea.innerHTML = '<span class="code-placeholder">// Select an element to generate code...</span>';
    return;
  }

  const action = normalizeNadaActionForElement(currentElement, actionSelect.value);
  const sendKeysText = chkIncludeDefaultText.checked ? sendKeysInput.value.trim() : '';
  const options = {
    forceJsClick: chkUseJsClick.checked,
    generateAssert: chkGenerateAssert.checked,
    outputMode: outputModeSelect.value,
  };
  codeArea.textContent = generateNadaFrameworkCode(currentElement, currentLocator, action, sendKeysText, options);
}

function generateNormalCode(el, loc, action, sendKeysText = '', options = {}) {
  return generateNadaFrameworkCode(el, loc, normalizeNadaActionForElement(el, action), sendKeysText, options);
}

function generatePageObjectCode(el, loc, action, sendKeysText = '', options = {}) {
  return generateNadaFrameworkCode(el, loc, normalizeNadaActionForElement(el, action), sendKeysText, options);
}

function generateNadaFrameworkCode(el, loc, action, sendKeysText = '', options = {}) {
  action = normalizeNadaActionForElement(el, action);

  const model = buildNadaCodeModel(el, loc, options);
  const byExpression = buildNadaByExpression(model);
  const lines = [
    `public const string ${model.locatorName} = "${escapeCSharp(model.locatorValue)}";`,
  ];

  if (options.outputMode === 'locatorOnly') {
    return lines.join('\n');
  }

  lines.push('');

  switch (action) {
    case 'sendKeys':
      lines.push(...buildNadaEnterTextMethod(model, byExpression, sendKeysText));
      break;
    case 'select':
      lines.push(...buildNadaSelectDropdownMethod(model, byExpression));
      break;
    case 'getText':
      lines.push(...buildNadaGetTextMethod(model, byExpression));
      break;
    case 'assertVisible':
      lines.push(...buildNadaAssertVisibleMethod(model, byExpression));
      break;
    case 'click':
    default:
      lines.push(...buildNadaClickMethod(model, byExpression));
      break;
  }

  if (options.generateAssert && action !== 'assertVisible') {
    lines.push('');
    lines.push(...buildNadaAssertVisibleMethod(model, byExpression));
  }

  return lines.join('\n');
}

function buildNadaCodeModel(el, loc, options = {}) {
  const controlType = getNadaControlType(el);
  const baseName = getNadaBaseName(el, loc, controlType);
  const locator = getNadaLocator(loc);

  return {
    baseName,
    controlType,
    displayName: splitPascalCase(`${baseName}${controlType}`),
    locatorName: `${baseName}${controlType}Locator`,
    locatorStrategy: locator.strategy,
    locatorValue: locator.value,
    useJsClick: options.forceJsClick || shouldUseNadaJavaScriptClick(el),
  };
}

function getNadaLocator(loc) {
  switch (loc.type) {
    case 'id':
      return { strategy: 'Id', value: loc.value };
    case 'name':
      return { strategy: 'Name', value: loc.value };
    case 'testid':
      return { strategy: 'CssSelector', value: `[data-testid='${escapeCssSingleQuotedValue(loc.value)}']` };
    case 'testattr':
      return { strategy: 'CssSelector', value: `[data-test='${escapeCssSingleQuotedValue(loc.value)}']` };
    case 'qa':
      return { strategy: 'CssSelector', value: `[data-qa='${escapeCssSingleQuotedValue(loc.value)}']` };
    case 'cy':
      return { strategy: 'CssSelector', value: `[data-cy='${escapeCssSingleQuotedValue(loc.value)}']` };
    case 'aria':
      return { strategy: 'CssSelector', value: `[aria-label='${escapeCssSingleQuotedValue(loc.value)}']` };
    case 'placeholder':
      return { strategy: 'CssSelector', value: `[placeholder='${escapeCssSingleQuotedValue(loc.value)}']` };
    case 'title':
      return { strategy: 'CssSelector', value: `[title='${escapeCssSingleQuotedValue(loc.value)}']` };
    case 'href':
      return { strategy: 'CssSelector', value: loc.cssQuery || `[href='${escapeCssSingleQuotedValue(loc.value)}']` };
    case 'role':
      return { strategy: 'CssSelector', value: `[role='${escapeCssSingleQuotedValue(loc.value)}']` };
    case 'linkedLabel':
      return loc.cssQuery
        ? { strategy: 'CssSelector', value: loc.cssQuery }
        : { strategy: 'Id', value: loc.value };
    case 'xpath':
      return { strategy: 'XPath', value: loc.value };
    case 'css':
    default:
      return { strategy: 'CssSelector', value: loc.value };
  }
}

function buildNadaByExpression(model) {
  return `By.${model.locatorStrategy}(${model.locatorName})`;
}

function buildNadaClickMethod(model, byExpression) {
  const wrapper = model.useJsClick ? 'ClickElementUsingJs' : 'ClickElement';
  const methodName = model.controlType === 'CheckBox'
    ? `Check${model.baseName}`
    : `Click${model.baseName}${model.controlType}`;

  return [
    `public void ${methodName}()`,
    `{`,
    `driver.${wrapper}(${byExpression}, "${model.displayName}");`,
    `}`,
  ];
}

function buildNadaEnterTextMethod(model, byExpression, sendKeysText = '') {
  const parameterName = toNadaInputParameterName(model.baseName);
  const dataArgument = getSendTextDataArgument(sendKeysText, parameterName);
  const methodSignature = sendKeysText
    ? `public void Enter${model.baseName}()`
    : `public void Enter${model.baseName}(string ${parameterName})`;

  return [
    methodSignature,
    `{`,
    `driver.SendText(${byExpression}, ${dataArgument}, "${splitPascalCase(model.baseName)}");`,
    `}`,
  ];
}

function getSendTextDataArgument(sendKeysText, parameterName) {
  if (!sendKeysText) return parameterName;

  const value = String(sendKeysText).trim();
  if (isCSharpExpression(value)) {
    return value;
  }

  return toCSharpParameterName(value);
}

function isCSharpExpression(value) {
  return /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)+$/.test(value);
}

function buildNadaSelectDropdownMethod(model, byExpression) {
  const parameterName = toCSharpParameterName(model.baseName);

  return [
    `public void Select${model.baseName}(string ${parameterName})`,
    `{`,
    `driver.SelectDropdownByText(${byExpression}, ${parameterName}, "${splitPascalCase(model.baseName)}");`,
    `}`,
  ];
}

function buildNadaGetTextMethod(model, byExpression) {
  return [
    `public string Get${model.baseName}Text()`,
    `{`,
    `return driver.FindElement(${byExpression}).Text;`,
    `}`,
  ];
}

function buildNadaAssertVisibleMethod(model, byExpression) {
  return [
    `public void Assert${model.baseName}${model.controlType}IsVisible()`,
    `{`,
    `Assert.IsTrue(driver.IsElementPresentAndDisplayed(${byExpression}),`,
    `"${model.displayName} is not visible");`,
    `}`,
  ];
}

function normalizeNadaActionForElement(el, action) {
  if (getNadaControlType(el) === 'Dropdown' && (action === 'click' || action === 'sendKeys')) {
    return 'select';
  }
  return action;
}

function getNadaControlType(el) {
  const tag = (el.tag || '').toLowerCase();
  const type = (el.type || '').toLowerCase();
  const role = (el.role || '').toLowerCase();

  if (type === 'checkbox' || role === 'checkbox') return 'CheckBox';
  if (['input', 'textarea'].includes(tag) && !['button', 'submit', 'reset', 'checkbox', 'radio'].includes(type)) return 'TextBox';
  if (tag === 'select' || role === 'listbox') return 'Dropdown';
  if (tag === 'a') return 'Link';
  if (tag === 'button' || ['button', 'submit', 'reset'].includes(type) || role === 'button') return 'Button';
  if (tag === 'label' || actionSelect.value === 'getText') return 'Label';
  return 'Element';
}

function shouldUseNadaJavaScriptClick(el) {
  const tag = (el.tag || '').toLowerCase();
  const role = (el.role || '').toLowerCase();
  return ['div', 'span'].includes(tag) && role === 'button';
}

function getNadaBaseName(el, loc, controlType) {
  const sources = [
    el.ariaLabel,
    el.placeholder,
    el.value,
    el.textContent,
    el.linkedLabel,
    el.title,
    (el.id && !isVolatileId(el.id)) ? el.id : null,
    el.name,
    el.dataTestId,
    el.dataTest,
    el.dataQa,
    el.dataCy,
    loc.value,
    controlType,
  ];

  for (const source of sources) {
    const cleaned = toCSharpPascalCase(stripControlTypeWords(source, controlType));
    if (cleaned && cleaned !== controlType && cleaned !== 'Element') {
      return cleaned;
    }
  }

  return controlType === 'Element' ? 'Page' : controlType;
}

function stripControlTypeWords(value, controlType) {
  if (!value) return '';

  const words = String(value)
    .replace(/\bI['’]m\b/gi, 'Im')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const suffixes = getControlTypeSuffixWords(controlType);

  while (words.length > 1 && suffixes.has(words[words.length - 1].toLowerCase())) {
    words.pop();
  }

  return words.join(' ');
}

function getControlTypeSuffixWords(controlType) {
  const common = ['locator', 'element', 'field', 'input'];
  const specific = {
    Button: ['button', 'btn'],
    TextBox: ['textbox', 'text', 'box'],
    Dropdown: ['dropdown', 'select', 'combobox'],
    Link: ['link'],
    CheckBox: ['checkbox', 'check', 'box'],
    Label: ['label'],
  };

  return new Set(common.concat(specific[controlType] || []));
}

function toCSharpPascalCase(value) {
  if (!value) return '';
  return String(value)
    .replace(/\bI['’]m\b/gi, 'Im')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

function toCSharpParameterName(value) {
  const pascal = toCSharpPascalCase(value) || 'value';
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

function toNadaInputParameterName(value) {
  if (value === 'EmailAddress') return 'email';
  return toCSharpParameterName(value);
}

function splitPascalCase(value) {
  return String(value || 'Element')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim();
}

function escapeCSharp(str) {
  if (!str) return '';
  return String(str)
    .replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    .replace(/\n/g, '\\n').replace(/\r/g, '\\r');
}

function escapeCssSingleQuotedValue(str) {
  if (!str) return '';
  return String(str).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// ============================================================
//  SVG WARNING BANNER
// ============================================================
function showSvgWarning(climbedFrom) {
  svgWarningText.textContent =
    `SVG element detected (originally <${climbedFrom || 'svg'}>). ` +
    `The extension found the closest useful parent. ` +
    `Verify locators manually.`;
  svgWarning.classList.add('show');
}
function hideSvgWarning() {
  svgWarning.classList.remove('show');
}

// ============================================================
//  CHECKBOX UI
// ============================================================
function updateCheckboxStyles() {
  chkUseJsClickWrapper.classList.toggle('checked', chkUseJsClick.checked);
  chkGenerateAssertWrapper.classList.toggle('checked', chkGenerateAssert.checked);
  chkIncludeDefaultTextWrapper.classList.toggle('checked', chkIncludeDefaultText.checked);
}

// ============================================================
//  SEND KEYS TOGGLE
// ============================================================
function toggleSendKeysInput() {
  sendKeysGroup.classList.toggle('hidden', actionSelect.value !== 'sendKeys');
}

// ============================================================
//  CLEAR SELECTION
// ============================================================
function clearSelection() {
  currentElement = null;
  currentLocator = null;
  locators       = [];
  hideSvgWarning();
  codeArea.innerHTML = '<span class="code-placeholder">// Select an element to generate code…</span>';
  locatorList.innerHTML = '<div class="locator-empty">No element selected</div>';
  locatorCountLabel.textContent = '';
  resetSelectButton();
}

// ============================================================
//  COPY CODE
// ============================================================
function copyCode() {
  const code = codeArea.textContent;
  if (!code || code.startsWith('//')) return;
  navigator.clipboard.writeText(code)
    .then(showToast)
    .catch((err) => showError('Clipboard write failed: ' + (err.message || 'Unknown error')));
}

// ============================================================
//  HISTORY
// ============================================================
function loadHistory() {
  chrome.storage.local.get(STORAGE_KEY_HISTORY, (result) => {
    renderHistory(result[STORAGE_KEY_HISTORY] || []);
  });
}

function addToHistory(el) {
  chrome.storage.local.get(STORAGE_KEY_HISTORY, (result) => {
    let items = result[STORAGE_KEY_HISTORY] || [];
    const label = getHistoryLabel(el);
    items = items.filter((i) => getHistoryLabel(i) !== label);
    items.unshift(el);
    if (items.length > MAX_HISTORY_ITEMS) items = items.slice(0, MAX_HISTORY_ITEMS);
    chrome.storage.local.set({ [STORAGE_KEY_HISTORY]: items }, () => renderHistory(items));
  });
}

function clearHistory() {
  chrome.storage.local.remove(STORAGE_KEY_HISTORY, () => renderHistory([]));
}

function getHistoryLabel(el) {
  return el.id && !isVolatileId(el.id) ? el.id
       : el.dataTestId ? el.dataTestId
       : el.ariaLabel  ? el.ariaLabel
       : el.name       ? el.name
       : el.tag        ? el.tag
       : 'element';
}

function renderHistory(items) {
  historyList.innerHTML = '';
  if (!items || items.length === 0) {
    historyList.innerHTML = '<div class="history-empty">No history yet</div>';
    return;
  }
  items.forEach((el) => {
    const label    = getHistoryLabel(el);
    const hasFrame = el.framePath && el.framePath.length > 0;
    const item     = document.createElement('div');
    item.className = 'history-item';
    item.innerHTML =
      `<span class="history-tag">&lt;${escapeHtml(el.tag || '?')}&gt;</span>` +
      `<span class="history-label" title="${escapeHtml(label)}">${escapeHtml(label)}</span>` +
      (hasFrame ? `<span class="history-frame-tag">iframe</span>` : '');
    item.addEventListener('click', () => processElement(el));
    historyList.appendChild(item);
  });
}

// ============================================================
//  TOAST
// ============================================================
let toastTimer = null;
function showToast() {
  toast.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
    toastTimer = null;
  }, 1500);
}

// ============================================================
//  ERROR MODAL
// ============================================================
const BENIGN_ERRORS = [
  'Receiving end does not exist',
  'The message port closed before a response was received',
  'Could not establish connection',
  'Extension context invalidated',
];

function showError(message) {
  if (!message) return;
  if (BENIGN_ERRORS.some((p) => message.includes(p))) return;
  modalErrorText.textContent = message;
  modalOverlay.classList.add('show');
}
function hideModal() {
  modalOverlay.classList.remove('show');
}

// ============================================================
//  UTILITIES
// ============================================================

/** Escape a string for safe HTML insertion. */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Escape a string for use in a C# double-quoted string literal. */
function escapeJava(str) {
  if (!str) return '';
  return String(str)
    .replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    .replace(/\n/g, '\\n').replace(/\r/g, '\\r');
}

/** Escape a string for use in a single-quoted CSS attribute value. */
function escapeJavaSingleQ(str) {
  if (!str) return '';
  return String(str).replace(/'/g, "\\'").replace(/\\/g, '\\\\');
}

/** Escape a string for a CSS attribute selector value (double-quoted). */
function cssAttrEscape(str) {
  if (!str) return '';
  return String(str).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** Escape an ID for use in a CSS ID selector (#...). */
function cssIdEscape(id) {
  if (!id) return '';
  // Escape characters that have meaning in CSS selectors
  return String(id).replace(/([!"#$%&'()*+,.\/:;<=>?@[\\\]^`{|}~])/g, '\\$1');
}
