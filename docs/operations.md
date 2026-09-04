# Ambient — operations reference

The state of the live commercial setup as of 2026-05-15. Read this when
something is broken, when cutting a release, or when picking the
project back up after a break. Repo-private and intended for the
maintainer + future me (or future Claude sessions); nothing here is a
secret per se but it's all operational context.

## Public-facing URLs

| What | URL |
|---|---|
| Marketing site | <https://ambient.oezcan.me> |
| Buy flow | <https://buy.polar.sh/polar_cl_75gvIOjYXSFARfkY2VQnh8qbmXVxWxXNXjdGp3mDH8j> |
| Update manifest | <https://ambient.oezcan.me/downloads/latest.json> |
| Latest mac | <https://ambient.oezcan.me/downloads/latest/macos> (302 → versioned) |
| Latest win | <https://ambient.oezcan.me/downloads/latest/windows> |
| Latest linux | <https://ambient.oezcan.me/downloads/latest/linux> |
| Impressum | <https://ambient.oezcan.me/impressum> |
| Privacy | <https://ambient.oezcan.me/privacy> |

## Polar identifiers

```
Org name      Ambient
Org slug      ambient-app
Org ID        ebe08965-e42c-47bc-8716-ca78b904204e
Product ID    08954da8-c347-401f-86c0-ed9e5ed4df9d
Benefit ID    479061f7-29d8-492e-b612-40b0ec80a14c  (license_keys, activations: null)
Discount      LAUNCHTEST = 100% off (for end-to-end testing without real money)
Mode          live (NOT sandbox)
```

License keys are bare UUIDs (`XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX`), not `polar_lk_…`-prefixed. The benefit is configured with `activations: null`, meaning Polar does not track per-machine slots — the only valid endpoint is `/validate`, and `/activate` returns 403 NotPermitted. **This is intentional** to match the "no per-device cap" marketing.

## Customer-portal API used by the app

Public, no auth header. The license key in the body is the credential.

```http
POST https://api.polar.sh/v1/customer-portal/license-keys/validate
Content-Type: application/json

{
  "key": "<UUID>",
  "organization_id": "ebe08965-e42c-47bc-8716-ca78b904204e"
}
```

200 → license valid, body includes `customer.email`.
401/403/404 → license rejected (revoked / missing).
5xx, network failure → treated as transient; app keeps the local copy active. Paying customers don't get locked out for Polar outages.

## Cloudflare

```
Account ID    848c6419822ef3e91b6f66d69ebe63eb
Worker        ambient-site (deployed via `cd website && bunx wrangler deploy`)
R2 bucket     ambient-releases (US-East, but free egress globally)
DNS zone      oezcan.me  (zone ID 07bcaf6bb2065f0bab0e2f99984bb9ff)
```

R2 file scheme (since 0.4):
```
Ambient-<VERSION>-macOS-aarch64.dmg
Ambient-<VERSION>-macOS-x86_64.dmg
Ambient-<VERSION>-Windows-x86_64-setup.exe
Ambient-<VERSION>-Windows-aarch64-setup.exe
Ambient-<VERSION>-Linux-x86_64.AppImage
Ambient-<VERSION>-Linux-aarch64.AppImage
latest.json
```

The Worker's `/downloads/latest/{macos,macos-intel,windows,windows-arm64,linux-appimage,linux-appimage-arm64}` aliases read `latest.json` and 302 to the current versioned URL, so the homepage Download cards never need touching across releases.

## Cutting a release

```bash
bun run release 1.X.Y            # --watch to follow the CI run
```

Everything builds in CI now — one native six-cell matrix, no local
cross-builds, no ssh build boxes. `scripts/release.sh`:

