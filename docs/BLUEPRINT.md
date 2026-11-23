# Vaultr Master Architectural Blueprint ⚡
> Master architectural blueprint & technical specification for `vaultr`, `vaultr-exts`, `anymd-pluginbundles`, and `Kittlibr-`.

Refer to the complete, structured master specification in the repo:
- Full blueprint artifact: [Vaultr_Master_Architectural_Blueprint.md](file:///home/antigravity/.gemini/jetski/brain/v1/default/jetski_remote_agents_3p_devbox/6ba6786e-f143-46a2-9b7e-181cd9377f4f/Vaultr_Master_Architectural_Blueprint.md)
- Consolidated AGV & NotebookLM prompt: [Master_Consolidated_AGV_Blueprint_Prompt.md](file:///home/antigravity/.gemini/jetski/brain/v1/default/jetski_remote_agents_3p_devbox/6ba6786e-f143-46a2-9b7e-181cd9377f4f/Master_Consolidated_AGV_Blueprint_Prompt.md)

### Key Architectural Systems Covered

1. **Pointer Bundle & Extension Host:** `bundles/vaultr.bundle.json` pointing to `vaultr-exts` with clean enable/disable lifecycle.
2. **Sidecar-First YAML Indexing** (`.anymd`) with speed/clutter mode selection (`Hidden Folder`, `Sidecar Archive .anymdz`, `Invisible Per-File`) without live directory walks.
3. **7-Zip Archive Adapter** (`.anymdz` / `.vaultrz`) with `7z l -slt`, `7z x -so`, `7z u` in-place single-entry updates, and browser fallback.
4. **Surgical `rclone` Engine & Headless Staging Bridge** (`vaultr-staging`): Zero `rclone.conf` disk writes, in-memory `RCLONE_CONFIG_*` env var injection, hard quotas (15GB Drive / 2GB Dropbox), 7z `.anymdz` pack-first pipelines, and clear-after-verify auto-pruning.
5. **Multi-Select Virtual Folders & Opt-In `Auto-Move`:** Sidecar folder arrays, dry-run match previews, collision guards, and dual payload+sidecar relocation.
6. **24-Hour Expiring `NEW` and `DOWNLOAD` Badges** evaluated dynamically without background cron jobs.
7. **Persistent `Sort by Date Added`** (`added_at` desc/asc) across all views.
8. **Safe MD5 Deduplication Engine** with keeper selection and dry-run quarantine plans.
9. **Native Viewers & "Open With":** Text editor with line/row numbers, image viewer with 90° rotation, media preview with VLC / Kittlibr routing.
10. **`playlistr` Dynamic Shelf Playlist Builder** with extended `.m3u8` export for VLC on Windows and Android.
11. **`unpackr` Selective Extractor & Quota Guard** (`7z l -slt` inspection, extension filters, pre-flight budget checks, and scratch auto-cleanup).
12. **`torbox` Direct HTTPS API Utility & `seedr` Debrid Streaming** (bearer token redaction, `.anymd` sidecar generation, VLC stream hand-off, and explicit notice: *only TorBox tested due to tool access*).
13. **`Kittlibr-` Reader & `Storage & Sync` Fixes:**
    * Full EPUB ZIP spine/XHTML chapter extraction instead of binary placeholder stubs.
    * Persistent active subpaths (e.g., `davjump:kittlib/epub`).
    * Honest remote connection diagnostics echoing configured subpaths and failing loudly when `:3050` daemon is offline without falling back to hardcoded `library/` chips.
