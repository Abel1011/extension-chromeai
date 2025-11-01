const statusEl = document.getElementById('status');
const statusText = document.getElementById('statusText');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const enhanceBtn = document.getElementById('enhanceBtn');
const exportBtn = document.getElementById('exportBtn');
const exportPdfBtn = document.getElementById('exportPdfBtn');
const clearAllBtn = document.getElementById('clearAllBtn');
const translateBtn = document.getElementById('translateBtn');
const applyTranslateBtn = document.getElementById('applyTranslateBtn');
const translationPanel = document.getElementById('translationPanel');
const translationStatus = document.getElementById('translationStatus');
const copyBtn = document.getElementById('copyBtn');
const output = document.getElementById('output');
const stepCountEl = document.getElementById('stepCount');
const stepsContainer = document.getElementById('steps');
const contextInput = document.getElementById('contextInput');

const STEP_SYSTEM_PROMPT = 'You generate concise, professional documentation steps for SaaS tutorials based on screenshots and context. ALWAYS write in English, even if the screenshots contain text in other languages. Reply with one clear sentence per step.';
const ARTICLE_SYSTEM_PROMPT = 'You are a senior technical writer. Given a sequence of recorded steps, respond with JSON containing title, introduction, rewritten step descriptions, and any quality issues such as repeated or missing steps. ALWAYS write in English regardless of the language in the screenshots. Keep the tone instructional and concise.';

const BUTTON_COPY = {
  startIdle: { emoji: '⏺️', text: 'Start Recording', disabled: false },
  startBusy: { emoji: '⏳', text: 'Starting...', disabled: true },
  stopIdle: { emoji: '⏹️', text: 'Stop', disabled: true },
  stopReady: { emoji: '⏹️', text: 'Stop', disabled: false },
  stopBusy: { emoji: '🛑', text: 'Stopping...', disabled: true },
  enhanceIdle: { emoji: '🧠', text: 'Build Article with AI', disabled: false },
  enhanceBusy: { emoji: '⚙️', text: 'Processing...', disabled: true },
  exportIdle: { emoji: '📤', text: 'Export Markdown', disabled: false },
  copyIdle: { emoji: '📋', text: '', disabled: false },
  copySuccess: { emoji: '✅', text: '', disabled: false }
};

applyButton(startBtn, 'startIdle');
applyButton(stopBtn, 'stopIdle');
applyButton(enhanceBtn, 'enhanceIdle');
applyButton(exportBtn, 'exportIdle');
applyButton(copyBtn, 'copyIdle');

if (stepsContainer) {
  stepsContainer.addEventListener('click', onStepsClick);
}

if (startBtn) startBtn.addEventListener('click', async () => {
  applyButton(startBtn, 'startBusy');
  try {
    const contextValue = contextInput?.value || '';
    const result = await chrome.runtime.sendMessage({ 
      type: 'start_recording',
      context: contextValue
    });
    if (!result?.ok) throw new Error(result?.error || 'start_failed');
    showNotification('Recording started. Perform your workflow.', 'success');
  } catch (error) {
    console.error('start_recording failed', error);
    showNotification('Could not start recording.', 'error');
  } finally {
    await updateStateView();
  }
});

if (stopBtn) stopBtn.addEventListener('click', async () => {
  applyButton(stopBtn, 'stopBusy');
  try {
    await chrome.runtime.sendMessage({ type: 'stop_recording' });
    showNotification('Recording stopped.', 'info');
  } catch (error) {
    console.error('stop_recording failed', error);
    showNotification('Could not stop recording.', 'error');
  } finally {
    await updateStateView();
  }
});

if (enhanceBtn) enhanceBtn.addEventListener('click', async () => {
  applyButton(enhanceBtn, 'enhanceBusy');
  try {
    const summary = await runArticleEnhancer();
    const tone = summary.issues?.length ? 'warning' : 'success';
    showNotification(summary.message, tone);
    (summary.issues || []).forEach((issue) => {
      showNotification(issue, 'warning');
    });
  } catch (error) {
    console.error('article_enhance failed', error);
    showNotification(error.message || 'AI article generation failed.', 'error');
  } finally {
    applyButton(enhanceBtn, 'enhanceIdle');
    await updateStateView();
  }
});

