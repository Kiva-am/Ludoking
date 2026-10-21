(() => {
  window.isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  document.getElementById('stylesheet').href = window.isMobile ? '/play/style-mobile.25fc5.css' : '/play/style-desktop.81ede.css';
  if (window.isMobile) {
    const gameDiv=document.getElementById('GameDiv');
    while(gameDiv.firstChild) document.body.insertBefore(gameDiv.firstChild,gameDiv);
    gameDiv.remove();
  }
  document.getElementById('loginCloseBtn').onclick=window.onClickLoginCloseBtn;
})();
