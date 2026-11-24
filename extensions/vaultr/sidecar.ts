import type { VaultrFileMetadata, VaultrLogEntry } from './types.js';

/**
 * Parses frontmatter YAML and body from a string without external dependencies.
 * Tolerates standard YAML key-values, lists, quotes, and timestamps.
 */
export function parseYamlFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith('---')) {
    return { frontmatter: {}, body: content };
  }

  const endMarker = trimmed.indexOf('\n---', 3);
  if (endMarker === -1) {
    return { frontmatter: {}, body: content };
  }

  const rawYaml = trimmed.slice(3, endMarker).trim();
  const body = trimmed.slice(endMarker + 4).trimStart();
  const frontmatter: Record<string, unknown> = {};

  const lines = rawYaml.split(/\r?\n/);
  let currentArrayKey: string | null = null;
  let currentDictKey: string | null = null;
  let currentArray: unknown[] = [];

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith('#')) {
      continue;
    }

    // List item under an array key
    if (trimmedLine.startsWith('- ') && currentArrayKey) {
      currentDictKey = null; // We are definitely in an array, not a dictionary
      const val = trimmedLine.slice(2).trim();
      currentArray.push(parseYamlScalar(val));
      continue;
    }

    const colonIdx = trimmedLine.indexOf(':');
    if (colonIdx > 0) {
      const isIndented = line.startsWith('  ') || line.startsWith('\t');
      const key = trimmedLine.slice(0, colonIdx).trim();
      const rawValue = trimmedLine.slice(colonIdx + 1).trim();

      // If we are currently collecting a nested dictionary (e.g. renditions:)
      if (isIndented && currentDictKey) {
        if (!frontmatter[currentDictKey] || typeof frontmatter[currentDictKey] !== 'object') {
          frontmatter[currentDictKey] = {};
        }
        (frontmatter[currentDictKey] as Record<string, unknown>)[key] = parseYamlScalar(rawValue);
        continue;
      }

      // Flush previous array if active
      if (currentArrayKey) {
        frontmatter[currentArrayKey] = currentArray;
        currentArrayKey = null;
        currentArray = [];
      }
      currentDictKey = null;

      if (rawValue === '') {
        currentArrayKey = key;
        currentDictKey = key;
        currentArray = [];
      } else if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
        // Inline flow sequence: [a, b, c]
        const inner = rawValue.slice(1, -1).trim();
        const items = inner ? inner.split(',').map(s => parseYamlScalar(s.trim())) : [];
        frontmatter[key] = items;
      } else {
        frontmatter[key] = parseYamlScalar(rawValue);
      }
    }
  }

  if (currentArrayKey) {
    // If dictionary wasn't populated for this key, keep the array
    if (!frontmatter[currentArrayKey] || Array.isArray(frontmatter[currentArrayKey])) {
      frontmatter[currentArrayKey] = currentArray;
    }
  }

  return { frontmatter, body };
}

function parseYamlScalar(val: string): unknown {
  // Strip quotes if any
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    return val.slice(1, -1);
  }
  if (val.toLowerCase() === 'true') return true;
  if (val.toLowerCase() === 'false') return false;
  if (val.toLowerCase() === 'null') return null;
  const num = Number(val);
  if (!Number.isNaN(num) && val.trim() !== '') return num;
  return val;
}

/**
 * Serializes VaultrFileMetadata into valid .anymd YAML frontmatter + markdown body
 */
