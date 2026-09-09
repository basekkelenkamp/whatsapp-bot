'use strict';

module.exports = {
    name: 'chatid',
    aliases: ['groupid'],
    description: 'Show the id of the current chat, for use in the add-on configuration',

    async execute({ msg, reply }) {
        const chat = await msg.getChat();
        await reply(
            [
                `*${chat.name || 'this chat'}*`,
                `id: ${chat.id._serialized}`,
                chat.isGroup ? 'type: group' : 'type: direct message',
            ].join('\n'),
        );
    },
};
