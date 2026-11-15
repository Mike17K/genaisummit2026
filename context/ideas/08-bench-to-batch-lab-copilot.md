# 8. "GloveFree" (Bench-to-Batch) — Hands-Free Wet-Lab Protocol Logger, Literature Guardrail & Reagent Buyer

- **One-Line Pitch (`0:00` Beat):** *"Wet-lab scientists at places like Athens LifeTech Park have their hands in nitrile gloves at the bench, yet still spend an hour a day transcribing run logs, cross-checking 50 papers for concentrations, and ordering reagents."*
- **Primary Track & Judge:** **Biotech & AI (`Athens LifeTech Park`)** + **Main Panel (`Quintessential`)**
- **Gates (G1 Action / G2 Scope / G3 29h Live Demo):** **PASS / PASS / PASS**
- **Prize Pools Unlocked:** Main (€8,500) + ALTP Biotech Track + Oumi `Iris` ($1,750) + `treg` ($850)

## End-to-End Job & Live Wow Moment
1. **Input (`0:20` Wow Moment):** Presenter puts on blue lab gloves on stage, points a webcam at a sample rack/instrument readout, and speaks hands-free: *"Log Formulation Run #14: lipid nanoparticle mix at 12 mL/min, pH drifted to 6.1, turbidity looks high."*
2. **Multimodal Perception (`Google Gemini Live & Vision`):** Reads the vial barcode/instrument screen + transcribes the structured protocol step in real time.
3. **Real-Time Lab Guardrail (`Oumi Iris`):** Instantly scores the spoken step against the SOP (`protocol_deviation: 0.94`, `contamination_risk: 0.12`, `reagent_stock_critical: 0.89`) and flashes a red deviation alert before the scientist ruins the batch.
4. **Literature Grounding (`treg.to` + `Gemini`):** Queries 50 papers to explain *why* pH 6.1 causes aggregation and proposes the exact buffer adjustment, citing the exact paper, page, and figure.
5. **End-to-End Action (`boxd`):** Executes a Python curve-fitting script in a `boxd` VM, writes the compliant batch record into Google Docs/Sheets (`boxd run googledocs` / `googlesheets`), and drafts tomorrow's Sigma-Aldrich/Thermo reagent order in Gmail (`boxd run gmail`).

## Benchmark Scorecard
| Pillar | Score | Breakdown & Rationale |
| :--- | :---: | :--- |
| **1. Track & Judge Alignment** | `29/30` | **1A (`15/15`):** Tailored directly to the hosts at Athens LifeTech Park (wet-lab & formulation R&D). **1B (`14/15`):** Real enterprise R&D workflow. |
| **2. Sponsor Resource Stack** | `22/25` | `Iris` (`6/6`) · `boxd` (`5/5`) · `treg` (`4/5`) · `Google` (`4/4`) · `fal/Voice` (`3/5`) |
| **3. Usefulness** | `14/15` | Persona (`5/5`) · Multi-Step Job (`5/5`) · Tuesday Test (`4/5`) |
| **4. Craft & Demo Execution** | `14/15` | Show the Work (`5/5`) · Real Data (`5/5`) · Reliability (`4/5`) |
| **5. Aura Points & Differentiation** | `14/15` | Live Wow Moment (`7/8` — blue lab gloves on stage + live anomaly catch) · Uncrowded Angle (`7/7` — far fewer teams build for Biotech) |
| **TOTAL SCORE** | **`93/100`** | **Tier: S (Rank #1 in Biotech & AI Track)** |
