import test from 'node:test';
import assert from 'node:assert/strict';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import {
  createLanPairingPayload,
  parseLanPairingPayload,
} from '../src/shared/utils/lanSyncPairing.ts';

test('PC pairing QR is decoded into address and code', () => {
  const payload = createLanPairingPayload('http://192.168.1.25:43210', '12345678');
  assert.ok(payload.length < 50, 'QR payload should remain easy to scan from a display');
  const symbol = QRCode.create(payload, { errorCorrectionLevel: 'H' });
  const scale = 8;
  const size = (symbol.modules.size + 8) * scale;
  const pixels = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const row = Math.floor(y / scale) - 4;
      const col = Math.floor(x / scale) - 4;
      const dark =
        row >= 0 &&
        col >= 0 &&
        row < symbol.modules.size &&
        col < symbol.modules.size &&
        symbol.modules.get(row, col);
      const offset = (y * size + x) * 4;
      pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = dark ? 0 : 255;
      pixels[offset + 3] = 255;
    }
  }
  const decoded = jsQR(pixels, size, size);
  assert.ok(decoded);
  assert.deepEqual(parseLanPairingPayload(decoded.data), {
    address: 'http://192.168.1.25:43210',
    code: '12345678',
  });
});

test('Pairing rejects unrelated QR codes and non-local addresses', () => {
  assert.throws(() => parseLanPairingPayload('https://example.com'));
  assert.throws(() => createLanPairingPayload('http://8.8.8.8:1234', '12345678'));
  assert.throws(() => createLanPairingPayload('http://192.168.1.25:1234', '123'));
  assert.throws(() => createLanPairingPayload('http://192.168.999.1:1234', '12345678'));
  assert.throws(() => createLanPairingPayload('http://10..0.1:1234', '12345678'));
});

test('Pairing still reads QR codes from the previous desktop build', () => {
  const legacy = 'sosomusic://pair?address=http%3A%2F%2F192.168.1.25%3A43210&code=12345678';
  assert.deepEqual(parseLanPairingPayload(legacy), {
    address: 'http://192.168.1.25:43210',
    code: '12345678',
  });
});
