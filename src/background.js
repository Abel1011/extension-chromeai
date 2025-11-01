// Background service worker

const SESSIONS_KEY = 'sessions';
const CURRENT_KEY = 'currentSessionId';
const SCREENSHOT_PREFIX = 'shot:';

let recording = false;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'ai_describe' || msg?.type === 'ai_describe_batch') {
    return;
  }
  (async () => {
    try {
      switch (msg?.type) {
        case 'get_state': {
          const { sessions, currentSessionId } = await loadState();
          const steps = currentSessionId && sessions[currentSessionId]?.steps || [];
          sendResponse({ recording, currentSessionId, stepCount: steps.length });
          break;
        }
        case 'start_recording': {
          recording = true;
          const contextValue = msg?.context || '';
          const sessionId = await startNewSession(contextValue);
          await ensureOffscreen('warmup');
          await broadcastRecording(true);
          sendResponse({ ok: true, sessionId, recording });
          break;
        }
        case 'stop_recording': {
          recording = false;
          await broadcastRecording(false);
          sendResponse({ ok: true, recording });
          break;
        }
        case 'capture_step': {
          if (!recording) { 
            sendResponse({ ok: false, error: 'not_recording' }); 
            break; 
          }
          const tabId = sender?.tab?.id;
          const tab = tabId ? await chrome.tabs.get(tabId) : null;
          const windowId = tab?.windowId ?? (await chrome.windows.getCurrent())?.id;
          const pngDataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
          const meta = msg?.meta || {};
          let annotatedUrl = pngDataUrl;
          try {
            annotatedUrl = await annotateScreenshot(pngDataUrl, meta);
          } catch (error) {
            console.error('screenshot annotate failed', error);
            annotatedUrl = pngDataUrl;
          }
          const stepId = crypto.randomUUID();
          let screenshotKey = null;
          try {
            screenshotKey = await storeScreenshot(stepId, annotatedUrl);
          } catch (error) {
            console.error('screenshot store failed', error);
          }
          const step = {
            id: stepId,
            ts: Date.now(),
            url: sender?.tab?.url || meta.url,
            title: sender?.tab?.title || meta.title,
            event: meta.event,
            selector: meta.selector,
            elementText: meta.elementText,
            value: meta.value,
            viewport: meta.viewport,
            rect: meta.rect,
            scroll: meta.scroll,
            point: meta.point,
            ...(screenshotKey ? { screenshotKey } : { screenshot: annotatedUrl }),
            aiDescription: null,
            manualCaption: null
          };
          const { sessions, currentSessionId } = await loadState();
          sessions[currentSessionId].steps.push(step);
          try {
            await chrome.storage.local.set({ [SESSIONS_KEY]: sessions });
          } catch (error) {
            if (screenshotKey) {
              await chrome.storage.session.remove(screenshotKey).catch(() => {});
            }
            throw error;
          }
          
          try {
            const exists = await chrome.offscreen.hasDocument?.();
            if (exists) {
              const r = await chrome.runtime.sendMessage({ type: 'ai_describe', image: pngDataUrl, context: buildContext(step) });
              if (r?.text) {
                const data = await chrome.storage.local.get([SESSIONS_KEY, CURRENT_KEY]);
                const s2 = data[SESSIONS_KEY] || {};
                const cid = data[CURRENT_KEY];
                const steps = s2[cid]?.steps || [];
                const idx = steps.findIndex(st => st.id === step.id);
                if (idx >= 0) {
                  steps[idx].aiDescription = r.text;
                  s2[cid].steps = steps;
                  await chrome.storage.local.set({ [SESSIONS_KEY]: s2 });
                }
              }
            }
          } catch (e) {
            console.log('AI description skipped:', e.message);
          }
          
          sendResponse({ ok: true, stepId: step.id });
          break;
        }
        case 'describe_all_images': {
          const { sessions, currentSessionId } = await loadState();
          const session = sessions[currentSessionId];
          if (!session) {
            sendResponse({ ok: false, error: 'no_session' });
            break;
          }
          const pending = session.steps.filter((step) => !step.aiDescription);
          if (!pending.length) {
            sendResponse({ ok: true, described: 0, pending: 0 });
            break;
          }
          await ensureOffscreen('warmup');
          let described = 0;
          for (const step of pending) {
            try {
              const screenshot = await getScreenshot(step);
              if (!screenshot) continue;
              const result = await chrome.runtime.sendMessage({
                type: 'ai_describe',
                image: screenshot,
                context: buildContext(step)
              });
              if (result?.text) {
                step.aiDescription = result.text;
                described += 1;
              }
            } catch (error) {
              console.log('AI description failed:', error.message);
            }
          }
          sessions[currentSessionId] = session;
          await chrome.storage.local.set({ [SESSIONS_KEY]: sessions });
          sendResponse({ ok: true, described, pending: pending.length });
          break;
        }
        case 'delete_step': {
          const targetId = msg?.stepId;
          if (!targetId) {
            sendResponse({ ok: false, error: 'missing_step_id' });
            break;
          }
          const { sessions, currentSessionId } = await loadState();
          const session = sessions[currentSessionId];
          if (!session) {
            sendResponse({ ok: false, error: 'no_session' });
            break;
          }
          const before = session.steps.length;
          const removedSteps = session.steps.filter((step) => step.id === targetId);
          session.steps = session.steps.filter((step) => step.id !== targetId);
          sessions[currentSessionId] = session;
          await chrome.storage.local.set({ [SESSIONS_KEY]: sessions });
          if (removedSteps.length) {
            await Promise.allSettled(removedSteps.map((step) => removeScreenshot(step)));
          }
          sendResponse({ ok: true, removed: before - session.steps.length });
          break;
        }
        case 'generate_markdown': {
          const markdown = await buildMarkdown();
          sendResponse({ ok: true, markdown });
          break;
        }
        case 'translate_markdown': {
          try {
            await ensureOffscreen('translate');
            const translated = await translateMarkdown(msg.markdown, msg.targetLanguage, msg.languageName);
            sendResponse({ ok: true, translated });
          } catch (error) {
            console.error('Translation error:', error);
            sendResponse({ ok: false, error: error.message });
          }
          break;
        }
        case 'clear_all': {
          try {
            await clearAllSteps();
            sendResponse({ ok: true });
          } catch (error) {
            sendResponse({ ok: false, error: error.message });
          }
          break;
        }
        default:
          sendResponse({ ok: false, error: 'unknown_message_type' });
          break;
      }
    } catch (error) {
      console.error('Background error:', error);
      sendResponse({ ok: false, error: error.message });
    }
  })();
  return true;
});

