'use strict';

const serviceSel = document.getElementById('service');
const customWrap = document.getElementById('customWrap');
const urlInput = document.getElementById('url');
const labelInput = document.getElementById('acctLabel');
const okBtn = document.getElementById('ok');
const cancelBtn = document.getElementById('cancel');

function reflectCustom() {
  const isCustom = serviceSel.value === 'custom';
  customWrap.classList.toggle('show', isCustom);
  okBtn.disabled = isCustom && !urlInput.value.trim();
}

window.dlg.onServices((list) => {
  serviceSel.innerHTML = '';
  for (const s of list || []) {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.label;
    serviceSel.appendChild(opt);
  }
  reflectCustom();
});

serviceSel.addEventListener('change', reflectCustom);
urlInput.addEventListener('input', reflectCustom);

function submit() {
  if (okBtn.disabled) return;
  window.dlg.confirm({
    service: serviceSel.value,
    url: urlInput.value.trim(),
    label: labelInput.value.trim(),
  });
}

okBtn.addEventListener('click', submit);
cancelBtn.addEventListener('click', () => window.dlg.cancel());

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submit();
  else if (e.key === 'Escape') window.dlg.cancel();
});
