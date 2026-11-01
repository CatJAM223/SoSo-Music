import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const cargo = path.join(
  os.homedir(),
  '.cargo/bin',
  process.platform === 'win32' ? 'cargo.exe' : 'cargo',
);
const portableGnu = path.join(root, '.tools/w64devkit/bin');
const hasPortableGnu =
  process.platform === 'win32' && fs.existsSync(path.join(portableGnu, 'gcc.exe'));
const toolchain =
  process.env.SOSO_ROOMS_TOOLCHAIN ||
  (hasPortableGnu
    ? 'stable-x86_64-pc-windows-gnu'
    : process.platform === 'win32'
      ? 'stable-x86_64-pc-windows-msvc'
      : 'stable');
const testing = process.argv.includes('--test');
const args = [
  '+' + toolchain,
  testing ? 'test' : 'build',
  '--manifest-path',
  path.join(root, 'native/listening-rooms/Cargo.toml'),
  '--release',
  '--locked',
];
const env = { ...process.env };
if (hasPortableGnu && toolchain.includes('gnu')) {
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') || 'PATH';
  env[pathKey] = portableGnu + path.delimiter + (env[pathKey] || '');
  env.RUSTFLAGS = ((env.RUSTFLAGS || '') + ' -C link-self-contained=yes').trim();
}
if (process.platform === 'win32' && toolchain.includes('msvc') && !env.VSCMD_ARG_TGT_ARCH) {
  const vswhere = path.join(
    env['ProgramFiles(x86)'] || 'C:/Program Files (x86)',
    'Microsoft Visual Studio/Installer/vswhere.exe',
  );
  if (fs.existsSync(vswhere)) {
    const found = spawnSync(
      vswhere,
      ['-latest', '-products', '*', '-find', 'VC/Auxiliary/Build/vcvars64.bat'],
      { encoding: 'utf8', windowsHide: true },
    );
    const vcvars = found.stdout?.trim().split(/\r?\n/)[0];
    if (vcvars && fs.existsSync(vcvars)) {
      const setup = spawnSync(
        env.ComSpec || 'cmd.exe',
        ['/d', '/s', '/c', `call "${vcvars}" >nul && set`],
        { encoding: 'utf8', windowsHide: true, windowsVerbatimArguments: true },
      );
      if (setup.status === 0)
        for (const line of setup.stdout.split(/\r?\n/)) {
          const equals = line.indexOf('=');
          if (equals > 0) env[line.slice(0, equals)] = line.slice(equals + 1);
        }
    }
  }
}
const result = spawnSync(cargo, args, { cwd: root, env, stdio: 'inherit', windowsHide: true });
if (result.error) throw result.error;
if (result.status !== 0) throw Error('Rust listening rooms compilation failed');
if (testing) process.exit(0);
const executable = process.platform === 'win32' ? 'soso-rooms.exe' : 'soso-rooms';
const output = path.join(root, 'build/native');
fs.mkdirSync(output, { recursive: true });
const source = path.join(root, 'native/listening-rooms/target/release', executable);
const destination = path.join(output, executable);
// Windows locks running executables. A cached build needs no replacement when
// tests or a development room are already using this exact binary.
if (!fs.existsSync(destination) || !fs.readFileSync(source).equals(fs.readFileSync(destination)))
  fs.copyFileSync(source, destination);
console.log('Native Rust listening rooms: ' + path.join(output, executable));