let migrationPromise = null;

function buildContext(step) {
  const parts = [];
  if (step.event) parts.push(`Event: ${step.event}`);
  if (step.selector) parts.push(`Selector: ${step.selector}`);
  if (step.elementText) parts.push(`Text: ${truncate(step.elementText, 120)}`);
  if (step.value) parts.push(`Value: ${truncate(step.value, 120)}`);
  return parts.join(' | ');
}

async function ensureScreenshotMigration() {
  if (migrationPromise) return migrationPromise;
  migrationPromise = migrateLegacyScreenshots().catch((error) => {
    console.error('screenshot migration failed', error);
    migrationPromise = null;
  });
  return migrationPromise;
}

async function migrateLegacyScreenshots() {
  const data = await chrome.storage.local.get([SESSIONS_KEY]);
  const sessions = data[SESSIONS_KEY] || {};
  let mutated = false;
  for (const session of Object.values(sessions)) {
    if (!Array.isArray(session?.steps)) continue;
    for (const step of session.steps) {
      if (step?.screenshot && !step.screenshotKey) {
        const id = step.id || crypto.randomUUID();
        const key = `${SCREENSHOT_PREFIX}${id}`;
        try {
          await chrome.storage.session.set({ [key]: step.screenshot });
          step.screenshotKey = key;
          delete step.screenshot;
          mutated = true;
        } catch (error) {
          console.error('legacy screenshot store failed', error);
        }
      }
    }
  }
  if (mutated) {
    await chrome.storage.local.set({ [SESSIONS_KEY]: sessions });
  }
}

