# CodeLink 🔗

**A lightweight, browser-based code translator for students and developers.**

Translate code between Python, Java, C++, and JavaScript — no API key, no server, no installation required. Just open `index.html` and go.

---

## ✨ Key Features

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

## 🧪 Tech Stack

HTML5 — structure and layout

CSS3 — custom UI styling, responsive layout, JetBrains Mono typography

JavaScript — core logic, UI interactions, keyboard shortcuts

Custom Rule‑Based Engine (translator.js) — deterministic syntax transformations

Browser‑native runtime — no frameworks, no build tools, no dependencies

Fully offline execution — everything runs client‑side

---

## 🛠️ Future Roadmap

**UI/UX Improvements**
- Cleaner, more modern layout with refined spacing and typography

- Improved editor experience (syntax highlighting, themes, Monaco Editor integration)

- Better error messages and translation hints

- Animated transitions for swapping languages and loading states

- Mobile‑friendly layout for quick testing on phones

**Language Expansion**
- Add support for Ruby, C#, Go, Swift, and PHP

- Expand rule sets for deeper coverage of loops, classes, exceptions, and modules

- Add language‑specific idiomatic transformations (e.g., Ruby blocks, C# LINQ, Go error handling)

- Modularize translation rules so new languages can be plugged in easily

**Engine Enhancements**
- More robust parsing for complex constructs

- A fallback “manual review needed” system for edge cases

- Optional AST‑based transformations for higher accuracy
- A plugin system for community‑added languages

---

## Demo

Below is a snapshot of CodeLink's workflow and logic

<img width="1470" height="956" alt="Screenshot 2026-04-13 at 11 23 03 AM" src="https://github.com/user-attachments/assets/103fd4bd-9426-4445-8c7a-5999da8ae67a" />
