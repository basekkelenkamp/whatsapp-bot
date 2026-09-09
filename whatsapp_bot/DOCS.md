# WhatsApp Bot

Links to your WhatsApp account as a companion device and answers slash commands
in your chats.

## Setup

1. **Start** the add-on.
2. Open the **WhatsApp Bot** entry in the Home Assistant sidebar.
3. On your phone: WhatsApp → **Settings → Linked devices → Link a device**, and
   scan the QR code shown in the panel. (The code is also printed in the add-on
   **Log** tab if you prefer scanning from there.)
4. The panel switches to *ready*. Send `/help` in any chat to check.

The pairing is stored in the add-on's `/data` volume, which survives restarts,
rebuilds and updates. You should only ever need to scan once.

## Commands

| Command | What it does |
| --- | --- |
| `/plansesh [weeks]` | Posts one poll per calendar week for the next *weeks* weeks (default 1). Every poll ends on a Sunday, so run mid-week the first poll only holds the days left in this week — on a Wednesday, `/plansesh 2` posts Wed–Sun, then Mon–Sun. |
| `/help [command]` | Lists the commands, or explains one. |
| `/status` | Confirms the bot is alive and reports how long it has been connected. |

`/sesh` and `/ping` are aliases for `/plansesh` and `/status`.

## Options

| Option | Default | Meaning |
| --- | --- | --- |
| `log_level` | `info` | `trace`, `debug`, `info`, `warn` or `error`. |
| `command_prefix` | `/` | The character commands start with. |
| `listen_to` | `all` | `self` = only your own messages, `others` = only other people's, `all` = both. |
| `allowed_chats` | `[]` | Empty means every chat. Otherwise a list of chat names (e.g. `Sesh Crew`) or ids (`...@g.us`); commands in other chats are ignored. |
| `timezone` | `Europe/Amsterdam` | Used to decide which day "today" is. |
| `locale` | `en-GB` | Formats the poll's day labels, e.g. `Wed 10 Sept`. |
| `health_check_interval` | `60` | Seconds between internal health probes. |
| `plansesh.question` | `when sesh?` | Poll title. |
| `plansesh.default_weeks` | `1` | Used when `/plansesh` is sent without a number. |
| `plansesh.max_weeks` | `8` | Larger requests are refused with a message. Each week is one poll, so 8 means up to 8 polls. |
| `plansesh.allow_multiple_answers` | `true` | Whether people can tick more than one day. |

The current week counts as the first one. Weeks run Monday to Sunday, and a
week that would leave a single day (running `/plansesh 1` on a Sunday) reaches
into the next week, because WhatsApp rejects a poll with one option.

To find a chat id, set `log_level: debug` and send a command in that chat — the
log line names the chat it came from.

## Why bots like this stop working, and what this one does about it

The QR code itself is not the problem. It is a short-lived pairing code (it
rotates every ~20 seconds); once scanned, the *linked device session* is what
matters, and WhatsApp keeps that alive indefinitely. There is only one deadline:
**if your phone stays offline for about 14 days, WhatsApp unlinks every
companion device** — that is the one case where you genuinely have to scan
again.

Everything else that makes such a bot "die after a few days" is a software
failure that used to go unnoticed:

| Cause | What you saw | Fix in this version |
| --- | --- | --- |
| Session stored inside the container image | Worked, then wanted a QR again after a rebuild or update | Stored in `/data`, the one volume that survives restarts, rebuilds and updates |
| Chromium crashed or was killed for using too much memory | Add-on still "running", bot silently ignored everything | The browser and the page are watched directly; a crash triggers a full rebuild of the client |
| The websocket went half-open — no error, no event | Same silent death, no log line | Every `health_check_interval` seconds the bot asks the client for its own state, with a timeout; three bad probes in a row and it reconnects |
| `disconnected` fired and nothing handled it | One log line, then nothing forever | Reconnects with a backoff of 5s → 15s → 30s → 1m → 2m → 5m |
| WhatsApp Web opened elsewhere and stole the session | Bot went deaf until restarted | `takeoverOnConflict` — the bot takes the session back |
| Chromium killed hard, leaving a profile lock behind | Every restart failed with "profile appears to be in use" | Stale `Singleton*` locks are cleared before each launch |
| A Puppeteer error thrown outside any handler | Node exited, or worse, kept running broken | Browser-related rejections trigger a reconnect instead of a crash |
| Headless Chrome throttling background timers | Slowly went unresponsive over days | Launched with throttling and backgrounding disabled |
| Everything above failed anyway | — | After 6 failed starts the add-on exits, and the Supervisor **watchdog** restarts the container with a fresh Chromium and a fresh Node heap |

The result: the only manual step that should ever be needed again is re-scanning
after a genuine WhatsApp-side unlink.

## Troubleshooting

**The panel shows a QR code but I never unlinked anything.** WhatsApp logged the
device out — your phone was probably offline for two weeks, or you removed the
device from *Linked devices*. Scan again.

**It says `reconnecting` and stays there.** Check the **Log** tab. If Chromium
cannot start at all, the log says so; the most common cause is a host that is
out of memory.

**I want to start over.** Press **Unlink device** in the panel. That deletes the
stored pairing and shows a fresh QR code.

**Commands do nothing.** Check `listen_to` and `allowed_chats` in the
configuration, then set `log_level: debug` — every ignored command is logged
with the reason.
