// ===== 设置面板逻辑 =====

const i18n = chrome.i18n.getMessage;

// 加载当前设置
async function loadSettings() {
  const defaults = {
    language: 'en',
    font: 'SimHei'
  };
  
  const settings = await chrome.storage.sync.get(defaults);
  
  document.getElementById('language').value = settings.language;
  document.getElementById('font').value = settings.font;
  
  // 更新 UI 文本
  updateUIText();
}

// 更新 UI 文本（国际化）
function updateUIText() {
  document.getElementById('title').textContent = i18n('settingsTitle');
  document.getElementById('langLabel').textContent = i18n('languageLabel');
  document.getElementById('fontLabel').textContent = i18n('fontLabel');
  document.getElementById('saveBtn').textContent = i18n('saveButton');
  
  // 更新字体选项文本
  const fontSelect = document.getElementById('font');
  fontSelect.options[0].textContent = i18n('fontSimHei');
  fontSelect.options[1].textContent = i18n('fontMicrosoftYaHei');
  fontSelect.options[2].textContent = i18n('fontArial');
  fontSelect.options[3].textContent = i18n('fontTimesNewRoman');
  fontSelect.options[4].textContent = i18n('fontCourier');
}

// 保存设置
async function saveSettings() {
  const settings = {
    language: document.getElementById('language').value,
    font: document.getElementById('font').value
  };
  
  await chrome.storage.sync.set(settings);
  
  // 显示成功消息
  const msg = document.getElementById('message');
  msg.textContent = i18n('savedMessage');
  msg.className = 'message success show';
  
  setTimeout(() => {
    msg.classList.remove('show');
  }, 2000);
  
  // 重新加载 UI 文本（语言可能已更改）
  setTimeout(() => {
    updateUIText();
  }, 300);
}

// 事件监听
document.getElementById('saveBtn').addEventListener('click', saveSettings);

// 语言切换时立即更新 UI
document.getElementById('language').addEventListener('change', () => {
  setTimeout(updateUIText, 100);
});

// 初始化
loadSettings();
