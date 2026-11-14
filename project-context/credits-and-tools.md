# Credits, Claim Links & Partner Tools (Unlocked with `"pizza"`)

- **Sources:**
  - [sources/credits-claims.json](../sources/credits-claims.json) (unlocked via `POST /credits/claims` with password `pizza`)
  - [sources/google-cloud-setup-399bb5ee9b.pdf](../sources/google-cloud-setup-399bb5ee9b.pdf)
  - [sources/oumi-decision-models.html](../sources/oumi-decision-models.html) (`https://docs.oumi.ai/guides/decision-models`)
  - [sources/boxd-llms.txt](../sources/boxd-llms.txt) (`https://boxd.sh/llms.txt`)

---

## 1. Google AI & Google Cloud (`@gcplab.me`)
- **Credits:** AI inference (AI Studio, Gemini, Vertex/Model Garden, Cloud Run, GKE, BigQuery, Cloud SQL, AlloyDB, Firebase) + **Antigravity (Agent Platform Business Plan)**.
- **How to Claim:**
  - Organisers provide a temporary `@gcplab.me` login (`devstarXXXX@gcplab.me`).
  - Log into `https://console.cloud.google.com` in an incognito window or a separate Chrome profile and select the single assigned project.
  - **AI Studio (Gemini API Key):** Log into `https://ai.studio` with the `@gcplab.me` account → **Get API key** → **Import Projects** → select the assigned project (a Workshop API key on Billing Tier 1 is pre-provisioned).
  - **Antigravity (2.0 & CLI):** Log in with **Use business account** (`@gcplab.me`), enter your Google Cloud Project ID, and choose **Use Agent Platform instead** so your plan shows `Agent Platform` (not `Starter Quota`).
  - **Note:** All `@gcplab.me` accounts/projects are decommissioned at the end of the event—keep code in GitHub!

---

## 2. Wonderful (`wonderful.ai`) — Voice & Enterprise Agents Track
- **Track & Credits:** Voice & Enterprise Agents track sponsor & judge. Selected teams receive access/credits.
- **How to Claim / Register Team for Track:**
  - Fill out the track registration form: **`https://tally.so/r/yXXgox`**

---

## 3. Oumi (`oumi.ai`) — `Iris` Decision Model + Top-3 Prizes ($1,000 / $500 / $250)
- **Credits & Prizes:**
  - Free early access to **Iris** (Oumi's decision model) for everyone.
  - **US$1,000 (1st), US$500 (2nd), and US$250 (3rd)** in credits for the **top 3 teams using Iris**.
  - **Startup Program (Seed stage):** €15K in services + €10K in credits and mentorship (`labs@oumi.ai`).
- **How to Claim:**
  - Each teammate registers at: **`https://labs.oumi.ai/hackathon-village/genai-summit-athens-2026`**
  - Oumi emails an API key (`$OUMI_API_KEY`) and project ID.
- **How `Iris` Works (Easy to Add to Any Agent):**
  - Instead of generating tokens one by one, `Iris` is a fast **decision layer** that scores multiple-choice/boolean/scale questions in parallel (`outputTokens: 0`), returning calibrated probabilities and confidence scores.
  - **Best use cases inside our hackathon project:**
    - **Agent guardrails:** Check every action an agent proposes (e.g., before submitting a form, sending an email, or executing code) for safety/policy compliance.
    - **Routing & triage:** Classify incoming tickets/emails/documents by urgency, category, or tool route in one parallel call.
  - **API Endpoint (`POST https://inference.oumi.ai/v1/systemone`):**
    ```bash
    curl -X POST https://inference.oumi.ai/v1/systemone \
      -H "Content-Type: application/json" \
      -H "X-API-Key: $OUMI_API_KEY" \
      -d '{
        "model": "projects/{project_id}/models/iris-latest",
        "state": {
          "customer_tier": "enterprise",
          "ticket": "My checkout page shows a blank screen after I click Pay."
        },
        "questions": {
          "is_bug": {
            "type": "noul",
            "instructions": "Is the customer reporting a software defect?",
            "criteria": {
              "true": "Broken or unexpected product behavior.",
              "false": "Asking a question or requesting a feature."
            }
          },
          "team": {
            "type": "choice",
            "instructions": "Which team should own this ticket?",
            "criteria": {
              "account": "Login, permissions, or profile issues.",
              "frontend": "Rendering, layout, or browser compatibility issues.",
              "payments": "Checkout, billing, or payment processing issues."
            }
          },
          "urgency": {
            "type": "score",
            "instructions": "How urgent is this ticket?",
            "criteria": [
              "Can wait for the next release",
              "Should be fixed this week",
              "Blocking revenue right now"
            ]
          }
        }
      }'
    ```

---

## 4. fal (`fal.ai`) — Content & Digital Art Track + $1.5k Track Prize
- **Credits & Prizes:**
  - **US$50 per builder** for everyone.
  - **US$1,500 in fal credits** for winning the **Content & Digital Art** track.
- **How to Claim:**
  - Claim coupon at: **`https://fal.ai/coupon-claim/genai-summit-fal`**

---

## 5. treg (`treg.to`) — Unified Agent Tool & Data Router + Top-3 Prizes ($500 / $250 / $100)
- **What it is:** *"OpenRouter for agent tools and data, pay per call"* — one MCP server and one API key giving access to **4,100+ tools across 127 providers** (SEO, enrichment, ads, social, scraping data) at provider rates with no markup.
- **Credits & Prizes:**
  - **US$20 per builder** for everyone.
  - **US$500 (1st), US$250 (2nd), and US$100 (3rd)** in treg credits for the top three teams.
- **How to Claim:**
  - Sign up at **`https://treg.to`** using the **same email** you registered for the hackathon with (credits are automatically attached to that email).

---

## 6. boxd (`boxd.sh`) — Composable Cloud Linux VMs for Agents (€50 Credits)
- **Credits:** **€50** per participant (plus €30/$30 new-org credits).
- **Status on `/credits/claims`:** Currently displays `"Link coming shortly."` on the website API.
- **Details:** See [boxd.md](boxd.md) for full CLI/SDK and `run` integration documentation.
