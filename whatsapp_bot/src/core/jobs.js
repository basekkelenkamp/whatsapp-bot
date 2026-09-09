'use strict';

const fs = require('fs');
const path = require('path');

const { createLogger } = require('../logger');
const { Store } = require('./store');
const { resolveChat } = require('../whatsapp/chats');

const log = createLogger('jobs');

/**
 * Background work that runs on a timer rather than in response to a message.
 *
 *   module.exports = {
 *     name: 'drive-watch',
 *     description: 'Announces new Drive files',
 *     configKey: 'gdrive',        // which options block it reads
 *     defaultInterval: 300,       // seconds, overridable per job config
 *     defaults: { ... },          // fallbacks for that options block
 *     async run(ctx) {},
 *   };
 *
 * Drop the file in src/jobs/ and it is picked up automatically. A job only runs
 * when its options block says `enabled: true`.
 */
class JobRunner {
    constructor({ config, service }) {
        this.config = config;
        this.service = service;
        this.jobs = [];
        this.timers = new Map();
        this.state = new Map();
        this.running = new Set();
    }

    loadDirectory(dir) {
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch (err) {
            log.error(`Cannot read job directory ${dir}: ${err.message}`);
            return this;
        }

        for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
            if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue;

            let modulePath;
            if (entry.isDirectory()) {
                modulePath = path.join(dir, entry.name, 'index.js');
                if (!fs.existsSync(modulePath)) continue;
            } else if (entry.isFile() && entry.name.endsWith('.js')) {
                modulePath = path.join(dir, entry.name);
            } else {
                continue;
            }

            try {
                const job = require(modulePath);
                if (!job?.name || typeof job.run !== 'function') {
                    log.error(`Ignoring ${entry.name}: a job needs a name and a run()`);
                    continue;
                }
                this.jobs.push(job);
                this.state.set(job.name, { enabled: false, lastRun: null, lastError: null, lastResult: null, runs: 0 });
                log.debug(`Registered job "${job.name}"`);
            } catch (err) {
                // A broken job must not stop the bot from answering commands.
                log.error(`Failed to load ${modulePath}: ${err.stack || err.message}`);
            }
        }
        return this;
    }

    start() {
        for (const job of this.jobs) {
            const settings = this._settings(job);
            const state = this.state.get(job.name);

            if (settings.enabled !== true) {
                log.info(`Job "${job.name}" is disabled`);
                continue;
            }

            state.enabled = true;
            const seconds = Math.max(30, Number(settings.poll_interval) || job.defaultInterval || 300);
            log.info(`Job "${job.name}" every ${seconds}s`);

            const timer = setInterval(() => this._tick(job), seconds * 1000);
            timer.unref?.();
            this.timers.set(job.name, timer);

            // Give the WhatsApp client a moment to reach `ready` before the
            // first run, so the very first notification can actually be sent.
            setTimeout(() => this._tick(job), 15_000).unref?.();
        }
    }

    stop() {
        for (const timer of this.timers.values()) clearInterval(timer);
        this.timers.clear();
    }

    async _tick(job) {
        const state = this.state.get(job.name);

        if (this.running.has(job.name)) {
            log.debug(`Skipping "${job.name}": the previous run is still going`);
            return;
        }
        // Nothing can be delivered while the client is down; the next tick will
        // pick up whatever accumulated in the meantime.
        if (this.service.status !== 'ready') {
            log.debug(`Skipping "${job.name}": WhatsApp is ${this.service.status}`);
            return;
        }

        this.running.add(job.name);
        const logger = log.child(job.name);
        try {
            const result = await job.run(this._context(job, logger));
            state.lastRun = Date.now();
            state.runs += 1;
            state.lastResult = result ?? null;
            if (state.lastError) {
                logger.info('Recovered');
                state.lastError = null;
            }
        } catch (err) {
            const message = err.message || String(err);
            state.lastRun = Date.now();
            // A misconfiguration repeats every tick; say it loudly once, then
            // keep it out of the log until something changes.
            if (state.lastError === message) {
                logger.debug(`Still failing: ${message}`);
            } else {
                logger.error(`Failed: ${err.stack || message}`);
                state.lastError = message;
            }
        } finally {
            this.running.delete(job.name);
        }
    }

    _settings(job) {
        return { ...(job.defaults || {}), ...this.config.forCommand(job.configKey || job.name) };
    }

    _context(job, logger) {
        const store = new Store(this.config.dataDir, `job-${job.name}`, job.stateDefaults || {});
        store.load();

        return {
            config: this.config,
            jobConfig: this._settings(job),
            logger,
            service: this.service,
            client: this.service.client,
            store,
            /** Sends a message to a chat id or a group name. */
            sendTo: async (target, body) => {
                const client = this.service.client;
                if (!client) throw new Error('WhatsApp client is not connected');
                const chatId = await resolveChat(client, target);
                return client.sendMessage(chatId, body);
            },
        };
    }

    getStatus() {
        return this.jobs.map((job) => ({
            name: job.name,
            description: job.description || '',
            ...this.state.get(job.name),
        }));
    }
}

module.exports = { JobRunner };
