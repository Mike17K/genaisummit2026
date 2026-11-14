# 14. Agent red-team swarm

**Direction:** Agents at the office. **Risk:** Medium.

- **Job:** point it at a web app or another agent; a swarm of attacker agents finds failures and writes regression tests for each.
- **Wow moment:** it breaks a deliberately flawed demo app live and shows the generated test that now catches it.
- **Why it scores:** ties to the "survives real users" lens that Quintessential judges with.
- **Risks:** abstract user unless the demo target is concrete; pick one persona, such as a startup shipping an AI support bot.

## Judge angle
- **Track:** Open
- **Twist to make it memorable:** Attack another team's agent in the room (with permission) and let the swarm find a real failure; show the regression test it wrote. This is the closest to the judges' 'survives real users' lens.
- **Production proof to show:** Reproducible findings, severity ranking, safe-by-design target only, tests committed.
