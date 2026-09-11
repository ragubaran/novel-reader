# 📚 NovelReader: AI Web Novel & On-The-Fly Audiobook Reader

A modern, high-performance web novel reader built with **Next.js 13 App Router**, featuring continuous infinite chapter reading, decrypted web scraping, instant batch translation, neural text-to-speech with speed/pitch controls, and **on-the-fly MP3 audiobook generation & download**.

---

## ✨ Features

### 📖 1. Decrypted Web Scraping & Multi-Site Support
- **`wtr-lab.com` Support**: Native AES-GCM decryption engine (`IJAFUUxjM25hyzL2AZrn0wl7cESED6Ru`) to unlock and read encrypted `wtr-lab.com` web novel chapters.
- **Chinese Novel Portals**: Parsers for `m.ilwxs.com` and generic Chinese web novel sites with automatic encoding (`GBK` / `UTF-8`) handling.
- **Smart Link Resolver**: Automatic extraction of chapter title, paragraph structure, novel title, and relative `Next Chapter` navigation links.

### 🌐 2. Dual-Column & Instant Translation Modes
- **Reading Modes**:
  - `Raw Chinese (中文)`
  - `English Translated (English)`
  - `Bilingual Side-by-Side (双语对照)`
- **Delimited Batch Translator API**: High-speed `/api/translate` endpoint processes 10–12 paragraphs per batch in ~1.2 seconds using unblocked client translation streams.

### 🚀 3. Auto-Continue & Continuous Auto-Scroll Engine
- **Infinite Reading**: `IntersectionObserver` sentinel auto-fetches and appends the next chapter in real time as you reach the bottom of the page.
- **Auto-Scroll Engine**: Continuous smooth page scrolling with speed adjustments (1x–5x speed) and spacebar pause/resume toggle.

### 🎙️ 4. Voice Mode (TTS Engine)
- **Dual Speech Backend**:
  - **In-Device Web Speech API**: Low latency native browser voice synthesis.
  - **Cloud Neural TTS (`/api/tts`)**: Natural voice streams with customizable pitch and speech rate.
- **Fine-Grained Controls**:
  - **Speech Speed**: Up to **3.0x** playback speed.
  - **Pitch Tuning**: Adjust voice pitch from 0.5x to 1.8x.
- **Cross-Chapter Continuation**: When a chapter finishes reading, Voice Mode automatically triggers the next chapter fetch and seamlessly continues reading aloud.

### 🎧 5. On-The-Fly Audiobook Converter & MP3 Download
- **Full Chapter Concatenation**: `/api/tts` (POST method) fetches all paragraph audio buffers, performs binary MP3 byte concatenation server-side, and streams back a complete chapter MP3.
- **Inline Audiobook Player**: Embedded audio player for continuous offline/background listening.
- **1-Click MP3 Download**: Save complete chapter audiobooks directly to your device as `.mp3` files.

---

## 🛠️ Getting Started

### 1. Installation
```bash
bun install
# or
npm install
```

### 2. Run Development Server
```bash
bun dev
# or
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser to start reading!

---

## 🧪 Quick Test Links

Try out these pre-configured links directly on your local instance:
- **`wtr-lab.com` Chapter 375**:
  `http://localhost:3000/reader?url=https%3A%2F%2Fwtr-lab.com%2Fen%2Fnovel%2F75809%2Finstantly-defeating-a-grandmaster-right-from-the-start-the-dynasty-is-completely-stunned%2Fchapter-375%3Fservice%3Dweb`
- **`m.ilwxs.com` Chapter 1**:
  `http://localhost:3000/reader?url=https%3A%2F%2Fm.ilwxs.com%2Fshu%2F319716%2F178345928.html`

---

## 📂 Project Structure

```
src/
├── app/
│   ├── api/
│   │   ├── fetch-novel/route.ts   # Web scraper & AES-GCM decryptor
│   │   ├── translate/route.ts     # Delimited batch translation backend
│   │   └── tts/route.ts           # Speech synthesis & MP3 audiobook generator
│   ├── reader/
│   │   └── page.tsx               # Main infinite reader UI & voice engine
│   ├── page.tsx                   # Homepage & URL launcher
│   ├── globals.css                # Glassmorphism theme & styles
│   └── layout.tsx                 # Root layout & Google Fonts
```

---

## 📄 License
MIT License
