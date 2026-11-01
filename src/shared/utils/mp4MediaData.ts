/** null means the bounded probe does not contain a complete, recognizable MP4. */
export function hasMp4MediaData(bytes: Uint8Array, complete = false): boolean | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const typeAt = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (bytes.length < 8 || typeAt(4) !== 'ftyp') return null;
  let offset = 0;
  while (offset + 8 <= bytes.length) {
    let size = view.getUint32(offset);
    const type = typeAt(offset + 4);
    let header = 8;
    if (size === 1) {
      if (offset + 16 > bytes.length) return complete ? false : null;
      const extended = view.getBigUint64(offset + 8);
      if (extended > BigInt(Number.MAX_SAFE_INTEGER)) return null;
      size = Number(extended);
      header = 16;
    } else if (size === 0) size = bytes.length - offset;
    if (size < header || offset + size > bytes.length) return complete ? false : null;
    if (type === 'mdat' && size > header) return true;
    offset += size;
  }
  return offset === bytes.length ? false : null;
}
