// ===== 诊断版 content.js =====
// 用于排查"按钮不显示"问题：
// 1. 控制台日志详细输出
// 2. 按钮默认可见（不依赖 hover）
// 3. 强力扫描（初次 + MutationObserver + 定时补扫）
// 4. 点击时弹出诊断信息

(function () {
  const log = (...args) => console.log('[MD-Exporter]', ...args);

  function isGptHost() {
    return /(^|\.)chatgpt\.com$/.test(location.hostname) || /(^|\.)chat\.openai\.com$/.test(location.hostname);
  }
  function isGeminiHost() {
    return /(^|\.)gemini\.google\.com$/.test(location.hostname) || /(^|\.)aistudio\.google\.com$/.test(location.hostname);
  }
  function detectProvider() {
    if (isGptHost()) return 'gpt';
    if (isGeminiHost()) return 'gemini';
    return null;
  }

  const GPT = {
    messageItem: '[data-message-author-role="assistant"][data-message-id]',
    messageContentSelector: '.markdown.prose, .markdown.markdown-new-styling',
    injectAfter(root) {
      return root.querySelector(this.messageContentSelector) || null;
    }
  };

  const GEMINI = {
    messageItems: '.presented-response-container .model-response-text, .presented-response-container .markdown.markdown-main-panel',
    messageContent(node) {
      const md = node.querySelector && node.querySelector('.markdown.markdown-main-panel');
      return md || node;
    },
    injectAfter(node) {
      const md = node.querySelector && node.querySelector('.markdown.markdown-main-panel');
      return md || node;
    }
  };

  // 加载 html2pdf.js
  const H2PDF_URL = "https://cdn.jsdelivr.net/npm/html2pdf.js@0.10.1/dist/html2pdf.bundle.min.js";
  function loadHtml2PdfOnce() {
    if (window.__html2pdfLoaded) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = H2PDF_URL; 
      s.onload = () => { 
        window.__html2pdfLoaded = true; 
        log('html2pdf.js loaded successfully');
        resolve(); 
      };
      s.onerror = (err) => {
        log('ERROR loading html2pdf.js:', err);
        reject(err);
      };
      document.documentElement.appendChild(s);
    });
  }

  // 导出辅助函数
  function getSelectionWithin(el) {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return null;
    for (let i = 0; i < sel.rangeCount; i++) {
      const r = sel.getRangeAt(i);
      if (el.contains(r.commonAncestorContainer)) return r.cloneContents();
    }
    return null;
  }

  function cloneForExport(messageEl, provider) {
    const selectedFrag = getSelectionWithin(messageEl);
    const surface = document.createElement('div');
    surface.className = 'gpt-export-surface';
    surface.style.background = 'white';
    surface.style.color = '#000';
    const content = document.createElement('div');
    content.className = 'markdown-body';
    
    if (selectedFrag) {
      content.appendChild(selectedFrag);
    } else {
      let inner;
      if (provider === 'gpt') {
        inner = messageEl.querySelector('.markdown, .prose, [data-testid="assistant-turn"]');
      } else {
        inner = messageEl.querySelector('.markdown.markdown-main-panel, .model-response-text, [data-md]');
      }
      if (!inner) inner = messageEl;
      const tmp = inner.cloneNode(true);
      tmp.querySelectorAll('.gpt-export-bar, .md-export-actions, textarea, input, button').forEach(n => n.remove());
      content.appendChild(tmp);
    }
    
    const footer = document.createElement('div');
    footer.style.cssText = 'position: fixed; bottom: 10mm; right: 10mm; font-size: 11px; color: #666;';
    footer.textContent = 'Page {{page}} of {{pages}}';
    surface.appendChild(content);
    surface.appendChild(footer);
    return surface;
  }

  async function exportNodeTo(kind, node, filenameBase) {
    await loadHtml2PdfOnce();
    const opts = {
      margin: [10, 12, 12, 12],
      filename: `${filenameBase}.${kind === 'pdf' ? 'pdf' : 'png'}`,
      image: { type: 'jpeg', quality: 0.96 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };
    if (kind === 'pdf') {
      await html2pdf().from(node).set(opts).save();
    } else {
      const canvas = await html2pdf().from(node).toCanvas();
      const url = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url; a.download = opts.filename; a.click();
    }
  }

  async function exportMessage(messageEl, kind, provider) {
    log('Exporting message:', { kind, provider });
    try {
      const node = cloneForExport(messageEl, provider);
      await exportNodeTo(kind, node, `ai-export-${Date.now()}`);
      log('Export successful!');
    } catch (err) {
      log('ERROR during export:', err);
      alert('导出失败，查看控制台获取详细信息');
    }
  }

  function ensureButton(provider, msgRoot) {
    if (!msgRoot || msgRoot.querySelector('.md-export-actions')) return;

    const anchor = provider === 'gpt'
      ? GPT.injectAfter(msgRoot)
      : GEMINI.injectAfter(msgRoot);

    // 没有 markdown 容器就退回消息容器
    const mountPoint = anchor || msgRoot;

    const bar = document.createElement('div');
    bar.className = 'md-export-actions md-export-actions--diagnose'; // 诊断：默认可见
    bar.innerHTML = `
      <button class="mdx-btn" data-action="pdf">导出 PDF</button>
      <button class="mdx-btn" data-action="img">导出图片</button>
      <button class="mdx-btn" data-action="sel">导出所选</button>
    `;
    mountPoint.after(bar);

    log('✅ Injected buttons ->', { provider, mountPoint, msgRoot });

    bar.addEventListener('click', async (e) => {
      const t = e.target;
      if (!t || !t.dataset) return;
      const action = t.dataset.action;
      
      let content = null;
      if (provider === 'gpt') {
        content = msgRoot.querySelector(GPT.messageContentSelector) || msgRoot;
      } else {
        const container = msgRoot.closest && msgRoot.closest('.presented-response-container');
        const base = container || msgRoot;
        content = GEMINI.messageContent(base);
      }
      
      if (!content) {
        alert('❌ 未找到可导出的内容节点\n\nProvider: ' + provider + '\nmsgRoot: ' + msgRoot.className);
        log('ERROR: No content found', { provider, msgRoot, content });
        return;
      }

      log('Button clicked:', { action, content });

      try {
        if (action === 'pdf') {
          await exportMessage(content, 'pdf', provider);
        } else if (action === 'img') {
          await exportMessage(content, 'png', provider);
        } else if (action === 'sel') {
          const sel = getSelectionWithin(content);
          if (sel) {
            log('Exporting selection');
            await exportMessage(content, 'pdf', provider);
          } else {
            alert('💡 未选中文本，将导出整条消息');
            await exportMessage(content, 'pdf', provider);
          }
        }
      } catch (err) {
        log('ERROR in button handler:', err);
        alert('导出失败: ' + err.message);
      }
    });
  }

  function scanAndInject(provider) {
    let count = 0;
    if (provider === 'gpt') {
      const nodes = document.querySelectorAll(GPT.messageItem);
      log('GPT scan found:', nodes.length, 'messages');
      nodes.forEach(node => {
        ensureButton('gpt', node);
        count++;
      });
    } else {
      const nodes = document.querySelectorAll(GEMINI.messageItems);
      log('Gemini scan found:', nodes.length, 'message items');
      nodes.forEach(node => {
        const container = node.closest && node.closest('.presented-response-container');
        ensureButton('gemini', container || node);
        count++;
      });
    }
    log('📊 Scan completed', { provider, count, timestamp: new Date().toISOString() });
  }

  function boot() {
    const provider = detectProvider();
    log('🚀 Boot started');
    log('📍 Provider =', provider, '| Hostname =', location.hostname);
    log('📍 URL =', location.href);
    
    if (!provider) {
      log('⚠️ No provider detected for this site. Extension will not run.');
      return;
    }

    // 初次扫描
    log('🔍 Running initial scan...');
    scanAndInject(provider);

    // 观察 DOM 变化
    log('👀 Setting up MutationObserver...');
    const obs = new MutationObserver(() => {
      scanAndInject(provider);
    });
    obs.observe(document.documentElement, { subtree: true, childList: true });

    // 保底：某些懒加载页面再扫几次
    log('⏰ Setting up backup scans (10 times, 800ms interval)...');
    let tries = 0;
    const timer = setInterval(() => {
      log(`🔄 Backup scan #${tries + 1}`);
      scanAndInject(provider);
      if (++tries >= 10) {
        clearInterval(timer);
        log('✅ Backup scans completed');
      }
    }, 800);
  }

  // 确保在 DOM 可用时启动
  if (document.readyState === 'loading') {
    log('⏳ DOM loading, waiting for DOMContentLoaded...');
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    log('✅ DOM already loaded, booting immediately...');
    boot();
  }

  // 暴露诊断函数到全局
  window.__MD_EXPORTER_DIAGNOSE = {
    log,
    detectProvider,
    scanAndInject: () => scanAndInject(detectProvider()),
    testGptSelector: () => {
      const nodes = document.querySelectorAll(GPT.messageItem);
      log('GPT selector test:', nodes.length, 'matches');
      return nodes;
    },
    testGeminiSelector: () => {
      const nodes = document.querySelectorAll(GEMINI.messageItems);
      log('Gemini selector test:', nodes.length, 'matches');
      return nodes;
    }
  };
  log('💡 Diagnostic tools available: window.__MD_EXPORTER_DIAGNOSE');
})();
