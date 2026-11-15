# Style picker

**Published picker:** https://claude.ai/artifact/8Yv4okePq5vQstBnq86dfP  (private to Fil; open it with the Artifact tool, action `open`)
**Video fallback:** `style-reel.mp4` in this folder (22 styles, numbered 6×4 grid, 6 s loop).
**Single clips:** `clips/<name>.mp4`.

At intake, show one of these. Never rebuild during a /brag run.

## Refresh (only after a style is added or changed)
1. `node <skill-dir>/tools/style-preview.mjs <style dir> --workers 2` (writes that style's preview.mp4; new styles also get an entry in `<skill-dir>/styles.json`).
2. `node <skill-dir>/tools/style-reel.mjs <skill-dir>/assets/style-previews` (rebuilds style-reel.mp4, picker.html, clips/).
3. Republish to the SAME URL (from a new conversation, first Artifact `read` the URL; a publish to an unread artifact is refused): copy `picker.html` + `clips/` into the session scratchpad, then Artifact publish with `url` = the link above, `file_path` = the copied picker.html, `root` = that folder, and `files` mapping every `clips/<name>.mp4`.
