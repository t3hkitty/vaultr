import type {
  VaultrExtensionManifest,
  VaultrExtensionHostApi,
  IVaultrSubExtension
} from './extensionManagerTypes.js';
import type { VaultrLogEntry } from './types.js';

export interface RemoteExtensionRegistry {
  version: string;
  repo: string;
  updatedAt: string;
  extensions: VaultrExtensionManifest[];
}

export class VaultrExtensionLoader {
  private static DEFAULT_REGISTRY_URL =
    'https://raw.githubusercontent.com/t3hkitty/vaultr-exts/main/registry/extensions.json';

  private activeExtensions = new Map<string, IVaultrSubExtension>();
  private registryCache: VaultrExtensionManifest[] = [];
  private hostApi: VaultrExtensionHostApi;

  constructor(hostApi: VaultrExtensionHostApi) {
    this.hostApi = hostApi;
  }

  /**
   * Fetches the dynamic extension catalog from vaultr-exts GitHub repo
   */
  public async fetchRegistry(registryUrl = VaultrExtensionLoader.DEFAULT_REGISTRY_URL): Promise<VaultrExtensionManifest[]> {
    this.hostApi.log({
      timestamp: new Date().toISOString(),
      level: 'info',
      source: 'vaultr',
      stage: 'init',
      message: `Fetching Vaultr extension registry from ${registryUrl}`
    });

    try {
      if (typeof fetch === 'function') {
        const res = await fetch(registryUrl);
        if (!res.ok) {
          throw new Error(`Failed to load registry: ${res.statusText}`);
        }
        const data: RemoteExtensionRegistry = await res.json();
        this.registryCache = data.extensions || [];
        return this.registryCache;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.hostApi.log({
        timestamp: new Date().toISOString(),
        level: 'warn',
        source: 'vaultr',
        stage: 'init',
        message: `Offline/registry fetch error: ${msg}. Falling back to embedded local registry.`,
        meta: { error: msg }
      });
    }

    return this.registryCache;
  }

  public setEmbeddedRegistry(manifests: VaultrExtensionManifest[]): void {
    this.registryCache = manifests;
  }

  public getAvailableExtensions(): VaultrExtensionManifest[] {
    return this.registryCache;
  }

  public getActiveExtensions(): IVaultrSubExtension[] {
    return Array.from(this.activeExtensions.values());
  }

  public isExtensionActive(id: string): boolean {
    return this.activeExtensions.has(id);
  }

  /**
   * Registers and activates an extension instance
   */
  public async activateExtension(extension: IVaultrSubExtension): Promise<void> {
    const id = extension.manifest.id;
    if (this.activeExtensions.has(id)) {
      return;
    }

    this.hostApi.log({
      timestamp: new Date().toISOString(),
      level: 'info',
      source: 'vaultr',
      stage: 'init',
      message: `Activating Vaultr sub-extension [${extension.manifest.name}] (${id})`,
      meta: { id, category: extension.manifest.category }
    });

    await extension.init(this.hostApi);
    this.activeExtensions.set(id, extension);
  }

  /**
   * Deactivates and cleanly cleans up an extension
   */
  public async deactivateExtension(id: string): Promise<void> {
    const ext = this.activeExtensions.get(id);
    if (!ext) return;

    if (ext.destroy) {
      await ext.destroy();
    }
    this.activeExtensions.delete(id);

    this.hostApi.log({
      timestamp: new Date().toISOString(),
      level: 'info',
      source: 'vaultr',
      stage: 'mount',
      message: `Deactivated sub-extension [${ext.manifest.name}] (${id})`,
      meta: { id }
    });
  }
}
