# 4. On-call sidekick

**Direction:** Agents at the office. **Risk:** Low. **Status:** safest demo.

- **Job:** an alert fires; the agent reads logs, finds the guilty commit and opens the fix PR.
- **Wow moment:** break a demo service on stage and the PR appears.
- **Why it scores:** you control the whole setup, so the demo is reliable.
- **Risks:** developer-focused, may feel less fresh to judges.

## Judge angle
- **Track:** Open
- **Twist to make it memorable:** Kostas lives in infra and DevOps: break the system live and have the agent fix it while refusing the dangerous fix and explaining why. Add a 'deploy on Friday' safety gate as a joke that is also real.
- **Production proof to show:** Read-only by default, PR not push, rollback plan in the PR, runbook it learned from.
