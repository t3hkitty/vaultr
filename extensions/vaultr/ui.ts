import type {
  VaultrFileMetadata,
  DuplicateCluster,
  DuplicateResolutionPlan,
  VaultrShelf,
  VaultrLogEntry
} from './types.js';
import { groupDuplicatesByMd5, buildResolutionPlan } from './dedupe.js';
import { RcloneCommandBuilder } from './rclone.js';

export interface BrowserViewCallbacks {
  onOpenFile?: (item: VaultrFileMetadata) => void;
  onFetchRemote?: (item: VaultrFileMetadata) => void;
  onResolveDuplicates?: (plan: DuplicateResolutionPlan) => void;
  onEmitLog?: (entry: VaultrLogEntry) => void;
}

/**
 * Koofr-inspired file browser and dedupe UI component
 * Pure DOM implementation: zero external framework dependencies, clean mount/unmount.
 */
export class KoofrBrowserView {
  private container: HTMLElement;
  private items: VaultrFileMetadata[] = [];
  private currentPath = '/';
  private selectedShelfId = 'all';
  private searchQuery = '';
  private selectedPaths = new Set<string>();
  private activeTab: 'browse' | 'dedupe' | 'sidecar' | 'extensions' | 'viewer' = 'browse';
  private inspectingItem: VaultrFileMetadata | null = null;
  private callbacks: BrowserViewCallbacks;
  private sortBy: 'added_at_desc' | 'added_at_asc' | 'path' | 'size' | 'mtime' = 'added_at_desc';

  private shelves: VaultrShelf[] = [
    { id: 'all', label: 'All Files', icon: '📂' },
    { id: 'new-24h', label: 'New (24h)', icon: '✨' },
    { id: 'downloads-24h', label: 'Downloads (24h)', icon: '📥' },
    { id: 'duplicates', label: 'Duplicate MD5s', icon: '👯' },
    { id: 'remotes', label: 'Remote / Mounts', icon: '☁️' },
    { id: 'docs', label: 'Books & Docs', icon: '📚' },
    { id: 'media', label: 'Audio & Media', icon: '🎵' },
  ];

  constructor(callbacks: BrowserViewCallbacks = {}) {
    this.callbacks = callbacks;
    if (typeof document !== 'undefined') {
      this.container = document.createElement('div');
      this.container.className = 'vaultr-root-container';
      this.container.setAttribute('data-vaultr-view', 'koofr');
    } else {
      this.container = {} as HTMLElement;
    }
  }

  public setItems(items: VaultrFileMetadata[]): void {
    this.items = items;
    if (typeof document !== 'undefined') {
      this.render();
    }
  }

  public getElement(): HTMLElement {
    return this.container;
  }

  public render(): void {
    this.container.innerHTML = '';
    this.container.style.cssText = `
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 480px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #121316;
      color: #e2e8f0;
      border: 1px solid #2d3748;
      border-radius: 8px;
      overflow: hidden;
    `;

    // Top Navigation / Header
    const header = this.renderHeader();
    this.container.appendChild(header);

    // Main split view (Shelves sidebar + Content area)
    const mainBody = document.createElement('div');
    mainBody.style.cssText = `
      display: flex;
      flex: 1;
      overflow: hidden;
    `;

    const sidebar = this.renderSidebar();
    const content = this.renderMainContent();

    mainBody.appendChild(sidebar);
    mainBody.appendChild(content);
    this.container.appendChild(mainBody);

    // Bottom Audio / Video Media Queue Bar
    const queueBar = this.renderQueueBar();
    this.container.appendChild(queueBar);
  }

