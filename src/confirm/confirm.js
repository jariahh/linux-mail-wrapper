'use strict';

const titleEl = document.getElementById('title');
const messageEl = document.getElementById('message');
const detailEl = document.getElementById('detail');
const okBtn = document.getElementById('ok');
const cancelBtn = document.getElementById('cancel');

window.confirmDlg.onData((data) => {
  data = data || {};
  if (data.title) titleEl.textContent = data.title;
  messageEl.textContent = data.message || '';
  if (data.detail) {
    detailEl.textContent = data.detail;
  } else {
    detailEl.style.display = 'none';
  }
  okBtn.textContent = data.confirmLabel || 'OK';
  okBtn.classList.toggle('danger', !!data.danger);
  // Focus the safe choice by default for destructive prompts; the confirm
  // button otherwise.
  (data.danger ? cancelBtn : okBtn).focus();
});

okBtn.addEventListener('click', () => window.confirmDlg.accept());
cancelBtn.addEventListener('click', () => window.confirmDlg.cancel());

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.confirmDlg.cancel();
  else if (e.key === 'Enter') {
    // Enter activates whichever button is focused (defaults handled above).
    if (document.activeElement === cancelBtn) window.confirmDlg.cancel();
    else window.confirmDlg.accept();
  }
});
