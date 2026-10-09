// Electron wrapper: loads the Vite build (../dist) in a fullscreen-capable window.
// The Gamepad API works out of the box in Electron (DualShock 4 / DualSense / Xbox pads).
const { app, BrowserWindow, globalShortcut, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

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
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  Menu.setApplicationMenu(null);

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
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('will-quit', () => globalShortcut.unregisterAll());
