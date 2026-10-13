const { app, BrowserWindow, session } = require('electron');
const path = require('path');
const output = process.argv[2];
app.setPath('userData', path.join(output, 'profile'));
app.disableHardwareAcceleration();
let win;
const timeout = setTimeout(() => {
  console.error('Player state browser check timed out');
  app.exit(1);
}, 25000);
app
  .whenReady()
  .then(async () => {
    let externalRequests = 0;
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      const allowed = /^(file|data|blob):/.test(details.url);
      if (!allowed) externalRequests++;
      callback({ cancel: !allowed });
    });
    win = new BrowserWindow({
      show: false,
      webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
    });
    await win.loadFile(path.join(output, 'index.html'));
    const result = await win.webContents.executeJavaScript('verifyPlayerState()');
    if (externalRequests) throw Error('Unexpected external requests: ' + externalRequests);
    console.log('NATIVE_PLAYER_STATE_OK', JSON.stringify({ ...result, externalRequests }));
    clearTimeout(timeout);
    win.destroy();
    app.exit(0);
  })
  .catch((error) => {
    console.error(error);
    clearTimeout(timeout);
    app.exit(1);
  });
