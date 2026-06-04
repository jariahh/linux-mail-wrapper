'use strict';

const path = require('node:path');
const fs = require('node:fs');
const {
  app,
  BaseWindow,
  BrowserWindow,
  WebContentsView,
  Menu,
  Tray,
  Notification,
  nativeImage,
  dialog,
  ipcMain,
  shell,
  session,
} = require('electron');

const ICON_PATH = path.join(__dirname, '..', 'assets', 'icon.png');

// ---------------------------------------------------------------------------
// Config / constants
// ---------------------------------------------------------------------------
// Service types the add-account dialog offers. `id` is the wire value passed
// back from the dialog; `url` is where a new account of that type loads.
const SERVICES = {
  m365:    { label: 'Microsoft 365 (work/school)', url: 'https://outlook.office.com/mail/' },
  outlook: { label: 'Outlook.com / Hotmail / Live', url: 'https://outlook.live.com/mail/' },
  gmail:   { label: 'Gmail', url: 'https://mail.google.com/' },
  custom:  { label: 'Custom URL', url: '' },
};
const DEFAULT_URL = SERVICES.m365.url;

const RAIL_WIDTH = 64;    // standalone left sidebar (account switcher)
const TOPBAR_HEIGHT = 40; // top title bar / toolbar across the full width

// Avatar colours handed out to newly-added accounts, cycled by position.
const COLORS = [
  '#0078D4', '#0F7B6C', '#C4314B', '#6264A7',
  '#8A2BE2', '#D83B01', '#107C10', '#5C2D91',
];

// Pin UA + client hints to the *real* bundled Chromium version. Inflating the
// version (e.g. claiming Chrome 148 while the engine is 130) makes the UA string
// disagree with the Sec-CH-UA client hints and navigator.userAgentData — and
// that mismatch is exactly what trips Google's "this browser may not be secure"
// gate. Deriving from process.versions.chrome keeps everything consistent and
// survives Electron upgrades.
const CHROME_FULL = process.versions.chrome;            // e.g. "130.0.6723.118"
const CHROME_MAJOR = CHROME_FULL.split('.')[0];         // e.g. "130"

// A modern Edge user-agent so Outlook web serves the full desktop experience.
// The default Electron UA gets feature-gated / nagged ("unsupported browser")
// by Microsoft — pretending to be Edge avoids that.
const EDGE_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  `Chrome/${CHROME_MAJOR}.0.0.0 Safari/537.36 Edg/${CHROME_MAJOR}.0.0.0`;

// Google blocks OAuth sign-in in embedded / non-standard browsers ("this
// browser or app may not be secure"). A plain Chrome desktop UA — no "Electron"
// token, version matching the real engine — plus matching client-hint headers
// (see configureSession) gets Gmail to accept the login.
const CHROME_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  `Chrome/${CHROME_MAJOR}.0.0.0 Safari/537.36`;

// Sec-CH-UA client hints presenting as real Google Chrome (Electron otherwise
// advertises only a "Chromium" brand, which gives the embedded engine away).
const SEC_CH_UA =
  `"Chromium";v="${CHROME_MAJOR}", "Google Chrome";v="${CHROME_MAJOR}", "Not?A_Brand";v="99"`;
const SEC_CH_UA_FULL =
  `"Chromium";v="${CHROME_FULL}", "Google Chrome";v="${CHROME_FULL}", "Not?A_Brand";v="99.0.0.0"`;

// The header rewrite (configureSession) fixes what Google sees over HTTP. The
// in-page JS tells (navigator.userAgentData advertising only "Chromium", and an
// empty window.chrome) are patched in the page's main world by
// src/google-preload.js, loaded only on Google account views.
const GOOGLE_PRELOAD = path.join(__dirname, 'google-preload.js');

// Hosts that must open *inside* the app (auth / SSO popups). Anything else that
// tries to open a new window is treated as an external link and handed to the
// user's default browser.
const IN_APP_HOST_RX =
  /(^|\.)(login\.microsoftonline\.com|login\.microsoft\.com|login\.live\.com|microsoftonline\.com|aadcdn\.msftauth\.net|msauth\.net|outlook\.office\.com|outlook\.office365\.com|outlook\.live\.com|office\.com|office365\.com|microsoft365\.com|accounts\.google\.com|accounts\.youtube\.com|mail\.google\.com|google\.com|gstatic\.com)$/i;

