'use strict';

const { DriveClient, loadCredentials, parseFolderId } = require('../drive/client');

/** Above this many new files at once, send one summary instead of a flood. */
const INDIVIDUAL_MESSAGE_LIMIT = 3;

/** Names listed in a grouped message before it says "and N more". */
const SUMMARY_LIMIT = 15;

let drive = null;
let driveFor = null;

module.exports = {
    name: 'drive-watch',
    description: 'Announces new Google Drive files in a WhatsApp group',
    configKey: 'gdrive',
    defaultInterval: 300,
    defaults: {
        enabled: false,
        folder_id: '',
        chat: '',
        poll_interval: 300,
        service_account_key_file: '/share/whatsapp-bot-drive-key.json',
        service_account_json: '',
    },
    stateDefaults: { seen: [], seeded: false },

    async run({ jobConfig, store, sendTo, logger, config }) {
        const folderId = parseFolderId(jobConfig.folder_id);
        if (!folderId) throw new Error('gdrive.folder_id is not set');
        if (!jobConfig.chat) throw new Error('gdrive.chat is not set');

        const client = getDrive(jobConfig);
        const files = await client.listSubtree(folderId);

        const seen = new Set(store.data.seen);
        const fresh = files.filter((file) => !seen.has(file.id));

        // The first run records what is already in the folder. Without this the
        // group would be spammed with every file that ever existed.
        if (!store.data.seeded) {
            store.data.seen = files.map((file) => file.id);
            store.data.seeded = true;
            store.save();
            logger.info(`Seeded with ${files.length} existing file(s); watching from now on`);
            return { seeded: files.length };
        }

        if (fresh.length === 0) {
            logger.debug(`No new files (${files.length} in the folder)`);
            return { newFiles: 0, total: files.length };
        }

        logger.info(`${fresh.length} new file(s)`);
        fresh.sort((a, b) => String(a.createdTime).localeCompare(String(b.createdTime)));

        const messages = fresh.length <= INDIVIDUAL_MESSAGE_LIMIT
            ? fresh.map((file) => describe(file, config))
            : [summarise(fresh, config)];

        for (const message of messages) {
            await sendTo(jobConfig.chat, message);
        }

        // Only remember the files once the group has actually been told about
        // them; a failed send is retried on the next tick.
        store.data.seen = [...seen, ...fresh.map((file) => file.id)];
        store.save();

        return { newFiles: fresh.length, total: files.length };
    },
};

/** One Drive client per credential set, rebuilt when the configuration changes. */
function getDrive(jobConfig) {
    const fingerprint = `${jobConfig.service_account_key_file}|${jobConfig.service_account_json.length}`;
    if (drive && driveFor === fingerprint) return drive;

    const credentials = loadCredentials({
        keyFile: jobConfig.service_account_key_file,
        inlineJson: jobConfig.service_account_json,
    });
    drive = new DriveClient({ credentials });
    driveFor = fingerprint;
    return drive;
}

function describe(file, config) {
    const who = uploader(file);
    const where = file.folderPath ? ` in _${file.folderPath}_` : '';
    return [
        `📁 New file added by ${who}, on ${when(file.createdTime, config)}${where}`,
        `*${file.name}*`,
        link(file),
    ].join('\n');
}

function summarise(files, config) {
    const shown = files.slice(0, SUMMARY_LIMIT);
    const lines = shown.map((file) => {
        const where = file.folderPath ? ` (${file.folderPath})` : '';
        return `• *${file.name}*${where}\n  ${link(file)}`;
    });
    if (files.length > shown.length) lines.push(`…and ${files.length - shown.length} more`);

    const people = [...new Set(files.map(uploader))];
    const by = people.length === 1 ? people[0] : `${people.slice(0, -1).join(', ')} and ${people.at(-1)}`;

    return [`📁 ${files.length} new files added by ${by}, on ${when(files[0].createdTime, config)}`, '', ...lines].join('\n');
}

function uploader(file) {
    return file.owners?.[0]?.displayName || file.lastModifyingUser?.displayName || 'someone';
}

function link(file) {
    return file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`;
}

function when(isoDate, config) {
    if (!isoDate) return 'an unknown date';
    const date = new Date(isoDate);
    const options = { timeZone: config.timezone };
    // Formatted in two parts, because a single format gives "9 Sept, 17:05" and
    // the sentence around it already has a comma.
    const day = new Intl.DateTimeFormat(config.locale, { ...options, day: 'numeric', month: 'short' }).format(date);
    const time = new Intl.DateTimeFormat(config.locale, { ...options, hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
    return `${day} at ${time}`;
}
