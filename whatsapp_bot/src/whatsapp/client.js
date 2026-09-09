'use strict';

const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');

const { Client, LocalAuth } = require('whatsapp-web.js');

const { createLogger } = require('../logger');

const log = createLogger('whatsapp');

/** Backoff between reconnect attempts, in ms. Last value repeats. */
const BACKOFF_MS = [5_000, 15_000, 30_000, 60_000, 120_000, 300_000];

/** Consecutive failed health probes before we tear the client down. */
const UNHEALTHY_PROBES_BEFORE_RESTART = 3;

/** Give up and let the Supervisor restart the container after this many. */
const FAILED_STARTS_BEFORE_EXIT = 6;

const PROBE_TIMEOUT_MS = 30_000;

/** LocalAuth stores the Chromium profile in <sessionPath>/session-<id>. */
const SESSION_ID = 'bot';
const DESTROY_TIMEOUT_MS = 20_000;

const CHROMIUM_ARGS = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    // /dev/shm is tiny inside containers; without this Chromium dies under load.
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-features=site-per-process,Translate,BackForwardCache',
    // Headless Chrome throttles timers in "background" tabs, which stalls the
    // WhatsApp Web socket after a while. These keep it running at full speed.
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-ipc-flooding-protection',
];

/**
 * Owns the whatsapp-web.js client and keeps it alive.
 *
 * whatsapp-web.js drives a real Chromium, and that fails in ways an event
 * listener never hears about: the page crashes, the socket goes half-open,
 * another device takes the session over. So on top of the events we poll the
 * client's own state, and any failure path funnels into one recovery routine:
 * destroy everything, wait a backoff, build a brand new client.
 */
class WhatsAppService extends EventEmitter {
    constructor({ config, onCommandMessage }) {
        super();
        this.config = config;
        this.onCommandMessage = onCommandMessage;

        this.client = null;
        this.status = 'stopped';
        this.qr = null;
        this.info = null;
        this.startedAt = null;
        this.readyAt = null;
        this.lastError = null;
        this.lastHealthyAt = null;
        this.restarts = 0;
        this.failedStarts = 0;
        this.unhealthyProbes = 0;
        this.recentEvents = [];

        this.healthTimer = null;
        this.restartTimer = null;
        this.stopping = false;
        this.recovering = false;
    }

    // ---------------------------------------------------------------- lifecycle

    async start() {
        this.stopping = false;
        await this._spawnClient();
        this._startHealthLoop();
    }

    async stop() {
        this.stopping = true;
        clearTimeout(this.restartTimer);
        clearInterval(this.healthTimer);
        await this._destroyClient();
        this._setStatus('stopped');
    }

    /** Public entry point for "something is wrong, rebuild the client". */
    restart(reason) {
        this._recover(reason);
    }

    /**
     * Unlinks the device: wipes the stored pairing so the next start shows a
     * fresh QR code. Only needed when WhatsApp itself has logged us out.
     */
    async resetSession() {
        log.warn('Resetting session — a new QR scan will be required');
        this.stopping = true;
        clearTimeout(this.restartTimer);
        clearInterval(this.healthTimer);
        await this._destroyClient();
        fs.rmSync(this.config.sessionPath, { recursive: true, force: true });
        fs.mkdirSync(this.config.sessionPath, { recursive: true });
        this.restarts = 0;
        this.failedStarts = 0;
        await this.start();
    }

    // ------------------------------------------------------------------ client

    async _spawnClient() {
        this._setStatus('starting');
        this.qr = null;
        this.startedAt = Date.now();

        fs.mkdirSync(this.config.sessionPath, { recursive: true });
        fs.mkdirSync(this.config.cachePath, { recursive: true });
        this._clearStaleLocks();

        const client = new Client({
            authStrategy: new LocalAuth({
                clientId: SESSION_ID,
                // Persisted on /data, the only path that survives an add-on
                // restart, rebuild or update. This is what makes the pairing
                // outlive redeploys instead of asking for a QR every time.
                dataPath: this.config.sessionPath,
            }),
            webVersionCache: { type: 'local', path: this.config.cachePath },
            // If WhatsApp Web is opened somewhere else the session is stolen and
            // the bot silently goes deaf; take it back instead.
            takeoverOnConflict: true,
            takeoverTimeoutMs: 10_000,
            qrMaxRetries: 0,
            authTimeoutMs: 0,
            puppeteer: {
                headless: true,
                executablePath: this.config.chromiumPath,
                args: CHROMIUM_ARGS,
                // Chromium sometimes hangs on shutdown and orphans the profile
                // lock; a bounded timeout means we notice instead of hanging.
                protocolTimeout: 120_000,
            },
        });

        this.client = client;
        this._attachHandlers(client);

        try {
            await client.initialize();
            // initialize() resolves once Chromium is up and WhatsApp Web is
            // injected — well before 'ready'. Watch for crashes from here, so a
            // browser that dies while we are still waiting for a QR scan is
            // noticed too.
            this._watchBrowser(client);
            this.failedStarts = 0;
        } catch (err) {
            this._note(`initialize failed: ${err.message}`);
            log.error(`Failed to initialize client: ${err.stack || err.message}`);
            this.failedStarts += 1;
            this.lastError = err.message;
            this._setStatus('reconnecting');
            this._scheduleRestart('initialize failed');
        }
    }

