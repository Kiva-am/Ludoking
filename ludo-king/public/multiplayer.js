// Timing adapter for the local server. The archived client asks for its dice
// result at the end of the roll animation, after it has already displayed the
// previous table's dice value. Request it when the player starts the animation
// so the authoritative value is available to the original completion handler.
(() => {
  const timer = setInterval(() => {
    if (!window.cc || !window.__require) return;
    const Dice = cc.js.getClassByName('Dice');
    const Actions = cc.js.getClassByName('UserActions');
    const Token = cc.js.getClassByName('Token');
    if (!Dice || !Actions || !Token) return;
    clearInterval(timer);
    const config = window.__require('config');
    const setCounts = counts => {
      config.playerCounts = counts;
      const ui = cc.find('Canvas/screenMainMenu/AllScreens/UIPublicMPMode')?.getComponent('UIPublicMPMode');
      if (ui?.node.activeInHierarchy) ui.onLobbyBetAmountUpdate();
    };
    setCounts(window.__localLobbyCounts || {LUDO_Public: 0, LUDO_Private: 0, arrayLobbyClassic: [], arrayLobbyPopular: []});
    window.addEventListener('local-lobby-counts', event => setCounts(event.detail));
    const online = () => config.gameMode === config.GameMode.PUBLIC || config.gameMode === config.GameMode.PRIVATE;
    const activate = Token.prototype.decideActivation;
    Token.prototype.decideActivation = function (...args) {
      const legal = config.tableInitData.aLegalTokenIds;
      if (online() && this.player.getComponent('Player').myIndex === 0 &&
          config.tableInitData.iDiceValue > 0 && Array.isArray(legal) && !legal.includes('L' + this.tokenID)) {
        this.setDeactive();
        return;
      }
      return activate.apply(this, args);
    };
    const request = Actions.prototype.onDiceAction;
    Actions.prototype.onDiceAction = function (...args) {
      if (!online()) return request.apply(this, args);
      const turn = config.tableInitData._id + ':' + config.tableInitData.iTurnCounter;
      if (this.__localRequestedTurn === turn || config.tableInitData.iDiceValue > 0) return;
      this.__localRequestedTurn = turn;
      return request.apply(this, args);
    };
    const roll = Dice.prototype.onDiceRoll;
    Dice.prototype.onDiceRoll = function (...args) {
      if (online() && config.curTurnID === config.myTurnID && this.player.getComponent('Player').myIndex === 0) {
        cc.find('Canvas/NetworkManager').getComponent('UserActions').onDiceAction();
      }
      return roll.apply(this, args);
    };
    const complete = Dice.prototype.onAnimCompleted;
    Dice.prototype.onAnimCompleted = function (...args) {
      if (!online() || config.tableInitData.iDiceValue > 0) return complete.apply(this, args);
      if (this.__localAwaitingDice) return;
      this.__localAwaitingDice = true;
      const turn = config.currentTurnCounter;
      const wait = () => {
        if (!online() || turn !== config.currentTurnCounter || !this.node.activeInHierarchy) {
          this.__localAwaitingDice = false;
          return;
        }
        if (config.tableInitData.iDiceValue > 0) {
          this.__localAwaitingDice = false;
          complete.apply(this, args);
        } else this.scheduleOnce(wait, 0.05);
      };
      wait();
    };
  }, 100);
  setTimeout(() => clearInterval(timer), 60000);
})();
