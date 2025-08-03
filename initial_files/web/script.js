document.getElementById('btn').addEventListener('click', function() {
  const result = document.getElementById('result');
  result.textContent = 'ボタンがクリックされました！';
  result.style.color = '#0dbc79';
  setTimeout(() => {
    result.textContent = '';
    result.style.color = '#bc3fbc';
  }, 2000);
});

// ページロード時のサンプル
window.addEventListener('DOMContentLoaded', function() {
  const result = document.getElementById('result');
  result.textContent = 'ページが正常に読み込まれました。';
  setTimeout(() => {
    result.textContent = '';
  }, 1500);
});