    _attachHandlers(client) {
        const guard = (handler) => (...args) => {
            // A throw inside an event handler becomes an unhandled rejection and
            // kills the process; contain it here instead.
            Promise.resolve()
                .then(() => handler(...args))
                .catch((err) => log.error(`Handler error: ${err.stack || err.message}`));
        };

        client.on('qr', guard((qr) => {
            this.qr = qr;
            this._setStatus('qr');
            this._note('QR code received');
            this.emit('qr', qr);
        }));

        client.on('authenticated', guard(() => {
            this.qr = null;
            this._setStatus('authenticated');
            this._note('Authenticated');
        }));

        client.on('ready', guard(() => {
            this.qr = null;
            this.readyAt = Date.now();
            this.lastHealthyAt = Date.now();
            this.unhealthyProbes = 0;
            this.info = client.info ? { pushname: client.info.pushname, wid: client.info.wid?._serialized } : null;
            this._setStatus('ready');
            this._note('Connected and ready');
            log.info(`Connected as ${this.info?.pushname || 'unknown'} (${this.info?.wid || '?'})`);
        }));

        client.on('auth_failure', guard((msg) => {
            this.lastError = `auth_failure: ${msg}`;
            this._note(`Authentication failed: ${msg}`);
            log.error(`Authentication failed: ${msg}`);
            this._recover('auth_failure');
        }));

        client.on('disconnected', guard((reason) => {
            this.lastError = `disconnected: ${reason}`;
            this._note(`Disconnected: ${reason}`);
            log.warn(`Disconnected: ${reason}`);
            // LOGOUT means the phone unlinked us; whatsapp-web.js has already
            // dropped the session files, so the restart will surface a new QR.
            this._recover(`disconnected (${reason})`);
        }));

        client.on('change_state', guard((state) => {
            this._note(`State: ${state}`);
            log.debug(`State changed: ${state}`);
        }));

        client.on('loading_screen', guard((percent, message) => {
            log.debug(`Loading ${percent}% ${message}`);
        }));

        client.on('message_create', guard(async (msg) => {
            await this.onCommandMessage(msg, client);
        }));

    }

    /**
     * Puppeteer-level crash detection. When Chromium dies, whatsapp-web.js
     * emits nothing at all — the bot just goes quiet forever. These are the
     * only signals that fire.
     */
    _watchBrowser(client) {
        const browser = client.pupBrowser;
        if (browser && !browser.__botWatched) {
            browser.__botWatched = true;
            browser.on('disconnected', () => {
                if (this.stopping || this.client !== client) return;
                this._note('Chromium browser disconnected');
                log.error('Chromium browser disconnected');
                this._recover('browser disconnected');
            });
        }

        const page = client.pupPage;
        if (page && !page.__botWatched) {
            page.__botWatched = true;
            page.on('error', (err) => {
                if (this.stopping || this.client !== client) return;
                this._note(`Page crashed: ${err.message}`);
                log.error(`Page crashed: ${err.message}`);
                this._recover('page crashed');
            });
        }
    }

    async _destroyClient() {
        const client = this.client;
        this.client = null;
        if (!client) return;

        client.removeAllListeners();
        try {
            await withTimeout(client.destroy(), DESTROY_TIMEOUT_MS, 'destroy');
        } catch (err) {
            log.warn(`Clean shutdown failed (${err.message}); killing Chromium`);
            try {
                const proc = client.pupBrowser?.process();
                proc?.kill('SIGKILL');
            } catch (killErr) {
                log.warn(`Could not kill Chromium: ${killErr.message}`);
            }
        }
        this._clearStaleLocks();
    }

    /**
     * Chromium leaves SingletonLock behind whenever it is killed rather than
     * closed — a container that was force-stopped, a host that lost power, an
     * OOM kill. The next launch then fails forever with "the profile appears to
     * be in use by another Chromium process". Nothing else holds this profile,
     * so any lock we find at launch time is stale by definition.
     */
    _clearStaleLocks() {
        const profile = path.join(this.config.sessionPath, `session-${SESSION_ID}`);
        for (const lock of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
            try {
                fs.rmSync(path.join(profile, lock), { force: true, recursive: true });
            } catch (err) {
                log.warn(`Could not clear ${lock}: ${err.message}`);
            }
        }
    }

