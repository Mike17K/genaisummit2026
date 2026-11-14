# 23. Agent hiring marketplace (company agent meets candidate agent)

**Direction:** Agents first (agent-to-agent). **Risk:** Medium-High. **Track:** Voice & Enterprise (spoken interview) or Open. **Relevance:** treg is the hackathon hiring partner.

## One-line pitch
A hiring manager types a job description; the company's agent researches matching candidates, interviews each candidate's agent, and returns a ranked shortlist with transcripts and reasons. A human only steps in to request a real interview, and the candidate approves before any contact details are shared.

## User and job (deck rule: one user, one job)
- **User:** a hiring manager at a small company drowning in applicants.
- **Job:** screening and first-round interviews, the tedious multi-step work nobody wants to do twice.

## Flow
1. **Context upload.** Candidate uploads CV plus preferences and what they will not share. Company uploads job description and must-haves.
2. **Research and match.** Company agent searches the candidate pool and ranks matches, quoting evidence from each CV.
3. **Agent-to-agent interview.** Short interview: company agent asks, candidate agent answers only from the candidate's own context. Company agent checks claims against the CV and flags mismatches.
4. **Gate.** A decision model (Oumi Iris is the natural fit) passes or rejects against the criteria, with reasons.
5. **Human handoff.** If it passes, the company requests a real interview. Candidate approves before contact details are released.

## Wow moment
Paste a job description and a ranked, interviewed shortlist appears with a transcript and a one-paragraph recommendation per candidate. Then one candidate agent embellishes and the company agent catches the contradiction live, with the quoted line.

## Scope for 36 hours
- **Build for real:** matching with evidence, the interview loop, the pass/fail gate with reasons, the consent step.
- **Fake or hard-code:** candidate pool (15 to 20 synthetic profiles), scheduling and email (mock approval screen), login.
- **Data:** one real job description; CVs only from consenting teammates or synthetic data. No one else's personal data.

## Sponsor stack
- **Oumi Iris:** pass/fail decision (prize pool for top teams using Iris).
- **treg:** company and role enrichment.
- **boxd:** isolated VM per interview, fork a run to try different questions.
- **Wonderful (if selected):** spoken interview in Greek or English.
- **Google credits:** reasoning models.

## Judge angle
- **Twist:** the "ugly case" live: an embellishing candidate agent is caught by a quoted contradiction. Also show a withheld field to prove the consent model works.
- **Production proof:** explanations for every decision, human final call, audit log, consent before contact release, cost per screened candidate vs a human recruiter's time.
- **Why it can win:** real person and job, visible agent work, a trust layer (evidence, consent, fairness) that separates it from a plain CV-matching app.

## Risks
- **Bias and fairness:** automated rejection is high-risk (EU rules treat hiring AI as high-risk). Keep a human decision and explain every score.
- **Privacy:** the candidate agent reveals only what the candidate allowed.
- **Gaming:** candidate agents may exaggerate, so verify against the source CV.
- **Chicken-and-egg:** a marketplace needs both sides; demo with a seeded pool and say so.
- **Crowded space:** differentiate on the trust layer, not on matching.

## Demo script (3 minutes)
- **0:00** The person: "Maria runs a 12-person startup and has 200 CVs for one role. One sentence: she hates the first-round calls."
- **0:20** Live: paste the job description; watch research, matching, the agent interview and the gate stream on screen. One embellishment gets caught.
- **2:20** Show the candidate-consent step and the shortlist.
- **2:30** Next: voice interviews, real calendar booking, bias audit.