if (exportBtn) exportBtn.addEventListener('click', async () => {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'generate_markdown' });
    if (res?.markdown) {
      output.value = res.markdown;
      showNotification('Markdown ready to copy.', 'success');
    }
  } catch (error) {
    console.error('generate_markdown failed', error);
    showNotification('Could not generate markdown.', 'error');
  }
});

if (exportPdfBtn) exportPdfBtn.addEventListener('click', async () => {
  try {
    const url = chrome.runtime.getURL('src/viewer.html');
    await chrome.tabs.create({ url, active: true });
    showNotification('Opening editor...', 'success');
  } catch (error) {
    console.error('open_viewer failed', error);
    showNotification('Could not open editor.', 'error');
  }
});

if (clearAllBtn) clearAllBtn.addEventListener('click', async () => {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'clear_all' });
    if (res?.ok) {
      output.value = '';
      if (contextInput) contextInput.value = '';
      showNotification('All steps cleared.', 'info');
    } else {
      showNotification(res?.error || 'Clear failed.', 'error');
    }
  } catch (error) {
    console.error('clear_all failed', error);
    showNotification('Could not clear steps.', 'error');
  } finally {
    await updateStateView();
  }
});

if (copyBtn) copyBtn.addEventListener('click', async () => {
  if (!output.value) {
    showNotification('There is nothing to copy yet.', 'warning');
    return;
  }
  try {
    await navigator.clipboard.writeText(output.value);
    applyButton(copyBtn, 'copySuccess');
    showNotification('Copied to clipboard.', 'success');
    setTimeout(() => applyButton(copyBtn, 'copyIdle'), 2000);
  } catch (error) {
    console.error('clipboard failed', error);
    showNotification('Clipboard action failed.', 'error');
  }
});

if (contextInput) contextInput.addEventListener('input', () => {
  persistContext(contextInput.value);
});

// Refresh runtime state.
async function updateStateView() {
  try {
    const state = await chrome.runtime.sendMessage({ type: 'get_state' });
    const { recording, stepCount = 0 } = state || {};
    if (statusEl) statusEl.classList.toggle('recording', !!recording);
    if (statusText) statusText.textContent = recording ? 'Recording...' : 'Ready';
    applyButton(startBtn, recording ? 'startBusy' : 'startIdle');
    applyButton(stopBtn, recording ? 'stopReady' : 'stopIdle');
    if (stepCountEl) stepCountEl.textContent = `${stepCount} ${stepCount === 1 ? 'step' : 'steps'}`;
    chrome.runtime.sendMessage({ type: 'set_recording', on: recording }).catch(() => {});
    await renderSteps();
  } catch (error) {
    console.error('state refresh failed', error);
  }
}

// Store the optional context in the current session.
async function persistContext(value) {
  try {
    const { sessions, currentSessionId } = await chrome.storage.local.get(['sessions', 'currentSessionId']);
    if (!sessions || !currentSessionId || !sessions[currentSessionId]) return;
    const nextValue = value || '';
    if (sessions[currentSessionId].articleContext === nextValue) return;
    sessions[currentSessionId].articleContext = nextValue;
    await chrome.storage.local.set({ sessions });
  } catch (error) {
    console.error('context persist failed', error);
  }
}

// Ensure every step carries at least a baseline AI description.
async function ensureStepDescriptions() {
  const { sessions, currentSessionId } = await chrome.storage.local.get(['sessions', 'currentSessionId']);
  const store = sessions || {};
  const current = store[currentSessionId];
  const steps = current?.steps || [];
  const pending = steps.filter((step) => !step.aiDescription);
  if (!pending.length) {
    return { described: 0, pending: 0, status: 'none' };
  }
  const summary = await attemptBackgroundDescriptions(pending);
  if (summary?.described) {
    // Background already updated storage, refresh local view on next sync.
    return {
      described: summary.described,
      pending: summary.pending ?? pending.length,
      status: 'background'
    };
  }

  const fallbackResult = await describeMissingLocally(pending);
  if (Array.isArray(current.steps)) {
    current.steps.forEach((step) => {
      if (step?.screenshotKey && step.screenshot) {
        delete step.screenshot;
      }
    });
  }
  store[currentSessionId] = current;
  await chrome.storage.local.set({ sessions: store });
  return {
    described: fallbackResult.count,
    pending: pending.length,
    status: fallbackResult.status
  };
}

