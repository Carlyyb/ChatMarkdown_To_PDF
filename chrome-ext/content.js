/* ===================================
 * ChatMarkdown To PDF v3.0 - Content Script
 * 通过"复制"按钮获取 Markdown → iframe 隔离渲染 → PDF 导出
 * 彻底消除 DOM 克隆、颜色转换、foreignObject 等旧方案
 * =================================== */

(() => {
  'use strict';

  const DEBUG = false;
  const log = DEBUG ? console.log.bind(console, '[ChatMD2PDF]') : () => {};
  const warn = DEBUG ? console.warn.bind(console, '[ChatMD2PDF]') : () => {};

  // ===== 全局配置 =====
  let userSettings = {
    lang: 'zh_CN',
    font: 'SimHei'
  };

  chrome.storage.sync.get({ lang: 'zh_CN', font: 'SimHei' }, (res) => {
    userSettings = res;
  });

  // ===== 库加载确保 =====
  let libsPromise = null;

  async function loadLibOnce(url) {
    return new Promise((res, rej) => {
      if (document.querySelector(`script[data-mdexp="${url}"]`)) return res();
      const s = document.createElement('script');
      s.src = url;
      s.dataset.mdexp = url;
      s.onload = res;
      s.onerror = rej;
      (document.head || document.documentElement).appendChild(s);
    });
  }

  async function ensureLibs() {
    if (libsPromise) return libsPromise;
    
    libsPromise = (async () => {
      if (!(window.jspdf?.jsPDF || window.jsPDF)) {
        const url = chrome.runtime.getURL('libs/html2pdf.bundle.min.js');
        await loadLibOnce(url);
      }
      const ok = !!(window.jspdf?.jsPDF || window.jsPDF) && !!window.html2canvas;
      log('✅ Libraries:', { jsPDF: !!(window.jspdf?.jsPDF || window.jsPDF), html2canvas: !!window.html2canvas });
      if (!ok) throw new Error('库未就绪');
    })();
    
    return libsPromise;
  }

  // ===== 定位"复制"按钮 =====
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

  // ===== 拦截复制事件获取 Markdown =====
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
        } catch (err) {
          resolve('');
        }
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
    if (!btn) throw new Error('未找到复制按钮');
    const copyPromise = waitClipboardFromCopyOnce(2000);
    btn.click();
    let md = await copyPromise;
    if (!md) {
      try { md = await navigator.clipboard.readText(); } catch (_) {}
    }
    if (!md) throw new Error('未能从剪贴板读取到文本');
    return md;
  }

  // ===== Markdown → HTML（简单转换）=====
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

  // ===== 文件名生成 =====
  function buildPdfFileNameFromMd(md, { maxLen = 40, prefix = 'chat' } = {}) {
    let title = '';
    const m = md.match(/^\s*#\s+(.+?)\s*$/m);
    if (m) title = m[1].trim();
    if (!title) {
      const text = md.replace(/\s+/g, ' ').trim();
      title = text.slice(0, maxLen);
    }
    title = (title || '导出')
      .replace(/[\\/:*?"<>|]+/g, '')
      .replace(/\s+/g, ' ')
      .slice(0, maxLen);
    const date = new Date().toISOString().slice(0, 10);
    return `${prefix}-${title}-${date}.pdf`;
  }

  // ===== 核心：iframe 隔离渲染 Markdown → Canvas =====
  async function renderMarkdownToCanvas(md) {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-same-origin');
    iframe.style.cssText = 'position:fixed;left:-99999px;top:0;width:900px;height:10px;visibility:hidden;border:none;';
    
    const selectedFont = userSettings.font || 'SimHei';
    const fontFamily = `"${selectedFont}", "Microsoft YaHei", "SimHei", "黑体", sans-serif`;
    
    const style = `
      <style>
        :root { color-scheme: light; }
        html, body { margin: 0; padding: 0; background: #fff; }
        body { font: 14px/1.6 ${fontFamily}; color: #000; padding: 24px; max-width: 800px; }
        h1, h2, h3 { margin: 1.2em 0 .5em; font-weight: 600; color: #000; }
        h1 { font-size: 22px; } h2 { font-size: 18px; } h3 { font-size: 16px; }
        code { background: #f6f8fa; border: 1px solid #d0d7de; border-radius: 4px; padding: 0 .3em; font-family: Consolas, Monaco, monospace; color: #000; }
        pre { background: #f6f8fa; border: 1px solid #d0d7de; padding: 12px; border-radius: 8px; overflow: auto; margin: 1em 0; }
        pre code { background: none; border: none; padding: 0; }
        ul, ol { padding-left: 1.4em; margin: 1em 0; }
        li { color: #000; }
        blockquote { border-left: 4px solid #ddd; margin: 1em 0; padding: .5em 1em; color: #444; background: #fafafa; border-radius: 4px; }
        table { border-collapse: collapse; width: 100%; margin: 1em 0; }
        th, td { border: 1px solid #d0d7de; padding: 8px; text-align: left; color: #000; }
        th { background: #f0f0f0; font-weight: 600; }
        a { color: #0969da; text-decoration: none; }
        a:hover { text-decoration: underline; }
        img { max-width: 100%; height: auto; }
        * { box-sizing: border-box; }
      </style>
    `;
    
    const htmlContent = simpleMarkdownToHtml(md);
    const fullHtml = `<!DOCTYPE html><html><head><meta charset="utf-8">${style}</head><body>${htmlContent}</body></html>`;
    
    document.body.appendChild(iframe);
    iframe.srcdoc = fullHtml;
    
    await new Promise((res) => {
      iframe.onload = () => setTimeout(res, 300);
    });
    
    const iframeDoc = iframe.contentDocument;
    const body = iframeDoc.body;
    const scrollHeight = body.scrollHeight;
    iframe.style.height = (scrollHeight + 50) + 'px';
    
    await new Promise((res) => setTimeout(res, 100));
    
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

  // ===== Canvas → 分页 PDF =====
  async function saveCanvasAsPagedPdf(canvas, fileName) {
    const jsPDF = window.jspdf?.jsPDF || window.jsPDF;
    if (!jsPDF) throw new Error('jsPDF 未就绪');
    
    const pdf = new jsPDF('p', 'mm', 'a4');
    const pageWidth = 210;
    const pageHeight = 297;
    const canvasWidth = canvas.width;
    const canvasHeight = canvas.height;
    const ratio = pageWidth / (canvasWidth / 2);
    const contentHeight = canvasHeight / 2 * ratio;
    const pageContentHeight = pageHeight;
    
    let y = 0;
    let pageIndex = 0;
    
    while (y < contentHeight) {
      if (pageIndex > 0) pdf.addPage();
      
      const tmpCanvas = document.createElement('canvas');
      tmpCanvas.width = canvasWidth;
      const sliceHeight = Math.min(pageContentHeight / ratio * 2, canvasHeight - y * 2 / ratio);
      tmpCanvas.height = sliceHeight;
      
      const tmpCtx = tmpCanvas.getContext('2d');
      tmpCtx.fillStyle = '#ffffff';
      tmpCtx.fillRect(0, 0, tmpCanvas.width, tmpCanvas.height);
      tmpCtx.drawImage(canvas, 0, y * 2 / ratio, canvasWidth, sliceHeight, 0, 0, canvasWidth, sliceHeight);
      
      const imgData = tmpCanvas.toDataURL('image/jpeg', 0.92);
      pdf.addImage(imgData, 'JPEG', 0, 0, pageWidth, sliceHeight / 2 * ratio);
      
      y += pageContentHeight;
      pageIndex++;
    }
    
    pdf.save(fileName);
  }

  // ===== 主导出流程：Markdown → Canvas → PDF =====
  async function exportMarkdownToPdf(msgEl) {
    try {
      await ensureLibs();
      log('📥 正在提取 Markdown...');
      const md = await getMarkdownFromMessage(msgEl);
      if (!md) throw new Error('拿到的 Markdown 为空');
      log('✅ 获取到 Markdown，长度:', md.length);
      
      log('🎨 渲染 Markdown → Canvas...');
      const canvas = await renderMarkdownToCanvas(md);
      log('✅ Canvas 已生成，尺寸:', canvas.width, 'x', canvas.height);
      
      const fileName = buildPdfFileNameFromMd(md);
      log('💾 导出 PDF:', fileName);
      await saveCanvasAsPagedPdf(canvas, fileName);
      log('✅ PDF 导出完成');
    } catch (err) {
      warn('❌ 导出失败:', err);
      alert(`导出失败: ${err.message}`);
    }
  }

  // ===== 菜单注入 & 事件监听 =====
  let lastMenuTarget = null;

  function createMenuItem(labelKey, iconType, handler) {
    const item = document.createElement('div');
    item.className = 'md2pdf-menu-item';
    item.role = 'menuitem';
    item.tabIndex = -1;
    item.dataset.menuAction = labelKey;
    
    const iconMap = {
      pdf: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z'
    };
    
    item.innerHTML = `
      <svg stroke="currentColor" fill="none" stroke-width="2" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round" class="icon-md" height="1em" width="1em" xmlns="http://www.w3.org/2000/svg">
        <path d="${iconMap[iconType]}"></path>
      </svg>
      <span>${chrome.i18n.getMessage(labelKey) || labelKey}</span>
    `;
    
    item.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();
      await handler();
      closeAllMenus();
    });
    
    return item;
  }

  function closeAllMenus() {
    document.querySelectorAll('.md2pdf-menu-item').forEach(el => el.remove());
  }

  function isLikelySettled(menu) {
    const items = menu.querySelectorAll('[role="menuitem"]');
    return items.length >= 2;
  }

  function findMessageContainer(target) {
    let el = target;
    while (el && el !== document.body) {
      const tag = el.tagName;
      if ((tag === 'ARTICLE' || tag === 'DIV') && el.querySelector('[data-message-author-role]')) {
        return el;
      }
      if (el.classList.contains('conversation-turn') || el.classList.contains('message-container')) {
        return el;
      }
      el = el.parentElement;
    }
    return null;
  }

  const observer = new MutationObserver(() => {
    const menus = document.querySelectorAll('[role="menu"]');
    for (const menu of menus) {
      if (menu.querySelector('.md2pdf-menu-item')) continue;
      if (!isLikelySettled(menu)) continue;
      
      const msgEl = findMessageContainer(lastMenuTarget || menu);
      if (!msgEl) continue;
      
      setTimeout(() => {
        if (menu.querySelector('.md2pdf-menu-item')) return;
        
        const pdfItem = createMenuItem('exportToPdf', 'pdf', async () => {
          await exportMarkdownToPdf(msgEl);
        });
        
        const firstItem = menu.querySelector('[role="menuitem"]');
        if (firstItem) {
          firstItem.parentNode.insertBefore(pdfItem, firstItem);
        } else {
          menu.appendChild(pdfItem);
        }
      }, 40);
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (btn && btn.getAttribute('aria-haspopup') === 'menu') {
      lastMenuTarget = btn;
    }
  }, true);

  log('✅ 内容脚本已初始化 (v3.0 - Markdown 模式)');
})();
