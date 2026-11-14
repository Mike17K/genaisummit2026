# Sponsors and tools research

Researched 2026-11-14 from the sponsors' own sites plus web search. Marketing claims are marked as such. Gaps are listed at the end.

## treg (https://treg.to) — hiring partner, credits US$20/builder
- "OpenRouter for agent tools and data, pay per call." One key gives an agent 4,100+ endpoints across 127 providers (SEO, backlinks, social publishing, lead enrichment, ads, measurement; e.g. Semrush, Apollo, Hunter, SerpApi, DataForSEO).
- Pay per result (price shown before the call), $1.00 free to start, 0% extra fee, bring-your-own-key supported. Credentials are injected server-side, so the agent never holds provider keys. Open source (Apache 2.0).
- Agent setup is one line: tell the agent `set up treg - https://treg.to/llms.txt`.
- Shows measured success rate and speed per provider so an agent can pick on evidence.
- **Hackathon use:** gives an agent real-world tools (research a company, find a work email, check SEO, post to socials) without signing up to anything. Good for the "office" ideas (#2 inbox, #13 freelancer paperwork) and any prospecting or marketing agent.

## fal (https://fal.ai) — Content & Digital Art track, US$50/builder + US$1.5k track pool
- Generative media API: 1,000-1,500+ models (self-reported) for image, video, audio/TTS, 3D. Named in sources: FLUX, Veo 3, Kling, MiniMax Hailuo, Seedance 2.0.
- Async queue (submit, then poll), usage-based pricing, clients for Python, TypeScript, JavaScript, Swift. Image-to-video is a core use case.
- **Hackathon use:** #10 campaign in a box, storyboards, "visuals that listen", game assets. Video jobs are slow: queue them early and cache outputs.

## Oumi (https://oumi.ai) — credits: free early access to **Iris**; US$1,000/500/250 to top 3 teams using Iris
- Oumi: "The AI that builds your AI." Its agent FAiE (Frontier AI Engineer) automates evaluation, data curation, training, inference and continuous improvement of specialised models. Founders helped build PaLM at Google. Emphasises sovereignty (own weights, data, recipes), lineage, deploy anywhere, open-source compatible.
- Case studies claim a small fine-tuned model matching big models at much lower cost (invoice validation, text-to-SQL, clinical text) — vendor claims.
- Oumi publishes "decision model" content (Atlas pages for authorization, credit risk, deal risk, release quality, readmission prediction, etc.) and a blog on building a decision model.
- **Iris itself: not found.** The credits page calls it "Oumi's decision model". Ask a mentor at kickoff for the docs.
- **Hackathon use:** an agent whose gating step is a trained decision model (approve/reject/route) rather than a prompt. Fits #14 (severity ranking), #5 (trial eligibility), #2 (which emails need approval). Prize money here rewards teams that actually use Iris.

## boxd (https://boxd.sh) — credits EUR 50
- Persistent, hardware-isolated Linux VMs (KVM) for agents, with their own HTTPS domain. SSH access, Claude Code / Codex / OpenCode preinstalled. Machines persist and can be forked to run parallel attempts. Claims very fast boot (10-50 ms). Reported US$2M pre-seed.
- **Hackathon use:** run your agent's code safely, give it a real computer, fork to retry a failed run. Great for #4 on-call sidekick, #11 accessibility fixer, #14 red-team swarm (attacker agents in isolated VMs).

## Wonderful (https://wonderful.ai) — Voice & Enterprise track, selected teams only
- Enterprise agent platform for customer-facing AI across voice, chat and email; strong in multilingual / non-English markets. Telecom customers; Deepdub emotive TTS in its voice stack. Funding figures conflict across sources (large rounds reported at multi-billion valuation) — treat as unverified.
- **Hackathon use:** #3 phone call, #8 meeting to tickets, #1 bureaucracy navigator in Greek.

## Athens LifeTech Park (https://www.athenslifetechpark.com) — Biotech & AI track, host
- First biotech park in Greece / SE Europe, in Spata, Attica. Not-for-profit. Three pillars: biotech incubator and accelerator, preclinical CRO, translational research hub. Founder listed as Kleanthis Gabriel Xanthopoulos.
- **Hackathon use:** #5 trial matcher, #12 literature agent, lab notebook, instrument whisperer. The hosts are scientists and will judge with that lens: citations and safety matter.

## Quintessential (https://www.quintessential.gr) — sponsor, mentors, judges
- Athens digital product agency since 2018 (web, mobile, desktop). Services: product development, R&D, design, software, DevOps & cloud. Works with clients in Greece, North America, the UK, the UAE, Spain.
- Its AI arm is shown on the site as **Aletheia AI** (AI strategy, custom LLM implementation, process automation and agentic AI, team workshops). The kickoff deck calls the AI arm **Ostria** — likely a rename or separate product; **Conduit** is not found. Ask Kostas.
- Recent posts: "The Last Mile in agency work" (Feb 2026), "Designed and built in code: how we shipped the BeWell festival app" (28 Sep 2026), "Un-mastering DevOps: what three years and a few thousand agents did to my 2023 advice" (23 Oct 2026). Worth reading before pitching to them: it shows they care about agents in DevOps and shipping.
- Industries listed include healthcare, fintech, security, travel, e-mobility, GameTech.

## Google
- AI inference credits for everyone (Gemini family presumably; confirm at kickoff).

## Not found / to ask at kickoff
- Oumi **Iris** docs; Quintessential **Ostria** and **Conduit**; named judges; Wonderful credit amount.

## Idea combinations that use the sponsor stack
- **Red-team swarm:** attacker agents in boxd VMs, treg for external data, Oumi Iris to classify severity.
- **Campaign in a box:** fal for media, treg for audience/competitor data, guardian agent gate.
- **On-call sidekick:** boxd VM per incident, fork to try fixes, PR with tests.
- **Trial matcher:** Iris-style decision model for eligibility with quoted evidence (Biotech track).
- **Phone call agent:** Wonderful voice stack if you get selected, with treg for business lookup.
