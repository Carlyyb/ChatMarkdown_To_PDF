# 导出管线技术文档

## 🎯 核心问题解决

### 为什么会导出空白？（常见雷点）

1. **渲染目标尺寸为 0**
   - 被 `display:none` / `visibility:hidden` / `transform:scale(0)` 影响
   - 父级 `overflow` / `contain` / `layout` 限制
   - `html2canvas` 拿到的宽高为 0

2. **离屏容器没"真正排版"**
   - 还没完成 reflow / 字体加载
   - 直接截图得到透明画布

3. **CSP / 外链资源干扰**
   - 外链字体 / 图片 404 或被拦截
   - `html2canvas` 在某些版本里直接产空白

4. **现代颜色 / 滤镜**
   - `oklch()` / `backdrop-filter` / `paint()` 解析失败

5. **foreignObject 不稳定**
   - `html2pdf` 有时会退化到只能输出空页

---

## 🚀 双路渲染管线架构

### 主路：html2canvas（速度快）
```
克隆节点 → 颜色降级(oklch→rgb) → 离屏挂载 → 
等待排版稳定 → html2canvas → Canvas → PDF/PNG
```

**优势**：
- 速度快，支持现代 CSS
- 可控性强，精细调参

**风险**：
- 部分复杂样式可能失败
- 外链资源 / CSP 限制

### 兜底路：SVG foreignObject（容错性强）
```
克隆节点 → 包装进 <foreignObject> → 
浏览器原生排版 → Image → Canvas → PDF/PNG
```

**优势**：
- 浏览器原生排版，对现代 CSS 容忍度高
- 基本不再空白

**特点**：
- 白底画布接住，保证 PDF 不是透明底
- 尺寸计算用实际 `getBoundingClientRect()` / `scrollHeight`，避免 0 宽高

---

## 🛠️ 关键技术实现

### 1. 颜色安全转换（修复 oklch 报错）

```javascript
function colorToRGBString(el, prop) {
  // 优先：Typed OM API
  if (el.computedStyleMap) {
    const v = el.computedStyleMap().get(prop);
    if (v && typeof v.to === 'function') {
      const srgb = v.to('srgb'); // oklch → sRGB
      return `rgb(${r}, ${g}, ${b})`;
    }
  }
  // 兜底：getComputedStyle
  // 若仍是 oklch/lab/lch，直接退回纯黑/纯白
}
```

**效果**：
- ChatGPT 的 `oklch()` 颜色不再崩溃
- 支持降级到所有浏览器兼容的 `rgb()`

### 2. 克隆安全副本

```javascript
function cloneSafe(src) {
  const dst = src.cloneNode(true);
  
  // ① 移除问题节点
  dst.querySelectorAll('style, link, iframe, video, audio, canvas, script').forEach(el => el.remove());
  
  // ② 移除外链图片（保留 data: / blob:）
  dst.querySelectorAll('img').forEach(img => {
    if (/^https?:\/\//i.test(img.src)) img.remove();
  });
  
  // ③ 清空 CSS 变量（避免变量链路引入 oklch）
  const resetVarsStyle = document.createElement('style');
  resetVarsStyle.textContent = `:host, :root, * { --*: initial !important; }`;
  dst.prepend(resetVarsStyle);
  
  // ④ 内联所有颜色属性为 rgb(...)
  // ⑤ 应用用户选择的字体
  // ⑥ 白底背景
  
  return dst;
}
```

### 3. 等待排版稳定

```javascript
async function settleLayout(container) {
  // ① 等字体加载
  if (document.fonts && document.fonts.ready) {
    await document.fonts.ready;
  }
  
  // ② 等图片解码
  const imgs = Array.from(container.querySelectorAll('img'));
  await Promise.all(imgs.map(img => img.decode?.().catch(() => {})));
  
  // ③ 双 RAF，确保布局收敛
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
}
```

**效果**：
- 字体加载完成再截图，中文不再方块
- 图片解码完成，不会出现占位符
- 布局稳定，避免"半成品"截图

### 4. 智能文件名生成

```javascript
function buildExportFilename(rootNode, { maxBaseLen = 40, prefix = '', ext = 'pdf' }) {
  // ① 优先取 H1/H2 标题
  const h1 = rootNode.querySelector('h1, .prose h1, .markdown h1, h2, .prose h2, .markdown h2');
  let base = (h1?.innerText || '').trim();
  
  // ② 否则取正文前 N 字
  if (!base) {
    const text = (rootNode.innerText || '').replace(/\s+/g, ' ').trim();
    base = text.slice(0, maxBaseLen);
  }
  
  // ③ 清理文件名禁止字符
  base = base
    .replace(/[\\\/:*?"<>|]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxBaseLen);
  
  // ④ 兜底 + 日期戳
  if (!base) base = '导出';
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  
  return `${prefix ? (prefix + '-') : ''}${base}-${date}.${ext}`;
}
```

