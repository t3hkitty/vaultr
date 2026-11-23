# Vaultr ⚡
> Sidecar-first file and remote vault manager extension for AnyMD (`t3hkitty/anymd` and `t3hkitty/anymd-pluginbundles`).

Vaultr indexes, browses, and deduplicates files across local drives (`local`, `Z:\`, `T:\`), Android SAF storage, and remote cloud mounts (`davjump:`, `koofr:`, `tbox:`, `meow-vault`) using `.anymd` YAML sidecars as the primary index layer and targeted `rclone` commands (`lsf`, `copyto`, `cat`, `--files-from`), eliminating folder-listing bottlenecks and live directory crawl overhead.

---

## Architecture & Integration

```
anymd-pluginbundles/
└── bundles/
    └── vaultr.bundle.json          <-- Pointer bundle manifest

vaultr/
├── bundles/
│   └── vaultr.bundle.json          <-- Canonical bundle manifest
├── extensions/vaultr/
│   ├── types.ts                    <-- AnyMD host contract, sidecar YAML, and dedupe types
│   ├── sidecar.ts                  <-- .anymd YAML frontmatter parser, serializer & memory index
│   ├── dedupe.ts                   <-- MD5 grouping, deterministic keeper selection, quarantine preview
│   ├── rclone.ts                   <-- Surgical rclone command builder (lsf, copyto, cat, files-from, rcd)
│   ├── ui.ts                       <-- Koofr-inspired browser with breadcrumbs, shelves, and dedupe view
│   └── index.ts                    <-- Extension lifecycle (enable/disable toggle, host.log emitter)
└── tests/
    ├── sidecar.test.mjs            <-- Frontmatter parsing & index tests
    ├── dedupe.test.mjs             <-- MD5 grouping & quarantine safety tests
    ├── rclone.test.mjs             <-- Targeted rclone command builder tests
    └── extension.test.mjs          <-- AnyMD host contract & toggle tests
```

### 1. Pointer Bundle Manifest
- Registered in `t3hkitty/anymd-pluginbundles` under `bundles/vaultr.bundle.json` pointing directly to `t3hkitty/vaultr`.
- Declares supported remotes (`local`, `Z:`, `T:`, `davjump:`, `koofr:`, `tbox:`, `meow-vault`), UI slot placements (`sidebar-tool`, `view-tab`), and capabilities.

### 2. Sidecar-First Index (`.anymd` & YAML Frontmatter)
Large remote mounts and directory trees are never crawled live during normal browsing. Vaultr reads `.anymd` sidecar files containing:
```yaml
---
path: books/scifi/dune.epub
remote: koofr:
remotePath: Calibre/dune.epub
md5: e99a18c428cb38d5f260853678922e03
size: 1542010
mtime: "2026-05-10T12:00:00Z"
mimeOrExt: application/epub+zip
tags:
  - scifi
  - classics
sidecarPath: books/scifi/dune.epub.anymd
---
# Notes on Dune
Optional user notes and annotations...
```

### 3. Safe MD5 Duplicate Resolver
- Groups matching `md5` hashes across local, mounted, and remote storage.
- Deterministic keeper selection based on remote priority (`local` > `Z:` > `T:` > `meow-vault` > `koofr:` > `davjump:` > `tbox:`), timestamp, or path clarity.
- **Never silently deletes files**: Generates dry-run quarantine plans (`.vaultr_quarantine/<md5_prefix>_<filename>`) with explicit preview and reclaimable byte calculations.

### 4. Targeted `rclone` Command Builder
Surgical commands constructed on demand:
- **Fast Path/Metadata Discovery**: `rclone lsf <remote> --format=pstm --hash=md5 --recursive --files-only`
- **Single-File Fetch**: `rclone copyto <srcRemote:path> <dstRemote:path> [--dry-run]`
- **Single-File Stream**: `rclone cat <remote:path> [--offset=...] [--count=...]`
- **Batch Pull**: `rclone copy <src> <dst> --files-from=<list> --no-traverse [--dry-run]`
- **Rclone RCD Client**: HTTP JSON-RPC client targeting `http://127.0.0.1:5572` with fallback diagnostics when offline.

### 5. AnyMD Host Contract & UI Mount Slots
- Integrates with `host.log({ timestamp, level, source: 'vaultr', stage, message, meta })`.
- Implements `enable(targetSlot)` and `disable()` for clean activation/unmounting without leaving leftover DOM nodes or altering core Markdown rendering.

---

## Development & Testing

```bash
# Install dependencies
npm install

# Compile TypeScript
npm run build

# Run unit and smoke tests
npm test
```
