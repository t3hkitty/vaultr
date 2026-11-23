# Vaultr Master Architectural Blueprint ⚡
> Architectural blueprint & technical specification for `vaultr`, `vaultr-exts`, and `anymd-pluginbundles`.

Refer to the complete, structured master specification in the repo:
- Full blueprint artifact: [Vaultr_Master_Architectural_Blueprint.md](file:///home/antigravity/.gemini/jetski/brain/v1/default/jetski_remote_agents_3p_devbox/6ba6786e-f143-46a2-9b7e-181cd9377f4f/Vaultr_Master_Architectural_Blueprint.md)

### Key Architectural Systems Covered

1. **Sidecar-First YAML Indexing** (`.anymd`) without live directory walks.
2. **7-Zip Archive Adapter** (`.anymdz` / `.vaultrz`) with `7z l -slt`, `7z x -so`, and `7z u` in-place single-entry updates.
3. **Surgical `rclone` Engine** (`lsf`, `copyto`, `cat`, `--files-from`, and `rclone rcd`).
4. **Multi-Select Virtual Folders** on sidecars without moving underlying physical files.
5. **24-Hour Expiring `NEW` and `DOWNLOAD` Badges** evaluated dynamically without background cron jobs.
6. **Persistent `Sort by Date Added`** across all views.
7. **Safe MD5 Deduplication Engine** with keeper selection and dry-run quarantine plans.
8. **`playlistr` Dynamic Shelf Playlist Builder** with extended `.m3u8` export for VLC on Windows and Android.
9. **Free-Tier Intermediary Staging Bridge** (`vaultr-staging-bridge`) with Pack-First, Quota Guard, and Clear-After-Verify rules.