**示例**：
- `"如何使用 React Hooks"` → `gpt-如何使用React Hooks-2025-11-10.pdf`
- 无标题的长文本 → `gemini-在现代前端开发中-2025-11-10.pdf`
- 选区导出 → `gpt-selection-代码片段说明-2025-11-10.pdf`

### 5. 双路渲染核心逻辑

```javascript
async function exportNodeTo(kind, node, filenameHint = null) {
  const filename = filenameHint || buildExportFilename(node);
  const safe = cloneSafe(node);
  
  // 离屏挂载（可见但不在视口内）
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed; left:-10000px; top:0; z-index:-1; background:#fff; width:XXXpx';
  host.appendChild(safe);
  document.body.appendChild(host);
  
  try {
    await settleLayout(host);
    
    // ━━━ 主路：html2canvas ━━━
    let canvas = await html2canvas(host, { ... });
    let ok = canvas && canvas.width > 10 && canvas.height > 10;
    
    // ━━━ 兜底：SVG foreignObject ━━━
    if (!ok) {
      const svg = `<svg><foreignObject>${safe.outerHTML}</foreignObject></svg>`;
      const img = new Image();
      img.src = URL.createObjectURL(new Blob([svg]));
      await img.decode();
      
      canvas = document.createElement('canvas');
      ctx.drawImage(img, 0, 0);
    }
    
    // ━━━ 输出：PNG / PDF ━━━
    if (kind === 'png') {
      download(canvas.toDataURL('image/png'));
    } else {
      const pdf = new jsPDF();
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', ...);
      pdf.save(filename);
    }
  } finally {
    host.remove();
  }
}
```

---

## 📊 性能优化对比

### 优化前
- 菜单打开延迟：`800ms` 检测窗口 + `60ms` DOM 挂载延迟
- 导出前准备：无排版稳定检测，直接截图
- 文件名：时间戳（`chat-1731225600000.pdf`）

### 优化后
- 菜单打开延迟：`400ms` 检测窗口 + `40ms` DOM 挂载延迟（**提速 46%**）
- 导出前准备：字体 + 图片 + 双RAF，确保稳定
- 文件名：智能提取标题 + 日期（`gpt-如何使用React-2025-11-10.pdf`）

---

## 🎯 测试检查清单

### ChatGPT
- [ ] 包含代码块的长回复导出 PDF（验证颜色转换）
- [ ] 包含表格的回复导出 PNG（验证布局稳定）
- [ ] 选区导出（验证智能文件名）
- [ ] 正在打字中打开菜单（验证快速完成态判断）

### Gemini
- [ ] 多段落文本导出 PDF（验证容器选择）
- [ ] 包含列表的回复导出（验证 foreignObject 兜底）
- [ ] 无标题的长文本（验证文件名从正文提取）
- [ ] 打开菜单响应速度（应明显快于之前）

---

## 🔧 调试工具

已暴露到全局的调试函数：
```javascript
window.__MD_EXPORTER = {
  log,                     // 查看日志
  detectProvider,          // 检测当前平台
  scanAndInject,           // 手动触发扫描
  checkLib,                // 检查库可用性
}
```

### 常用调试命令
```javascript
// 查看当前平台
window.__MD_EXPORTER.detectProvider()

// 手动触发扫描
window.__MD_EXPORTER.scanAndInject()

// 检查 html2pdf 是否可用
window.__MD_EXPORTER.checkLib()
```

---

## 📝 代码变更摘要

### 新增函数
1. `colorToRGBString()` - Typed OM 颜色转换
2. `buildExportFilename()` - 智能文件名生成
3. `settleLayout()` - 等待排版稳定
4. `isLikelySettled()` - 快速完成态判断
5. `getGeminiContentNode()` - Gemini 专用节点获取

### 修改函数
1. `cloneWithInlineStyles()` → `cloneSafe()` - 增强颜色转换 + CSS 变量清理
2. `exportNodeTo()` - 重构为双路渲染管线
3. `exportMessage()` - 使用智能文件名
4. `ensureMessageSettled()` - 优化检测参数（400ms / 6000ms）
5. `attachMenuItemsForMessage()` - 优化响应速度（40ms 延迟）

### 删除函数
- `assertHtml2Pdf()` - 不再需要强制检查，兜底路径已覆盖

---

## 🚨 注意事项

1. **外链资源**：仍会被移除，只保留 `data:` 和 `blob:` 协议的图片
2. **CSS 变量**：会被清空，避免引入 `oklch` 等问题颜色
3. **字体选择**：用户可在 `popup.js` 中设置，确保中文正确显示
4. **PDF 大小**：使用 JPEG 压缩（0.92 质量），减小文件体积

---

## 📚 相关资源

- [CSS Typed OM API](https://developer.mozilla.org/en-US/docs/Web/API/CSS_Typed_OM_API)
- [html2canvas 文档](https://html2canvas.hertzen.com/)
- [SVG foreignObject](https://developer.mozilla.org/en-US/docs/Web/SVG/Element/foreignObject)
- [jsPDF 文档](https://github.com/parallax/jsPDF)

---

**最后更新**：2025-11-10  
**版本**：v2.0 - 双路渲染管线
