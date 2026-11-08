/* Load generated validation only where the public build supplies it. */
window.HomePlannerContractsReady = new Promise(resolve => {
  function script(src, next) { const tag = document.createElement('script'); tag.src = src; tag.onload = () => next(true); tag.onerror = () => next(false); document.head.appendChild(tag); }
  script('shared/validators.js', ok => { if (!ok) return resolve(false); script('shared/contracts.js', ready => resolve(ready && !!window.HomePlannerContracts)); });
});
