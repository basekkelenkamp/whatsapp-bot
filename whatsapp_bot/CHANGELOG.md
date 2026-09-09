# Changelog

## 2.1.1

### Fixed
- `Failed: r` when sending to a group by name, and `/chatid failed: r`. Both
  went through whatsapp-web.js's full chat model, which for every group awaits a
  live GroupMetadata update and rewrites each participant id through WhatsApp's
  LID migration helper. When any of that throws, the browser-side error arrives
  minified and useless, and `getChats()` loses every chat at once because it
  builds all the models in one `Promise.all`.
  - `/chatid` now reads the id straight off the message — no browser call.
  - Group listing reads `id` and `name` off the store directly, skipping any
    chat that misbehaves instead of failing wholesale.
  - The `allowed_chats` check no longer loads chat models either.
  - Sending was never affected: it asks for the raw chat, not the model.

## 2.1.0

### Added
- **Google Drive watcher.** Announces new files in a watched folder (and its
  subfolders) in a WhatsApp group, with uploader, date and a direct link.
  Authenticates as a Google service account, so nothing expires and there is no
  login flow to repeat. Off by default; see `DOCS.md`.
- **Background jobs.** Modules in `src/jobs/` run on a timer the same way
  `src/commands/` modules react to messages — see `src/jobs/README.md`.
- `/chatid` reports the current chat's id, and the panel has a **Groups** page
  listing every group with its id. Options that take a chat also accept a group
  name, so usually neither is needed.
- The panel shows each background job's state, last run and last error.

## 2.0.0

Restructured as a proper Home Assistant add-on repository, and rebuilt around a
command registry.

### Added
- Installable and updatable from the Home Assistant add-on store; no more
  editing files over SSH.
- Ingress panel showing connection state, the QR code, recent events, and
  buttons to reconnect or unlink.
- `/plansesh [weeks]` now takes any number of weeks (default 1, max 8), posting
  one poll per calendar week so every poll ends on a Sunday. The current week
  counts as the first, so a mid-week run opens with a short poll.
- `/help` and `/status` commands.
- Command modules are auto-loaded from `src/commands/`, each with its own
  options block — see `src/commands/README.md`.
- Configuration for prefix, timezone, locale, which messages to listen to, and
  an optional chat allowlist.

### Fixed
- The pairing is stored in `/data` and now survives restarts, rebuilds and
  updates instead of asking for a new QR scan.
- Silent deaths after a few days: Chromium crashes, half-open sockets, unhandled
  `disconnected` events and session takeovers are all detected and recovered
  from, with a Supervisor watchdog as the last resort.
