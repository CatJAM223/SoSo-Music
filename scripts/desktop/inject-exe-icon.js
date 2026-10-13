const fs = require('fs');
const path = require('path');
const ResEdit = require('resedit');

function injectIcon() {
  const exePath = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(__dirname, '../../release/win-unpacked/SoSo Music.exe');
  const icoPath = path.join(__dirname, '../../icon/icon.ico');

  if (!fs.existsSync(exePath)) {
    console.error('Exe not found:', exePath);
    process.exit(1);
  }
  if (!fs.existsSync(icoPath)) {
    console.error('Ico not found:', icoPath);
    process.exit(1);
  }

  const exeData = fs.readFileSync(exePath);
  const exe = ResEdit.NtExecutable.from(exeData);
  const res = ResEdit.NtExecutableResource.from(exe);

  const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(icoPath));

  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
    res.entries,
    1,
    1033,
    iconFile.icons.map((item) => item.data),
  );

  // Also replace for lang 0 if present
  try {
    ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
      res.entries,
      1,
      0,
      iconFile.icons.map((item) => item.data),
    );
  } catch (e) {}

  res.outputResource(exe);
  const newExeData = Buffer.from(exe.generate());
  fs.writeFileSync(exePath, newExeData);
  console.log('Successfully injected icon.ico into SoSo Music.exe!');
}

injectIcon();
