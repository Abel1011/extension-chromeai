let mediaStream = null;
let recorder = null;
let chunks = [];
let recording = false;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    switch (msg?.type) {
      case 'audio_start':
        try {
          await startRecording();
          sendResponse({ ok: true });
        } catch (error) {
          sendResponse({ ok: false, error: 'permission_denied' });
        }
        break;
      case 'audio_stop':
        await stopRecording();
        const transcript = await transcribeAudio();
        sendResponse({ ok: true, transcript });
        break;
      case 'ai_describe': {
        const text = await describeImage(msg.image, msg.context).catch(() => null);
        sendResponse({ ok: !!text, text });
        break;
      }
      case 'ai_translate': {
        try {
          const translated = await translateText(msg.markdown, msg.targetLanguage, msg.languageName);
          sendResponse({ ok: true, translated });
        } catch (e) {
          console.error('Translation error in offscreen:', e);
          sendResponse({ ok: false, error: e.message });
        }
        break;
      }
      case 'audio_get': {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        const b64 = await blobToDataURL(blob);
        sendResponse({ ok: true, dataUrl: b64 });
        break;
      }
      case 'audio_clear':
        chunks = [];
        sendResponse({ ok: true });
        break;
    }
  })();
  return true;
});

async function startRecording() {
  if (recording) return;
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recorder = new MediaRecorder(mediaStream, { mimeType: 'audio/webm' });
    chunks = [];
    recorder.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
    recorder.start(1000);
    recording = true;
  } catch (error) {
    console.error('getUserMedia failed', error);
    throw error;
  }
}

async function stopRecording() {
  if (!recording) return;
  recorder.stop();
  mediaStream.getTracks().forEach(t => t.stop());
  recording = false;
}

// Convert recorded audio chunks into transcript text.
async function transcribeAudio() {
  if (!chunks.length) return '';
  try {
    const blob = new Blob(chunks, { type: 'audio/webm' });
    const dataUrl = await blobToDataURL(blob);
    const prompt = [
      'You convert spoken audio into accurate English transcripts.',
      'Transcribe the following WebM audio provided as a base64 data URL. Respond with the verbatim transcript in English.',
      `Audio: ${dataUrl.slice(0, 8000)}`
    ].join('\n');
    const text = await runTextPrompt(prompt, 'You are an expert transcription assistant. Output only the English transcript without extra commentary.');
    return text || '';
  } catch (error) {
    console.error('audio transcription failed', error);
    return '';
  } finally {
    chunks = [];
  }
}

// Ask the prompt API to process a text instruction.
async function runTextPrompt(prompt, systemPrompt) {
  try {
    if (globalThis.LanguageModel?.create) {
      const session = await globalThis.LanguageModel.create({
        expectedInputs: [{ type: 'text', languages: ['en'] }],
        expectedOutputs: [{ type: 'text', languages: ['en'] }],
        initialPrompts: [{ role: 'system', content: systemPrompt }]
      }).catch((error) => {
        console.error('LanguageModel.create failed', error);
        return null;
      });
      if (session) {
        try {
          const response = await session.prompt(prompt).catch((error) => {
            console.error('LanguageModel.prompt failed', error);
            return null;
          });
          const text = typeof response === 'string' ? response.trim() : '';
          if (text) return text;
        } finally {
          session.destroy?.();
        }
      }
    }
    if (self.ai?.canCreateTextSession) {
      const availability = await self.ai?.canCreateTextSession?.();
      if (availability && availability.available === 'no') return '';
    }
    if (self.ai?.createTextSession) {
      const session = await self.ai.createTextSession({ systemPrompt });
      const response = await session.prompt(prompt);
      const text = String(response || '').trim();
      if (text) return text;
    }
  } catch (error) {
    console.error('runTextPrompt failed', error);
  }
  return '';
}

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// AI helper (runs in offscreen page)
async function describeImage(dataUrl, contextText) {
  try {
    if (!('ai' in self) || !self.ai?.createTextSession) return null;
    const can = await self.ai.canCreateTextSession?.();
    if (can && can.available === 'no') return null;
    const session = await self.ai.createTextSession({
      systemPrompt: 'You generate concise, professional documentation steps for SaaS tutorials using screenshots and context. Respond with one sentence per step in English.'
    });
    const prompt = `Analyze the capture and craft one clear sentence describing the user action. Context: ${contextText || ''}. Image (data URL, truncated): ${dataUrl.slice(0, 256)}...`;
    const res = await session.prompt(prompt);
    return String(res).trim();
  } catch (e) {
    return null;
  }
}

async function translateText(markdown, targetLang, languageName) {
  try {
    if (!self.translation?.canTranslate) {
      throw new Error('Translation API not available');
    }
    
    const availability = await self.translation.canTranslate({
      sourceLanguage: 'en',
      targetLanguage: targetLang
    });
    
    if (availability === 'no') {
      throw new Error(`Translation to ${languageName} not available`);
    }
    
    const translator = await self.translation.createTranslator({
      sourceLanguage: 'en',
      targetLanguage: targetLang
    });
    
    if (availability === 'after-download') {
      translator.addEventListener('downloadprogress', (e) => {
        console.log(`Translation model download: ${e.loaded}/${e.total}`);
      });
      await translator.ready;
    }
    
    const translated = await translator.translate(markdown);
    return translated;
  } catch (e) {
    console.error('Translation failed:', e);
    throw e;
  }
}
