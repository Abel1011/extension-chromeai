const markdownEditor = document.getElementById('markdownEditor');
const markdownPreview = document.getElementById('markdownPreview');
const printBtn = document.getElementById('printBtn');
const copyBtn = document.getElementById('copyBtn');
const downloadBtn = document.getElementById('downloadBtn');
const translateBtn = document.getElementById('translateBtn');
const translationSection = document.getElementById('translationSection');
const startTranslateBtn = document.getElementById('startTranslateBtn');
const translationResults = document.getElementById('translationResults');

const languageNames = {
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  it: 'Italian',
  pt: 'Portuguese',
  ja: 'Japanese',
  zh: 'Chinese'
};

async function loadMarkdown() {
  try {
    const result = await chrome.runtime.sendMessage({ type: 'generate_markdown' });
    if (result?.markdown) {
      markdownEditor.value = result.markdown;
      updatePreview();
    }
  } catch (error) {
    console.error('Failed to load markdown', error);
    markdownEditor.value = '# Error loading content\n\nCould not load markdown from extension.';
    updatePreview();
  }
}

function updatePreview() {
  const markdown = markdownEditor.value;
  markdownPreview.innerHTML = parseMarkdown(markdown);
}

function parseMarkdown(markdown) {
  let html = markdown;
  
  html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" />');
  
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  
  html = html.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');
  
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/_(.+?)_/g, '<em>$1</em>');
  
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  
  html = html.replace(/^---$/gm, '<hr />');
  
  const lines = html.split('\n');
  let inList = false;
  let inOrderedList = false;
  let result = [];
  
  for (let line of lines) {
    if (line.match(/^\d+\.\s/)) {
      if (!inOrderedList) {
        result.push('<ol>');
        inOrderedList = true;
      }
      result.push('<li>' + line.replace(/^\d+\.\s/, '') + '</li>');
    } else if (line.match(/^[-*]\s/)) {
      if (!inList) {
        result.push('<ul>');
        inList = true;
      }
      result.push('<li>' + line.replace(/^[-*]\s/, '') + '</li>');
    } else {
      if (inList) {
        result.push('</ul>');
        inList = false;
      }
      if (inOrderedList) {
        result.push('</ol>');
        inOrderedList = false;
      }
      
      if (line.trim() && !line.match(/^<(h[1-6]|blockquote|hr)/)) {
        result.push('<p>' + line + '</p>');
      } else {
        result.push(line);
      }
    }
  }
  
  if (inList) result.push('</ul>');
  if (inOrderedList) result.push('</ol>');
  
  return result.join('\n');
}

if (markdownEditor) {
  markdownEditor.addEventListener('input', () => {
    updatePreview();
  });
}

if (printBtn) {
  printBtn.addEventListener('click', () => {
    window.print();
  });
}

if (copyBtn) {
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(markdownEditor.value);
      const originalText = copyBtn.innerHTML;
      copyBtn.innerHTML = '<span>✅</span><span>Copied!</span>';
      setTimeout(() => {
        copyBtn.innerHTML = originalText;
      }, 2000);
    } catch (error) {
      console.error('Copy failed', error);
      alert('Failed to copy to clipboard');
    }
  });
}

