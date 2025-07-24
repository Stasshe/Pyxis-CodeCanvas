# 🌟 Pyxis - Client-Side IDE & Terminal
## 日本語ver -> [README_ja.md](README_ja.md)

> **The truly client-side IDE with full Node.js runtime and Git support - No server required!**

[![Version](https://img.shields.io/badge/version-0.2.0-blue.svg)](https://github.com/your-username/pyxis)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Web%20%7C%20iPad%20%7C%20Mobile-orange.svg)](README.md)

<p align="center">
    <a href="https://pyxis-code.onrender.com">
        <img src="public/favicon.png" alt="Pyxis Favicon" width="128" height="128" align="center"/>
    </a>
</p>

Pyxis is a revolutionary **client-side IDE** that brings the complete development environment to your browser. Experience the full power of **Node.js runtime**, **Git version control**, and **VS Code-like editing** - all running locally on your device without any server dependency.


## 🚀 What Makes Pyxis Revolutionary?

### 💡 **Full Node.js Runtime in Browser**
- **Run Node.js applications directly in your browser** - No server, no Docker, no installation
- **Execute npm commands, require modules, and run scripts** just like on a desktop
- **Perfect for iPad development** - Write and test Node.js code anywhere, anytime

### 🔧 **Complete Development Environment**
- **VS Code-inspired interface** with tabs, file explorer, and integrated terminal
- **Monaco Editor** with syntax highlighting, autocomplete, and error checking
- **Real-time code editing** with instant feedback and IntelliSense

### 🌿 **Full Git Integration**
- **Complete Git workflow** - init, add, commit, branch, merge, checkout
- **Visual Git history** with interactive commit graph
- **Branch management** with switching and merging capabilities
- **No external Git service required** - all operations run locally

### 📱 **Cross-Platform Excellence**
- **Optimized for iPad** - Touch-friendly interface for mobile development
- **Responsive design** that works on desktop, tablet, and mobile
- **Offline-first** - Work without internet connection

## 🎯 Target Audience

### 👨‍💻 **iPad Developers**
- Developers who want to code on iPad without limitations
- Those seeking a true IDE experience on mobile devices
- Professionals who need Node.js development on the go

### 🎓 **Students & Educators**
- Learning programming without complex setup requirements
- Teaching Node.js and Git in environments without installation privileges
- Quick prototyping and experimentation

### 🚀 **Rapid Prototypers**
- Quick idea validation without environment setup
- Testing code snippets and algorithms instantly
- Sharing runnable code without deployment complexity

### 🌐 **Web Developers**
- Frontend developers exploring full-stack capabilities
- Those working in restricted environments
- Developers seeking lightweight, portable development tools

## ✨ Key Features

### 🖥️ **Integrated Development Environment**
- **LaTeX rendering** for mathematical documents and formulas
- **Multi-pane support** for enhanced productivity
- **Theme color customization** for personalized workspace
- **Mermaid syntax support** - Easily render flowcharts and sequence diagrams in real time
- **Download Git/project files** for easy sharing and backup

### ⚡ **Node.js Runtime Engine**
- **Complete Node.js API compatibility** - fs, path, os, crypto, and more
- **npm module support** with require() functionality
- **Script execution** with real-time output
- **Environment variables** and process management

### 🔄 **Git Version Control**
- **Repository initialization** and cloning capabilities
- **Staging and committing** with author configuration
- **Branch operations** - create, switch, merge, delete
- **History visualization** with commit graphs and diffs
- **Reset and revert** operations with conflict resolution

### 🎨 **User Experience**
- **Drag-and-drop** tab management
- **Resizable panels** for optimal workspace layout
- **Dark/light theme** support
- **Keyboard shortcuts** for power users
- **Auto-save** functionality
- **Multiple monitor layouts** for flexible workspace arrangement
- **Theme color change** for UI personalization

### 💾 **Data Persistence**
- **Download project or Git repository as zip**
- **Import files from local device**

## 🛠️ Technology Stack

### **Frontend Framework**
- **Next.js 15** - React framework with App Router
- **React 19** - Latest React with concurrent features
- **TypeScript** - Type-safe development
- **Tailwind CSS** - Utility-first styling

### **Editor & Terminal**
- **Monaco Editor** - VS Code's editor engine
- **xterm.js** - Full-featured terminal emulator
- **Lightning FS** - File system implementation

### **Runtime & Execution**
- **QuickJS** - JavaScript engine for Node.js emulation
- **node-stdlib-browser** - Node.js standard library polyfills
- **vm-browserify** - Virtual machine for code execution

### **Version Control**
- **isomorphic-git** - Pure JavaScript Git implementation
- **@gitgraph/react** - Git history visualization

## 🚀 Getting Started

### **Quick Start**
1. **Open Pyxis** in your browser
2. **Create a new project** or open an existing one
3. **Start coding** with full Node.js support
4. **Initialize Git** for version control
5. **Run your applications** directly in the browser

### **Example: Hello World Node.js App**
```javascript
// Create app.js
const fs = require('fs');
const path = require('path');

// Write a file
fs.writeFileSync('hello.txt', 'Hello from Pyxis!');

// Read and display
const content = fs.readFileSync('hello.txt', 'utf8');
console.log(content);

// Create a simple HTTP server simulation
const http = require('http');
console.log('Node.js runtime fully functional in browser!');
```

### **Git Workflow Example**
```bash
# Initialize repository
git init

# Add files
git add .

# Commit changes
git commit -m "Initial commit"

# Create and switch to feature branch
git checkout -b feature/new-feature

# Make changes and commit
git add .
git commit -m "Add new feature"

# Switch back to main
git checkout main

# Merge feature
git merge feature/new-feature
```

## 🌍 Use Cases

### **Educational Projects**
- **Computer Science courses** - teach programming without setup barriers
- **Coding bootcamps** - provide consistent development environment
- **Online tutorials** - interactive learning with immediate feedback

### **Professional Development**
- **Mobile development** - full IDE experience on iPad Pro
- **Remote work** - development capabilities without local installation
- **Client demonstrations** - show working code without deployment

### **Research & Experimentation**
- **Algorithm testing** - quick validation of programming concepts
- **Library evaluation** - test npm packages without commitment
- **Proof of concepts** - rapid prototyping capabilities

## 🔮 Future Roadmap

### **Enhanced Runtime Support**
    - **Advanced LaTeX editing and preview**
    - **More multi-monitor workflow enhancements**
    - **Custom theme palette and presets**

- **Import from GitHub** repositories

### **Advanced Development Tools**
- **Debugger integration** with breakpoints
- **Performance profiling** tools
- **Testing framework** integration
- **Package manager** UI

## 📊 Performance & Compatibility

### **Browser Support**
- ✅ **Chrome/Chromium** 90+
- ✅ **Safari** 14+ (optimized for iPad)
- ✅ **Firefox** 88+
- ✅ **Edge** 90+

### **Device Requirements**
- **RAM**: 2GB+ recommended for optimal performance
- **Storage**: IndexedDB support for persistence
- **JavaScript**: ES2020+ support required

## 🤝 Contributing

We welcome contributions! Whether you're:
- 🐛 **Reporting bugs**
- 💡 **Suggesting features**
- 📖 **Improving documentation**
- 🔧 **Submitting code**

Please check our [Contributing Guidelines](CONTRIBUTING.md) for details.

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- **Monaco Editor** team for the excellent code editor
- **isomorphic-git** for bringing Git to the browser
- **QuickJS** for the lightweight JavaScript engine
- **Next.js** team for the amazing React framework

---

<div align="center">

**Made with ❤️ for developers who code everywhere**

[🌐 Try Pyxis Now](https://your-pyxis-url.com) | [📖 Documentation](docs/) | [🐛 Report Issues](issues/) | [💬 Discussions](discussions/)

</div>

