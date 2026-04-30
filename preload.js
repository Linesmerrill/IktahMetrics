const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gruntrate', {
  // Overlay window: subscribe to live updates from main.
  onUpdate: (cb) => {
    ipcRenderer.on('overlay:update', (_e, payload) => cb(payload));
  },

  // Region picker window.
  pickerSubmit: (rect) => ipcRenderer.send('picker:done', rect),
  pickerCancel: () => ipcRenderer.send('picker:cancel'),
});
