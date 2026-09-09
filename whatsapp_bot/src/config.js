'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.WHATSAPP_BOT_DATA || path.join(__dirname, '..', 'data');
const OPTIONS_FILE = path.join(DATA_DIR, 'options.json');

const DEFAULTS = {
    log_level: 'info',
    command_prefix: '/',
    listen_to: 'all',
    allowed_chats: [],
    timezone: process.env.TZ || 'Europe/Amsterdam',
    locale: 'en-GB',
    health_check_interval: 60,
    plansesh: {
        question: 'when sesh?',
        default_weeks: 1,
        max_weeks: 8,
        allow_multiple_answers: true,
    },
};

function isPlainObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function merge(base, override) {
    const out = { ...base };
    for (const [key, value] of Object.entries(override || {})) {
        if (value === undefined || value === null) continue;
        out[key] = isPlainObject(value) && isPlainObject(base[key]) ? merge(base[key], value) : value;
    }
    return out;
}

/**
 * Home Assistant writes the add-on options the user set in the UI to
 * /data/options.json. Outside of Home Assistant we fall back to the defaults,
 * so `npm start` on a laptop works with no setup.
 */
function readAddonOptions() {
    try {
        return JSON.parse(fs.readFileSync(OPTIONS_FILE, 'utf8'));
    } catch (err) {
        if (err.code !== 'ENOENT') {
            console.error(`Could not read ${OPTIONS_FILE}: ${err.message}`);
        }
        return {};
    }
}

const options = merge(DEFAULTS, readAddonOptions());

const config = {
    ...options,
    dataDir: DATA_DIR,
    sessionPath: path.join(DATA_DIR, 'wwebjs_auth'),
    cachePath: path.join(DATA_DIR, 'wwebjs_cache'),
    healthPort: Number(process.env.HEALTH_PORT || 8099),
    chromiumPath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,

    /** Per-command settings, e.g. config.forCommand('plansesh').max_weeks */
    forCommand(name) {
        return isPlainObject(options[name]) ? options[name] : {};
    },
};

module.exports = config;