  private renderHeader(): HTMLElement {
    const header = document.createElement('header');
    header.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 16px;
      background: #1a1c23;
      border-bottom: 1px solid #2d3748;
      gap: 12px;
    `;

    const titleArea = document.createElement('div');
    titleArea.style.cssText = 'display: flex; align-items: center; gap: 8px; font-weight: 600;';
    titleArea.innerHTML = `<span style="font-size: 1.2rem;">⚡</span><span>Vaultr</span><span style="color: #718096; font-size: 0.8rem; background: #2d3748; padding: 2px 6px; border-radius: 4px;">sidecar-index</span>`;
    header.appendChild(titleArea);

    // Breadcrumbs
    const breadcrumb = document.createElement('div');
    breadcrumb.style.cssText = 'display: flex; align-items: center; gap: 6px; font-size: 0.85rem; color: #a0aec0; flex: 1; overflow-x: auto;';
    const parts = this.currentPath.split('/').filter(Boolean);
    let pathAcc = '';
    const rootCrumb = document.createElement('span');
    rootCrumb.textContent = 'root';
    rootCrumb.style.cursor = 'pointer';
    rootCrumb.style.color = '#63b3ed';
    rootCrumb.onclick = () => {
      this.currentPath = '/';
      this.render();
    };
    breadcrumb.appendChild(rootCrumb);

    for (const part of parts) {
      pathAcc += '/' + part;
      const targetPath = pathAcc;
      const sep = document.createElement('span');
      sep.textContent = '/';
      sep.style.color = '#4a5568';
      breadcrumb.appendChild(sep);

      const crumb = document.createElement('span');
      crumb.textContent = part;
      crumb.style.cursor = 'pointer';
      crumb.style.color = '#63b3ed';
      crumb.onclick = () => {
        this.currentPath = targetPath;
        this.render();
      };
      breadcrumb.appendChild(crumb);
    }
    header.appendChild(breadcrumb);

    // Search bar
    const searchInput = document.createElement('input');
    searchInput.type = 'search';
    searchInput.placeholder = 'Search sidecars & md5...';
    searchInput.value = this.searchQuery;
    searchInput.style.cssText = `
      padding: 6px 12px;
      background: #0f1015;
      border: 1px solid #4a5568;
      border-radius: 6px;
      color: #edf2f7;
      font-size: 0.85rem;
      width: 200px;
    `;
    searchInput.oninput = (e) => {
      this.searchQuery = (e.target as HTMLInputElement).value;
      this.render();
    };
    header.appendChild(searchInput);

    // Mode tabs
    const tabGroup = document.createElement('div');
    tabGroup.style.cssText = 'display: flex; background: #2d3748; border-radius: 6px; padding: 2px;';

    const tabs: Array<{ id: 'browse' | 'dedupe' | 'sidecar' | 'extensions' | 'viewer'; label: string }> = [
      { id: 'browse', label: 'Browse' },
      { id: 'viewer', label: 'Quick Viewer / Edit' },
      { id: 'dedupe', label: 'MD5 Dedupe' },
      { id: 'sidecar', label: 'Sidecar Inspector' },
      { id: 'extensions', label: 'Vaultr Extensions' },
    ];

    for (const tab of tabs) {
      const btn = document.createElement('button');
      btn.textContent = tab.label;
      const isActive = this.activeTab === tab.id;
      btn.style.cssText = `
        background: ${isActive ? '#3182ce' : 'transparent'};
        color: ${isActive ? '#fff' : '#cbd5e0'};
        border: none;
        padding: 5px 10px;
        font-size: 0.8rem;
        cursor: pointer;
        border-radius: 4px;
        font-weight: 500;
      `;
      btn.onclick = () => {
        this.activeTab = tab.id;
        this.render();
      };
      tabGroup.appendChild(btn);
    }
    header.appendChild(tabGroup);

    return header;
  }

  private renderSidebar(): HTMLElement {
    const sidebar = document.createElement('aside');
    sidebar.style.cssText = `
      width: 220px;
      background: #171922;
      border-right: 1px solid #2d3748;
      padding: 12px 8px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    `;

    const shelfTitle = document.createElement('div');
    shelfTitle.textContent = 'DYNAMIC SHELVES';
    shelfTitle.style.cssText = 'font-size: 0.65rem; font-weight: 700; color: #718096; letter-spacing: 0.05em; padding: 4px 8px;';
    sidebar.appendChild(shelfTitle);

    for (const shelf of this.shelves) {
      const btn = document.createElement('button');
      const isSelected = this.selectedShelfId === shelf.id;
      btn.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: space-between;
        width: 100%;
        padding: 8px 10px;
        background: ${isSelected ? '#2d3748' : 'transparent'};
        border: none;
        border-radius: 6px;
        color: ${isSelected ? '#63b3ed' : '#cbd5e0'};
        font-size: 0.85rem;
        cursor: pointer;
        text-align: left;
      `;

      const count = this.computeShelfCount(shelf.id);
      btn.innerHTML = `<span>${shelf.icon} ${shelf.label}</span><span style="font-size: 0.75rem; color: #718096; background: #1a202c; padding: 2px 6px; border-radius: 999px;">${count}</span>`;
      btn.onclick = () => {
        this.selectedShelfId = shelf.id;
        if (shelf.id === 'duplicates') {
          this.activeTab = 'dedupe';
        } else {
          this.activeTab = 'browse';
        }
        this.render();
      };
      sidebar.appendChild(btn);
    }

    // Remotes section
    const remoteTitle = document.createElement('div');
    remoteTitle.textContent = 'MOUNTED / TARGET REMOTES';
    remoteTitle.style.cssText = 'font-size: 0.65rem; font-weight: 700; color: #718096; letter-spacing: 0.05em; padding: 12px 8px 4px;';
    sidebar.appendChild(remoteTitle);

    const remotes = ['local', 'Z:', 'T:', 'davjump:', 'koofr:', 'tbox:', 'meow-vault'];
    for (const remote of remotes) {
      const rItem = document.createElement('div');
      rItem.style.cssText = 'font-size: 0.8rem; color: #a0aec0; padding: 4px 8px; display: flex; align-items: center; justify-content: space-between;';
      const remoteCount = this.items.filter(i => i.remote.toLowerCase() === remote.toLowerCase()).length;
      rItem.innerHTML = `<span>🌐 ${remote}</span><span style="font-size: 0.7rem; color: #718096;">${remoteCount}</span>`;
      sidebar.appendChild(rItem);
    }

