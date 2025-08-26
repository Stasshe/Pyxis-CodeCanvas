# Tauri版 Pyxis インストール方法 / Tauri Setup Guide

---

## English: Setup Guide

1. **Install Rust**
   - Download and run "rustup-init.exe" from https://www.rust-lang.org/tools/install
   - Restart your PowerShell or terminal after installation.
   - Check version: `cargo --version`

2. **Install Node.js**
   - Download the latest version from https://nodejs.org/en/
   - Check version: `node -v`

3. **Clone the repository & switch to tauri branch**
   ```sh
   git clone https://github.com/Stasshe/Pyxis-Client-Side-Code-Editor.git
   cd Pyxis-Client-Side-Code-Editor
   git checkout tauri
   ```

4. **Install dependencies**
   ```sh
   npm install
   ```

5. **Launch Tauri app**
   ```sh
   npx tauri dev
   ```

---

## 日本語: インストール手順

1. **Rustのインストール**
   - 公式サイト https://www.rust-lang.org/ja/tools/install から「rustup-init.exe」をダウンロードし、インストール。
   - インストール後、PowerShellやターミナルを再起動。
   - `cargo --version` でバージョン確認。

2. **Node.jsのインストール**
   - https://nodejs.org/ja/ から最新版をインストール。
   - `node -v` でバージョン確認。

3. **リポジトリのクローン & tauriブランチへ切り替え**
   ```sh
   git clone https://github.com/Stasshe/Pyxis-Client-Side-Code-Editor.git
   cd Pyxis-Client-Side-Code-Editor
   git checkout tauri
   ```

4. **依存パッケージのインストール**
   ```sh
   npm install
   ```

5. **Tauriアプリの起動**
   ```sh
   npx tauri dev
   ```
