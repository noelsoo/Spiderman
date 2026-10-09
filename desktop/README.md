# Symbiote City - desktop wrapper (Electron)

Runs the same Vite build as the web version inside a native window. Gamepads
(DualShock 4, DualSense, Xbox) work through Chromium's Gamepad API.

## Run

```bash
cd desktop
npm install          # downloads electron (needs internet access to GitHub releases)
npm start            # builds the game (../dist) then opens the window
```

`npm run start:fast` skips the web build and reuses an existing `../dist`.

Keys: **F11** or **Alt+Enter** toggles fullscreen. **F12** opens DevTools (unpackaged only).

## Build installers

```bash
cd desktop
npm run dist         # Windows (nsis + portable), macOS (dmg), Linux (AppImage + deb)
npm run dist:win     # or dist:mac / dist:linux (build on the matching OS for best results)
```

Output goes to `desktop/release/`. Note the game is built with `base: './'`, so `dist/index.html`
loads from `file://` without a server.

## Web / PWA

`npm run build` in the repo root produces `dist/`, which can be hosted on any static host over https.
Browsers then offer "Install" (PWA, fullscreen landscape) and the service worker (`public/sw.js`) caches the game for offline play.
