# Game Show

A rhythm-game variety show in flat vector: toy mascots with thick ink outlines on candy-coloured stripes and sunbursts, every hit landing on one fixed tempo, judgement words when a round is won, a report card to finish.

## When to use
- Feature tours as "rounds" (one verb per round), year-in-review, release notes with a score at the end, playful launches and teasers for consumer, kids, food and game products.
- Walkthrough: works when each step can be a card dealt on a beat; a UI list becomes contestants entering one per beat.
- Not for serious, enterprise or luxury tones; not a microgame frenzy (no timers, no style change per round).

## Energy
`punchy`, going `hype` with a faster BPM. All starts sit on the beat grid (default 150 BPM, 0.4 s; `S.t(beat)` converts). Nothing fully still for more than a beat: sets scroll or spin forever.

## Palette
Ink `#1B1030` for every outline and hard shadow, cream `#FFF4D6` cards, white. Candy hues, one per set: yellow `#FFD23F`, orange `#FF8A3D`, red `#FF4D6D`, pink `#FF8FC7`, green `#3DDC84`, sky `#4CC9F0`, blue `#3A6BFF`, purple `#8B5CF6`. A set = one hue plus a lighter pattern of the same hue (stripes, sunburst, dots); neighbouring rounds never share a hue. No gradients, no blur, no soft shadow, no texture.

## Type
Lilita One (OFL, `assets/lilita.ttf`) for telops, judgement words, badges, numbers: uppercase, white with a heavy ink stroke (`-webkit-text-stroke` 14-26 px with `paint-order: stroke fill`) and a 12 px hard ink drop. Fredoka (OFL, `assets/fredoka.ttf`) weight 600-700 for card text. Keep telops to 2-4 words per line.

## Layout
- **9:16 (1080x1920):** scoreboard pill top centre (y 90), round sticker under it at the left, telops in the top 40 % (one line per beat, 124-134 px), the stage in the middle (mascot 520x760 or cards 940 wide, 190 high, 40 px gap), a darker floor band from y 1620 with an ink line, judgement burst bottom right or bottom centre.
- **16:9 (1920x1080):** telops top left, mascot or cards on the right, scoreboard top right, floor band from y 840.
- Outlines 8 px, round joins and caps, shadows 12 px offset.

## Motion grammar
- **Kit** (`BRAG.styles['game-show']`, every move `(el, at, opts) -> end`):
  - `t(beat)` beat to seconds; `hop` squash-and-stretch hops; `shout` arms up and mouth open on a hit; `mascot(el)` builds the toy fridge character (swap the body for any product icon).
  - `pop` / `deal` / `telop`: things enter one per beat with a back-ease; `telop` slams from 1.7x.
  - `judge(el, at, {fill, spin})` starburst plus a judgement word ("USE IT!", "NICE!", "A+"): the win moment of a round.
  - `score(el, to, at, {steps, dur})` scoreboard counting in whole steps; `set(el, start, end)` scrolls stripes / spins sunbursts / drifts dots; `confetti(parent, at, n)` hashed-position confetti.
  - `scenes(fx, list)` wrapper (see Notes).
- **Transitions:** `wipe-diag`, `push-left`, `zoom`, hard `cut` on a downbeat. Not blur, glitch, fade.
- **Structure:** a round = title telop, 3-4 beats of one repeated action (cards dealt, a number counted), a judgement burst. End with a report card and a stamp.

## Showing a real product UI
Make each UI element a contestant card: cream, 8 px ink outline, 12 px hard shadow, dealt in one per beat, with a coloured status tag (green fine, yellow soon, red urgent). Screens go on a card too (crop to the key area; no device frames). The product's result becomes the scoreboard number and the final report card.

## Do / don't
- Do keep one tempo for the whole film and put every pop, hop and stamp on it.
- Do give each round a new hue; mascots keep their own colour throughout.
- Don't use gradients, blur or soft shadows; don't let two hues share a set; don't slow reveals (no calm fades).

## Notes
`S.scenes(fx, list)` is a thin alias of `fx.scenes`. Demo: 6 s, 4 rounds.

Adapted from lemo-opuscar `game-show` by LemoLab (MIT). Rewritten for brag.
