import test from 'node:test';
import assert from 'node:assert/strict';
import createVaultrExtension, { VaultrExtension } from '../dist/index.js';

test('VaultrExtension implements AnyMD extension host contract and lifecycle', () => {
  const logEntries = [];
  const registeredSlots = new Map();

  const mockHost = {
    log: (entry) => {
      logEntries.push(entry);
    },
    registerSlot: (slotName, element) => {
      registeredSlots.set(slotName, element);
    },
    unregisterSlot: (slotName) => {
      registeredSlots.delete(slotName);
    }
  };

  const extension = createVaultrExtension(mockHost);
  assert.ok(extension instanceof VaultrExtension);
  assert.equal(extension.getState().enabled, false);

  // Enable
  extension.enable('sidebar-tool');
  assert.equal(extension.getState().enabled, true);
  assert.equal(extension.getState().mountedSlot, 'sidebar-tool');

  // Verify host.log diagnostics
  const initLogs = logEntries.filter(l => l.stage === 'init');
  assert.ok(initLogs.length > 0);
  assert.equal(initLogs[0].source, 'vaultr');
  assert.equal(initLogs[0].level, 'info');

  // Ingest sidecar metadata
  const sampleSidecar = `---
path: notes/meeting.md
remote: local
remotePath: notes/meeting.md
md5: 098f6bcd4621d373cade4e832627b4f6
size: 512
mtime: "2026-11-22T00:00:00Z"
mimeOrExt: md
tags:
  - work
  - agenda
---
# Meeting Notes
`;

  const item = extension.ingestSidecar(sampleSidecar, 'notes/meeting.md.anymd');
  assert.ok(item !== null);
  assert.equal(item.path, 'notes/meeting.md');
  assert.equal(extension.getState().sidecarCount, 1);

  // Clean disable toggle without leaving artifacts
  extension.disable();
  assert.equal(extension.getState().enabled, false);
  assert.equal(extension.getState().mountedSlot, null);

  const mountLogs = logEntries.filter(l => l.stage === 'mount');
  assert.ok(mountLogs.length > 0);
  assert.ok(mountLogs[0].message.includes('cleanly disabled'));
});
