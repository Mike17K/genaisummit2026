# Caption News

A social news short that reads with the sound off: huge burned-in captions slammed in a chunk at a time with one keyword on a yellow block, a channel bug, source tags, lower-third straps, rolling numbers, and hard cuts on a 0.5 s grid (the TikTok / Reels news format).

## When to use
- Release notes and "what's new" shorts, teasers, data or stat-led launches, explainers with a turn ("you have X, here is the surprise"). Best for feeds, where sound is off.
- Walkthrough: fine when each UI beat is a "document" card that gets highlighted like evidence.
- Not for calm, cinematic or luxury tones, and not a TV news package (no anchor, ticker or crawl).

## Energy
`punchy` (default), up to `hype` for teasers. Cuts on 0.5 s multiples; a shot lasts 1-2 s; the caption is the shot. Never `calm`.

## Palette
| Token | Hex | Use |
|---|---|---|
| `--ink` | `#0B0D12` | ground, caption band, text on yellow |
| `--slate / --slate2` | `#181E2C` `#232B3F` | cards, dark footage fills |
| `--white` | `#FFFFFF` | captions, source chip |
| `--yellow` | `#FFD400` | the keyword block, bug, highlights, big numbers |
| `--red` | `#E5233B` | BREAKING tag and urgent badges only |
| `--mute` | `#AAB2C5` | sub-lines |

## Type
Anton (OFL, `assets/anton.ttf`): all captions, bug, badges, numbers, uppercase. Archivo (OFL, `assets/archivo.ttf`): UI text, source tags, notes (weight 700-800, small caps feel with tracking 0.06-0.12em). Captions 112-150 px, line height 1.02, hard 6 px black drop shadow, no wrapping inside a chunk.

## Layout
- **9:16 (1080x1920):** footage band on top (0-1340), caption stacked bottom-left (x 48, baseline block ends at y 1770). Bug at (48, 60), source tag under it (y 136), red tag top right, lower-third at y ~1030-1130 over the footage. Dark gradient from y ~700-1000 so the caption always reads. Safe area 48 px sides, 150 px bottom.
- **16:9 (1920x1080):** footage full bleed, caption one or two lines at x 120 from y ~850, English-style one line per chunk; bug top left (96, 52), source tag y 108, lower third x 120 y 742. Captions 96-120 px.
- Footage is anything: video, photo, the product UI as a "document" card, a giant number. Never pillar-boxed.

## Motion grammar
- **Kit** (`BRAG.styles['caption-news']`, all `(el, at, opts) -> end time`):
  - `caption(el, at, {gap, word})` chunks (`.ck`) slam in `gap` apart, words pop one by one, `.w.key` gets its yellow block swept on.
  - `bug`, `source` clip-slide the channel bug and source tag in (0.2-0.3 s).
  - `strap(el, at, {out})` lower third slides from the left edge.
  - `mark(el, at)` marker sweeps behind figures in a document card and the text flips to ink: "evidence before belief".
  - `roll(el, to, at)` number rolls up with a pulse on arrival; `callout` badge pops with a hard offset shadow; `punch` settles a new shot from 1.08x after a cut.
  - `scenes(fx, list)` wrapper around `fx.scenes` (see Notes).
- **fx used:** `fx.text(..., 'slam')` for a single logo or number, `tracking` for tags, `fx.shake` on strap arrival, `fx.drift` 1.05-1.08 so the footage never freezes, `fx.float` for badges.
- **Transitions:** hard `cut` (with `punch`) on the half-beat, `whip-*` at 0.25 s, `zoom`. No fades or iris.
- **Tempo:** a hook number or caption within 0.15 s of frame 0; a new fact per shot; every figure arrives with its source tag.

## Showing a real product UI
Treat it as a source document: a cream "doc" card with a header ("Fridge scan, today"), rows from the real UI, a SOURCE tag sliding in, and `mark()` highlighting the figures that matter one by one before the caption states them. For a screenshot, drop it full bleed in the footage band and push in with `drift`.

## Do / don't
- Do keep exactly one yellow keyword block per chunk set; keep captions to 2-3 chunks.
- Do cover every beat with caption or number so it reads muted.
- Don't centre the caption, add a ticker, crawl, anchor or studio. Don't use soft shadows or gradients on type. Don't use red for decoration.

## Notes
`S.scenes(fx, list)` is a thin alias of `fx.scenes`.

Adapted from lemo-opuscar `caption-news` by LemoLab (MIT). Rewritten for brag.
