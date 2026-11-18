(() => {
  'use strict';
  const profile = document.documentElement.dataset.profile;
  const build = document.querySelector('meta[name="app-version"]').content;
  const workerURL = new URL('./sw.js', location.href);
  function publish(state, activeBuild = null) {
    window.LabOffline = {state, build: activeBuild, documentBuild: build, profile};
    window.dispatchEvent(new CustomEvent('lab:offline', {detail: window.LabOffline}));
  }
  function identify() {
    const worker = navigator.serviceWorker.controller;
    if (!worker || worker.scriptURL !== workerURL.href) return;
    const channel = new MessageChannel();
    const timeout = setTimeout(() => { channel.port1.close(); publish('unavailable'); }, 6000);
    channel.port1.onmessage = ({data}) => {
      clearTimeout(timeout);
      channel.port1.close();
      if (worker !== navigator.serviceWorker.controller) return;
      publish(data?.type === 'LAB_VERSION' && data?.build === build && data?.profile === profile
        ? 'ready' : 'unavailable', data?.build || null);
    };
    worker.postMessage({type: 'LAB_VERSION'}, [channel.port2]);
  }
  async function start() {
    publish('preparing');
    if (!('serviceWorker' in navigator)) { publish('unavailable'); return; }
    navigator.serviceWorker.addEventListener('controllerchange', identify);
    try {
      const registration = await navigator.serviceWorker.register(workerURL, {scope: './', updateViaCache: 'none'});
      const watchInstall = () => {
        const installing = registration.installing;
        installing?.addEventListener('statechange', () => {
          if (installing.state === 'redundant' && !navigator.serviceWorker.controller) publish('unavailable');
        });
      };
      registration.addEventListener('updatefound', watchInstall);
      watchInstall();
      await navigator.serviceWorker.ready;
      identify();
    } catch (_) { publish('unavailable'); }
  }
  start();
})();
