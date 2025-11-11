(() => {
  'use strict';

  const DEBUG = true;
  const log = DEBUG ? console.log.bind(console, '[ChatMD2PDF]') : () => {};
  const warn = console.warn.bind(console, '[ChatMD2PDF]');

  const COPY_TIMEOUT = 2000;
  const LIB_RETRY = 50;
  const LIB_INTERVAL = 100;
  const MENU_GROUP_CLASS = 'mdx-export-group';
  const MENU_ITEM_CLASS = 'mdx-menu-item';
  const MESSAGE_CONTAINER_SELECTORS = [
    '.agent-turn',
    '[data-message-author-role="assistant"]',
    '[data-message-id]',
    '.presented-response-container',
    '.model-response-text',
    '.markdown.markdown-main-panel'
  ];

  const provider = detectProvider();
  log('provider', provider);
  // 注入页面桥脚本：拦截站内生成的 Markdown，不触碰系统剪贴板
  injectBridge();

  function injectBridge() {
    try {
      if (document.documentElement.__chatmd2pdf_bridge_injected) return;
      const s = document.createElement('script');
      s.src = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL)
        ? chrome.runtime.getURL('bridge.js')
        : 'bridge.js';
      s.async = false;
      (document.documentElement || document.head || document.body).appendChild(s);
      document.documentElement.__chatmd2pdf_bridge_injected = true;
      log('bridge 已注入');
    } catch (e) {
      warn('bridge 注入失败', e);
    }
  }

  function waitMarkdownFromBridge(timeoutMs = 1500) {
    return new Promise((resolve) => {
      let timer = null;
      const handler = (ev) => {
        try {
          const d = ev.data;
          if (!d || d.source !== '__CHATMD2PDF_BRIDGE__') return;
          if (d.type === 'CHATMD2PDF_MARKDOWN' && d.text) {
            cleanup(); resolve({ kind: 'md', text: d.text, via: d.via });
          } else if ((d.type === 'CHATMD2PDF_WRITE' || d.type === 'CHATMD2PDF_PLAIN') && d.text) {
            cleanup(); resolve({ kind: 'plain', text: d.text, via: d.via });
          }
        } catch {}
      };
      const cleanup = () => {
        window.removeEventListener('message', handler, true);
        if (timer) clearTimeout(timer);
      };
      window.addEventListener('message', handler, true);
      timer = setTimeout(() => { cleanup(); resolve(null); }, timeoutMs);
    });
  }
  // 启动时打印库就绪状态
  try {
    const hasH2C = typeof window.html2canvas === 'function';
    const hasJsPDF = Boolean((window.jspdf && window.jspdf.jsPDF) || window.jsPDF);
    const hasHtml2pdf = typeof window.html2pdf === 'function';
    log('libs', { h2c: hasH2C, jsPDF: hasJsPDF, html2pdf: hasHtml2pdf });
  } catch {}

  if (provider === 'unknown') {
    warn('未识别的站点，停止注入');
    return;
  }

  let lastMenuTarget = null;

  document.addEventListener('click', (event) => {
    const btn = getMenuButton(event.target);
    if (btn) {
      lastMenuTarget = btn;
    }
  }, true);

  const menuObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        if (node.getAttribute('role') === 'menu') {
          handleMenu(node);
        } else {
          const menus = node.querySelectorAll('[role="menu"]');
          menus.forEach(handleMenu);
        }
      }
    }
  });

  menuObserver.observe(document.documentElement || document.body, {
    childList: true,
    subtree: true
  });

  async function handleMenu(menuEl) {
    const activeTrigger = document.activeElement && getMenuButton(document.activeElement);
    if (activeTrigger) {
      lastMenuTarget = activeTrigger;
    }
    if (!lastMenuTarget) return;

    const messageEl = findMessageContainer(lastMenuTarget) || findMessageContainer(menuEl);
    if (!messageEl) return;
    if (!isMessageReady(messageEl)) {
      log('消息仍在生成，跳过菜单注入');
      return;
    }
    if (menuEl.querySelector(`.${MENU_GROUP_CLASS}`)) return;

    const attemptInject = () => {
      if (menuEl.querySelector(`.${MENU_GROUP_CLASS}`)) return true;
      const baseItems = menuEl.querySelectorAll('[role="menuitem"]');
      if (!baseItems || baseItems.length < 2) return false;
      injectMenuItems(menuEl, messageEl);
      return true;
    };

    if (attemptInject()) return;
    requestAnimationFrame(() => {
      if (attemptInject()) return;
      setTimeout(attemptInject, 80);
    });
  }

  function injectMenuItems(menuEl, messageEl) {
    try {
      const baseItem = menuEl.querySelector('[role="menuitem"]');
      if (!baseItem) return;
      const group = document.createElement('div');
      group.className = MENU_GROUP_CLASS;
      group.setAttribute('role', 'none');

      const pdfItem = createMenuItem(baseItem, '导出 PDF', 'pdf', messageEl, menuEl);
      const pngItem = createMenuItem(baseItem, '导出图片', 'png', messageEl, menuEl);
      const selItem = createMenuItem(baseItem, '导出所选', 'selection', messageEl, menuEl);

      group.appendChild(pdfItem);
      group.appendChild(pngItem);
      group.appendChild(selItem);

      menuEl.appendChild(group);
      log('菜单项已注入');
    } catch (error) {
      warn('注入菜单失败', error);
    }
  }

  function createMenuItem(baseItem, text, action, messageEl, menuEl) {
    const tag = baseItem.tagName.toLowerCase();
    let el;
    if (tag === 'button') {
      el = document.createElement('button');
      el.type = 'button';
      el.setAttribute('role', 'menuitem');
    } else {
      el = document.createElement(tag);
      el.setAttribute('role', 'menuitem');
      const tabindex = baseItem.getAttribute('tabindex');
      if (tabindex) {
        el.setAttribute('tabindex', tabindex);
      } else {
        el.setAttribute('tabindex', '0');
      }
    }
    el.className = `${baseItem.className || ''} ${MENU_ITEM_CLASS}`.trim();
    el.textContent = text;
    el.dataset.mdxAction = action;
    el.addEventListener('click', (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      handleMenuAction(action, messageEl, menuEl);
    });
    return el;
  }

  async function handleMenuAction(action, messageEl, menuEl) {
    try {
      await performExport(action, messageEl, menuEl);
    } catch (error) {
      warn('导出失败', error);
      window.alert(error && error.message ? error.message : '导出失败，请重试。');
    }
  }

  function detectProvider() {
    const host = location.hostname;
    if (host.endsWith('chat.openai.com') || host.endsWith('chatgpt.com')) return 'gpt';
    if (host.endsWith('gemini.google.com') || host.endsWith('aistudio.google.com')) return 'gemini';
    return 'unknown';
  }

  function getMenuButton(target) {
    if (!(target instanceof Element)) return null;
    return target.closest('button[aria-haspopup="menu"]');
  }

  function findMessageContainer(startEl) {
    if (!(startEl instanceof Element)) return null;
    const candidates = MESSAGE_CONTAINER_SELECTORS;
    let el = startEl;
    while (el && el !== document.body) {
      for (const sel of candidates) {
        if (el.matches && el.matches(sel)) {
          return el;
        }
      }
      el = el.parentElement;
    }
    return null;
  }

  function isMessageReady(messageEl) {
    if (!messageEl) return false;
    if (hasStreamingIndicator(messageEl)) return false;
    if (findCopyButton(messageEl)) return true;
    const text = (messageEl.innerText || messageEl.textContent || '').trim();
    return text.length > 0;
  }

  function hasStreamingIndicator(messageEl) {
    const selectors = [
      '[data-streaming="true"]',
      '.result-streaming',
      '.result-state-streaming',
      '.typing',
      '.code-block-spinner',
      '.loading-spinner',
      '.pb-2.text-token-text-secondary'
    ];
    return selectors.some((sel) => messageEl.querySelector(sel));
  }

  function findCopyButton(messageEl) {
    if (!messageEl) return null;
    const selectors = [
      '[data-testid="copy-turn-action-button"]',
      'button[aria-label*="复制"]',
      'button[aria-label*="Copy"]',
      'button[title*="复制"]',
      'button[title*="Copy"]',
      '[data-tooltip*="复制"]',
      '[data-tooltip*="Copy"]'
    ];
    for (const sel of selectors) {
      const btn = messageEl.querySelector(sel);
      if (btn) return btn;
    }
    return null;
  }

  async function performExport(action, messageEl, menuEl) {
    // PDF 仅依赖 html2pdf；PNG 依赖 html2canvas
    await checkLibs(action === 'pdf');

    const textPreview = getTextPreview(messageEl);
    let markdown = null;

    if (action !== 'selection') {
      markdown = await getMarkdownFromMessage(messageEl, menuEl);
    }

    closeMenu(menuEl);

    if (action === 'pdf') {
      const fileName = buildFileName(markdown, textPreview, 'pdf');
      try {
        log('导出调试', {
          action,
          fileName,
          usedMarkdown: Boolean(markdown),
          markdownLen: markdown ? markdown.length : 0,
          markdownPreview: markdown ? markdown.slice(0, 300) : ''
        });
      } catch {}
      try {
        await exportPdfViaIframe(markdown, messageEl, action === 'selection', fileName);
        log('PDF 导出完成 (iframe)', { usedMarkdown: Boolean(markdown) });
      } catch (err) {
        warn('iframe 渲染失败，回退 html2pdf', err);
        const container = buildPdfContainer(markdown, messageEl, action === 'selection');
        try {
          await exportPdfViaHtml2pdf(container, fileName);
          log('PDF 导出完成 (fallback html2pdf)', { usedMarkdown: Boolean(markdown) });
        } finally {
          if (container && container.parentNode) container.parentNode.removeChild(container);
        }
      }
    } else {
      // PNG 仍走 html2canvas 快照
      const canvas = await renderDomToCanvas(messageEl, action === 'selection');
      const fileName = buildFileName(markdown, textPreview, 'png');
      try {
        log('导出调试', {
          action,
          fileName,
          usedMarkdown: Boolean(markdown),
          markdownLen: markdown ? markdown.length : 0,
          markdownPreview: markdown ? markdown.slice(0, 300) : '',
          canvasSize: canvas ? { width: canvas.width, height: canvas.height } : null
        });
      } catch {}
      await saveCanvasAsPng(canvas, fileName);
      log('PNG 导出完成', { usedMarkdown: Boolean(markdown) });
    }
  }

  function closeMenu(menuEl) {
    if (!menuEl) return;
    const evt = new KeyboardEvent('keydown', {
      key: 'Escape',
      code: 'Escape',
      keyCode: 27,
      bubbles: true
    });
    menuEl.dispatchEvent(evt);
    setTimeout(() => document.body.click(), 10);
  }

  function checkLibs(requirePdf = false) {
    const hasHtml2pdf = () => typeof window.html2pdf === 'function';
    const hasH2C = () => typeof window.html2canvas === 'function';
    // PDF 仅要求 html2pdf；PNG 要求 html2canvas
    const ready = () => requirePdf ? hasHtml2pdf() : hasH2C();
    if (ready()) return Promise.resolve();
    // 如果 html2pdf 已经存在但 html2canvas 还没挂载，可能是 bundle 内部延迟，给一次短暂微任务重试
    if (!hasH2C() && hasHtml2pdf() && !requirePdf) {
      return new Promise((resolve, reject) => {
        setTimeout(() => {
          if (ready()) return resolve();
          // 进入正常轮询
          poll(resolve, reject, requirePdf);
        }, 50);
      });
    }
    return new Promise((resolve, reject) => poll(resolve, reject, requirePdf));

    function poll(resolve, reject, requirePdfFlag) {
      let attempts = 0;
      const timer = setInterval(() => {
        attempts += 1;
        if (ready()) {
          clearInterval(timer);
          resolve();
          return;
        }
        if (attempts >= LIB_RETRY) {
          clearInterval(timer);
          const missing = [];
          if (!requirePdfFlag && !hasH2C()) missing.push('html2canvas');
          if (requirePdfFlag && !hasHtml2pdf()) missing.push('html2pdf');
          const scripts = Array.from(document.querySelectorAll('script[src]'))
            .map(s => s.getAttribute('src'))
            .filter(Boolean)
            .slice(-5);
          reject(new Error(`库加载超时: ${missing.join(', ')}\n最近脚本: ${scripts.join(', ')}`));
        }
      }, LIB_INTERVAL);
    }
  }

  // 构建用于 html2pdf 的容器：优先使用 Markdown 渲染，否则克隆消息 DOM
  function buildPdfContainer(markdown, messageEl, exportSelection) {
    const container = document.createElement('div');
    container.style.cssText = [
      'position:absolute',
      'left:-9999px',
      'top:0',
      'max-width:800px',
      'padding:20px',
      'margin:0',
      'background:#ffffff',
      'color:#000000',
      'font-family:"Microsoft YaHei","SimHei","黑体",sans-serif'
    ].join(';');

    // 注入基础样式，确保排版稳定、文本为黑色
    const style = document.createElement('style');
    style.textContent = `
      *{box-sizing:border-box;color:#000 !important}
      h1{font-size:22px;margin:24px 0 12px;font-weight:600}
      h2{font-size:20px;margin:20px 0 10px;font-weight:600}
      h3{font-size:18px;margin:18px 0 8px;font-weight:600}
      p{margin:12px 0;white-space:pre-wrap;word-wrap:break-word}
      ul,ol{margin:12px 0 12px 24px;padding:0}
      li{margin:6px 0}
      blockquote{margin:16px 0;padding:10px 16px;border-left:4px solid #d0d7de;background:#f8f8f8;border-radius:6px;color:#444}
      pre{background:#f6f8fa;border:1px solid #d0d7de;border-radius:8px;padding:16px;overflow:auto;white-space:pre-wrap;word-wrap:break-word;margin:18px 0}
      code{font-family:"JetBrains Mono","Consolas","SFMono-Regular",monospace;background:#f6f8fa;border:1px solid #d0d7de;border-radius:4px;padding:0 .35em}
      pre code{background:none;border:none;padding:0}
      table{width:100%;border-collapse:collapse;margin:18px 0;font-size:13px}
      th,td{border:1px solid #d0d7de;padding:8px 10px;text-align:left}
      th{background:#f0f1f3;font-weight:600}
      img{max-width:100%;height:auto}
    `;
    container.appendChild(style);

    let contentNode;
    if (markdown) {
      contentNode = document.createElement('div');
      contentNode.innerHTML = markdownToHtml(markdown);
    } else {
      if (!messageEl) throw new Error('未找到消息内容');
      if (exportSelection) {
        const frag = getSelectionWithin(messageEl);
        if (!frag) throw new Error('未选中文本，请先选择内容');
        contentNode = document.createElement('div');
        contentNode.appendChild(frag);
      } else {
        contentNode = messageEl.cloneNode(true);
      }
      cleanClonedNode(contentNode);
    }
    container.appendChild(contentNode);
    document.body.appendChild(container);
    return container;
  }

  function html2pdfOptions(filename) {
    return {
      margin: [8, 8, 8, 8],
      filename,
      image: { type: 'jpeg', quality: 0.96 },
      html2canvas: {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false,
        scrollY: 0,
        scrollX: 0
      },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
    };
  }

  async function exportPdfViaHtml2pdf(container, filename) {
    if (typeof window.html2pdf !== 'function') throw new Error('html2pdf 未加载');
    await window.html2pdf().from(container).set(html2pdfOptions(filename)).save();
  }

  async function exportPdfViaIframe(markdown, messageEl, exportSelection, filename) {
    // 保护性超时：适当放宽，避免在慢机/慢盘上误判
    const timeoutMs = 8000;
    const timeoutP = new Promise((_, reject) => setTimeout(() => reject(new Error('iframe 导出超时')), timeoutMs));
    return Promise.race([_exportPdfViaIframeCore(markdown, messageEl, exportSelection, filename), timeoutP]);
  }

  async function _exportPdfViaIframeCore(markdown, messageEl, exportSelection, filename) {
    // 使用可见区域内的透明 iframe 避免离屏导致的布局/高度错误
    // 必须通过 web_accessible_resources 暴露库文件供 iframe 加载，避免跨 realm 导致 html2canvas 空白
    const iframe = document.createElement('iframe');
    // 允许脚本、同源与下载，避免 sandbox 阻止保存
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-downloads');
    iframe.style.cssText = 'position:fixed;left:0;top:0;width:800px;height:20px;opacity:0;pointer-events:none;border:0;z-index:-1;';
    iframe.srcdoc = '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body></body></html>';
    document.body.appendChild(iframe);

    await new Promise((resolve) => {
      if (iframe.contentDocument?.readyState === 'complete') return resolve();
      iframe.onload = () => resolve();
    });
    log('iframe 初始完成');

    const doc = iframe.contentDocument;
    const head = doc.head;
    const body = doc.body;

    // 注入干净样式：白底黑字，避免宿主站 CSS 干扰
    const styleEl = doc.createElement('style');
    styleEl.textContent = `
      :root{ color-scheme: light; }
      *{ box-sizing: border-box; color:#000 !important; }
      html,body{ margin:0; padding:0; background:#fff; }
      body{ padding:24px; font:14px/1.65 "Microsoft YaHei","SimHei","黑体",sans-serif; }
      h1{ font-size:22px; margin:24px 0 12px; font-weight:600; }
      h2{ font-size:20px; margin:20px 0 10px; font-weight:600; }
      h3{ font-size:18px; margin:18px 0 8px; font-weight:600; }
      p{ margin:12px 0; white-space:pre-wrap; word-wrap:break-word; }
      a{ color:#0969da; text-decoration:none; }
      a:hover{ text-decoration:underline; }
      code{ font-family:"JetBrains Mono","Consolas","SFMono-Regular",monospace; background:#f6f8fa; border:1px solid #d0d7de; border-radius:4px; padding:0 .35em; }
      pre{ background:#f6f8fa; border:1px solid #d0d7de; border-radius:8px; padding:16px; overflow:auto; white-space:pre-wrap; word-wrap:break-word; margin:18px 0; }
      pre code{ background:none; border:none; padding:0; }
      ul,ol{ margin:12px 0 12px 24px; padding:0; }
      li{ margin:6px 0; }
      blockquote{ margin:16px 0; padding:10px 16px; border-left:4px solid #d0d7de; background:#f8f8f8; border-radius:6px; color:#444; }
      table{ width:100%; border-collapse:collapse; margin:18px 0; font-size:13px; }
      th,td{ border:1px solid #d0d7de; padding:8px 10px; text-align:left; }
      th{ background:#f0f1f3; font-weight:600; }
      img{ max-width:100%; height:auto; }
    `;
    head.appendChild(styleEl);
    log('iframe 样式注入完成');

    // 构建内容根节点
    let contentRoot = doc.createElement('div');
    if (markdown) {
      contentRoot.innerHTML = markdownToHtml(markdown);
    } else {
      if (!messageEl) throw new Error('未找到消息内容');
      if (exportSelection) {
        const frag = getSelectionWithin(messageEl);
        if (!frag) throw new Error('未选中文本');
        contentRoot.appendChild(frag);
      } else {
        contentRoot = messageEl.cloneNode(true);
      }
      try { cleanClonedNode(contentRoot); } catch {}
    }
    body.appendChild(contentRoot);
    log('内容节点装载完成', { markdown: !!markdown });

    // 两帧后测量并扩展 iframe 高度，确保布局稳定
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    let rect = contentRoot.getBoundingClientRect();
    let attempts = 0;
    while (rect.height < 2 && attempts < 5) {
      await new Promise(r => requestAnimationFrame(r));
      rect = contentRoot.getBoundingClientRect();
      attempts += 1;
    }
    let measuredHeight = rect.height;
    if (measuredHeight < 2) {
      const fallbackHeight = Math.max(
        contentRoot.scrollHeight || 0,
        contentRoot.offsetHeight || 0,
        contentRoot.clientHeight || 0,
        0
      );
      if (fallbackHeight >= 2) {
        measuredHeight = fallbackHeight;
      } else {
        measuredHeight = 600;
      }
      warn('iframe 内容高度异常，使用兜底高度', {
        rectHeight: rect.height,
        scrollHeight: contentRoot.scrollHeight,
        offsetHeight: contentRoot.offsetHeight,
        clientHeight: contentRoot.clientHeight,
        fallback: measuredHeight
      });
    }
    iframe.style.height = Math.ceil(measuredHeight + 48) + 'px';
    log('内容测量完成', { height: measuredHeight });

    // 加载 iframe 内库并等待就绪（内联注入，避免 <script src> 被 CSP/Sandbox 拦截）
    const ifw = await loadLibsInIframe(doc);
    log('iframe 库就绪', { hasH2C: !!ifw.html2canvas, hasJsPDF: !!(ifw.jspdf?.jsPDF || ifw.jsPDF) });
    const JsPDFCtor = ifw.jspdf?.jsPDF || ifw.jsPDF;
    if (!JsPDFCtor || !ifw.html2canvas) throw new Error('iframe 内库未挂载 (html2canvas/jsPDF)');

    // 使用 iframe 自己的 html2canvas 渲染，避免跨 realm 空白
    const canvas = await ifw.html2canvas(contentRoot, {
      backgroundColor: '#ffffff',
      scale: 2,
      useCORS: true,
      logging: false,
      scrollX: 0,
      scrollY: 0
    });
    log('canvas 渲染完成', { width: canvas.width, height: canvas.height });

    // 分页写入 A4 PDF
    const pdf = new JsPDFCtor({ unit: 'pt', format: 'a4', compress: true });
    const a4w = 595.28;
    const a4h = 841.89;
    const cw = canvas.width;
    const ch = canvas.height;
    const scale = a4w / cw;
    const pagePx = Math.floor(a4h / scale);
    const tmp = doc.createElement('canvas');
    const ctx = tmp.getContext('2d');

    let offset = 0;
    let page = 0;
    while (offset < ch) {
      const sliceH = Math.min(pagePx, ch - offset);
      tmp.width = cw;
      tmp.height = sliceH;
      ctx.clearRect(0, 0, cw, sliceH);
      ctx.drawImage(canvas, 0, offset, cw, sliceH, 0, 0, cw, sliceH);
      const img = tmp.toDataURL('image/jpeg', 0.92);
      if (page > 0) pdf.addPage();
      pdf.addImage(img, 'JPEG', 0, 0, a4w, sliceH * scale);
      offset += sliceH;
      page += 1;
    }
    log('分页写入完成', { pages: page });
    // 优先在 iframe 内保存；若被浏览器策略阻止，则在父页面兜底下载
    try {
      const maybePromise = pdf.save && pdf.save(filename, { returnPromise: true });
      if (maybePromise && typeof maybePromise.then === 'function') {
        await maybePromise;
      }
    } catch (e) {
      try {
        const blob = pdf.output('blob');
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 200);
      } catch (e2) {
        throw e2;
      }
    }
    iframe.remove();
  }

  // 在 iframe 内加载库（内联注入文本），并轮询直到 html2canvas 和 jsPDF 就绪
  async function loadLibsInIframe(doc) {
    const ifw = doc.defaultView;
    const getURL = (p) => (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL)
      ? chrome.runtime.getURL(p)
      : p;
    async function inlineScript(url) {
      const res = await fetch(getURL(url), { cache: 'no-store' });
      if (!res.ok) throw new Error('fetch 失败: ' + url);
      const code = await res.text();
      const s = doc.createElement('script');
      s.textContent = code;
      (doc.head || doc.body).appendChild(s);
    }
    log('加载 iframe 库（内联注入）');
    await inlineScript('libs/html2canvas.min.js');
    log('html2canvas 加载完成（内联）');
    await inlineScript('libs/jspdf.umd.min.js');
    log('jspdf.umd 加载完成（内联）');
    // 如需 html2pdf 的高级分页，可再加载：
    // await inlineScript('libs/html2pdf.bundle.min.js');

    if (ifw.jspdf?.jsPDF && !ifw.jsPDF) {
      try { ifw.jsPDF = ifw.jspdf.jsPDF; } catch (_) {}
    }

    for (let i = 0; i < 50; i++) { // 最长 ~5s
      const readyH2C = !!ifw.html2canvas;
      const readyPDF = !!(ifw.jspdf?.jsPDF || ifw.jsPDF);
      if (readyH2C && readyPDF) return ifw;
      await new Promise(r => setTimeout(r, 100));
    }
    throw new Error('iframe 内库未就绪(html2canvas/jsPDF)');
  }

  async function getMarkdownFromMessage(messageEl, menuEl) {
    // A. 优先使用页面桥拦截，不读系统剪贴板
    const copyButton = findCopyButton(messageEl) || (menuEl && findCopyItemInMenu(menuEl));
    if (copyButton) {
      const bridgeWait = waitMarkdownFromBridge(1500);
      copyButton.click();
      const got = await bridgeWait;
      if (got && got.text && got.text.trim()) {
        log('bridge 捕获到文本', { kind: got.kind, via: got.via, len: got.text.length });
        return got.text;
      }
    }

    // B. 新兜底：不依赖剪贴板权限
    //    1) 若菜单项存在，再触发一次 Copy 并仅等待 bridge（再 800ms）
    const menuCopyItem = menuEl ? findCopyItemInMenu(menuEl) : null;
    if (menuCopyItem && !copyButton) {
      const bridgeWait2 = waitMarkdownFromBridge(800);
      menuCopyItem.click();
      const got2 = await bridgeWait2;
      if (got2 && got2.text && got2.text.trim()) return got2.text;
    }

    //    2) 最后兜底：直接从 DOM 克隆导出（不一定是完美 Markdown，但可保证导出）
    try {
      const textPreview = getTextPreview(messageEl);
      return textPreview || '';
    } catch (_) {
      return '';
    }
  }

  function findCopyItemInMenu(menuEl) {
    const items = menuEl.querySelectorAll('[role="menuitem"]');
    for (const item of items) {
      if (item.dataset && item.dataset.mdxAction) continue;
      const text = (item.textContent || '').trim().toLowerCase();
      if (!text) continue;
      if (text.includes('copy') || text.includes('复制')) {
        return item;
      }
    }
    return null;
  }

  async function triggerCopyElement(element) {
    if (!(element instanceof HTMLElement)) return '';
    const copyPromise = waitClipboardFromCopyOnce();
    element.click();
    const result = await copyPromise;
    if (result && result.trim()) return result;
    try {
      const text = await navigator.clipboard.readText();
      return text || '';
    } catch (_) {
      return '';
    }
  }

  function waitClipboardFromCopyOnce(timeout = COPY_TIMEOUT) {
    return new Promise((resolve) => {
      let resolved = false;
      const handler = (event) => {
        resolved = true;
        document.removeEventListener('copy', handler, true);
        let text = '';
        try {
          text = event.clipboardData?.getData('text/markdown') ||
            event.clipboardData?.getData('text/plain') || '';
        } catch (error) {
          warn('读取 clipboardData 失败', error);
        }
        resolve(text);
      };
      document.addEventListener('copy', handler, true);
      setTimeout(() => {
        if (resolved) return;
        document.removeEventListener('copy', handler, true);
        resolve('');
      }, timeout);
    });
  }

  function getTextPreview(messageEl) {
    if (!messageEl) return '';
    return (messageEl.innerText || messageEl.textContent || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);
  }

  function buildFileName(markdown, fallbackText, ext) {
    let title = '';
    if (markdown) {
      const heading = markdown.match(/^\s*#\s+(.+?)$/m);
      if (heading) {
        title = heading[1].trim();
      } else {
        const plain = markdown.replace(/[#>*`*_\-]|\[(.*?)\]\((.*?)\)/g, '')
          .replace(/\s+/g, ' ')
          .trim();
        title = plain.slice(0, 40);
      }
    }
    if (!title && fallbackText) {
      title = fallbackText.slice(0, 40);
    }
    if (!title) title = '导出';
    title = title
      .replace(/[\\/:*?"<>|]+/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 40);
    const date = new Date().toISOString().slice(0, 10);
    return `chat-${title || '导出'}-${date}.${ext}`;
  }

  async function renderMarkdownToCanvas(markdown) {
    const html = markdownToHtml(markdown || '');
    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-same-origin');
    // 使用视口内透明方式避免离屏导致高度或渲染异常
    iframe.style.cssText = 'position:fixed;left:0;top:0;width:960px;height:10px;opacity:0;pointer-events:none;border:none;';

    const style = `
      <style>
        :root{color-scheme:light;}
        *{box-sizing:border-box;}
        body{margin:0;padding:32px;background:#fff;color:#000;font:14px/1.6 "SimHei","Microsoft YaHei","PingFang SC",sans-serif;}
        h1{font-size:22px;margin:24px 0 12px;font-weight:600;}
        h2{font-size:20px;margin:20px 0 10px;font-weight:600;}
        h3{font-size:18px;margin:18px 0 8px;font-weight:600;}
        h4,h5,h6{margin:16px 0 8px;font-weight:600;}
        p{margin:12px 0;word-wrap:break-word;white-space:pre-wrap;}
        a{color:#0969da;text-decoration:none;}
        a:hover{text-decoration:underline;}
        code{font-family:"JetBrains Mono","Consolas","SFMono-Regular",monospace;background:#f6f8fa;border:1px solid #d0d7de;border-radius:4px;padding:0 .35em;}
        pre{background:#f6f8fa;border:1px solid #d0d7de;border-radius:8px;padding:16px;overflow:auto;white-space:pre-wrap;word-wrap:break-word;margin:18px 0;}
        pre code{background:none;border:none;padding:0;}
        ul,ol{margin:12px 0 12px 24px;padding:0;}
        li{margin:6px 0;}
        blockquote{margin:16px 0;padding:10px 16px;border-left:4px solid #d0d7de;background:#f8f8f8;border-radius:6px;color:#444;}
        table{width:100%;border-collapse:collapse;margin:18px 0;font-size:13px;}
        th,td{border:1px solid #d0d7de;padding:8px 10px;text-align:left;}
        th{background:#f0f1f3;font-weight:600;}
        img{max-width:100%;height:auto;}
      </style>
    `;

    const htmlDoc = `<!DOCTYPE html><html><head><meta charset="utf-8">${style}</head><body>${html}</body></html>`;
    document.body.appendChild(iframe);
    iframe.srcdoc = htmlDoc;

    await new Promise((resolve) => {
      iframe.onload = () => setTimeout(resolve, 400);
    });

    const doc = iframe.contentDocument;
    const target = doc.body;
    const height = target.scrollHeight + 32;
    iframe.style.height = `${height}px`;
    await new Promise((resolve) => setTimeout(resolve, 60));

    if (!window.html2canvas) throw new Error('html2canvas 未加载');
    const canvas = await window.html2canvas(target, {
      backgroundColor: '#ffffff',
      scale: 2,
      useCORS: true,
      allowTaint: true,
      logging: false
    });

    iframe.remove();
    return canvas;
  }

  function markdownToHtml(markdown) {
    const escapeHtml = (str) => str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    const formatInline = (text) => {
      const inlineCodes = [];
      let result = text.replace(/`([^`]+)`/g, (_, code) => {
        const idx = inlineCodes.length;
        inlineCodes.push(`<code>${escapeHtml(code)}</code>`);
        return `__INLINE_CODE_${idx}__`;
      });
      result = escapeHtml(result);
      result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, label, url) => {
        return `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer noopener">${label}</a>`;
      });
      result = result.replace(/(\*\*|__)(.+?)\1/g, '<strong>$2</strong>');
      result = result.replace(/(\*|_)([^*_]+?)\1/g, '<em>$2</em>');
      inlineCodes.forEach((code, idx) => {
        result = result.replace(`__INLINE_CODE_${idx}__`, code);
      });
      result = result.replace(/\n/g, '<br>');
      return result;
    };

    const lines = (markdown || '').replace(/\r\n/g, '\n').split('\n');
    const htmlParts = [];
    let paragraph = [];
    let listBuffer = [];
    let listType = null;
    let blockquoteBuffer = [];
    let inCodeBlock = false;
    let codeLang = '';
    let codeLines = [];
    let i = 0;

    const flushParagraph = () => {
      if (!paragraph.length) return;
      const text = paragraph.join('\n').trim();
      if (text) {
        htmlParts.push(`<p>${formatInline(text)}</p>`);
      }
      paragraph = [];
    };

    const flushList = () => {
      if (!listBuffer.length || !listType) return;
      const items = listBuffer.map((item) => `<li>${formatInline(item)}</li>`).join('');
      htmlParts.push(`<${listType}>${items}</${listType}>`);
      listBuffer = [];
      listType = null;
    };

    const flushBlockquote = () => {
      if (!blockquoteBuffer.length) return;
      const text = blockquoteBuffer.join('\n');
      htmlParts.push(`<blockquote>${formatInline(text)}</blockquote>`);
      blockquoteBuffer = [];
    };

    const flushCodeBlock = () => {
      if (!codeLines.length) return;
      const escaped = escapeHtml(codeLines.join('\n'));
      const langClass = codeLang ? ` class="language-${escapeHtml(codeLang)}"` : '';
      htmlParts.push(`<pre><code${langClass}>${escaped}</code></pre>`);
      codeLines = [];
      codeLang = '';
      inCodeBlock = false;
    };

    const parseTable = (startIndex) => {
      const tableLines = [];
      let idx = startIndex;
      while (idx < lines.length) {
        const line = lines[idx];
        if (!line.trim()) break;
        if (!line.includes('|')) break;
        tableLines.push(line);
        idx += 1;
      }
      if (tableLines.length < 2) {
        return startIndex;
      }
      const header = tableLines[0];
      const divider = tableLines[1];
      if (!/^\s*\|?\s*[-:]+/.test(divider)) {
        return startIndex;
      }
      const rows = tableLines.slice(2);
      const splitRow = (row) => {
        let line = row.trim();
        if (line.startsWith('|')) line = line.slice(1);
        if (line.endsWith('|')) line = line.slice(0, -1);
        return line.split('|').map((cell) => cell.trim());
      };
      const headerCells = splitRow(header);
      const bodyRows = rows.map(splitRow);
      let tableHtml = '<table><thead><tr>';
      headerCells.forEach((cell) => {
        tableHtml += `<th>${formatInline(cell)}</th>`;
      });
      tableHtml += '</tr></thead>';
      if (bodyRows.length) {
        tableHtml += '<tbody>';
        bodyRows.forEach((row) => {
          tableHtml += '<tr>';
          row.forEach((cell) => {
            tableHtml += `<td>${formatInline(cell)}</td>`;
          });
          tableHtml += '</tr>';
        });
        tableHtml += '</tbody>';
      }
      tableHtml += '</table>';
      htmlParts.push(tableHtml);
      return startIndex + tableLines.length - 1;
    };

    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();

      if (trimmed.startsWith('```')) {
        flushParagraph();
        flushList();
        flushBlockquote();
        if (inCodeBlock) {
          flushCodeBlock();
        } else {
          inCodeBlock = true;
          codeLang = trimmed.slice(3).trim();
        }
        i += 1;
        continue;
      }

      if (inCodeBlock) {
        codeLines.push(line);
        i += 1;
        continue;
      }

      if (!trimmed) {
        flushParagraph();
        flushList();
        flushBlockquote();
        i += 1;
        continue;
      }

      if (trimmed.startsWith('#')) {
        flushParagraph();
        flushList();
        flushBlockquote();
        const level = Math.min(trimmed.match(/^#+/)[0].length, 6);
        const text = trimmed.replace(/^#+\s*/, '');
        htmlParts.push(`<h${level}>${formatInline(text)}</h${level}>`);
        i += 1;
        continue;
      }

      if (/^>/.test(trimmed)) {
        flushParagraph();
        flushList();
        blockquoteBuffer.push(trimmed.replace(/^>\s?/, ''));
        if (!(lines[i + 1] && lines[i + 1].trim().startsWith('>'))) {
          flushBlockquote();
        }
        i += 1;
        continue;
      }

      if (/^[-*+]\s+/.test(trimmed)) {
        flushParagraph();
        flushBlockquote();
        if (listType !== 'ul') {
          flushList();
          listType = 'ul';
        }
        listBuffer.push(trimmed.replace(/^[-*+]\s+/, ''));
        if (!(lines[i + 1] && /^[-*+]\s+/.test(lines[i + 1].trim()))) {
          flushList();
        }
        i += 1;
        continue;
      }

      if (/^\d+\.\s+/.test(trimmed)) {
        flushParagraph();
        flushBlockquote();
        if (listType !== 'ol') {
          flushList();
          listType = 'ol';
        }
        listBuffer.push(trimmed.replace(/^\d+\.\s+/, ''));
        if (!(lines[i + 1] && /^\d+\.\s+/.test(lines[i + 1].trim()))) {
          flushList();
        }
        i += 1;
        continue;
      }

      if (trimmed.includes('|') && lines[i + 1] && lines[i + 1].includes('|')) {
        const prevIndex = i;
        const newIndex = parseTable(i);
        if (newIndex !== prevIndex) {
          i = newIndex + 1;
          continue;
        }
      }

      paragraph.push(line);
      if (!(lines[i + 1] && lines[i + 1].trim())) {
        flushParagraph();
      }
      i += 1;
    }

    flushParagraph();
    flushList();
    flushBlockquote();
    flushCodeBlock();

    return htmlParts.join('');
  }

  async function renderDomToCanvas(messageEl, exportSelection) {
    if (!messageEl) throw new Error('未找到消息内容');
    const container = document.createElement('div');
    // 视口内透明隐藏，防止离屏导致某些站点对大负偏移元素进行特殊处理
    container.style.cssText = 'position:fixed;left:0;top:0;opacity:0;pointer-events:none;width:960px;background:#fff;padding:32px;color:#000;';

    let targetNode;
    if (exportSelection) {
      const selectionFragment = getSelectionWithin(messageEl);
      if (!selectionFragment) {
        throw new Error('未选中文本，请先选择内容');
      }
      targetNode = document.createElement('div');
      targetNode.appendChild(selectionFragment);
    } else {
      targetNode = messageEl.cloneNode(true);
    }

    cleanClonedNode(targetNode);
    container.appendChild(targetNode);
    document.body.appendChild(container);

    if (!window.html2canvas) throw new Error('html2canvas 未加载');
    const canvas = await window.html2canvas(container, {
      backgroundColor: '#ffffff',
      scale: 2,
      useCORS: true,
      allowTaint: true,
      logging: false
    });

    container.remove();
    return canvas;
  }

  function cleanClonedNode(root) {
    const removeSelectors = ['textarea', 'input', 'button', '.md-export-actions', '[contenteditable="true"]'];
    removeSelectors.forEach((sel) => {
      root.querySelectorAll(sel).forEach((el) => el.remove());
    });
  }

  function getSelectionWithin(container) {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return null;
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < selection.rangeCount; i += 1) {
      const range = selection.getRangeAt(i);
      if (container.contains(range.commonAncestorContainer)) {
        fragment.appendChild(range.cloneContents());
      }
    }
    return fragment.childNodes.length ? fragment : null;
  }

  // 已移除基于 canvas 的 PDF 生成，统一走 html2pdf DOM 路径，避免空白问题

  async function saveCanvasAsPng(canvas, fileName) {
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((b) => {
        if (b) resolve(b);
        else reject(new Error('PNG 生成失败'));
      }, 'image/png');
    });
    downloadBlob(blob, fileName);
  }

  function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      link.remove();
    }, 200);
  }

})();
