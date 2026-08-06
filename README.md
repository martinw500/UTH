# Useful Tool Hub

A collection of useful tools in one place. I got tired of having to search up a ton of different tools whenever I needed to use stuff, so I made this.

Will be updated with more tools as I build them out.

## Live Website
**https://martinw500.github.io/UTH/**

## Tools
- **YouTube Downloader** — Download YouTube videos in multiple formats and qualities
- **Instagram Downloader** — Save photos and videos from public Instagram posts and reels
- **Image Editor / Converter** — Edit, crop, compress, and convert images between formats (client-side)
- **Video Converter** — Convert videos between MP4, WEBM, GIF, and extract audio using FFmpeg.wasm (client-side)
- **Colour Picker** — Pick and convert colours between HEX, RGB, and HSL with a live colour picker
- **QR Code Generator** — Turn any text or link into a QR code and save it as PNG or SVG (client-side)

## Architecture
- **Frontend** — Static HTML/CSS/JS hosted on GitHub Pages
- **Backend** — Python serverless functions on Vercel (Instagram via instaloader, YouTube via yt-dlp)
- **Client-side Tools** — Image editor, video converter, and colour picker run entirely in the browser (Canvas API, FFmpeg.wasm)
- **Local Dev** — Unified Flask backend (`backend.py`) for local testing

## Local Development

### 1. Install Dependencies
```bash
pip install -r requirements.txt
```

### 2. Start Backend
```bash
python backend.py
```
Backend runs on `http://localhost:5000`

### 3. Serve the Frontend
```bash
npm install
npm run dev
```
Then open `http://localhost:5500/`. The frontend auto-detects localhost and uses the local backend.

> **Do not open the HTML files straight from disk.** Newer tools load ES modules, which browsers
> block over `file://`, so the page renders blank. Those pages detect this and show an explanation
> instead, but the fix is always to serve over HTTP with `npm run dev`.

### Running Tests
```bash
npm test          # unit suite
npm run test:e2e  # checks the deployed site (set SITE_URL to target a preview)
```

## Project Structure
```
├── index.html                  # Homepage
├── styles.css                  # Global styles
├── script.js                   # Homepage search/filter
├── js/config.js                # API URL config (auto-switches local/prod)
├── js/shared/                  # Shared ES modules (DOM, format, dropzone, image, colour…)
├── backend.py                  # Unified local dev backend
├── vercel.json                 # Vercel serverless config
├── requirements.txt            # Python dependencies
├── feedback.html               # Feedback form
├── api/
│   ├── instagram/index.py      # Vercel serverless function (instaloader)
│   └── youtube/index.py        # Vercel serverless function (yt-dlp)
├── instagram-downloader/
│   ├── index.html              # Instagram tool UI
│   ├── troubleshooting.html    # Help page
│   └── js/instagram-downloader.js
├── youtube-downloader/
│   ├── index.html              # YouTube tool UI
│   └── js/youtube-downloader.js
├── image-converter/
│   ├── index.html              # Image editor/converter UI
│   └── js/image-converter.js   # Client-side Canvas API editing & conversion
├── video-converter/
│   ├── index.html              # Video converter UI
│   └── js/video-converter.js   # Client-side FFmpeg.wasm conversion
├── color-converter/
│   ├── index.html              # Colour picker UI
│   └── js/color-converter.js   # HEX/RGB/HSL conversion
├── qr-generator/
│   ├── index.html              # QR generator UI (ES module)
│   └── js/qr-generator.js      # Wiring; encoding lives in js/shared/qr.js
├── js/vendor/                  # Vendored third-party libraries — see js/vendor/README.md
```

## Deployment
- Push to `main` → GitHub Pages auto-deploys the frontend
- Push to `main` → Vercel auto-deploys the backend functions