(() => {
  const script = document.createElement('script');
  script.src = '/play/cocos2d-js-min.63e9f.js';
  script.onload = () => window.boot();
  document.body.append(script);
})();