export function serializeYamlFrontmatter(metadata: VaultrFileMetadata, notesBody = ''): string {
  const lines: string[] = ['---'];
  lines.push(`path: ${metadata.path}`);
  lines.push(`remote: ${metadata.remote}`);
  lines.push(`remotePath: ${metadata.remotePath}`);
  lines.push(`md5: ${metadata.md5}`);
  lines.push(`size: ${metadata.size}`);
  lines.push(`mtime: "${metadata.mtime}"`);
  lines.push(`mimeOrExt: ${metadata.mimeOrExt}`);

  if (metadata.tags && metadata.tags.length > 0) {
    lines.push('tags:');
    for (const tag of metadata.tags) {
      lines.push(`  - ${tag}`);
    }
  } else {
    lines.push('tags: []');
  }

  if (metadata.added_at) {
    lines.push(`added_at: "${metadata.added_at}"`);
  }
  if (metadata.ingest_source) {
    lines.push(`ingest_source: ${metadata.ingest_source}`);
  }
  if (metadata.virtual_folders && metadata.virtual_folders.length > 0) {
    lines.push('virtual_folders:');
    for (const vf of metadata.virtual_folders) {
      lines.push(`  - "${vf}"`);
    }
  }

  if (metadata.asset_stem) {
    lines.push(`asset_stem: ${metadata.asset_stem}`);
  }
  if (metadata.rendition_role) {
    lines.push(`rendition_role: ${metadata.rendition_role}`);
  }
  if (metadata.renditions && Object.keys(metadata.renditions).length > 0) {
    lines.push('renditions:');
    for (const [role, rPath] of Object.entries(metadata.renditions)) {
      lines.push(`  ${role}: "${rPath}"`);
    }
  }

  if (metadata.uid) {
    lines.push(`uid: "${metadata.uid}"`);
  }
  if (metadata.creator_display) {
    lines.push(`creator_display: "${metadata.creator_display}"`);
  }
  if (metadata.creator_id) {
    lines.push(`creator_id: "${metadata.creator_id}"`);
  }
  if (metadata.identity_key) {
    lines.push(`identity_key: "${metadata.identity_key}"`);
  }
  if (metadata.review_status) {
    lines.push(`review_status: "${metadata.review_status}"`);
  }
  if (metadata.disambiguators && Object.keys(metadata.disambiguators).length > 0) {
    lines.push('disambiguators:');
    for (const [k, v] of Object.entries(metadata.disambiguators)) {
      if (v !== undefined && v !== null) {
        lines.push(`  ${k}: ${typeof v === 'string' ? `"${v}"` : v}`);
      }
    }
  }
  if (metadata.dedupe_policy && Object.keys(metadata.dedupe_policy).length > 0) {
    lines.push('dedupe_policy:');
    for (const [k, v] of Object.entries(metadata.dedupe_policy)) {
      lines.push(`  ${k}: "${v}"`);
    }
  }

  if (metadata.dev_notes && metadata.dev_notes.length > 0) {
    lines.push('dev_notes:');
    for (const note of metadata.dev_notes) {
      lines.push(`  - "${note.replace(/"/g, '\\"')}"`);
    }
  }

  if (metadata.sidecarPath) {
    lines.push(`sidecarPath: ${metadata.sidecarPath}`);
  }

  if (metadata.custom) {
    for (const [k, v] of Object.entries(metadata.custom)) {
      lines.push(`${k}: ${JSON.stringify(v)}`);
    }
  }

  lines.push('---');
  lines.push('');
  if (notesBody) {
    lines.push(notesBody);
  } else {
    lines.push(`# ${metadata.path.split(/[\/\\]/).pop() || 'File'}`);
    lines.push(`Sidecar index record for \`${metadata.remote}:${metadata.remotePath}\``);
  }

  return lines.join('\n');
}

/**
 * Extracts normalized VaultrFileMetadata from an .anymd sidecar content
 */
