'use strict';

module.exports = {
    name: 'help',
    aliases: ['commands'],
    description: 'List everything this bot can do',
    usage: '/help [command]',

    async execute({ args, reply, registry }) {
        const prefix = registry.prefix;

        if (args[0]) {
            const command = registry.get(args[0]);
            if (!command) {
                await reply(`Unknown command "${args[0]}". Try ${prefix}help.`);
                return;
            }
            await reply(details(command, prefix));
            return;
        }

        const lines = registry
            .list()
            .filter((command) => !command.hidden)
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((command) => `• ${prefix}${command.name} — ${command.description || 'no description'}`);

        await reply(`*Commands*\n${lines.join('\n')}\n\n${prefix}help <command> for details.`);
    },
};

function details(command, prefix) {
    const parts = [`*${prefix}${command.name}*`];
    if (command.description) parts.push(command.description);
    if (command.usage) parts.push(`Usage: ${command.usage}`);
    if (command.aliases?.length) parts.push(`Aliases: ${command.aliases.map((a) => prefix + a).join(', ')}`);
    if (command.examples?.length) parts.push(`Examples:\n${command.examples.map((e) => `  ${e}`).join('\n')}`);
    return parts.join('\n');
}
