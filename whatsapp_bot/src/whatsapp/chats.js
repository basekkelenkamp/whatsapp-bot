'use strict';

const { createLogger } = require('../logger');

const log = createLogger('chats');

/** Chat ids look like 1203...@g.us for groups and 316...@c.us for people. */
const CHAT_ID = /@(g\.us|c\.us|newsletter|broadcast)$/;

// Listing chats means reaching into the browser, so remember what a name
// resolved to. Group ids never change, even when a group is renamed.
const cache = new Map();

/**
 * Accepts a chat id or a group name and returns a chat id. Configuring a
 * notification target by name is far friendlier than asking someone to dig a
 * 20-digit id out of WhatsApp.
 */
async function resolveChat(client, target) {
    const wanted = String(target || '').trim();
    if (!wanted) throw new Error('No chat configured');
    // An id needs no lookup at all, which is why it is the safer thing to
    // configure — see listGroups() for why the lookup is worth avoiding.
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

/**
 * Every group the linked account is in, as plain `{ id, name }`.
 *
 * Deliberately NOT client.getChats(). That builds a full model of every chat,
 * which for each group awaits a live GroupMetadata update and rewrites every
 * participant id through WhatsApp's LID migration helper. Any one of those
 * steps throwing — a stale group, a community, a WhatsApp Web build that moved
 * a module — rejects the Promise.all inside it and the whole call fails with an
 * unreadable minified error like "r". All we ever need is an id and a name, so
 * this reads them straight off the store and skips every chat that misbehaves.
 */
async function listGroups(client) {
    const page = client?.pupPage;
    if (!page) throw new Error('WhatsApp client is not connected');

    const groups = await page.evaluate(() => {
        const collections = window.require?.('WAWebCollections') || window.Store;
        const chats = collections?.Chat?.getModelsArray?.() || [];
        const out = [];

        for (const chat of chats) {
            try {
                const id = chat?.id?._serialized;
                if (!id || !id.endsWith('@g.us')) continue;
                out.push({
                    id,
                    name: chat.name || chat.formattedTitle || chat.groupMetadata?.subject || '',
                    participants: chat.groupMetadata?.participants?.length ?? null,
                });
            } catch (err) {
                // One unreadable chat must not hide all the others.
            }
        }
        return out;
    });

    return groups
        .map((group) => ({ ...group, name: group.name || '(unnamed)' }))
        .sort((a, b) => a.name.localeCompare(b.name));
}

/** The chat a message belongs to, without asking the browser anything. */
function chatIdOf(msg) {
    return (msg.fromMe ? msg.to : msg.from) || msg.id?.remote || null;
}

/** Forgets resolved names, e.g. after a group has been renamed. */
function clearCache() {
    cache.clear();
}

module.exports = { resolveChat, listGroups, chatIdOf, clearCache };
