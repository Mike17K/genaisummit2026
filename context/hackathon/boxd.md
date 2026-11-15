# boxd (`boxd.sh`) — Hackathon Sponsor & Infra Context

- **Source:** [sources/boxd-llms.txt](../sources/boxd-llms.txt) (`https://boxd.sh/llms.txt`)
- **Hackathon Credits:** **€50** for every participant (claimed via `https://hackathon.polymath42.com/credits`).
- **What it is:** Composable computers for devs and AI agents — real hardware-isolated Linux microVMs (Ubuntu 24.04, 2 vCPU, 8 GiB RAM, 100 GiB disk default) in the cloud with SSH, automatic public HTTPS URLs (`<name>.boxd.sh`), instant forking (`<200ms`), and built-in SaaS integrations (`run` CLI & `@boxd/run` SDK).

---

## Why `boxd` is a Superpower for This Hackathon

1. **Built-in `run` CLI & `@boxd/run` TypeScript SDK (100+ Zero-Setup Integrations):**
   - Installed on every boxd machine. Connect an account once with `run auth <name>`, then run `run <name> <command>` from shell or via the typed `@boxd/run` SDK — **no MCP server setup or manual OAuth/API key plumbing required**.
   - **Key pre-built integrations for hackathon tracks:**
     - **Office / Inbox / Ops:** `gmail` (63 commands, 2 triggers), `googlecalendar` (49 commands, 7 triggers), `googledocs`, `googledrive`, `googlesheets`, `googlesuper` (467 commands, 48 triggers), `outlook` (300 commands, 5 triggers), `slack` / `slackbot`, `notion`, `linear`, `jira`, `hubspot`, `docusign`, `stripe`, `quickbooks`, `freshbooks`, `zendesk`, `intercom`, `calendly`, `cal`.
     - **Dev / On-Call Sidekick:** `github` (890 commands, 46 triggers), `sentry` (211 commands), `pagerduty` (368 commands), `datadog` (65 commands), `grafana` (11 commands), `vercel`, `cloudflare`, `supabase`, `neon`.
     - **Search & AI:** `openai`, `perplexityai`, `exa`, `hugging-face`.
2. **Instant Full-VM Forking (`<200ms`):**
   - Fork a running machine (memory, disk, running processes) in under 200ms.
   - Enables **parallel agent swarms** (e.g., spin up 5 forked VMs to test 5 candidate fixes or explore 5 branches in parallel, keep the winner).
3. **Computer Use / Remote Desktop & Browser Automation:**
   - Full unminimized Ubuntu 24.04 VM with its own kernel (KVM isolation) and automatic HTTPS URL.
   - Can run headless or headed browsers / computer-use agents on an isolated desktop and stream the live view or steps to the demo UI.
4. **Coding Agents Pre-Installed:**
   - `Claude Code`, `Codex`, and `OpenCode` come pre-installed and configured on every boxd machine.
5. **Hibernation & Wake-on-Request (`~156ms`):**
   - Machines keep their memory while sleeping and wake on an incoming HTTPS request or `boxd machine exec` with the app still running.

---

## Quick Start & Commands

### 1. Install CLI (and Agent Skills)
```bash
curl -fsSL https://boxd.sh/downloads/install.sh | sh -s -- --yes
export PATH="$HOME/.local/bin:$PATH"
```

### 2. Authenticate
```bash
boxd auth login
# Or for CI / scripts / backend servers:
boxd auth keys create hackathon-key
export BOXD_TOKEN=bxd_...
export BOXD_API_KEY=bxd_...
```

### 3. Spin Up & Use a Machine (CLI)
```bash
boxd machine new my-agent-vm
boxd machine exec my-agent-vm -- uname -a
boxd machine cp ./local-file my-agent-vm:remote-file
ssh my-agent-vm.boxd
```

### 4. Python & TypeScript SDKs
```bash
pip install boxd
npm install @boxd-sh/sdk
```

```python
from boxd import Boxd

boxd = Boxd()  # reads BOXD_API_KEY or BOXD_TOKEN
machine = boxd.machines.create("my-agent-vm")
boxd.machines.wait_until_ready(machine.id)
print(boxd.machines.exec(machine.id, "uname -a").stdout)
```
