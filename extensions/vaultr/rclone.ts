import type {
  RcloneCommandSpec,
  RcloneRcdRequest,
  VaultrLogEntry
} from './types.js';

export interface RcloneRunnerConfig {
  rcdEndpoint?: string;   // default: http://127.0.0.1:5572
  dryRunDefault?: boolean;// default: true
  cliPath?: string;       // default: 'rclone'
}

/**
 * Builds surgical rclone commands without full directory crawls or live heavy scans
 */
export class RcloneCommandBuilder {
  /**
   * Builds targeted `rclone lsf` command for fast path/metadata discovery.
   * Uses --format to extract path, size, md5, and modtime surgical output.
   */
  public static buildLsf(
    remote: string,
    subpath = '',
    options: {
      recursive?: boolean;
      filesOnly?: boolean;
      format?: string; // default: "pstm" (Path, Size, Time, Md5)
      filter?: string;
    } = {}
  ): RcloneCommandSpec {
    const target = subpath ? `${remote.replace(/\/$/, '')}/${subpath.replace(/^\//, '')}` : remote;
    const format = options.format || 'pstm';
    const args = ['lsf', target, `--format=${format}`, '--hash=md5'];

    if (options.recursive) {
      args.push('--recursive');
    }
    if (options.filesOnly ?? true) {
      args.push('--files-only');
    }
    if (options.filter) {
      args.push(`--filter=${options.filter}`);
    }

    return {
      kind: 'lsf',
      command: 'rclone',
      args,
      fullCommandLine: `rclone ${args.map(a => (a.includes(' ') ? `"${a}"` : a)).join(' ')}`,
      isDryRun: false,
      description: `Fast metadata discovery for ${target} via rclone lsf`
    };
  }

  /**
   * Builds targeted `rclone copyto` command for single-file fetch or upload.
   */
  public static buildCopyTo(
    sourceRemotePath: string,
    destRemotePath: string,
    isDryRun = true
  ): RcloneCommandSpec {
    const args = ['copyto', sourceRemotePath, destRemotePath];
    if (isDryRun) {
      args.push('--dry-run');
    }

    return {
      kind: 'copyto',
      command: 'rclone',
      args,
      fullCommandLine: `rclone ${args.map(a => (a.includes(' ') ? `"${a}"` : a)).join(' ')}`,
      isDryRun,
      description: `Targeted single-file copy from ${sourceRemotePath} to ${destRemotePath} (dry-run: ${isDryRun})`
    };
  }

  /**
   * Builds targeted `rclone cat` command to stream content of a single remote file
   */
  public static buildCat(
    remotePath: string,
    options: { offset?: number; count?: number } = {}
  ): RcloneCommandSpec {
    const args = ['cat', remotePath];
    if (options.offset !== undefined) {
      args.push(`--offset=${options.offset}`);
    }
    if (options.count !== undefined) {
      args.push(`--count=${options.count}`);
    }

    return {
      kind: 'cat',
      command: 'rclone',
      args,
      fullCommandLine: `rclone ${args.map(a => (a.includes(' ') ? `"${a}"` : a)).join(' ')}`,
      isDryRun: false,
      description: `Fetch file content stream for ${remotePath}`
    };
  }

  /**
   * Builds batch pull using `--files-from` list file for surgical transfers
   */
  public static buildFilesFrom(
    sourceRemote: string,
    destRemote: string,
    filesFromListPath: string,
    isDryRun = true
  ): RcloneCommandSpec {
    const args = [
      'copy',
      sourceRemote,
      destRemote,
      `--files-from=${filesFromListPath}`,
      '--no-traverse'
    ];
    if (isDryRun) {
      args.push('--dry-run');
    }

    return {
      kind: 'files-from',
      command: 'rclone',
      args,
      fullCommandLine: `rclone ${args.map(a => (a.includes(' ') ? `"${a}"` : a)).join(' ')}`,
      isDryRun,
      description: `Batch pull ${filesFromListPath} from ${sourceRemote} to ${destRemote} without directory traversal`
    };
  }

