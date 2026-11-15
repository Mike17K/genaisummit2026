# 10. "ForkFix" — 3am Incident Sidekick that Forks 3 `boxd` MicroVMs in `<200ms` to Race Code Fixes

- **One-Line Pitch (`0:00` Beat):** *"When a production alert fires at 3am, on-call engineers wake up groggy to dig through logs and test patches—ForkFix catches the crash, forks the running production VM into 3 parallel sandboxes in 200ms to race candidate fixes against the test suite, and calls you with the winning PR ready to merge."*
- **Primary Track & Judge:** **Voice & Enterprise Agents (`Wonderful`) / Open Track** + **Main Panel (`Quintessential`)**
- **Gates (G1 Action / G2 Scope / G3 29h Live Demo):** **PASS / PASS / PASS**
- **Prize Pools Unlocked:** Main (€8,500) + Oumi `Iris` ($1,750) + `boxd` showcase + Wonderful Track

## End-to-End Job & Live Wow Moment
1. **Trigger (`0:20` Wow Moment):** Presenter clicks "Break Checkout" on a live demo app on stage. A real Sentry/PagerDuty alert fires.
2. **Triage (`boxd run sentry` + `Oumi Iris`):** Pulls the stack trace and recent commits; `Iris` scores `severity`, `is_code_regression`, and `auto_remediation_safe`.
3. **Parallel VM Fork Race (`boxd` `<200ms` forking):**
   - Instead of one slow agent guessing once, ForkFix **clones the running `boxd` machine into 3 isolated VMs (`fork-a`, `fork-b`, `fork-c`) in `<200ms`**.
   - All 3 forks stream side-by-side on screen: Fork A tries a null guard (fails edge-case spec), Fork B reverts a migration (breaks build), Fork C fixes the currency parser (100% specs green in 14s).
4. **PR + Voice Wake-Up Call (`boxd run github` + `Voice`):** Opens the GitHub PR with the diff and test log from Fork C, then rings the engineer's phone on stage: *"Checkout 500 fixed in Fork C; all 48 tests pass; Iris merge-safety is 96%. Say 'Approve' to merge and deploy."*

## Benchmark Scorecard
| Pillar | Score | Breakdown & Rationale |
| :--- | :---: | :--- |
| **1. Track & Judge Alignment** | `28/30` | **1A (`13/15`):** Enterprise ops + voice approval. **1B (`15/15`):** Direct hit on Kostas Kopanidis's personal profile (*"My days: coding with agents, infra, DevOps. I deploy on Fridays"*). |
| **2. Sponsor Resource Stack** | `22/25` | `Iris` (`6/6`) · `boxd` (`5/5` — hero showcase of `<200ms` VM forking + `run`) · `treg` (`2/5`) · `Google` (`4/4`) · `Voice` (`5/5`) |
| **3. Usefulness** | `14/15` | Persona (`5/5`) · Multi-Step Job (`5/5`) · Tuesday Test (`4/5`) |
| **4. Craft & Demo Execution** | `15/15` | Show the Work (`5/5` — 3 live terminal forks racing) · Real Data (`5/5`) · Reliability (`5/5` — 100% controlled environment) |
| **5. Aura Points & Differentiation** | `13/15` | Live Wow Moment (`8/8` — 3 forked VMs racing + live phone merge) · Uncrowded Angle (`5/7`) |
| **TOTAL SCORE** | **`92/100`** | **Tier: S (Safest Live Stage Demo + Main Judge Favorite)** |