// Build a full article draft (title, intro, rewritten steps, and issues).
async function runArticleEnhancer() {
  const ensureSummary = await ensureStepDescriptions();
  const { sessions, currentSessionId } = await chrome.storage.local.get(['sessions', 'currentSessionId']);
  const store = sessions || {};
  const current = store[currentSessionId];
  if (!current?.steps?.length) {
    throw new Error('Capture steps before using AI.');
  }

  const articleResult = await generateArticleDraft(current);
  if (!articleResult?.data) {
    throw new Error('AI could not build the article.');
  }

  const { data } = articleResult;
  if (data.title) current.articleTitle = data.title;
  if (data.introduction) current.articleIntroduction = data.introduction;

  if (Array.isArray(data.steps)) {
    data.steps.forEach((entry) => {
      const index = (entry.stepNumber ?? entry.number) - 1;
      if (!Number.isInteger(index) || index < 0) return;
      const step = current.steps[index];
      if (!step) return;
      if (entry.description) {
        step.aiDescription = entry.description;
      }
      if (entry.status) {
        step.aiStatus = entry.status;
      }
    });
  }

  const aiIssues = Array.isArray(data.issues) ? data.issues : [];
  const duplicateIssues = detectDuplicateSteps(current.steps);
  current.articleIssues = mergeIssues(aiIssues, duplicateIssues);

  store[currentSessionId] = current;
  await chrome.storage.local.set({ sessions: store });

  const markdown = await chrome.runtime.sendMessage({ type: 'generate_markdown' }).catch(() => null);
  if (markdown?.markdown) {
    output.value = markdown.markdown;
  }

  const issuesMessages = formatArticleIssues(current.articleIssues);
  const summaryMessage = buildArticleSummaryMessage(current, ensureSummary);
  return { message: summaryMessage, issues: issuesMessages };
}

async function generateArticleDraft(session) {
  const steps = session?.steps || [];
  if (!steps.length) {
    throw new Error('No steps to analyse.');
  }
  const prompt = buildArticlePrompt(session);
  const result = await callTextModel(prompt, ARTICLE_SYSTEM_PROMPT);
  if (!result.text) {
    const status = result.status || 'unavailable';
    if (status === 'unavailable' || status === 'no') {
      throw new Error('On-device AI is unavailable. Enable the Chrome Prompt API to generate articles.');
    }
    if (status === 'downloading') {
      throw new Error('Gemini Nano is downloading. Try again in a moment.');
    }
    throw new Error('AI could not build the article.');
  }
  const data = parseArticlePlan(result.text);
  if (!data) {
    throw new Error('AI response could not be parsed.');
  }
  return { data, status: result.status, raw: result.text };
}

function buildArticlePrompt(session) {
  const steps = session?.steps || [];
  const parts = [
    'You receive recorded steps from a SaaS workflow. Produce JSON with this shape:',
    '{',
    '  "title": "string",',
    '  "introduction": "string",',
    '  "steps": [ { "stepNumber": number, "description": "string", "status": "keep|review|remove" } ],',
    '  "issues": [ { "type": "duplicate_step|missing_context|note", "message": "string", "steps": [numbers] } ]',
    '}',
    'Guidelines:',
    '- Rewrite each step description so it is action-oriented and concise.',
    '- Flag any missing or repeated steps inside the issues array.',
    '- Use English only. Provide valid JSON without comments or extra text.'
  ];

  if (session?.articleContext) {
    parts.push('Additional context provided by the user or transcript:');
    parts.push(truncate(session.articleContext, 800));
  }

  steps.forEach((step, index) => {
    parts.push(`Step ${index + 1}:`);
    parts.push(`  Event: ${step.event || 'unknown'}`);
    parts.push(`  Selector: ${step.selector || 'n/a'}`);
    parts.push(`  Page title: ${step.title || 'n/a'}`);
    parts.push(`  URL: ${step.url || 'n/a'}`);
    const existing = step.manualCaption || step.aiDescription || buildContext(step) || 'none';
    parts.push(`  Existing description: ${truncate(existing, 200)}`);
  });

  return parts.join('\n');
}

