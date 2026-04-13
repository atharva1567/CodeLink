# CodeLink 🔗

**A lightweight, browser-based code translator for students and developers.**

Translate code between Python, Java, C++, and JavaScript — no API key, no server, no installation required. Just open `index.html` and go.

---

## ✨ Features

- **4 languages:** Python · Java · C++ · JavaScript
- **Works 100% offline** — pure HTML, CSS, and JavaScript
- **No API key or account needed** — ever
- **Instant translation** using a built-in rule engine
- **Built-in code samples** for every language
- **Swap** source and target with one click
- **Copy** translated output instantly
- **Dark theme** code editor feel
- **Open source** — fork it, improve it, share it

---

## 🚀 Getting Started

### Option 1 — Just open it
Download or clone the repo, then open `index.html` in any modern browser. That's it.

```bash
git clone https://github.com/YOUR_USERNAME/codelink.git
cd codelink
open index.html   # macOS
# or double-click index.html on Windows/Linux
```

### Option 2 — VS Code Live Server
1. Open the project folder in VS Code
2. Install the [Live Server](https://marketplace.visualstudio.com/items?itemName=ritwickdey.LiveServer) extension
3. Right-click `index.html` → **Open with Live Server**

---

## 📁 Project Structure

```
codelink/
├── index.html          ← Main app (open this in your browser)
├── style.css           ← All styles
├── translator.js       ← Translation engine (the core logic)
├── samples.js          ← Code samples for each language
├── README.md           ← You are here
├── CONTRIBUTING.md     ← How to contribute
└── LICENSE             ← MIT License
```

---

## 🧠 How It Works

CodeLink uses a **rule-based translation engine** in `translator.js`. It works in two passes:

1. **Parse** — tokenize the source code into recognized constructs (print statements, variable declarations, loops, conditionals, functions, classes, etc.)
2. **Generate** — emit the equivalent syntax in the target language

This approach covers the most common patterns students encounter. It's not a full compiler — edge cases will produce `// [manual review needed]` comments so you always know what to check.

---

## 🤝 Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

Ideas for contributions:
- Add more translation rules to `translator.js`
- Improve handling of edge cases
- Add more code samples to `samples.js`
- Improve the UI
- Add support for more languages

---

## 📄 License

MIT — free to use, modify, and distribute. See [LICENSE](LICENSE).

---

## 🙏 Acknowledgements

Built as a student project. Inspired by the frustration of manually rewriting code when learning a new language.
