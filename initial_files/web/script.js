const nameInput = document.querySelector("#name-input");
const updateButton = document.querySelector("#update-button");
const message = document.querySelector("#message");
const countButton = document.querySelector("#count-button");
const themeButton = document.querySelector("#theme-button");
const count = document.querySelector("#count");

let clickCount = 0;

updateButton.addEventListener("click", () => {
  const name = nameInput.value.trim() || "ゲスト";
  message.textContent = `こんにちは、${name}さん。JavaScriptでHTMLの文章を更新しました。`;
});

countButton.addEventListener("click", () => {
  clickCount += 1;
  count.textContent = clickCount;
});

themeButton.addEventListener("click", () => {
  document.body.classList.toggle("dark-theme");
});
