import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SevenZipArchiveAdapter,
  SIDECAR_STORAGE_MODES
} from '../dist/sevenZip.js';

test('SevenZipArchiveAdapter builds 7z l -slt, 7z x -so, 7z u, and 7z d commands', () => {
  const adapter = new SevenZipArchiveAdapter('7z');

  // List
  const listCmd = adapter.buildListEntries('/vault/sidecars.anymdz');
  assert.equal(listCmd.command, '7z');
  assert.deepEqual(listCmd.args, ['l', '-slt', '/vault/sidecars.anymdz']);
  assert.equal(listCmd.fullCommandLine, '7z l -slt /vault/sidecars.anymdz');

  // Read single stream
  const readCmd = adapter.buildReadEntryStream('/vault/sidecars.anymdz', 'books/dune.epub.anymd');
  assert.deepEqual(readCmd.args, ['x', '/vault/sidecars.anymdz', 'books/dune.epub.anymd', '-so']);
  assert.equal(readCmd.fullCommandLine, '7z x /vault/sidecars.anymdz books/dune.epub.anymd -so');

  // Update in-place
  const updateCmd = adapter.buildUpdateEntry('/vault/sidecars.anymdz', '/tmp/entry.anymd');
  assert.deepEqual(updateCmd.args, ['u', '/vault/sidecars.anymdz', '/tmp/entry.anymd']);
  assert.equal(updateCmd.fullCommandLine, '7z u /vault/sidecars.anymdz /tmp/entry.anymd');

  // Delete
  const delCmd = adapter.buildDeleteEntry('/vault/sidecars.anymdz', 'obsolete.anymd');
  assert.deepEqual(delCmd.args, ['d', '/vault/sidecars.anymdz', 'obsolete.anymd']);
  assert.equal(delCmd.fullCommandLine, '7z d /vault/sidecars.anymdz obsolete.anymd');
});

test('SevenZipArchiveAdapter parses 7z l -slt technical block output without extraction', () => {
  const adapter = new SevenZipArchiveAdapter();

  const mockSlt = `
Listing archive: /vault/sidecars.anymdz

--
Path = books/neuromancer.epub.anymd
Folder = -
Size = 1024
Packed Size = 450
Modified = 2026-11-20 15:30:00
Attributes = A
CRC = 9FA7612A

Path = books/
Folder = +
Size = 0
Packed Size = 0
Modified = 2026-11-20 15:30:00
Attributes = D

Path = notes/ideas.anymd
Folder = -
Size = 512
Packed Size = 220
Modified = 2026-11-22 10:00:00
Attributes = A
CRC = 1B8C9F3D
`;

  const entries = adapter.parseSltOutput(mockSlt);
  // Folder should be filtered out
  assert.equal(entries.length, 2);
  assert.equal(entries[0].path, 'books/neuromancer.epub.anymd');
  assert.equal(entries[0].size, 1024);
  assert.equal(entries[0].crc, '9FA7612A');
  assert.equal(entries[1].path, 'notes/ideas.anymd');
  assert.equal(entries[1].size, 512);
});

test('SIDECAR_STORAGE_MODES includes updated .anymdz 7z mode label', () => {
  const archiveOption = SIDECAR_STORAGE_MODES.find(m => m.mode === 'archive-anymdz');
  assert.ok(archiveOption !== undefined);
  assert.equal(archiveOption.label, 'Sidecar Archive (.anymdz)');
  assert.ok(archiveOption.description.includes('⚡ fast 7z updates'));
  assert.ok(archiveOption.description.includes('📦 single-file portable'));
});

test('SevenZipArchiveAdapter emits structured log entries with source vaultr:7z-adapter', () => {
  const logs = [];
  const adapter = new SevenZipArchiveAdapter('7z', (l) => logs.push(l));

  adapter.logOperation('list', 'Listing 50 archive entries');
  assert.equal(logs.length, 1);
  assert.equal(logs[0].source, 'vaultr:7z-adapter');
  assert.equal(logs[0].stage, 'list');

  adapter.logFallback('browser static context');
  assert.equal(logs.length, 2);
  assert.equal(logs[1].level, 'warn');
  assert.equal(logs[1].stage, 'fallback');
});
