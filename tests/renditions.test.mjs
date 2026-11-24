import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractAssetStem,
  detectFileMedium,
  classifyRenditionRole,
  calculateAltFormatLikelihood,
  groupAssetFamilies,
  buildResolutionPlan
} from '../dist/dedupe.js';
import { parseSidecarContent, serializeYamlFrontmatter } from '../dist/sidecar.js';

test('detectFileMedium separates manga, light novels, audiobooks, and movie editions', () => {
  assert.equal(detectFileMedium('audiobooks/Solo_Leveling_Vol1.m4b'), 'audio');
  assert.equal(detectFileMedium('manga/Solo_Leveling_ch01.cbz'), 'manga');
  assert.equal(detectFileMedium('novels/Solo_Leveling_LN_Vol1.epub'), 'light_novel');
  assert.equal(detectFileMedium('novels/Dune_Movie_Tie_In.epub'), 'movie_edition');
  assert.equal(detectFileMedium('art/buzzed_stitch.kra'), 'art');
});

test('extractAssetStem with qualifyMedium keeps adaptation stems separate', () => {
  const audioStem = extractAssetStem('audiobooks/Dune.m4b', true);
  const bookStem = extractAssetStem('novels/Dune.epub', true);
  const movieStem = extractAssetStem('novels/Dune_Movie_Edition.epub', true);

  assert.equal(audioStem, 'audio:dune');
  assert.equal(bookStem, 'novel:dune');
  assert.equal(movieStem, 'movie_edition:dune');
  assert.notEqual(audioStem, bookStem);
});

test('calculateAltFormatLikelihood distinguishes format renditions from conflicting media', () => {
  // Art Pair: .kra and .svg
  const artMaster = {
    path: 'art/buzzed_stitch.kra',
    remote: 'local',
    remotePath: 'art/buzzed_stitch.kra',
    md5: 'md5_kra',
    size: 40000000,
    mtime: '2026-11-20T10:00:00Z',
    mimeOrExt: 'kra',
    tags: ['art-chan']
  };
  const artVector = {
    path: 'art/buzzed_stitch.svg',
    remote: 'local',
    remotePath: 'art/buzzed_stitch.svg',
    md5: 'md5_svg',
    size: 200000,
    mtime: '2026-11-20T10:00:00Z',
    mimeOrExt: 'svg',
    tags: ['art-chan']
  };
  const artScore = calculateAltFormatLikelihood(artMaster, artVector);
  assert.ok(artScore.score >= 0.70);
  assert.equal(artScore.category, 'rendition_family');
  assert.equal(artScore.isCompatibleMedium, true);

  // Conflicting Media: Light Novel EPUB vs Manga CBZ with same title
  const lnBook = {
    path: 'novels/Solo_Leveling.epub',
    remote: 'local',
    remotePath: 'novels/Solo_Leveling.epub',
    md5: 'md5_ln',
    size: 1500000,
    mtime: '2026-11-20T10:00:00Z',
    mimeOrExt: 'epub',
    tags: []
  };
  const manga = {
    path: 'manga/Solo_Leveling.cbz',
    remote: 'local',
    remotePath: 'manga/Solo_Leveling.cbz',
    md5: 'md5_cbz',
    size: 30000000,
    mtime: '2026-11-20T10:00:00Z',
    mimeOrExt: 'cbz',
    tags: []
  };
  const conflictScore = calculateAltFormatLikelihood(lnBook, manga);
  assert.ok(conflictScore.score < 0.40);
  assert.equal(conflictScore.category, 'distinct_work');
  assert.equal(conflictScore.isCompatibleMedium, false);
});

