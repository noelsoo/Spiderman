// Electron wrapper: loads the Vite build (../dist) in a fullscreen-capable window.
// The Gamepad API works out of the box in Electron (DualShock 4 / DualSense / Xbox pads).
const { app, BrowserWindow, globalShortcut, Menu, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { fileURLToPath } = require('url');

// Keep the GPU fast and let audio start without a click (we still unlock on first input).
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');

function indexPath() {
  const packaged = path.join(__dirname, 'dist', 'index.html');       // electron-builder bundle
  const dev = path.join(__dirname, '..', 'dist', 'index.html');      // npm start
  return fs.existsSync(packaged) ? packaged : dev;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 960,
    minHeight: 540,
    backgroundColor: '#05060c',
    title: 'Spider-Man: Symbiote City',
    autoHideMenuBar: true,
    fullscreenable: true,
    icon: path.join(__dirname, '..', 'public', 'icon.svg'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  Menu.setApplicationMenu(null);

  // The game is a single local page: no pop-ups, no navigating away, no web views.
  const root = path.dirname(indexPath());
  const local = (u) => { try { return u.startsWith('file:') && !path.relative(root, fileURLToPath(u)).startsWith('..'); } catch { return false; } };
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => { if (!local(url)) event.preventDefault(); });
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());

  win.loadFile(indexPath());

  const toggleFullscreen = () => win.setFullScreen(!win.isFullScreen());
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') { toggleFullscreen(); event.preventDefault(); }
    else if (input.key === 'Enter' && input.alt) { toggleFullscreen(); event.preventDefault(); }
    else if (input.key === 'F12' && !app.isPackaged) win.webContents.toggleDevTools();
  });
  return win;
}

app.whenReady().then(() => {
  // Only what a game needs: fullscreen and mouse capture. Camera, microphone, location, notifications etc. are refused.
  const OK = new Set(['fullscreen', 'pointerLock']);
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => cb(OK.has(permission)));
  session.defaultSession.setPermissionCheckHandler((wc, permission) => OK.has(permission));
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('will-quit', () => globalShortcut.unregisterAll());
