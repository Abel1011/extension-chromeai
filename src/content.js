// Content script: listens to user events and requests screenshots
// Wrapped in IIFE to avoid conflicts with page scripts

(function() {
  'use strict';
  
  if (window.__docuflow_ai_loaded__) {
    return;
  }
  window.__docuflow_ai_loaded__ = true;

  let recording = false;

  const overlay = createOverlay();

  async function refreshState() {
    try {
      const state = await chrome.runtime.sendMessage({ type: 'get_state' });
      setRecording(state?.recording);
    } catch {}
  }

  function setRecording(on) {
    recording = !!on;
    overlay.style.display = recording ? 'flex' : 'none';
  }

  function createOverlay() {
    const el = document.createElement('div');
    el.setAttribute('data-ai-recorder', '');
    Object.assign(el.style, {
      position: 'fixed',
      right: '20px',
      bottom: '20px',
      zIndex: 2147483647,
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      color: 'white',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, sans-serif',
      fontSize: '13px',
      padding: '12px 16px',
      borderRadius: '24px',
      boxShadow: '0 10px 25px rgba(102, 126, 234, 0.5), 0 4px 10px rgba(0, 0, 0, 0.1)',
      display: 'none',
      alignItems: 'center',
      gap: '10px',
      backdropFilter: 'blur(10px)',
      border: '1px solid rgba(255, 255, 255, 0.2)',
      fontWeight: '600',
      letterSpacing: '0.3px'
    });
    
    const dot = document.createElement('span');
    Object.assign(dot.style, {
      width: '10px', 
      height: '10px', 
      borderRadius: '50%', 
      background: '#ef4444', 
      display: 'inline-block',
      boxShadow: '0 0 12px rgba(239, 68, 68, 0.8)',
      animation: 'pulse 2s ease-in-out infinite'
    });
    
    const icon = document.createElement('span');
    icon.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"/>
        <circle cx="12" cy="12" r="3" fill="currentColor"/>
      </svg>
    `;
    icon.style.display = 'flex';
    icon.style.alignItems = 'center';
    
  const text = document.createElement('span');
  text.textContent = 'DocuFlow AI recording';
    
    el.append(dot, icon, text);
    
    // Añadir animación CSS
    const style = document.createElement('style');
    style.textContent = `
      @keyframes pulse {
        0%, 100% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.6; transform: scale(0.9); }
      }
    `;
    document.head.appendChild(style);
    
    document.documentElement.appendChild(el);
    return el;
  }

  function isInOverlay(node) {
    return !!(node && (node === overlay || node.closest?.('[data-ai-recorder]')));
  }

  function buildSelector(el) {
    if (!el || el === document.body) return 'body';
    if (el.id) return `#${cssEscape(el.id)}`;
    const name = el.tagName.toLowerCase();
    let selector = name;
    if (el.classList?.length) selector += '.' + [...el.classList].map(cssEscape).join('.');
    return selector;
  }

  function cssEscape(s) {
    return (s || '').toString().replace(/[^a-zA-Z0-9_-]/g, '-');
  }

  function elementInfo(target) {
    const rect = target?.getBoundingClientRect?.();
    return {
      selector: buildSelector(target),
      elementText: truncate((target?.innerText || target?.ariaLabel || '').trim(), 200),
      value: 'value' in (target || {}) ? truncate(String(target.value || ''), 200) : undefined,
      rect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : undefined
    };
  }

  function commonMeta(ev, target) {
    return {
      event: ev,
      title: document.title,
      url: location.href,
      viewport: { width: innerWidth, height: innerHeight },
      scroll: { x: scrollX, y: scrollY },
      ...elementInfo(target)
    };
  }

  async function capture(meta, delay = 0) {
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    const wasVisible = overlay && overlay.style.display !== 'none';
    if (wasVisible) {
      overlay.style.display = 'none';
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    try {
      await chrome.runtime.sendMessage({ type: 'capture_step', meta });
    } catch (e) {
      // ignore
    } finally {
      if (wasVisible) {
        setRecording(recording);
      }
    }
  }

  function onClick(e) {
    if (!recording) return;
    const t = e.target;
    if (isInOverlay(t)) return;
    const meta = commonMeta('click', t);
    meta.point = { x: e.clientX, y: e.clientY };
    capture(meta, 250);
  }

  function onBlur(e) {
    if (!recording) return;
    const t = e.target;
    if (isInOverlay(t)) return;
    if (isTextual(t)) capture(commonMeta('input', t));
  }

  function onKeyDown(e) {
    if (!recording) return;
    const t = e.target;
    if (isInOverlay(t)) return;
    if (e.key === 'Enter' && isTextual(t)) {
      capture(commonMeta('input:enter', t));
    }
  }

  function isTextual(el) {
    if (!el) return false;
    const tag = el.tagName?.toLowerCase();
    const type = el.type?.toLowerCase();
    return (
      tag === 'input' && ['text','search','email','url','number','password','tel'].includes(type)
    ) || tag === 'textarea' || el.isContentEditable;
  }

  // Attach event listeners
  window.addEventListener('click', onClick, true);
  window.addEventListener('blur', onBlur, true);
  window.addEventListener('keydown', onKeyDown, true);

  // initial
  refreshState();

  // Respond to state pings if popup wants to highlight
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === 'set_recording') {
      setRecording(!!msg.on);
      sendResponse({ ok: true });
    }
    return true;
  });
  
  function truncate(str, n) {
    if (!str) return '';
    return str.length > n ? str.slice(0, n - 1) + '…' : str;
  }
})();
