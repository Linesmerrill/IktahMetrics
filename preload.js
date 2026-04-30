const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('iktahmetrics', {
  // Overlay window: subscribe to live updates from main.
  onUpdate: (cb) => {
    ipcRenderer.on('overlay:update', (_e, payload) => cb(payload));
  },

  // Region picker window.
  pickerSubmit: (rect) => ipcRenderer.send('picker:done', rect),
  pickerCancel: () => ipcRenderer.send('picker:cancel'),

  // App picker window (track-app-window flow).
  onAppList: (cb) => ipcRenderer.on('app-list', (_e, list) => cb(list)),
  appPickerSelect: (data) => ipcRenderer.send('app-picker:select', data),
  appPickerCancel: () => ipcRenderer.send('app-picker:cancel'),
});
