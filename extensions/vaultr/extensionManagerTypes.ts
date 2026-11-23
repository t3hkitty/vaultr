/**
 * Vaultr Extension Subsystem Contract
 * Defines the contract for extensions loaded dynamically from https://github.com/t3hkitty/vaultr-exts
 */

import type { VaultrFileMetadata, VaultrLogEntry } from './types.js';

export type VaultrExtCategory =
  | 'dedupe'
  | 'converter'
  | 'organizer'
  | 'tagger'
  | 'metadata'
  | 'backup'
  | 'storage';

export interface VaultrExtensionManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  category: VaultrExtCategory;
  author: string;
  entrypoint: string;
  sourceUrl: string;
  enabledByDefault: boolean;
  capabilities: string[];
  options?: Record<string, unknown>;
}

export interface VaultrExtensionHostApi {
  log: (entry: VaultrLogEntry) => void;
  getFiles: () => VaultrFileMetadata[];
  getFileByPath: (path: string) => VaultrFileMetadata | undefined;
  saveSidecar: (metadata: VaultrFileMetadata, notesBody?: string) => Promise<void>;
  executeRclonePreview: (commandLine: string, description: string) => void;
  quarantineDuplicate?: (path: string, targetPath: string) => Promise<void>;
  registerUI?: (tabId: string, label: string, element: HTMLElement) => void;
}

export interface IVaultrSubExtension {
  manifest: VaultrExtensionManifest;
  init: (api: VaultrExtensionHostApi) => Promise<void> | void;
  destroy?: () => Promise<void> | void;
}