1. Reads `CHANGELOG.md` `[Unreleased]`, promotes it to `[1.X.Y] — DATE`
2. Bumps version in `package.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `src-tauri/tauri.conf.json`
3. Commits "Release vX.Y.Z", tags `vX.Y.Z`, pushes main + tag

The tag push triggers `.github/workflows/build.yml`:

4. `check` (tsc / biome / vitest / cargo test), then the matrix — `linux-x86_64` (ubuntu-22.04), `linux-aarch64` (ubuntu-22.04-arm), `windows-x86_64` (windows-latest), `windows-aarch64` (windows-11-arm), `macos-x86_64` (macos-15-intel), `macos-aarch64` (macos-latest). Each cell runs `tauri build --target <triple>` with the updater signing key and uploads `ambient-<cell>`
5. `publish` → `scripts/publish.sh`: **partial-aware** — starts from the live `latest.json`, overrides only the cells that built (a failed cell keeps its previous release), uploads to R2 with the `Ambient-VERSION-Platform-Arch.ext` naming, writes the dual-shape manifest (`downloads.*` keys incl. `macos-intel` + plugin-format `platforms.*` with minisign signatures), and creates/updates the `gh release`

**Prerequisites**: `gh` authenticated, clean working tree. Repo secrets: `TAURI_SIGNING_PRIVATE_KEY` (+ `_PASSWORD`), `CLOUDFLARE_API_TOKEN` with R2 object write on `ambient-releases`.

**Cost**: macOS runners bill 10×, Windows 2×, arm runners are 2-CPU on a private repo. A full release is ~300–400 billable minutes; the matrix never runs on plain main pushes.

**If a cell fails**: the rest still publish. Rebuild just that cell and merge it in: `gh workflow run build.yml -f targets=<cell> -f publish=true` (comma-separate for several). **If publish itself failed** (R2 hiccup, gh outage): `bun run release:publish -- 1.X.Y --run <run-id>` re-runs it locally from that run's artifacts — R2 keys are versioned and `gh release upload --clobber` is idempotent.

## The gotchas that have actually bitten

### 1. Tauri capabilities allow-list

`src-tauri/capabilities/default.json` has an `http:default` permission with a per-URL `allow` list. Plugin-http silently fails on any host not on the list — **no error to JavaScript, just a rejected promise**. Currently allowed:

```
https://api.nasa.gov/*
https://api.unsplash.com/*
https://api.pexels.com/*
https://api.openai.com/*
https://api.polar.sh/*
https://ambient.oezcan.me/*
```

When adding any new external HTTP call to the app, **also add its URL pattern here**. The activation flow was completely broken on first ship because api.polar.sh wasn't on the list; took a debug round to figure out the request never left the machine.

### 2. linuxdeploy fails inside `tauri build`

After `bun run tauri build` errors with `failed to run linuxdeploy`, the Rust binary IS built but the AppImage is missing. Recover by hand:

```bash
cd src-tauri/target/release/bundle/appimage
NO_STRIP=true ~/.cache/tauri/linuxdeploy-x86_64.AppImage \
  --appdir Ambient.AppDir --output appimage
```

Produces `Ambient-x86_64.AppImage` in the same directory. The CI matrix sidesteps this by building on Ubuntu runners with `APPIMAGE_EXTRACT_AND_RUN=1 NO_STRIP=true` — the failure only bites a bare host `tauri build` on non-Ubuntu distros, so this manual recovery is just for ad-hoc local builds.

### 3. Bun not in `/bin/sh` PATH

The system shell doesn't see bun by default — `tauri build` spawns the `beforeBuildCommand` (`bun run build`) via `sh` and fails to find bun. Always invoke as:

```bash
PATH="$HOME/.bun/bin:$PATH" bun run tauri build
```

The release script handles this.

### 4. Flatpak is deleted (post-0.4)

`flatpak/com.ambient.app.yaml`, `.flatpak-builder/`, the `build-flatpak` CI job, and the `flatpak:build` npm script are all gone. Linux ships as AppImage only — both x86_64 and aarch64. Restore from git history if Flathub re-enters scope.

## When DNS to `*.oezcan.me` doesn't resolve

The user runs an AdGuard Home upstream on their OCI box (`100.64.0.1` over tailnet). New Cloudflare records (e.g. fresh subdomain just pushed) may be negative-cached for up to 30 minutes. To force-flush:

```bash
ssh oci 'sudo docker restart adguardhome'
```

~3 seconds of DNS downtime. After the restart, retry the resolution.

## Pre-launch legal to-dos

- §21 AufenthG self-employment permission from the Karlsruhe Ausländerbehörde (mandatory for non-EU students doing self-employment in Germany)
- Finanzamt registration via ELSTER + Kleinunternehmer (§19 UStG) opt-in
- Terms of Service page (Polar will ask)
- Signed binaries for macOS / Windows so the "from the internet" warning goes away

## License model

Repo is private as of 2026-05-15. LICENSE file is now proprietary going forward.

**The MIT genie cannot be put back in the bottle for prior public commits.** Every commit pushed publicly between the first commit and `9cada15` was MIT-licensed at the moment it was visible. Anyone who already cloned, forked, or scraped the repo retains MIT rights to those specific historical snapshots. Future commits and the current LICENSE file are proprietary.
