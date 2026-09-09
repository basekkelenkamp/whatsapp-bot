# WhatsApp Bot — Home Assistant add-on repository

A modular WhatsApp bot that runs as a Home Assistant add-on. It links to your
WhatsApp account as a companion device (the same mechanism as WhatsApp Web) and
responds to slash commands in your chats.

```
/plansesh 2     → posts a poll per week for the next 2 weeks
/help           → lists every command
/status         → is the bot alive, and for how long
```

## Install

This repository *is* an add-on repository, so Home Assistant can install and
update it for you. No SSH, no editing files with `vi` on the box.

1. In Home Assistant go to **Settings → Add-ons → Add-on Store**.
2. Top right **⋮ → Repositories**.
3. Paste `https://github.com/basekkelenkamp/whatsapp-bot` and press **Add**.
4. Close the dialog; **WhatsApp Bot** now appears in the store (reload the page
   if it does not). Open it and press **Install**.
5. Press **Start**, then open the **WhatsApp Bot** panel in the sidebar and scan
   the QR code with WhatsApp → *Settings → Linked devices → Link a device*.

**Updating** is then a `git push` here, followed by pressing **Check for
updates** in the add-on store and **Update** on the add-on. Bump `version:` in
[`whatsapp_bot/config.yaml`](whatsapp_bot/config.yaml) with every change you want
to be able to install — Home Assistant compares that string against the one it
already has and only offers an update when it differs.

<details>
<summary>Alternative: clone into <code>/addons/local</code></summary>

Useful while developing, since it skips the version bump:

Home Assistant expects each local add-on to be its own directory directly
under `/addons/local`, so clone the repo elsewhere and copy the add-on folder
into place:

```bash
ssh root@homeassistant.local
git clone https://github.com/basekkelenkamp/whatsapp-bot /root/whatsapp-bot-src
rm -rf /addons/local/whatsapp_bot
cp -r /root/whatsapp-bot-src/whatsapp_bot /addons/local/whatsapp_bot

# to update later:
cd /root/whatsapp-bot-src && git pull
rm -rf /addons/local/whatsapp_bot
cp -r /root/whatsapp-bot-src/whatsapp_bot /addons/local/whatsapp_bot
```

Your linked session lives in the add-on's `/data` volume, not in these files,
so replacing the folder does not force a new QR scan.

Then **Settings → Add-ons → Add-on Store → ⋮ → Check for updates**, open the
local add-on and press **Rebuild**.
</details>

## Configuration

Everything is set in the add-on's **Configuration** tab; see
[`whatsapp_bot/DOCS.md`](whatsapp_bot/DOCS.md) for what each option does.

## Adding a command

Drop one file in `whatsapp_bot/src/commands/` and it is picked up on the next
start — nothing else to wire up. See
[`whatsapp_bot/src/commands/README.md`](whatsapp_bot/src/commands/README.md).

## Repository layout

```
repository.yaml              marks this repo as a Home Assistant add-on repository
whatsapp_bot/                the add-on itself
├── config.yaml              add-on manifest: options, schema, ingress, watchdog
├── build.yaml               base image per architecture
├── Dockerfile               Alpine + Node + system Chromium
├── run.sh                   entrypoint (s6/bashio)
├── DOCS.md                  the "Documentation" tab in Home Assistant
└── src/
    ├── index.js             wiring and process-level error handling
    ├── config.js            reads /data/options.json, with defaults
    ├── logger.js            levelled logging
    ├── health-server.js     /health for the watchdog + the Ingress panel
    ├── core/
    │   ├── registry.js      finds and validates command modules
    │   └── dispatcher.js    parses messages, filters chats, runs commands
    ├── whatsapp/client.js   the whatsapp-web.js client and its recovery logic
    ├── commands/            ← one file per command
    └── util/dates.js
```