// Decide whether a URL belongs to Google (needs the plain Chrome UA).
function isGoogleUrl(url) {
  try {
    const h = new URL(url).hostname;
    return /(^|\.)(google\.com|googleusercontent\.com|gstatic\.com)$/i.test(h);
  } catch (_) {
    return false;
  }
}

function uaForUrl(url) {
  return isGoogleUrl(url) ? CHROME_UA : EDGE_UA;
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------
function userConfigPath() {
  return path.join(app.getPath('userData'), 'accounts.json');
}

function readAccountsFile(file) {
  try {
    if (!fs.existsSync(file)) return null;
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Array.isArray(data.accounts)) return data.accounts;
  } catch (err) {
    console.error(`Failed reading ${file}:`, err.message);
  }
  return null;
}

function loadAccounts() {
  // 1) user-editable copy in userData, 2) bundled accounts.json, 3) empty.
  const fromUser = readAccountsFile(userConfigPath());
  if (fromUser) return normalize(fromUser);

  const bundled = path.join(__dirname, '..', 'accounts.json');
  const fromBundle = readAccountsFile(bundled);
  if (fromBundle && fromBundle.length) {
    // Seed a user-editable copy for next time.
    try {
      fs.writeFileSync(userConfigPath(), JSON.stringify({ accounts: fromBundle }, null, 2));
    } catch (_) { /* non-fatal */ }
    return normalize(fromBundle);
  }
  // Start empty — the user adds their first account from the rail's "+".
  return [];
}

function normalize(accounts) {
  return accounts.map((a, i) => ({
    id: a.id || `account-${i + 1}`,
    name: a.name || `Account ${i + 1}`,
    color: a.color || COLORS[i % COLORS.length],
    service: a.service || '',           // service type id (see SERVICES)
    url: a.url || DEFAULT_URL,
    email: a.email || '',               // signed-in address, auto-detected
    displayName: a.displayName || '',   // signed-in display name, auto-detected
  }));
}

// Persist the current account list to the user-editable copy in userData.
function saveAccounts() {
  try {
    const data = accounts.map((a) => {
      const o = { id: a.id, name: a.name, color: a.color, url: a.url };
      if (a.service) o.service = a.service;
      if (a.email) o.email = a.email;
      if (a.displayName) o.displayName = a.displayName;
      return o;
    });
    fs.writeFileSync(userConfigPath(), JSON.stringify({ accounts: data }, null, 2));
  } catch (err) {
    console.error('Failed saving accounts:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Settings + autostart
// Linux has no app.setLoginItemSettings support, so we manage an XDG autostart
// .desktop entry in ~/.config/autostart ourselves.
// ---------------------------------------------------------------------------
let settings = {};

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function loadSettings() {
  try {
    if (fs.existsSync(settingsPath())) return JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
  } catch (err) {
    console.error('Failed reading settings:', err.message);
  }
  return {};
}

function saveSettings() {
  try {
    fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2));
  } catch (err) {
    console.error('Failed saving settings:', err.message);
  }
}

function autostartFile() {
  return path.join(app.getPath('home'), '.config', 'autostart', 'mail-linux-wrapper.desktop');
}

function autostartExec() {
  if (process.env.APPIMAGE) return `"${process.env.APPIMAGE}"`;
  const exe = app.getPath('exe');
  // In dev, `exe` is the Electron binary, so it needs the app path as an arg.
  if (!app.isPackaged) return `"${exe}" "${app.getAppPath()}"`;
  return `"${exe}"`;
}

// Reconcile the on-disk autostart entry with settings.autostart.
function applyAutostart() {
  const file = autostartFile();
  try {
    if (settings.autostart) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file,
        '[Desktop Entry]\n' +
        'Type=Application\n' +
        'Name=Mail (Linux)\n' +
        'Comment=Multi-account email (Outlook web + Gmail)\n' +
        `Exec=${autostartExec()}\n` +
        'Terminal=false\n' +
        'X-GNOME-Autostart-enabled=true\n'
      );
    } else if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  } catch (err) {
    console.error('Failed updating autostart:', err.message);
  }
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let win = null;            // BaseWindow
let topbar = null;         // WebContentsView (top title bar: brand, toolbar, window controls)
let sidebar = null;        // WebContentsView (left rail: standalone account switcher)
let tray = null;           // system tray icon
let isQuitting = false;    // true => let the window actually close (vs hide to tray)
let updater = null;        // electron-updater autoUpdater (packaged builds only)
let updateReady = false;   // a new version has downloaded and is pending restart
const views = new Map();   // id -> { account, view, unread, timer }
let activeId = null;
let accounts = [];         // persisted source of truth (see loadAccounts)

