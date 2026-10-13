import type { App } from 'electron';

export function getElectronApp(): App | null {
  try {
    if (typeof process !== 'undefined' && process.versions && process.versions.electron) {
      const electron = typeof require === 'function' ? require('electron') : null;
      if (electron && typeof electron === 'object' && electron.app) {
        return electron.app;
      }
    }
  } catch {
    // Node-only tests and command-line tools have no Electron app.
  }
  return null;
}
