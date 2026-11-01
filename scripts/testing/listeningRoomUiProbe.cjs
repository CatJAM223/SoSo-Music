const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const output = path.resolve(process.argv[2]);
app.disableHardwareAcceleration();
app.setPath('userData', path.join(output, 'profile'));
app.commandLine.appendSwitch('force-prefers-reduced-motion', 'reduce');
const timeout = setTimeout(() => {
  console.error('Listening room UI timeout');
  app.exit(1);
}, 40000);
app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest((details, reply) =>
    reply({ cancel: !/^(file|data|blob):/.test(details.url) }),
  );
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    useContentSize: true,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      offscreen: true,
      backgroundThrottling: false,
    },
  });
  const errors = [];
  win.webContents.on('console-message', (event) => {
    if (event.level === 'error') errors.push(event.message);
  });
  const js = (code) => win.webContents.executeJavaScript(code);
  const wait = async (expression) => {
    const end = Date.now() + 5000;
    while (Date.now() < end) {
      if (await js(expression)) return;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    throw Error('UI condition failed: ' + expression);
  };
  try {
    await win.loadFile(path.join(output, 'index.html'));
    await wait('document.querySelectorAll(".room-choice").length===2');
    assert.equal(
      await js(
        '(()=>{const nav=[...document.querySelectorAll("aside button")].map(b=>b.textContent);return nav.indexOf("Жанры")<nav.indexOf("Совместное прослушивание")&&nav.indexOf("Совместное прослушивание")<nav.findIndex(t=>t.startsWith("Моя музыка"));})()',
      ),
      true,
    );
    const screenshot = async (name) => {
      let lastError;
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          win.webContents.invalidate();
          await new Promise((resolve) => setTimeout(resolve, 100));
          fs.writeFileSync(path.join(output, name), (await win.webContents.capturePage()).toPNG());
          return;
        } catch (error) {
          lastError = error;
        }
      }
      throw lastError;
    };
    assert.equal(await js('!!document.querySelector(".room-orbit")'), true);
    await screenshot('landing.png');
    await js('document.querySelectorAll(".room-choice")[0].click()');
    await wait('!!document.querySelector("input[name=roomName]")');
    await js('document.querySelector("form").requestSubmit()');
    await wait('!!window.fixtureSubmitted');
    assert.equal((await js('window.fixtureSubmitted')).mode, 'internet');
    assert.equal(await js('document.querySelector(".room-hero")===null'), true);
    assert.equal(
      await js(
        'document.querySelector(".room-mode")===null&&document.querySelector("select[name=address]")===null',
      ),
      true,
    );
    assert.equal(await js('document.querySelector("button[type=submit] svg")===null'), true);
    await screenshot('create-room.png');
    await js('document.querySelector(".room-back").click()');
    await wait('document.querySelectorAll(".room-choice").length===2');
    await js('document.querySelectorAll(".room-choice")[1].click()');
    await wait('!!document.querySelector("textarea[name=invitation]")');
    assert.equal(await js('document.querySelector(".room-hero")===null'), true);
    await js(
      'document.querySelector("textarea[name=invitation]").value="SOSO1.test.invitation"; document.querySelector("form").requestSubmit()',
    );
    await wait('!!window.fixtureJoined');
    assert.equal((await js('window.fixtureJoined')).invitation, 'SOSO1.test.invitation');
    await js('window.fixtureConnected()');
    await wait('document.querySelectorAll(".room-members li").length===2');
    await js(
      `Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.fixtureCopied=text;}}})`,
    );
    assert.equal(await js('document.querySelector(".room-invite")===null'), true);
    assert.equal(
      await js(
        'document.querySelector(".room-copy-button").parentElement===document.querySelector(".room-exit-button").parentElement',
      ),
      true,
    );
    await js('document.querySelector(".room-copy-button").click()');
    await wait('window.fixtureCopied==="SOSO1.example.invitation"');
    await wait('document.querySelector(".room-copy-button").title==="Скопировано"');
    const copyButton = await js(
      '(()=>{const b=document.querySelector(".room-copy-button"),e=document.querySelector(".room-exit-button"),r=b.getBoundingClientRect(),s=e.getBoundingClientRect();return {width:r.width,height:r.height,exitWidth:s.width,aligned:Math.abs(r.top-s.top)<1,round:getComputedStyle(b).borderRadius};})()',
    );
    assert.equal(copyButton.width, copyButton.height);
    assert.equal(copyButton.width, copyButton.exitWidth);
    assert.equal(copyButton.aligned, true);
    assert.equal(copyButton.round, '50%');
    assert.equal(
      await js('document.querySelector(".room-track-info h3").textContent'),
      'Midnight City',
    );
    assert.equal(
      await js('document.querySelectorAll("[aria-controls=room-add-sources]").length'),
      1,
    );
    assert.equal(
      await js(
        '!!document.querySelector(".room-now-playing .room-button-brand[aria-controls=room-add-sources]")',
      ),
      true,
    );
    assert.equal(
      await js('document.querySelector(".room-queue [aria-controls=room-add-sources]")===null'),
      true,
    );
    assert.equal(
      await js('document.querySelector(".room-playback-footer").textContent.trim()'),
      'Добавить треки',
    );
    await js('document.querySelector("[aria-controls=room-add-sources]").click()');
    await wait('!!document.querySelector(".room-now-playing #room-add-sources")');
    await js('document.querySelectorAll("#room-add-sources button")[1].click()');
    await wait('window.fixtureBrowse==="liked"');
    await js('document.querySelector("[aria-controls=room-add-sources]").click()');
    await wait('!!document.querySelector(".room-now-playing #room-add-sources")');
    await js('document.querySelector("#room-add-sources button").click()');
    await wait('window.fixtureBrowse==="search"');
    await screenshot('connected.png');
    assert.equal(await js('document.documentElement.scrollWidth<=innerWidth'), true);
    win.setContentSize(980, 760);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(await js('document.documentElement.scrollWidth<=innerWidth'), true);
    await screenshot('connected-compact.png');
    assert.deepEqual(errors, []);
    console.log(
      'Listening room UI passed: navigation order, create/join forms, automatic creation, hidden form hero, compact invitation copy button, participant/queue display and compact layout. Screenshots: ' +
        output,
    );
    win.destroy();
    clearTimeout(timeout);
    app.exit(0);
  } catch (error) {
    console.error(error, errors);
    win.destroy();
    clearTimeout(timeout);
    app.exit(1);
  }
});
