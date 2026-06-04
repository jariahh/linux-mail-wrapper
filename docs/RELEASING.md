# Releasing & updates

How a new version goes from a commit to everyone's installed app. The whole
flow is **tag-driven**: push a `v*` tag, CI builds and publishes, installed
AppImages pick it up on their own.

## TL;DR — cut a release

```bash
# on an up-to-date master with a clean working tree
npm version patch        # 0.1.0 -> 0.1.1: bumps package.json, commits, tags v0.1.1
git push --follow-tags   # pushes the commit AND the tag
```

Pushing the tag triggers the [`Release` workflow](../.github/workflows/release.yml).
Use `npm version minor` / `major` for bigger jumps. The git tag and the
`package.json` version **must** match — `npm version` guarantees that, so prefer
it over tagging by hand.

## What the CI does

On any `v*` tag push, `.github/workflows/release.yml`:

1. `npm ci` + `npm run make-icon`
2. `electron-builder --linux AppImage deb --publish always`

electron-builder reads the `build.publish` block in `package.json` (provider
`github`, `releaseType: release`) and:

- builds `…-x86_64.AppImage` and `…_amd64.deb`
- generates **`latest-linux.yml`** — the update feed (version + file hashes)
- creates a **published** GitHub Release (not a draft) and uploads all three

No secrets or code-signing are needed: the workflow uses the repo's built-in
`GITHUB_TOKEN` (granted `contents: write`). Linux has no signing requirement.

## How clients update

Only the **AppImage** auto-updates (a Linux limitation — `.deb` needs root/apt to
install, so it can't self-update; re-download to upgrade).

In `src/main.js`, `initUpdater()` runs **only in packaged builds**:

- on launch, and then every 6 hours, it calls `autoUpdater.checkForUpdates()`
- it compares the running version against `latest-linux.yml` in the newest
  published Release
- a newer version downloads in the background; on `update-downloaded` the tray
  menu shows **Restart to update** (which calls `quitAndInstall()`)
- users can also force a check from the tray's **Check for updates**

It is a **no-op in development** (`app.isPackaged` is false), so running from
source never tries to update itself.

## Version & baseline rules

- Versions must strictly increase (semver). electron-updater only offers an
  update when the published version is greater than the installed one.
- Auto-update is only observable **from the next release onward**: a user must
  be running an AppImage that was itself published with a `latest-linux.yml`
  feed. The first published release (v0.1.0) is the baseline; installing it and
  then publishing v0.1.1 is what exercises the update path.

## Troubleshooting

- **Release came out as a draft** → clients can't see drafts. Ensure
  `releaseType: release` is in the `publish` block (it is). To publish an
  existing draft: `gh release edit vX.Y.Z --draft=false`.
- **CI fails: "Please specify author 'email'"** → `package.json` `author` must be
  an object with `name` + `email` (needed for the `.deb` maintainer field).
- **No tray icon on GNOME** → install the *AppIndicator* extension, or leave
  "Start hidden" off so the window always opens. KDE/Cinnamon/most others are fine.
- **Re-running a release** → if a tag's build failed before publishing, move the
  tag to the fixed commit: `git tag -d vX.Y.Z && git push origin :refs/tags/vX.Y.Z`
  then re-tag and push.