// ---------------------------------------------------------------------------
// Per-account session configuration
// ---------------------------------------------------------------------------
// The wrapper fires new-mail notifications itself (see maybeNotifyNewMail), so
// the web 'notifications' permission is intentionally NOT granted — otherwise
// Outlook/Gmail would also raise their own, producing duplicates with worse
// click handling. We still allow the small set of conveniences webmail uses.
const ALLOWED_PERMISSIONS = new Set([
  'fullscreen',
  'clipboard-read',
  'clipboard-sanitized-write',
  'background-sync',
  'media',           // attachments via camera/mic capture (rare, but harmless)
]);

const configuredSessions = new Set();

function configureSession(ses, url) {
  if (configuredSessions.has(ses)) return;
  configuredSessions.add(ses);

  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(ALLOWED_PERMISSIONS.has(permission));
  });
  ses.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission));

  // For Google accounts, rewrite the UA + Sec-CH-UA client hints on every
  // request so the headers present as real Google Chrome. Without this the
  // client hints still advertise "Chromium" (and the engine's real version),
  // contradicting the spoofed UA string and triggering the "this browser may
  // not be secure" sign-in block.
  if (isGoogleUrl(url)) {
    ses.webRequest.onBeforeSendHeaders((details, callback) => {
      const headers = details.requestHeaders;
      for (const key of Object.keys(headers)) {
        if (/^(user-agent|sec-ch-ua)/i.test(key)) delete headers[key];
      }
      headers['User-Agent'] = CHROME_UA;
      headers['sec-ch-ua'] = SEC_CH_UA;
      headers['sec-ch-ua-full-version-list'] = SEC_CH_UA_FULL;
      headers['sec-ch-ua-mobile'] = '?0';
      headers['sec-ch-ua-platform'] = '"Linux"';
      callback({ requestHeaders: headers });
    });
  }
}

// Send a message to both pieces of app chrome (top bar + sidebar) that are
// currently alive.
function broadcast(channel, payload) {
  for (const v of [topbar, sidebar]) {
    if (v && !v.webContents.isDestroyed()) v.webContents.send(channel, payload);
  }
}

// ---------------------------------------------------------------------------
// Layout — a full-width title bar across the top, a standalone sidebar down the
// left below it, and the active account view filling the remaining area.
// ---------------------------------------------------------------------------
function layout() {
  if (!win) return;
  const { width, height } = win.getContentBounds();
  const bodyH = Math.max(0, height - TOPBAR_HEIGHT);
  if (topbar) topbar.setBounds({ x: 0, y: 0, width, height: TOPBAR_HEIGHT });
  if (sidebar) sidebar.setBounds({ x: 0, y: TOPBAR_HEIGHT, width: RAIL_WIDTH, height: bodyH });
  for (const [id, entry] of views) {
    const active = id === activeId;
    entry.view.setVisible(active);
    if (active) {
      entry.view.setBounds({
        x: RAIL_WIDTH,
        y: TOPBAR_HEIGHT,
        width: Math.max(0, width - RAIL_WIDTH),
        height: bodyH,
      });
    }
  }
}

function setActive(id) {
  if (!views.has(id)) return;
  activeId = id;
  layout();
  views.get(id).view.webContents.focus();
  broadcast('active-changed', id);
}

