'use strict';

const fs = require('fs');
const path = require('path');

const { createLogger } = require('../logger');

const log = createLogger('registry');

/**
 * A command module is a plain object:
 *
 *   module.exports = {
 *     name: 'plansesh',            // invoked as `/plansesh`
 *     aliases: ['sesh'],           // optional extra names
 *     description: 'One-liner shown by /help',
 *     usage: '/plansesh [weeks]',  // optional
 *     examples: ['/plansesh 2'],   // optional
 *     hidden: false,               // optional, hides it from /help
 *     async init(ctx) {},          // optional, runs once at startup
 *     async execute(ctx) {},       // required
 *   };
 *
 * Drop the file in src/commands/ (or a folder with an index.js) and it is
 * picked up automatically — no wiring anywhere else.
 */
class CommandRegistry {
    constructor({ prefix = '/' } = {}) {
        this.prefix = prefix;
        this.commands = new Map();
        this.byAlias = new Map();
    }

    register(command, source = '<inline>') {
        const problem = validate(command);
        if (problem) {
            log.error(`Ignoring command from ${source}: ${problem}`);
            return false;
        }
        const name = command.name.toLowerCase();
        if (this.byAlias.has(name)) {
            log.error(`Ignoring duplicate command "${name}" from ${source}`);
            return false;
        }

        this.commands.set(name, command);
        this.byAlias.set(name, command);
        for (const alias of command.aliases || []) {
            const key = String(alias).toLowerCase();
            if (this.byAlias.has(key)) {
                log.warn(`Alias "${key}" of "${name}" is already taken, skipping it`);
                continue;
            }
            this.byAlias.set(key, command);
        }
        log.debug(`Registered "${name}"${command.aliases?.length ? ` (aliases: ${command.aliases.join(', ')})` : ''}`);
        return true;
    }

    /** Loads every .js file and every subdirectory with an index.js. */
    loadDirectory(dir) {
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch (err) {
            log.error(`Cannot read command directory ${dir}: ${err.message}`);
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
                const loaded = require(modulePath);
                for (const command of Array.isArray(loaded) ? loaded : [loaded]) {
                    this.register(command, path.relative(dir, modulePath));
                }
            } catch (err) {
                // One broken module must never take the whole bot down.
                log.error(`Failed to load ${modulePath}: ${err.stack || err.message}`);
            }
        }
        return this;
    }

    list() {
        return [...this.commands.values()];
    }

    get(name) {
        return this.byAlias.get(String(name).toLowerCase()) || null;
    }

    /**
     * Turns a raw message body into a command invocation, or null when the
     * message is not addressed to the bot.
     */
    parse(body) {
        if (typeof body !== 'string') return null;
        const text = body.trim();
        if (!text.startsWith(this.prefix)) return null;

        const withoutPrefix = text.slice(this.prefix.length);
        const match = withoutPrefix.match(/^(\S+)\s*([\s\S]*)$/);
        if (!match) return null;

        const command = this.get(match[1]);
        if (!command) return null;

        const rest = match[2].trim();
        return { command, args: rest ? rest.split(/\s+/) : [], rest, name: match[1].toLowerCase() };
    }
}

function validate(command) {
    if (!command || typeof command !== 'object') return 'not an object';
    if (typeof command.name !== 'string' || !command.name.trim()) return 'missing "name"';
    if (/\s/.test(command.name)) return `name "${command.name}" contains whitespace`;
    if (typeof command.execute !== 'function') return `"${command.name}" has no execute()`;
    return null;
}

module.exports = { CommandRegistry };