    // ------------------------------------------------------------------ health

    _startHealthLoop() {
        clearInterval(this.healthTimer);
        const intervalMs = Math.max(15, Number(this.config.health_check_interval) || 60) * 1000;
        this.healthTimer = setInterval(() => {
            this._probe().catch((err) => log.error(`Health probe crashed: ${err.message}`));
        }, intervalMs);
        this.healthTimer.unref?.();
    }

    async _probe() {
        if (this.stopping || this.recovering || !this.client) return;

        // Whatever the state, a dead browser means a dead bot.
        if (!this._browserAlive()) {
            this._note('Chromium is gone');
            this._recover('browser process is gone');
            return;
        }

        // While waiting for a QR scan getState() has nothing to report yet: the
        // client is working as intended, it just is not paired. The liveness
        // check above is the only thing that applies.
        if (this.status === 'qr' || this.status === 'starting') return;

        try {
            const state = await withTimeout(this.client.getState(), PROBE_TIMEOUT_MS, 'getState');
            if (state === 'CONNECTED') {
                this.unhealthyProbes = 0;
                this.lastHealthyAt = Date.now();
                log.trace('Health probe OK');
                return;
            }
            this._registerUnhealthy(`state is ${state}`);
        } catch (err) {
            this._registerUnhealthy(err.message);
        }
    }

    _browserAlive() {
        const browser = this.client?.pupBrowser;
        if (!browser) return true; // nothing launched yet
        // `connected` is a getter in Puppeteer 23+, isConnected() in older ones.
        const connected = typeof browser.connected === 'boolean' ? browser.connected : browser.isConnected?.();
        if (connected === false) return false;
        return this.client?.pupPage?.isClosed?.() !== true;
    }

    _registerUnhealthy(reason) {
        this.unhealthyProbes += 1;
        log.warn(`Health probe ${this.unhealthyProbes}/${UNHEALTHY_PROBES_BEFORE_RESTART} failed: ${reason}`);
        if (this.unhealthyProbes >= UNHEALTHY_PROBES_BEFORE_RESTART) {
            this._note(`Unhealthy: ${reason}`);
            this._recover(`health probe: ${reason}`);
        }
    }

    // ---------------------------------------------------------------- recovery

    _recover(reason) {
        if (this.stopping || this.recovering) return;
        this.recovering = true;
        this.unhealthyProbes = 0;
        this.restarts += 1;
        this._setStatus('reconnecting');
        log.warn(`Recovering client (attempt ${this.restarts}): ${reason}`);

        this._destroyClient()
            .catch((err) => log.error(`Teardown failed: ${err.message}`))
            .then(() => {
                this.recovering = false;
                this._scheduleRestart(reason);
            });
    }

    _scheduleRestart(reason) {
        if (this.stopping) return;

        if (this.failedStarts >= FAILED_STARTS_BEFORE_EXIT) {
            // Everything in-process has been tried. Exiting hands the problem to
            // the Supervisor watchdog, which restarts the whole container with a
            // clean Chromium and a clean Node heap.
            log.error(`Giving up after ${this.failedStarts} failed starts; exiting so the Supervisor restarts the add-on`);
            this.emit('fatal', reason);
            return;
        }

        const delay = BACKOFF_MS[Math.min(this.failedStarts, BACKOFF_MS.length - 1)];
        log.info(`Reconnecting in ${Math.round(delay / 1000)}s (${reason})`);
        clearTimeout(this.restartTimer);
        this.restartTimer = setTimeout(() => {
            this._spawnClient().catch((err) => {
                log.error(`Restart failed: ${err.stack || err.message}`);
                this.failedStarts += 1;
                this._scheduleRestart('restart threw');
            });
        }, delay);
    }

    // ------------------------------------------------------------------ status

    _setStatus(status) {
        if (this.status === status) return;
        this.status = status;
        this.emit('status', status);
    }

    _note(message) {
        this.recentEvents.unshift({ at: new Date().toISOString(), message });
        this.recentEvents.length = Math.min(this.recentEvents.length, 25);
    }

    getSnapshot() {
        return {
            status: this.status,
            healthy: ['ready', 'qr', 'starting', 'authenticated'].includes(this.status),
            connectedAs: this.info,
            qr: this.qr,
            startedAt: this.startedAt,
            readyAt: this.readyAt,
            lastHealthyAt: this.lastHealthyAt,
            restarts: this.restarts,
            failedStarts: this.failedStarts,
            lastError: this.lastError,
            events: this.recentEvents,
        };
    }
}

function withTimeout(promise, ms, label) {
    let timer;
    return Promise.race([
        Promise.resolve(promise).finally(() => clearTimeout(timer)),
        new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
        }),
    ]);
}

module.exports = { WhatsAppService, withTimeout };
