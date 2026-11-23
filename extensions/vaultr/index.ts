import type {
  AnyMDExtensionHost,
  VaultrLogEntry,
  VaultrFileMetadata
} from './types.js';
import { SidecarIndex, parseSidecarContent, serializeYamlFrontmatter } from './sidecar.js';
import { groupDuplicatesByMd5, buildResolutionPlan, selectKeeper } from './dedupe.js';
import { RcloneCommandBuilder, RcloneRunner } from './rclone.js';
import { KoofrBrowserView } from './ui.js';

export interface VaultrExtensionState {
  enabled: boolean;
  mountedSlot: string | null;
  sidecarCount: number;
}

/**
 * Vaultr AnyMD Extension
 * Implements clean enable/disable toggle, host.log diagnostics, and UI mount slots
 * without leaving DOM artifacts or altering core Markdown rendering.
 */
export class VaultrExtension {
  private host: AnyMDExtensionHost;
  private state: VaultrExtensionState = {
    enabled: false,
    mountedSlot: null,
    sidecarCount: 0
  };

  private sidecarIndex: SidecarIndex;
  private rcloneRunner: RcloneRunner;
  private browserView: KoofrBrowserView | null = null;
  private mountedDomNode: HTMLElement | null = null;

  constructor(host: AnyMDExtensionHost) {
    this.host = host;
    this.sidecarIndex = new SidecarIndex((entry) => this.log(entry));
    this.rcloneRunner = new RcloneRunner({}, (entry) => this.log(entry));
  }

  /**
   * Structured logging to AnyMD host
   */
  public log(entry: VaultrLogEntry): void {
    if (this.host && typeof this.host.log === 'function') {
      this.host.log(entry);
    }
  }

  /**
   * Activates extension, mounts UI into designated AnyMD slot
   */
  public enable(targetSlot = 'sidebar-tool'): void {
    if (this.state.enabled) {
      this.log({
        timestamp: new Date().toISOString(),
        level: 'warn',
        source: 'vaultr',
        stage: 'init',
        message: 'Vaultr extension is already enabled.'
      });
      return;
    }

    this.state.enabled = true;
    this.state.mountedSlot = targetSlot;

    // Instantiate UI
    if (typeof document !== 'undefined') {
      this.browserView = new KoofrBrowserView({
        onEmitLog: (entry) => this.log(entry),
        onResolveDuplicates: (plan) => {
          this.log({
            timestamp: new Date().toISOString(),
            level: 'info',
            source: 'vaultr',
            stage: 'dedupe',
            message: `Resolution plan created for MD5: ${plan.md5}. Keeper: ${plan.keeper.path}`,
            meta: { md5: plan.md5, reclaimableBytes: plan.totalReclaimableBytes }
          });
        }
      });
      this.browserView.setItems(this.sidecarIndex.getAll());
      this.mountedDomNode = this.browserView.getElement();

      if (this.host.registerSlot) {
        this.host.registerSlot(targetSlot, this.mountedDomNode);
      }
    }

    this.log({
      timestamp: new Date().toISOString(),
      level: 'info',
      source: 'vaultr',
      stage: 'init',
      message: `Vaultr extension enabled and mounted into slot [${targetSlot}].`,
      meta: { slot: targetSlot }
    });
  }

  /**
   * Disables extension and completely unmounts UI without leaving artifacts
   */
  public disable(): void {
    if (!this.state.enabled) {
      return;
    }

    if (this.state.mountedSlot && this.host.unregisterSlot) {
      this.host.unregisterSlot(this.state.mountedSlot);
    }

    if (this.mountedDomNode && this.mountedDomNode.parentNode) {
      this.mountedDomNode.parentNode.removeChild(this.mountedDomNode);
    }

    this.mountedDomNode = null;
    this.browserView = null;
    const previousSlot = this.state.mountedSlot;

    this.state.enabled = false;
    this.state.mountedSlot = null;

    this.log({
      timestamp: new Date().toISOString(),
      level: 'info',
      source: 'vaultr',
      stage: 'mount',
      message: `Vaultr extension cleanly disabled. UI slot [${previousSlot}] unmounted.`,
      meta: { slot: previousSlot }
    });
  }

  /**
   * Ingests .anymd sidecar content into the index
   */
  public ingestSidecar(content: string, sidecarPath?: string): VaultrFileMetadata | null {
    const item = parseSidecarContent(content, sidecarPath);
    if (item) {
      this.sidecarIndex.register(item);
      this.state.sidecarCount = this.sidecarIndex.size;
      if (this.browserView) {
        this.browserView.setItems(this.sidecarIndex.getAll());
      }
    }
    return item;
  }

  /**
   * Batch ingest sidecars
   */
  public ingestBatch(sidecars: Array<{ content: string; path?: string }>): number {
    const items: VaultrFileMetadata[] = [];
    for (const sc of sidecars) {
      const item = parseSidecarContent(sc.content, sc.path);
      if (item) items.push(item);
    }
    this.sidecarIndex.registerBatch(items);
    this.state.sidecarCount = this.sidecarIndex.size;
    if (this.browserView) {
      this.browserView.setItems(this.sidecarIndex.getAll());
    }
    return items.length;
  }

  public getIndex(): SidecarIndex {
    return this.sidecarIndex;
  }

  public getRcloneRunner(): RcloneRunner {
    return this.rcloneRunner;
  }

  public getState(): Readonly<VaultrExtensionState> {
    return { ...this.state };
  }
}

// Module export of types and utilities
export * from './types.js';
export * from './sidecar.js';
export * from './dedupe.js';
export * from './rclone.js';
export * from './ui.js';

// Default factory entrypoint for AnyMD bundle loader
export default function createVaultrExtension(host: AnyMDExtensionHost): VaultrExtension {
  return new VaultrExtension(host);
}
