// bridge.js (runs in page context)
(() => {
  const MARK = '__CHATMD2PDF_BRIDGE__';
  const POST = (payload) => {
    try { window.postMessage({ source: MARK, ...payload }, '*'); } catch {}
  };

  // 1) 拦截 DataTransfer.setData，拿到 'text/markdown' 的内容
  try {
    const proto = window.DataTransfer && window.DataTransfer.prototype;
    if (proto && !proto.__chatmd2pdf_patched) {
      const rawSetData = proto.setData;
      proto.setData = function(type, value) {
        try {
          if (typeof type === 'string' && typeof value === 'string') {
            const t = type.toLowerCase();
            if (t.includes('text/markdown')) {
              POST({ type: 'CHATMD2PDF_MARKDOWN', text: value, via: 'DataTransfer.setData' });
            } else if (t.includes('text/plain')) {
              POST({ type: 'CHATMD2PDF_PLAIN', text: value, via: 'DataTransfer.setData' });
            }
          }
        } catch {}
        return rawSetData.apply(this, arguments);
      };
      Object.defineProperty(proto, '__chatmd2pdf_patched', { value: true, configurable: false, enumerable: false, writable: false });
    }
  } catch {}

  // 2) 拦截 navigator.clipboard.writeText（若站点直接写字符串）
  try {
    if (navigator.clipboard && !navigator.clipboard.__chatmd2pdf_patched) {
      const rawWrite = navigator.clipboard.writeText?.bind(navigator.clipboard);
      if (rawWrite) {
        navigator.clipboard.writeText = async function(str) {
          try {
            if (typeof str === 'string') {
              POST({ type: 'CHATMD2PDF_WRITE', text: str, via: 'clipboard.writeText' });
            }
          } catch {}
          return rawWrite(str);
        };
        Object.defineProperty(navigator.clipboard, '__chatmd2pdf_patched', { value: true, configurable: false, enumerable: false, writable: false });
      }
    }
  } catch {}

  // 3) 作为双保险：捕获 'copy' 事件
  try {
    window.addEventListener('copy', (ev) => {
      try {
        const md = ev.clipboardData?.getData('text/markdown');
        if (md) {
          POST({ type: 'CHATMD2PDF_MARKDOWN', text: md, via: 'copyEvent' });
          return;
        }
        const plain = ev.clipboardData?.getData('text/plain');
        if (plain) {
          POST({ type: 'CHATMD2PDF_PLAIN', text: plain, via: 'copyEvent' });
        }
      } catch {}
    }, true);
  } catch {}
})();
