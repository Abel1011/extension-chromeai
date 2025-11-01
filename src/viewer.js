const markdownEditor = document.getElementById('markdownEditor');
const markdownPreview = document.getElementById('markdownPreview');
const printBtn = document.getElementById('printBtn');
const copyBtn = document.getElementById('copyBtn');
const downloadBtn = document.getElementById('downloadBtn');

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

loadMarkdown();
