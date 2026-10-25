const fs = require('fs');
const path = require('path');

async function injectIcon() {
  const ResEdit = await require('resedit/cjs').load();
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

  const packageInfo = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8'),
  );
  const versionParts = packageInfo.version.split('.').map(Number);
  if (
    versionParts.length !== 3 ||
    versionParts.some((part) => !Number.isInteger(part) || part < 0 || part > 65535)
  )
    throw new Error('Unsupported executable version');
  const versions = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
  if (!versions.length) versions.push(ResEdit.Resource.VersionInfo.createEmpty());
  for (const info of versions) {
    info.setFileVersion(...versionParts, 0);
    info.setProductVersion(...versionParts, 0);
    const languages = info.getAvailableLanguages();
    if (!languages.length) languages.push({ lang: 1033, codepage: 1200 });
    for (const language of languages)
      info.setStringValues(language, {
        FileVersion: packageInfo.version,
        ProductVersion: packageInfo.version,
        ProductName: packageInfo.productName,
        FileDescription: packageInfo.productName,
        OriginalFilename: path.basename(exePath),
        InternalName: packageInfo.name,
      });
    info.outputToResourceEntries(res.entries);
  }

  res.outputResource(exe);
  const newExeData = Buffer.from(exe.generate());
  fs.writeFileSync(exePath, newExeData);
  console.log('Updated application icon and executable version: ' + packageInfo.version);
}

injectIcon().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
