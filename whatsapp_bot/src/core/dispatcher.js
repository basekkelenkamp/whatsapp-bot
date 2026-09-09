'use strict';

const { createLogger } = require('../logger');
const { chatIdOf, listGroups } = require('../whatsapp/chats');

const log = createLogger('dispatch');

/** Remembered message ids, so a replayed message never runs a command twice. */
const HANDLED_LIMIT = 300;

class Dispatcher {
    constructor({ registry, config, service }) {
        this.registry = registry;
        this.config = config;
        this.service = service;
        this.handled = new Set();
    }

    /** Runs the init() hook of every command that has one. */
    async initCommands() {
        for (const command of this.registry.list()) {
            if (typeof command.init !== 'function') continue;
            try {
                await command.init(this._baseContext(command));
            } catch (err) {
                log.error(`init() of "${command.name}" failed: ${err.stack || err.message}`);
            }
        }
    }

    async handleMessage(msg, client) {
        if (msg.from === 'status@broadcast') return;

        const invocation = this.registry.parse(msg.body);
        if (!invocation) return;

        if (!this._listensTo(msg)) {
            log.debug(`Ignoring ${invocation.name} from ${msg.from} (listen_to=${this.config.listen_to})`);
            return;
        }
        if (!(await this._chatAllowed(msg, client))) {
            log.debug(`Ignoring ${invocation.name}: chat ${msg.from} is not in allowed_chats`);
            return;
        }

        const id = msg.id?._serialized;
        if (id) {
            if (this.handled.has(id)) return;
            this.handled.add(id);
            if (this.handled.size > HANDLED_LIMIT) {
                this.handled.delete(this.handled.values().next().value);
            }
        }

        const { command, args, rest, name } = invocation;
        const logger = log.child(command.name);
        logger.info(`Running ${name} (${args.length} arg(s)) in ${msg.from}`);

        const reply = async (text) => msg.reply(text);

        try {
            await command.execute({ ...this._baseContext(command), msg, client, args, rest, reply, logger });
            logger.debug('Done');
        } catch (err) {
            logger.error(`Failed: ${err.stack || err.message}`);
            // Never let a broken command take the bot down, and always tell the
            // chat something happened rather than going quiet.
            try {
                await msg.reply(`⚠️ ${this.registry.prefix}${command.name} failed: ${err.message}`);
            } catch (replyErr) {
                logger.error(`Could not report the failure: ${replyErr.message}`);
            }
        }
    }

    _baseContext(command) {
        return {
            config: this.config,
            commandConfig: this.config.forCommand(command.name),
            registry: this.registry,
            service: this.service,
            logger: log.child(command.name),
        };
    }

    _listensTo(msg) {
        if (this.config.listen_to === 'self') return msg.fromMe === true;
        if (this.config.listen_to === 'others') return msg.fromMe !== true;
        return true;
    }

    async _chatAllowed(msg, client) {
        const allowed = this.config.allowed_chats;
        if (!Array.isArray(allowed) || allowed.length === 0) return true;

        const chatId = chatIdOf(msg);
        if (allowed.includes(chatId)) return true;

        // Nothing matched by id, so the allowlist may be using group names.
        // Only groups can be named, so a direct message is already decided.
        if (!chatId?.endsWith('@g.us')) return false;

        try {
            const group = (await listGroups(client)).find((entry) => entry.id === chatId);
            return group ? allowed.includes(group.name) : false;
        } catch (err) {
            log.warn(`Could not check ${chatId} against allowed_chats: ${err.message}`);
            return false;
        }
    }
}

module.exports = { Dispatcher };
