'use strict';

module.exports = {
    name: 'status',
    aliases: ['ping'],
    description: 'Check that the bot is alive and how long it has been connected',

    async execute({ reply, service }) {
        const snapshot = service.getSnapshot();
        const connected = snapshot.readyAt ? humanize(Date.now() - snapshot.readyAt) : 'not yet';
        await reply(
            [
                '🤖 *alive*',
                `state: ${snapshot.status}`,
                `connected for: ${connected}`,
                `reconnects since boot: ${snapshot.restarts}`,
            ].join('\n'),
        );
    },
};

function humanize(ms) {
    const minutes = Math.floor(ms / 60_000);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 48) return `${hours}h ${minutes % 60}m`;
    return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}
