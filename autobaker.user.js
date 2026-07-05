// ==UserScript==
// @name         Cookie Clicker AutoBaker
// @namespace    autobaker
// @version      1.0.0
// @description  Autoplays Cookie Clicker toward 100% of normal achievements using only actions a real player could perform.
// @author       AutoBaker
// @match        https://orteil.dashnet.org/cookieclicker/*
// @grant        none
// @run-at       document-idle
// @noframes
// ==/UserScript==

/*
 * AutoBaker — a "plays like a person" Cookie Clicker autopilot.
 *
 * Legitimacy rules this script follows:
 *  - It only performs actions available to a human player: clicking the big
 *    cookie / shimmers / UI elements, buying things from the store, casting
 *    spells, planting seeds, trading stocks, ascending.
 *  - It NEVER grants cookies, edits the save, calls Game.Win(), or uses the
 *    debug/cheat upgrades. Your save stays clean ("Cheated cookies taste
 *    awful" can never trigger from this script).
 *  - Clicking is humanized by default: variable cadence, bursts, and rests.
 *
 * "100%" here means every NON-SHADOW achievement (shadow achievements do not
 * count toward milk and several of them are cheat- or luck-gated by design).
 */

(function () {
  'use strict';

  var W = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
  if (W.__AutoBakerLoaded) return; // guard against double injection (userscript + extension)
  W.__AutoBakerLoaded = true;

  // ------------------------------------------------------------------ config
  var CFG_KEY = 'AutoBakerCfg';
  var STATE_KEY = 'AutoBakerState';

  var cfg = {
    enabled: true,
    clicker: true,
    humanize: true,      // human-ish click cadence with rests; off = steady turbo
    turbo: false,        // ~20 cps instead of 6-10 cps
    goldenCookies: true,
    clickWrath: true,
    buyBuildings: true,
    buyUpgrades: true,
    luckyBank: true,     // keep a cookie reserve so Lucky/Frenzy golden cookies pay out fully
    wrinklers: true,
    popShiny: false,     // shiny wrinklers are kept by default (popping one only feeds a shadow achievement)
    research: true,      // buy bingo center research / manage grandmapocalypse
    seasons: true,
    grimoire: true,
    pantheon: true,
    garden: true,
    gardenSacrifice: true, // sacrifice garden once every seed is unlocked (achievement)
    market: true,
    dragon: true,
    santa: true,
    sugarLumps: true,
    ascension: true,
    ascendRatio: 0.15,   // ascend when prestige gain >= 15% of current prestige
    challengeRuns: true, // schedule Neverclick / Hardcore runs automatically
    miscTasks: true,     // ticker clicks, rename bakery, tiny cookie, etc.
    dunkAssist: true,    // briefly shrink the left panel so milk touches the cookie (Cookie-dunker)
    hud: true
  };

  try {
    var savedCfg = JSON.parse(localStorage.getItem(CFG_KEY) || '{}');
    for (var k in savedCfg) if (k in cfg) cfg[k] = savedCfg[k];
  } catch (e) {}

  function saveCfg() { try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch (e) {} }

  // ------------------------------------------------------------------- state
  var S = {
    runMode: 'NORMAL',     // NORMAL | NEVERCLICK | HARDCORE
    nextRunMode: null,
    lastResets: -1,
    runStart: Date.now(),
    lastBuy: Date.now(),
    lastSeasonSwitch: 0,
    seasonEnteredAt: 0,
    seasonUpgradeCount: -1,
    seasonProgressAt: 0,
    wrinklersFullSince: 0,
    lastWrinklerPop: 0,
    renamed: false,
    lastUncanny: 0,
    lastDunk: 0,
    lastTiny: 0,
    lastPet: 0,
    gardenTarget: '',
    log: []
  };

  try {
    var savedS = JSON.parse(localStorage.getItem(STATE_KEY) || '{}');
    for (var sk in savedS) if (sk in S) S[sk] = savedS[sk];
  } catch (e) {}

  function saveState() { try { localStorage.setItem(STATE_KEY, JSON.stringify(S)); } catch (e) {} }

  // ------------------------------------------------------------------- utils
  function now() { return Date.now(); }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function el(id) { return document.getElementById(id); }
  function fmt(n) { try { return W.Beautify ? W.Beautify(n) : Math.round(n); } catch (e) { return Math.round(n); } }

  function log(msg) {
    S.log.push('[' + new Date().toTimeString().slice(0, 8) + '] ' + msg);
    if (S.log.length > 60) S.log.splice(0, S.log.length - 60);
    try { console.log('%c[AutoBaker]', 'color:#e8b30e', msg); } catch (e) {}
  }

  // Game.UpgradesById / Game.AchievementsById are plain objects keyed by id,
  // not arrays — iterate them with these.
  function eachUpgrade(fn) {
    var byId = W.Game.UpgradesById;
    for (var i in byId) if (byId[i]) fn(byId[i]);
  }
  function eachAchievement(fn) {
    var byId = W.Game.AchievementsById;
    for (var i in byId) if (byId[i]) fn(byId[i]);
  }

  // Achievement helpers. need() is the single gate for "should we chase this":
  // unknown or shadow achievements are never chased.
  function achievement(name) { var G = W.Game; return (G && G.Achievements) ? G.Achievements[name] : null; }
  function need(name) { var a = achievement(name); return !!(a && !a.won && a.pool !== 'shadow'); }
  function won(name) { var a = achievement(name); return !a || !!a.won; }

  function confirmPrompt() { var b = el('promptOption0'); if (b) { b.click(); return true; } return false; }

  // The game ignores clicks with MouseEvent.detail === 0 (plain element.click())
  // beyond 3/s, while real mouse clicks are honored up to 50/s — so dispatch a
  // proper single-click event, exactly what a physical mouse produces.
  function realClick(target) {
    if (!target) return;
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: W, detail: 1 }));
  }

  function clickTicker() {
    var els = [el('commentsText1'), el('commentsText'), el('comments'),
               document.querySelector('#comments .commentsText')];
    for (var i = 0; i < els.length; i++) if (els[i]) { els[i].click(); return; }
  }

  // ------------------------------------------------------------------ clicker
  // Humanized big-cookie clicker: sessions of clicking followed by short rests,
  // per-click jitter, and faster cadence during click-buff windows.
  var clicker = {
    sessionEnd: 0,
    restEnd: 0,
    schedule: function () {
      var self = this;
      setTimeout(function () { self.tick(); }, this.nextDelay());
    },
    nextDelay: function () {
      var G = W.Game;
      if (!cfg.enabled || !cfg.clicker || !G || !G.ready || G.OnAscend) return 500;
      if (S.runMode === 'NEVERCLICK' && G.cookiesEarned < 1e6) return 800;

      var t = now();
      if (!cfg.humanize) return cfg.turbo ? rand(35, 60) : rand(90, 130);

      if (t < this.restEnd) return this.restEnd - t + rand(0, 400);
      if (t > this.sessionEnd) {
        // new click session; occasionally take a longer break
        this.sessionEnd = t + rand(20000, 90000);
        this.restEnd = t + (Math.random() < 0.15 ? rand(4000, 12000) : rand(300, 1500));
        return this.restEnd - t;
      }
      var cps = cfg.turbo ? rand(16, 22) : rand(6, 10);
      var buffed = false;
      try {
        buffed = !!(G.buffs && (G.buffs['Click frenzy'] || G.buffs['Cursed finger'] || G.buffs['Dragonflight']));
      } catch (e) {}
      if (buffed) cps = rand(11, 14); // a human leans in during click frenzies
      return 1000 / cps * rand(0.8, 1.2);
    },
    tick: function () {
      var G = W.Game;
      try {
        if (cfg.enabled && cfg.clicker && G && G.ready && !G.OnAscend &&
            !(S.runMode === 'NEVERCLICK' && G.cookiesEarned < 1e6) &&
            now() >= this.restEnd) {
          realClick(el('bigCookie'));
        }
      } catch (e) {}
      this.schedule();
    }
  };

  // ----------------------------------------------------------------- shimmers
  // Golden cookies / reindeer: react after a human-plausible delay.
  var scheduledShimmers = (typeof WeakSet !== 'undefined') ? new WeakSet() : { has: function () { return false; }, add: function () {} };

  function shimmerTask() {
    var G = W.Game;
    if (!cfg.goldenCookies || !G.shimmers || !G.shimmers.length) return;
    for (var i = 0; i < G.shimmers.length; i++) {
      var s = G.shimmers[i];
      if (scheduledShimmers.has(s)) continue;
      if (s.wrath && !cfg.clickWrath) continue;
      scheduledShimmers.add(s);
      (function (sh) {
        setTimeout(function () {
          try {
            if (!cfg.enabled || !cfg.goldenCookies) return;
            if (sh.l && sh.l.parentNode) realClick(sh.l);
          } catch (e) {}
        }, cfg.humanize ? rand(400, 2500) : rand(50, 250));
      })(s);
    }
  }

  // ---------------------------------------------------------------- purchases
  var EXCLUDED_UPGRADES = {
    // handled by dedicated managers, or intentionally left alone
    'Elder Pledge': 1, 'Elder Covenant': 1, 'Revoke Elder Covenant': 1,
    'Festive biscuit': 1, 'Ghostly biscuit': 1, 'Lovesick biscuit': 1,
    "Fool's biscuit": 1, 'Bunny biscuit': 1,
    'Golden switch [off]': 1, 'Golden switch [on]': 1,
    'Shimmering veil [off]': 1, 'Shimmering veil [on]': 1,
    'Sugar frenzy': 1
  };

  function luckyReserve() {
    var G = W.Game;
    if (!cfg.luckyBank || S.runMode === 'HARDCORE') return 0;
    try {
      if (!G.Has('Lucky day') && !G.Has('Serendipity') && !G.Has('Get lucky')) return 0;
      return G.cookiesPs * (G.Has('Get lucky') ? 42000 : 6000);
    } catch (e) { return 0; }
  }

  function spendable() {
    var G = W.Game;
    var r = luckyReserve();
    // valve: if nothing has been bought for 15 minutes, dip into the reserve
    if (now() - S.lastBuy > 15 * 60000) r = 0;
    return G.cookies - r;
  }

  function buyTask() {
    var G = W.Game;
    if (G.OnAscend) return;
    var budget = spendable();

    // --- upgrades (skipped entirely during a Hardcore run)
    if (cfg.buyUpgrades && !(S.runMode === 'HARDCORE' && G.cookiesEarned < 1e9)) {
      var ups = [];
      for (var i = 0; i < G.UpgradesInStore.length; i++) {
        var u = G.UpgradesInStore[i];
        if (u.pool !== '' && u.pool !== 'cookie') continue; // tech/toggle/prestige handled elsewhere
        if (EXCLUDED_UPGRADES[u.name]) continue;
        ups.push(u);
      }
      ups.sort(function (a, b) { return a.getPrice() - b.getPrice(); });
      if (ups.length && ups[0].getPrice() <= budget) {
        ups[0].buy(1);
        S.lastBuy = now();
        return; // one purchase per tick keeps pacing human
      }
    }

    // --- buildings: pick best payback (price / cps gained)
    if (!cfg.buyBuildings) return;
    var best = null, bestScore = Infinity;
    for (var j = 0; j < G.ObjectsById.length; j++) {
      var o = G.ObjectsById[j];
      var price = o.getPrice();
      var each = (o.storedCps || 0) * (G.globalCpsMult || 1);
      if (each <= 0) each = price / 1e11; // pre-CpS estimate guard
      var score = price / each;
      if (o.amount === 0) score *= 0.2; // unlocking a new building is worth a lot
      if (price <= budget && score < bestScore) { bestScore = score; best = o; }
    }
    if (best) { best.buy(1); S.lastBuy = now(); }
  }

  // ------------------------------------------- research / grandmapocalypse
  function researchTask() {
    var G = W.Game;
    if (!cfg.research || G.OnAscend) return;
    if (S.runMode === 'HARDCORE' && G.cookiesEarned < 1e9) return;

    // buy any available research ("One mind" etc.) — this walks the
    // grandmapocalypse forward, which wrinkler + elder achievements need
    for (var i = 0; i < G.UpgradesInStore.length; i++) {
      var u = G.UpgradesInStore[i];
      if (u.pool === 'tech' && u.getPrice() <= G.cookies) { u.buy(1); return; }
    }

    // Elder Pledge x5 for "Elder nap"/"Elder slumber", then Covenant once for
    // "Elder calm", then revoke it so wrinklers keep farming forever.
    try {
      if (seasonNeedsWrinklers()) return; // don't pause the apocalypse mid-harvest
      var pledge = G.Upgrades['Elder Pledge'];
      if (G.pledges < 5 && pledge && pledge.unlocked && !pledge.bought &&
          G.elderWrath > 0 && pledge.getPrice() <= G.cookies * 0.5) {
        pledge.buy(1); log('Elder Pledge (' + (G.pledges + 1) + '/5)'); return;
      }
      if (G.pledges >= 5) {
        var cov = G.Upgrades['Elder Covenant'];
        if (need('Elder calm') && cov && cov.unlocked && !cov.bought && cov.getPrice() <= G.cookies) {
          cov.buy(1); log('Elder Covenant sealed'); return;
        }
        var rev = G.Upgrades['Revoke Elder Covenant'];
        if (!need('Elder calm') && G.Has('Elder Covenant') && rev && rev.unlocked && rev.getPrice() <= G.cookies) {
          rev.buy(1); log('Covenant revoked — wrinklers welcome back'); return;
        }
      }
    } catch (e) {}
  }

  // ---------------------------------------------------------------- wrinklers
  var popQueue = [];

  function activeWrinklers() {
    var G = W.Game, list = [];
    if (!G.wrinklers) return list;
    for (var i = 0; i < G.wrinklers.length; i++) if (G.wrinklers[i].phase === 2) list.push(G.wrinklers[i]);
    return list;
  }

  function queuePop(w) { if (popQueue.indexOf(w) === -1) popQueue.push(w); }

  function popAllWrinklers(includeShiny) {
    var list = activeWrinklers();
    for (var i = 0; i < list.length; i++) {
      if (list[i].type === 1 && !includeShiny) continue;
      queuePop(list[i]);
    }
  }

  function wrinklerTask() {
    var G = W.Game;
    if (!cfg.wrinklers || G.OnAscend) return;

    // gradual hp drain = the same code path as clicking one repeatedly
    if (popQueue.length) {
      var w = popQueue[0];
      if (w.phase === 0) { popQueue.shift(); }
      else { w.hp -= 1.5; if (w.hp <= 0) popQueue.shift(); }
    }

    var list = activeWrinklers();
    var max = 10;
    try { max = G.getWrinklersMax ? G.getWrinklersMax() : 10; } catch (e) {}

    if (list.length >= max) { if (!S.wrinklersFullSince) S.wrinklersFullSince = now(); }
    else if (list.length < Math.ceil(max / 2)) S.wrinklersFullSince = 0;

    var hungry = (G.season === 'halloween' || G.season === 'easter');
    if (hungry && list.length >= Math.min(6, max) && now() - S.lastWrinklerPop > 120000) {
      // pop the fattest one periodically — halloween/easter drops come from pops
      var fat = null;
      for (var i = 0; i < list.length; i++) {
        if (list[i].type === 1 && !cfg.popShiny) continue;
        if (!fat || list[i].sucked > fat.sucked) fat = list[i];
      }
      if (fat) { queuePop(fat); S.lastWrinklerPop = now(); }
    } else if (S.wrinklersFullSince && now() - S.wrinklersFullSince > 45 * 60000) {
      popAllWrinklers(cfg.popShiny);
      S.wrinklersFullSince = 0;
      S.lastWrinklerPop = now();
    }
  }

  // ------------------------------------------------------------------ seasons
  var SEASON_BISCUIT = {
    christmas: 'Festive biscuit',
    halloween: 'Ghostly biscuit',
    valentines: 'Lovesick biscuit',
    easter: 'Bunny biscuit'
  };

  function seasonUpgradesMissing(season) {
    var missing = 0;
    eachUpgrade(function (u) {
      if (u.season !== season || u.bought) return;
      if (u.pool === 'prestige' || u.pool === 'toggle' || u.pool === 'debug') return;
      for (var s in SEASON_BISCUIT) if (SEASON_BISCUIT[s] === u.name) return;
      missing++;
    });
    return missing;
  }

  function christmasDone() {
    var G = W.Game;
    return G.santaLevel >= 14 && seasonUpgradesMissing('christmas') === 0 && !need('Reindeer sleigh team');
  }
  function easterDone() { return seasonUpgradesMissing('easter') === 0 && !need('Hide & seek champion'); }
  function halloweenDone() { return seasonUpgradesMissing('halloween') === 0 && !need('Spooky cookies'); }
  function valentinesDone() { return seasonUpgradesMissing('valentines') === 0 && !need('Lovely cookies'); }

  function seasonNeedsWrinklers() {
    var G = W.Game;
    return (G.season === 'halloween' && !halloweenDone()) ||
           (G.season === 'easter' && !easterDone());
  }

  function countBoughtSeasonUpgrades() {
    var n = 0;
    eachUpgrade(function (u) { if (u.season && u.bought) n++; });
    return n;
  }

  function seasonTask() {
    var G = W.Game;
    if (!cfg.seasons || G.OnAscend || S.runMode !== 'NORMAL') return;
    if (!G.Has('Season switcher')) return;

    // progress watchdog: if the current season stalls for an hour, rotate
    var bought = countBoughtSeasonUpgrades();
    if (bought !== S.seasonUpgradeCount) { S.seasonUpgradeCount = bought; S.seasonProgressAt = now(); }

    var goals = [
      { s: 'christmas', done: christmasDone(), ready: true },
      { s: 'easter', done: easterDone(), ready: G.elderWrath > 0 || activeWrinklers().length > 0 || true },
      { s: 'halloween', done: halloweenDone(), ready: G.elderWrath > 0 }, // spooky cookies only drop from wrinklers
      { s: 'valentines', done: valentinesDone(), ready: true }
    ];

    var target = null;
    for (var i = 0; i < goals.length; i++) {
      if (!goals[i].done && goals[i].ready) { target = goals[i]; break; }
    }
    if (!target) return; // every season complete — stay put

    if (G.season === target.s) {
      var stalled = S.seasonProgressAt && (now() - S.seasonProgressAt > 60 * 60000) &&
                    (now() - S.seasonEnteredAt > 3 * 60 * 60000);
      if (!stalled) return;
      // rotate to the next incomplete season
      var idx = -1;
      for (var g = 0; g < goals.length; g++) if (goals[g].s === target.s) idx = g;
      target = null;
      for (var h = 1; h <= goals.length; h++) {
        var cand = goals[(idx + h) % goals.length];
        if (!cand.done && cand.ready && cand.s !== G.season) { target = cand; break; }
      }
      if (!target) return;
    }

    if (now() - S.lastSeasonSwitch < 30 * 60000) return;
    var u = G.Upgrades[SEASON_BISCUIT[target.s]];
    if (u && u.getPrice() <= G.cookies * 0.3) {
      u.buy(1);
      S.lastSeasonSwitch = now();
      S.seasonEnteredAt = now();
      S.seasonProgressAt = now();
      log('Season switched to ' + target.s);
    }
  }

  function santaTask() {
    var G = W.Game;
    if (!cfg.santa || G.OnAscend || G.season !== 'christmas') return;
    if (S.runMode === 'HARDCORE' && G.cookiesEarned < 1e9) return;
    // "A festive hat" itself is a normal store upgrade — the generic buyer gets it
    try {
      if (G.Has('A festive hat') && G.santaLevel < 14) {
        var cost = Math.pow(G.santaLevel + 1, G.santaLevel + 1);
        if (G.cookies >= cost) { G.UpgradeSanta(); log('Santa leveled to ' + G.santaLevel); }
      }
    } catch (e) {}
  }

  // ---------------------------------------------------------------- minigames
  function minigameOf(buildingName) {
    var G = W.Game;
    var o = G.Objects[buildingName];
    return (o && o.minigame && o.minigameLoaded !== false) ? o.minigame : null;
  }

  function grimoireTask() {
    var G = W.Game;
    if (!cfg.grimoire || G.OnAscend) return;
    var M = minigameOf('Wizard tower');
    if (!M || !M.spells) return;
    try {
      var fthof = M.spells['hand of fate'];
      var conj = M.spells['conjure baked goods'];
      var hagg = M.spells["haggler's charm"];
      var buffed = !!(G.buffs && (G.buffs['Frenzy'] || G.buffs['Click frenzy']));
      var sp = conj || hagg || fthof;
      if (buffed && fthof) sp = fthof; // golden cookie during a frenzy = combo
      if (!sp) return;
      var cost = M.getSpellCost(sp);
      if (M.magic >= Math.max(cost, M.magicM - 1)) M.castSpell(sp);
    } catch (e) {}
  }

  function dumpMagic() {
    // pre-ascension: burn remaining magic for spell-count achievements
    var M = minigameOf('Wizard tower');
    if (!M || !M.spells) return;
    try {
      var sp = M.spells["haggler's charm"] || M.spells['conjure baked goods'];
      var guard = 0;
      while (sp && M.magic >= M.getSpellCost(sp) && guard++ < 10) {
        if (!M.castSpell(sp)) break;
      }
    } catch (e) {}
  }

  var PANTHEON_SETUP = ['mother', 'scorn', 'order']; // milk, wrinklers, lumps — no downsides

  function pantheonTask() {
    var G = W.Game;
    if (!cfg.pantheon || G.OnAscend) return;
    var M = minigameOf('Temple');
    if (!M || !M.gods || !M.slot) return;
    try {
      if (typeof M.slotGod !== 'function') return;
      for (var i = 0; i < Math.min(3, M.slot.length); i++) {
        var god = M.gods[PANTHEON_SETUP[i]];
        if (!god) continue;
        if (M.slot[i] === god.id) continue;
        if ((M.swaps || 0) <= 0) return;
        M.slotGod(god, i);
        return; // one change per tick
      }
    } catch (e) {}
  }

  // ------------------------------------------------------------------- garden
  // Breeding planner: column layout A | B | empty | A | B | empty.
  // Empty-column tiles get 3 mature A + 3 mature B neighbors, which satisfies
  // every two-parent mutation recipe. Special layouts for JQB / molds / weeds.
  var GARDEN_PLAN = [
    { k: 'thumbcorn', t: 'pair', p: ['bakerWheat', 'bakerWheat'] },
    { k: 'bakeberry', t: 'pair', p: ['bakerWheat', 'bakerWheat'] },
    { k: 'cronerice', t: 'pair', p: ['bakerWheat', 'thumbcorn'] },
    { k: 'gildmillet', t: 'pair', p: ['cronerice', 'thumbcorn'] },
    { k: 'clover', t: 'pair', p: ['bakerWheat', 'gildmillet'] },
    { k: 'shimmerlily', t: 'pair', p: ['clover', 'gildmillet'] },
    { k: 'elderwort', t: 'pair', p: ['shimmerlily', 'cronerice'] },
    { k: 'meddleweed', t: 'weed', p: [] },
    { k: 'crumbspore', t: 'mold', p: ['meddleweed'] },
    { k: 'whiteMildew', t: 'mold', p: ['meddleweed'] },
    { k: 'brownMold', t: 'pair', p: ['whiteMildew', 'whiteMildew'] },
    { k: 'chocoroot', t: 'pair', p: ['bakerWheat', 'brownMold'] },
    { k: 'whiteChocoroot', t: 'pair', p: ['chocoroot', 'whiteMildew'] },
    { k: 'tidygrass', t: 'pair', p: ['bakerWheat', 'whiteChocoroot'] },
    { k: 'greenRot', t: 'pair', p: ['whiteMildew', 'clover'] },
    { k: 'keenmoss', t: 'pair', p: ['greenRot', 'brownMold'] },
    { k: 'wardlichen', t: 'pair', p: ['cronerice', 'keenmoss'] },
    { k: 'drowsyfern', t: 'pair', p: ['chocoroot', 'keenmoss'] },
    { k: 'wrinklegill', t: 'pair', p: ['crumbspore', 'brownMold'] },
    { k: 'doughshroom', t: 'pair', p: ['crumbspore', 'crumbspore'] },
    { k: 'glovemorel', t: 'pair', p: ['crumbspore', 'thumbcorn'] },
    { k: 'cheapcap', t: 'pair', p: ['crumbspore', 'shimmerlily'] },
    { k: 'foolBolete', t: 'pair', p: ['doughshroom', 'greenRot'] },
    { k: 'ichorpuff', t: 'pair', p: ['crumbspore', 'cronerice'] },
    { k: 'whiskerbloom', t: 'pair', p: ['shimmerlily', 'whiteChocoroot'] },
    { k: 'chimerose', t: 'pair', p: ['shimmerlily', 'whiskerbloom'] },
    { k: 'nursetulip', t: 'pair', p: ['whiskerbloom', 'whiskerbloom'] },
    { k: 'queenbeet', t: 'pair', p: ['bakeberry', 'chocoroot'] },
    { k: 'duketater', t: 'pair', p: ['queenbeet', 'queenbeet'] },
    { k: 'shriekbulb', t: 'pair', p: ['wrinklegill', 'elderwort'] },
    { k: 'queenbeetLump', t: 'ring', p: ['queenbeet'] },
    { k: 'everdaisy', t: 'pair', p: ['tidygrass', 'elderwort'] },
    { k: 'goldenClover', t: 'pair', p: ['clover', 'clover'] }
  ];

  function gardenPatternFor(M, entry) {
    if (!entry) return function () { return null; };
    if (entry.t === 'weed') return function () { return null; }; // meddleweed self-spawns on empty tiles
    if (entry.t === 'mold') {
      // sparse meddleweed left to die of old age spawns crumbspore/white mildew
      return function (x, y) {
        return (M.plants['meddleweed'] && M.plants['meddleweed'].unlocked && x % 2 === 0 && y % 2 === 0)
          ? 'meddleweed' : null;
      };
    }
    if (entry.t === 'ring') {
      // queenbeet rings with empty centers at (1,1),(1,4),(4,1),(4,4)
      return function (x, y) { return (x % 3 === 1 && y % 3 === 1) ? null : 'queenbeet'; };
    }
    // pair: uniform columns so empty columns see 3 of each parent
    var A = entry.p[0], B = entry.p[1] || entry.p[0];
    return function (x) {
      var c = x % 3;
      if (c === 2) return null;
      return c === 0 ? A : B;
    };
  }

  function gardenTask() {
    var G = W.Game;
    if (!cfg.garden || G.OnAscend) return;
    var M = minigameOf('Farm');
    if (!M || !M.plants || !M.plot) return;

    try {
      // pick target: first seed whose parents are all unlocked
      var target = null;
      var allUnlocked = true;
      for (var key in M.plants) if (!M.plants[key].unlocked) allUnlocked = false;

      if (allUnlocked) {
        S.gardenTarget = 'complete';
        if (cfg.gardenSacrifice && need('Seedless to nay') && typeof M.askConvert === 'function') {
          M.askConvert(); // opens the game's own confirmation prompt
          setTimeout(confirmPrompt, 400);
          log('Sacrificing garden (Seedless to nay)');
        }
        return;
      }

      for (var i = 0; i < GARDEN_PLAN.length; i++) {
        var e = GARDEN_PLAN[i];
        if (!M.plants[e.k] || M.plants[e.k].unlocked) continue;
        var ok = true;
        for (var pi = 0; pi < e.p.length; pi++) {
          if (!M.plants[e.p[pi]] || !M.plants[e.p[pi]].unlocked) ok = false;
        }
        if (ok) { target = e; break; }
      }
      S.gardenTarget = target ? target.k : '(waiting)';
      var pattern = gardenPatternFor(M, target);
      var moldMode = target && target.t === 'mold';

      var unlocked = function (x, y) {
        try { return (typeof M.isTileUnlocked === 'function') ? M.isTileUnlocked(x, y) : true; }
        catch (er) { return true; }
      };

      for (var y = 0; y < 6; y++) {
        for (var x = 0; x < 6; x++) {
          if (!M.plot[y] || !M.plot[y][x] || !unlocked(x, y)) continue;
          var tile = M.plot[y][x];
          var id = tile[0], age = tile[1];

          if (id === 0) {
            var wantKey = pattern(x, y);
            if (!wantKey) continue;
            var plant = M.plants[wantKey];
            if (!plant || !plant.unlocked) continue;
            if (typeof M.canPlant === 'function' && !M.canPlant(plant)) continue;
            M.seedSelected = plant.id;
            M.clickTile(x, y);
            M.seedSelected = -1;
            continue;
          }

          var p = M.plantsById[id - 1];
          if (!p) continue;

          if (!p.unlocked) {
            // a fresh mutation! harvesting it mature unlocks the seed
            if (age >= p.mature) M.harvest(x, y);
            continue;
          }
          if (moldMode && p.key === 'meddleweed') continue; // let it die naturally

          var desired = pattern(x, y);
          if (desired !== p.key) {
            if (age >= p.mature) M.harvest(x, y); // clear squatters once mature (counts for harvest achievements)
          } else if (!p.immortal && age >= 92) {
            M.harvest(x, y); // refresh parents just before they die
          }
        }
      }
    } catch (e) {}
  }

  // ------------------------------------------------------------------- market
  function marketTask() {
    var G = W.Game;
    if (!cfg.market || G.OnAscend) return;
    var M = minigameOf('Bank');
    if (!M || !M.goodsById) return;
    try {
      var bankLvl = G.Objects['Bank'].level || 1;
      for (var i = 0; i < M.goodsById.length; i++) {
        var g = M.goodsById[i];
        if (!g.active) continue;
        var resting = (typeof M.getRestingVal === 'function')
          ? M.getRestingVal(g.id)
          : 10 * (g.id + 1) + (bankLvl - 1);
        if (g.stock > 0 && g.val > resting * 1.35) M.sellGood(g.id, g.stock);
        else if (g.stock === 0 && g.val < resting * 0.6) M.buyGood(g.id, 10000);
      }
    } catch (e) {}
  }

  // ------------------------------------------------------------------- dragon
  function findAuraIndex(name) {
    var G = W.Game;
    for (var i in G.dragonAuras) if (G.dragonAuras[i] && G.dragonAuras[i].name === name) return parseInt(i, 10);
    return -1;
  }

  function dragonTask() {
    var G = W.Game;
    if (!cfg.dragon || G.OnAscend) return;
    try {
      if (!G.Has('A crumbly egg')) return; // egg is a store upgrade; generic buyer handles it
      // early levels only cost cookies; building sacrifices wait for pre-ascension
      if (G.dragonLevel < 5) G.UpgradeDragon();

      if (G.dragonLevel >= 5) {
        var desired = findAuraIndex('Radiant Appetite');
        if (desired < 0 || G.dragonLevel < desired + 4) desired = findAuraIndex('Breath of Milk');
        if (desired >= 0 && G.dragonLevel >= desired + 4 && G.dragonAura === 0) {
          G.SetDragonAura(desired, 0);
          setTimeout(confirmPrompt, 300);
        }
      }

      // pet the dragon now and then (achievement + rare drops)
      if (G.dragonLevel >= 4 && G.Has('Pet the dragon') && now() - S.lastPet > 5 * 60000) {
        S.lastPet = now();
        G.specialTab = 'dragon';
        G.ToggleSpecialMenu(1);
        setTimeout(function () {
          try {
            var pic = el('specialPic');
            if (pic) pic.click();
            G.ToggleSpecialMenu(0);
          } catch (e) {}
        }, 400);
      }
    } catch (e) {}
  }

  function trainDragonMax() {
    var G = W.Game;
    if (!cfg.dragon) return;
    try {
      if (!G.Has('A crumbly egg')) return;
      var guard = 0;
      while (G.dragonLevel < G.dragonLevels.length - 1 && guard++ < 40) {
        var before = G.dragonLevel;
        G.UpgradeDragon(); // buildings are about to reset anyway — sacrifice freely
        if (G.dragonLevel === before) break;
      }
    } catch (e) {}
  }

  // -------------------------------------------------------------- sugar lumps
  function lumpTask() {
    var G = W.Game;
    if (!cfg.sugarLumps || G.OnAscend) return;
    try {
      if (!G.canLumps || !G.canLumps()) return;
      var age = now() - G.lumpT;
      if (age >= G.lumpRipeAge) G.clickLump(); // harvest ripe (never gamble on unripe)

      // spend: minigames first, then Farm to 9 (full plot), then round-robin to 10
      var order = ['Wizard tower', 'Temple', 'Farm', 'Bank'];
      for (var i = 0; i < order.length; i++) {
        var o = G.Objects[order[i]];
        if (o && o.level < 1 && G.lumps >= 1) { o.levelUp(); return; }
      }
      var farm = G.Objects['Farm'];
      if (farm && farm.level < 9 && G.lumps >= farm.level + 1) { farm.levelUp(); return; }
      var cheapest = null;
      for (var j = 0; j < G.ObjectsById.length; j++) {
        var b = G.ObjectsById[j];
        if (b.amount > 0 && b.level < 10 && (!cheapest || b.level < cheapest.level)) cheapest = b;
      }
      if (cheapest && G.lumps >= cheapest.level + 1) cheapest.levelUp();
    } catch (e) {}
  }

  // ---------------------------------------------------------------- misc/oneshots
  function miscTask() {
    var G = W.Game;
    if (!cfg.miscTasks || G.OnAscend) return;

    try {
      // claim ticker fortunes (Fortune cookies heavenly upgrade)
      if (G.TickerEffect && G.TickerEffect.type === 'fortune') clickTicker();

      // Tabloid addiction: click the news ticker 50 times
      if (need('Tabloid addiction')) clickTicker();

      // Tiny cookie: the little cookie icon in the stats menu is clickable
      if (need('Tiny cookie') && now() - S.lastTiny > 5 * 60000) {
        S.lastTiny = now();
        G.ShowMenu('stats');
        setTimeout(function () {
          try {
            var t = document.querySelector('#menu [onclick*="Tiny cookie"]');
            if (t) t.click();
            G.ShowMenu('');
          } catch (e) {}
        }, 500);
      }

      // What's in a name: confirm the rename prompt (keeps your current name)
      if (need("What's in a name") && !S.renamed) {
        S.renamed = true;
        G.bakeryNamePrompt();
        setTimeout(function () {
          try {
            var input = el('bakeryNameInput');
            if (input && !input.value) input.value = G.bakeryName || 'AutoBaker';
            confirmPrompt();
          } catch (e) {}
        }, 400);
      }

      // Just wrong: sell a grandma (she'll be rebought by the building buyer)
      if (need('Just wrong') && G.Objects['Grandma'].amount > 0) G.Objects['Grandma'].sell(1);

      // Uncanny clicker: one short superhuman burst (only if it's a normal achievement)
      if (need('Uncanny clicker') && S.runMode !== 'NEVERCLICK' && now() - S.lastUncanny > 10 * 60000) {
        S.lastUncanny = now();
        var n = 0;
        var burst = setInterval(function () {
          try { realClick(el('bigCookie')); } catch (e) {}
          if (++n >= 45) clearInterval(burst);
        }, 40);
      }

      // Cookie-dunker: briefly shrink the left panel so the milk touches the cookie
      if (cfg.dunkAssist && need('Cookie-dunker') && G.milkProgress > 0.1 && now() - S.lastDunk > 10 * 60000) {
        S.lastDunk = now();
        var sec = el('sectionLeft');
        if (sec) {
          var orig = sec.style.height;
          sec.style.height = '240px';
          window.dispatchEvent(new Event('resize'));
          setTimeout(function () {
            sec.style.height = orig;
            window.dispatchEvent(new Event('resize'));
          }, 5000);
        }
      }

      if (G.CloseNotes) G.CloseNotes();
    } catch (e) {}
  }

  // ---------------------------------------------------------------- ascension
  var asc = {
    phase: 'idle',
    prepUntil: 0,
    screenAt: 0,

    onlyGrindLeft: function () {
      // if Endless cycle (1000 ascensions) is among the last things missing,
      // switch to rapid-cycling mode
      var blockers = 0;
      eachAchievement(function (a) {
        if (a.pool === 'shadow' || a.won) return;
        if (a.name !== 'Endless cycle') blockers++;
      });
      return need('Endless cycle') && blockers <= 3;
    },

    decideNextMode: function () {
      var G = W.Game;
      if (cfg.challengeRuns && G.resets >= 1) {
        if (need('Neverclick')) return 'NEVERCLICK';
        if (need('Hardcore')) return 'HARDCORE';
      }
      return 'NORMAL';
    },

    tick: function () {
      var G = W.Game;
      if (G.OnAscend) { this.onScreen(); return; }
      this.screenAt = 0;
      if (!cfg.ascension || S.runMode !== 'NORMAL') return;

      var potential = 0;
      try { potential = Math.floor(G.HowMuchPrestige(G.cookiesReset + G.cookiesEarned)); } catch (e) { return; }
      var gain = potential - G.prestige;
      var minRun = this.onlyGrindLeft() ? 10 * 60000 : 20 * 60000;
      var ok;
      if (G.resets === 0) ok = gain >= 440;
      else if (this.onlyGrindLeft()) ok = gain >= 1;
      else ok = gain >= Math.max(1, G.prestige * cfg.ascendRatio);

      if (!ok || now() - S.runStart < minRun) { this.phase = 'idle'; return; }

      if (this.phase !== 'prep') {
        this.phase = 'prep';
        this.prepUntil = now() + 90000;
        log('Preparing to ascend (+' + fmt(gain) + ' prestige)');
        popAllWrinklers(cfg.popShiny);
        trainDragonMax();
        dumpMagic();
        return;
      }
      if (now() >= this.prepUntil && popQueue.length === 0) {
        this.phase = 'idle';
        G.Ascend(1);
      }
    },

    onScreen: function () {
      var G = W.Game;
      if (!cfg.ascension) return;
      if (!this.screenAt) { this.screenAt = now(); return; }
      if (now() - this.screenAt < 4000) return; // let the screen settle

      var hardcoreNext = cfg.challengeRuns && need('Hardcore') && !need('Neverclick') && G.resets >= 1;

      // buy heavenly upgrades cheapest-first until nothing else is affordable.
      // Starter kitchen is skipped while Hardcore is pending: it grants an
      // owned upgrade at run start, which would void the Hardcore condition.
      try {
        var boughtSomething = true, guard = 0;
        while (boughtSomething && guard++ < 300) {
          boughtSomething = false;
          var ups = [];
          eachUpgrade(function (u) {
            if (u.pool !== 'prestige' || u.bought) return;
            if (hardcoreNext && u.name === 'Starter kitchen') return;
            ups.push(u);
          });
          ups.sort(function (a, b) { return a.getPrice() - b.getPrice(); });
          for (var j = 0; j < ups.length; j++) {
            var up = ups[j];
            if (up.canBePurchased === false) continue;
            if (up.getPrice() > G.heavenlyChips) continue;
            if (typeof G.PurchaseHeavenlyUpgrade === 'function') G.PurchaseHeavenlyUpgrade(up.id);
            else up.buy();
            if (up.bought) {
              boughtSomething = true;
              if (typeof G.BuildAscendTree === 'function') G.BuildAscendTree();
              break;
            }
          }
        }
      } catch (e) {}

      // permanent upgrade slots: strongest owned normal upgrades by price.
      // Vacated entirely when a Hardcore run is next (slotted upgrades count as owned).
      try {
        var romans = ['I', 'II', 'III', 'IV', 'V'];
        for (var s = 0; s < 5; s++) {
          if (!G.Has('Permanent upgrade slot ' + romans[s])) continue;
          if (hardcoreNext) {
            try { G.PutUpgradeInPermanentSlot(-1, s); } catch (e2) { G.permanentUpgrades[s] = -1; }
            continue;
          }
          var candidates = [];
          eachUpgrade(function (cu) {
            if (!cu.bought || cu.pool !== '' || cu.season) return;
            for (var s2 = 0; s2 < 5; s2++) if (G.permanentUpgrades[s2] === cu.id && s2 !== s) return;
            candidates.push(cu);
          });
          candidates.sort(function (a, b) { return b.basePrice - a.basePrice; });
          if (candidates[s] && G.permanentUpgrades[s] !== candidates[s].id) {
            G.PutUpgradeInPermanentSlot(candidates[s].id, s);
          }
        }
      } catch (e) {}

      S.nextRunMode = this.decideNextMode();
      if (S.nextRunMode !== 'NORMAL') log('Next run: ' + S.nextRunMode + ' challenge');
      G.Reincarnate(1);
    }
  };

  // run-mode bookkeeping and challenge completion checks
  function modeTask() {
    var G = W.Game;
    if (G.resets !== S.lastResets) {
      S.lastResets = G.resets;
      S.runStart = now();
      S.runMode = S.nextRunMode || 'NORMAL';
      S.nextRunMode = null;
      S.seasonUpgradeCount = -1;
      if (S.runMode !== 'NORMAL') log('Run mode: ' + S.runMode);
      saveState();
    }
    if (S.runMode === 'NEVERCLICK') {
      if (G.cookiesEarned >= 1e6) {
        log(won('Neverclick') ? 'Neverclick complete!' : 'Neverclick window passed');
        S.runMode = 'NORMAL';
      } else if (G.cookieClicks > 15) {
        log('Neverclick run compromised (' + G.cookieClicks + ' clicks) — resuming normal play');
        S.runMode = 'NORMAL';
      }
    }
    if (S.runMode === 'HARDCORE') {
      if (G.cookiesEarned >= 1e9) {
        log(won('Hardcore') ? 'Hardcore complete!' : 'Hardcore window passed');
        S.runMode = 'NORMAL';
      } else if (G.UpgradesOwned > 0) {
        log('Hardcore run compromised (an upgrade is owned) — resuming normal play');
        S.runMode = 'NORMAL';
      }
    }
  }

  // --------------------------------------------------------------------- HUD
  var hud = { root: null, body: null, boxes: {} };

  function buildHud() {
    if (!cfg.hud || hud.root) return;
    var root = document.createElement('div');
    root.id = 'autobakerHud';
    root.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:100000000;width:270px;' +
      'background:rgba(10,10,14,.92);color:#eee;font:11px/1.5 monospace;border:1px solid #b8860b;' +
      'border-radius:6px;padding:0;user-select:none;';
    var head = document.createElement('div');
    head.textContent = '🍪 AutoBaker';
    head.style.cssText = 'cursor:move;padding:4px 8px;background:#b8860b;color:#111;font-weight:bold;border-radius:5px 5px 0 0;';
    var body = document.createElement('div');
    body.style.cssText = 'padding:6px 8px;max-height:330px;overflow-y:auto;';
    root.appendChild(head);
    root.appendChild(body);
    document.body.appendChild(root);
    hud.root = root;
    hud.body = body;

    // drag
    var drag = null;
    head.addEventListener('mousedown', function (ev) {
      drag = [ev.clientX - root.offsetLeft, ev.clientY - root.offsetTop];
      ev.preventDefault();
    });
    document.addEventListener('mousemove', function (ev) {
      if (!drag) return;
      root.style.left = (ev.clientX - drag[0]) + 'px';
      root.style.top = (ev.clientY - drag[1]) + 'px';
      root.style.bottom = 'auto';
    });
    document.addEventListener('mouseup', function () { drag = null; });
    head.addEventListener('dblclick', function () {
      body.style.display = body.style.display === 'none' ? 'block' : 'none';
    });
  }

  var HUD_TOGGLES = [
    ['enabled', 'Master switch'], ['clicker', 'Auto-click cookie'], ['humanize', 'Human-like pacing'],
    ['turbo', 'Turbo clicking'], ['goldenCookies', 'Golden cookies'], ['buyUpgrades', 'Buy upgrades'],
    ['buyBuildings', 'Buy buildings'], ['wrinklers', 'Wrinklers'], ['seasons', 'Season cycling'],
    ['garden', 'Garden'], ['market', 'Stock market'], ['grimoire', 'Grimoire'],
    ['ascension', 'Auto-ascend'], ['challengeRuns', 'Challenge runs']
  ];

  function hudTask() {
    if (!cfg.hud) return;
    buildHud();
    if (!hud.body) return;
    var G = W.Game;
    var wonN = 0, totalN = 0;
    eachAchievement(function (a) {
      if (a.pool === 'shadow') return;
      totalN++;
      if (a.won) wonN++;
    });
    var gain = 0;
    try { gain = Math.floor(G.HowMuchPrestige(G.cookiesReset + G.cookiesEarned)) - G.prestige; } catch (e) {}

    var html = '<div style="margin-bottom:4px">' +
      '<b>Achievements:</b> ' + wonN + ' / ' + totalN + ' normal<br>' +
      '<b>Mode:</b> ' + S.runMode + (G.OnAscend ? ' (ascending)' : '') + '<br>' +
      '<b>Prestige:</b> ' + fmt(G.prestige) + ' (+' + fmt(Math.max(0, gain)) + ' on ascend)<br>' +
      '<b>Season:</b> ' + (G.season || 'none') + ' &nbsp; <b>Garden:</b> ' + (S.gardenTarget || '-') +
      '</div><div id="abToggles"></div>' +
      '<div style="margin-top:4px;border-top:1px solid #444;padding-top:3px;color:#aaa">' +
      S.log.slice(-6).map(function (l) { return l.replace(/</g, '&lt;'); }).join('<br>') + '</div>';
    hud.body.innerHTML = html;

    var tgl = hud.body.querySelector('#abToggles');
    HUD_TOGGLES.forEach(function (t) {
      var lbl = document.createElement('label');
      lbl.style.cssText = 'display:inline-block;width:48%;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;vertical-align:top;';
      lbl.title = t[1];
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !!cfg[t[0]];
      cb.style.verticalAlign = 'middle';
      cb.addEventListener('change', function () { cfg[t[0]] = cb.checked; saveCfg(); });
      lbl.appendChild(cb);
      lbl.appendChild(document.createTextNode(' ' + t[1]));
      tgl.appendChild(lbl);
    });
  }

  // ------------------------------------------------------------------- tasks
  var tasks = [
    { name: 'mode', every: 1000, fn: modeTask },
    { name: 'shimmers', every: 300, fn: shimmerTask },
    { name: 'buy', every: 1500, fn: buyTask },
    { name: 'research', every: 10000, fn: researchTask },
    { name: 'wrinklers', every: 500, fn: wrinklerTask },
    { name: 'seasons', every: 60000, fn: seasonTask },
    { name: 'santa', every: 30000, fn: santaTask },
    { name: 'grimoire', every: 15000, fn: grimoireTask },
    { name: 'pantheon', every: 300000, fn: pantheonTask },
    { name: 'garden', every: 30000, fn: gardenTask },
    { name: 'market', every: 20000, fn: marketTask },
    { name: 'dragon', every: 60000, fn: dragonTask },
    { name: 'lumps', every: 60000, fn: lumpTask },
    { name: 'misc', every: 7000, fn: miscTask },
    { name: 'ascension', every: 10000, fn: function () { asc.tick(); } },
    { name: 'hud', every: 2000, fn: hudTask },
    { name: 'save', every: 60000, fn: saveState }
  ];

  tasks.forEach(function (t) { t.nextAt = 0; t.errors = 0; });

  function mainLoop() {
    var G = W.Game;
    if (cfg.enabled && G && G.ready) {
      var t = now();
      for (var i = 0; i < tasks.length; i++) {
        var task = tasks[i];
        if (t < task.nextAt) continue;
        task.nextAt = t + task.every * rand(0.9, 1.15);
        try {
          task.fn();
        } catch (e) {
          task.errors++;
          if (task.errors === 1) log('Subsystem "' + task.name + '" error: ' + e.message);
          if (task.errors >= 5) task.nextAt = t + 3600000; // back off for an hour
        }
      }
    }
    setTimeout(mainLoop, 300);
  }

  // -------------------------------------------------------------------- boot
  function boot() {
    // first-visit language screen / cookie banner
    var lang = el('langSelect-EN');
    if (lang) { lang.click(); setTimeout(boot, 2000); return; }
    var consent = document.querySelector('.cc_btn_accept_all');
    if (consent) consent.click();

    var G = W.Game;
    if (!G || !G.ready) { setTimeout(boot, 1000); return; }

    // register as a proper mod so state persists inside the game's save
    try {
      if (G.registerMod && !G.mods['AutoBaker']) {
        G.registerMod('AutoBaker', {
          init: function () {},
          save: function () { return JSON.stringify(S); },
          load: function (str) {
            try {
              var d = JSON.parse(str);
              for (var k in d) if (k in S) S[k] = d[k];
            } catch (e) {}
          }
        });
      }
    } catch (e) {}

    S.lastResets = G.resets;
    log('AutoBaker v1.0.0 online — good luck, little baker');
    clicker.schedule();
    mainLoop();
  }

  // ------------------------------------------------------------- console API
  W.AutoBaker = {
    version: '1.0.0',
    cfg: cfg,
    state: S,
    set: function (k, v) { if (k in cfg) { cfg[k] = v; saveCfg(); } return cfg; },
    remaining: function () {
      var out = [];
      eachAchievement(function (a) {
        if (a.pool !== 'shadow' && !a.won) out.push(a.name);
      });
      console.log(out.length + ' normal achievements remaining:\n' + out.join(', '));
      return out;
    },
    pause: function () { cfg.enabled = false; saveCfg(); },
    resume: function () { cfg.enabled = true; saveCfg(); }
  };

  boot();
})();
