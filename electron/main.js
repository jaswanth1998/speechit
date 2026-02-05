const { app, BrowserWindow, globalShortcut, ipcMain, Tray, Menu, screen } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

let mainWindow;
let tray;
let serverProcess;
let isVisible = true;
let isStealthMode = false;

// Server port
const PORT = process.env.PORT || 3000;

// Handle uncaught exceptions to prevent app crashes
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  // Don't crash the app for EPIPE or connection errors
  if (error.code === 'EPIPE' || error.code === 'ECONNRESET') {
    console.log('Ignoring connection error');
    return;
  }
});

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  
  mainWindow = new BrowserWindow({
    width: 420,
    height: 700,
    minWidth: 320,
    minHeight: 400,
    maxWidth: 800,
    maxHeight: height,
    x: width - 440,  // Position at right side of screen
    y: 20,
    frame: false,  // No window frame for cleaner look
    transparent: true,  // Enable transparency
    alwaysOnTop: true,  // Always stay on top
    skipTaskbar: true,  // Don't show in taskbar
    resizable: true,
    movable: true,
    hasShadow: false,  // Reduces detection
    
    // CRITICAL: These settings help avoid screen capture
    // Note: setContentProtection is the main feature for this
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // STEALTH MODE: Exclude from screen capture (macOS & Windows)
  // This is the KEY feature that hides from Google Meet/Zoom screen share
  mainWindow.setContentProtection(true);
  
  // Set window to be click-through when holding Alt (for interacting with windows behind)
  mainWindow.setIgnoreMouseEvents(false);
  
  // Set window level to floating (above normal windows but below screen savers)
  mainWindow.setAlwaysOnTop(true, 'floating');
  
  // Set window to not show in Mission Control/Exposé on macOS
  if (process.platform === 'darwin') {
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    mainWindow.setHiddenInMissionControl(true);
  }

  // Load the app
  mainWindow.loadURL(`http://localhost:${PORT}`);

  // Open DevTools for debugging (remove in production)
  mainWindow.webContents.openDevTools({ mode: 'detach' });

  // Prevent renderer crashes from hiding the window
  mainWindow.webContents.on('render-process-gone', (event, details) => {
    console.error('Renderer process crashed:', details);
    if (details.reason !== 'clean-exit') {
      // Reload the page instead of hiding
      mainWindow.reload();
    }
  });

  mainWindow.webContents.on('unresponsive', () => {
    console.warn('Window became unresponsive');
  });

  mainWindow.webContents.on('responsive', () => {
    console.log('Window became responsive again');
  });

  // Handle window close
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      isVisible = false;
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Make window draggable from title bar only
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.insertCSS(`
      .title-bar { -webkit-app-region: drag; }
      .title-bar-controls, button, input, textarea, select, a, [role="button"] { -webkit-app-region: no-drag; }
    `);
  });
}

