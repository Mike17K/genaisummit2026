# 5. Trial matcher

**Direction:** Agents in the lab. **Risk:** Medium.

- **Job:** a patient summary goes in; the agent returns clinical trials the person could join, in plain language with citations.
- **Why it scores:** clear real user and a strong cited-source story.
- **Risks:** medical data needs care; use synthetic or consented data only.

## Judge angle
- **Track:** Biotech & AI (LifeTech Park)
- **Twist to make it memorable:** Run it on a tricky synthetic patient where the best trial is excluded by one subtle criterion, and show the agent catching it with the quoted line.
- **Production proof to show:** Citations to the exact eligibility text, synthetic data only, 'not medical advice' guardrail, confidence per match.
