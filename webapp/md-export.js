const $ = (sel) => document.querySelector(sel);
const mdInput = $("#mdInput");
const preview = $("#preview");

// 本地缓存键名
const CACHE_KEY = 'md-editor-content';
const FONT_CACHE_KEY = 'md-editor-font';

// 从缓存加载内容
function loadFromCache() {
  const cached = localStorage.getItem(CACHE_KEY);
  if (cached) {
    return cached;
  }
  // 默认示例
  return `# Sample

- Supports **bold/italic**, tables, code.
- Click Render → Export PDF.

\n\n## Code
\n\n\`\`\`js
console.log('Hello MD → PDF');
\`\`\`
`;
}

// 保存到缓存
function saveToCache() {
  localStorage.setItem(CACHE_KEY, mdInput.value);
}

// 加载字体偏好
function loadFontPreference() {
  const cached = localStorage.getItem(FONT_CACHE_KEY);
  if (cached) {
    document.getElementById('fontFamily').value = cached;
  }
}

// 保存字体偏好
function saveFontPreference() {
  const font = document.getElementById('fontFamily').value;
  localStorage.setItem(FONT_CACHE_KEY, font);
}

// 初始化
mdInput.value = loadFromCache();
loadFontPreference();

function render() {
  const raw = mdInput.value;
  preview.innerHTML = marked.parse(raw, { mangle: false, headerIds: true });
}

function currentOptions() {
  const paper = document.getElementById('paper').value; // a4 | letter | legal
  const isA4 = paper === 'a4';
  const format = isA4 ? 'a4' : (paper === 'letter' ? 'letter' : 'legal');

  return {
    margin: [8, 8, 8, 8],
    filename: `markdown-export-${Date.now()}.pdf`,
    image: { type: 'jpeg', quality: 0.96 },
    html2canvas: { 
      scale: 2, 
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false,
      scrollY: 0,
      scrollX: 0
    },
    jsPDF: { unit: 'mm', format, orientation: 'portrait' },
    pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
  };
}

function addPageNumbers(container) {
  // Adds a tiny footer element; html2pdf will rasterize it onto pages
  let footer = container.querySelector('.paged-footer');
  if (!footer) {
    footer = document.createElement('div');
    footer.className = 'paged-footer';
    footer.textContent = 'Page {{page}} of {{pages}}';
    container.appendChild(footer);
  }
}

async function exportPdf() {
  const clone = preview.cloneNode(true);
  const selectedFont = document.getElementById('fontFamily').value;
  const fontFamily = `"${selectedFont}", "Microsoft YaHei", "SimHei", "黑体", sans-serif`;
  
  clone.style.maxWidth = '800px';
  clone.style.margin = '0';
  clone.style.padding = '20px';
  clone.style.backgroundColor = '#ffffff';
  clone.style.color = '#000000';
  clone.style.fontFamily = fontFamily;
  
  // 强制所有文本为黑色
  clone.querySelectorAll('*').forEach(el => {
    el.style.color = '#000000';
  });
  
  // 代码块特殊处理
  clone.querySelectorAll('pre, code').forEach(el => {
    el.style.backgroundColor = '#f6f8fa';
    el.style.color = '#000000';
    el.style.border = '1px solid #d0d7de';
  });
  
  if (document.getElementById('pageNumbers').checked) addPageNumbers(clone);
  await html2pdf().from(clone).set(currentOptions()).save();
}

async function exportPng() {
  const clone = preview.cloneNode(true);
  const selectedFont = document.getElementById('fontFamily').value;
  const fontFamily = `"${selectedFont}", "Microsoft YaHei", "SimHei", "黑体", sans-serif`;
  
  clone.style.maxWidth = '800px';
  clone.style.margin = '0';
  clone.style.padding = '20px';
  clone.style.backgroundColor = '#ffffff';
  clone.style.color = '#000000';
  clone.style.fontFamily = fontFamily;
  clone.style.position = 'absolute';
  clone.style.left = '-9999px';
  
  // 强制所有文本为黑色
  clone.querySelectorAll('*').forEach(el => {
    el.style.color = '#000000';
  });
  
  // 代码块特殊处理
  clone.querySelectorAll('pre, code').forEach(el => {
    el.style.backgroundColor = '#f6f8fa';
    el.style.color = '#000000';
    el.style.border = '1px solid #d0d7de';
  });
  
  document.body.appendChild(clone);
  
  try {
    // 使用 html2canvas 生成图片
    const canvas = await html2canvas(clone, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false,
      scrollY: 0,
      scrollX: 0
    });
    
    const dataUrl = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `markdown-export-${Date.now()}.png`;
    a.click();
  } finally {
    document.body.removeChild(clone);
  }
}

function stubDocx() {
  alert('DOCX export will be added later (e.g., docx library).');
}

// 防抖函数：延迟执行，避免频繁渲染
let renderTimeout;
function autoRender() {
  clearTimeout(renderTimeout);
  renderTimeout = setTimeout(() => {
    render();
    saveToCache(); // 自动保存
  }, 500); // 500ms 延迟
}

// 事件监听
$('#renderBtn').addEventListener('click', render);
$('#exportPdfBtn').addEventListener('click', exportPdf);
$('#exportPngBtn').addEventListener('click', exportPng);
$('#exportDocxBtn').addEventListener('click', stubDocx);

// 自动渲染：监听输入事件
mdInput.addEventListener('input', autoRender);

// 监听字体选择变化
document.getElementById('fontFamily').addEventListener('change', saveFontPreference);

render();
