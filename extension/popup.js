const enabledEl = document.getElementById('enabled');

chrome.storage.local.get('enabled', ({ enabled = true }) => {
  enabledEl.checked = enabled;
});

enabledEl.onchange = () => chrome.storage.local.set({ enabled: enabledEl.checked });
