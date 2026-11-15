# living-screencast

The real product UI redrawn in HTML and filmed as one continuous take: a cursor (the user), a pixel mascot (the software), a camera that zooms to what matters, and a few information layers.

## When to use
- **Walkthrough** (best), feature demo, release notes, onboarding, "how it works" explainers for **software with a real UI**.
- Fine for launch when the UI is the story; poor for brand/story films with no screen.
- Recommended energy: **lively** (calm for a slow tour, punchy only if the mascot work stays readable).

## Palette
Use the **product's own colours**, light or dark theme exactly as it ships. Demo (Pantry, light theme):
| Role | Hex |
|---|---|
| Wallpaper | gradient `#D9E2F3` to `#F1E3DC` |
| App | background `#FBF8F2`, surface `#FFFFFF`, line `#E8E1D3`, ink `#1B2620` / `#5A655E` / `#98A09A` |
| Product accent | green `#2F7D4F`, soft `#DFF0E5`; warning `#E0662A`, soft `#FDE6D9` |
| Mascot | pink `#FF3D8B` (shade `#C41D63`): a saturated hue **no UI element uses**, so it finds the eye in every frame |
Overlays (chapter pill, key caps, caption) are neutral frosted glass; at most one accent, taken from the product.

## Type
The product's own type, or look-alikes: Inter for UI, JetBrains Mono for badges, hints and key caps (both bundled, OFL). Titles are **diegetic**: an empty-state heading, a window title, a notification. No floating title cards.

## Layout
- **9:16 (1080x1920):** the app window floats on the wallpaper (x 60, y 260, 960 x 1380, 36 px radius, soft shadow). Information layers live outside the window: chapter pill at y 96, key HUD at y ~1590, caption pill at y ~1700. Zoom never shows beyond the frame (the camera clamps).
- **16:9 (1920x1080):** window 1560 x 900 centred; chapter pill top-left, caption bottom-centre; the mascot has more horizontal runs, use `walk` along row tops and the nav bar.
- The camera is always zoom >= 1; one continuous take, cuts only under chapter transitions.

## Textures
None applied to the UI: crisp vector, real shadows, a soft vignette-free wallpaper. The only hard-edged texture is the mascot's **square-pixel grid** (9 px cells, `shape-rendering: crispEdges`); its position snaps to half-pixels so its motion feels stepped against the anti-aliased UI.

## Motion grammar
- 30 fps; the UI moves only with the product's own transitions (`fx.ui`/`fx.uiAnim` from `ui-motion.js`, instant where the app is instant); mascot stepped; cursor smoothed, never teleports.
- **Kit moves** (`BRAG.styles['living-screencast']`, all take `at`, return the end time):
  - `mascot(x, y)`, `eyes(at, 'n|l|r|u|d|h|s')`, `arms(at, up)`: the actor. **It stands on measured DOM**: pass edges from `rectOf(el)`, measured at the top of `BRAG.build` before tweens displace elements.
  - `walk(at, x)`: stepped run along a top edge, legs alternate, sprite flips.
  - `hop(at, x, y, {h})`: crouch, stretch, tuck, landing squash with a damped bounce and a dust puff.
  - `stomp(at)`, `heart(at)`: the software testing a button / being happy.
  - `cursor(at, path)`: the user; presses and rings on `click`.
  - `camera(at, {zoom, focus, dur})`: push-in / pull back, clamped to the frame.
  - `chapter(at, '01', 'Ask')`, `keys(at, ['Enter'])`, `caption(at, text, {hold})`: the only overlays.
- From `BRAG.fx`: `scenes` with `whip-left/up` for chapter transitions (the one place a blur is allowed), `type` for typed input (typing is the user, not UI motion). In-app headings, counts and lists appear the way the app shows them, often instantly. Keep `count`, `highlight` and `text` for the overlays.
- Cause and effect: every mascot action changes a real UI state (badge turns "in a recipe"), every user action is a cursor move, click or key on the HUD.

## Do / Don't
- Do use the product's real labels and data; keep the app under test changing.
- Do hold captions >= 1.8 s and keep them off the element being discussed and out from under the mascot.
- Do let the eyes look at what matters before each action.
- Don't invent flourishes the product doesn't have; don't blur readable text except on whips; don't use a hand or a second mascot.
- Don't put mascot and cursor on the same target at the same moment unless one causes the other.

## Showing a real product UI
This style *is* the product UI. Rebuild each screen in HTML (or paste real markup), keep real copy and states, and film it: type into real inputs, click real buttons, let the result appear in the same place, with the same animation, as in the app (`tools/ui-motion.mjs` → `fx.ui`). Use one chapter per feature (pill 01, 02, 03) joined with `whip` transitions; zoom into the region for each beat and pull back for summaries.

Adapted from lemo-opuscar `living-screencast` by LemoLab (MIT). Rewritten for brag.
