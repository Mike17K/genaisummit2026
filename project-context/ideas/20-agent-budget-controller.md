# 20. Agent budget controller

**Direction:** Agents first (agents are the user or operator). **Risk:** Low. **Track:** Open.

- **Who the user is:** A team whose agent bills are surprising them.
- **Job:** Sits in front of any agent, routes each step to the cheapest model that can do it, caps spend, detects loops and stops them.
- **Wow moment:** Run the same task through a naive agent and the controlled one; show the same result at a fraction of the cost and a runaway loop killed.
- **Sponsor stack:** Google credits for models, Oumi-style small specialised model as the cheap route.
- **Risks:** Needs a fair benchmark so the saving is credible; use a fixed task set.

## Judge angle
- **Twist:** A live cost ticker next to a quality score. Cost discipline is a production signal.
- **Production proof to show:** Per-task budgets, loop detection, quality check on cheaper routes.
