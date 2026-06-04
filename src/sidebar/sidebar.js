'use strict';

// Standalone left sidebar: the account switcher (avatars + unread badges) and
// the add-account button. Window controls and toolbar actions live in the top
// title bar (src/topbar), not here.
let accounts = [];
let activeId = null;
let unread = {};

function initials(name) {
  const parts = String(name).trim().split(/[\s@.]+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

// --- DOM ---
const accts = document.getElementById('accts');
const empty = document.getElementById('empty');

function totalUnread(id) {
  return unread[id] || 0;
}

function render() {
  accts.innerHTML = '';
  empty.classList.toggle('show', accounts.length === 0);

  for (const acc of accounts) {
    const name = acc.displayName || acc.name;
    const btn = document.createElement('button');
    btn.className = 'account' + (acc.id === activeId ? ' active' : '');
    btn.style.setProperty('--c', acc.color || '#0078D4');
    btn.title = acc.email ? `${name}\n${acc.email}` : name;

    const ini = document.createElement('span');
    ini.className = 'ini';
    ini.textContent = initials(name);
    btn.appendChild(ini);

    const n = totalUnread(acc.id);
    if (n > 0) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.style.display = 'flex';
      badge.textContent = n > 99 ? '99+' : String(n);
      btn.appendChild(badge);
    }

    btn.addEventListener('click', () => window.lmw.selectAccount(acc.id));
    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      window.lmw.openAccountContext(acc.id);
    });
    accts.appendChild(btn);
  }
}

// --- add account ---
const addBtn = document.getElementById('add');
addBtn.addEventListener('click', () => window.lmw.addAccount());

// --- main -> renderer ---
window.lmw.onAccounts((list) => { accounts = list || []; render(); });
window.lmw.onActiveChanged((id) => { activeId = id; render(); });
window.lmw.onUnreadChanged((map) => { unread = map || {}; render(); });
