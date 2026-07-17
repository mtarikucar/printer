# Claude Password Manager (MCP)

A small, local **MCP server** that lets Claude Code use *your own* credentials in
a controlled, auditable way — the same idea as pointing Claude at a password
manager instead of leaving secrets lying in plaintext files. Runs on **Linux,
macOS and Windows**.

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

Each user's vault lives on **their own machine**; this package is just the code.
Sharing the package with other people does **not** share your passwords.

---

## For users — install & use (any OS)

> Requires [Node.js](https://nodejs.org) 18+. Once the package is published to
> npm (see the maintainer section below), no cloning or building is needed — `npx`
> fetches and runs it.

### 1. Create your vault and add credentials

Do this yourself in a terminal — Claude never needs your master password, only
the vault it unlocks. **If you lose the master password, the vault cannot be
recovered.**

```bash
# You'll be prompted for the master password (never echoed).
npx -y -p @mtarikucar/claude-password-manager pm-cli init

# Add credentials. Omit --pass to auto-generate a strong one.
npx -y -p @mtarikucar/claude-password-manager pm-cli add GitHub --user you --url https://github.com --pass 'your-token'
npx -y -p @mtarikucar/claude-password-manager pm-cli add Gmail  --user you@gmail.com --gen

npx -y -p @mtarikucar/claude-password-manager pm-cli list   # names only, no passwords
npx -y -p @mtarikucar/claude-password-manager pm-cli path   # where the vault + audit log live
```

The vault is created with `0600` permissions at:

| OS | Default vault path |
|----|--------------------|
| Linux | `~/.config/claude-password-manager/vault.json` |
| macOS | `~/.config/claude-password-manager/vault.json` |
| Windows | `%APPDATA%\claude-password-manager\vault.json` |

Override with the `CCPM_VAULT_PATH` env var.

### 2. Register the server with Claude Code

The master password is read from the server's own environment
(`CCPM_MASTER_PASSWORD`) — so the recommended, config-free approach is to export
it in the shell you launch Claude from and leave it out of any file:

```bash
# macOS / Linux
export CCPM_MASTER_PASSWORD='your-master-password'
claude mcp add passwords -- npx -y -p @mtarikucar/claude-password-manager claude-password-manager
claude   # launch from this same shell so the server inherits the variable
```

```powershell
# Windows (PowerShell)
$env:CCPM_MASTER_PASSWORD = 'your-master-password'
claude mcp add passwords -- npx -y -p @mtarikucar/claude-password-manager claude-password-manager
claude
```

Prefer not to type the password each time? Pull it from your OS keychain:

```bash
# macOS
security add-generic-password -a "$USER" -s ccpm-master -w 'your-master-password'   # once
export CCPM_MASTER_PASSWORD="$(security find-generic-password -a "$USER" -s ccpm-master -w)"

# Linux (libsecret)
secret-tool store --label='ccpm-master' service ccpm-master                          # once
export CCPM_MASTER_PASSWORD="$(secret-tool lookup service ccpm-master)"
```

If you'd rather store the password in the MCP config instead of the shell, add it
to the server's `env` block in `~/.claude.json` (or a project `.mcp.json`) and
`chmod 600` that file:

```jsonc
{
  "mcpServers": {
    "passwords": {
      "command": "npx",
      "args": ["-y", "-p", "@mtarikucar/claude-password-manager", "claude-password-manager"],
      "env": {
        "CCPM_MASTER_PASSWORD": "your-master-password"
        // optional: "CCPM_VAULT_PATH": "...", "CCPM_READONLY": "1"
      }
    }
  }
}
```

### 3. Verify & use

Restart Claude Code, then ask it to call `vault_status` — you should see
`state: unlocked`. Now prompts like *"get my GitHub token from the password
manager and set the git remote"* will trigger a `get_credential` call (which you
approve). Review `audit.log` any time to see what was accessed.

---

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

`pm-cli` mirrors these for terminal use: `init`, `add`, `list`, `get`,
`update`, `rm`, `passwd` (change master password), `gen`, `path`.

## Environment variables

| Variable | Purpose |
|----------|---------|
| `CCPM_MASTER_PASSWORD` | Unlocks the vault. Required for all secret access. |
| `CCPM_VAULT_PATH` | Override the vault file location. |
| `CCPM_READONLY=1` | Disable all mutating tools (read-only server). |

---

## For the maintainer — publishing so anyone can install it

The package is configured for a public, scoped npm release. To publish it so
every Claude user can `npx` it:

```bash
cd mcp/password-manager
npm install
npm login                 # your npm account; scope @mtarikucar must be yours
npm publish               # runs build + tests first (prepublishOnly), then publishes
```

Notes:

- The name is `@mtarikucar/claude-password-manager`. Change the `@mtarikucar`
  scope in `package.json` to your own npm username/org if different. A scoped
  name guarantees availability and is published publicly via
  `publishConfig.access: "public"`.
- Publishing is **public and effectively permanent** — anyone can install and
  read the source. It contains no secrets (vaults never leave users' machines),
  but treat the version/name as a long-lived public identifier.
- Bump `version` on every change; users get updates automatically because the
  install commands use `npx -y` (always the latest published version).

### Running from source instead of npm

If you don't want to publish, users can clone and build, then point Claude at the
local file:

```bash
git clone https://github.com/mtarikucar/printer.git
cd printer/mcp/password-manager && npm install && npm run build
claude mcp add passwords -- node "$(pwd)/dist/server.js"
```

---

## Security notes & limitations

- The master password gates decryption. Anyone who can read both `vault.json`
  **and** the running server's environment (or your MCP config file) can read
  your secrets — protect that config file and prefer the keychain-exported-env
  approach on shared machines.
- Secrets are decrypted in the server process's memory while it runs; this is a
  convenience tool, not a hardware security module.
- `audit.log` is your record of what the agent accessed — review it periodically.
- Losing the master password means losing the vault. There is no backdoor.
- The vault file and audit log are git-ignored and must never be committed.