async function storeScreenshot(stepId, dataUrl) {
  const key = `${SCREENSHOT_PREFIX}${stepId}`;
  await chrome.storage.session.set({ [key]: dataUrl });
  return key;
}

async function getScreenshot(step) {
  if (!step) return null;
  if (step.screenshot) return step.screenshot;
  if (!step.screenshotKey) return null;
  const cached = await chrome.storage.session.get(step.screenshotKey);
  return cached?.[step.screenshotKey] || null;
}

async function removeScreenshot(step) {
  if (!step) return;
  const keys = [];
  if (step.screenshotKey) keys.push(step.screenshotKey);
  if (keys.length) {
    await chrome.storage.session.remove(keys).catch((error) => {
      console.error('screenshot removal failed', error);
    });
  }
}

async function annotateScreenshot(dataUrl, meta) {
  const hasPoint = Number.isFinite(meta?.point?.x) && Number.isFinite(meta?.point?.y);
  const hasRect = Number.isFinite(meta?.rect?.x) && Number.isFinite(meta?.rect?.y) && Number.isFinite(meta?.rect?.width) && Number.isFinite(meta?.rect?.height);
  if (!hasPoint && !hasRect) return dataUrl;
  if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap !== 'function') return dataUrl;
  try {
    const response = await fetch(dataUrl);
    if (!response.ok) return dataUrl;
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d', { desynchronized: true });
    if (!ctx) return dataUrl;
    ctx.drawImage(bitmap, 0, 0);
    const viewportWidth = Number(meta?.viewport?.width) || bitmap.width;
    const viewportHeight = Number(meta?.viewport?.height) || bitmap.height;
    const scaleX = bitmap.width / viewportWidth;
    const scaleY = bitmap.height / viewportHeight;
    const base = Math.max(bitmap.width, bitmap.height);
    if (hasRect) {
      const rawX = meta.rect.x * scaleX;
      const rawY = meta.rect.y * scaleY;
      const rawW = meta.rect.width * scaleX;
      const rawH = meta.rect.height * scaleY;
      const rx = Math.max(0, Math.min(bitmap.width, rawX));
      const ry = Math.max(0, Math.min(bitmap.height, rawY));
      const rw = Math.max(0, Math.min(bitmap.width - rx, rawW));
      const rh = Math.max(0, Math.min(bitmap.height - ry, rawH));
      ctx.save();
      ctx.fillStyle = 'rgba(16, 185, 129, 0.18)';
      ctx.fillRect(rx, ry, rw, rh);
      ctx.strokeStyle = 'rgba(16, 185, 129, 0.95)';
      ctx.lineWidth = Math.max(3, base * 0.003);
      ctx.setLineDash([12, 8]);
      ctx.strokeRect(rx, ry, rw, rh);
      ctx.restore();
    }
    if (hasPoint) {
      const px = Math.max(0, Math.min(bitmap.width, meta.point.x * scaleX));
      const py = Math.max(0, Math.min(bitmap.height, meta.point.y * scaleY));
      const radius = Math.max(14, base * 0.03);
      ctx.save();
      ctx.beginPath();
      ctx.fillStyle = 'rgba(239, 68, 68, 0.2)';
      ctx.arc(px, py, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = Math.max(4, base * 0.004);
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.75)';
      ctx.stroke();
      ctx.restore();
    }
    const annotatedBlob = await canvas.convertToBlob({ type: 'image/png' });
    return await blobToDataUrl(annotatedBlob);
  } catch (error) {
    console.error('annotateScreenshot failed', error);
    return dataUrl;
  }
}

