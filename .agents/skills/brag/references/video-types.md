# Video types

The type sets the video's **shape** (which beats, in what order), its default length, and what the storyboard must prove. Pick the type at intake. Style and tone are separate choices layered on top.

Durations are defaults, not caps: the user's `--duration` wins. If the user asks for a length outside the range, say once what it costs ("40s is long for a teaser; it'll need a second highlight") and then do it.

| type | flag | default length | range | default format | best styles | voice |
|---|---|---|---|---|---|---|
| Launch promo | `launch` | 20s | 15–30s | 16:9 | product-native, isometric, riso | optional |
| Feature walkthrough | `walkthrough` | 45s | 30–90s | 16:9 | product-native | recommended |
| Explainer | `explainer` | 60s | 30–120s | 16:9 or 9:16 | crosshatch, isometric, math, sketchbook, product-native | recommended |
| Release notes | `release` | 30s | 15–45s | 16:9 or 1:1 | product-native, riso | optional |
| Social teaser | `teaser` | 10s | 6–15s | 9:16 | any | no |
| Story / history | `story` | 45s | 30–90s | 9:16 | cut-paper, pixel, sketchbook, crosshatch | optional |
| Custom | freeform description | ask | — | ask | — | ask |

If the user describes the video in words ("a demo of the new export flow", "a 'what's new in v3' clip"), map it to the nearest type and say which one you picked.

---

## Launch promo (`launch`)

Makes a stranger want it. Answers *what is it, who is it for, why now* in one viewing.

```
Hook (2–3s) → Reveal: name + one-line promise (2–4s) → 2–3 highlights, each the product doing one thing (3–5s each) → Punchline / CTA (2–4s)
```

- The hook is planned first. It's a tension, a surprising claim, or the product's own best line, not "Introducing…".
- Every highlight shows the product **in use** (entry → action → result), not a feature list.
- The end card says how to get it: URL, store, or command.
- Drawn styles: use engine format **F4 mission** (a goal and a helper, cut on the beat) or **F8 trailer** (claims → proof).

## Feature walkthrough (`walkthrough`)

Teaches one flow so a viewer could do it themselves. Clarity beats spectacle.

```
Context: the problem in one line (3–5s) → Where it lives: the entry point in the real UI (3–4s)
→ Step 1…n: action → visible result (4–8s each, 3–6 steps) → Payoff: the finished result (3–5s) → Where to find it / CTA (2–3s)
```

- One step per panel. Each panel names its step in a short on-screen label ("1  Pick a template").
- Show a cursor, clicks, typing, and selection states. Zoom or push in on the part of the UI that changes, and dim the rest.
- Use real UI copy, labels, and flows from the source, never invented ones.
- With a voice-over, one line per step, ≤ 3 words/s; the click lands on the verb.

## Explainer (`explainer`)

Makes a concept click. The viewer should be able to repeat the idea afterward.

```
Question / hook (3–5s) → The mental model in one picture (5–8s) → Mechanism: 3–5 steps, each building on the last (6–12s each)
→ "So what": why it matters (4–6s) → Close: the opening picture, changed (3–5s)
```

- One constant (a hero, a token, a shape) carries through every scene.
- A colour means one thing all the way through.
- Drawn styles: use engine format **F1 machine** (a token through stations) or **F6 process loop**; read `engine/grammar/FORMATS.md`.
- Facts on screen are web-checked and listed with sources in `brag-plan.md`.

## Release notes (`release`)

Shows what changed, fast. Assumes the viewer already knows the product.

```
Title card: "What's new in <version>" (2–3s) → One card per change: name + the change shown in the UI (4–6s each, 3–6 changes) → Outro: version, date, where to update (2–3s)
```

- Order the changes by how much a user will feel them, not by changelog order.
- Each card has the same layout so the rhythm reads as a list. Vary only the content.
- Pull the changes from the git log, the CHANGELOG, or the user's notes, and confirm the list at intake.

## Social teaser (`teaser`)

One idea, built for a feed where the sound is off and viewers can swipe away at any moment.

```
Hook (1–2s) → Payoff: the one thing (3–8s) → Logo / name / CTA (1–3s)
```

- Readable with the sound off: the on-screen words carry the whole message.
- Every frame should be good enough to post as a still. The poster frame matters most.
- Loops cleanly when it can: the last frame leads back into the first.

## Story / history (`story`)

An origin story, a history, or a "how we got here". Emotion and continuity.

```
The world before (4–6s) → 4–10 eras or turning points, joined by shape morphs (3–6s each) → Now (4–6s) → The end mirrors the start (2–4s)
```

- Drawn styles: use engine format **F2 chronology / morph chain** (proven) or **F5 fixed-hero journey**.
- A small hero that grows or gains something each era is the device that makes it readable.

## Custom

Ask the user what the viewer should feel and do at the end, then build a beat shape for it from the closest type above. Write the shape into `brag-plan.md` before planning panels.
