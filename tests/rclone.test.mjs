import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RcloneCommandBuilder,
  RcloneRunner
} from '../dist/rclone.js';

test('RcloneCommandBuilder.buildLsf creates targeted lsf with pstm format and hash', () => {
  const spec = RcloneCommandBuilder.buildLsf('koofr:', 'Calibre', {
    recursive: true,
    filesOnly: true
  });

  assert.equal(spec.kind, 'lsf');
  assert.equal(spec.command, 'rclone');
  assert.ok(spec.args.includes('lsf'));
  assert.ok(spec.args.includes('koofr:/Calibre'));
  assert.ok(spec.args.includes('--format=pstm'));
  assert.ok(spec.args.includes('--hash=md5'));
  assert.ok(spec.args.includes('--recursive'));
  assert.ok(spec.args.includes('--files-only'));
  assert.equal(spec.fullCommandLine, 'rclone lsf koofr:/Calibre --format=pstm --hash=md5 --recursive --files-only');
});

test('RcloneCommandBuilder.buildCopyTo handles dryRun and single file syntax', () => {
  const drySpec = RcloneCommandBuilder.buildCopyTo('davjump:docs/book.pdf', 'local:vault/book.pdf', true);
  assert.equal(drySpec.isDryRun, true);
  assert.ok(drySpec.args.includes('--dry-run'));
  assert.equal(drySpec.fullCommandLine, 'rclone copyto davjump:docs/book.pdf local:vault/book.pdf --dry-run');

  const liveSpec = RcloneCommandBuilder.buildCopyTo('davjump:docs/book.pdf', 'local:vault/book.pdf', false);
  assert.equal(liveSpec.isDryRun, false);
  assert.ok(!liveSpec.args.includes('--dry-run'));
});

test('RcloneCommandBuilder.buildCat creates streaming cat command', () => {
  const spec = RcloneCommandBuilder.buildCat('tbox:records/note.txt', { offset: 0, count: 1024 });
  assert.equal(spec.kind, 'cat');
  assert.ok(spec.args.includes('--offset=0'));
  assert.ok(spec.args.includes('--count=1024'));
  assert.equal(spec.fullCommandLine, 'rclone cat tbox:records/note.txt --offset=0 --count=1024');
});

test('RcloneCommandBuilder.buildFilesFrom creates batch pull with --no-traverse', () => {
  const spec = RcloneCommandBuilder.buildFilesFrom('Z:', 'local:sync', '/tmp/fetchlist.txt', true);
  assert.equal(spec.kind, 'files-from');
  assert.ok(spec.args.includes('--files-from=/tmp/fetchlist.txt'));
  assert.ok(spec.args.includes('--no-traverse'));
  assert.ok(spec.args.includes('--dry-run'));
});

test('RcloneRunner.parseLsfPstmOutput parses semicolon delimited pstm lsf lines', () => {
  const rawOutput = `
books/scifi/neuromancer.epub;1245000;2026-05-01T10:00:00.000Z;44d88612fea8a8f36de82e1278abb02f
music/ambient.flac;35000000;2026-05-02T11:00:00.000Z;8b1a9953c4611296a827abf8c47804d7
`;

  const items = RcloneRunner.parseLsfPstmOutput(rawOutput, 'koofr:');
  assert.equal(items.length, 2);
  assert.equal(items[0].path, 'books/scifi/neuromancer.epub');
  assert.equal(items[0].size, 1245000);
  assert.equal(items[0].md5, '44d88612fea8a8f36de82e1278abb02f');
  assert.equal(items[0].remote, 'koofr:');
  assert.equal(items[1].path, 'music/ambient.flac');
});