if (downloadBtn) {
  downloadBtn.addEventListener('click', () => {
    const markdown = markdownEditor.value;
    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `docuflow-${new Date().toISOString().slice(0, 10)}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });
}

if (translateBtn) {
  translateBtn.addEventListener('click', () => {
    const isVisible = translationSection.style.display !== 'none';
    translationSection.style.display = isVisible ? 'none' : 'block';
  });
}

if (startTranslateBtn) {
  startTranslateBtn.addEventListener('click', async () => {
    const checkboxes = document.querySelectorAll('.language-selector input[type="checkbox"]:checked');
    const languages = Array.from(checkboxes).map(cb => cb.value);
    
    if (languages.length === 0) {
      alert('Please select at least one language');
      return;
    }
    
    startTranslateBtn.disabled = true;
    startTranslateBtn.textContent = 'Translating...';
    translationResults.innerHTML = '';
    
    const markdown = markdownEditor.value;
    
    for (const lang of languages) {
      await translateToLanguage(lang, markdown);
    }
    
    startTranslateBtn.disabled = false;
    startTranslateBtn.textContent = 'Start Translation';
  });
}

async function translateToLanguage(langCode, markdown) {
  const langName = languageNames[langCode];
  const itemId = `translation-${langCode}`;
  
  const itemDiv = document.createElement('div');
  itemDiv.className = 'translation-item';
  itemDiv.id = itemId;
  
  itemDiv.innerHTML = `
    <div class="translation-item-header">
      <div class="translation-item-title">
        <span>${getFlagEmoji(langCode)}</span>
        <span>${langName}</span>
        <span class="translation-status">⏳ Translating...</span>
      </div>
      <span class="translation-item-toggle">🔽</span>
    </div>
    <div class="translation-item-content">
      <div class="markdown-preview" id="preview-${langCode}">
        <p style="color: #9ca3af;">Translation in progress...</p>
      </div>
    </div>
    <div class="translation-item-actions">
      <button class="translation-action-btn" data-action="copy" data-lang="${langCode}">
        <span>📋</span>
        <span>Copy</span>
      </button>
      <button class="translation-action-btn" data-action="download" data-lang="${langCode}">
        <span>💾</span>
        <span>Download</span>
      </button>
    </div>
  `;
  
  translationResults.appendChild(itemDiv);
  
  const header = itemDiv.querySelector('.translation-item-header');
  header.addEventListener('click', () => {
    itemDiv.classList.toggle('collapsed');
  });
  
  try {
    const result = await chrome.runtime.sendMessage({
      type: 'translate_markdown',
      markdown,
      targetLanguage: langCode,
      languageName: langName
    });
    
    if (result?.ok && result?.translated) {
      const preview = document.getElementById(`preview-${langCode}`);
      preview.innerHTML = parseMarkdown(result.translated);
      preview.dataset.markdown = result.translated;
      
      const status = itemDiv.querySelector('.translation-status');
      status.innerHTML = '✅ Complete';
      status.style.color = 'var(--success-500)';
    } else {
      throw new Error(result?.error || 'Translation failed');
    }
  } catch (error) {
    console.error(`Translation to ${langName} failed:`, error);
    const preview = document.getElementById(`preview-${langCode}`);
    const errorMsg = error.message || 'Translation failed';
    preview.innerHTML = `<p style="color: #ef4444;">❌ ${errorMsg}</p>`;
    
    const status = itemDiv.querySelector('.translation-status');
    status.innerHTML = '❌ Failed';
    status.style.color = '#ef4444';
  }
}

function getFlagEmoji(langCode) {
  const flags = {
    es: '🇪🇸',
    fr: '🇫🇷',
    de: '🇩🇪',
    it: '🇮🇹',
    pt: '🇵🇹',
    ja: '🇯🇵',
    zh: '🇨🇳'
  };
  return flags[langCode] || '🌍';
}

translationResults.addEventListener('click', (e) => {
  const btn = e.target.closest('.translation-action-btn');
  if (!btn) return;
  
  const action = btn.dataset.action;
  const lang = btn.dataset.lang;
  const preview = document.getElementById(`preview-${lang}`);
  const markdown = preview?.dataset?.markdown;
  
  if (!markdown) return;
  
  if (action === 'copy') {
    navigator.clipboard.writeText(markdown).then(() => {
      const originalText = btn.innerHTML;
      btn.innerHTML = '<span>✅</span><span>Copied!</span>';
      setTimeout(() => {
        btn.innerHTML = originalText;
      }, 2000);
    });
  } else if (action === 'download') {
    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `docuflow-${languageNames[lang].toLowerCase()}-${new Date().toISOString().slice(0, 10)}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
});

loadMarkdown();
