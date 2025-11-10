// ===== ChatGPT/Gemini Markdown Exporter v3.0 =====
// 基于复制按钮 + iframe(srcdoc) 渲染，完全避免 DOM/CSS 污染

(function () {
  const log = (...args) => console.log('[MD-Exporter]', ...args);

  let userSettings = { language: 'en', font: 'SimHei' };

  async function loadSettings() {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      const stored = await chrome.storage.sync.get({ language: 'en', font: 'SimHei' });
      userSettings = stored;
      log('✅ Settings loaded:', userSettings);
    }
  }

  const i18n = {
    en: { exportPdf: 'Export as PDF', exportPng: 'Export as PNG', exportFailed: 'Export failed', noMarkdown: 'Failed to get Markdown', noCopyButton: 'Copy button not found' },
    zh_CN: { exportPdf: '导出为 PDF', exportPng: '导出为 PNG', exportFailed: '导出失败', noMarkdown: '无法获取 Markdown', noCopyButton: '未找到复制按钮' }
  };

  function t(key) {
    const lang = userSettings.language || 'en';
    return (i18n[lang] && i18n[lang][key]) || i18n.en[key] || key;
  }

  let libsReady = false;
  async function ensureLibs() {
    if (libsReady) return;
    const h2c = !!window.html2canvas;
    const jsPdf = !!(window.jspdf?.jsPDF || window.jsPDF);
    log('📚 Libraries:', { html2canvas: h2c, jsPDF: jsPdf });
    if (!h2c) throw new Error('html2canvas 不可用');
    if (!jsPdf) throw new Error('jsPDF 不可用');
    libsReady = true;
  }

  function buildPdfName(md, { maxLen = 40, prefix = 'chat' } = {}) {
    let title = '';
    const m = md.match(/^\s*#+\s+(.+?)\s*$/m);
    if (m) title = m[1].trim();
    if (!title) title = md.replace(/\s+/g, ' ').trim().slice(0, maxLen);
    title = (title || '导出').replace(/[\\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').slice(0, maxLen);
    const date = new Date().toISOString().slice(0, 10);
    return `${prefix}-${title}-${date}.pdf`;
  }

  function mdToHtml(md) {
    const esc = s => s.replace(/[&<>]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[m]));
    let html = md
      .replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => `<pre><code class="language-${lang}">${esc(code)}</code></pre>`)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/^#### (.*?)$/gm, '<h4>$1</h4>')
      .replace(/^### (.*?)$/gm, '<h3>$1</h3>')
      .replace(/^## (.*?)$/gm, '<h2>$1</h2>')
      .replace(/^# (.*?)$/gm, '<h1>$1</h1>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
      .replace(/^\* (.*?)$/gm, '<li>$1</li>')
      .replace(/^\d+\. (.*?)$/gm, '<li>$1</li>')
      .replace(/^> (.*?)$/gm, '<blockquote>$1</blockquote>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>');
    return `<div class="md">${html}</div>`;
  }

  async function renderMarkdownToCanvas(md) {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-same-origin');
    iframe.style.cssText = 'position:fixed;left:-99999px;top:0;width:900px;height:10px;visibility:hidden;border:none;';
    
    const font = `"${userSettings.font}", "Microsoft YaHei", "SimHei", sans-serif`;
    const style = `<style>:root{color-scheme:light !important}*{margin:0;padding:0;box-sizing:border-box}html,body{margin:0;padding:0;background:#fff !important;color:#000 !important}body{font:14px/1.6 ${font};color:#111 !important;padding:24px;max-width:800px;background:#fff !important}.md,.md *{color:#000 !important}h1,h2,h3,h4{margin:1.2em 0 .5em;font-weight:600;color:#000 !important}h1{font-size:22px}h2{font-size:18px}h3{font-size:16px}h4{font-size:14px}code{background:#f6f8fa !important;color:#000 !important;border:1px solid #d0d7de;border-radius:4px;padding:0 .3em;font-family:Consolas,Monaco,monospace}pre{background:#f6f8fa !important;color:#000 !important;border:1px solid #d0d7de;padding:12px;border-radius:8px;overflow:auto;margin:1em 0}pre code{background:none !important;border:none;padding:0}ul,ol{padding-left:1.4em;margin:1em 0}li{margin:.3em 0}blockquote{border-left:4px solid #ddd;margin:1em 0;padding:.5em 1em;color:#444 !important;background:#fafafa !important;border-radius:4px}table{border-collapse:collapse;width:100%;margin:1em 0}th,td{border:1px solid #ddd;padding:6px 8px}th{background:#f6f8fa !important;font-weight:600}p{margin:1em 0}a{color:#1a73e8;text-decoration:none}a:hover{text-decoration:underline}img{max-width:100%;height:auto}strong{font-weight:600}</style>`;
    
    iframe.srcdoc = `<!DOCTYPE html><html><head><meta charset="utf-8">${style}</head><body>${mdToHtml(md)}</body></html>`;
    document.documentElement.appendChild(iframe);

    await new Promise(r => iframe.onload = r);
    const doc = iframe.contentDocument;
    const body = doc.body;
    const height = Math.max(body.scrollHeight, body.offsetHeight, body.clientHeight);
    iframe.style.height = height + 'px';

    if (doc.fonts?.ready) { try { await doc.fonts.ready; } catch (e) {} }
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    if (!window.html2canvas) throw new Error('html2canvas 不可用');
    const canvas = await window.html2canvas(body, {
      backgroundColor: '#ffffff', scale: 2, useCORS: true, allowTaint: true,
      imageTimeout: 2000, logging: false, windowWidth: body.scrollWidth, windowHeight: body.scrollHeight
    });

    iframe.remove();
    if (!canvas || canvas.width === 0 || canvas.height === 0) throw new Error('canvas 尺寸为 0');
    return canvas;
  }

  function saveCanvasAsPdf(canvas, filename) {
    const jsPDF = window.jspdf?.jsPDF || window.jsPDF;
    if (!jsPDF) throw new Error('jsPDF 不可用');
    const pdf = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
    const a4w = 595.28, a4h = 841.89, ratio = a4w / canvas.width, totalH = Math.max(canvas.height, 10);
    let y = 0, page = 0;
    while (y < totalH) {
      const sliceH = Math.min(totalH - y, Math.floor(a4h / ratio));
      const pg = document.createElement('canvas');
      pg.width = canvas.width; pg.height = sliceH;
      const ctx = pg.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, pg.width, pg.height);
      ctx.drawImage(canvas, 0, y, canvas.width, sliceH, 0, 0, pg.width, pg.height);
      const img = pg.toDataURL('image/jpeg', 0.92);
      if (page++) pdf.addPage();
      pdf.addImage(img, 'JPEG', 0, 0, a4w, sliceH * ratio);
      y += sliceH;
    }
    pdf.save(filename);
    log('✅ PDF 保存:', filename);
  }

  function saveCanvasAsPng(canvas, filename) {
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = filename.replace(/\.pdf$/i, '.png');
    a.click();
    log('✅ PNG 保存:', filename);
  }

  function findCopyButton(msgEl) {
    if (!msgEl) return null;
    let btn = msgEl.querySelector('[data-testid="copy-turn-action-button"]');
    if (btn) return btn;
    btn = msgEl.querySelector('button[aria-label*="复制"],button[aria-label*="Copy"]');
    if (btn) return btn;
    btn = msgEl.querySelector('[data-tooltip*="复制"],[data-tooltip*="Copy"],[title*="复制"],[title*="Copy"]');
    if (btn) return btn;
    const btns = Array.from(msgEl.querySelectorAll('button'));
    for (const b of btns) {
      const text = (b.textContent || b.getAttribute('aria-label') || '').toLowerCase();
      if (text.includes('copy') || text.includes('复制')) return b;
    }
    return null;
  }

  function waitClipboard(timeoutMs = 1500) {
    return new Promise((resolve) => {
      let done = false;
      const onCopy = (e) => {
        try {
          done = true;
          document.removeEventListener('copy', onCopy, true);
          const md = e.clipboardData?.getData('text/markdown') || e.clipboardData?.getData('text/plain') || '';
          resolve(md);
        } catch (err) { resolve(''); }
      };
      document.addEventListener('copy', onCopy, true);
      setTimeout(() => {
        if (done) return;
        document.removeEventListener('copy', onCopy, true);
        resolve('');
      }, timeoutMs);
    });
  }

  async function getMarkdown(msgEl) {
    const btn = findCopyButton(msgEl);
    if (!btn) throw new Error(t('noCopyButton'));
    const promise = waitClipboard(2000);
    btn.click();
    let md = await promise;
    if (!md) {
      try { md = await navigator.clipboard.readText(); } catch (_) {}
    }
    if (!md || !md.trim()) throw new Error(t('noMarkdown'));
    return md;
  }

  async function exportToPdf(md, provider = 'chat') {
    await ensureLibs();
    log('🎨 渲染 Markdown，长度:', md.length);
    const canvas = await renderMarkdownToCanvas(md);
    log('✅ 渲染完成:', canvas.width, 'x', canvas.height);
    saveCanvasAsPdf(canvas, buildPdfName(md, { prefix: provider }));
  }

  async function exportToPng(md, provider = 'chat') {
    await ensureLibs();
    log('🎨 渲染 Markdown，长度:', md.length);
    const canvas = await renderMarkdownToCanvas(md);
    log('✅ 渲染完成:', canvas.width, 'x', canvas.height);
    saveCanvasAsPng(canvas, buildPdfName(md, { prefix: provider }));
  }

  function isComplete(msgEl) {
    if (!msgEl) return false;
    if (msgEl.querySelector('[data-testid="loading"],.result-streaming,.typing,.animate-pulse')) return false;
    return !!(msgEl.innerText || '').trim();
  }

  function isSettled(turn) {
    const typing = turn.querySelector('[data-testid="bot-typing"],.result-streaming');
    const stop = document.querySelector('button[aria-label*="Stop"]');
    if (!typing && !stop) return true;
    return !document.querySelector('[role="progressbar"],.is-streaming');
  }

  async function waitSettled(turn, { quietMs = 400, timeoutMs = 6000 } = {}) {
    const t0 = Date.now();
    let lastLen = -1;
    return new Promise((resolve) => {
      const tick = () => {
        if (isSettled(turn)) return resolve(true);
        const len = (turn.innerText || '').trim().length;
        if (len > 0 && len === lastLen) return resolve(true);
        lastLen = len;
        if (Date.now() - t0 > timeoutMs) return resolve(true);
        setTimeout(tick, quietMs);
      };
      tick();
    });
  }

  async function onExportPdf(msgEl, provider) {
    try {
      if (!isComplete(msgEl)) {
        log('⚠️ 等待消息完成...');
        await waitSettled(msgEl);
      }
      log('🔄 获取 Markdown...');
      const md = await getMarkdown(msgEl);
      log('✅ Markdown 长度:', md.length);
      await exportToPdf(md, provider);
    } catch (err) {
      log('❌ 失败:', err);
      alert(t('exportFailed') + ': ' + (err?.message || err));
    }
  }

  async function onExportPng(msgEl, provider) {
    try {
      if (!isComplete(msgEl)) {
        log('⚠️ 等待消息完成...');
        await waitSettled(msgEl);
      }
      log('🔄 获取 Markdown...');
      const md = await getMarkdown(msgEl);
      log('✅ Markdown 长度:', md.length);
      await exportToPng(md, provider);
    } catch (err) {
      log('❌ 失败:', err);
      alert(t('exportFailed') + ': ' + (err?.message || err));
    }
  }

  function getTurn(node) {
    let t = node.closest('.agent-turn');
    if (t) return t;
    let cur = node;
    for (let i = 0; i < 6 && cur; i++) {
      if (cur.querySelector && cur.querySelector('button[aria-haspopup="menu"]')) return cur;
      cur = cur.parentElement;
    }
    return node;
  }

  function findMore(turn) {
    if (!turn) return null;
    let btns = Array.from(turn.querySelectorAll('button[aria-haspopup="menu"]'));
    if (btns.length) return btns[btns.length - 1];
    btns = Array.from(turn.querySelectorAll('button[aria-label*="More"],button[aria-label*="更多"]'));
    if (btns.length) return btns[btns.length - 1];
    btns = Array.from(turn.querySelectorAll('button[id^="radix-"]')).filter(b => b.querySelector('svg'));
    return btns[btns.length - 1] || null;
  }

  function attachMenu(msgRoot, provider) {
    const turn = getTurn(msgRoot);
    if (!turn || turn._mdx) return;
    turn._mdx = true;
    const more = findMore(turn);
    if (!more) {
      log('⚠️ 未找到省略号按钮');
      return;
    }
    log('✅ 绑定菜单');
    more.addEventListener('click', async () => {
      if (!isSettled(turn)) await waitSettled(turn);
      setTimeout(() => {
        const menus = Array.from(document.querySelectorAll('[role="menu"]')).filter(m => m.offsetParent);
        if (!menus.length) {
          log('⚠️ 未找到菜单');
          return;
        }
        const menu = menus[menus.length - 1];
        if (menu.querySelector('.mdx-group')) return;
        log('📝 注入菜单项');
        const group = document.createElement('div');
        group.className = 'mdx-group';
        group.innerHTML = `
          <div class="mdx-item" data-mdx="pdf" role="menuitem" tabindex="0">${t('exportPdf')}</div>
          <div class="mdx-item" data-mdx="png" role="menuitem" tabindex="0">${t('exportPng')}</div>
        `;
        menu.appendChild(group);
        group.addEventListener('click', async (e) => {
          const item = e.target.closest('.mdx-item');
          if (!item) return;
          const action = item.dataset.mdx;
          const msg = getTurn(turn);
          if (action === 'pdf') await onExportPdf(msg, provider);
          else if (action === 'png') await onExportPng(msg, provider);
        });
      }, 40);
    });
  }

  function detectProvider() {
    const host = location.hostname;
    if (/chatgpt\.com|chat\.openai\.com/.test(host)) return 'gpt';
    if (/gemini\.google\.com|aistudio\.google\.com/.test(host)) return 'gemini';
    return null;
  }

  function scan(provider) {
    let count = 0;
    if (provider === 'gpt') {
      const nodes = document.querySelectorAll('[data-message-author-role="assistant"][data-message-id]');
      log('GPT 扫描:', nodes.length);
      nodes.forEach(n => { attachMenu(n, 'gpt'); count++; });
    } else if (provider === 'gemini') {
      const nodes = document.querySelectorAll('.presented-response-container');
      log('Gemini 扫描:', nodes.length);
      nodes.forEach(n => { attachMenu(n, 'gemini'); count++; });
    }
    log('📊 扫描:', { provider, count });
  }

  function injectStyles() {
    if (document.getElementById('mdx-style')) return;
    const style = document.createElement('style');
    style.id = 'mdx-style';
    style.textContent = `.mdx-group{border-top:1px solid var(--gray-6,rgba(255,255,255,0.08));margin-top:4px;padding-top:4px}.mdx-item{padding:6px 10px;border-radius:6px;cursor:pointer;outline:none !important}.mdx-item:hover,.mdx-item:focus{background:rgba(255,255,255,0.06)}.mdx-item:focus{box-shadow:none !important}`;
    document.documentElement.appendChild(style);
    log('✅ 样式注入');
  }

  async function boot() {
    const provider = detectProvider();
    log('🚀 启动');
    log('📍 Provider:', provider, '| Host:', location.hostname);
    await loadSettings();
    injectStyles();
    if (!provider) {
      log('⚠️ 未识别平台');
      return;
    }
    log('🔍 初始扫描');
    scan(provider);
    log('👀 监听 DOM');
    const obs = new MutationObserver(() => scan(provider));
    obs.observe(document.documentElement, { subtree: true, childList: true });
    log('⏰ 备份扫描');
    let tries = 0;
    const timer = setInterval(() => {
      scan(provider);
      if (++tries >= 5) {
        clearInterval(timer);
        log('✅ 备份扫描完成');
      }
    }, 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.__MD_EXPORTER = {
    log,
    detectProvider,
    scan: () => scan(detectProvider()),
    test: async (md) => {
      await ensureLibs();
      await exportToPdf(md || '# Test\n\nHello World!', 'test');
    }
  };
  log('💡 已加载。调试: window.__MD_EXPORTER');
})();