function parseArticlePlan(text) {
  if (!text) return null;
  const jsonPayload = extractJsonPayload(text);
  if (!jsonPayload) return null;
  let data;
  try {
    data = JSON.parse(jsonPayload);
  } catch (error) {
    console.error('article JSON parse failed', error, jsonPayload);
    return null;
  }
  const title = sanitizeString(data.title);
  const introduction = sanitizeString(data.introduction || data.intro);
  const steps = Array.isArray(data.steps)
    ? data.steps.map((entry, idx) => ({
        stepNumber: Number.isFinite(Number(entry?.stepNumber)) ? Number(entry.stepNumber) : Number.isFinite(Number(entry?.number)) ? Number(entry.number) : idx + 1,
        description: sanitizeString(entry?.description || entry?.text),
        status: (sanitizeString(entry?.status) || '').toLowerCase()
      })).filter((entry) => entry.stepNumber && entry.description)
    : [];
  const issues = Array.isArray(data.issues) ? data.issues : [];
  return { title, introduction, steps, issues };
}

function extractJsonPayload(text) {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) return fence[1];
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}

function sanitizeString(value) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function normalizeIssueObject(issue) {
  if (!issue) return null;
  if (typeof issue === 'string') {
    return { type: 'note', message: issue.trim(), steps: [] };
  }
  const type = sanitizeString(issue.type || issue.category || 'note') || 'note';
  const message = sanitizeString(issue.message || issue.note || '');
  const rawSteps = Array.isArray(issue.steps)
    ? issue.steps
    : typeof issue.steps === 'string'
      ? issue.steps.split(/[\s,]+/)
      : [];
  const steps = (rawSteps || [])
    .map((n) => Number(n))
    .filter((n) => Number.isInteger(n) && n > 0);
  if (!message) {
    if (type === 'duplicate_step' && steps.length) {
      return { type, message: `Potential duplicate steps: ${steps.join(', ')}`, steps };
    }
    return null;
  }
  return { type, message, steps };
}

function mergeIssues(aiIssues, duplicateIssues) {
  const merged = [];
  const seen = new Set();
  const items = [...(aiIssues || []), ...(duplicateIssues || [])];
  items.forEach((issue) => {
    const normalized = normalizeIssueObject(issue);
    if (!normalized?.message) return;
    const key = `${normalized.type}|${normalized.message}`;
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(normalized);
  });
  return merged;
}

function detectDuplicateSteps(steps) {
  const issues = [];
  for (let index = 1; index < steps.length; index += 1) {
    const prev = steps[index - 1];
    const curr = steps[index];
    if (!prev || !curr) continue;
    const prevKey = `${prev.event || ''}|${prev.selector || ''}|${prev.url || ''}`;
    const currKey = `${curr.event || ''}|${curr.selector || ''}|${curr.url || ''}`;
    if (prevKey && prevKey === currKey) {
      const prevNumber = index;
      const currNumber = index + 1;
      issues.push({
        type: 'duplicate_step',
        message: `Steps ${prevNumber} and ${currNumber} appear to repeat the same action (${curr.event || 'interaction'}).`,
        steps: [prevNumber, currNumber]
      });
    }
  }
  return issues;
}

function formatArticleIssues(issues) {
  return (issues || [])
    .map((issue) => (typeof issue === 'string' ? issue : issue?.message))
    .filter(Boolean);
}

function buildArticleSummaryMessage(session, ensureSummary) {
  const title = session.articleTitle ? `“${session.articleTitle}”` : 'AI article draft';
  const parts = [`Article draft ready: ${title}`];
  if (ensureSummary?.described) {
    const plural = ensureSummary.described === 1 ? '' : 's';
    parts.push(`${ensureSummary.described} step description${plural} updated.`);
  }
  return parts.join(' · ');
}

// Try delegating description work to the background/offscreen context.
async function attemptBackgroundDescriptions(pending) {
  try {
    const summary = await chrome.runtime.sendMessage({ type: 'describe_all_images' });
    if (summary?.ok) {
      return summary;
    }
    if (summary?.error && !['no_ai_context', 'unknown_message_type'].includes(summary.error)) {
      throw new Error(summary.error);
    }
  } catch (error) {
    if (error.message && !['no_ai_context', 'unknown_message_type'].includes(error.message) && !error.message.includes('Receiving end does not exist')) {
      throw error;
    }
  }
  return { described: 0, pending: pending.length, status: 'fallback' };
}

