# Adding a background job

A *command* reacts to a message. A *job* runs on a timer whether or not anyone
said anything — polling something, or posting on a schedule.

Every `.js` file in this directory (and every subdirectory with an `index.js`)
is loaded at startup, exactly like `../commands`. A job only runs if its options
block has `enabled: true`.

```js
'use strict';

module.exports = {
    name: 'weather-nag',
    description: 'Posts the forecast every morning',
    configKey: 'weather',     // which options block to read; defaults to `name`
    defaultInterval: 3600,    // seconds, if the config does not say
    defaults: { enabled: false, chat: '' },
    stateDefaults: { lastPosted: null },

    async run({ jobConfig, store, sendTo, logger }) {
        await sendTo(jobConfig.chat, 'Bring a coat.');
        store.data.lastPosted = Date.now();
        store.save();
        return { posted: 1 };   // shown in the add-on panel
    },
};
```

## The context object

| Key | What it is |
| --- | --- |
| `jobConfig` | This job's options block, over your `defaults`. |
| `store` | A JSON file under `/data` that survives restarts. Mutate `store.data`, then call `store.save()`. |
| `sendTo(chat, body)` | Sends a message. `chat` may be a chat id or a group name. |
| `logger` | Logger tagged with the job name. |
| `config` | The whole add-on configuration. |
| `service` | The WhatsApp connection. |
| `client` | The raw whatsapp-web.js client. |

## What the runner guarantees

- **It never runs two copies at once.** A run that overshoots its interval is
  skipped rather than stacked.
- **It skips ticks while WhatsApp is down**, so a job never tries to send into a
  disconnected client. The next tick picks up whatever accumulated.
- **A throw is contained.** It is logged, shown in the panel, and the job is
  tried again on the next tick. The same error repeating is logged once, not
  every tick — a misconfiguration will not bury the log.
- **The return value is shown in the panel**, so return something small and
  factual, like `{ newFiles: 2 }`.

## Only mark work done once it has actually been sent

`sendTo` can fail. Save "I have handled this" state *after* the send, never
before, so a failed send is retried on the next tick instead of being lost —
see how `drive-watch.js` updates its seen-list.
