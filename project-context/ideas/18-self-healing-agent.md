# 18. Self-healing agent

**Direction:** Agents first (agents are the user or operator). **Risk:** Medium. **Track:** Open.

- **Who the user is:** The developer or operator of an agent that keeps failing in production.
- **Job:** The agent watches its own failures, finds the pattern, proposes a fix to its prompts or tools, tests it against the failing cases and opens a PR.
- **Wow moment:** A deliberately flaky agent breaks live; the healer fixes it and the failure rate drops on screen.
- **Sponsor stack:** boxd fork to test fixes in parallel, Oumi decision model to gate whether the fix ships.
- **Risks:** Looks magical but must be real; use a small, reproducible failure set.

## Judge angle
- **Twist:** Kostas builds agent platforms; a measurable failure-rate drop is the money shot.
- **Production proof to show:** Regression suite that must pass, human approves the PR, rollback.
