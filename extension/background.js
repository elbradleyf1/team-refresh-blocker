// Shows how many refreshes were held back on each tab as a badge on the icon.
const counts = {};

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type !== 'held' || !sender.tab) return;
  const tabId = sender.tab.id;
  counts[tabId] = (counts[tabId] || 0) + 1;
  chrome.action.setBadgeBackgroundColor({ tabId, color: '#e10600' });
  chrome.action.setBadgeText({ tabId, text: String(counts[tabId]) });
});

chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'loading') {
    delete counts[tabId];
    chrome.action.setBadgeText({ tabId, text: '' });
  }
});

chrome.tabs.onRemoved.addListener(tabId => delete counts[tabId]);
