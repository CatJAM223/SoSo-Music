import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const manifest = path.join(root, 'native/compute-core/Cargo.toml');
const cargoName = process.platform === 'win32' ? 'cargo.exe' : 'cargo';
const homeCargo = path.join(os.homedir(), '.cargo/bin', cargoName);
const cargo = fs.existsSync(homeCargo) ? homeCargo : cargoName;
const result = spawnSync(
  cargo,
  [
    'rustc',
    '--manifest-path',
    manifest,
    '--locked',
    '--release',
    '--target',
    'wasm32-unknown-unknown',
    '--',
    '-C',
    'link-arg=--max-memory=16777216',
    '-C',
    'link-arg=-zstack-size=262144',
  ],
  { cwd: root, stdio: 'inherit', windowsHide: true },
);
if (result.error) throw result.error;
if (result.status !== 0)
  throw Error(
    'Rust compute core compilation failed; install Rust and rustup target add wasm32-unknown-unknown',
  );
const output = path.join(root, 'public/compute');
fs.mkdirSync(output, { recursive: true });
const binary = fs.readFileSync(
  path.join(
    root,
    'native/compute-core/target/wasm32-unknown-unknown/release/soso_compute_core.wasm',
  ),
);
if (WebAssembly.Module.imports(new WebAssembly.Module(binary)).length)
  throw Error('Text core must not import host capabilities');
fs.writeFileSync(path.join(output, 'soso-core.wasm'), binary);
const sourceHash = crypto.createHash('sha256');
for (const file of ['Cargo.toml', 'Cargo.lock', 'src/lib.rs'])
  sourceHash.update(fs.readFileSync(path.join(root, 'native/compute-core', file)));
sourceHash.update(fs.readFileSync(fileURLToPath(import.meta.url)));
fs.writeFileSync(
  path.join(output, 'soso-core.json'),
  JSON.stringify(
    {
      abi: 2,
      sourceSha256: sourceHash.digest('hex'),
      wasmSha256: crypto.createHash('sha256').update(binary).digest('hex'),
    },
    null,
    2,
  ) + '\n',
);
console.log('Local Rust compute core: ' + binary.length + ' bytes, no host imports');