  /**
   * Formats Rclone RCD API call payload
   */
  public static buildRcdCopyFile(
    srcFs: string,
    srcRemote: string,
    dstFs: string,
    dstRemote: string,
    endpoint = 'http://127.0.0.1:5572'
  ): RcloneRcdRequest {
    return {
      endpoint,
      method: 'operations/copyfile',
      params: {
        srcFs,
        srcRemote,
        dstFs,
        dstRemote
      }
    };
  }
}

/**
 * Runner that supports dry-run preview, CLI execution, rcd fallback, and offline handling.
 */
export class RcloneRunner {
  private config: Required<RcloneRunnerConfig>;
  private logEmitter?: (entry: VaultrLogEntry) => void;

  constructor(
    config: RcloneRunnerConfig = {},
    logEmitter?: (entry: VaultrLogEntry) => void
  ) {
    this.config = {
      rcdEndpoint: config.rcdEndpoint || 'http://127.0.0.1:5572',
      dryRunDefault: config.dryRunDefault ?? true,
      cliPath: config.cliPath || 'rclone'
    };
    this.logEmitter = logEmitter;
  }

  /**
   * Previews a command without executing
   */
  public preview(spec: RcloneCommandSpec): { commandLine: string; isDryRun: boolean; description: string } {
    this.logEmitter?.({
      timestamp: new Date().toISOString(),
      level: 'debug',
      source: 'vaultr',
      stage: 'rclone',
      message: `[Preview] ${spec.description}`,
      meta: { commandLine: spec.fullCommandLine, isDryRun: spec.isDryRun }
    });

    return {
      commandLine: spec.fullCommandLine,
      isDryRun: spec.isDryRun,
      description: spec.description
    };
  }

  /**
   * Executes via rclone rcd HTTP daemon (127.0.0.1:5572) with fallback error handling
   */
  public async executeRcd(request: RcloneRcdRequest): Promise<{ success: boolean; data?: unknown; error?: string }> {
    const url = `${request.endpoint.replace(/\/$/, '')}/${request.method}`;
    this.logEmitter?.({
      timestamp: new Date().toISOString(),
      level: 'info',
      source: 'vaultr',
      stage: 'rclone',
      message: `Calling rclone rcd endpoint: ${url}`,
      meta: { params: request.params }
    });

    try {
      if (typeof fetch === 'function') {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request.params)
        });

        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`RCD error (${res.status}): ${errText}`);
        }

        const data = await res.json();
        return { success: true, data };
      } else {
        return { success: false, error: 'Fetch API is unavailable in this environment' };
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logEmitter?.({
        timestamp: new Date().toISOString(),
        level: 'warn',
        source: 'vaultr',
        stage: 'rclone',
        message: `rclone rcd daemon unavailable or offline: ${msg}`,
        meta: { url }
      });
      return { success: false, error: msg };
    }
  }

  /**
   * Parses output from `rclone lsf --format=pstm --hash=md5`
   */
  public static parseLsfPstmOutput(
    rawOutput: string,
    remote: string
  ): Array<{ path: string; size: number; mtime: string; md5: string; remote: string }> {
    const lines = rawOutput.split(/\r?\n/).filter(l => l.trim().length > 0);
    const results: Array<{ path: string; size: number; mtime: string; md5: string; remote: string }> = [];

    for (const line of lines) {
      // In rclone lsf format 'p;s;t;m' or space-delimited depending on separator
      // Standard rclone lsf with default format separator is ';'
      const parts = line.split(';');
      if (parts.length >= 4) {
        const path = parts[0].trim();
        const size = parseInt(parts[1].trim(), 10) || 0;
        const mtime = parts[2].trim();
        const md5 = parts[3].trim().toLowerCase();

        results.push({
          path,
          size,
          mtime,
          md5,
          remote
        });
      } else {
        // Fallback: tab or multiple spaces
        const altParts = line.trim().split(/\s{2,}|\t/);
        if (altParts.length >= 2) {
          results.push({
            path: altParts[0].trim(),
            size: parseInt(altParts[1] || '0', 10) || 0,
            mtime: altParts[2] || new Date().toISOString(),
            md5: altParts[3] || '',
            remote
          });
        }
      }
    }

    return results;
  }
}