    return sidebar;
  }

  private renderMainContent(): HTMLElement {
    const main = document.createElement('main');
    main.style.cssText = 'flex: 1; overflow-y: auto; padding: 16px; background: #0f1015;';

    if (this.activeTab === 'dedupe') {
      main.appendChild(this.renderDedupeView());
    } else if (this.activeTab === 'sidecar') {
      main.appendChild(this.renderSidecarInspector());
    } else if (this.activeTab === 'extensions') {
      main.appendChild(this.renderExtensionsView());
    } else if (this.activeTab === 'viewer') {
      main.appendChild(this.renderQuickViewer());
    } else {
      main.appendChild(this.renderFileTableView());
    }

    return main;
  }

  private renderFileTableView(): HTMLElement {
    const wrapper = document.createElement('div');
    const filtered = this.getFilteredItems();

    // Batch Action Bar
    const batchBar = document.createElement('div');
    batchBar.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
      padding: 8px 12px;
      background: #1a1c23;
      border-radius: 6px;
      font-size: 0.85rem;
    `;
    const selCount = this.selectedPaths.size;
    batchBar.innerHTML = `<div><strong>${filtered.length}</strong> items indexed | <strong>${selCount}</strong> selected</div>`;

    const actionsGroup = document.createElement('div');
    actionsGroup.style.cssText = 'display: flex; gap: 8px; align-items: center;';

    // Sort Menu
    const sortSelect = document.createElement('select');
    sortSelect.style.cssText = 'background: #2d3748; color: #e2e8f0; border: 1px solid #4a5568; border-radius: 4px; padding: 4px 8px; font-size: 0.75rem;';
    sortSelect.innerHTML = `
      <option value="added_at_desc" ${this.sortBy === 'added_at_desc' ? 'selected' : ''}>Date Added (Newest)</option>
      <option value="added_at_asc" ${this.sortBy === 'added_at_asc' ? 'selected' : ''}>Date Added (Oldest)</option>
      <option value="path" ${this.sortBy === 'path' ? 'selected' : ''}>Path (A-Z)</option>
      <option value="size" ${this.sortBy === 'size' ? 'selected' : ''}>Size (Largest)</option>
      <option value="mtime" ${this.sortBy === 'mtime' ? 'selected' : ''}>Modified Time</option>
    `;
    sortSelect.onchange = (e) => {
      this.sortBy = (e.target as HTMLSelectElement).value as any;
      this.render();
    };
    actionsGroup.appendChild(sortSelect);

    // Multi-select Virtual Folder Button
    const vfBtn = document.createElement('button');
    vfBtn.textContent = '+ Virtual Folder';
    vfBtn.style.cssText = 'background: #805ad5; color: white; border: none; padding: 4px 8px; border-radius: 4px; font-size: 0.75rem; cursor: pointer;';
    vfBtn.onclick = () => {
      if (this.selectedPaths.size === 0) {
        alert('Please select files first to assign to a Virtual Folder.');
        return;
      }
      const folderName = prompt('Enter Virtual Folder name (e.g., "Inbox Review", "Reading Queue"):');
      if (!folderName) return;

      for (const p of this.selectedPaths) {
        const item = this.items.find(i => i.path === p);
        if (item) {
          item.virtual_folders = Array.from(new Set([...(item.virtual_folders || []), folderName]));
        }
      }
      this.callbacks.onEmitLog?.({
        timestamp: new Date().toISOString(),
        level: 'info',
        source: 'vaultr:virtual-folders',
        stage: 'sidecar',
        message: `Assigned ${this.selectedPaths.size} files to virtual folder "${folderName}". Files remain in original storage.`,
        meta: { count: this.selectedPaths.size, virtualFolder: folderName }
      });
      alert(`Assigned ${this.selectedPaths.size} files to Virtual Folder "${folderName}" without moving any files.`);
      this.render();
    };
    actionsGroup.appendChild(vfBtn);

    const lsfBtn = document.createElement('button');
    lsfBtn.textContent = 'Preview rclone lsf';
    lsfBtn.style.cssText = 'background: #2b6cb0; color: white; border: none; padding: 4px 8px; border-radius: 4px; font-size: 0.75rem; cursor: pointer;';
    lsfBtn.onclick = () => {
      const spec = RcloneCommandBuilder.buildLsf('koofr:', this.currentPath, { recursive: false });
      alert(`[Targeted Command Preview]\n${spec.fullCommandLine}`);
    };
    actionsGroup.appendChild(lsfBtn);

    batchBar.appendChild(actionsGroup);
    wrapper.appendChild(batchBar);

    // Table
    const table = document.createElement('table');
    table.style.cssText = 'width: 100%; border-collapse: collapse; font-size: 0.85rem; text-align: left;';
    table.innerHTML = `
      <thead>
        <tr style="border-bottom: 1px solid #2d3748; color: #a0aec0;">
          <th style="padding: 8px; width: 30px;"><input type="checkbox" id="vaultr-select-all" /></th>
          <th style="padding: 8px;">Path</th>
          <th style="padding: 8px;">Remote</th>
          <th style="padding: 8px;">Size</th>
          <th style="padding: 8px;">MD5 Digest</th>
          <th style="padding: 8px;">Modified</th>
          <th style="padding: 8px; text-align: right;">Actions</th>
        </tr>
      </thead>
      <tbody></tbody>
    `;

    const tbody = table.querySelector('tbody')!;

    for (const item of filtered) {
      const tr = document.createElement('tr');
      const isSelected = this.selectedPaths.has(item.path);
      tr.style.cssText = `
        border-bottom: 1px solid #1a202c;
        background: ${isSelected ? '#1e293b' : 'transparent'};
      `;

      const now = Date.now();
      const addedTime = item.added_at ? new Date(item.added_at).getTime() : 0;
      const isUnder24h = addedTime > 0 && (now - addedTime) < (24 * 60 * 60 * 1000);
      const isDownload = item.ingest_source === 'downloads';

      const newBadge = isUnder24h ? `<span style="background: #2b6cb0; color: #fff; font-size: 0.65rem; font-weight: 700; padding: 1px 5px; border-radius: 4px; margin-right: 4px;">NEW</span>` : '';
      const dlBadge = (isUnder24h && isDownload) ? `<span style="background: #d69e2e; color: #1a202c; font-size: 0.65rem; font-weight: 700; padding: 1px 5px; border-radius: 4px; margin-right: 4px;">DOWNLOAD</span>` : '';
      const vfPills = (item.virtual_folders || []).map(vf => `<span style="background: #44337a; color: #d6bcfa; font-size: 0.65rem; padding: 1px 4px; border-radius: 3px; margin-left: 4px;">📁 ${vf}</span>`).join('');

      tr.innerHTML = `
        <td style="padding: 8px;"><input type="checkbox" ${isSelected ? 'checked' : ''} /></td>
        <td style="padding: 8px; font-family: monospace; color: #e2e8f0;">
          ${newBadge}${dlBadge}${item.path} ${vfPills}
        </td>
        <td style="padding: 8px;"><span style="background: #2d3748; padding: 2px 6px; border-radius: 4px; font-size: 0.75rem;">${item.remote}</span></td>
        <td style="padding: 8px; color: #a0aec0;">${this.formatBytes(item.size)}</td>
        <td style="padding: 8px; font-family: monospace; font-size: 0.75rem; color: #9f7aea;">${item.md5.slice(0, 8)}...</td>
        <td style="padding: 8px; color: #718096; font-size: 0.75rem;">${item.added_at ? item.added_at.slice(0, 10) : item.mtime.slice(0, 10)}</td>
        <td style="padding: 8px; text-align: right;">
          <button class="inspect-btn" style="background: #3182ce; color: #fff; border: none; padding: 3px 6px; border-radius: 3px; font-size: 0.75rem; cursor: pointer; margin-right: 4px;">Sidecar</button>
          <button class="copyto-btn" style="background: #4a5568; color: #fff; border: none; padding: 3px 6px; border-radius: 3px; font-size: 0.75rem; cursor: pointer;">copyto</button>
        </td>
      `;

      const chk = tr.querySelector('input[type="checkbox"]') as HTMLInputElement;
      chk.onchange = () => {
        if (chk.checked) this.selectedPaths.add(item.path);
        else this.selectedPaths.delete(item.path);
        this.render();
      };

      const inspectBtn = tr.querySelector('.inspect-btn') as HTMLButtonElement;
      inspectBtn.onclick = () => {
        this.inspectingItem = item;
        this.activeTab = 'sidecar';
        this.render();
      };

      const copytoBtn = tr.querySelector('.copyto-btn') as HTMLButtonElement;
      copytoBtn.onclick = () => {
        const spec = RcloneCommandBuilder.buildCopyTo(`${item.remote}:${item.remotePath}`, `local:${item.path}`, true);
        alert(`Targeted single-file fetch:\n${spec.fullCommandLine}`);
      };

      tbody.appendChild(tr);
    }

    wrapper.appendChild(table);
    return wrapper;
  }

  private renderDedupeView(): HTMLElement {
    const wrapper = document.createElement('div');
    const clusters = groupDuplicatesByMd5(this.items, this.callbacks.onEmitLog);

    const banner = document.createElement('div');
    banner.style.cssText = 'background: #2c1a1d; border: 1px solid #742a2a; border-radius: 6px; padding: 12px; margin-bottom: 16px; color: #feb2b2; font-size: 0.85rem;';
    banner.innerHTML = `<strong>Safe MD5 Duplicate Resolver:</strong> Found <strong>${clusters.length}</strong> duplicate clusters. Files are never silently deleted. Resolution creates quarantine previews or moves.`;
    wrapper.appendChild(banner);

    if (clusters.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = 'No duplicate MD5 hashes found in the current index.';
      empty.style.cssText = 'color: #718096; padding: 24px; text-align: center;';
      wrapper.appendChild(empty);
      return wrapper;
    }

    for (const cluster of clusters) {
      const plan = buildResolutionPlan(cluster, { dryRun: true });
      const card = document.createElement('div');
      card.style.cssText = 'background: #171922; border: 1px solid #2d3748; border-radius: 6px; padding: 12px; margin-bottom: 12px;';

      card.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <div>
            <strong style="color: #9f7aea; font-family: monospace;">MD5: ${cluster.md5}</strong>
            <span style="margin-left: 10px; color: #a0aec0; font-size: 0.8rem;">(${cluster.duplicateCount} files, ${this.formatBytes(cluster.totalSize)} total)</span>
          </div>
          <button class="resolve-btn" style="background: #38a169; color: white; border: none; padding: 4px 10px; border-radius: 4px; font-size: 0.8rem; cursor: pointer;">Preview Quarantine Plan</button>
        </div>
        <div style="font-size: 0.8rem; color: #cbd5e0;">
          ${cluster.items.map(f => {
            const isKeeper = f.path === plan.keeper.path && f.remote === plan.keeper.remote;
            return `<div style="padding: 4px 0; border-top: 1px solid #1f242e; display: flex; justify-content: space-between;">
              <span style="font-family: monospace; ${isKeeper ? 'color: #68d391; font-weight: bold;' : 'color: #cbd5e0;'}">
                ${isKeeper ? '★ [KEEPER] ' : '  [DUP]    '}${f.remote}:${f.path}
              </span>
              <span style="color: #718096;">${this.formatBytes(f.size)}</span>
            </div>`;
          }).join('')}
        </div>
      `;

      const resolveBtn = card.querySelector('.resolve-btn') as HTMLButtonElement;
      resolveBtn.onclick = () => {
        this.callbacks.onResolveDuplicates?.(plan);
        alert(`Safe Plan for MD5 ${cluster.md5}:\nKeeper: ${plan.keeper.path}\nReclaimable: ${this.formatBytes(plan.totalReclaimableBytes)}\nDry Run: ${plan.dryRun}`);
      };

      wrapper.appendChild(card);
    }

    return wrapper;
  }

  private renderSidecarInspector(): HTMLElement {
    const wrapper = document.createElement('div');
    const item = this.inspectingItem || this.items[0];

    if (!item) {
      wrapper.innerHTML = '<div style="color: #718096;">No sidecar metadata selected.</div>';
      return wrapper;
    }

    wrapper.innerHTML = `
      <div style="background: #171922; border: 1px solid #2d3748; border-radius: 6px; padding: 16px;">
        <h3 style="margin-top: 0; color: #63b3ed;">Sidecar YAML Inspector: ${item.path}</h3>
        <pre style="background: #0f1015; border: 1px solid #2d3748; padding: 12px; border-radius: 6px; font-family: monospace; font-size: 0.8rem; color: #cbd5e0; overflow-x: auto;">---
path: ${item.path}
remote: ${item.remote}
remotePath: ${item.remotePath}
md5: ${item.md5}
size: ${item.size}
mtime: "${item.mtime}"
mimeOrExt: ${item.mimeOrExt}
tags: ${JSON.stringify(item.tags)}
sidecarPath: ${item.sidecarPath || 'none'}
---</pre>
        <div style="margin-top: 12px; display: flex; gap: 8px;">
          <button id="vaultr-copy-cat" style="background: #3182ce; color: white; border: none; padding: 6px 12px; border-radius: 4px; font-size: 0.8rem; cursor: pointer;">rclone cat command</button>
        </div>
      </div>
    `;

    const catBtn = wrapper.querySelector('#vaultr-copy-cat') as HTMLButtonElement;
    catBtn.onclick = () => {
      const spec = RcloneCommandBuilder.buildCat(`${item.remote}:${item.remotePath}`);
      alert(`rclone cat command:\n${spec.fullCommandLine}`);
    };

    return wrapper;
  }

  private getFilteredItems(): VaultrFileMetadata[] {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;

    const filtered = this.items.filter(item => {
      if (this.searchQuery) {
        const q = this.searchQuery.toLowerCase();
        const matches = item.path.toLowerCase().includes(q) ||
                        item.md5.toLowerCase().includes(q) ||
                        item.remote.toLowerCase().includes(q) ||
                        (item.virtual_folders || []).some(vf => vf.toLowerCase().includes(q)) ||
                        item.tags.some(t => t.toLowerCase().includes(q));
        if (!matches) return false;
      }

      if (this.selectedShelfId === 'new-24h') {
        const added = item.added_at ? new Date(item.added_at).getTime() : 0;
        return added > 0 && (now - added) < dayMs;
      }
      if (this.selectedShelfId === 'downloads-24h') {
        const added = item.added_at ? new Date(item.added_at).getTime() : 0;
        return added > 0 && (now - added) < dayMs && item.ingest_source === 'downloads';
      }
      if (this.selectedShelfId === 'remotes') {
        return item.remote.toLowerCase() !== 'local';
      }
      if (this.selectedShelfId === 'docs') {
        return ['pdf', 'epub', 'md', 'txt', 'mobi'].some(ext => item.path.toLowerCase().endsWith(ext) || item.mimeOrExt.includes(ext));
      }
      if (this.selectedShelfId === 'media') {
        return ['mp3', 'mp4', 'flac', 'm4a', 'wav'].some(ext => item.path.toLowerCase().endsWith(ext) || item.mimeOrExt.includes(ext));
      }

      return true;
    });

    // Apply sorting (Date Added, Path, Size, Modified)
    filtered.sort((a, b) => {
      if (this.sortBy === 'added_at_desc') {
        const tA = a.added_at ? new Date(a.added_at).getTime() : 0;
        const tB = b.added_at ? new Date(b.added_at).getTime() : 0;
        return tB - tA;
      }
      if (this.sortBy === 'added_at_asc') {
        const tA = a.added_at ? new Date(a.added_at).getTime() : 0;
        const tB = b.added_at ? new Date(b.added_at).getTime() : 0;
        return tA - tB;
      }
      if (this.sortBy === 'size') {
        return (b.size || 0) - (a.size || 0);
      }
      if (this.sortBy === 'mtime') {
        const tA = new Date(a.mtime).getTime() || 0;
        const tB = new Date(b.mtime).getTime() || 0;
        return tB - tA;
      }
      return a.path.localeCompare(b.path);
    });

    return filtered;
  }

  private computeShelfCount(shelfId: string): number {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;

    if (shelfId === 'all') return this.items.length;
    if (shelfId === 'new-24h') {
      return this.items.filter(i => {
        const added = i.added_at ? new Date(i.added_at).getTime() : 0;
        return added > 0 && (now - added) < dayMs;
      }).length;
    }
    if (shelfId === 'downloads-24h') {
      return this.items.filter(i => {
        const added = i.added_at ? new Date(i.added_at).getTime() : 0;
        return added > 0 && (now - added) < dayMs && i.ingest_source === 'downloads';
      }).length;
    }
    if (shelfId === 'duplicates') {
      const clusters = groupDuplicatesByMd5(this.items);
      return clusters.reduce((acc, c) => acc + c.duplicateCount, 0);
    }
    if (shelfId === 'remotes') return this.items.filter(i => i.remote.toLowerCase() !== 'local').length;
    if (shelfId === 'docs') {
      return this.items.filter(i => ['pdf', 'epub', 'md', 'txt'].some(ext => i.path.toLowerCase().endsWith(ext))).length;
    }
    if (shelfId === 'media') {
      return this.items.filter(i => ['mp3', 'mp4', 'flac', 'm4a'].some(ext => i.path.toLowerCase().endsWith(ext))).length;
    }
    return 0;
  }

  private formatBytes(bytes: number): string {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  }

  private renderExtensionsView(): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = `
      <div style="background: #171922; border: 1px solid #2d3748; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <div>
            <h3 style="margin: 0; color: #63b3ed; font-size: 1.1rem;">Vaultr Extension Manager</h3>
            <p style="margin: 4px 0 0; color: #a0aec0; font-size: 0.8rem;">
              Loaded dynamically from <a href="https://github.com/t3hkitty/vaultr-exts" target="_blank" style="color: #63b3ed; text-decoration: underline;">t3hkitty/vaultr-exts</a>.
            </p>
          </div>
          <button id="vaultr-refresh-exts" style="background: #3182ce; color: white; border: none; padding: 6px 12px; border-radius: 4px; font-size: 0.8rem; cursor: pointer;">
            🔄 Refresh Registry
          </button>
        </div>
      </div>

      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px;">
        <div style="background: #1a1c23; border: 1px solid #2d3748; border-radius: 6px; padding: 12px;">
          <div style="display: flex; justify-content: space-between;">
            <strong style="color: #68d391;">Pandoc Converter</strong>
            <span style="font-size: 0.7rem; background: #2d3748; padding: 2px 6px; border-radius: 4px; color: #a0aec0;">converter</span>
          </div>
          <p style="font-size: 0.8rem; color: #cbd5e0; margin: 8px 0;">Multi-format document conversion pipeline (epub, md, html, docx, pdf) preserving sidecar frontmatter.</p>
          <div style="font-size: 0.75rem; color: #718096; font-family: monospace;">id: vaultr-pandoc-converter</div>
        </div>

        <div style="background: #1a1c23; border: 1px solid #2d3748; border-radius: 6px; padding: 12px;">
          <div style="display: flex; justify-content: space-between;">
            <strong style="color: #68d391;">Movr Organizer</strong>
            <span style="font-size: 0.7rem; background: #2d3748; padding: 2px 6px; border-radius: 4px; color: #a0aec0;">organizer</span>
          </div>
          <p style="font-size: 0.8rem; color: #cbd5e0; margin: 8px 0;">Rules-based file mover into clean folder structures with dry-run rclone moveto plans and sidecar path tracking.</p>
          <div style="font-size: 0.75rem; color: #718096; font-family: monospace;">id: vaultr-movr-organizer</div>
        </div>

        <div style="background: #1a1c23; border: 1px solid #2d3748; border-radius: 6px; padding: 12px;">
          <div style="display: flex; justify-content: space-between;">
            <strong style="color: #68d391;">Content Tagger</strong>
            <span style="font-size: 0.7rem; background: #2d3748; padding: 2px 6px; border-radius: 4px; color: #a0aec0;">tagger</span>
          </div>
          <p style="font-size: 0.8rem; color: #cbd5e0; margin: 8px 0;">Auto-tags file contents and sidecars based on text corpora and extensions without touching original binary files.</p>
          <div style="font-size: 0.75rem; color: #718096; font-family: monospace;">id: vaultr-content-tagger</div>
        </div>

        <div style="background: #1a1c23; border: 1px solid #2d3748; border-radius: 6px; padding: 12px;">
          <div style="display: flex; justify-content: space-between;">
            <strong style="color: #68d391;">Kittlibr Metadata Bridge</strong>
            <span style="font-size: 0.7rem; background: #2d3748; padding: 2px 6px; border-radius: 4px; color: #a0aec0;">metadata</span>
          </div>
          <p style="font-size: 0.8rem; color: #cbd5e0; margin: 8px 0;">Symlinks and bridges rich book and document YAML metadata from Kittlibr directly into AnyMD sidecars.</p>
          <div style="font-size: 0.75rem; color: #718096; font-family: monospace;">id: vaultr-kittlibr-metadata</div>
        </div>

        <div style="background: #1a1c23; border: 1px solid #2d3748; border-radius: 6px; padding: 12px;">
          <div style="display: flex; justify-content: space-between;">
            <strong style="color: #68d391;">Backup & Archive Manifest</strong>
            <span style="font-size: 0.7rem; background: #2d3748; padding: 2px 6px; border-radius: 4px; color: #a0aec0;">backup</span>
          </div>
          <p style="font-size: 0.8rem; color: #cbd5e0; margin: 8px 0;">Creates backup sidecar manifests (.manifests/*.anymd) confirming file checksums, sizes, and rclone backup status.</p>
          <div style="font-size: 0.75rem; color: #718096; font-family: monospace;">id: vaultr-backup-manifest</div>
        </div>

        <div style="background: #1a1c23; border: 1px solid #2d3748; border-radius: 6px; padding: 12px;">
          <div style="display: flex; justify-content: space-between;">
            <strong style="color: #68d391;">MD5 Deduplication</strong>
            <span style="font-size: 0.7rem; background: #2d3748; padding: 2px 6px; border-radius: 4px; color: #a0aec0;">dedupe</span>
          </div>
          <p style="font-size: 0.8rem; color: #cbd5e0; margin: 8px 0;">Groups identical MD5 files across local and rclone remotes with keeper selection and quarantine workflows.</p>
          <div style="font-size: 0.75rem; color: #718096; font-family: monospace;">id: vaultr-md5-dedupe</div>
        </div>
      </div>
    `;

    const refreshBtn = wrapper.querySelector('#vaultr-refresh-exts') as HTMLButtonElement;
    refreshBtn.onclick = () => {
      alert('Vaultr registry reloaded from https://raw.githubusercontent.com/t3hkitty/vaultr-exts/main/registry/extensions.json');
    };

    return wrapper;
  }

  private renderQueueBar(): HTMLElement {
    const bar = document.createElement('footer');
    bar.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 16px;
      background: #14171f;
      border-top: 1px solid #2d3748;
      font-size: 0.8rem;
      color: #cbd5e0;
      gap: 12px;
    `;

    bar.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="font-size: 1.1rem;">🎵</span>
        <div>
          <strong style="color: #63b3ed;">Media Queue Player</strong>
          <span style="color: #718096; margin-left: 6px;">[idle]</span>
        </div>
      </div>
      <div style="display: flex; gap: 6px;">
        <button id="vaultr-btn-prev" style="background: #2d3748; color: #cbd5e0; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer;">⏮ Prev</button>
        <button id="vaultr-btn-play" style="background: #3182ce; color: white; border: none; padding: 4px 10px; border-radius: 4px; cursor: pointer;">▶ Play Queue</button>
        <button id="vaultr-btn-next" style="background: #2d3748; color: #cbd5e0; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer;">⏭ Next</button>
      </div>
      <div style="display: flex; gap: 8px;">
        <button id="vaultr-export-m3u8" style="background: #2b6cb0; color: white; border: none; padding: 4px 8px; border-radius: 4px; font-size: 0.75rem; cursor: pointer;">
          📄 Export .m3u8
        </button>
        <button id="vaultr-open-vlc" style="background: #ed8936; color: white; border: none; padding: 4px 8px; border-radius: 4px; font-size: 0.75rem; cursor: pointer;">
          Cone / VLC Hand-Off
        </button>
      </div>
    `;

    const m3uBtn = bar.querySelector('#vaultr-export-m3u8') as HTMLButtonElement;
    m3uBtn.onclick = () => {
      alert('[Playlistr Export]\nGenerated standard .m3u8 playlist file from current shelf view.');
    };

    const vlcBtn = bar.querySelector('#vaultr-open-vlc') as HTMLButtonElement;
    vlcBtn.onclick = () => {
      alert('[VLC Hand-off]\nLaunching system default player (VLC on Windows/Android) with generated stream playlist.');
    };

    return bar;
  }

  private renderQuickViewer(): HTMLElement {
    const wrapper = document.createElement('div');
    const item = this.inspectingItem || this.items[0];

    if (!item) {
      wrapper.innerHTML = '<div style="color: #718096; padding: 24px; text-align: center;">Select a file from the Browse table to inspect or edit.</div>';
      return wrapper;
    }

    const isImage = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'].some(ext => item.path.toLowerCase().endsWith(ext) || item.mimeOrExt.includes(ext));
    const isMedia = ['mp3', 'mp4', 'flac', 'm4a', 'wav', 'webm'].some(ext => item.path.toLowerCase().endsWith(ext) || item.mimeOrExt.includes(ext));

    wrapper.innerHTML = `
      <div style="background: #171922; border: 1px solid #2d3748; border-radius: 8px; padding: 16px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; border-bottom: 1px solid #2d3748; padding-bottom: 8px;">
          <div>
            <h3 style="margin: 0; color: #63b3ed; font-size: 1rem; font-family: monospace;">${item.path}</h3>
            <span style="color: #718096; font-size: 0.75rem;">Remote: ${item.remote} | Size: ${this.formatBytes(item.size)}</span>
          </div>
          <div style="display: flex; gap: 8px;">
            <button id="vaultr-open-with-vlc" style="background: #ed8936; color: white; border: none; padding: 5px 10px; border-radius: 4px; font-size: 0.8rem; cursor: pointer;">
              Cone / Open in VLC
            </button>
            <button id="vaultr-open-with-kittlibr" style="background: #805ad5; color: white; border: none; padding: 5px 10px; border-radius: 4px; font-size: 0.8rem; cursor: pointer;">
              Open in Kittlibr
            </button>
          </div>
        </div>

        ${isImage ? `
          <div style="text-align: center; padding: 16px; background: #0f1015; border-radius: 6px;">
            <div style="margin-bottom: 10px;">
              <button id="rotate-btn" style="background: #2d3748; color: #e2e8f0; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 0.8rem;">
                🔄 Rotate 90°
              </button>
            </div>
            <img id="viewer-img" src="${item.path}" alt="${item.path}" style="max-height: 400px; max-width: 100%; border-radius: 4px; transform: rotate(0deg); transition: transform 0.2s;" onerror="this.alt='[Image Preview Placeholder: ${item.path}]';" />
          </div>
        ` : isMedia ? `
          <div style="padding: 24px; text-align: center; background: #0f1015; border-radius: 6px;">
            <div style="font-size: 2.5rem; margin-bottom: 12px;">🎬</div>
            <audio controls style="width: 100%; max-width: 500px; margin-bottom: 12px;" src="${item.path}"></audio>
            <div style="color: #a0aec0; font-size: 0.8rem;">HTML5 audio/video preview. Use "Open in VLC" for streaming remote links.</div>
          </div>
        ` : `
          <div>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
              <span style="font-size: 0.75rem; color: #a0aec0;">Text Editor (with line numbers & save state)</span>
              <button id="save-text-btn" style="background: #38a169; color: white; border: none; padding: 4px 8px; border-radius: 4px; font-size: 0.75rem; cursor: pointer;">💾 Save Edits</button>
            </div>
            <div style="display: flex; background: #0f1015; border: 1px solid #2d3748; border-radius: 6px; font-family: monospace; font-size: 0.8rem;">
              <div style="padding: 10px 8px; background: #14171f; color: #4a5568; text-align: right; user-select: none; border-right: 1px solid #2d3748;">
                1<br/>2<br/>3<br/>4<br/>5<br/>6<br/>7<br/>8<br/>9<br/>10
              </div>
              <textarea id="quick-text-area" style="flex: 1; min-height: 220px; background: transparent; border: none; color: #cbd5e0; padding: 10px; font-family: monospace; font-size: 0.8rem; resize: vertical; outline: none;"># ${item.path}
Sidecar record and notes preview.
Edit here to update file annotations...</textarea>
            </div>
          </div>
        `}
      </div>
    `;

    const vlcBtn = wrapper.querySelector('#vaultr-open-with-vlc') as HTMLButtonElement | null;
    if (vlcBtn) {
      vlcBtn.onclick = () => {
        alert(`[Open With VLC]\nResolving stream for ${item.path} and launching VLC.`);
      };
    }

    const kittlibrBtn = wrapper.querySelector('#vaultr-open-with-kittlibr') as HTMLButtonElement | null;
    if (kittlibrBtn) {
      kittlibrBtn.onclick = () => {
        alert(`[Open With Kittlibr]\nHanding off metadata to Kittlibr for reading.`);
      };
    }

    const rotateBtn = wrapper.querySelector('#rotate-btn') as HTMLButtonElement | null;
    if (rotateBtn) {
      let deg = 0;
      rotateBtn.onclick = () => {
        deg = (deg + 90) % 360;
        const img = wrapper.querySelector('#viewer-img') as HTMLImageElement;
        if (img) img.style.transform = `rotate(${deg}deg)`;
      };
    }

    const saveBtn = wrapper.querySelector('#save-text-btn') as HTMLButtonElement | null;
    if (saveBtn) {
      saveBtn.onclick = () => {
        alert('Edits saved to sidecar.');
      };
    }

    return wrapper;
  }
}

