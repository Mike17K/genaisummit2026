# 22. Legacy-to-MCP converter

**Direction:** Agents first (agents are the user or operator). **Risk:** Medium. **Track:** Open / Voice & Enterprise.

- **Who the user is:** Developers and agents stuck behind websites, PDFs and forms that have no API.
- **Job:** Point it at a clunky site or form; it explores it, then generates a tested MCP server so any agent can use it reliably.
- **Wow moment:** Run on a real Greek public-service form: a minute later an agent fills it through the new tool with no browser clicking.
- **Sponsor stack:** boxd VM to explore and test, Claude or Gemini to generate, treg for comparison data.
- **Risks:** Websites change and block bots; cache a working run and pick a stable target.

## Judge angle
- **Twist:** Turns idea #1 into a platform. Judges who ship software will see a real market.
- **Production proof to show:** Generated tests, schema validation, error handling when the page changes.