function createTray() {
  // Create tray icon (you can replace with your own icon)
  const iconPath = path.join(__dirname, 'icon.png');
  
  // Use a default icon if custom one doesn't exist
  try {
    tray = new Tray(iconPath);
  } catch (e) {
    // Create a simple tray without icon on error
    const { nativeImage } = require('electron');
    const icon = nativeImage.createEmpty();
    tray = new Tray(icon);
  }
  
  const contextMenu = Menu.buildFromTemplate([
    { 
      label: '👁️ Show/Hide', 
      click: () => toggleVisibility() 
    },
    { 
      label: '🔝 Always on Top', 
      type: 'checkbox', 
      checked: true,
      click: (menuItem) => {
        mainWindow.setAlwaysOnTop(menuItem.checked);
      }
    },
    { 
      label: '🕵️ Stealth Mode (Hidden from Screen Share)', 
      type: 'checkbox', 
      checked: true,
      click: (menuItem) => {
        isStealthMode = menuItem.checked;
        mainWindow.setContentProtection(menuItem.checked);
      }
    },
    { type: 'separator' },
    { 
      label: '📐 Reset Position', 
      click: () => resetWindowPosition() 
    },
    { 
      label: '🔄 Reload', 
      click: () => mainWindow.reload() 
    },
    { type: 'separator' },
    { 
      label: '❌ Quit', 
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);
  
  tray.setToolTip('InterviewAI - Stealth Mode Active');
  tray.setContextMenu(contextMenu);
  
  // Click on tray to toggle visibility
  tray.on('click', () => toggleVisibility());
}

function toggleVisibility() {
  if (mainWindow) {
    if (isVisible) {
      mainWindow.hide();
      isVisible = false;
    } else {
      mainWindow.show();
      isVisible = true;
    }
  }
}

function resetWindowPosition() {
  const { width } = screen.getPrimaryDisplay().workAreaSize;
  mainWindow.setBounds({ x: width - 440, y: 20, width: 420, height: 700 });
}

function startServer() {
  return new Promise((resolve, reject) => {
    const serverPath = path.join(__dirname, '..', 'server.js');
    
    serverProcess = spawn('node', [serverPath], {
      env: { ...process.env, PORT: PORT },
      cwd: path.join(__dirname, '..'),
      stdio: ['ignore', 'pipe', 'pipe']
    });

    serverProcess.stdout.on('data', (data) => {
      try {
        console.log(`Server: ${data}`);
        if (data.toString().includes('listening') || data.toString().includes('Server')) {
          resolve();
        }
      } catch (e) {
        // Ignore logging errors
      }
    });

    serverProcess.stderr.on('data', (data) => {
      try {
        console.error(`Server Error: ${data}`);
      } catch (e) {
        // Ignore logging errors
      }
    });

    serverProcess.on('error', (error) => {
      console.error('Server process error:', error);
    });

    // Give server time to start
    setTimeout(resolve, 2000);
  });
}

function registerShortcuts() {
  // Toggle visibility with Cmd/Ctrl + Shift + I
  globalShortcut.register('CommandOrControl+Shift+I', () => {
    toggleVisibility();
  });
  
  // Toggle stealth mode with Cmd/Ctrl + Shift + S
  globalShortcut.register('CommandOrControl+Shift+S', () => {
    isStealthMode = !isStealthMode;
    mainWindow.setContentProtection(isStealthMode);
    console.log(`Stealth mode: ${isStealthMode ? 'ON' : 'OFF'}`);
  });
  
  // Quick opacity toggle with Cmd/Ctrl + Shift + O
  globalShortcut.register('CommandOrControl+Shift+O', () => {
    const currentOpacity = mainWindow.getOpacity();
    mainWindow.setOpacity(currentOpacity > 0.5 ? 0.3 : 1.0);
  });
  
  // Toggle minimize/maximize with Cmd/Ctrl + Shift + M
  globalShortcut.register('CommandOrControl+Shift+M', () => {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
      mainWindow.show();
    } else {
      mainWindow.minimize();
    }
  });
}

// App lifecyclewbiefsfs
app.whenReady().then(async () => {
  // Start the Express server first
  console.log('Starting server...');
  await startServer();
  
  // Then create the window
  createWindow();
  createTray();
  registerShortcuts();
  
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      mainWindow.show();
      isVisible = true;
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  // Unregister all shortcuts
  globalShortcut.unregisterAll();
  
  // Kill server process gracefully
  if (serverProcess) {
    try {
      // Remove listeners first to prevent EPIPE errors
      if (serverProcess.stdout) serverProcess.stdout.removeAllListeners();
      if (serverProcess.stderr) serverProcess.stderr.removeAllListeners();
      serverProcess.removeAllListeners();
      
      serverProcess.kill('SIGTERM');
      
      // Force kill after 1 second if still running
      setTimeout(() => {
        try {
          if (serverProcess && !serverProcess.killed) {
            serverProcess.kill('SIGKILL');
          }
        } catch (e) {
          // Ignore
        }
      }, 1000);
    } catch (e) {
      console.log('Server cleanup completed');
    }
  }
});

app.on('before-quit', () => {
  app.isQuitting = true;
});

// IPC handlers for renderer communication
ipcMain.handle('toggle-stealth', () => {
  isStealthMode = !isStealthMode;
  mainWindow.setContentProtection(isStealthMode);
  return isStealthMode;
});

ipcMain.handle('set-opacity', (event, opacity) => {
  mainWindow.setOpacity(opacity);
});

ipcMain.handle('set-always-on-top', (event, flag) => {
  mainWindow.setAlwaysOnTop(flag, 'floating');
});

ipcMain.handle('resize-window', (event, width, height) => {
  if (mainWindow) {
    const bounds = mainWindow.getBounds();
    mainWindow.setBounds({ 
      x: bounds.x, 
      y: bounds.y, 
      width: Math.max(320, width), 
      height: Math.max(400, height) 
    });
  }
});

ipcMain.handle('get-window-size', () => {
  if (mainWindow) {
    const bounds = mainWindow.getBounds();
    return { width: bounds.width, height: bounds.height };
  }
  return { width: 420, height: 700 };
});
