document.addEventListener('DOMContentLoaded', function () {
  const cursorBtn = document.getElementById('cursorBtn');
  const traeBtn = document.getElementById('traeBtn');

  cursorBtn.addEventListener('click', function () {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      let targetUrl = 'https://cursor.com/dashboard?tab=usage';
      const tab = tabs && tabs[0];
      if (tab && tab.url && tab.url.includes('cursor.com')) {
        try {
          const u = new URL(tab.url);
          const segments = u.pathname.split('/').filter(Boolean);
          const first = segments[0] || '';
          if (/^[a-z]{2}(?:-[A-Za-z]{2})?$/.test(first)) {
            targetUrl = `https://cursor.com/${first}/dashboard?tab=usage`;
          }
        } catch (e) {
          console.error(e);
        }
      }
      chrome.tabs.create({ url: targetUrl });
    });
  });

  traeBtn.addEventListener('click', function () {
    chrome.tabs.create({ url: 'https://www.trae.ai/account-setting#usage' });
  });
});
