import type {
  VaultrFileMetadata,
  DuplicateCluster,
  DuplicateResolutionPlan,
  DuplicateResolutionPlanItem,
  VaultrLogEntry
} from './types.js';

export interface DedupeOptions {
  quarantineDir?: string;
  preferredRemotesOrder?: string[]; // e.g. ['local', 'Z:', 'T:', 'koofr:', 'davjump:']
  keepCriteria?: 'newest' | 'oldest' | 'preferred-remote' | 'shortest-path';
  dryRun?: boolean;
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
