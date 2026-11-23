# Serverless Headless Rclone Architecture: Intermediary Cache & Decoupled OAuth

![Serverless Headless Rclone Pipeline](/home/antigravity/.gemini/jetski/brain/v1/default/jetski_remote_agents_3p_devbox/6ba6786e-f143-46a2-9b7e-181cd9377f4f/serverless_headless_rclone_pipeline.png)

This blueprint documents the end-to-end flow for executing **headless, configless `rclone`** inside serverless environments (AWS Lambda, Google Cloud Run, Cloudflare Workers/Containers, Fly.io, Knative) using free-tier intermediary caches (**Google Drive 15GB** and **Dropbox 2GB**) with authentication completely decoupled from the serverless runner.

---

## 1. Flow Breakdown

### A. Phase 1: Out-of-Band Auth (`rclone authorize`)
1. **Interactive Generation (Desktop/Browser):**
   * The developer or client workstation runs:
     ```bash
     # Google Drive
     rclone authorize "drive" "<CLIENT_ID>" "<CLIENT_SECRET>"

     # Dropbox
     rclone authorize "dropbox" "<APP_KEY>" "<APP_SECRET>"
     ```
   * A local browser opens to authenticate.
   * `rclone` outputs a complete JSON credential payload with `access_token`, `refresh_token`, and `expiry`.
2. **Secret Storage:**
   * The output JSON is saved into a **Secret Manager** (AWS Secrets Manager, GCP Secret Manager, Cloudflare Secrets, or Doppler) or encrypted environment variables.

---

### B. Phase 2: In-Memory Config Injection (Zero Disk Footprint)
* The serverless worker (Lambda / Cloud Run / Container) cold starts.
* Environment variables are injected dynamically:
  ```bash
  RCLONE_CONFIG_GDRIVE_TYPE=drive
  RCLONE_CONFIG_GDRIVE_SCOPE=drive.file
  RCLONE_CONFIG_GDRIVE_TOKEN='{"access_token":"ya29...","refresh_token":"1//04...","expiry":"..."}'
  ```
* **No `rclone.conf` file is written to `/tmp` or disk.** Rclone reads credentials directly from RAM.
* **HTTPS 443 Renewal:** If the `access_token` is expired or near expiry, `rclone` automatically renews it via Google/Dropbox token endpoints over HTTPS (`443`) using the long-lived `refresh_token`.

---

### C. Phase 3: Ephemeral Worker Execution
* **Lightweight Environment:**
  * Alpine Linux base image with static Go binary (`~45MB`) + `7za` (`p7zip-full`).
  * Runs either as an ephemeral CLI child process (`spawn('rclone', [...])`) or via internal `rclone rcd` (HTTP API mode on `localhost`).
* **Trigger:**
  * Invoked by webhook, event bus, or cron schedule when new files land in the intermediary staging cache from Local, Edge, or TorBox sources.
* **5-Step Work Lifecycle:**
  1. **Fetch / Stream:** Pulls or streams target `.anymdz` or files (`rclone copyto --no-traverse` or `rclone cat`).
  2. **Process / Verify:** Computes and verifies MD5 checksums against `.anymd` sidecar metadata.
  3. **Ship to Destination:** Pushes verified payload into permanent cloud vaults (`Koofr`, `TorBox / TBox`, `DavJump`).
  4. **Clear-After-Verify (Auto-Prune):** Deletes processed objects from Google Drive / Dropbox intermediary (`rclone deletefile`) to prevent exceeding free-tier quotas.
  5. **Termination:** Worker shuts down with zero idle cost.

---

## 2. Synergy with `vaultr` Extensions

| Sub-Extension | Serverless / Intermediary Role |
| :--- | :--- |
| **`seedr`** | On-demand streaming resolution and `.m3u8` hand-off without downloading whole archives. *(Notice: only TorBox tested due to tool access)* |
| **`backup` (`backup-vault`)** | Generates verifiable sidecar manifests (`.manifests/*.anymd`) and audits MD5 integrity before archiving. |
| **`unpackr`** | Selective extraction with quota guards (`7z l -slt` inspection before extraction, 5GB budget cap, `-ir!*.ext` patterns). |
| **`staging`** | Presets for `gdrive-staging` (15GB) and `dbx-bridge` (2GB) with two-hop transfer planning and automatic prune hooks. |
