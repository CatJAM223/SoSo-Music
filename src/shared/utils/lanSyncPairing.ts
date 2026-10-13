import { isPrivateLanIPv4 } from './privateLanIp.ts';

export interface LanPairingDetails {
  address: string;
  code: string;
}

export function parseLanAddress(value: string): string {
  let address: URL;
  try {
    address = new URL(value.trim());
  } catch {
    throw new Error('Введите адрес ПК в формате http://192.168.1.2:12345.');
  }
  if (
    address.protocol !== 'http:' ||
    !isPrivateLanIPv4(address.hostname) ||
    !address.port ||
    address.username ||
    address.password ||
    (address.pathname !== '/' && address.pathname !== '') ||
    address.search ||
    address.hash
  ) {
    throw new Error('Адрес должен быть адресом ПК в локальной сети.');
  }
  return address.origin;
}

export function createLanPairingPayload(address: string, code: string): string {
  const safeAddress = parseLanAddress(address);
  if (!/^\d{8}$/.test(code)) throw new Error('Неверный код сопряжения.');
  const url = new URL(safeAddress);
  return `SM1|${url.hostname}|${url.port}|${code}`;
}

export function parseLanPairingPayload(value: string): LanPairingDetails {
  if (value.startsWith('SM1|')) {
    const parts = value.split('|');
    if (parts.length !== 4 || !/^\d{8}$/.test(parts[3]))
      throw new Error('Неверный код сопряжения.');
    return { address: parseLanAddress(`http://${parts[1]}:${parts[2]}`), code: parts[3] };
  }
  // Keep codes from the previous desktop build readable during upgrades.
  let payload: URL;
  try {
    payload = new URL(value);
  } catch {
    throw new Error('Это не QR-код синхронизации SoSo Music.');
  }
  if (
    payload.protocol !== 'sosomusic:' ||
    payload.hostname !== 'pair' ||
    payload.pathname !== '' ||
    payload.hash
  ) {
    throw new Error('Это не QR-код синхронизации SoSo Music.');
  }
  const address = parseLanAddress(payload.searchParams.get('address') || '');
  const code = payload.searchParams.get('code') || '';
  if (!/^\d{8}$/.test(code)) throw new Error('Неверный код сопряжения.');
  return { address, code };
}
