(function () {
  'use strict';

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').catch(function (err) {
        console.warn('Service worker registration failed:', err);
      });
    });
  }

  var deferredPrompt = null;
  var installBtn = document.getElementById('pwaInstallBtn');

  function updateInstallButton() {
    if (!installBtn) return;
    var standalone = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches;
    installBtn.style.display = deferredPrompt && !standalone ? 'inline-flex' : 'none';
  }

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    updateInstallButton();
  });

  if (installBtn) {
    installBtn.addEventListener('click', function () {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(function (choice) {
        if (choice && choice.outcome === 'accepted') {
          deferredPrompt = null;
          updateInstallButton();
        }
      });
    });
  }

  window.addEventListener('appinstalled', function () {
    deferredPrompt = null;
    updateInstallButton();
  });

  updateInstallButton();
})();
