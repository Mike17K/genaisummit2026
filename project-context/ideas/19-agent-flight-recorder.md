# 19. Agent flight recorder and replay

**Direction:** Agents first (agents are the user or operator). **Risk:** Low. **Track:** Open.

- **Who the user is:** Anyone debugging why an agent did something expensive or wrong.
- **Job:** Records every step, tool call, token and cost of any agent run; replays it, highlights the first bad decision and suggests the fix.
- **Wow moment:** Drag a slider through an agent run, click the exact step where it went wrong and re-run from there with a different instruction.
- **Sponsor stack:** boxd for forking from a checkpoint, treg endpoints for realistic tool calls.
- **Risks:** Many observability tools exist; the replay-and-fork angle must be the demo.

## Judge angle
- **Twist:** The 'show the work' field rule, taken to its limit. Fits a judge who spends tokens and cares about cost.
- **Production proof to show:** Cost per run, determinism notes, redaction of secrets.
