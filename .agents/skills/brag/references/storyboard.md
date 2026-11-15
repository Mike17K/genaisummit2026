# Storyboard review

The storyboard is where the user steers the video. Nothing gets animated until they approve it.

Each panel is **one real frame of the video**: the composition's own code rendered at the panel's key time, not a mockup. Laying out a settled frame takes seconds; a full render takes minutes. So the user approves stills first, and the approved panels then become the video's scenes.

## Files

```
<output-dir>/storyboard/
  storyboard.json          the current version (source of truth)
  storyboard-v1.json …     every version, archived when the next one is written
  panels/v1/p01.jpg …      panel images per version (panels.mjs writes them)
  feedback-v1.json …       what the user sent back for each version
  index.html               the review page (review-server.mjs writes it)
```

## `storyboard.json`

```json
{
  "kind": "storyboard",
  "version": 1,
  "project": "Horse Tinder",
  "title": "Swipe right on destiny",
  "type": "launch",
  "style": "product-native",
  "tone": "yc-parody",
  "format": "16:9",
  "duration": 20,
  "voice": false,
  "angle": "Played completely straight: a serious launch for a dating app for horses.",
  "changes": "",
  "panels": [
    {
      "id": "hook",
      "title": "Hook",
      "start": 0, "end": 2.5, "t": 1.8,
      "onscreen": "Dating apps were built for humans.\nObvious mistake.",
      "voiceover": "",
      "motion": "Line 1 types on; line 2 slams in on the beat.",
      "sound": "Low pad; soft impact on 'mistake'.",
      "transition": "Hard cut on the beat to the app's swipe screen.",
      "image": "panels/v1/p01.jpg"
    }
  ]
}
```

- `kind`: `storyboard` (the default), `look` (2–4 style frames for a custom look; see below), or `beats` (text-only panels, no images).
- `id`: stable across versions. A revised panel keeps its id; a new panel gets a new one. Panel numbers are display order only.
- `start`/`end`: the panel's time range. Panels are contiguous and the last `end` equals `duration`.
- `t`: the key time to render. Pick the moment the panel's content has **settled** (all its text in and readable), usually 60–80% of the way through.
- `onscreen`: the exact words that will be visible, one line per `\n`. This is the script the user edits. Leave it empty for no text.
- `voiceover`: the narration line for this panel, if voice is on.
- `motion`, `sound`, `transition`: one sentence each, in plain language.
- `changed` (v2+): `true` on panels that changed since the last version. `changeNote` says how in a few words ("shorter; shows export dialog instead").
- `changes` (v2+): a one-paragraph summary of what this version changed.

## The loop

1. **Write the key frames.** Build the composition far enough that every panel's settled frame is real:
   - product-native: each scene's layout at its settled state, with the real UI, copy, and fonts. Motion can be rough or missing.
   - drawn styles: each beat drawn with the style's kit (engine step 3: "Draw every beat in the approved look").
2. **Render the panels:**
   ```bash
   node <skill-dir>/tools/panels.mjs <composition-or-piece-dir> <output-dir>/storyboard/storyboard.json
   ```
   This renders every panel's `t` to `panels/v<version>/pNN.jpg` and writes the image paths back into the JSON. Add `--only hook,cta` to re-render only some panels and copy the rest from the previous version.
3. **Look at the panels yourself** before showing them. Check readability, overflow, contrast, and the type's must-haves (video-types.md), and fix anything broken. The user's attention is for creative calls, not bugs.
4. **Open the review page.** Run the server **in the background** (Bash `run_in_background: true`). It exits on its own when the user submits, which wakes you:
   ```bash
   node <skill-dir>/tools/review-server.mjs <output-dir>/storyboard
   ```
   Read the URL from its output (`REVIEW http://127.0.0.1:<port>/`). Open it in the built-in browser pane with `preview_start` (url) in Claude Code, or run `open <url>` in Gemini/Antigravity and Cursor. Tell the user in one or two lines: what's on the page, that they can edit the on-screen text directly, mark each panel ✓ / change / cut with notes, and press the button at the bottom. Then **stop and wait**. Don't start building.
5. **Read the feedback** when the server exits. It prints `FEEDBACK <path>`, pointing to `feedback-v<N>.json`:
   ```json
   {
     "version": 1, "decision": "revise", "overall": "Funnier. Less text.",
     "panels": [
       { "id": "hook", "n": 1, "verdict": "approve" },
       { "id": "swipe", "n": 2, "verdict": "change", "notes": "show the match animation", "onscreen": "It's a match.", "edited": ["onscreen"] },
       { "id": "stats", "n": 3, "verdict": "cut" },
       { "id": "cta", "n": 4, "verdict": "change", "duration": 4, "edited": ["duration"] }
     ]
   }
   ```
   If the user answers in chat instead ("3: cut it"), treat that the same way.
6. **Apply it:**
   - `approve`: don't touch the panel: same frame, same words. Approved means locked.
   - `onscreen` / `voiceover` edits: use the user's words **verbatim**. Don't polish them. If an edit breaks a rule (too long to read in the panel's time), keep the words, lengthen the panel, and say so.
   - `duration`: re-time the panel and shift the ones after it. If the total drifts from the target by more than ~10%, say so and offer where to trim.
   - `change` + notes: redesign that panel only.
   - `cut`: remove it and re-time the rest.
   - `overall`: applies to every panel *not* approved. If it clearly applies to approved panels too ("less text everywhere"), ask before touching them.
   - New panels the user asks for get new ids.
7. **Write the next version:** archive `storyboard.json` as `storyboard-v<N>.json`, bump `version`, and set `changed` / `changeNote` on every panel you touched plus `changes` at the top. Re-render only the changed panels (`--only`) and go back to step 4.
8. **Done when** `decision` is `approve` (every panel approved, no edits). Then say "Storyboard approved, building the video" and go on to the build.

The user can also say "skip the storyboard" or pass `--no-storyboard`. Then plan and build straight through, and tell them that's what happened.

## Other kinds of review

- **`beats` (text first):** for pieces over ~40s, or when the angle is uncertain, do one fast text-only round before drawing anything. Same JSON with `"kind": "beats"` and no `image` fields; the page shows each beat's description instead of a frame. Skip it for short pieces.
- **`look` (custom style):** when matching the user's references, the 2–4 matched style frames (or the compare sheets from `engine/tools/compare.mjs`) are the panels: `"kind": "look"`, one panel per frame, `onscreen` empty, `motion` describing what was matched. Approve the look, then do the storyboard in it.

## Revisions after delivery

When the user asks for changes after seeing the video ("make 3 faster", "cut the stats bit"), reopen the latest storyboard: apply the notes as a new version, re-render the changed panels, and offer the review page again if anything non-trivial changed. Then rebuild only the affected scenes.
