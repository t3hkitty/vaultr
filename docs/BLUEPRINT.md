# Vaultr Master Architectural Blueprint ⚡
> Architectural blueprint & technical specification for `vaultr`, `vaultr-exts`, and `anymd-pluginbundles`.

Refer to the complete, structured master specification in the repo:
- Full blueprint artifact: [Vaultr_Master_Architectural_Blueprint.md](file:///home/antigravity/.gemini/jetski/brain/v1/default/jetski_remote_agents_3p_devbox/6ba6786e-f143-46a2-9b7e-181cd9377f4f/Vaultr_Master_Architectural_Blueprint.md)
- Consolidated AGV prompt artifact: [Master_Consolidated_AGV_Blueprint_Prompt.md](file:///home/antigravity/.gemini/jetski/brain/v1/default/jetski_remote_agents_3p_devbox/6ba6786e-f143-46a2-9b7e-181cd9377f4f/Master_Consolidated_AGV_Blueprint_Prompt.md)

### Key Architectural Systems Covered

1. **Sidecar-First YAML Indexing** (`.anymd`) without live directory walks.
2. **7-Zip Archive Adapter** (`.anymdz` / `.vaultrz`) with `7z l -slt`, `7z x -so`, and `7z u` in-place single-entry updates.
3. **Surgical `rclone` Engine** (`lsf`, `copyto`, `cat`, `--files-from`, and `rclone rcd`).
4. **Headless Staging Bridge & Decoupled OAuth** (`vaultr-staging`): Zero `rclone.conf` disk writes, in-memory `RCLONE_CONFIG_*` env var injection, hard quotas (15GB Drive / 2GB Dropbox), 7z pack-first pipelines, and clear-after-verify auto-pruning.
5. **Multi-Select Virtual Folders** on sidecars without moving underlying physical files.
6. **24-Hour Expiring `NEW` and `DOWNLOAD` Badges** evaluated dynamically without background cron jobs.
7. **Persistent `Sort by Date Added`** across all views.
8. **Safe MD5 Deduplication Engine** with keeper selection and dry-run quarantine plans.
9. **`playlistr` Dynamic Shelf Playlist Builder** with extended `.m3u8` export for VLC on Windows and Android.
10. **`unpackr` Selective Extractor & Quota Guard** (`7z l -slt` inspection, extension filters, pre-flight budget checks, and scratch auto-cleanup).
11. **`torbox` Direct HTTPS API Utility** (bearer token redaction in `host.log`, item/file inspection, `.anymd` sidecar generation, and `unpackr` handoff without blind multi-GB downloads).
12. **`seedr` On-Demand Streaming** (VLC handoff, explicit notice: *only TorBox tested due to tool access*).
13. **Kittlibr Web Connection & Subpath Verification** (echoing exact remote + configured subpath e.g. `davjump:kittlib/epub`, failing loudly when `:3050` daemon is offline, and preventing silent fallback to default `library/`).
