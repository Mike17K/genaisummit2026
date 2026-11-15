# 9. "BrandPolis" — Autonomous Campaign Studio with an `Iris` Brand-Police Critic that Says "No"

- **One-Line Pitch (`0:00` Beat):** *"Marketing and design teams waste days adapting one product launch across 6 ad formats and policing off-brand AI slop—BrandPolis generates the entire multi-channel campaign and runs an autonomous Brand-Police agent that rejects and fixes anything off-brand before you ever see it."*
- **Primary Track & Judge:** **Content & Digital Art (`fal` — $1,500 Track Prize)** + **Main Panel (`Quintessential`)**
- **Gates (G1 Action / G2 Scope / G3 29h Live Demo):** **PASS / PASS / PASS**
- **Prize Pools Unlocked:** Main (€8,500) + `fal` Track ($1,500) + Oumi `Iris` ($1,750) + `treg` ($850)

## End-to-End Job & Live Wow Moment
1. **Input:** Paste any live company/product URL (e.g., a Greek brand or one of the sponsors' sites!) + a 1-sentence campaign brief.
2. **Brand DNA Extraction (`treg.to` + `boxd`):** Scrapes the live website for exact hex palette, typography, logo rules, tone of voice, and competitor positioning.
3. **Multi-Format Generation (`fal.ai`):** Generates hero visuals, vertical video story, product lifestyle shot, and banner formats in parallel.
4. **The "Agent That Says No" (`0:20` Wow Moment — `Oumi Iris` + `Gemini Vision`):**
   - Directly implements Kostas's slide #19 prompt (*"checked against the brand guide by an agent that says no"*).
   - On screen, the audience watches `Iris` score every generated asset (`palette_compliance`, `typography_legibility`, `brand_tone_match`, `legal_claim_safe`).
   - It **rejects** 2 assets in red (*"Contrast fail / wrong accent color: confidence 0.21"*), automatically rewrites the `fal` control prompt, and regenerates until all 4 formats turn green (`>0.90`).
5. **Output (`boxd run`):** Publishes the approved campaign pack directly to Slack (`boxd run slack`), Notion (`boxd run notion`), and Google Drive (`boxd run googledrive`).

## Benchmark Scorecard
| Pillar | Score | Breakdown & Rationale |
| :--- | :---: | :--- |
| **1. Track & Judge Alignment** | `28/30` | **1A (`15/15`):** Bullseye for `fal` ($1.5k track prize). **1B (`13/15`):** Literally built from Kostas's slide #19 prompt. |
| **2. Sponsor Resource Stack** | `24/25` | `Iris` (`6/6`) · `boxd` (`4/5`) · `treg` (`5/5`) · `Google` (`4/4`) · `fal` (`5/5`) |
| **3. Usefulness** | `14/15` | Persona (`5/5`) · Multi-Step Job (`4/5`) · Tuesday Test (`5/5`) |
| **4. Craft & Demo Execution** | `14/15` | Show the Work (`5/5`) · Real Data (`5/5` — can run on a judge's own website URL live!) · Reliability (`4/5`) |
| **5. Aura Points & Differentiation** | `13/15` | Live Wow Moment (`7/8` — watching the critic reject & self-heal visuals live) · Uncrowded Angle (`6/7`) |
| **TOTAL SCORE** | **`93/100`** | **Tier: S (Rank #1 in Content & Digital Art Track)** |