// Render the captured cards.
async function renderSteps() {
  const container = document.getElementById('steps');
  if (!container) return;
  const { sessions, currentSessionId } = await chrome.storage.local.get(['sessions', 'currentSessionId']);
  const session = sessions?.[currentSessionId];
  if (session && contextInput && document.activeElement !== contextInput) {
    const nextValue = session.articleContext || '';
    if (contextInput.value !== nextValue) {
      contextInput.value = nextValue;
    }
  }
  const steps = session?.steps || [];
  if (!steps.length) {
    container.innerHTML = '';
    return;
  }
  const screenshotKeys = steps
    .filter((step) => step?.screenshotKey)
    .map((step) => step.screenshotKey);
  const screenshotStore = screenshotKeys.length
    ? await chrome.storage.session.get(screenshotKeys)
    : {};

  const markup = steps
    .map((step, index) => {
      const title = step.aiDescription || step.event || 'Step';
      const meta = step.selector || step.title || '';
      const stepId = String(step.id || index);
      const safeId = escapeHtml(stepId);
      const safeTitle = escapeHtml(title);
      const safeMeta = escapeHtml(meta);
      const shortTitle = safeTitle.length > 60 ? `${safeTitle.slice(0, 57)}...` : safeTitle;
      const ratio = step.viewport?.width && step.viewport?.height
        ? ` style="aspect-ratio: ${step.viewport.width} / ${step.viewport.height};"`
        : '';
      const overlays = buildOverlays(step);
      const imageSrc = step.screenshot || (step.screenshotKey && screenshotStore[step.screenshotKey]) || '';
      const imageMarkup = imageSrc
        ? `<img class="step-img" src="${imageSrc}" alt="Step ${index + 1}" />`
        : `<div class="step-placeholder">No screenshot available</div>`;
      return `
        <div class="step" data-id="${safeId}" data-step-id="${safeId}">
          <button type="button" class="step-action" data-step-id="${safeId}" title="Delete step">✕</button>
          <div class="step-h">
            <span style="color: var(--primary-600);">Step ${index + 1}</span>
            <span style="font-weight: 500;">${shortTitle}</span>
          </div>
          <div class="step-ov"${ratio}>
            ${imageMarkup}
            ${overlays}
          </div>
          <div class="step-meta" title="${safeMeta}">${safeMeta || 'No selector data'}</div>
        </div>
      `;
    })
    .join('');
  container.innerHTML = markup;
  container.querySelectorAll('.step-img').forEach((img) => {
    img.addEventListener('click', () => {
      const src = img.getAttribute('src');
      if (src) chrome.tabs.create({ url: src });
    });
  });
}

// Encode HTML entities.
function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Prepare overlay markers.
function buildOverlays(step) {
  const viewport = step?.viewport;
  if (!viewport?.width || !viewport?.height) return '';
  const pieces = [];
  if (Number.isFinite(step.point?.x) && Number.isFinite(step.point?.y)) {
    const left = percent(step.point.x, viewport.width);
    const top = percent(step.point.y, viewport.height);
    pieces.push(`<span class="marker" style="left:${left.toFixed(2)}%; top:${top.toFixed(2)}%;"></span>`);
  }
  if (
    Number.isFinite(step.rect?.x) &&
    Number.isFinite(step.rect?.y) &&
    Number.isFinite(step.rect?.width) &&
    Number.isFinite(step.rect?.height)
  ) {
    const left = percent(step.rect.x, viewport.width);
    const top = percent(step.rect.y, viewport.height);
    const width = percent(step.rect.width, viewport.width);
    const height = percent(step.rect.height, viewport.height);
    pieces.push(`<div class="rect" style="left:${left.toFixed(2)}%; top:${top.toFixed(2)}%; width:${width.toFixed(2)}%; height:${height.toFixed(2)}%;"></div>`);
  }
  return pieces.join('');
}

// Clamp ratio values.
function percent(value, total) {
  if (!total) return 0;
  const num = (Number(value) / Number(total)) * 100;
  if (!Number.isFinite(num)) return 0;
  return Math.min(100, Math.max(0, num));
}

// Handle actions within the steps grid.
async function onStepsClick(event) {
  const deleteButton = event.target.closest('.step-action');
  if (!deleteButton) return;
  const stepId = deleteButton.dataset.stepId;
  if (!stepId) return;
  deleteButton.disabled = true;
  try {
    await deleteStep(stepId);
  } finally {
    if (deleteButton.isConnected) deleteButton.disabled = false;
  }
}