// Push the account list (incl. detected identity) to the chrome views.
function sendAccounts() {
  broadcast(
    'accounts',
    accounts.map((a) => ({
      id: a.id,
      name: a.name,
      color: a.color,
      displayName: a.displayName || '',
      email: a.email || '',
    }))
  );
}

// ---------------------------------------------------------------------------
// Unread badge handling — Outlook/Gmail both put "(N)" in the page title.
// ---------------------------------------------------------------------------
function parseUnread(title) {
  const m = /\((\d+)\)/.exec(title || '');
  return m ? parseInt(m[1], 10) : 0;
}

function refreshBadges() {
  let total = 0;
  const payload = {};
  for (const [id, entry] of views) {
    total += entry.unread || 0;
    payload[id] = entry.unread || 0;
  }
  try { app.setBadgeCount(total); } catch (_) { /* unsupported DE */ }
  broadcast('unread-changed', payload);
}

// ---------------------------------------------------------------------------
// New-mail notifications
// We derive "new mail" from the unread count rising (parsed from the title).
// Fire only when the user isn't already looking at that account — i.e. it's a
// background account, or the window is hidden/unfocused. This keeps the active
// account's own folder navigation (which also moves the title count) quiet.
// ---------------------------------------------------------------------------
function userIsWatching(id) {
  return id === activeId && win && win.isVisible() && win.isFocused();
}

function maybeNotifyNewMail(entry, prev, next) {
  // Skip the first title we ever see (initial load establishes the baseline),
  // anything that isn't an increase, and the account the user is watching.
  if (!entry.sawTitle || next <= prev || userIsWatching(entry.account.id)) return;
  // Debounce: providers often flicker the title a few times per delivery.
  const now = Date.now();
  if (entry.lastNotify && now - entry.lastNotify < 5000) return;
  entry.lastNotify = now;

  if (!Notification.isSupported()) return;
  const acc = entry.account;
  const name = acc.displayName || acc.name;
  const note = new Notification({
    title: name,
    body: next === 1 ? 'New message' : `${next} unread messages`,
    icon: ICON_PATH,
    silent: false,
  });
  // Clicking brings the app forward and switches to the account that got mail.
  note.on('click', () => {
    showWindow();
    setActive(acc.id);
  });
  note.show();
}

// ---------------------------------------------------------------------------
// Signed-in identity detection
// Best-effort: Outlook exposes the signed-in mailbox in the page title and a
// few DOM hooks; Gmail puts the active account email in the title and an
// aria-label. We fall back to the user-supplied label when nothing is found.
// ---------------------------------------------------------------------------
const DETECT_JS = `(() => {
  const pick = (s) => (s && /@/.test(s)) ? s.match(/[^\\s<>()"]+@[^\\s<>()"]+/)[0] : '';
  let email = '', name = '';

  // Gmail: title is "Inbox (N) - user@gmail.com - Gmail"; the account switcher
  // button carries an aria-label with the name + email.
  const gAcct = document.querySelector('a[aria-label*="Google Account"], a[href^="https://accounts.google.com/SignOutOptions"]');
  if (gAcct) {
    const al = gAcct.getAttribute('aria-label') || '';
    email = pick(al);
    const nm = al.replace(/Google Account:?/i, '').split('(')[0].trim();
    if (nm && !/@/.test(nm)) name = nm;
  }

  // Outlook: the account manager / me-control surfaces the UPN + display name.
  if (!email) {
    const o = document.querySelector('[aria-label*="@"], [title*="@"]');
    if (o) email = pick(o.getAttribute('aria-label') || o.getAttribute('title') || '');
  }

  // Last resort: scrape the document title for an address.
  if (!email) email = pick(document.title);

  return email ? { email, name } : null;
})();`;

async function detectIdentity(entry) {
  if (!entry) return;
  const wc = entry.view.webContents;
  if (wc.isDestroyed()) return;
  let info;
  try {
    info = await wc.executeJavaScript(DETECT_JS, true);
  } catch (_) {
    return; // page not ready yet
  }
  if (!info || !info.email) return;

  const acc = entry.account;
  const displayName = info.name || info.email;
  if (acc.email === info.email && acc.displayName === displayName) return; // unchanged

  acc.email = info.email;
  acc.displayName = displayName;
  // Adopt the real name/email only while the label is still the generic default.
  if (/^Account \d+$/.test(acc.name)) acc.name = displayName;

  saveAccounts();
  sendAccounts();
  refreshBadges();
}

