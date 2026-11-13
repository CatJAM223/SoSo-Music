const { app, BrowserWindow } = require('electron');
const fs = require('fs'),
  path = require('path');
const [input, output] = process.argv.slice(2);
app.setPath('userData', path.join(input, 'profile'));
app
  .whenReady()
  .then(async () => {
    fs.mkdirSync(output, { recursive: true });
    const window = new BrowserWindow({
      show: false,
      width: 768,
      height: 432,
      useContentSize: true,
      webPreferences: {
        offscreen: true,
        sandbox: true,
        contextIsolation: true,
        backgroundThrottling: false,
      },
    });
    await window.loadFile(path.join(input, 'index.html'));
    for (const [preset, mode, weather, name] of [
      ['default', 'dark', 'clear', 'default-dark'],
      ['default', 'light', 'clear', 'default-light'],
      ['sakura', 'light', 'clear', 'sakura'],
      ['weather', 'dark', 'clear', 'weather-clear'],
      ['weather', 'dark', 'rain', 'weather-rain'],
      ['blackhole', 'dark', 'clear', 'blackhole'],
      ['nighttrain', 'dark', 'clear', 'nighttrain'],
      ['cassette', 'dark', 'clear', 'cassette'],
    ]) {
      await window.webContents.executeJavaScript(
        `window.renderTheme(${JSON.stringify(preset)},${JSON.stringify(mode)},${JSON.stringify(weather)})`,
      );
      await new Promise((r) => setTimeout(r, 1000));
      fs.writeFileSync(
        path.join(output, name + '.png'),
        (await window.webContents.capturePage()).toPNG(),
      );
      console.log('Captured', name);
    }
    app.exit(0);
  })
  .catch((e) => {
    console.error(e);
    app.exit(1);
  });
