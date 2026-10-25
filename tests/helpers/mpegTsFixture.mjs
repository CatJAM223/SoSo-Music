// Deterministic transport fixtures with valid PSI CRCs, bounded PES and adaptation stuffing.
export const concat = (parts) => Uint8Array.from(parts.flatMap((part) => [...part]));
export function crcSection(values) {
  let crc = 0xffffffff;
  for (const byte of values) {
    crc ^= byte << 24;
    for (let i = 0; i < 8; i++) crc = crc & 0x80000000 ? (crc << 1) ^ 0x04c11db7 : crc << 1;
  }
  return Uint8Array.from([...values, crc >>> 24, (crc >>> 16) & 255, (crc >>> 8) & 255, crc & 255]);
}
export function packet(pid, data, start = false, cc = 0) {
  if (data.length > 184) throw Error('Fixture packet too large');
  const out = new Uint8Array(188).fill(255);
  out.set([
    0x47,
    ((pid >> 8) & 31) | (start ? 64 : 0),
    pid & 255,
    (data.length === 184 ? 0x10 : 0x30) | cc,
  ]);
  const offset = 188 - data.length;
  if (data.length < 184) {
    out[4] = 183 - data.length;
    if (out[4]) out[5] = 0;
  }
  out.set(data, offset);
  return out;
}
export function transportFixture(payload, { codec = 15, video = true, headerLength = 5 } = {}) {
  const pat = crcSection([0, 0xb0, 13, 0, 1, 0xc1, 0, 0, 0, 1, 0xe1, 0]);
  const pmt = crcSection([
    2,
    0xb0,
    23,
    0,
    1,
    0xc1,
    0,
    0,
    0xe1,
    1,
    0xf0,
    0,
    0x1b,
    0xe1,
    2,
    0xf0,
    0,
    codec,
    0xe1,
    1,
    0xf0,
    0,
  ]);
  const packets = [packet(0, concat([[0], pat]), true), packet(256, concat([[0], pmt]), true)];
  let cc = 0;
  for (let offset = 0; offset < payload.length; offset += 30000) {
    const body = payload.subarray(offset, offset + 30000),
      length = body.length + 3 + headerLength;
    const pes = concat([
      [0, 0, 1, 0xc0, length >> 8, length & 255, 0x80, 0x80, headerLength],
      new Uint8Array(headerLength),
      body,
    ]);
    for (let pos = 0; pos < pes.length; pos += 184) {
      if (video) packets.push(packet(258, Uint8Array.of(0, 0, 1, 0xe0, 42), true));
      packets.push(packet(257, pes.subarray(pos, pos + 184), pos === 0, cc));
      cc = (cc + 1) & 15;
      if (video) packets.push(packet(8191, new Uint8Array(184).fill(127)));
    }
  }
  return { packets, bytes: concat(packets), payload };
}
