document.getElementById('fileInput').addEventListener('change', handleFileSelect);
const fileList = document.getElementById('fileList');
const editor = CodeMirror.fromTextArea(document.getElementById('editor'), {
    lineNumbers: true,
    mode: 'javascript',
    theme: 'default'
});
const saveBtn = document.getElementById('saveBtn');
const themeToggle = document.getElementById('themeToggle');

function handleFileSelect(event) {
    const files = event.target.files;
    fileList.innerHTML = '';

    Array.from(files).forEach((file, index) => {
        const listItem = document.createElement('div');
        listItem.className = 'file-item';
        listItem.textContent = file.name;
        listItem.addEventListener('click', () => loadFileContent(file));
        fileList.appendChild(listItem);
    });
}

function loadFileContent(file) {
    const reader = new FileReader();
    reader.onload = function (e) {
        editor.setValue(e.target.result);
    };
    reader.readAsText(file);
}

function saveFile() {
    const blob = new Blob([editor.getValue()], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'edited-file.txt';
    a.click();
}

saveBtn.addEventListener('click', saveFile);

themeToggle.addEventListener('click', () => {
    document.body.classList.toggle('dark-mode');
    editor.setOption('theme', document.body.classList.contains('dark-mode') ? 'darcula' : 'default');
});

document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        saveFile();
    }
});
