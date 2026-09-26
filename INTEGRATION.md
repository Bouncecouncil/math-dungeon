# Wiring Brain + Wallet into a game

Two drop-in scripts. Neither one needs changes to math-bank.js or story-bank.js.

## 1. Script tags

Put these after the bank scripts and before the game's own `<script>`:

```html
<script src="math-bank.js"></script>
<script src="story-bank.js"></script>
<script src="brain.js"></script>   <!-- after math-bank.js so it can hook it -->
<script src="wallet.js"></script>
```

If brain.js loads before math-bank.js, it still hooks MathBank on DOMContentLoaded. It does nothing to MathBank if the page has no MathBank.

## 2. Brain: usually zero lines

Once brain.js is on the page:

- A `MathBank.ask(tier, opts)` call **without** `only:` or `rawTier:` now draws from the Brain level's tier and families. `exclude`, `short`, `maxAns` and `minAns` still work. If the level can't fit under `maxAns`, the call falls back to the game's original request.
- `only:` and `rawTier:` calls are passed straight through, unchanged (spelling, reading, vocab, word-kind rooms).
- `MathBank.record(ok, kind)` still updates the bank's own adaptive tier, and it also feeds the Brain. Reading, spelling, vocab, science and logic kinds are counted but never move the math level.
- A small "BRAIN LEVEL UP" banner shows by itself. To turn it off, set `window.BRAIN_NO_TOAST = true` before brain.js loads.

Only needed if a game makes its own math and never calls `MathBank.record`:

```js
// after judging an answer
if (window.Brain) Brain.record(isRight, "mulTable");      // skill = family id, optional
// optional: show the level in the HUD
if (window.Brain) Brain.onChange(e => $("lvl").textContent = "🧠 " + e.level + " · " + e.name);
// optional: size its own numbers
const tier = window.Brain ? Brain.tierForMath() : 3;
```

To keep one call on the game's own tier (not the Brain level), pass `{ brain:false }` in its opts.

## 3. Wallet: Pattern A (recommended, about 6 lines)

Replace the local coin count with the shared wallet. Example for runedoor.html, which currently uses `START_COINS = 55`:

```js
// start(): was  if (!EMBED) S.coins = START_COINS;
if (!EMBED) S.coins = window.Wallet ? Wallet.coins() : START_COINS;

// spend(n): after S.coins = Math.max(0, S.coins - n);
if (!EMBED && window.Wallet) S.coins = (Wallet.spend(n, "rune hint"), Wallet.coins());

// earn(n) / reward: after S.coins += n;
if (!EMBED && window.Wallet) S.coins = Wallet.add(n, "rune door");

// keep the HUD honest if the shop or another tab changes the total
if (window.Wallet) Wallet.onChange(() => { if (!EMBED) { S.coins = Wallet.coins(); hud(); } });
```

## 4. Wallet: Pattern B (least editing, for games with many coin lines)

Leave every `S.coins += / -=` line alone and mirror the local count into the wallet:

```js
// start(): begin from the shared purse and re-anchor the sync
if (!EMBED && window.Wallet) { S.coins = Wallet.coins(); Wallet.resetSync(S.coins); }
// at the end of hud() / updateHUD() / syncHud(), which already runs after every coin change
if (!EMBED && window.Wallet) Wallet.syncFrom(S.coins);
```

`syncFrom` pushes the change since its last call into the wallet: a rise becomes `add` and a drop becomes `spend`. It never goes below 0.

## 5. Rules that stop double-counting

- **embed=1 pages never touch the wallet.** When runedoor, minecart or a helper runs inside the dungeon, the host game owns the coins (the child already posts `{type:"spend"}` to it). Every snippet above is guarded with `!EMBED`.
- **Free top-ups are not earnings.** math-dungeon-3d.html refills coins up to the price of a helper (`if(S.coins>=need)return 0; ... S.coins=need`). With Pattern B, that refill would create shared coins. Either skip `syncFrom` on that path, or call `Wallet.resetSync(S.coins)` right after the refill.
- The first-ever wallet starts at 55 coins, the same amount every game gave each run.

## 6. Showing what he bought

```js
const hat = window.Wallet && Wallet.equipped("hat");     // { id, name, emoji, colors, desc } or null
if (hat) Wallet.drawItem(ctx, hat.id, headX, headTopY, 48); // 2D canvas: hats sit on (x, y) = top of the head
const cart = Wallet.equipped("cart");  // 3D: cartMaterial.color.set(cart.colors[0])
const pet = Wallet.equipped("pet");    // draw pet.emoji, or Wallet.drawItem(ctx, pet.id, x, y, 40), beside the hero
const trail = Wallet.equipped("trail"); // spawn trail.emoji particles, tinted with trail.colors
```

Slots are `hat`, `cart`, `pet` and `trail`. There are 18 items; `Wallet.items()` lists them.

## 7. Storage keys

`mdBrain.v1` holds the level and the recent answers. `mdWallet.v1` holds coins, owned items and equipped items. Both use try/catch everywhere, so a private window still plays, it just doesn't save.
