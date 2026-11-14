# 15. Agent front door for any business

**Direction:** Agents first (agents are the user or operator). **Risk:** Low. **Track:** Open.

- **Who the user is:** An AI agent shopping or booking on behalf of a person, and the small business it is trying to use (taverna, clinic, shop).
- **Job:** Point at a business website; the system generates an agent-readable front door (MCP server plus llms.txt) exposing hours, prices, availability and booking, so a visiting agent can transact instead of scraping.
- **Wow moment:** A personal agent books a table through the generated front door in seconds, while a scraper agent fails on the same site.
- **Sponsor stack:** Claude or Gemini to generate the server, boxd VM to host it, treg to enrich business data.
- **Risks:** Needs a real action behind it (booking) so it is not just docs; mock the booking backend.

## Judge angle
- **Twist:** Show a scraper agent and a front-door agent side by side with step counts and time.
- **Production proof to show:** Auth for the visiting agent, rate limits, logs of what each agent did.
