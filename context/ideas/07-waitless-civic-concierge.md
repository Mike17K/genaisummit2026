# 7. "Waitless" — Autonomous Voice + Browser Concierge for Bureaucracy & Back-Office Ops

- **One-Line Pitch (`0:00` Beat):** *"Every citizen and business owner in Greece loses hours trapped between `gov.gr` forms and KEP/utility phone queues—Waitless reads your documents, drives the web form inside a live cloud VM, and places the phone call for whatever can't be done online."*
- **Primary Track & Judge:** **Voice & Enterprise Agents (`Wonderful`)** + **Main Panel (`Quintessential`)**
- **Gates (G1 Action / G2 Scope / G3 29h Live Demo):** **PASS / PASS / PASS**
- **Prize Pools Unlocked:** Main (€8,500) + Wonderful Track + Oumi `Iris` ($1,750) + `treg` ($850) + `fal` ($1,500)

## End-to-End Job & Live Wow Moment
1. **Input:** User drops a real Greek ID / tax clearance PDF / utility bill and says: *"I need to renew my business permit / resolve this municipal charge."*
2. **Enrichment (`treg.to`):** Agent scrapes/looks up the exact required supporting documents, office hours, and portal URL.
3. **Guardrail & Routing (`Oumi Iris`):** Scores every extracted field and action in parallel (`pii_exposure_risk`, `can_complete_online`, `requires_phone_confirmation`) with live probability bars on screen.
4. **Parallel Execution (`0:20` Wow Moment):**
   - **Left pane (`boxd` VM):** Streams a live headless/remote browser inside an isolated Ubuntu VM auto-filling the multi-step portal form from the uploaded PDF.
   - **Right pane (`Wonderful` Voice):** Simultaneously dials the agency/back-office line on speaker, navigates the IVR/hold, confirms the missing stamped paper requirement, and books the slot.
5. **Output (`boxd run` + `fal`):** Creates the calendar appointment via `boxd run googlecalendar`, drafts the confirmation email via `boxd run gmail`, and generates a visual "What to Bring" pass via `fal`.

## Benchmark Scorecard
| Pillar | Score | Breakdown & Rationale |
| :--- | :---: | :--- |
| **1. Track & Judge Alignment** | `29/30` | **1A (`14/15`):** Combines enterprise/civic voice + back-office action for Wonderful. **1B (`15/15`):** Instant Athens resonance + Quintessential production lens. |
| **2. Sponsor Resource Stack** | `24/25` | `Iris` (`6/6`) · `boxd` (`5/5`) · `treg` (`4/5`) · `Google` (`4/4`) · `Wonderful/fal` (`5/5`) |
| **3. Usefulness** | `15/15` | Persona (`5/5`) · Multi-Step Job (`5/5`) · Tuesday Test (`5/5`) |
| **4. Craft & Demo Execution** | `13/15` | Show the Work (`5/5`) · Real Data (`5/5`) · Reliability (`3/5` — live voice + browser needs cached fallback) |
| **5. Aura Points & Differentiation** | `14/15` | Live Wow Moment (`8/8` — watching voice + browser work in tandem) · Uncrowded Angle (`6/7`) |
| **TOTAL SCORE** | **`95/100`** | **Tier: S (Rank #1 Overall)** |
