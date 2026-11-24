import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSidecarContent, serializeYamlFrontmatter } from '../dist/sidecar.js';
import { KoofrBrowserView } from '../dist/ui.js';

test('parseSidecarContent and serializeYamlFrontmatter preserve added_at, ingest_source, and virtual_folders', () => {
  const sample = `---
path: books/fiction/scifi.epub
remote: local
remotePath: books/fiction/scifi.epub
md5: 88889999aaaabbbb
size: 1048576
mtime: "2026-11-22T20:50:00Z"
mimeOrExt: epub
tags:
  - cyberpunk
added_at: "2026-11-22T20:52:00-08:00"
ingest_source: downloads
virtual_folders:
  - "Inbox Review"
  - "Urban Fantasy"
---
# Notes
`;

  const parsed = parseSidecarContent(sample);
  assert.ok(parsed !== null);
  assert.equal(parsed.added_at, '2026-11-22T20:52:00-08:00');
  assert.equal(parsed.ingest_source, 'downloads');
  assert.deepEqual(parsed.virtual_folders, ['Inbox Review', 'Urban Fantasy']);

  const serialized = serializeYamlFrontmatter(parsed);
  assert.ok(serialized.includes('added_at: "2026-11-22T20:52:00-08:00"'));
  assert.ok(serialized.includes('ingest_source: downloads'));
  assert.ok(serialized.includes('- "Inbox Review"'));
  assert.ok(serialized.includes('- "Urban Fantasy"'));
});

test('KoofrBrowserView filters 24h new items dynamically and sorts by Date Added (added_at desc)', () => {
  const logs = [];
  const view = new KoofrBrowserView({
    onEmitLog: (e) => logs.push(e)
  });

  const now = Date.now();
  const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
  const fortyEightHoursAgo = new Date(now - 48 * 60 * 60 * 1000).toISOString();

  const files = [
    {
      path: 'downloads/fresh_arrival.mp4',
      remote: 'local',
      remotePath: 'downloads/fresh_arrival.mp4',
      md5: 'md5_recent',
      size: 50000000,
      mtime: twoHoursAgo,
      added_at: twoHoursAgo,
      ingest_source: 'downloads',
      mimeOrExt: 'mp4',
      tags: [],
      virtual_folders: ['Watch Later']
    },
    {
      path: 'archives/ancient_file.txt',
      remote: 'Z:',
      remotePath: 'archives/ancient_file.txt',
      md5: 'md5_old',
      size: 1000,
      mtime: fortyEightHoursAgo,
      added_at: fortyEightHoursAgo,
      ingest_source: 'lsf',
      mimeOrExt: 'txt',
      tags: []
    }
  ];

  view.setItems(files);

  // Default sort is added_at_desc, check filtered items
  const filtered = view.getFilteredItems();
  assert.equal(filtered.length, 2);
  assert.equal(filtered[0].path, 'downloads/fresh_arrival.mp4');
  assert.equal(filtered[1].path, 'archives/ancient_file.txt');

  // Verify computeShelfCount for new-24h
  const newCount = view.computeShelfCount('new-24h');
  assert.equal(newCount, 1);

  // Verify computeShelfCount for downloads-24h
  const dlCount = view.computeShelfCount('downloads-24h');
  assert.equal(dlCount, 1);

  // Verify getUniqueVirtualFolders
  const uniqueFolders = view.getUniqueVirtualFolders();
  assert.deepEqual(uniqueFolders, ['Watch Later']);
});

