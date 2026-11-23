import type { VaultrLogEntry } from './types.js';

export interface SevenZipArchiveEntry {
  path: string;
  size: number;
  packedSize?: number;
  modifiedTime?: string;
  crc?: string;
  attributes?: string;
  isFolder: boolean;
}

export interface SevenZipCommandSpec {
  command: string;
  args: string[];
  fullCommandLine: string;
  description: string;
}

export type SidecarStorageMode =
  | 'hidden-folder'   // Hidden Sidecar Folder .anymd/ (⚡ fastest writes, 🧹 zero file clutter)
  | 'archive-anymdz'  // Sidecar Archive (.anymdz) (⚡ fast 7z updates / ⚡ fast cloud sync, 📦 single-file portable)
  | 'per-file-dot';   // Invisible Per-File Sidecars .filename.anymd (⚡ instant single-file ops, 📄 1:1 file pairing)

export interface SidecarStorageOption {
  mode: SidecarStorageMode;
  label: string;
  description: string;
  extension: string;
}

export const SIDECAR_STORAGE_MODES: SidecarStorageOption[] = [
  {
    mode: 'hidden-folder',
    label: 'Hidden Sidecar Folder (.anymd/)',
    description: '⚡ fastest writes, 🧹 zero file clutter',
    extension: '.anymd'
  },
  {
    mode: 'archive-anymdz',
    label: 'Sidecar Archive (.anymdz)',
    description: '⚡ fast 7z updates / ⚡ fast cloud sync, 📦 single-file portable',
    extension: '.anymdz'
  },
  {
    mode: 'per-file-dot',
    label: 'Invisible Per-File Sidecars (.filename.anymd)',
    description: '⚡ instant single-file ops, 📄 1:1 file pairing',
    extension: '.anymd'
  }
];

export class SevenZipArchiveAdapter {
  private cliPath: string;
  private logEmitter?: (entry: VaultrLogEntry) => void;
  private isAvailable: boolean | null = null;

  constructor(cliPath = '7z', logEmitter?: (entry: VaultrLogEntry) => void) {
    this.cliPath = cliPath;
    this.logEmitter = logEmitter;
  }

  /**
   * Builds `7z l -slt` technical metadata listing command
   * Dumps technical details (path, size, mtime, CRC) in milliseconds without unpacking.
   */
  public buildListEntries(archivePath: string): SevenZipCommandSpec {
    const args = ['l', '-slt', archivePath];
    return {
      command: this.cliPath,
      args,
      fullCommandLine: `${this.cliPath} ${args.map(a => (a.includes(' ') ? `"${a}"` : a)).join(' ')}`,
      description: `List archive entries for ${archivePath} via 7z l -slt (zero-extraction)`
    };
  }

  /**
   * Builds `7z x <archive> <innerPath> -so` single-file extraction stream to stdout
   */
  public buildReadEntryStream(archivePath: string, innerPath: string): SevenZipCommandSpec {
    const args = ['x', archivePath, innerPath, '-so'];
    return {
      command: this.cliPath,
      args,
      fullCommandLine: `${this.cliPath} ${args.map(a => (a.includes(' ') ? `"${a}"` : a)).join(' ')}`,
      description: `Stream extract ${innerPath} from ${archivePath} to stdout via 7z x -so`
    };
  }

  /**
   * Builds `7z u` in-place single-entry update command without full archive rewrites
   */
  public buildUpdateEntry(archivePath: string, tempFilePathOrMask: string): SevenZipCommandSpec {
    const args = ['u', archivePath, tempFilePathOrMask];
    return {
      command: this.cliPath,
      args,
      fullCommandLine: `${this.cliPath} ${args.map(a => (a.includes(' ') ? `"${a}"` : a)).join(' ')}`,
      description: `In-place update ${tempFilePathOrMask} in ${archivePath} via 7z u`
    };
  }

  /**
   * Builds `7z a` add entry command
   */
  public buildAddEntry(archivePath: string, filePathOrMask: string): SevenZipCommandSpec {
    const args = ['a', archivePath, filePathOrMask];
    return {
      command: this.cliPath,
      args,
      fullCommandLine: `${this.cliPath} ${args.map(a => (a.includes(' ') ? `"${a}"` : a)).join(' ')}`,
      description: `Add ${filePathOrMask} to ${archivePath} via 7z a`
    };
  }

  /**
   * Builds `7z d` single-entry deletion command
   */
  public buildDeleteEntry(archivePath: string, innerPath: string): SevenZipCommandSpec {
    const args = ['d', archivePath, innerPath];
    return {
      command: this.cliPath,
      args,
      fullCommandLine: `${this.cliPath} ${args.map(a => (a.includes(' ') ? `"${a}"` : a)).join(' ')}`,
      description: `Delete ${innerPath} from ${archivePath} via 7z d`
    };
  }

  /**
   * Parses the technical `7z l -slt` key-value block output
   */
  public parseSltOutput(rawOutput: string): SevenZipArchiveEntry[] {
    const lines = rawOutput.split(/\r?\n/);
    const entries: SevenZipArchiveEntry[] = [];
    let current: Partial<SevenZipArchiveEntry> | null = null;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        if (current && current.path) {
          entries.push({
            path: current.path,
            size: current.size ?? 0,
            packedSize: current.packedSize,
            modifiedTime: current.modifiedTime,
            crc: current.crc,
            attributes: current.attributes,
            isFolder: current.isFolder ?? false
          });
          current = null;
        }
        continue;
      }

      const eqIdx = line.indexOf(' = ');
      if (eqIdx > 0) {
        const key = line.slice(0, eqIdx).trim();
        const value = line.slice(eqIdx + 3).trim();

        if (key === 'Path') {
          if (current && current.path) {
            entries.push({
              path: current.path,
              size: current.size ?? 0,
              packedSize: current.packedSize,
              modifiedTime: current.modifiedTime,
              crc: current.crc,
              attributes: current.attributes,
              isFolder: current.isFolder ?? false
            });
          }
          current = { path: value, isFolder: false };
        } else if (current) {
          if (key === 'Size') {
            current.size = parseInt(value, 10) || 0;
          } else if (key === 'Packed Size') {
            current.packedSize = parseInt(value, 10) || 0;
          } else if (key === 'Modified') {
            current.modifiedTime = value;
          } else if (key === 'CRC') {
            current.crc = value;
          } else if (key === 'Attributes') {
            current.attributes = value;
            if (value.startsWith('D')) {
              current.isFolder = true;
            }
          } else if (key === 'Folder') {
            current.isFolder = value === '+';
          }
        }
      }
    }

    if (current && current.path) {
      entries.push({
        path: current.path,
        size: current.size ?? 0,
        packedSize: current.packedSize,
        modifiedTime: current.modifiedTime,
        crc: current.crc,
        attributes: current.attributes,
        isFolder: current.isFolder ?? false
      });
    }

    return entries.filter(e => !e.isFolder);
  }

  /**
   * Diagnostic helper logging 7z driver activity or graceful fallback
   */
  public logOperation(stage: string, message: string, meta?: Record<string, unknown>): void {
    this.logEmitter?.({
      timestamp: new Date().toISOString(),
      level: 'info',
      source: 'vaultr:7z-adapter',
      stage,
      message,
      meta
    });
  }

  public logFallback(reason: string): void {
    this.logEmitter?.({
      timestamp: new Date().toISOString(),
      level: 'warn',
      source: 'vaultr:7z-adapter',
      stage: 'fallback',
      message: `7z CLI unavailable: ${reason}. Falling back to browser/pure-JS zip memory driver.`,
      meta: { fallbackDriver: 'zip-memory' }
    });
  }
}
