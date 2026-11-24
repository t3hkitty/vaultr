import type {
  VaultrFileMetadata,
  DuplicateCluster,
  DuplicateResolutionPlan,
  DuplicateResolutionPlanItem,
  VaultrLogEntry,
  AssetFamily,
  RenditionRole
} from './types.js';

export interface DedupeOptions {
  quarantineDir?: string;
  preferredRemotesOrder?: string[]; // e.g. ['local', 'Z:', 'T:', 'koofr:', 'davjump:']
  keepCriteria?: 'newest' | 'oldest' | 'preferred-remote' | 'shortest-path';
  dryRun?: boolean;
  protectRenditions?: boolean; // When true, protects intentional format variants from sweep
}

/**
 * Known resolution, media, and edition suffixes stripped or classified
 */
const RENDITION_SUFFIXES = [
  /_thumb$/i,
  /_preview$/i,
  /_print$/i,
  /_300dpi$/i,
  /_web$/i,
  /_export$/i,
  /@2x$/i,
  /@3x$/i,
  /_master$/i,
  /_movie_edition$/i,
  /_movie_tie_in$/i
];

export type VaultMedium = 'audio' | 'manga' | 'light_novel' | 'novel' | 'movie_edition' | 'art' | 'document';

/**
 * Detects the medium / adaptation domain of a file to prevent collision
 * between light novels, manga chapters, audiobooks, and movie reprint editions.
 */
export function detectFileMedium(filePath: string, mimeOrExt?: string): VaultMedium {
  const lowerPath = filePath.toLowerCase().replace(/[-_]/g, ' ');
  const ext = (mimeOrExt || filePath.split('.').pop() || '').toLowerCase();

  if (['mp3', 'm4b', 'm4a', 'flac', 'aac', 'opus', 'ogg'].includes(ext) || lowerPath.includes('audiobook') || lowerPath.includes('[audio]')) {
    return 'audio';
  }
  if (['cbz', 'cbr'].includes(ext) || lowerPath.includes('manga') || lowerPath.includes('[manga]')) {
    return 'manga';
  }
  if (['kra', 'psd', 'clip', 'afdesign', 'svg', 'ai'].includes(ext)) {
    return 'art';
  }
  if (lowerPath.includes('movie tie in') || lowerPath.includes('movie edition') || lowerPath.includes('film tie in')) {
    return 'movie_edition';
  }
  if (lowerPath.includes('light novel') || lowerPath.includes(' ln ') || lowerPath.includes('[ln]') || lowerPath.endsWith(' ln')) {
    return 'light_novel';
  }
  return 'novel';
}

/**
 * Extracts a normalized asset stem from a file path.
 * When qualifyMedium is enabled, prepends the detected medium (e.g. "audio:solo_leveling", "manga:solo_leveling", "novel:solo_leveling")
 * so manga, light novels, and audiobooks with the exact same title are kept as distinct works.
 */
export function extractAssetStem(filePath: string, qualifyMedium = false, mimeOrExt?: string): string {
  const filename = filePath.split(/[\/\\]/).pop() || filePath;
  let base = filename.replace(/\.[^.]+$/, ''); // Strip extension

  for (const suffixPattern of RENDITION_SUFFIXES) {
    base = base.replace(suffixPattern, '');
  }
  const cleanStem = base.toLowerCase().trim();
  if (qualifyMedium) {
    const medium = detectFileMedium(filePath, mimeOrExt);
    return `${medium}:${cleanStem}`;
  }
  return cleanStem;
}

/**
 * Classifies the rendition role based on extension and filename patterns
 */
