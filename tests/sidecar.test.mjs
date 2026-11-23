import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseYamlFrontmatter,
  serializeYamlFrontmatter,
  parseSidecarContent,
  SidecarIndex
} from '../dist/sidecar.js';

test('parseYamlFrontmatter parses standard YAML frontmatter with tags array', () => {
  const content = `---
path: books/scifi/dune.epub
remote: koofr:
remotePath: Calibre/dune.epub
md5: e99a18c428cb38d5f260853678922e03
size: 1542010
mtime: "2026-05-10T12:00:00Z"
mimeOrExt: application/epub+zip
tags:
  - scifi
  - classics
  - favorite
---
# Notes on Dune
Reading progress notes...
`;

  const { frontmatter, body } = parseYamlFrontmatter(content);
  assert.equal(frontmatter.path, 'books/scifi/dune.epub');
  assert.equal(frontmatter.remote, 'koofr:');
  assert.equal(frontmatter.remotePath, 'Calibre/dune.epub');
  assert.equal(frontmatter.md5, 'e99a18c428cb38d5f260853678922e03');
  assert.equal(frontmatter.size, 1542010);
  assert.equal(frontmatter.mimeOrExt, 'application/epub+zip');
  assert.deepEqual(frontmatter.tags, ['scifi', 'classics', 'favorite']);
  assert.ok(body.includes('# Notes on Dune'));
});

test('serializeYamlFrontmatter produces valid .anymd frontmatter string', () => {
  const meta = {
    path: 'docs/report.pdf',
    remote: 'davjump:',
    remotePath: 'work/report.pdf',
    md5: 'a87ff679a2f3e71d9181a67b7542122c',
    size: 204800,
    mtime: '2026-11-20T10:00:00.000Z',
    mimeOrExt: 'pdf',
    tags: ['work', 'q4'],
    sidecarPath: 'docs/report.pdf.anymd'
  };

  const output = serializeYamlFrontmatter(meta, 'Report summary notes');
  assert.ok(output.startsWith('---\npath: docs/report.pdf'));
  assert.ok(output.includes('remote: davjump:'));
  assert.ok(output.includes('md5: a87ff679a2f3e71d9181a67b7542122c'));
  assert.ok(output.includes('Report summary notes'));

  const parsed = parseSidecarContent(output);
  assert.ok(parsed !== null);
  assert.equal(parsed.path, meta.path);
  assert.equal(parsed.md5, meta.md5);
  assert.deepEqual(parsed.tags, meta.tags);
});

test('SidecarIndex handles registrations, lookups by path and md5', () => {
  const logs = [];
  const index = new SidecarIndex((log) => logs.push(log));

  index.registerBatch([
    {
      path: 'local/file1.txt',
      remote: 'local',
      remotePath: 'local/file1.txt',
      md5: 'hash123',
      size: 100,
      mtime: '2026-01-01T00:00:00Z',
      mimeOrExt: 'txt',
      tags: ['doc']
    },
    {
      path: 'T:/backup/file1.txt',
      remote: 'T:',
      remotePath: 'backup/file1.txt',
      md5: 'hash123',
      size: 100,
      mtime: '2026-01-02T00:00:00Z',
      mimeOrExt: 'txt',
      tags: ['backup']
    }
  ]);

  assert.equal(index.size, 2);
  const byMd5 = index.getByMd5('hash123');
  assert.equal(byMd5.length, 2);

  const byPath = index.getByPath('local/file1.txt');
  assert.ok(byPath !== undefined);
  assert.equal(byPath.remote, 'local');

  assert.ok(logs.length > 0);
  assert.equal(logs[0].source, 'vaultr');
  assert.equal(logs[0].stage, 'index');
});
