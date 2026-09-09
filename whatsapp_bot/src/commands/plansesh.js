'use strict';

const { Poll } = require('whatsapp-web.js');

const { today, formatDay, formatShort, upcomingWeeks } = require('../util/dates');

module.exports = {
    name: 'plansesh',
    aliases: ['sesh'],
    description: 'Post a poll with the upcoming days so everyone can pick when to sesh',
    usage: '/plansesh [weeks]',
    examples: ['/plansesh', '/plansesh 2', '/plansesh 6'],

    async execute({ args, msg, reply, config, commandConfig, logger }) {
        const settings = {
            question: 'when sesh?',
            default_weeks: 1,
            max_weeks: 8,
            allow_multiple_answers: true,
            ...commandConfig,
        };

        const weeks = parseWeeks(args[0], settings);
        if (weeks.error) {
            await reply(weeks.error);
            return;
        }

        // One poll per calendar week, so every poll ends on a Sunday. Started
        // mid-week, the first poll is just the days left in this week.
        const byWeek = upcomingWeeks(weeks.value, today(config.timezone));
        logger.info(`Planning ${weeks.value} week(s): ${byWeek.map((w) => w.length).join(' + ')} days`);

        for (const [index, week] of byWeek.entries()) {
            const poll = new Poll(
                pollTitle(settings.question, byWeek.length, index, week),
                week.map((date) => formatDay(date, config.locale)),
                { allowMultipleAnswers: settings.allow_multiple_answers !== false },
            );
            await msg.reply(poll);
            // WhatsApp drops or reorders polls fired back to back.
            if (index < byWeek.length - 1) await sleep(750);
        }

        logger.info(`Sent ${byWeek.length} poll(s)`);
    },
};

function parseWeeks(raw, settings) {
    if (raw === undefined) return { value: settings.default_weeks };

    if (!/^\d+$/.test(raw)) {
        return { error: `"${raw}" is not a number. Usage: /plansesh [weeks], e.g. /plansesh 2` };
    }
    const value = Number(raw);
    if (value < 1) return { error: 'Ask for at least 1 week: /plansesh 1' };
    if (value > settings.max_weeks) {
        return { error: `${value} weeks is a bit far ahead — the maximum is ${settings.max_weeks}.` };
    }
    return { value };
}

function pollTitle(question, total, index, week) {
    if (total === 1) return question;
    // Several weeks means several polls, so each one names the week it covers.
    const from = formatShort(week[0], 'en-GB');
    const to = formatShort(week[week.length - 1], 'en-GB');
    return `${question} (${index + 1}/${total}: ${from} – ${to})`;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