// ---------------------------------------------------------------------------
// Build an account web view
// ---------------------------------------------------------------------------
function createAccountView(account) {
  const partition = `persist:${account.id}`;
  const ses = session.fromPartition(partition);

  const url = account.url || DEFAULT_URL;
  const isGoogle = isGoogleUrl(url);
  configureSession(ses, url);

  // Pin the right UA on the *session* too, so sub-resources and auth popups
  // (which inherit the partition) present consistently — important for Google.
  try { ses.setUserAgent(uaForUrl(url)); } catch (_) { /* older Electron */ }

  const view = new WebContentsView({
    webPreferences: {
      partition,
      // Google views run a main-world preload (contextIsolation off) so it can
      // patch navigator.userAgentData / window.chrome before Google's scripts.
      // nodeIntegration stays false, so the page still gets no Node access.
      contextIsolation: !isGoogle,
      nodeIntegration: false,
      spellcheck: true,
      // Keep hidden accounts polling so they detect new mail (and update their
      // title-based unread count) promptly even while another account is shown.
      backgroundThrottling: false,
      ...(isGoogle ? { preload: GOOGLE_PRELOAD } : {}),
    },
  });

  const wc = view.webContents;
  wc.setUserAgent(uaForUrl(url));

  // Keep auth/SSO popups inside the app; everything else -> default browser.
  wc.setWindowOpenHandler(({ url: target }) => {
    let u;
    try { u = new URL(target); } catch { return { action: 'deny' }; }
    if (IN_APP_HOST_RX.test(u.hostname)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          autoHideMenuBar: true,
          webPreferences: {
            partition,
            contextIsolation: !isGoogle,
            ...(isGoogle ? { preload: GOOGLE_PRELOAD } : {}),
          },
        },
      };
    }
    if (u.protocol === 'http:' || u.protocol === 'https:') shell.openExternal(target);
    return { action: 'deny' };
  });

  // Make sure any in-app auth popup also wears the correct UA (Google again).
  // The Google client-hint preload is applied via overrideBrowserWindowOptions
  // in the window-open handler above.
  wc.on('did-create-window', (child) => {
    try { child.webContents.setUserAgent(uaForUrl(url)); } catch (_) { /* noop */ }
  });

  wc.on('page-title-updated', (_e, title) => {
    const entry = views.get(account.id);
    if (!entry) return;
    const prev = entry.unread || 0;
    const next = parseUnread(title);
    entry.unread = next;
    maybeNotifyNewMail(entry, prev, next);
    entry.sawTitle = true;
    refreshBadges();
  });

  const entry = { account, view, unread: 0, timer: null };
  views.set(account.id, entry);
  win.contentView.addChildView(view);

  // Detect the signed-in identity once loaded, then keep watching: sign-in
  // completes asynchronously and the user can switch account in-page.
  wc.on('did-finish-load', () => detectIdentity(entry));
  entry.timer = setInterval(() => detectIdentity(entry), 6000);
  wc.on('destroyed', () => { if (entry.timer) clearInterval(entry.timer); });

  wc.loadURL(url);
}

// ---------------------------------------------------------------------------
// Tray + window visibility
// ---------------------------------------------------------------------------
function appIcon() {
  const img = nativeImage.createFromPath(ICON_PATH);
  return img.isEmpty() ? null : img;
}

function showWindow() {
  if (!win) return;
  win.show();
  win.focus();
}

function toggleWindow() {
  if (!win) return;
  if (win.isVisible()) win.hide();
  else showWindow();
}

function updateTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show Mail', click: showWindow },
    { label: 'Hide', click: () => win && win.hide() },
    { type: 'separator' },
    {
      label: 'Start on login',
      type: 'checkbox',
      checked: !!settings.autostart,
      click: (item) => {
        settings.autostart = item.checked;
        applyAutostart();
        saveSettings();
        broadcast('autostart', settings.autostart);
      },
    },
    {
      label: 'Start hidden in tray',
      type: 'checkbox',
      checked: !!settings.startHidden,
      click: (item) => {
        settings.startHidden = item.checked;
        saveSettings();
      },
    },
    { type: 'separator' },
    ...(updater
      ? [
          updateReady
            ? { label: 'Restart to update', click: () => { isQuitting = true; updater.quitAndInstall(); } }
            : { label: 'Check for updates', click: () => updater.checkForUpdates().catch(() => {}) },
          { type: 'separator' },
        ]
      : []),
    { label: 'Quit', click: () => { isQuitting = true; app.quit(); } },
  ]));
}

// Auto-update (Linux: electron-updater, AppImage only). No-op in dev.
function initUpdater() {
  if (!app.isPackaged) return;
  try {
    ({ autoUpdater: updater } = require('electron-updater'));
  } catch (err) {
    console.error('electron-updater unavailable:', err.message);
    updater = null;
    return;
  }
  updater.autoDownload = true;
  updater.on('update-downloaded', () => {
    updateReady = true;
    updateTrayMenu();
  });
  updater.on('error', (err) => console.error('updater error:', err && err.message));
  updater.checkForUpdates().catch(() => {});
  // Re-check every 6 hours while running.
  setInterval(() => updater.checkForUpdates().catch(() => {}), 6 * 60 * 60 * 1000);
  updateTrayMenu();
}

function buildTray() {
  if (tray) return;
  const icon = appIcon();
  tray = new Tray(icon ? icon.resize({ width: 22, height: 22 }) : nativeImage.createEmpty());
  tray.setToolTip('Mail (Linux)');
  tray.on('click', toggleWindow); // honoured by some Linux DEs; menu is the reliable path
  updateTrayMenu();
}

// ---------------------------------------------------------------------------
// App bootstrap
// ---------------------------------------------------------------------------
function createWindow() {
  const icon = appIcon();
  win = new BaseWindow({
    width: 1400,
    height: 900,
    minWidth: 820,
    minHeight: 600,
    title: 'Mail (Linux)',
    backgroundColor: '#1f1f1f',
    frame: false, // our title bar hosts the window controls
    show: !settings.startHidden, // start in the tray when requested
    ...(icon ? { icon } : {}),
  });

  // Closing hides to the tray; real quit goes through the tray's Quit item.
  win.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });

  const chromePrefs = {
    preload: path.join(__dirname, 'preload.js'),
    contextIsolation: true,
    nodeIntegration: false,
  };

  // Top title bar / toolbar across the full width.
  topbar = new WebContentsView({ webPreferences: chromePrefs });
  win.contentView.addChildView(topbar);
  topbar.webContents.loadFile(path.join(__dirname, 'topbar', 'index.html'));

  // Standalone account-switcher sidebar down the left edge below the title bar.
  sidebar = new WebContentsView({ webPreferences: chromePrefs });
  win.contentView.addChildView(sidebar);
  sidebar.webContents.loadFile(path.join(__dirname, 'sidebar', 'index.html'));

  // Each chrome view, once loaded, gets the current state. broadcast() targets
  // both, so whichever loads first re-sends harmlessly to the other.
  const primeChrome = () => {
    sendAccounts();
    refreshBadges();
    broadcast('maximized', win.isMaximized());
    broadcast('autostart', !!settings.autostart);
    if (activeId) broadcast('active-changed', activeId);
  };
  topbar.webContents.on('did-finish-load', primeChrome);
  sidebar.webContents.on('did-finish-load', primeChrome);

  accounts = loadAccounts();
  for (const account of accounts) createAccountView(account);
  if (accounts.length) setActive(accounts[0].id);

  const sendMax = () => broadcast('maximized', win.isMaximized());
  win.on('maximize', sendMax);
  win.on('unmaximize', sendMax);

  buildTray();

  layout();
  win.on('resize', layout);
}

