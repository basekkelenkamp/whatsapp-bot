'use strict';

const path = require('path');

const qrcodeTerminal = require('qrcode-terminal');

const config = require('./config');
const { createLogger, setLevel } = require('./logger');
const { CommandRegistry } = require('./core/registry');
const { Dispatcher } = require('./core/dispatcher');
const { JobRunner } = require('./core/jobs');
const { WhatsAppService } = require('./whatsapp/client');
const { createHealthServer } = require('./health-server');

setLevel(config.log_level);
// Set before anything formats a date, so the bot agrees with the configured
// timezone even when the container was started without TZ.
process.env.TZ = config.timezone;
const log = createLogger('bot');

let server = null;
let service = null;
let jobs = null;
let shuttingDown = false;

async function shutdown(code = 0) {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info('Shutting down...');
    jobs?.stop();
    server?.close();
    await service?.stop().catch((err) => log.error(`Shutdown error: ${err.message}`));
    process.exit(code);
}

async function main() {
    log.info(`Starting WhatsApp bot — data=${config.dataDir} tz=${config.timezone} prefix="${config.command_prefix}"`);

    const registry = new CommandRegistry({ prefix: config.command_prefix });
    registry.loadDirectory(path.join(__dirname, 'commands'));
    log.info(`Loaded ${registry.list().length} command(s): ${registry.list().map((c) => c.name).join(', ')}`);

    let dispatcher;
    service = new WhatsAppService({
        config,
        onCommandMessage: (msg, client) => dispatcher.handleMessage(msg, client),
    });
    dispatcher = new Dispatcher({ registry, config, service });

    service.on('qr', (qr) => {
        log.warn('Not linked yet — scan this QR code (or open the add-on panel in Home Assistant):');
        qrcodeTerminal.generate(qr, { small: true });
    });

    service.on('fatal', async (reason) => {
        log.error(`Unrecoverable: ${reason}. Exiting so the Supervisor restarts the add-on.`);
        await shutdown(1);
    });

    jobs = new JobRunner({ config, service });
    jobs.loadDirectory(path.join(__dirname, 'jobs'));

    server = createHealthServer({ service, registry, jobs, port: config.healthPort });

    await dispatcher.initCommands();
    await service.start();
    jobs.start();

    process.on('SIGTERM', () => shutdown(0));
    process.on('SIGINT', () => shutdown(0));

    // Puppeteer throws asynchronously from places we cannot wrap (a closed
    // target, a dropped CDP socket). Those are recoverable, so treat them as a
    // reconnect signal instead of letting Node kill the process.
    process.on('unhandledRejection', (reason) => {
        const message = reason instanceof Error ? reason.stack || reason.message : String(reason);
        log.error(`Unhandled rejection: ${message}`);
        if (isBrowserFailure(message)) service.restart('unhandled browser rejection');
    });

    process.on('uncaughtException', (err) => {
        log.error(`Uncaught exception: ${err.stack || err.message}`);
        if (isBrowserFailure(err.message)) {
            service.restart('uncaught browser exception');
            return;
        }
        shutdown(1);
    });
}

const BROWSER_FAILURES = [
    'Protocol error',
    'Target closed',
    'Session closed',
    'Execution context was destroyed',
    'detached Frame',
    'Navigation failed',
    'net::ERR',
    'browser has disconnected',
];

function isBrowserFailure(message = '') {
    return BROWSER_FAILURES.some((needle) => message.includes(needle));
}

main().catch((err) => {
    log.error(`Fatal startup error: ${err.stack || err.message}`);
    process.exit(1);
});