export function parseSidecarContent(content: string, sidecarPath?: string): VaultrFileMetadata | null {
  const { frontmatter } = parseYamlFrontmatter(content);
  if (!frontmatter || typeof frontmatter !== 'object') {
    return null;
  }

  const path = String(frontmatter.path || '');
  const md5 = String(frontmatter.md5 || '').toLowerCase().trim();

  if (!path && !md5 && !frontmatter.uid) {
    return null;
  }

  const tags: string[] = Array.isArray(frontmatter.tags)
    ? frontmatter.tags.map(t => String(t).trim())
    : [];

  const virtualFolders: string[] = Array.isArray(frontmatter.virtual_folders)
    ? frontmatter.virtual_folders.map(v => String(v).trim())
    : [];

  const addedAt = frontmatter.added_at ? String(frontmatter.added_at) : undefined;
  const ingestSource = frontmatter.ingest_source ? String(frontmatter.ingest_source) : undefined;
  const assetStem = frontmatter.asset_stem ? String(frontmatter.asset_stem) : undefined;
  const renditionRole = frontmatter.rendition_role ? String(frontmatter.rendition_role) : undefined;

  let renditions: Record<string, string> | undefined;
  if (frontmatter.renditions && typeof frontmatter.renditions === 'object') {
    renditions = {};
    for (const [k, v] of Object.entries(frontmatter.renditions as Record<string, unknown>)) {
      renditions[k] = String(v);
    }
  }

  const uid = frontmatter.uid ? String(frontmatter.uid) : undefined;
  const creatorDisplay = frontmatter.creator_display ? String(frontmatter.creator_display) : undefined;
  const creatorId = frontmatter.creator_id ? String(frontmatter.creator_id) : undefined;
  const identityKey = frontmatter.identity_key ? String(frontmatter.identity_key) : undefined;
  const reviewStatus = frontmatter.review_status ? String(frontmatter.review_status) : undefined;
  const disambiguators = frontmatter.disambiguators && typeof frontmatter.disambiguators === 'object'
    ? (frontmatter.disambiguators as Record<string, unknown>)
    : undefined;
  const dedupePolicy = frontmatter.dedupe_policy && typeof frontmatter.dedupe_policy === 'object'
    ? (frontmatter.dedupe_policy as Record<string, string>)
    : undefined;
  const devNotes: string[] = Array.isArray(frontmatter.dev_notes)
    ? frontmatter.dev_notes.map(n => String(n).trim())
    : [];

  return {
    path: path || (sidecarPath ? sidecarPath.replace(/\.anymd$/i, '') : 'unknown'),
    remote: String(frontmatter.remote || 'local'),
    remotePath: String(frontmatter.remotePath || frontmatter.path || ''),
    md5: md5,
    size: Number(frontmatter.size) || 0,
    mtime: String(frontmatter.mtime || new Date().toISOString()),
    mimeOrExt: String(frontmatter.mimeOrExt || (path ? path.split('.').pop() || 'bin' : 'bin')),
    tags,
    added_at: addedAt,
    ingest_source: ingestSource,
    virtual_folders: virtualFolders,
    sidecarPath: sidecarPath || String(frontmatter.sidecarPath || ''),
    asset_stem: assetStem,
    rendition_role: renditionRole,
    renditions,
    uid,
    creator_display: creatorDisplay,
    creator_id: creatorId,
    identity_key: identityKey,
    disambiguators: disambiguators as any,
    dedupe_policy: dedupePolicy as any,
    review_status: reviewStatus as any,
    dev_notes: devNotes.length > 0 ? devNotes : undefined,
    custom: Object.fromEntries(
      Object.entries(frontmatter).filter(([k]) =>
        ![
          'path',
          'remote',
          'remotePath',
          'md5',
          'size',
          'mtime',
          'mimeOrExt',
          'tags',
          'added_at',
          'ingest_source',
          'virtual_folders',
          'sidecarPath',
          'asset_stem',
          'rendition_role',
          'renditions',
          'uid',
          'creator_display',
          'creator_id',
          'identity_key',
          'disambiguators',
          'dedupe_policy',
          'review_status',
          'alt_formats',
          'dev_notes'
        ].includes(k)
      )
    )
  };
}

/**
 * In-memory index of sidecars for rapid browsing without live disk walks
 */
export class SidecarIndex {
  private itemsByPath = new Map<string, VaultrFileMetadata>();
  private itemsByMd5 = new Map<string, VaultrFileMetadata[]>();
  private logEmitter?: (entry: VaultrLogEntry) => void;

  constructor(logEmitter?: (entry: VaultrLogEntry) => void) {
    this.logEmitter = logEmitter;
  }

  public register(item: VaultrFileMetadata): void {
    this.itemsByPath.set(item.path, item);

    if (item.md5) {
      const existing = this.itemsByMd5.get(item.md5) || [];
      const idx = existing.findIndex(e => e.path === item.path);
      if (idx >= 0) {
        existing[idx] = item;
      } else {
        existing.push(item);
      }
      this.itemsByMd5.set(item.md5, existing);
    }
  }

  public registerBatch(items: VaultrFileMetadata[]): void {
    for (const item of items) {
      this.register(item);
    }
    this.logEmitter?.({
      timestamp: new Date().toISOString(),
      level: 'info',
      source: 'vaultr',
      stage: 'index',
      message: `Indexed ${items.length} sidecar metadata items. Total in index: ${this.itemsByPath.size}`,
      meta: { count: items.length, total: this.itemsByPath.size }
    });
  }

  public getByPath(path: string): VaultrFileMetadata | undefined {
    return this.itemsByPath.get(path);
  }

  public getByMd5(md5: string): VaultrFileMetadata[] {
    return this.itemsByMd5.get(md5.toLowerCase().trim()) || [];
  }

  public getAll(): VaultrFileMetadata[] {
    return Array.from(this.itemsByPath.values());
  }

  public getByRemote(remote: string): VaultrFileMetadata[] {
    return this.getAll().filter(item => item.remote.toLowerCase() === remote.toLowerCase());
  }

  public clear(): void {
    this.itemsByPath.clear();
    this.itemsByMd5.clear();
  }

  public get size(): number {
    return this.itemsByPath.size;
  }
}
