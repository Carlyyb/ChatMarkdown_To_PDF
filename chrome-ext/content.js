(() => {
  'use strict';

  const DEBUG = false;
  const log = DEBUG ? console.log.bind(console, '[ChatMD2PDF]') : () => {};
  const warn = console.warn.bind(console, '[ChatMD2PDF]');

  const COPY_TIMEOUT = 2000;
  const LIB_RETRY = 20;
  const LIB_INTERVAL = 100;
  const MENU_GROUP_CLASS = 'mdx-export-group';
  const MENU_ITEM_CLASS = 'mdx-menu-item';

  const provider = detectProvider();
  log('provider', provider);

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

    const baseItems = menuEl.querySelectorAll('[role="menuitem"]');
    if (!baseItems || baseItems.length < 2) return;

    setTimeout(() => {
      if (menuEl.querySelector(`.${MENU_GROUP_CLASS}`)) return;
      injectMenuItems(menuEl, messageEl);
    }, 50);
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
    const candidates = [
      '.agent-turn',
      '[data-message-author-role="assistant"]',
      '[data-message-id]',
      '.presented-response-container',
      '.model-response-text',
      '.markdown.markdown-main-panel'
    ];
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
    await checkLibs();

    const textPreview = getTextPreview(messageEl);
    let markdown = null;
    let canvas = null;
    let usedMarkdown = false;

    if (action !== 'selection') {
      markdown = await getMarkdownFromMessage(messageEl, menuEl);
      if (markdown) {
        try {
          canvas = await renderMarkdownToCanvas(markdown);
          usedMarkdown = true;
        } catch (error) {
          warn('Markdown 渲染失败，回退 DOM', error);
          canvas = null;
        }
      }
    }

    closeMenu(menuEl);

    if (!canvas) {
      canvas = await renderDomToCanvas(messageEl, action === 'selection');
    }

    if (action === 'pdf') {
      const fileName = buildFileName(markdown, textPreview, 'pdf');
      await saveCanvasAsPdf(canvas, fileName);
      log('PDF 导出完成', { usedMarkdown });
    } else {
      const fileName = buildFileName(markdown, textPreview, 'png');
      await saveCanvasAsPng(canvas, fileName);
      log('PNG 导出完成', { usedMarkdown });
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

  function checkLibs() {
    const ready = () => Boolean((window.jspdf && window.jspdf.jsPDF) || window.jsPDF);
    const html2canvasReady = () => typeof window.html2canvas === 'function';
    if (ready() && html2canvasReady()) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const timer = setInterval(() => {
        attempts += 1;
        if (ready() && html2canvasReady()) {
          clearInterval(timer);
          resolve();
          return;
        }
        if (attempts >= LIB_RETRY) {
          clearInterval(timer);
          reject(new Error('库加载超时，请刷新页面'));
        }
      }, LIB_INTERVAL);
    });
  }

  async function getMarkdownFromMessage(messageEl, menuEl) {
    const copyButton = findCopyButton(messageEl);
    if (copyButton) {
      const md = await triggerCopyElement(copyButton);
      if (md) return md;
    }

    const menuCopyItem = menuEl ? findCopyItemInMenu(menuEl) : null;
    if (menuCopyItem) {
      const md = await triggerCopyElement(menuCopyItem);
      if (md) return md;
    }

    try {
      const text = await navigator.clipboard.readText();
      if (text && text.trim()) return text;
    } catch (error) {
      warn('读取系统剪贴板失败', error);
    }
    return null;
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
    iframe.style.cssText = 'position:fixed;left:-99999px;top:-99999px;width:960px;height:10px;visibility:hidden;border:none;';

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
    container.style.cssText = 'position:fixed;left:-99999px;top:-99999px;width:960px;background:#fff;padding:32px;color:#000;';

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

  async function saveCanvasAsPdf(canvas, fileName) {
    const JsPDFCtor = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
    if (!JsPDFCtor) throw new Error('jsPDF 未就绪');
    const pdf = new JsPDFCtor({ unit: 'pt', format: 'a4', compress: true });
    const a4w = 595.28;
    const a4h = 841.89;
    const cw = canvas.width;
    const ch = canvas.height;
    const scale = a4w / cw;
    const pagePx = Math.floor(a4h / scale);
    const tempCanvas = document.createElement('canvas');
    const ctx = tempCanvas.getContext('2d');

    let offset = 0;
    let pageIndex = 0;
    while (offset < ch) {
      const sliceHeight = Math.min(pagePx, ch - offset);
      tempCanvas.width = cw;
      tempCanvas.height = sliceHeight;
      ctx.clearRect(0, 0, cw, sliceHeight);
      ctx.drawImage(canvas, 0, offset, cw, sliceHeight, 0, 0, cw, sliceHeight);
      const imgData = tempCanvas.toDataURL('image/jpeg', 0.92);
      if (pageIndex > 0) {
        pdf.addPage();
      }
      pdf.addImage(imgData, 'JPEG', 0, 0, a4w, sliceHeight * scale);
      offset += sliceHeight;
      pageIndex += 1;
    }
    pdf.save(fileName);
  }

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