// Remove a step by delegating to the background script.
async function deleteStep(stepId) {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'delete_step', stepId });
    if (!res?.ok) throw new Error(res?.error || 'delete_failed');
    showNotification('Step deleted.', 'info');
    await updateStateView();
  } catch (error) {
    console.error('delete_step failed', error);
    showNotification('Could not delete step.', 'error');
  }
}

// Generate missing descriptions with local AI fallback.
async function describeMissingLocally(pendingSteps) {
  if (!pendingSteps.length) return { count: 0, status: 'none' };
  let described = 0;
  let status = 'unavailable';
  const keys = pendingSteps.filter((step) => step?.screenshotKey).map((step) => step.screenshotKey);
  const cache = keys.length ? await chrome.storage.session.get(keys) : {};
  for (const step of pendingSteps) {
    const screenshot = step.screenshot || (step.screenshotKey && cache[step.screenshotKey]);
    if (!screenshot) continue;
    const result = await promptLanguageModel(screenshot, buildContext(step));
    if (result.status) status = result.status;
    if (result.text) {
      step.aiDescription = result.text;
      described += 1;
    }
  }
  return { count: described, status };
}

// Build minimal prompt context.
function buildContext(step) {
  const parts = [];
  if (step.event) parts.push(`Event: ${step.event}`);
  if (step.selector) parts.push(`Selector: ${step.selector}`);
  if (step.elementText) parts.push(`Text: ${truncate(step.elementText, 120)}`);
  if (step.value) parts.push(`Value: ${truncate(step.value, 120)}`);
  return parts.join(' | ');
}

// Safely shorten strings for prompts.
function truncate(value, limit) {
  const text = value || '';
  return text.length > limit ? `${text.slice(0, limit - 3)}...` : text;
}

// Call the on-device model if available (Prompt API with legacy fallback).
async function promptLanguageModel(dataUrl, contextText) {
  const prompt = buildPrompt(dataUrl, contextText);
  return callTextModel(prompt, STEP_SYSTEM_PROMPT);
}

function buildPrompt(dataUrl, contextText) {
  const truncated = dataUrl ? dataUrl.slice(0, 2048) : '';
  return [
    'You document SaaS user flows with short, instructional sentences.',
    `Context: ${contextText || 'User interaction with a SaaS app.'}`,
    'Describe the user action happening in this screenshot using one sentence in English.',
    truncated ? `Screenshot (data URL, truncated): ${truncated}` : ''
  ].filter(Boolean).join('\n');
}

async function callTextModel(prompt, systemPrompt) {
  const primary = await promptWithLanguageModel(prompt, systemPrompt);
  if (primary.text || primary.status === 'downloading') {
    return primary;
  }
  const legacy = await promptWithLegacyAPI(prompt, systemPrompt);
  if (legacy.text) return legacy;
  return primary.text ? primary : { text: null, status: primary.status || legacy.status || 'unavailable' };
}

async function promptWithLanguageModel(prompt, systemPrompt) {
  const api = globalThis.LanguageModel;
  if (!api?.create) {
    return { text: null, status: 'unavailable' };
  }

  const params = await api.params?.().catch(() => null);
  const options = {
    expectedInputs: [{ type: 'text', languages: ['en'] }],
    expectedOutputs: [{ type: 'text', languages: ['en'] }],
    temperature: params?.defaultTemperature ?? 1,
    topK: params?.defaultTopK ?? 3,
    initialPrompts: [
      {
        role: 'system',
        content: systemPrompt || STEP_SYSTEM_PROMPT
      }
    ]
  };

  const availability = await api.availability?.(options).catch(() => 'unavailable');
  const state = normalizeAvailability(availability);
  console.debug('Gemini Nano availability', state, availability);
  if (state === 'unavailable' || state === 'no') {
    return { text: null, status: state };
  }

  let status = state;
  const session = await api.create({
    ...options,
    monitor(monitor) {
      monitor.addEventListener('downloadprogress', (event) => {
        status = 'downloading';
        const percentage = Math.round((event.loaded || 0) * 100);
        console.debug('Gemini Nano download', `${percentage}%`);
      });
    }
  }).catch((error) => {
    console.error('LanguageModel.create failed', error);
    return null;
  });

  if (!session) {
    return { text: null, status: 'error' };
  }

  try {
    const response = await session.prompt(prompt).catch((error) => {
      console.error('LanguageModel.prompt failed', error);
      return null;
    });
    const text = typeof response === 'string' ? response.trim() : null;
    console.debug('Gemini Nano prompt result', { status, hasText: !!text });
    if (text) status = status === 'downloading' ? 'ready' : status || 'available';
    return { text, status: status || 'available' };
  } finally {
    session.destroy?.();
  }
}

