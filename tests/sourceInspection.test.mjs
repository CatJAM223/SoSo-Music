import test from 'node:test';
import assert from 'node:assert/strict';
import { extractEventRegistration, stripModuleImports } from './helpers/sourceInspection.mjs';

test('Source fixtures preserve multiline code while removing complete import declarations', () => {
  const source =
    "import {\n first,\n second,\n} from 'module';\nconst message = 'import stays in a string';";
  assert.equal(stripModuleImports(source).trim(), "const message = 'import stays in a string';");
});

test('Event extraction ignores callback formatting and adjacent registrations', () => {
  const source =
    "ipcMain.handle(\n 'target',\n async (event) => { return event; },\n);\nipcMain.handle('other', () => false);";
  const registration = extractEventRegistration(source, 'target');
  assert.ok(registration.includes('return event;'));
  assert.ok(!registration.includes('other'));
  assert.throws(() => extractEventRegistration(source, 'missing'), /not found/);
});
