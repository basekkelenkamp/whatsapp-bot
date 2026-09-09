# Adding a command

Every `.js` file in this directory — and every subdirectory containing an
`index.js` — is loaded at startup and registered automatically. There is no
list to update anywhere else. A file whose name starts with `_` is skipped, so
`_helpers.js` is a safe place for shared code.

The smallest possible command:

```js
'use strict';

module.exports = {
    name: 'echo',
    description: 'Repeats what you said',
    async execute({ args, reply }) {
        await reply(args.join(' ') || 'you said nothing');
    },
};
```

Save it as `echo.js`, restart the add-on, and `/echo hello` works.

## The module shape

| Field | Required | Meaning |
| --- | --- | --- |
| `name` | yes | Invoked as `/<name>`. No whitespace. |
| `execute(ctx)` | yes | Async function that does the work. |
| `description` | no | One line, shown by `/help` and in the panel. |
| `usage` | no | e.g. `/plansesh [weeks]`. |
| `examples` | no | Array of strings, shown by `/help <command>`. |
| `aliases` | no | Extra names, e.g. `['sesh']`. |
| `hidden` | no | Keeps it out of `/help`. |
| `init(ctx)` | no | Runs once at startup — open a connection, refresh a token. |

A file may also export an **array** of these objects when one module naturally
provides several commands.

## The context object

`execute` receives one object:

| Key | What it is |
| --- | --- |
| `msg` | The whatsapp-web.js [`Message`](https://docs.wwebjs.dev/Message.html). `msg.reply()` accepts text, media and `Poll`s. |
| `client` | The underlying whatsapp-web.js `Client`, for anything `msg` cannot do. |
| `args` | Whitespace-split arguments after the command name. |
| `rest` | The same arguments as one unsplit string. |
| `reply(text)` | Shorthand for `msg.reply(text)`. |
| `config` | The whole add-on configuration (`config.timezone`, `config.locale`, …). |
| `commandConfig` | Just this command's options block — see below. |
| `logger` | Logger already tagged with the command name. |
| `registry` | All registered commands, used by `/help`. |
| `service` | The WhatsApp connection, for `service.getSnapshot()`. |

Throwing from `execute` is safe: the error is logged and reported in the chat,
and the bot keeps running.

## Giving a command its own options

Add a block named after the command to both `options` and `schema` in
`config.yaml`:

```yaml
options:
  gdrive:
    folder_id: ""
    max_results: 10
schema:
  gdrive:
    folder_id: str
    max_results: int(1,50)
```

It arrives as `commandConfig` in that command's context, and nowhere else.
Always spread it over your own defaults, so the command still works before
anyone has configured it:

```js
const settings = { max_results: 10, ...commandConfig };
```

## Commands that need more than one file

Use a directory:

```
commands/
└── gdrive/
    ├── index.js      ← exports the command (or an array of them)
    ├── client.js
    └── formatting.js
```

Anything needing credentials or a token cache should write under
`config.dataDir` (`/data`), which is the only directory that survives an add-on
rebuild or update.
