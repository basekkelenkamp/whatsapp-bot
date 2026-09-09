'use strict';

const { createLogger } = require('../logger');

const log = createLogger('chats');

/** Chat ids look like 1203...@g.us for groups and 316...@c.us for people. */
const CHAT_ID = /@(g\.us|c\.us|broadcast)$/;

// getChats() walks the whole chat list, so remember what a name resolved to.
const cache = new Map();

/**
 * Accepts a chat id or a group name and returns a chat id. Configuring a
 * notification target by name is far friendlier than asking someone to dig a
 * 20-digit id out of WhatsApp.
 */
async function resolveChat(client, target) {
    const wanted = String(target || '').trim();
    if (!wanted) throw new Error('No chat configured');
    if (CHAT_ID.test(wanted)) return wanted;

    const cached = cache.get(wanted.toLowerCase());
    if (cached) return cached;

    const groups = await listGroups(client);
    const needle = wanted.toLowerCase();

    const matches = groups.filter((group) => group.name.toLowerCase() === needle);
    if (matches.length === 0) {
        matches.push(...groups.filter((group) => group.name.toLowerCase().includes(needle)));
    }

    if (matches.length === 0) {
        throw new Error(`No group called "${wanted}". Known groups: ${groups.map((g) => g.name).join(', ') || 'none'}`);
    }
    if (matches.length > 1) {
        throw new Error(`"${wanted}" matches ${matches.length} groups: ${matches.map((g) => g.name).join(', ')}. Use the id instead.`);
    }

    log.info(`Resolved "${wanted}" to ${matches[0].id}`);
    cache.set(needle, matches[0].id);
    return matches[0].id;
}

/** Every group the linked account is in, for the panel and for `/chatid`. */
async function listGroups(client) {
    const chats = await client.getChats();
    return chats
        .filter((chat) => chat.isGroup)
        .map((chat) => ({
            id: chat.id?._serialized || String(chat.id),
            name: chat.name || '(unnamed)',
            participants: chat.participants?.length ?? null,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
}

/** Forgets resolved names, e.g. after a group has been renamed. */
function clearCache() {
    cache.clear();
}

module.exports = { resolveChat, listGroups, clearCache };
