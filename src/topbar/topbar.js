'use strict';

// Top title bar: app brand, the active account's name/email, toolbar actions
// (reload current account, toggle start-on-login), and the window controls.
let accounts = [];
let activeId = null;
let autostartOn = false;

const ICONS = {
  min: '<svg viewBox="0 0 12 12"><rect x="1" y="5.5" width="10" height="1.2" fill="currentColor"/></svg>',
  max: '<svg viewBox="0 0 12 12"><rect x="1.5" y="1.5" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>',
  restore:
    '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.2">' +
    '<rect x="1.5" y="3" width="7" height="7"/><path d="M3.5 3 V1.5 H10.5 V8.5 H9"/></svg>',
  close:
    '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.3">' +
    '<path d="M1.5 1.5 L10.5 10.5 M10.5 1.5 L1.5 10.5"/></svg>',
  reload:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3 v5 h-5"/></svg>',
  power:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round"><path d="M12 3 V12"/><path d="M7.4 6.6 a7 7 0 1 0 9.2 0"/></svg>',
};

// --- active-account label ---
const acctEl = document.getElementById('acct');
function renderActive() {
  const acc = accounts.find((a) => a.id === activeId);
  if (!acc) { acctEl.textContent = ''; acctEl.title = ''; return; }
  const name = acc.displayName || acc.name;
  acctEl.textContent = acc.email ? `${name} · ${acc.email}` : name;
  acctEl.title = acctEl.textContent;
}

// --- toolbar ---
const reloadBtn = document.getElementById('reload');
reloadBtn.innerHTML = ICONS.reload;
reloadBtn.addEventListener('click', () => window.lmw.reloadActive());

const startupBtn = document.getElementById('startup');
startupBtn.innerHTML = ICONS.power;
startupBtn.addEventListener('click', () => window.lmw.setAutostart(!autostartOn));
function reflectAutostart() {
  startupBtn.classList.toggle('active', autostartOn);
  startupBtn.title = autostartOn ? 'Start on login: on' : 'Start on login: off';
}

// --- window controls ---
const minBtn = document.getElementById('min');
const maxBtn = document.getElementById('max');
const closeBtn = document.getElementById('close');
minBtn.innerHTML = ICONS.min;
maxBtn.innerHTML = ICONS.max;
closeBtn.innerHTML = ICONS.close;
minBtn.addEventListener('click', () => window.lmw.minimize());
maxBtn.addEventListener('click', () => window.lmw.toggleMaximize());
closeBtn.addEventListener('click', () => window.lmw.close());

// --- main -> renderer ---
window.lmw.onAccounts((list) => { accounts = list || []; renderActive(); });
window.lmw.onActiveChanged((id) => { activeId = id; renderActive(); });
window.lmw.onMaximized((isMax) => {
  maxBtn.innerHTML = isMax ? ICONS.restore : ICONS.max;
  maxBtn.title = isMax ? 'Restore' : 'Maximize';
});
window.lmw.onAutostart((on) => { autostartOn = !!on; reflectAutostart(); });