export function classifyRenditionRole(item: VaultrFileMetadata): RenditionRole {
  if (item.rendition_role) return item.rendition_role;

  const ext = (item.mimeOrExt || item.path.split('.').pop() || '').toLowerCase();
  const lowerPath = item.path.toLowerCase();

  // Art Roles
  if (['kra', 'psd', 'clip', 'afdesign'].includes(ext)) {
    return 'source_master';
  }
  if (['svg', 'eps', 'ai'].includes(ext)) {
    return 'vector_master';
  }
  if (ext === 'png' && (lowerPath.includes('_print') || (item.size && item.size > 2000000))) {
    return 'print_export';
  }
  if (['webp', 'jpg', 'jpeg'].includes(ext) && (lowerPath.includes('_thumb') || (item.size && item.size < 500000))) {
    return 'web_preview';
  }

  // Audio / Audiobook Adaptation
  if (['m4b', 'mp3', 'm4a', 'flac'].includes(ext) || lowerPath.includes('audiobook')) {
    return 'audiobook_adaptation';
  }

  // Manga / Comic Adaptation
  if (['cbz', 'cbr'].includes(ext) || lowerPath.includes('manga')) {
    return 'manga_adaptation';
  }

  // Movie Reprint / Tie-In Edition
  if (lowerPath.includes('movie tie-in') || lowerPath.includes('movie edition') || lowerPath.includes('movie_edition')) {
    return 'reprint_movie_edition';
  }

  // Book / Notes Sister Rendition (EPUB + MD)
  if (['epub', 'md', 'txt'].includes(ext)) {
    return 'sister_rendition';
  }

  return 'variant';
}

export interface AltFormatScoreResult {
  score: number; // 0.0 to 1.0
  isCompatibleMedium: boolean;
  category: 'true_duplicate' | 'rendition_family' | 'alt_format_candidate' | 'distinct_work';
  reasons: string[];
}

/**
 * Calculates the likelihood (0.0 to 1.0) that two files are intentional alternate format variants
 * rather than accidental duplicate clutter or distinct unrelated works.
 *
 * Scoring signals:
 * - Normalized Stem Similarity: +0.35
 * - Compatible Medium Check: +0.30 (or hard cap/penalty if mediums conflict)
 * - Known Rendition Pair / Format Bridge: +0.20
 * - Metadata / Hash Agreement: +0.15
 */
export function calculateAltFormatLikelihood(
  fileA: VaultrFileMetadata,
  fileB: VaultrFileMetadata
): AltFormatScoreResult {
  const reasons: string[] = [];
  let score = 0;

  const stemA = fileA.asset_stem || extractAssetStem(fileA.path);
  const stemB = fileB.asset_stem || extractAssetStem(fileB.path);

  const mediumA = detectFileMedium(fileA.path, fileA.mimeOrExt);
  const mediumB = detectFileMedium(fileB.path, fileB.mimeOrExt);

  const extA = (fileA.mimeOrExt || fileA.path.split('.').pop() || '').toLowerCase();
  const extB = (fileB.mimeOrExt || fileB.path.split('.').pop() || '').toLowerCase();

  // 1. Check exact cryptographic duplicate
  if (fileA.md5 && fileB.md5 && fileA.md5.toLowerCase() === fileB.md5.toLowerCase() && extA === extB) {
    return {
      score: 1.0,
      isCompatibleMedium: true,
      category: 'true_duplicate',
      reasons: ['Identical hash and identical format']
    };
  }

  // 2. Normalized Stem Similarity (+0.35)
  if (stemA === stemB) {
    score += 0.35;
    reasons.push('Identical normalized asset stem');
  } else if (stemA.includes(stemB) || stemB.includes(stemA)) {
    score += 0.20;
    reasons.push('Overlapping asset stem');
  }

  // 3. Compatible Medium Check (+0.30 or penalty)
  const isCompatibleMedium = mediumA === mediumB ||
    (mediumA === 'art' && mediumB === 'art') ||
    (['novel', 'light_novel'].includes(mediumA) && ['novel', 'light_novel'].includes(mediumB));

  if (isCompatibleMedium) {
    score += 0.30;
    reasons.push(`Compatible medium (${mediumA} <=> ${mediumB})`);
  } else {
    // Hard penalty when manga, light novels, and audiobooks cross
    score = Math.max(0, score - 0.25);
    reasons.push(`Conflicting media types (${mediumA} vs ${mediumB})`);
  }

  // 4. Known Rendition Pair / Format Bridge (+0.20)
  const artExts = ['kra', 'psd', 'clip', 'afdesign', 'svg', 'ai', 'png', 'webp', 'jpg', 'jpeg'];
  const isArtPair = artExts.includes(extA) && artExts.includes(extB) && extA !== extB;
  const isBookSister = (['epub', 'mobi', 'pdf'].includes(extA) && ['md', 'txt'].includes(extB)) ||
                       (['epub', 'mobi', 'pdf'].includes(extB) && ['md', 'txt'].includes(extA));

  if (isArtPair || isBookSister) {
    score += 0.20;
    reasons.push(isArtPair ? 'Known art rendition bridge (master/vector/export)' : 'Known book/notes sister pair');
  }

  // 5. Metadata Agreement (+0.15)
  const hasSharedTags = fileA.tags?.some(t => fileB.tags?.includes(t));
  if (hasSharedTags || (fileA.custom?.author && fileA.custom?.author === fileB.custom?.author)) {
    score += 0.15;
    reasons.push('Metadata / author tag agreement');
  }

  // Normalize final score (0.0 to 1.0)
  score = Math.min(1.0, Math.max(0.0, Number(score.toFixed(2))));

  // Action Thresholds:
  // >= 0.70: Rendition Family (protect from sweep)
  // 0.40 - 0.69: alt_format_candidate (review needed)
  // < 0.40: distinct_work (keep separate)
  let category: AltFormatScoreResult['category'] = 'distinct_work';
  if (score >= 0.70 && isCompatibleMedium) {
    category = 'rendition_family';
  } else if (score >= 0.40) {
    category = 'alt_format_candidate';
  }

  return {
    score,
    isCompatibleMedium,
    category,
    reasons
  };
}

