# Gen AI Summit Hackathon 2026 — Generic Idea Benchmarking System

A reusable, deterministic evaluation framework tailored specifically to the **Gen AI Summit Hackathon (Athens, 14–16 Nov 2026)**. Use this rubric to score any candidate idea out of **100 points**, check its **Pass/Fail Knock-Out Gates**, and calculate its **Prize Pool Eligibility**.

---

## Step 1: Pass / Fail Knock-Out Gates (Must Pass All 3)

Before scoring an idea, verify it passes the three hard constraints from the Kickoff Deck:

| Gate | Question | Pass Condition |
| :--- | :--- | :--- |
| **G1. Action vs. Chat** | *"The model answering is the boring part. The model acting is the new part."* | The agent executes multi-step actions via tools/APIs/VMs—not a Q&A chatbot or static wrapper. |
| **G2. Scope Rule** | *"One user. One job, end to end. One wow moment."* | A single named persona + a complete input-to-output workflow that finishes the job. |
| **G3. 29h & 3-Min Pitch** | Can the happy path run live in **130 seconds (`0:20–2:30`)** by **Sun 18:00**? | Core demo path has ≤ 1 external point of failure and a deterministic cached fallback (Plan B). |

---

## Step 2: The 100-Point Scoring Rubric

### Pillar 1 — Track & Judge Alignment (30 Points)
*Because the track partners sit on the judging panel and Quintessential judges the €8,500 main prize, ideas must align with who holds the scorecards.*

#### 1A. Primary Track Judge Fit (0–15 pts)
Score against the **one primary track** the idea enters:
- **Voice & Enterprise Agents (`Wonderful`):** Voice interaction, customer/back-office operations, multi-step enterprise workflows.
- **Biotech & AI (`Athens LifeTech Park`):** Wet-lab workflows, scientific literature synthesis, clinical/regulatory validation, biopharma R&D.
- **Content & Digital Art (`fal` — $1,500 Track Prize):** Generative image/video/audio/3D pipelines, creative studio automation, real-time visual systems.
- **Open Track (`Main Panel` — Hardware Bonus):** Physical-world agents, hardware/camera/sensor integration (+3 bonus pts within this pillar if physical hardware is used).

| Score | Anchor |
| :---: | :--- |
| **13–15** | **Bullseye:** Solves a flagship problem in the track partner's exact domain; uses their platform/paradigm as the centerpiece. |
| **9–12** | **Strong Fit:** Clearly belongs in the track, though adjacent to the partner's core product. |
| **5–8** | **Loose Fit:** Forced into the track category; could be pitched anywhere. |
| **0–4** | **No Track Fit:** Orphan idea with no natural track champion on the judging panel. |

#### 1B. Main Panel / Quintessential Lens (0–15 pts)
*Judged by **Kostas Kopanidis** & **Socrates Charisis** (Quintessential / Ostria — €5,000 / €2,500 / €1,000 main cash prizes) + AI-assisted submission review.*

| Sub-Criterion | Max | Anchor (Full Points) |
| :--- | :---: | :--- |
| **Production Realism** (*"Would it survive real users?"*) | **5** | Handles ugly edge cases, permissions, or human-in-the-loop approval diffs rather than a fragile toy happy-path. |
| **Agentic Architecture Depth** | **5** | Climbs the right rung of Kostas's ladder (*Prompt → Context → Tools → Agent → Multi-Agent*) without over-engineering. |
| **Athens / Summit Relevance** | **5** | Immediately relatable to the Athens / European tech, enterprise, or science audience in the room and at SNFCC. |

---

### Pillar 2 — Sponsor Resource & Prize-Stacking Score (25 Points)
*Rewards ideas where sponsor tools play a **load-bearing architectural role**—simultaneously unlocking side-prize pools and impressing sponsor mentors.*

| Sponsor Resource | Prize / Credit Unlocked | Max Pts | Scoring Criteria (0 = Unused · Half = Auxiliary · Max = Load-Bearing) |
| :--- | :--- | :---: | :--- |
| **Oumi `Iris`** *(Decision Model)* | **$1,000 / $500 / $250** (Top 3 teams using Iris) + €25k Seed Program | **6** | **6 pts:** `Iris` (`POST /v1/systemone`) acts as the live guardrail, policy judge, router, or confidence scorer with probabilities shown in UI.<br>**3 pts:** Used for basic background classification. |
| **`boxd`** *(Cloud Linux MicroVMs + `run` CLI)* | **€50 credits** | **5** | **5 pts:** Uses isolated VM execution, `<200ms` VM forking for parallel agent branches, or `run <integration>` (Gmail, Calendar, Docs, Sheets, GitHub, Sentry, Slack, etc.).<br>**2–3 pts:** Hosts the app/agent on a single `boxd` VM. |
| **`treg.to`** *(Unified MCP Tool & Data Router)* | **$500 / $250 / $100** (Top 3 teams) + $20/builder | **5** | **5 pts:** Uses `treg` to pull live enrichment, scraping, SEO, social, or vertical data as part of the agent's job.<br>**2–3 pts:** Uses 1 minor lookup call. |
| **Google AI / Cloud** (`@gcplab.me`) | **Gemini Tier-1 API + Cloud Run + Antigravity** | **4** | **4 pts:** Uses Gemini's native strengths (multimodal PDF/vision/audio, Live API, or huge context window) + GCP hosting.<br>**2 pts:** Standard text LLM call only. |
| **Track Partner Tech** (`fal` or `Wonderful`) | **`fal`: $1,500 Track Prize** + $50/builder<br>**`Wonderful`: Track Access** | **5** | **5 pts:** Deep integration of `fal` generative media pipelines or `Wonderful` enterprise voice/agent stack.<br>**2–3 pts:** Light asset generation or secondary voice output. |
| **Shoehorn Penalty** | — | **-2 / tool** | Deduct **2 points** for any sponsor tool bolted on with no real user or system value. |

