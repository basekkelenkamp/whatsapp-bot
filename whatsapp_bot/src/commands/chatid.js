'use strict';

const { chatIdOf, listGroups } = require('../whatsapp/chats');

module.exports = {
    name: 'chatid',
    aliases: ['groupid'],
    description: 'Show the id of the current chat, for use in the add-on configuration',

    async execute({ msg, client, reply, logger }) {
        // The id is already on the message. Asking WhatsApp Web for the chat
        // object instead would pull in the group metadata, which is exactly the
        // fragile path this command exists to help you avoid.
        const chatId = chatIdOf(msg);
        if (!chatId) {
            await reply('Could not work out this chat\'s id.');
            return;
        }

        const isGroup = chatId.endsWith('@g.us');
        let name = null;
        if (isGroup) {
            try {
                name = (await listGroups(client)).find((group) => group.id === chatId)?.name;
            } catch (err) {
                // The id is the part that matters; the name is a nicety.
                logger.debug(`Could not look up the group name: ${err.message}`);
            }
        }

        await reply(
            [
                name ? `*${name}*` : null,
                `id: ${chatId}`,
                `type: ${isGroup ? 'group' : 'direct message'}`,
                '',
                'Paste that id into the add-on configuration.',
            ].filter(Boolean).join('\n'),
        );
    },
};
