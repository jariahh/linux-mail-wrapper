# Mail (Linux) — multi-account email wrapper

A lightweight **Electron** wrapper around webmail that gives Linux a single app
for **multiple email accounts — Microsoft Outlook web (Microsoft 365 and
Outlook.com) and Gmail — with a one-click account rail** down the left edge.

> Unofficial project — not affiliated with, endorsed by, or sponsored by
> Microsoft or Google. "Outlook", "Microsoft 365", and "Gmail" are trademarks of
> their respective owners; they're used here only to describe what this wrapper
> connects to.

## Why a wrapper at all

Many IT departments enforce **conditional-access** policies that block or
heavily restrict *native* mail clients (Thunderbird, Evolution, the old Outlook
desktop, IMAP apps) while still permitting the **web** app in a browser. Wrapping
**Outlook on the web (OWA)** in Chromium means you're using the exact surface IT
already allows — no admin approval, no app registration, no "unsupported client"
block. You just sign in the same way you would at `outlook.office.com`, but you
get a desktop window, a tray icon, and native new-mail notifications.

Gmail works the same way: it's the real Gmail web app in an isolated session.

## Why Electron (Chromium) and not Tauri

Webmail providers feature-gate non-Chromium engines, and — critically — Google
**blocks OAuth sign-in** in embedded / non-standard browsers ("this browser or
app may not be secure"). Electron bundles **Chromium**, the engine these apps
expect. Tauri on Linux uses **WebKitGTK**, which would hit that gating and the
Google sign-in block. Bigger binary, correct behaviour.

### The Gmail user-agent note

Even on Chromium, Google rejects logins from a user-agent that advertises
"Electron". For any account on a Google domain, this app sets a **current, plain
Chrome desktop user-agent** (no Electron token) on that account's session and
web view, so Google accepts the login. Outlook/OWA gets a modern **Edge**
user-agent so Microsoft serves the full desktop web experience. This is handled
automatically per account based on its URL.

## Features

- **Top title bar** — a normal horizontal title bar across the top: the app
  brand, the active account's name/email, toolbar actions (reload the current
  account, toggle *Start on login*), and standard min / maximize / close window
  controls on the right. Frameless underneath, so there's no Electron menu bar —
  the title bar is custom but behaves like a native one.
- **Standalone left sidebar** — a narrow strip of circular avatars, one per
  account; click to switch. Add accounts with **＋** at the bottom; right-click an
  avatar to remove it. The active account is marked with a bright pill indicator.
  It's purely the account switcher now — the window controls and toolbar live in
  the title bar where you'd expect them.
- **Unlimited, dynamic accounts** — start with zero and an *"Add your first
  account"* empty state. The **＋** opens a dialog to pick a service type:
  - **Microsoft 365 (work/school)** → `https://outlook.office.com/mail/`
  - **Outlook.com / Hotmail / Live** → `https://outlook.live.com/mail/`
  - **Gmail** → `https://mail.google.com/`
  - **Custom URL** → any webmail you enter
- **Fully isolated sessions** — each account has its own cookies/storage
  (`persist:<id>` partition); two Microsoft 365 logins never collide.
- **Auto-detected identity** — after you sign in, the rail avatar relabels itself
  with your real name/email where detectable (best-effort; falls back to your
  label).
- **System tray** — closing the window hides it to the tray (it keeps running for
  notifications); quit from the tray menu. The tray also toggles **Start on login**
  and **Start hidden in tray**.
- **New-mail notifications** — the app watches every account's unread count
  (even the hidden ones — background throttling is off so they keep polling) and
  fires a native desktop notification when it rises. **Clicking the notification
  brings the window forward and switches to that account.** The wrapper raises
  these itself rather than letting each web app fire its own, so you get exactly
  one notification per delivery with consistent click behaviour. It stays quiet
  for the account you're actively looking at (the window is focused and that
  account is on top).
- **Auth-aware link handling** — Microsoft/Google SSO popups stay in-app; real
  external links open in your default browser.
- **Unread badges** per account + an app badge count (parsed from the page title).

## Add an account

