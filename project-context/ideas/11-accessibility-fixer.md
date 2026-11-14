# 11. Accessibility fixer

**Direction:** Agents at the office. **Risk:** Low.

- **Job:** paste a URL; the agent browses the site, finds accessibility failures, and opens a PR with the fixes.
- **Wow moment:** the failing audit score goes green after a PR the agent wrote.
- **Why it scores:** measurable before/after, real code change, clear user (a small dev team facing compliance rules).
- **Risks:** needs a prepared demo repo; limit to a few fix types.

## Judge angle
- **Track:** Open
- **Twist to make it memorable:** Run it on a judge's or sponsor's real site; the audit score goes up after a PR the agent wrote, with a before/after screen-reader recording.
- **Production proof to show:** PR with tests, scoped diffs, does not touch what it can't verify, run on a clean branch.