test('groupAssetFamilies groups multi-format art renditions into a single family', () => {
  const items = [
    {
      path: 'art-chan/masters/buzzed_stitch.kra',
      remote: 'local',
      remotePath: 'art-chan/masters/buzzed_stitch.kra',
      md5: 'md5_kra',
      size: 45000000,
      mtime: '2026-11-20T10:00:00Z',
      mimeOrExt: 'kra',
      tags: ['art-chan']
    },
    {
      path: 'art-chan/vectors/buzzed_stitch.svg',
      remote: 'local',
      remotePath: 'art-chan/vectors/buzzed_stitch.svg',
      md5: 'md5_svg',
      size: 150000,
      mtime: '2026-11-20T11:00:00Z',
      mimeOrExt: 'svg',
      tags: ['art-chan']
    },
    {
      path: 'art-chan/exports/buzzed_stitch_print.png',
      remote: 'local',
      remotePath: 'art-chan/exports/buzzed_stitch_print.png',
      md5: 'md5_print',
      size: 8500000,
      mtime: '2026-11-20T12:00:00Z',
      mimeOrExt: 'png',
      tags: ['art-chan', 'print']
    },
    {
      path: 'art-chan/thumbs/buzzed_stitch_thumb.webp',
      remote: 'local',
      remotePath: 'art-chan/thumbs/buzzed_stitch_thumb.webp',
      md5: 'md5_thumb',
      size: 42000,
      mtime: '2026-11-20T12:05:00Z',
      mimeOrExt: 'webp',
      tags: ['art-chan']
    }
  ];

  const families = groupAssetFamilies(items);
  assert.equal(families.length, 1);
  assert.equal(families[0].asset_stem, 'buzzed_stitch');
  assert.equal(families[0].items.length, 4);
  assert.equal(families[0].renditions.source_master?.path, 'art-chan/masters/buzzed_stitch.kra');
  assert.equal(families[0].renditions.vector_master?.path, 'art-chan/vectors/buzzed_stitch.svg');
  assert.equal(families[0].renditions.print_export?.path, 'art-chan/exports/buzzed_stitch_print.png');
  assert.equal(families[0].renditions.web_preview?.path, 'art-chan/thumbs/buzzed_stitch_thumb.webp');
});

test('buildResolutionPlan protects format renditions and sister files under Pillar V sweep immunity', () => {
  const cluster = {
    md5: 'shared_hash_collision_or_mock',
    totalSize: 3000000,
    duplicateCount: 2,
    items: [
      {
        path: 'books/scifi.epub',
        remote: 'local',
        remotePath: 'books/scifi.epub',
        md5: 'shared_hash_collision_or_mock',
        size: 1500000,
        mtime: '2026-11-20T10:00:00Z',
        mimeOrExt: 'epub',
        tags: []
      },
      {
        path: 'books/scifi.md',
        remote: 'local',
        remotePath: 'books/scifi.md',
        md5: 'shared_hash_collision_or_mock',
        size: 1500000,
        mtime: '2026-11-20T10:00:00Z',
        mimeOrExt: 'md',
        tags: []
      }
    ]
  };

  const plan = buildResolutionPlan(cluster, { protectRenditions: true });
  // The sister .md file must NOT be marked for quarantine sweep
  const mdAction = plan.actions.find(a => a.file.path.endsWith('.md'));
  assert.ok(mdAction);
  assert.equal(mdAction.action, 'ignore');
  assert.ok(mdAction.reason.includes('Pillar V sweep immunity'));
});

test('sidecar preserves renditions mapping and asset_stem in round-trip serialization', () => {
  const sidecarContent = `---
path: art-chan/masters/buzzed_stitch.kra
remote: local
remotePath: art-chan/masters/buzzed_stitch.kra
md5: aabbccdd11223344
size: 45000000
mtime: "2026-11-20T10:00:00Z"
mimeOrExt: kra
tags:
  - art-chan
  - teepublic
asset_stem: buzzed_stitch
rendition_role: source_master
renditions:
  source_master: "art-chan/masters/buzzed_stitch.kra"
  vector_master: "art-chan/vectors/buzzed_stitch.svg"
  print_export: "art-chan/exports/buzzed_stitch_print.png"
  web_preview: "art-chan/thumbs/buzzed_stitch_thumb.webp"
---
# Buzzed Stitch Master Notes
`;

  const parsed = parseSidecarContent(sidecarContent);
  assert.ok(parsed);
  assert.equal(parsed.asset_stem, 'buzzed_stitch');
  assert.equal(parsed.rendition_role, 'source_master');
  assert.equal(parsed.renditions?.web_preview, 'art-chan/thumbs/buzzed_stitch_thumb.webp');

  const serialized = serializeYamlFrontmatter(parsed);
  assert.ok(serialized.includes('asset_stem: buzzed_stitch'));
  assert.ok(serialized.includes('rendition_role: source_master'));
  assert.ok(serialized.includes('web_preview: "art-chan/thumbs/buzzed_stitch_thumb.webp"'));
});