Hit **＋** in the rail, choose the service (or paste a custom webmail URL),
optionally give it a label, and sign in. The app generates a stable `id`, picks a
colour, creates an isolated session, and persists everything so it survives
restarts. Add as many accounts as you like — including several of the same kind.

To pre-seed accounts (or set custom names/colours/URLs), edit
[`accounts.json`](./accounts.json):

```json
{
  "accounts": [
    { "id": "work",     "name": "Work",     "color": "#0078D4", "service": "m365",  "url": "https://outlook.office.com/mail/" },
    { "id": "personal", "name": "Personal", "color": "#C4314B", "service": "gmail", "url": "https://mail.google.com/" }
  ]
}
```

- `id` — stable key for the isolated session. **Don't change it** once you've
  logged in, or that account's session is lost.
- `name` — tooltip + avatar initials. If left as the generic `Account N`, it's
  replaced automatically with your detected name after sign-in.
- `color` — avatar background.
- `url` — what loads; `service` is informational.

On first run a user-editable copy is written to the app's `userData` dir
(`~/.config/Mail (Linux)/accounts.json` on Linux); that copy wins if present.

## Run (development)

```bash
npm install
npm run dev     # isolated .devdata profile + debug port 9347 (recommended)
# or
npm start       # uses your real ~/.config/Mail (Linux) profile
```

Sign into each account once — sessions persist between launches.

`npm run dev` launches Electron against a throwaway `.devdata/` profile (so it
never touches the installed app's logins) and opens Chromium's
**remote-debugging port on an OS-assigned free port** (`--remote-debugging-port=0`).
Using `0` means each run grabs an open port, so it can never clash with another
Electron app — or a leftover instance of this one. Electron has no HTTP dev
server; this debug port is the only "port" in play, and the **packaged/released
app opens no port at all**. To inspect, read the chosen port (and DevTools URL)
from `.devdata/DevToolsActivePort` after launch.

## Install

Grab the latest build from the [Releases](https://github.com/jariahh/linux-mail-wrapper/releases) page:

- **AppImage** (recommended) — `chmod +x linux-mail-wrapper-*.AppImage && ./linux-mail-wrapper-*.AppImage`.
  This build **auto-updates**: it checks GitHub on launch (and every 6 h),
  downloads new versions in the background, and applies them on next restart.
  You can also trigger a check from the tray menu.
- **.deb** — `sudo apt install ./linux-mail-wrapper_*.deb`. Convenient for
  apt-managed systems, but it does **not** self-update (re-download to upgrade).

## Build a distributable

```bash
npm run dist        # AppImage + .deb in dist/
```

The app icon at `assets/icon.png` is generated by `npm run make-icon` (a rounded
blue tile with a white envelope); replace that file with your own to rebrand.

### Releasing (and how auto-update works)

Releases are built and published by GitHub Actions
([`.github/workflows/release.yml`](./.github/workflows/release.yml)) whenever a
`v*` tag is pushed. The job builds the AppImage + .deb and publishes them to a
GitHub Release along with `latest-linux.yml` — the feed installed AppImages poll
via [`electron-updater`](https://www.electron.build/auto-update). No secrets or
code-signing needed; it uses the repo's built-in `GITHUB_TOKEN`.

To cut a release, bump the version (this commits and creates the tag), then push it:

```bash
npm version patch       # 0.1.0 -> 0.1.1, commits + tags v0.1.1
git push --follow-tags
```

**Full details — CI steps, client update behaviour, version rules, and
troubleshooting — are in [`docs/RELEASING.md`](./docs/RELEASING.md).**

## Notes / limitations

- **Identity auto-detect is best-effort.** Outlook and Gmail change their DOM
  often; if a name isn't picked up, your manual label is used.
- Unread counts are parsed from the page title, so they track each provider's own
  tab-title badge behaviour.
- The tray icon uses the StatusNotifier/AppIndicator protocol. KDE/Cinnamon and
  most desktops show it out of the box; **GNOME** needs the *AppIndicator and
  KStatusNotifier Support* extension. Without a visible tray, use **Start on
  login** but leave **Start hidden** off so the window always appears.

## License

[MIT](./LICENSE) © Jariah Holsapple