---

### Pillar 3 — Official Criterion #1: Usefulness (15 Points)
*"Would a real person use this on Tuesday? Show us who they are and the job the agent takes off their hands."*

| Sub-Criterion | Max | Anchor (Full Points) |
| :--- | :---: | :--- |
| **3A. The `0:00` 1-Sentence Persona Pain** | **5** | Can state in one sentence who has this job and why it hurts (zero market-size fluff). |
| **3B. Tedious Multi-Step Job Elimination** | **5** | Takes a 30–120 minute multi-step chore nobody wants to do twice and compresses it into one review/approval step. |
| **3C. The "Tuesday Test"** | **5** | A real person or team could plug in their own data on Tuesday morning and get immediate value. |

---

### Pillar 4 — Official Criterion #2: Craft & Demo Execution (15 Points)
*"It runs live. It survives the ugly case. The details feel considered, not just polished."*

| Sub-Criterion | Max | Anchor (Full Points) |
| :--- | :---: | :--- |
| **4A. "Show the Work" Observability** | **5** | Streams live agent steps, tool calls, `Iris` confidence bars, diffs, or browser/VM actions on screen (*"Watching an agent do the job is half the magic"*). |
| **4B. Real Data (Zero `Lorem Ipsum`)** | **5** | Uses a real inbox, real PDF/ID, real scientific paper, real codebase, or real phone call during the demo. |
| **4C. Stage & 29-Hour Reliability** | **5** | Can be built end-to-end by Saturday 20:00 ("ugly end-to-end") and polished by Sunday 18:00 without flaky third-party dependencies. |

---

### Pillar 5 — Official Criterion #3: Aura Points & Differentiation (15 Points)
*"The thing we're still talking about on the way home. Taste, nerve, a surprise."*

| Sub-Criterion | Max | Anchor (Full Points) |
| :--- | :---: | :--- |
| **5A. The `0:20` Live "Wow Moment"** | **8** | A single visceral 60–90s live sequence where the presenter stops talking and the audience watches the agent do something surprising in real time. |
| **5B. Room Differentiation (Uncrowded Angle)** | **7** | Avoids generic "chat with PDF / generic email drafter" traps that 15 other teams will pitch; has a memorable hook, local twist, or visual/audio punch. |

---

## Step 3: Standard Scorecard Template (Copy-Paste for Every Idea)

```markdown
### [Idea Name]
- **One-Line Pitch (`0:00` Beat):** ...
- **Primary Track & Judge:** [Voice & Enterprise (Wonderful) | Biotech & AI (ALTP) | Content & Digital Art (fal) | Open Track (+Hardware)]
- **Gates (G1 Action / G2 Scope / G3 29h Live Demo):** PASS / FAIL
- **Prize Pools Unlocked:** Main (€8,500) + [Oumi Iris ($1,750)] + [treg ($850)] + [fal ($1,500)] + [Wonderful]

| Pillar | Score | Breakdown & Rationale |
| :--- | :---: | :--- |
| **1. Track & Judge Alignment** | `/30` | 1A Track Fit (`/15`) + 1B Main Panel/Quintessential (`/15`) |
| **2. Sponsor Resource Stack** | `/25` | Iris (`/6`) · boxd (`/5`) · treg (`/5`) · Google (`/4`) · fal/Wonderful (`/5`) |
| **3. Usefulness** | `/15` | Persona (`/5`) · Multi-Step Job (`/5`) · Tuesday Test (`/5`) |
| **4. Craft & Demo Execution** | `/15` | Show the Work (`/5`) · Real Data (`/5`) · Reliability (`/5`) |
| **5. Aura Points & Differentiation** | `/15` | Live Wow Moment (`/8`) · Uncrowded Angle (`/7`) |
| **TOTAL SCORE** | **`/100`** | **Tier:** [S: 90–100 · A: 80–89 · B: 70–79 · C: <70] |
```
