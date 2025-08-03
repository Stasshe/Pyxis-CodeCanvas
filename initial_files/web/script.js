
// タブ切り替え
const tabBtns = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');
tabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    tabContents.forEach(sec => sec.style.display = 'none');
    document.getElementById(`tab-${btn.dataset.tab}`).style.display = '';
    tabBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

// ファイルリスト管理
const fileList = document.getElementById('fileList');
const fileInput = document.getElementById('fileInput');
const editor = document.getElementById('editor');
const previewArea = document.getElementById('previewArea');
const saveBtn = document.getElementById('saveBtn');
const status = document.getElementById('status');
const autosave = document.getElementById('autosave');

let files = {};
let currentFile = null;

function updateFileList() {
  fileList.innerHTML = '';
  Object.keys(files).forEach(name => {
    const li = document.createElement('li');
    li.textContent = name;
    li.className = (name === currentFile) ? 'selected' : '';
    li.onclick = () => selectFile(name);
    fileList.appendChild(li);
  });
}

function selectFile(name) {
  currentFile = name;
  editor.value = files[name];
  updateFileList();
  status.textContent = `${name} を編集中`;
  showPreview();
}

fileInput.addEventListener('change', e => {
  Array.from(e.target.files).forEach(file => {
    const reader = new FileReader();
    reader.onload = function(ev) {
      files[file.name] = ev.target.result;
      currentFile = file.name;
      updateFileList();
      selectFile(file.name);
      saveToStorage();
    };
    reader.readAsText(file);
  });
});

editor.addEventListener('input', () => {
  if (currentFile) {
    files[currentFile] = editor.value;
    showPreview();
    if (autosave.checked) saveToStorage();
  }
});

saveBtn.addEventListener('click', () => {
  if (currentFile) {
    saveToStorage();
    status.textContent = `${currentFile} を保存しました`;
    setTimeout(() => status.textContent = '準備完了', 1200);
  }
});

function showPreview() {
  previewArea.textContent = editor.value;
}

// ローカルストレージ保存・復元
function saveToStorage() {
  localStorage.setItem('files', JSON.stringify(files));
  localStorage.setItem('currentFile', currentFile);
}

function loadFromStorage() {
  const storedFiles = localStorage.getItem('files');
  const storedCurrent = localStorage.getItem('currentFile');
  if (storedFiles) {
    files = JSON.parse(storedFiles);
    currentFile = storedCurrent;
    updateFileList();
    if (currentFile) selectFile(currentFile);
  }
}

autosave.addEventListener('change', () => {
  status.textContent = autosave.checked ? '自動保存ON' : '自動保存OFF';
  setTimeout(() => status.textContent = '準備完了', 1000);
});

window.addEventListener('DOMContentLoaded', () => {
  loadFromStorage();
  tabBtns[0].click(); // 最初はエディタタブ
});
