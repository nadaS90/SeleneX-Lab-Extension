/**
 * content.js - SeleneX Lab v1
 *
 * Injected into every page frame (all_frames: true).
 * Responsibilities:
 *  - Listen for START_SELECTION from popup
 *  - Show/move a red hover highlight overlay during selection mode
 *  - Intercept page click to capture element
 *  - Climb out of raw SVG elements to a smarter parent
 *  - Collect comprehensive locator data (data-*, aria, placeholder, role, etc.)
 *  - Detect frame path from this window to the top
 *  - Write element data to chrome.storage.local (primary channel)
 *  - Also try chrome.runtime.sendMessage (secondary channel)
 */

'use strict';

(function initSeleneXLabContent() {

if (window.__selenexLabContentV1) {
  window.__selenexLabContentV1.destroy();
}

// ============================================================
//  CONSTANTS
// ============================================================
const OVERLAY_ID    = '__selenex_lab_overlay__';
const STORAGE_KEY   = 'selenexLabPendingElement';
const STORAGE_KEY_SELECTION_STATE = 'selenexLabSelectionState';

// SVG child elements that are not useful as locator targets
const SVG_INLINE_TAGS = new Set([
  'path', 'circle', 'rect', 'ellipse', 'line', 'polyline',
  'polygon', 'text', 'tspan', 'use', 'defs', 'g', 'mask',
  'clippath', 'lineargradient', 'radialgradient', 'stop',
  'symbol', 'title', 'desc', 'animatetransform',
]);

// ============================================================
//  STATE
// ============================================================
let selectionMode = false;
let overlay       = null;
let lastTarget    = null;
let listenerAbort = null;
let postCaptureAbort = null;
let activeSelectionSessionId = null;
let pendingSelectionTarget = null;

// ============================================================
//  HIGHLIGHT OVERLAY
// ============================================================
function createOverlay() {
  removeOverlay();
  const host = document.body || document.documentElement;
  if (!host) return;

  overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  Object.assign(overlay.style, {
    position:    'fixed',
    display:     'none',
    pointerEvents: 'none',
    zIndex:      '2147483647',
    border:      '2px solid #ef4444',
    background:  'rgba(239,68,68,0.10)',
    borderRadius: '3px',
    boxSizing:   'border-box',
    transition:  'top 0.04s, left 0.04s, width 0.04s, height 0.04s',
    top: '0px', left: '0px', width: '0px', height: '0px',
  });
  host.appendChild(overlay);
}

function updateOverlay(el) {
  if (!overlay || !el) return;
  const r = el.getBoundingClientRect();
  if (!r || r.width <= 0 || r.height <= 0) {
    overlay.style.display = 'none';
    return;
  }

  Object.assign(overlay.style, {
    display: 'block',
    top:    `${r.top}px`,
    left:   `${r.left}px`,
    width:  `${r.width}px`,
    height: `${r.height}px`,
  });
}

function removeOverlay() {
  if (overlay) { overlay.remove(); overlay = null; }
  lastTarget = null;
}

// ============================================================
//  EVENT HANDLERS
// ============================================================
function onMouseMove(e) {
  if (!selectionMode) return;
  const target = e.target;
  if (target && target.id === OVERLAY_ID) return;
  if (target !== lastTarget) {
    lastTarget = target;
    // During hover, show the visually best parent so the highlight makes sense
    const visual = chooseBestVisualTarget(target);
    updateOverlay(visual);
  }
}

function onClick(e) {
  captureSelectedElement(e, getEventTarget(e));
}

function onSelectionRelease(e) {
  captureSelectedElement(e, getEventTarget(e));
}

function captureSelectedElement(e, explicitTarget = null) {
  if (!selectionMode) return;
  const target = chooseBestCaptureTarget(explicitTarget || e.target);
  if (!target || target.id === OVERLAY_ID) return;

  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();

  const sessionId = activeSelectionSessionId;
  suppressPostCaptureEvents();
  stopSelectionMode();

  // Collect and broadcast element data
  const data = collectElementData(target);
  chrome.storage.local.set({
    [STORAGE_KEY]: data,
    [STORAGE_KEY_SELECTION_STATE]: {
      active: false,
      selectionId: data.selectionId,
      sessionId,
    },
  });
  try {
    chrome.runtime.sendMessage({ type: 'ELEMENT_SELECTED', data });
  } catch (_) {
    // Silently ignored — storage.local is the reliable channel
  }
}

function onSelectionPress(e) {
  if (!selectionMode) return;
  pendingSelectionTarget = getEventTarget(e);
}

function getEventTarget(e) {
  if (!e) return pendingSelectionTarget || lastTarget;

  if (typeof e.clientX === 'number' && typeof e.clientY === 'number') {
    const pointTarget = document.elementFromPoint(e.clientX, e.clientY);
    if (pointTarget && pointTarget.id !== OVERLAY_ID) {
      return pointTarget;
    }
  }

  return e.target || pendingSelectionTarget || lastTarget;
}

function chooseBestCaptureTarget(target) {
  if (!target || target === document || target === window) {
    return pendingSelectionTarget || lastTarget;
  }

  return target;
}

function suppressPostCaptureEvents() {
  if (postCaptureAbort) {
    postCaptureAbort.abort();
  }

  postCaptureAbort = new AbortController();
  const options = {
    capture: true,
    passive: false,
    signal: postCaptureAbort.signal,
  };
  const suppress = (event) => {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  };

  document.addEventListener('click', suppress, options);
  document.addEventListener('mouseup', suppress, options);
  document.addEventListener('pointerup', suppress, options);

  setTimeout(() => {
    if (postCaptureAbort) {
      postCaptureAbort.abort();
      postCaptureAbort = null;
    }
  }, 150);
}

// ============================================================
//  SVG / ELEMENT CLIMBING
// ============================================================

/**
 * Given a raw element (which might be an SVG path), walk up the DOM
 * to find the most useful locator-capable ancestor.
 *
 * Returns { element, isSvgElement, climbedFrom }
 */
function climbToUsefulElement(el) {
  const originalTag = el.tagName ? el.tagName.toLowerCase() : '';
  const isSvg = SVG_INLINE_TAGS.has(originalTag) || originalTag === 'svg';

  if (!isSvg) {
    return { element: el, isSvgElement: false, climbedFrom: null };
  }

  // Walk up from SVG element until we find a good host
  let current = el.parentElement;
  while (current) {
    const tag = current.tagName ? current.tagName.toLowerCase() : '';
    // Stop at interactive / container elements
    if (['button', 'a', 'label', 'input', 'select', 'textarea', 'li', 'td', 'th'].includes(tag)) {
      return { element: current, isSvgElement: true, climbedFrom: originalTag };
    }
    // Stop at elements with meaningful locator attributes
    if (
      current.id && !isVolatileId(current.id) ||
      current.getAttribute('aria-label') ||
      current.getAttribute('data-testid') ||
      current.getAttribute('data-test') ||
      current.getAttribute('data-qa') ||
      current.getAttribute('role')
    ) {
      return { element: current, isSvgElement: true, climbedFrom: originalTag };
    }
    // Stop at the SVG container itself — use its parent
    if (tag === 'svg') {
      const svgParent = current.parentElement;
      if (svgParent) {
        return { element: svgParent, isSvgElement: true, climbedFrom: originalTag };
      }
      break;
    }
    current = current.parentElement;
  }

  // Could not find a better parent — return original
  return { element: el, isSvgElement: true, climbedFrom: originalTag };
}

/**
 * For hover highlighting, choose the best visual element to highlight.
 * Prefers a useful interactive ancestor when hovering SVG internals.
 */
function chooseBestVisualTarget(el) {
  const { element } = climbToUsefulElement(el);
  return element;
}

// ============================================================
//  ELEMENT DATA COLLECTION
// ============================================================
function collectElementData(rawEl) {
  const { element: el, isSvgElement, climbedFrom } = climbToUsefulElement(rawEl);

  const tag         = (el.tagName || 'UNKNOWN').toLowerCase();
  const id          = el.id || null;
  const name        = el.getAttribute('name') || null;
  const ariaLabel   = el.getAttribute('aria-label') || null;
  const ariaLabelBy = el.getAttribute('aria-labelledby') || null;
  const placeholder = el.getAttribute('placeholder') || null;
  const title       = el.getAttribute('title') || null;
  const role        = el.getAttribute('role') || null;
  const type        = el.getAttribute('type') || null;
  const value       = el.getAttribute('value') || el.value || null;
  const href        = el.getAttribute('href') || null;
  const className   = el.className ? String(el.className).trim() : null;

  // Data-* test attributes
  const dataTestId = el.getAttribute('data-testid') || null;
  const dataTest   = el.getAttribute('data-test')   || null;
  const dataQa     = el.getAttribute('data-qa')     || null;
  const dataCy     = el.getAttribute('data-cy')     || null;

  // Text content (trimmed, length-limited)
  const textContent = sanitizeText(el.innerText || el.textContent);

  // Parent element info (for parent > child CSS strategy)
  const parent      = el.parentElement;
  const parentTag   = parent ? (parent.tagName || '').toLowerCase() : null;
  const parentId    = parent ? (parent.id || null) : null;
  const parentClass = parent ? (parent.className ? String(parent.className).trim() : null) : null;

  // Linked label text: find a <label> pointing to this input via 'for' attribute
  const linkedLabel = getLinkedLabelText(el, id);

  // Frame path from this window up to the top
  const framePath = getFramePath();

  return {
    selectionId: createSelectionId(),
    selectedAt: Date.now(),
    pageUrl: location.href,
    tag, id, name, ariaLabel, ariaLabelBy,
    placeholder, title, role, type, value, href, className,
    dataTestId, dataTest, dataQa, dataCy,
    textContent, linkedLabel,
    parentTag, parentId, parentClass,
    framePath,
    isSvgElement,
    climbedFrom,
  };
}

/** Returns trimmed, normalized, length-limited text content. */
function sanitizeText(raw) {
  if (!raw) return null;
  const t = String(raw).replace(/\s+/g, ' ').trim();
  return t.length > 100 ? t.substring(0, 100) + '…' : (t || null);
}

/**
 * Attempts to find the visible label text for an input element
 * by checking <label for="..."> associations in the document.
 */
function getLinkedLabelText(el, id) {
  if (!id) return null;
  try {
    const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
    return label ? sanitizeText(label.textContent) : null;
  } catch (_) {
    return null;
  }
}

// ============================================================
//  VOLATILE ID DETECTION  (mirrors popup.js — kept in sync)
// ============================================================
function isVolatileId(id) {
  if (!id) return true;
  const s = String(id);
  if (s.length <= 2)                                 return true;
  if (/^\d+$/.test(s))                               return true;
  if (/[a-f0-9]{8,}/i.test(s))                       return true;
  if (/\d{5,}/.test(s))                              return true;
  if (/^(ng-|react-|ember-|vue-|_ng|auto)/.test(s)) return true;
  if (/^[a-z]{1,2}[0-9]{4,}$/i.test(s))             return true;
  if (isRandomLookingId(s))                          return true;
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

// ============================================================
//  FRAME PATH DETECTION
// ============================================================

/**
 * Walks from window → window.parent recording the iframe descriptor
 * at each level. Returns outermost-first array.
 * Empty array = content script is in the top-level document.
 */
function getFramePath() {
  const frames = [];
  let win = window;

  while (win !== win.parent) {
    const parentWin = win.parent;
    let frameIndex  = -1;
    let frameId     = null;
    let frameName   = null;

    try {
      const iframes = parentWin.document.querySelectorAll('iframe, frame');
      for (let i = 0; i < iframes.length; i++) {
        try {
          if (iframes[i].contentWindow === win) {
            frameIndex = i;
            frameId    = iframes[i].id   || null;
            frameName  = iframes[i].name || null;
            break;
          }
        } catch (_) {
          // Cross-origin frame — skip
        }
      }
    } catch (_) {
      // Cross-origin parent document — stop walking
      break;
    }

    frames.unshift({ index: frameIndex, id: frameId, name: frameName });
    win = parentWin;
  }

  return frames;
}

// ============================================================
//  SELECTION MODE ACTIVATION
// ============================================================
function startSelectionMode(sessionId = createSelectionId()) {
  if (selectionMode) {
    stopSelectionMode();
  }

  selectionMode = true;
  activeSelectionSessionId = sessionId;
  listenerAbort = new AbortController();
  createOverlay();

  const listenerOptions = {
    capture: true,
    passive: false,
    signal: listenerAbort.signal,
  };

  document.addEventListener('mousemove', onMouseMove, listenerOptions);
  document.addEventListener('click',       onClick, listenerOptions);
  document.addEventListener('mousedown',   onSelectionPress, listenerOptions);
  document.addEventListener('mouseup',     onSelectionRelease, listenerOptions);
  document.addEventListener('pointerdown', onSelectionPress, listenerOptions);
  document.addEventListener('pointerup',   onSelectionRelease, listenerOptions);
  document.addEventListener('touchstart',  onSelectionPress, listenerOptions);
  document.addEventListener('touchend',    onSelectionRelease, listenerOptions);
}

function stopSelectionMode() {
  selectionMode = false;
  activeSelectionSessionId = null;
  pendingSelectionTarget = null;
  if (listenerAbort) {
    listenerAbort.abort();
    listenerAbort = null;
  }
  removeOverlay();
}

function createSelectionId() {
  const randomPart = Math.random().toString(36).slice(2);
  return `${Date.now()}-${randomPart}`;
}

// ============================================================
//  MESSAGE LISTENER
// ============================================================
function onRuntimeMessage(msg, _sender, sendResponse) {
  if (msg && msg.type === 'START_SELECTION') {
    startSelectionMode(msg.sessionId);
    try { sendResponse({ ok: true }); } catch (_) {}
  } else if (msg && msg.type === 'STOP_SELECTION') {
    stopSelectionMode();
    try { sendResponse({ ok: true }); } catch (_) {}
  }
  return false; // Do not keep channel open
}

chrome.runtime.onMessage.addListener(onRuntimeMessage);

function onSelectionStateChanged(changes, area) {
  if (area !== 'local' || !changes[STORAGE_KEY_SELECTION_STATE]) return;

  const state = changes[STORAGE_KEY_SELECTION_STATE].newValue;
  if (
    state &&
    state.active === false &&
    (!activeSelectionSessionId || !state.sessionId || state.sessionId === activeSelectionSessionId)
  ) {
    stopSelectionMode();
  }
}

chrome.storage.onChanged.addListener(onSelectionStateChanged);

function destroySelectionHelper() {
  stopSelectionMode();
  if (postCaptureAbort) {
    postCaptureAbort.abort();
    postCaptureAbort = null;
  }
  try {
    chrome.runtime.onMessage.removeListener(onRuntimeMessage);
    chrome.storage.onChanged.removeListener(onSelectionStateChanged);
  } catch (_) {
    // Extension context may already be invalidated during reload.
  }
}

window.__selenexLabContentV1 = {
  start: startSelectionMode,
  stop: stopSelectionMode,
  destroy: destroySelectionHelper,
};

})();
