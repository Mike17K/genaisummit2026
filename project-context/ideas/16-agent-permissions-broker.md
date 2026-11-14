# 16. Agent permissions broker

**Direction:** Agents first (agents are the user or operator). **Risk:** Medium. **Track:** Voice & Enterprise / Open.

- **Who the user is:** A team letting agents touch email, calendars and payments.
- **Job:** Gives each agent a short-lived, scoped credential and an approval step for risky actions; revokes in one click.
- **Wow moment:** An agent tries to send money or delete files; the broker blocks it, asks the human on their phone, then allows one scoped action.
- **Sponsor stack:** treg-style single key idea; boxd for isolation; Oumi Iris as the approve/escalate decision.
- **Risks:** Abstract unless the demo shows a vivid near-miss; stage a scary action.

## Judge angle
- **Twist:** A real 'agent goes rogue' moment stopped live. Judges from DevOps will love least-privilege.
- **Production proof to show:** Scopes, expiry, audit log, revoke, spend caps.
