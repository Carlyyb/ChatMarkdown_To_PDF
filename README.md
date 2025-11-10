# MD Export MVP — Web App + Chrome Extension

此项目包含两个程序：

## 1) webapp/ — Markdown 转 PDF/PNG 的 Web 应用

一个零后端的网页应用，可以将 Markdown 粘贴后导出为 **PDF/PNG**（DOCX 功能待实现）。

### 文件结构
```
webapp/
  index.html
  styles.css
  md-export.js
```

### 使用方法
1. 在浏览器中打开 `webapp/index.html`
2. 粘贴 Markdown 内容
3. 点击 **Render** 渲染
4. 点击 **Export PDF** 或 **Export PNG** 导出

所有操作都在客户端完成，无需服务器。

## 2) chrome-ext/ — ChatGPT/Gemini 导出扩展 ⭐ 最新更新

**版本 0.3** - 支持双平台 AI 对话导出

一个 Manifest V3 Chrome 扩展，在每个 **ChatGPT / Gemini** 助手回复下方添加导出按钮。

### ✨ 主要功能

- 🎯 **双平台支持**：ChatGPT + Gemini + AI Studio
- 📄 **单条导出**：导出为 PDF 或 PNG
- ✂️ **选中导出**：仅导出选中的文本
- 🔗 **多选合并**：选择多条回复，合并为一个 PDF
- 🎨 **精美排版**：自动页码、代码高亮
- 🌓 **深色模式**：完美适配深色主题

### 文件结构
```
chrome-ext/
  manifest.json    # 扩展配置（v0.3）
  content.js       # 核心逻辑（8.9KB）
  md.css          # 样式文件（1.5KB）
```

### 安装方法
1. 打开 Chrome/Edge 浏览器
2. 访问 `chrome://extensions/` (或 `edge://extensions/`)
3. 启用 **开发者模式**
4. 点击 **加载已解压的扩展程序**
5. 选择 `chrome-ext/` 文件夹

### 使用方法

#### 🌐 支持的网站
- ✅ ChatGPT: `chat.openai.com/*`, `chatgpt.com/*`
- ✅ Gemini: `gemini.google.com/*`
- ✅ AI Studio: `aistudio.google.com/*`
- 🔜 Claude: `claude.ai/*` (计划中)

#### 📖 操作指南

**单条导出：**
1. 打开 ChatGPT 或 Gemini
2. 鼠标 hover 到助手回复
3. 点击 **"导出 PDF"** 或 **"导出图片"**

**多选合并导出：**
1. 点击多条回复的 **"Select for Merge"** 按钮
2. 选中的消息显示蓝色边框
3. 点击右下角浮动栏的 **"Export Selected (PDF)"**

**选中文本导出：**
1. 在回复中选中一段文本
2. Hover 显示按钮并点击导出
3. 仅导出选中的部分

### 🎬 截图预览

```
ChatGPT 示例：
┌────────────────────────────────┐
│ 这是 AI 的回复内容...          │
│ 包含代码、列表、表格等         │
│                                │
│ [导出 PDF] [导出图片] [Select] │ ← Hover 显示
└────────────────────────────────┘

Gemini 示例：
┌────────────────────────────────┐
│ Gemini 的回复...               │
│ 支持相同的导出功能             │
│                                │
│ [导出 PDF] [导出图片] [Select] │ ← Hover 显示
└────────────────────────────────┘
```

## 功能特性

- ✅ 客户端渲染，无需后端
- ✅ 支持导出 PDF 和 PNG
- ✅ 支持选择性导出（Chrome 扩展）
- ✅ 多选合并导出（v0.2+）
- ✅ 双平台支持（v0.2+）
- ✅ 页码自动生成
- ✅ 支持多种纸张尺寸（A4、US Letter、US Legal）
- 🚧 DOCX 导出（计划中）

## 技术栈

- [marked.js](https://marked.js.org/) - Markdown 解析器
- [html2pdf.js](https://github.com/eKoopmans/html2pdf.js) - HTML 转 PDF/PNG
- 原生 JavaScript - 无框架依赖

## 📋 版本历史

### v0.3 (2025-11-10) 🆕
- ✨ 新增 AI Studio 支持 (`aistudio.google.com`)
- 🔧 优化 Gemini 选择器（`.presented-response-container`）
- 🔧 模块化 Provider 架构（更易扩展）
- 🐛 修复按钮重复注入问题
- 📚 新增详细测试指南

### v0.2 (2025-11-09)
- ✨ 新增 Gemini 支持
- ✨ 新增多选合并导出功能
- 🔧 文件名优化（`ai-export-*`, `ai-merged-*`）

### v0.1 (2025-11-08)
- ✨ 初始版本
- ✅ ChatGPT 单条导出
- ✅ 选中文本导出

## 🧪 测试

详见 [TESTING.md](./TESTING.md) 获取完整测试指南。

快速检查：
```bash
✅ ChatGPT 单条导出 PDF/PNG
✅ Gemini 单条导出 PDF/PNG
✅ 多选合并导出（3+ 条消息）
✅ 选中文本导出
✅ Hover 动画流畅
✅ 深色模式样式正确
```

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

### 添加新平台支持

修改 `chrome-ext/content.js`：

```javascript
// 1. 添加平台检测
function isClaudeHost() {
  return /(^|\.)claude\.ai$/.test(location.hostname);
}

// 2. 添加选择器配置
const CLAUDE = {
  messageItems: '.your-selector',
  messageContent(node) { /* ... */ },
  injectAfter(node) { /* ... */ }
};

// 3. 更新 detectProvider() 和 scanAndInject()
```

## 📄 许可证

MIT License

## 隐私说明

所有操作都在客户端完成，不会发送任何数据到外部服务器。

---

**Made with ❤️ for AI enthusiasts** | [更新日志](./CHANGELOG.md) | [测试指南](./TESTING.md)