async function promptWithLegacyAPI(prompt, systemPrompt) {
  try {
    const api = globalThis.ai;
    if (!api?.createTextSession) {
      return { text: null, status: 'unavailable' };
    }
    const availability = await api.canCreateTextSession?.();
    console.debug('Legacy AI availability', availability);
    if (availability && availability.available === 'no') {
      return { text: null, status: 'unavailable' };
    }
    const session = await api.createTextSession({
      systemPrompt: systemPrompt || STEP_SYSTEM_PROMPT
    });
    const response = await session.prompt(prompt);
    return { text: String(response || '').trim(), status: 'legacy' };
  } catch (error) {
    console.error('Legacy ai prompt failed', error);
    return { text: null, status: 'error' };
  }
}

function normalizeAvailability(value) {
  if (!value) return 'unavailable';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    if ('state' in value) return value.state;
    if ('availability' in value) return value.availability;
  }
  return 'available';
}

// Display a toast message.
function showNotification(message, type = 'info') {
  const toast = document.createElement('div');
  toast.textContent = message;
  Object.assign(toast.style, {
    position: 'fixed',
    top: '80px',
    right: '20px',
    background: type === 'success' ? 'var(--success-500)' : type === 'error' ? 'var(--danger-500)' : type === 'warning' ? 'var(--warning-500)' : 'var(--primary-500)',
    color: '#fff',
    padding: '12px 16px',
    borderRadius: '8px',
    boxShadow: 'var(--shadow-lg)',
    fontSize: '13px',
    fontWeight: '500',
    zIndex: '10000',
    animation: 'slideIn 0.3s ease-out',
    maxWidth: '300px'
  });
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'slideOut 0.3s ease-out';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// Helper to configure button UI.
function applyButton(button, key) {
  if (!button) return;
  const data = BUTTON_COPY[key];
  if (!data) return;
  button.disabled = data.disabled;
  button.innerHTML = data.text
    ? `<span class="btn-emoji" aria-hidden="true">${data.emoji}</span><span class="btn-label">${data.text}</span>`
    : `<span class="btn-emoji" aria-hidden="true">${data.emoji}</span>`;
}

updateStateView();

if (translateBtn) {
  translateBtn.addEventListener('click', () => {
    const isVisible = translationPanel.style.display !== 'none';
    translationPanel.style.display = isVisible ? 'none' : 'block';
  });
}

if (applyTranslateBtn) {
  applyTranslateBtn.addEventListener('click', async () => {
    const checkboxes = translationPanel.querySelectorAll('input[type="checkbox"]:checked');
    const languages = Array.from(checkboxes).map(cb => cb.value);
    
    if (languages.length === 0) {
      showToast('❌ Please select at least one language');
      return;
    }
    
    const markdown = output.value;
    if (!markdown || markdown.trim().length === 0) {
      showToast('❌ No content to translate. Generate documentation first.');
      return;
    }
    
    applyTranslateBtn.disabled = true;
    applyTranslateBtn.innerHTML = '<span class="btn-emoji">⏳</span><span>Translating...</span>';
    translationStatus.classList.add('active');
    translationStatus.innerHTML = '🔄 Starting translation...';
    
    const languageNames = {
      es: 'Spanish', fr: 'French', de: 'German',
      it: 'Italian', pt: 'Portuguese', ja: 'Japanese'
    };
    
    const translations = {};
    let successCount = 0;
    let failCount = 0;
    
    for (const lang of languages) {
      translationStatus.innerHTML = `🔄 Translating to ${languageNames[lang]}...`;
      
      try {
        const result = await chrome.runtime.sendMessage({
          type: 'translate_markdown',
          markdown,
          targetLanguage: lang,
          languageName: languageNames[lang]
        });
        
        if (result?.ok && result?.translated) {
          translations[lang] = {
            language: languageNames[lang],
            markdown: result.translated,
            timestamp: Date.now()
          };
          successCount++;
          translationStatus.innerHTML = `✅ ${languageNames[lang]} completed! (${successCount}/${languages.length})`;
          await new Promise(r => setTimeout(r, 500));
        } else {
          const errorMsg = result?.error || 'Translation failed';
          console.error(`Translation error for ${languageNames[lang]}:`, errorMsg);
          failCount++;
          translationStatus.innerHTML = `❌ ${languageNames[lang]} failed: ${errorMsg}`;
          await new Promise(r => setTimeout(r, 1500));
        }
      } catch (error) {
        console.error(`Translation to ${languageNames[lang]} failed:`, error);
        failCount++;
        translationStatus.innerHTML = `❌ ${languageNames[lang]} failed: ${error.message}`;
        await new Promise(r => setTimeout(r, 1500));
      }
    }
    
    if (successCount > 0) {
      await chrome.storage.local.set({ translations });
      translationStatus.innerHTML = `✅ ${successCount} translation(s) saved! ${failCount > 0 ? `(${failCount} failed)` : ''} Click "View Translations" to see them.`;
      renderTranslations();
    } else {
      translationStatus.innerHTML = `❌ All ${failCount} translation(s) failed. Check console for details.`;
    }
    
    applyTranslateBtn.disabled = false;
    applyTranslateBtn.innerHTML = '<span class="btn-emoji">✨</span><span>Translate Documentation</span>';
  });
}

async function renderTranslations() {
  const data = await chrome.storage.local.get('translations');
  const translations = data.translations || {};
  const langCount = Object.keys(translations).length;
  
  if (langCount > 0) {
    translationStatus.classList.add('active');
    translationStatus.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span>📚 ${langCount} translation(s) available</span>
        <button id="viewTranslationsBtn" style="background: var(--primary-500); color: white; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 12px;">
          View Translations
        </button>
      </div>
    `;
    
    document.getElementById('viewTranslationsBtn')?.addEventListener('click', () => {
      showTranslationsModal(translations);
    });
  }
}

function showTranslationsModal(translations) {
  const modal = document.createElement('div');
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.8);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
    padding: 20px;
  `;
  
  const content = document.createElement('div');
  content.style.cssText = `
    background: white;
    border-radius: 16px;
    padding: 24px;
    max-width: 500px;
    width: 100%;
    max-height: 80vh;
    overflow-y: auto;
  `;
  
  const flags = {
    es: '🇪🇸', fr: '🇫🇷', de: '🇩🇪',
    it: '🇮🇹', pt: '🇵🇹', ja: '🇯🇵'
  };
  
  let html = '<h2 style="margin-bottom: 16px; color: #111827;">🌍 Available Translations</h2>';
  
  for (const [code, data] of Object.entries(translations)) {
    html += `
      <div style="margin-bottom: 12px; padding: 12px; background: #f3f4f6; border-radius: 8px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <strong style="color: #374151;">${flags[code] || '🌍'} ${data.language}</strong>
          <div style="display: flex; gap: 8px;">
            <button class="copy-trans-btn" data-code="${code}" style="background: #6366f1; color: white; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 600;">
              📋 Copy
            </button>
            <button class="download-trans-btn" data-code="${code}" style="background: #10b981; color: white; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 600;">
              💾 Download
            </button>
          </div>
        </div>
        <div style="font-size: 12px; color: #6b7280;">
          ${new Date(data.timestamp).toLocaleString()}
        </div>
      </div>
    `;
  }
  
  html += `
    <button id="closeModalBtn" style="width: 100%; background: #ef4444; color: white; border: none; padding: 12px; border-radius: 8px; cursor: pointer; font-weight: 600; margin-top: 16px;">
      Close
    </button>
  `;
  
  content.innerHTML = html;
  modal.appendChild(content);
  document.body.appendChild(modal);
  
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });
  
  document.getElementById('closeModalBtn').addEventListener('click', () => modal.remove());
  
  content.querySelectorAll('.copy-trans-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const code = btn.dataset.code;
      const markdown = translations[code].markdown;
      await navigator.clipboard.writeText(markdown);
      btn.textContent = '✅ Copied!';
      setTimeout(() => btn.innerHTML = '📋 Copy', 2000);
    });
  });
  
  content.querySelectorAll('.download-trans-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const code = btn.dataset.code;
      const data = translations[code];
      const blob = new Blob([data.markdown], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `docuflow-${data.language.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.md`;
      a.click();
      URL.revokeObjectURL(url);
    });
  });
}

renderTranslations();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.sessions || changes.currentSessionId)) {
    renderSteps();
    updateStateView();
  }
});
