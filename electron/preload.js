const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  toggleStealth: () => ipcRenderer.invoke('toggle-stealth'),
  setOpacity: (opacity) => ipcRenderer.invoke('set-opacity', opacity),
  setAlwaysOnTop: (flag) => ipcRenderer.invoke('set-always-on-top', flag),
  
  // Window resize
  resizeWindow: (width, height) => ipcRenderer.invoke('resize-window', width, height),
  getWindowSize: () => ipcRenderer.invoke('get-window-size'),
  startResize: (direction) => ipcRenderer.invoke('start-resize', direction),
  
  // Platform detection
  platform: process.platform,
  
  // Check if running in Electron
  isElectron: true
});
