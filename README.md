# 🍪 Cookie Clicker AutoBaker

An autopilot for [Cookie Clicker](https://orteil.dashnet.org/cookieclicker/) that plays the
game **the way a human would** and steadily works toward **100% of the normal achievements**
(full milk). One file, no dependencies, installable as either a userscript or a browser
extension.

## What "legitimate gameplay" means here

AutoBaker only ever performs actions a real player could perform:

- It **clicks** the big cookie, golden cookies, wrinklers, the news ticker, and UI buttons.
- It **buys** buildings, upgrades, research, season biscuits, Santa levels, and heavenly
  upgrades through the store, exactly like clicking the shop.
- It **plays the minigames**: casts Grimoire spells, slots Pantheon spirits, breeds Garden
  seeds, and trades on the Stock Market through each minigame's own actions.

It **never** grants cookies, edits your save, calls debug functions, or touches the cheat
upgrades — so your save stays clean and `Cheated cookies taste awful` can never trigger.
Clicks are genuine MouseEvents at ~20–25 per second, well within the 50/s that the game
itself accepts from a mouse (fast clicking isn't cheating — the game even awards the
*Uncanny clicker* achievement for it). Turn off `turbo` in the HUD if you want a slower
~10/s to save CPU.

> The only unavoidable footprint: registering as a mod grants the **Third-party** *shadow*
> achievement, which is cosmetic and does not affect milk or 100% completion.

## Install

### Option A — userscript (recommended)

1. Install [Tampermonkey](https://www.tampermonkey.net/) (or Violentmonkey).
2. Open `autobaker.user.js` from this repo and add it as a new userscript
   (Tampermonkey will auto-detect it if you open the raw file URL).
3. Visit https://orteil.dashnet.org/cookieclicker/ — the AutoBaker HUD appears bottom-left.

### Option B — unpacked extension

1. Clone/download this repo.
2. Chrome/Edge: `chrome://extensions` → enable **Developer mode** → **Load unpacked** →
   select the repo folder. (Firefox 128+: `about:debugging` → Load Temporary Add-on →
   pick `manifest.json`.)
3. Visit the game.

Don't install both at once — the script guards against double-injection, but there's no
reason to run two copies.

## What it automates

| System | Behavior |
|---|---|
| Big cookie | Steady fast clicking (~20–25/s; ~10/s with turbo off) |
| Time warp | Optional fast-forward of the whole game simulation, 1×–100× (see below) |
| Golden/wrath cookies & reindeer | Clicked within a fraction of a second of spawning |
| Buildings | Best payback (price ÷ CpS gained), prioritizes unlocking new buildings |
| Upgrades | Bought cheapest-first, with a "Lucky bank" reserve so Frenzy×Lucky pays out fully |
| Grandmapocalypse | Buys research, pledges ×5, seals + revokes the Elder Covenant (all 3 elder achievements), then farms wrinklers forever |
| Wrinklers | Lets them fatten, pops on a schedule (eagerly during Halloween/Easter for drops); shiny wrinklers are preserved by default |
| Seasons | Cycles Christmas (Santa to level 14, reindeer, drops), Easter (all eggs), Halloween (spooky cookies), Valentine's (hearts), with a stall watchdog |
| Krumblor | Buys the egg, trains early levels, saves building sacrifices for right before ascension, sets an aura, pets the dragon |
| Sugar lumps | Harvests when ripe (never gambles), levels minigame buildings first, Farm to 9, then everything toward 10 |
| Grimoire | Casts when magic is full (Force the Hand of Fate during Frenzies) — spell-count achievements |
| Pantheon | Slots Mokalsium / Skruuia / Rigidel (no-downside setup) |
| Garden | Full breeding planner: unlocks all 34 seeds via mutation layouts (incl. Juicy Queenbeet rings and mold farming), then sacrifices the garden once for *Seedless to nay* |
| Stock market | Buys low / sells high around each good's resting value — profit achievements |
| Ascension | Ascends at +15% prestige (configurable), buys all heavenly upgrades cheapest-first, fills permanent upgrade slots, reincarnates |
| Challenge runs | Dedicates one run to **Neverclick** (no cookie clicks until 1M) and one to **Hardcore** (no upgrades until 1B, permanent slots vacated, Starter kitchen deferred) |
| One-shots | News ticker ×50 (*Tabloid addiction*), rename confirm (*What's in a name*), sell a grandma (*Just wrong*), stats-menu tiny cookie, fortune claiming, a single fast burst for *Uncanny clicker*, and an optional window-squash assist for *Cookie-dunker* |

## Time warp (game speed)

The HUD has a **Game speed** row (1× / 2× / 5× / 10× / 25× / 50×, or
`AutoBaker.set('timeWarp', N)` up to 100). It accelerates the page's clock, and the game's
own latency-compensation loop then runs proportionally more logic frames — so *everything*
speeds up together: CpS, buffs, wrinklers, Grimoire magic, garden growth, sugar lumps,
season timers.

Be aware of what this is and what it costs:

- **This is the one feature that is not "legitimate gameplay."** It doesn't conjure
  cookies from nothing and doesn't set the game's cheated flag, but it is a speedhack.
  It defaults to 1× (off). Everything else in AutoBaker works fine without it.
- **Clock drift**: while warped, saves are stamped with the accelerated (future) clock.
  Each hour at N× pushes your save's clock (N−1) hours ahead of reality. If you later play
  *without* the warp, offline earnings and sugar-lump/garden timers will stall until real
  time catches up to the save's clock. Turning the warp back on resumes normally.
- **Keep the tab foregrounded**: browsers throttle background timers to ~1/s, which caps
  the effective warp at about 5× regardless of the setting.
- Golden cookies also appear and expire N× faster in real terms; the script's reaction
  time is real-time, so at very high multipliers it will miss a larger share of them.

## Controls

- **HUD** (bottom-left, draggable, double-click the title to collapse): live achievement
  count, run mode, prestige gain, season/garden targets, and toggles for every subsystem.
- **Console**: `AutoBaker.remaining()` lists every normal achievement still missing;
  `AutoBaker.set('turbo', false)`, `AutoBaker.pause()`, `AutoBaker.resume()`.

Settings persist in `localStorage`; director state also piggybacks on the game's own save
via the official mod API.

## Honest expectations

- **100% takes a long time by design.** *Endless cycle* is 1,000 ascensions, *Black cat's
  paw* is 7,777 golden cookies, and garden seeds are RNG-gated. Even automated, a fresh
  save is looking at **weeks to months** of runtime. The script is stateful and patient —
  just leave the tab open.
- **Keep the tab in the foreground** (or in its own window). Browsers throttle background
  tabs to ~1 timer/second, which slows clicking and golden-cookie reactions. The game's own
  offline mechanics still apply when you close it.
- **Shadow achievements are intentionally out of scope.** They don't count toward milk, and
  several (*True Neverclick*, *Speed baking*, *Just plain lucky*) conflict with normal play
  or are pure luck. `popShiny` stays off by default for the same reason.
- Cookie Clicker updates occasionally rename internals. Every subsystem is feature-detected
  and sandboxed — if one breaks, it backs off and logs to the HUD instead of taking the
  script down.

## Legitimacy notes / gray areas

Three actions are performed via the game's internal functions rather than literal mouse
events, because the targets live on a `<canvas>` or behind confirmation dialogs — in each
case the code path is identical to the player action: wrinkler pops (gradual HP drain, same
as clicking one), confirmation prompts (clicks the actual **Confirm** button), and the
optional Cookie-dunker assist (temporarily shrinks the panel — the same trick players do by
resizing the window; toggle `dunkAssist` off if that feels like too much).

The optional time warp (above) is excluded from these claims entirely — it's an honest
speedhack, clearly labeled and off by default.

Personal-use automation of a single-player idle game; Cookie Clicker ships an official
modding API and this script registers through it.