/**
 * Groups files sharing the same normalized asset stem into Asset Families (Rendition Groups)
 * Prevents sister files (.md + .epub) and multi-format art pipelines from being flagged as duplicates.
 */
export function groupAssetFamilies(
  items: VaultrFileMetadata[],
  logEmitter?: (entry: VaultrLogEntry) => void
): AssetFamily[] {
  const map = new Map<string, VaultrFileMetadata[]>();

  for (const item of items) {
    const stem = item.asset_stem || extractAssetStem(item.path);
    const group = map.get(stem) || [];
    group.push(item);
    map.set(stem, group);
  }

  const families: AssetFamily[] = [];

  for (const [stem, fileList] of map.entries()) {
    const renditions: Record<string, VaultrFileMetadata> = {};
    let webPreview: VaultrFileMetadata | undefined;
    let sourceMaster: VaultrFileMetadata | undefined;

    for (const f of fileList) {
      const role = classifyRenditionRole(f);
      renditions[role] = f;
      if (role === 'web_preview' && !webPreview) webPreview = f;
      if (role === 'source_master' && !sourceMaster) sourceMaster = f;
    }

    const title = stem.replace(/_|-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

    families.push({
      asset_stem: stem,
      title,
      items: fileList,
      renditions,
      webPreview: webPreview || fileList.find(f => /\.(png|webp|jpg|jpeg)$/i.test(f.path)),
      sourceMaster: sourceMaster || fileList.find(f => /\.(kra|psd|clip|svg|afdesign)$/i.test(f.path))
    });
  }

  logEmitter?.({
    timestamp: new Date().toISOString(),
    level: 'info',
    source: 'vaultr:renditions',
    stage: 'index',
    message: `Organized ${items.length} files into ${families.length} asset families.`,
    meta: { familyCount: families.length }
  });

  return families;
}

/**
 * Groups indexed files by MD5 checksum to discover duplicate clusters
 */
export function groupDuplicatesByMd5(
  items: VaultrFileMetadata[],
  logEmitter?: (entry: VaultrLogEntry) => void
): DuplicateCluster[] {
  const map = new Map<string, VaultrFileMetadata[]>();

  for (const item of items) {
    if (!item.md5 || item.md5.trim() === '') continue;
    const md5 = item.md5.toLowerCase().trim();
    const group = map.get(md5) || [];
    group.push(item);
    map.set(md5, group);
  }

  const clusters: DuplicateCluster[] = [];

  for (const [md5, fileList] of map.entries()) {
    if (fileList.length > 1) {
      const totalSize = fileList.reduce((acc, f) => acc + (f.size || 0), 0);
      clusters.push({
        md5,
        totalSize,
        duplicateCount: fileList.length,
        items: fileList
      });
    }
  }

  // Sort clusters descending by wasted bytes
  clusters.sort((a, b) => {
    const wastedA = (a.duplicateCount - 1) * (a.items[0]?.size || 0);
    const wastedB = (b.duplicateCount - 1) * (b.items[0]?.size || 0);
    return wastedB - wastedA;
  });

  logEmitter?.({
    timestamp: new Date().toISOString(),
    level: 'info',
    source: 'vaultr',
    stage: 'dedupe',
    message: `Found ${clusters.length} duplicate MD5 clusters across ${items.length} files.`,
    meta: {
      clusterCount: clusters.length,
      totalDuplicates: clusters.reduce((sum, c) => sum + (c.duplicateCount - 1), 0)
    }
  });

  return clusters;
}

/**
 * Deterministically picks a "keeper" from a duplicate cluster based on preferences
 */
export function selectKeeper(
  items: VaultrFileMetadata[],
  options: DedupeOptions = {}
): VaultrFileMetadata {
  if (!items || items.length === 0) {
    throw new Error('Cannot select keeper from empty list');
  }
  if (items.length === 1) {
    return items[0];
  }

  const preferredRemotes = options.preferredRemotesOrder || ['local', 'Z:', 'T:', 'meow-vault', 'koofr:', 'davjump:', 'tbox:'];
  const criteria = options.keepCriteria || 'preferred-remote';

  const scored = [...items].sort((a, b) => {
    // 1. Preferred remote check
    if (criteria === 'preferred-remote' || criteria === undefined) {
      const rankA = preferredRemotes.findIndex(r => r.toLowerCase() === a.remote.toLowerCase());
      const rankB = preferredRemotes.findIndex(r => r.toLowerCase() === b.remote.toLowerCase());
      const effectiveRankA = rankA >= 0 ? rankA : 999;
      const effectiveRankB = rankB >= 0 ? rankB : 999;
      if (effectiveRankA !== effectiveRankB) {
        return effectiveRankA - effectiveRankB;
      }
    }

    // 2. Shortest path (cleanest location)
    if (criteria === 'shortest-path') {
      if (a.path.length !== b.path.length) {
        return a.path.length - b.path.length;
      }
    }

    // 3. Newest mtime
    if (criteria === 'newest') {
      const timeA = new Date(a.mtime).getTime() || 0;
      const timeB = new Date(b.mtime).getTime() || 0;
      if (timeA !== timeB) return timeB - timeA;
    }

    // 4. Oldest mtime
    if (criteria === 'oldest') {
      const timeA = new Date(a.mtime).getTime() || 0;
      const timeB = new Date(b.mtime).getTime() || 0;
      if (timeA !== timeB) return timeA - timeB;
    }

    // Fallback: alphabetical path stability
    return a.path.localeCompare(b.path);
  });

  return scored[0];
}

/**
 * Creates a duplicate resolution plan without deleting any files.
 * Generates quarantine paths, dry-run previews, and explicit safe operations.
 */
export function buildResolutionPlan(
  cluster: DuplicateCluster,
  options: DedupeOptions = {}
): DuplicateResolutionPlan {
  const keeper = selectKeeper(cluster.items, options);
  const quarantineDir = options.quarantineDir || '.vaultr_quarantine';
  const dryRun = options.dryRun ?? true;

  const actions: DuplicateResolutionPlanItem[] = [];
  let reclaimableBytes = 0;

  for (const item of cluster.items) {
    if (item.path === keeper.path && item.remote === keeper.remote) {
      actions.push({
        file: item,
        action: 'keep',
        reason: 'Selected as canonical keeper based on dedupe policy'
      });
    } else {
      // Rendition Sweep Immunity Check
      const keeperExt = (keeper.mimeOrExt || keeper.path.split('.').pop() || '').toLowerCase();
      const itemExt = (item.mimeOrExt || item.path.split('.').pop() || '').toLowerCase();
      const isRendition = (options.protectRenditions ?? true) && (
        keeperExt !== itemExt ||
        Boolean(item.renditions) ||
        Boolean(item.rendition_role)
      );

      if (isRendition) {
        actions.push({
          file: item,
          action: 'ignore',
          reason: `Protected format rendition / sister variant (${itemExt}) under Pillar V sweep immunity`
        });
        continue;
      }

      const filename = item.path.split(/[\/\\]/).pop() || 'duplicate';
      const targetQuarantinePath = `${quarantineDir}/${cluster.md5.slice(0, 8)}_${filename}`;
      reclaimableBytes += item.size || 0;

      actions.push({
        file: item,
        action: 'quarantine',
        targetQuarantinePath,
        reason: `Duplicate of keeper [${keeper.remote}:${keeper.path}] with matching md5 ${cluster.md5}`
      });
    }
  }

  return {
    clusterId: cluster.md5,
    md5: cluster.md5,
    keeper,
    actions,
    dryRun,
    totalReclaimableBytes: reclaimableBytes
  };
}
