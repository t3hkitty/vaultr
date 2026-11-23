import test from 'node:test';
import assert from 'node:assert/strict';
import {
  groupDuplicatesByMd5,
  selectKeeper,
  buildResolutionPlan
} from '../dist/dedupe.js';

test('groupDuplicatesByMd5 groups files sharing the same md5 hash across remotes', () => {
  const files = [
    {
      path: 'Z:/archive/sample.mp4',
      remote: 'Z:',
      remotePath: 'archive/sample.mp4',
      md5: 'deadbeef1234567890abcdef',
      size: 50000000,
      mtime: '2026-03-01T00:00:00Z',
      mimeOrExt: 'video/mp4',
      tags: []
    },
    {
      path: 'local/downloads/sample.mp4',
      remote: 'local',
      remotePath: 'downloads/sample.mp4',
      md5: 'deadbeef1234567890abcdef',
      size: 50000000,
      mtime: '2026-03-05T00:00:00Z',
      mimeOrExt: 'video/mp4',
      tags: []
    },
    {
      path: 'tbox:/inbox/unique.pdf',
      remote: 'tbox:',
      remotePath: 'inbox/unique.pdf',
      md5: 'uniquehash777777777777',
      size: 1000,
      mtime: '2026-04-01T00:00:00Z',
      mimeOrExt: 'pdf',
      tags: []
    }
  ];

  const clusters = groupDuplicatesByMd5(files);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].md5, 'deadbeef1234567890abcdef');
  assert.equal(clusters[0].duplicateCount, 2);
  assert.equal(clusters[0].totalSize, 100000000);
});

test('selectKeeper honors preferred remotes order (local > Z: > T:)', () => {
  const dupes = [
    {
      path: 'koofr:/cloud/test.bin',
      remote: 'koofr:',
      remotePath: 'cloud/test.bin',
      md5: 'abc1234',
      size: 100,
      mtime: '2026-01-01',
      mimeOrExt: 'bin',
      tags: []
    },
    {
      path: 'local/vault/test.bin',
      remote: 'local',
      remotePath: 'vault/test.bin',
      md5: 'abc1234',
      size: 100,
      mtime: '2026-01-01',
      mimeOrExt: 'bin',
      tags: []
    }
  ];

  const keeper = selectKeeper(dupes, { preferredRemotesOrder: ['local', 'koofr:'] });
  assert.equal(keeper.remote, 'local');
  assert.equal(keeper.path, 'local/vault/test.bin');
});

test('buildResolutionPlan produces dry-run quarantine actions without deleting', () => {
  const cluster = {
    md5: 'feedface99999999',
    totalSize: 4000,
    duplicateCount: 2,
    items: [
      {
        path: 'local/main.epub',
        remote: 'local',
        remotePath: 'main.epub',
        md5: 'feedface99999999',
        size: 2000,
        mtime: '2026-02-01',
        mimeOrExt: 'epub',
        tags: []
      },
      {
        path: 'T:/backup/main.epub',
        remote: 'T:',
        remotePath: 'backup/main.epub',
        md5: 'feedface99999999',
        size: 2000,
        mtime: '2026-02-01',
        mimeOrExt: 'epub',
        tags: []
      }
    ]
  };

  const plan = buildResolutionPlan(cluster, {
    dryRun: true,
    quarantineDir: '.quarantine'
  });

  assert.equal(plan.dryRun, true);
  assert.equal(plan.md5, 'feedface99999999');
  assert.equal(plan.keeper.path, 'local/main.epub');
  assert.equal(plan.totalReclaimableBytes, 2000);

  const keepAction = plan.actions.find(a => a.action === 'keep');
  assert.ok(keepAction);
  assert.equal(keepAction.file.path, 'local/main.epub');

  const quarAction = plan.actions.find(a => a.action === 'quarantine');
  assert.ok(quarAction);
  assert.equal(quarAction.file.path, 'T:/backup/main.epub');
  assert.ok(quarAction.targetQuarantinePath.startsWith('.quarantine/feedface_'));
});
