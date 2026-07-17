# Claude Password Manager (MCP)

A small, local **MCP server** that lets Claude Code use *your own* credentials in
a controlled, auditable way — the same idea as pointing Claude at a password
manager instead of leaving secrets lying in plaintext files.

Nothing here bypasses a safety boundary: MCP is exactly the supported extension
mechanism for giving an agent access to a resource you own. The value this adds
over dumping passwords into a `.env` is that access is **scoped, explicit, and
logged**:

- **Encrypted at rest** — credentials live in a single AES‑256‑GCM encrypted
  file. The key is derived from a master password (scrypt); the master password
  is never written to disk.
- **Listing never leaks secrets** — `list_credentials` returns only
  names/usernames/URLs/tags. Revealing a password is a separate `get_credential`
  call that requires a stated reason.
- **Every access is audited** — reads and writes append a line to `audit.log`
  (timestamp, action, entry name, and the reason). Passwords are never logged.
- **You stay in control** — Claude Code still prompts you to approve each tool
  call, and `CCPM_READONLY=1` disables all mutations.

## How it works

```
┌────────────┐   MCP (stdio/JSON-RPC)   ┌────────────────────┐   AES-256-GCM   ┌───────────┐
│ Claude Code │ ───────────────────────▶ │ password-manager    │ ──────────────▶ │ vault.json │
│  (client)   │ ◀─────────────────────── │ MCP server          │ ◀────────────── │ (encrypted)│
└────────────┘   tool calls / results   └────────────────────┘                 └───────────┘
                                                  │ appends
                                                  ▼
                                              audit.log
```

## Install

```bash
cd mcp/password-manager
npm install
npm run build      # compiles to dist/
npm test           # optional: runs the vault test suite
```

## 1. Create your vault and add credentials

Do this yourself in a terminal — Claude never needs your master password, only
the vault it unlocks. Pick a strong master password and store it in your OS
keychain / a password manager; **if you lose it, the vault cannot be recovered.**

```bash
# You'll be prompted for the master password (never echoed).
node dist/cli.js init

# Add credentials. Omit --pass to auto-generate a strong one.
node dist/cli.js add GitHub --user your-handle --url https://github.com --tags dev --pass 'your-token'
node dist/cli.js add Gmail  --user you@gmail.com --gen

node dist/cli.js list        # names only, no passwords
node dist/cli.js path        # where the vault + audit log live
```

By default the vault lives at
`~/.config/claude-password-manager/vault.json` (override with
`CCPM_VAULT_PATH`). It is created with `0600` permissions.

## 2. Register the server with Claude Code

Add it to your Claude Code MCP config (`~/.claude.json`, or a project
`.mcp.json`). Put the master password in the server's `env` block so the running
server can decrypt the vault — it stays on your machine and is not sent anywhere:

```jsonc
{
  "mcpServers": {
    "passwords": {
      "command": "node",
      "args": ["/absolute/path/to/printer/mcp/password-manager/dist/server.js"],
      "env": {
        "CCPM_MASTER_PASSWORD": "your-master-password"
        // optional:
        // "CCPM_VAULT_PATH": "/custom/path/vault.json",
        // "CCPM_READONLY": "1"
      }
    }
  }
}
```

Or register it with the CLI:

```bash
claude mcp add passwords \
  --env CCPM_MASTER_PASSWORD=your-master-password \
  -- node /absolute/path/to/printer/mcp/password-manager/dist/server.js
```

Restart Claude Code. Now you can ask things like *"get my GitHub token from the
password manager and configure the git remote"* and Claude will call
`get_credential` (and you'll approve it).

### Keeping the master password out of config

If you'd rather not store the master password in the MCP config file, launch the
client from a shell that already has `CCPM_MASTER_PASSWORD` exported (e.g. pulled
from your OS keychain), and drop the `env` block. The server reads the variable
from its own environment either way.

## Tools exposed

| Tool | Reveals password? | Mutates? | Purpose |
|------|-------------------|----------|---------|
| `vault_status` | no | no | Lock state, path, entry count |
| `list_credentials` | **no** | no | Browse entries by name/user/url/tag |
| `get_credential` | **yes** (logged, needs reason) | no | Retrieve one secret |
| `add_credential` | returns generated pw | yes | Store a new credential |
| `update_credential` | no | yes | Change fields of an entry |
| `delete_credential` | no | yes | Remove an entry |
| `generate_password` | n/a | no | Strong password, not stored |

## Managing the vault later (`pm-cli`)

```bash
node dist/cli.js list [query]
node dist/cli.js get <name|id>
node dist/cli.js update <name|id> --pass 'new-value'
node dist/cli.js rm <name|id>
node dist/cli.js passwd            # change master password (re-encrypts)
node dist/cli.js gen 32            # print a strong password
```

## Security notes & limitations

- The master password gates decryption. Anyone who can read both `vault.json`
  **and** the running server's environment (or your MCP config file) can read
  your secrets — protect that config file (`chmod 600`) and prefer the
  keychain-exported-env approach for shared machines.
- Secrets are decrypted in the server process's memory while it runs; this is a
  convenience tool, not a hardware security module.
- `audit.log` is your record of what the agent accessed — review it periodically.
- Losing the master password means losing the vault. There is no backdoor.
- The vault file and audit log are git-ignored and must never be committed.
