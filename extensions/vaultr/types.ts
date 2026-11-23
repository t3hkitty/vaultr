/**
 * Vaultr Type Definitions
 * Sidecar-first metadata, targeted rclone commands, deduplication, and AnyMD host contract.
 */

export type VaultrLogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface VaultrLogEntry {
  timestamp: string;
  level: VaultrLogLevel;
  source: 'vaultr';
  stage: 'init' | 'sidecar' | 'index' | 'rclone' | 'dedupe' | 'ui' | 'mount';
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
  sidecarPath?: string;        // Path to the .anymd sidecar file
  custom?: Record<string, unknown>;
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
