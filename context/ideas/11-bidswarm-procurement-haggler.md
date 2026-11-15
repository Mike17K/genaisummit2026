# 11. "BidSwarm" — Autonomous B2B Supplier Finder, Voice Haggler & Invoice Reconciler

- **One-Line Pitch (`0:00` Beat):** *"Small business owners—restaurants, clinics, contractors—waste every Friday afternoon calling 5 suppliers to check stock, haggle prices, and match messy PDF quotes against purchase orders."*
- **Primary Track & Judge:** **Voice & Enterprise Agents (`Wonderful`)** + **Main Panel (`Quintessential`)**
- **Gates (G1 Action / G2 Scope / G3 29h Live Demo):** **PASS / PASS / PASS**
- **Prize Pools Unlocked:** Main (€8,500) + Wonderful Track + Oumi `Iris` ($1,750) + `treg` ($850)

## End-to-End Job & Live Wow Moment
1. **Input:** Upload a messy handwritten/PDF stock reorder list or an overpriced supplier invoice.
2. **Supplier Discovery (`treg.to`):** Finds and enriches 5 verified local/EU wholesalers with phone numbers, catalogs, and reviews.
3. **Parallel Negotiation (`0:20` Wow Moment — `Wonderful` Voice + `boxd`):**
   - Places parallel outbound voice calls / web quote requests to suppliers to verify tomorrow-morning stock and negotiate a volume discount.
   - Streams the live transcript & price counter-offers on screen.
4. **Offer Scoring & Invoice Guardrail (`Oumi Iris`):** Evaluates each supplier's quote in parallel (`price_anomaly`, `delivery_sla_risk`, `po_match_confidence`) and flags any hidden surcharge.
5. **1-Click Approval Diff (`boxd run`):** Sends the winning purchase order via `boxd run gmail` and logs the reconciled line items in `boxd run googlesheets` / `quickbooks`.

## Benchmark Scorecard
| Pillar | Score | Breakdown & Rationale |
| :--- | :---: | :--- |
| **1. Track & Judge Alignment** | `28/30` | **1A (`15/15`):** Pure enterprise voice + back-office negotiation for Wonderful. **1B (`13/15`):** Combines "The phone call you avoid" + "Invoice reconciliation" from the Sponsor Deck. |
| **2. Sponsor Resource Stack** | `23/25` | `Iris` (`6/6`) · `boxd` (`5/5`) · `treg` (`5/5`) · `Google` (`3/4`) · `Wonderful` (`4/5`) |
| **3. Usefulness** | `15/15` | Persona (`5/5`) · Multi-Step Job (`5/5`) · Tuesday Test (`5/5`) |
| **4. Craft & Demo Execution** | `12/15` | Show the Work (`5/5`) · Real Data (`4/5`) · Reliability (`3/5` — multi-call latency needs tight staging) |
| **5. Aura Points & Differentiation** | `13/15` | Live Wow Moment (`7/8` — watching two supplier calls haggle prices down live) · Uncrowded Angle (`6/7`) |
| **TOTAL SCORE** | **`91/100`** | **Tier: S** |