async function blobToDataUrl(blob) {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function loadState() {
  await ensureScreenshotMigration();
  const data = await chrome.storage.local.get([SESSIONS_KEY, CURRENT_KEY]);
  return {
    sessions: data[SESSIONS_KEY] || {},
    currentSessionId: data[CURRENT_KEY] || null
  };
}

async function startNewSession(initialContext = '') {
  const { sessions } = await loadState();
  const id = new Date().toISOString().replace(/[:.]/g, '-');
  sessions[id] = { id, createdAt: Date.now(), steps: [], articleContext: initialContext };
  await chrome.storage.local.set({ [SESSIONS_KEY]: sessions, [CURRENT_KEY]: id });
  return id;
}

async function buildMarkdown() {
  const { sessions, currentSessionId } = await loadState();
  const session = sessions[currentSessionId];
  if (!session) return '# Empty session';
  const lines = [];
  const docTitle = session.articleTitle || session.steps[0]?.title || session.steps[0]?.aiDescription || 'Session';
  lines.push(`# ${docTitle}\n`);
  lines.push(`Generated: ${new Date(session.createdAt).toLocaleString()}\n`);
  if (session.articleIntroduction) {
    lines.push(`${session.articleIntroduction}\n`);
  }

  const issues = Array.isArray(session.articleIssues) ? session.articleIssues.filter((issue) => issue && (issue.message || typeof issue === 'string')) : [];
  if (issues.length) {
    lines.push('## Quality Review');
    issues.forEach((issue) => {
      const message = typeof issue === 'string' ? issue : issue.message;
      if (message) lines.push(`- ${message}`);
    });
    lines.push('');
  }

  for (let idx = 0; idx < session.steps.length; idx += 1) {
    const step = session.steps[idx];
    const heading = step.manualCaption || step.title || `Step ${idx + 1}`;
    const description = step.aiDescription || buildContext(step) || step.url || heading;
    lines.push(`## Step ${idx + 1}: ${heading}`);
    lines.push(description);
    if (step.aiStatus && step.aiStatus !== 'keep') {
      lines.push(`> Status: ${step.aiStatus}`);
    }
    const screenshot = await getScreenshot(step);
    if (screenshot) {
      lines.push(`\n![Step ${idx + 1}](${screenshot})\n`);
    }
  }
  return lines.join('\n');
}

async function ensureOffscreen(action) {
  try {
    const exists = await chrome.offscreen.hasDocument?.();
    if (!exists) {
      await chrome.offscreen.createDocument({
        url: 'src/offscreen.html',
        reasons: ['AUDIO_PLAYBACK'],
        justification: 'Run AI captions, translations, and optionally record mic audio'
      });
    }
  } catch (e) {
    console.error('Failed to create offscreen document:', e);
  }
}

function truncate(str, n) {
  if (!str) return '';
  return str.length > n ? str.slice(0, n - 1) + '…' : str;
}

async function clearAllSteps() {
  const { sessions, currentSessionId } = await loadState();
  const session = sessions[currentSessionId];
  if (!session) return;
  
  const removedSteps = session.steps || [];
  session.steps = [];
  session.articleTitle = '';
  session.articleIntroduction = '';
  session.articleContext = '';
  session.articleIssues = [];
  
  sessions[currentSessionId] = session;
  await chrome.storage.local.set({ [SESSIONS_KEY]: sessions });
  
  if (removedSteps.length) {
    await Promise.allSettled(removedSteps.map((step) => removeScreenshot(step)));
  }
}

async function broadcastRecording(on) {
  try {
    const tabs = await chrome.tabs.query({});
    await Promise.all(tabs.map(t => chrome.tabs.sendMessage(t.id, { type: 'set_recording', on }).catch(() => {})));
  } catch (e) {
    // ignore
  }
}

async function translateMarkdown(markdown, targetLang, languageName) {
  await ensureOffscreen('translate');
  
  const response = await chrome.runtime.sendMessage({
    type: 'ai_translate',
    markdown,
    targetLanguage: targetLang,
    languageName
  });
  
  if (!response?.ok || !response?.translated) {
    const errorMsg = response?.error || 'Translation failed - no response';
    throw new Error(errorMsg);
  }
  
  return response.translated;
}
