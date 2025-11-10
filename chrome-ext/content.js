/* ChatMarkdown To PDF v3.1 - 整合版 */
(() => {
  'use strict';
  
  const DEBUG = false;
  const log = DEBUG ? console.log.bind(console, '[ChatMD2PDF]') : () => {};
  const warn = console.warn.bind(console, '[ChatMD2PDF]');
  
  let userSettings = { lang: 'zh_CN', font: 'SimHei' };
  chrome.storage.sync.get({ lang: 'zh_CN', font: 'SimHei' }, (res) => { userSettings = res; });
  
  function checkLibs() {
    // html2pdf.bundle.min.js 会暴露 jsPDF 和 html2canvas
    // jsPDF 可能在 window.jspdf.jsPDF 或 window.jsPDF
    const jsPDFReady = !!(window.jspdf && window.jspdf.jsPDF) || !!window.jsPDF;
    const html2canvasReady = typeof window.html2canvas === 'function';
    if (!jsPDFReady || !html2canvasReady) {
      const msg = '库未就绪: jsPDF=' + jsPDFReady + ', html2canvas=' + html2canvasReady;
      warn(msg);
      // 尝试等待库加载（短轮询）
      return new Promise((resolve, reject) => {
        let attempts = 0;
        const checkInterval = setInterval(() => {
          attempts++;
          const jsPDF = !!(window.jspdf && window.jspdf.jsPDF) || !!window.jsPDF;
          const h2c = typeof window.html2canvas === 'function';
          if (jsPDF && h2c) {
            clearInterval(checkInterval);
            log('✅ 库已就绪 (来自 html2pdf.bundle)');
            resolve();
          } else if (attempts > 40) {
            clearInterval(checkInterval);
            reject(new Error('库加载超时，请刷新页面重试'));
          }
        }, 100);
      });
    }
    log('✅ 库检查通过 (html2pdf.bundle)');
    return Promise.resolve();
  }
  
  function findCopyButtonInMessage(msgEl) {
    if (!msgEl) return null;
    let btn = msgEl.querySelector('[data-testid="copy-turn-action-button"]');
    if (btn) return btn;
    btn = msgEl.querySelector('button[aria-label*="复制"],button[aria-label*="Copy"]');
    if (btn) return btn;
    btn = msgEl.querySelector('[data-tooltip*="复制"],[data-tooltip*="Copy"],[title*="复制"],[title*="Copy"]');
    if (btn) return btn;
    const actionBars = msgEl.querySelectorAll('div,nav,footer');
    for (const bar of actionBars) {
      const cand = bar.querySelector('button svg');
      if (cand && (bar.textContent || '').toLowerCase().includes('copy')) {
        return cand.closest('button');
      }
    }
    return null;
  }
  
  function waitClipboardFromCopyOnce(timeoutMs = 2000) {
    return new Promise((resolve) => {
      let done = false;
      const onCopy = (e) => {
        try {
          done = true;
          document.removeEventListener('copy', onCopy, true);
          const md = e.clipboardData?.getData('text/markdown');
          const txt = e.clipboardData?.getData('text/plain');
          resolve(md || txt || '');
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
  
  async function getMarkdownFromMessage(msgEl) {
    const btn = findCopyButtonInMessage(msgEl);
    if (!btn) {
      warn('未找到复制按钮，回退到 DOM 克隆');
      return null;
    }
    const copyPromise = waitClipboardFromCopyOnce(2000);
    btn.click();
    let md = await copyPromise;
    if (!md) {
      try { md = await navigator.clipboard.readText(); } catch (_) {}
    }
    return md || null;
  }
  
  function simpleMarkdownToHtml(md) {
    let html = md
      .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/^### (.*?)$/gm, '<h3>$1</h3>')
      .replace(/^## (.*?)$/gm, '<h2>$1</h2>')
      .replace(/^# (.*?)$/gm, '<h1>$1</h1>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>')
      .replace(/^\* (.*?)$/gm, '<li>$1</li>')
      .replace(/^- (.*?)$/gm, '<li>$1</li>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>');
    html = html.replace(/(<li>.*?<\/li>)/gs, '<ul>$1</ul>');
    return `<div class="mdx-content">${html}</div>`;
  }
  
  function buildFileName(md, ext) {
    let title = '';
    if (md) {
      const m = md.match(/^\s*#\s+(.+?)\s*$/m);
      if (m) title = m[1].trim();
      if (!title) title = md.replace(/\s+/g, ' ').trim().slice(0, 40);
    }
    title = (title || '导出')
      .replace(/[\\/:*?"<>|]+/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 40);
    const date = new Date().toISOString().slice(0, 10);
    return `chat-${title}-${date}.${ext}`;
  }
  
  async function renderMarkdownToCanvas(md) {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-same-origin');
    iframe.style.cssText = 'position:fixed;left:-99999px;top:0;width:900px;height:10px;visibility:hidden;border:none;';
    const selectedFont = userSettings.font || 'SimHei';
    const fontFamily = `"${selectedFont}", "Microsoft YaHei", "SimHei", "黑体", sans-serif`;
    const style = `<style>:root{color-scheme:light}html,body{margin:0;padding:0;background:#fff}body{font:14px/1.6 ${fontFamily};color:#000;padding:24px;max-width:800px}h1,h2,h3{margin:1.2em 0 .5em;font-weight:600;color:#000}h1{font-size:22px}h2{font-size:18px}h3{font-size:16px}code{background:#f6f8fa;border:1px solid #d0d7de;border-radius:4px;padding:0 .3em;font-family:Consolas,Monaco,monospace;color:#000}pre{background:#f6f8fa;border:1px solid #d0d7de;padding:12px;border-radius:8px;overflow:auto;margin:1em 0}pre code{background:none;border:none;padding:0}ul,ol{padding-left:1.4em;margin:1em 0}li{color:#000}blockquote{border-left:4px solid #ddd;margin:1em 0;padding:.5em 1em;color:#444;background:#fafafa;border-radius:4px}table{border-collapse:collapse;width:100%;margin:1em 0}th,td{border:1px solid #d0d7de;padding:8px;text-align:left;color:#000}th{background:#f0f0f0;font-weight:600}a{color:#0969da;text-decoration:none}a:hover{text-decoration:underline}img{max-width:100%;height:auto}*{box-sizing:border-box}</style>`;
    const htmlContent = simpleMarkdownToHtml(md);
    const fullHtml = `<!DOCTYPE html><html><head><meta charset="utf-8">${style}</head><body>${htmlContent}</body></html>`;
    document.body.appendChild(iframe);
    iframe.srcdoc = fullHtml;
    // 增加一点等待时间，让字体与布局稳定
    await new Promise((res) => { iframe.onload = () => setTimeout(res, 400); });
    const iframeDoc = iframe.contentDocument;
    const body = iframeDoc.body;
    const scrollHeight = body.scrollHeight;
    iframe.style.height = (scrollHeight + 50) + 'px';
    await new Promise((res) => setTimeout(res, 120));
    const canvas = await window.html2canvas(body, {
      backgroundColor: '#ffffff',
      scale: 2,
      logging: false,
      useCORS: true,
      allowTaint: true,
      width: 900,
      height: scrollHeight
    });
    iframe.remove();
    return canvas;
  }
  
  function getSelectionWithin(el) {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return null;
    for (let i = 0; i < sel.rangeCount; i++) {
      const r = sel.getRangeAt(i);
      if (el.contains(r.commonAncestorContainer)) return r.cloneContents();
    }
    return null;
  }
  
  async function renderDomToCanvas(domNode, exportSelection = false) {
    const container = document.createElement('div');
    container.style.cssText = 'position:fixed;left:-99999px;top:0;width:900px;background:#fff;padding:24px;';
    if (exportSelection) {
      const sel = getSelectionWithin(domNode);
      if (sel) container.appendChild(sel);
      else throw new Error('未选中文本');
    } else {
      const clone = domNode.cloneNode(true);
      clone.querySelectorAll('.md-export-actions,textarea,input,button').forEach(n => n.remove());
      container.appendChild(clone);
    }
    document.body.appendChild(container);
    const canvas = await window.html2canvas(container, {
      backgroundColor: '#ffffff',
      scale: 2,
      logging: false,
      useCORS: true,
      allowTaint: true
    });
    container.remove();
    return canvas;
  }
  
  async function saveCanvasAsPagedPdf(canvas, fileName) {
    const JsPDFCtor = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
    if (!JsPDFCtor) throw new Error('jsPDF 未就绪');
    // 使用 pt 单位（A4: 595.28 x 841.89 pt at 72dpi）
    const pdf = new JsPDFCtor({ unit: 'pt', format: 'a4', compress: true });
    const a4w = 595.28;
    const a4h = 841.89;

    const cw = canvas.width;
    const ch = canvas.height;
    const scale = a4w / cw; // 将画布等比缩放到 A4 宽度
    const pagePx = Math.floor(a4h / scale); // 一页在原始像素高度中能容纳的高度

    let y = 0;
    let pageIndex = 0;
    while (y < ch) {
      const sliceH = Math.min(pagePx, ch - y);
      const pageCanvas = document.createElement('canvas');
      pageCanvas.width = cw;
      pageCanvas.height = sliceH;
      const ctx = pageCanvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, cw, sliceH);
      ctx.drawImage(canvas, 0, y, cw, sliceH, 0, 0, cw, sliceH);
      const img = pageCanvas.toDataURL('image/jpeg', 0.92);
      if (pageIndex > 0) pdf.addPage();
      pdf.addImage(img, 'JPEG', 0, 0, a4w, sliceH * scale);
      y += sliceH;
      pageIndex++;
    }
    pdf.save(fileName);
  }
  
  function saveCanvasAsPng(canvas, fileName) {
    const url = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
  }
  
  async function exportMessage(msgEl, action) {
    try {
      await checkLibs();
      log(`📥 开始导出 (${action})...`);
      let canvas;
      let fileName;
      if (action === 'pdf' || action === 'img') {
        const md = await getMarkdownFromMessage(msgEl);
        if (md) {
          log('获取到 Markdown，长度:', md.length);
          canvas = await renderMarkdownToCanvas(md);
          fileName = buildFileName(md, action === 'pdf' ? 'pdf' : 'png');
        } else {
          log('Markdown 获取失败，使用 DOM 克隆');
          canvas = await renderDomToCanvas(msgEl, false);
          fileName = buildFileName(null, action === 'pdf' ? 'pdf' : 'png');
        }
      } else if (action === 'sel') {
        log('导出选中内容');
        canvas = await renderDomToCanvas(msgEl, true);
        fileName = buildFileName(null, 'pdf');
      }
      log('Canvas 生成完成:', canvas.width, 'x', canvas.height);
      if (action === 'img') {
        saveCanvasAsPng(canvas, fileName);
        log('PNG 导出完成');
      } else {
        await saveCanvasAsPagedPdf(canvas, fileName);
        log('PDF 导出完成');
      }
    } catch (err) {
      warn('导出失败:', err);
      alert(`导出失败: ${err.message}`);
    }
  }
  
  function detectProvider() {
    const host = location.hostname;
    if (/(^|\.)chatgpt\.com$/.test(host) || /(^|\.)chat\.openai\.com$/.test(host)) return 'gpt';
    if (/(^|\.)gemini\.google\.com$/.test(host) || /(^|\.)aistudio\.google\.com$/.test(host)) return 'gemini';
    return null;
  }
  
  const GPT_CONFIG = {
    messageSelector: '[data-message-author-role="assistant"][data-message-id]',
    contentSelector: '.markdown.prose, .markdown'
  };
  
  const GEMINI_CONFIG = {
    messageSelector: '.model-response-text, .markdown.markdown-main-panel',
    containerSelector: '.presented-response-container'
  };
  
  // ===== 菜单注入逻辑 =====
  let lastMenuTarget = null;
  
  function createMenuItem(labelText, action, handler) {
    const item = document.createElement('div');
    item.className = 'mdx-menu-item';
    item.setAttribute('role', 'menuitem');
    item.setAttribute('tabindex', '-1');
    item.dataset.mdAction = action;
    item.textContent = labelText;
    item.style.cssText = 'padding: 8px 12px; cursor: pointer; border-radius: 6px; font-size: 14px;';
    
    item.addEventListener('mouseenter', () => {
      item.style.backgroundColor = 'rgba(0,0,0,0.05)';
    });
    item.addEventListener('mouseleave', () => {
      item.style.backgroundColor = '';
    });
    
    item.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();
      closeAllMenus();
      await handler();
    });
    
    return item;
  }
  
  function closeAllMenus() {
    document.querySelectorAll('[role="menu"]').forEach(menu => {
      const trigger = document.querySelector(`[aria-controls="${menu.id}"]`);
      if (trigger) trigger.click();
    });
  }
  
  function findMessageFromMenuButton(menuButton) {
    let el = menuButton;
    let depth = 0;
    while (el && el !== document.body && depth < 20) {
      // GPT 新版：查找包含 agent-turn 类的 DIV
      if (el.classList && el.classList.contains('agent-turn')) {
        return el;
      }
      
      // GPT 旧版：带 data-message-id 的元素
      if (el.hasAttribute && el.hasAttribute('data-message-id') && el.hasAttribute('data-message-author-role')) {
        return el;
      }
      
      // Gemini 消息容器
      if (el.classList && el.classList.contains('presented-response-container')) {
        return el;
      }
      
      el = el.parentElement;
      depth++;
    }
    return null;
  }

  function isMessageFinal(msgEl) {
    if (!msgEl) return false;
    // 存在复制按钮通常表示消息已完成渲染
    const hasCopy = !!msgEl.querySelector('[data-testid="copy-turn-action-button"], button[aria-label*="复制"], button[aria-label*="Copy"]');
    // 检查是否存在流式/打字指示器
    const streaming = msgEl.querySelector('[data-streaming],[data-is-streaming="true"], .result-streaming, .typing, .code-block-spinner');
    return hasCopy && !streaming;
  }
  
  function injectMenuItems(menu, provider) {
    // 检查是否已注入
    if (menu.querySelector('[data-md-action]')) {
      return;
    }
    
    const msgEl = findMessageFromMenuButton(lastMenuTarget);
    if (!msgEl) {
      warn('未找到消息容器');
      return;
    }
    if (!isMessageFinal(msgEl)) {
      log('⏳ 消息未完成，跳过注入');
      return;
    }
    
    log('✅ 注入菜单项');
    
    // 创建分组
    const group = document.createElement('div');
    group.className = 'mdx-menu-group';
    group.style.cssText = 'border-top: 1px solid rgba(0,0,0,0.1); margin-top: 4px; padding-top: 4px;';
    
    // 创建三个菜单项
    const pdfItem = createMenuItem('导出 PDF', 'pdf', async () => {
      await exportMessage(msgEl, 'pdf');
    });
    
    const imgItem = createMenuItem('导出图片', 'img', async () => {
      await exportMessage(msgEl, 'img');
    });
    
    const selItem = createMenuItem('导出所选', 'sel', async () => {
      await exportMessage(msgEl, 'sel');
    });
    
    group.appendChild(pdfItem);
    group.appendChild(imgItem);
    group.appendChild(selItem);
    
    // 插入到菜单末尾
    menu.appendChild(group);
  }
  
  function isMenuSettled(menu) {
    // 检查菜单是否已完全加载
    const items = menu.querySelectorAll('[role="menuitem"]');
    return items.length >= 2; // 至少有2个原生菜单项
  }
  
  function scanAndInjectMenus(provider) {
    const menus = document.querySelectorAll('[role="menu"]');
    
    menus.forEach(menu => {
      if (!isMenuSettled(menu)) {
        return;
      }
      
      setTimeout(() => {
        injectMenuItems(menu, provider);
      }, 50);
    });
  }
  
  function boot() {
    const provider = detectProvider();
    log('🚀 启动 v3.1 - 菜单注入模式');
    if (!provider) {
      return;
    }
    
    // 监听菜单按钮点击
    document.addEventListener('click', (e) => {
      const menuButton = e.target.closest('button[aria-haspopup="menu"]');
      if (menuButton) {
        lastMenuTarget = menuButton;
      }
    }, true);
    
    // 监听 DOM 变化，检测菜单打开
    const observer = new MutationObserver(() => {
      scanAndInjectMenus(provider);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();