// IPC from the chrome views (top bar + sidebar)
ipcMain.on('select-account', (_e, id) => setActive(id));
ipcMain.on('open-account-context', (_e, id) => confirmRemoveAccount(id));
ipcMain.on('add-account', () => openAddAccountDialog());
ipcMain.on('reload-active', () => {
  const entry = views.get(activeId);
  if (entry) entry.view.webContents.reload();
});
ipcMain.on('window:minimize', () => win && win.minimize());
ipcMain.on('window:toggle-maximize', () => {
  if (!win) return;
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
});
ipcMain.on('window:close', () => win && win.close());
ipcMain.on('set-autostart', (_e, on) => {
  settings.autostart = !!on;
  applyAutostart();
  saveSettings();
  updateTrayMenu();
  broadcast('autostart', settings.autostart);
});

// ---------------------------------------------------------------------------
// Add-account dialog (pick a service type -> URL)
// ---------------------------------------------------------------------------
let addDialog = null;

function openAddAccountDialog() {
  if (addDialog && !addDialog.isDestroyed()) {
    addDialog.focus();
    return;
  }
  addDialog = new BrowserWindow({
    parent: win,
    modal: true,
    width: 460,
    height: 430,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: 'Add account',
    autoHideMenuBar: true,
    backgroundColor: '#1f1f23',
    webPreferences: {
      preload: path.join(__dirname, 'dialog', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  addDialog.on('closed', () => { addDialog = null; });
  addDialog.loadFile(path.join(__dirname, 'dialog', 'index.html'));
  addDialog.webContents.on('did-finish-load', () => {
    addDialog.webContents.send('services',
      Object.entries(SERVICES).map(([id, s]) => ({ id, label: s.label })));
  });
}

ipcMain.on('add-account:cancel', () => {
  if (addDialog && !addDialog.isDestroyed()) addDialog.close();
});

ipcMain.on('add-account:confirm', (_e, payload) => {
  if (addDialog && !addDialog.isDestroyed()) addDialog.close();
  const svc = SERVICES[payload && payload.service] || SERVICES.m365;
  let url = (payload && payload.service === 'custom') ? String(payload.url || '').trim() : svc.url;
  if (payload && payload.service !== 'custom' && payload.url) url = String(payload.url).trim() || svc.url;
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

  const account = {
    id: `account-${Date.now()}`,
    name: (payload && payload.label && String(payload.label).trim()) || `Account ${accounts.length + 1}`,
    color: COLORS[accounts.length % COLORS.length],
    service: (payload && payload.service) || 'm365',
    url,
    email: '',
    displayName: '',
  };
  accounts.push(account);
  createAccountView(account);
  saveAccounts();
  sendAccounts();
  setActive(account.id);
});

function removeAccount(id) {
  const entry = views.get(id);
  if (!entry) return;
  if (entry.timer) clearInterval(entry.timer);
  win.contentView.removeChildView(entry.view);
  try { entry.view.webContents.close(); } catch (_) { /* already gone */ }
  views.delete(id);
  accounts = accounts.filter((a) => a.id !== id);
  if (activeId === id) {
    activeId = null;
    if (accounts.length) setActive(accounts[0].id);
    else layout();
  }
  saveAccounts();
  sendAccounts();
  refreshBadges();
}

function confirmRemoveAccount(id) {
  const a = accounts.find((x) => x.id === id);
  if (!a) return;
  const choice = dialog.showMessageBoxSync(win, {
    type: 'question',
    buttons: ['Cancel', 'Remove'],
    defaultId: 0,
    cancelId: 0,
    message: `Remove "${a.displayName || a.name}" from the switcher?`,
    detail: 'The saved login session stays on disk.',
  });
  if (choice === 1) removeAccount(id);
}

// Single-instance lock: relaunching focuses the existing window.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (!win.isVisible()) win.show();
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.on('before-quit', () => { isQuitting = true; });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null); // no Electron file menu / accelerators
    settings = loadSettings();
    if (typeof settings.autostart !== 'boolean') settings.autostart = true; // on by default
    if (typeof settings.startHidden !== 'boolean') settings.startHidden = false;
    applyAutostart();
    saveSettings();
    createWindow();
    initUpdater();
    app.on('activate', () => {
      if (BaseWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
