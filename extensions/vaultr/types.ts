/**
 * Vaultr Type Definitions
 * Sidecar-first metadata, targeted rclone commands, deduplication, and AnyMD host contract.
 */

export type VaultrLogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface VaultrLogEntry {
  timestamp: string;
  level: VaultrLogLevel;
  source: 'vaultr' | 'vaultr:virtual-folders' | 'vaultr:playlistr' | string;
  stage: 'init' | 'sidecar' | 'index' | 'rclone' | 'dedupe' | 'ui' | 'mount' | string;
  message: string;
  meta?: Record<string, unknown>;
}

/**
 * AnyMD Extension Host Contract
 */
export interface AnyMDExtensionHost {
  log: (entry: VaultrLogEntry) => void;
  registerSlot?: (slotName: string, componentOrElement: HTMLElement | unknown) => void;
  unregisterSlot?: (slotName: string) => void;
  getVaultRoot?: () => string;
  getSettings?: () => Record<string, unknown>;
  saveSettings?: (settings: Record<string, unknown>) => Promise<void>;
}

/**
 * .anymd sidecar YAML frontmatter & metadata structure
 */
export interface VaultrFileMetadata {
  path: string;
  remote: string;              // 'local' | 'Z:' | 'T:' | 'davjump:' | 'koofr:' | 'tbox:' | 'meow-vault' | etc.
  remotePath: string;          // relative or absolute path on remote/mount
  md5: string;                 // Hex MD5 digest for dedupe
  size: number;                // bytes
  mtime: string;               // ISO 8601 or UNIX timestamp string
  mimeOrExt: string;           // e.g. 'application/pdf', 'epub', 'video/mp4'
  tags: string[];              // Tags / labels
  added_at?: string;           // Immutable ISO-8601 timestamp when indexed/ingested
  ingest_source?: 'downloads' | 'import' | 'lsf' | 'saf' | string; // Origin hint
  virtual_folders?: string[];  // Multi-select assigned virtual folders/shelves
  sidecarPath?: string;        // Path to the .anymd sidecar file
  asset_stem?: string;         // Normalized base name for rendition families
  renditions?: Record<string, string>; // e.g. { source_master: "...", vector_master: "...", print_export: "...", web_preview: "..." }
  rendition_role?: 'source_master' | 'vector_master' | 'print_export' | 'web_preview' | 'sister_rendition' | string;
  
  // Secondary Disambiguators & Identity Keys (The Carol Smythson rule)
  uid?: string;                // Stable unique ID (e.g. klib-z20261123-1807-9f3a21)
  creator_display?: string;    // Display name of author / artist
  creator_id?: string;         // Canonical ID; never auto-set on name match alone
  disambiguators?: {
    series?: string;
    volume?: number | string;
    year?: number | string;
    publisher_or_source?: string;
    identifier?: string; // ISBN, DOI, canonical URL, archive ID
    context?: string;    // work, fiction, archive, reference
  };
  identity_key?: string;       // e.g. "light_novel::cr_carol_smythson_01::ashen_loom::v001::2025"
  dedupe_policy?: {
    on_same_identity_key?: 'alt_format_single_entry' | string;
    on_name_collision_diff_context?: 'keep_separate' | string;
    on_ambiguous_match?: 'quarantine_review' | string;
  };
  review_status?: 'none' | 'quarantined_alt_format_review' | 'quarantined_name_collision' | string;
  alt_formats?: string[];      // Linked alternate formats
  dev_notes?: string[];        // Diagnostic & origin history notes
  custom?: Record<string, unknown>;
}

export type RenditionRole =
  | 'source_master'
  | 'vector_master'
  | 'print_export'
  | 'web_preview'
  | 'sister_rendition'
  | string;

export interface AssetFamily {
  asset_stem: string;
  title: string;
  items: VaultrFileMetadata[];
  renditions: Record<string, VaultrFileMetadata>;
  webPreview?: VaultrFileMetadata;
  sourceMaster?: VaultrFileMetadata;
  identityKey?: string;
  disambiguatorSummary?: string;
}

/**
 * Duplicate MD5 cluster representation
 */
export interface DuplicateCluster {
  md5: string;
  totalSize: number;
  duplicateCount: number;
  keeperPath?: string;
  items: VaultrFileMetadata[];
}

export type DuplicateActionType = 'keep' | 'quarantine' | 'symlink' | 'ignore';

export interface DuplicateResolutionPlanItem {
  file: VaultrFileMetadata;
  action: DuplicateActionType;
  targetQuarantinePath?: string;
  reason: string;
}

export interface DuplicateResolutionPlan {
  clusterId: string;
  md5: string;
  keeper: VaultrFileMetadata;
  actions: DuplicateResolutionPlanItem[];
  dryRun: boolean;
  totalReclaimableBytes: number;
}

/**
 * Targeted Rclone Command Builders
 */
export type RcloneCommandKind = 'lsf' | 'copyto' | 'cat' | 'files-from' | 'rc';

export interface RcloneCommandSpec {
  kind: RcloneCommandKind;
  command: string;
  args: string[];
  fullCommandLine: string;
  cwd?: string;
  isDryRun: boolean;
  description: string;
}

export interface RcloneRcdRequest {
  endpoint: string; // e.g. http://127.0.0.1:5572
  method: string;   // e.g. 'operations/copyfile', 'operations/list'
  params: Record<string, unknown>;
}

/**
 * Shelf definition for Kittlibr-style dynamic categorization
 */
export interface VaultrShelf {
  id: string;
  label: string;
  filterFn?: (item: VaultrFileMetadata) => boolean;
  icon?: string;
  itemCount?: number;
}
