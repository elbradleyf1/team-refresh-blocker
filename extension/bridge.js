// Passes the on/off setting to page.js, and reports held requests back.
const root = document.documentElement;

function apply({ enabled = true }) {
  root.dataset.f1rbEnabled = enabled ? 'on' : 'off';
}

chrome.storage.local.get('enabled', apply);
chrome.storage.onChanged.addListener(() => chrome.storage.local.get('enabled', apply));

window.addEventListener('message', e => {
  if (e.source !== window || !e.data || e.data.source !== 'f1rb') return;
  if (e.data.type === 'held') {
    chrome.runtime.sendMessage({ type: 'held' }).catch(() => {});
  }
});
