'use strict';

/**
 * Calendar days are anchored at 12:00 UTC so that adding 24h never lands on the
 * previous or next day because of a DST change. Format them with timeZone UTC.
 */
function today(timeZone) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(new Date());
    const [year, month, day] = parts.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day, 12));
}

function addDays(date, days) {
    return new Date(date.getTime() + days * 86_400_000);
}

function formatDay(date, locale) {
    return new Intl.DateTimeFormat(locale, {
        timeZone: 'UTC',
        weekday: 'short',
        day: 'numeric',
        month: 'short',
    }).format(date);
}

function formatShort(date, locale) {
    return new Intl.DateTimeFormat(locale, {
        timeZone: 'UTC',
        day: 'numeric',
        month: 'short',
    }).format(date);
}

/** Monday = 0 … Sunday = 6. */
function weekdayIndex(date) {
    return (date.getUTCDay() + 6) % 7;
}

/**
 * The next `weeks` calendar weeks starting today, grouped one array per week
 * and always ending on a Sunday.
 *
 * The current week counts as the first one, so it is short when we are already
 * mid-week: asked for 2 weeks on a Wednesday this returns [Wed…Sun, Mon…Sun].
 */
function upcomingWeeks(weeks, from) {
    // Days left in this week (today included), plus the remaining full weeks.
    let total = 7 - weekdayIndex(from) + (weeks - 1) * 7;
    // Asking for one week on a Sunday leaves a single day, and WhatsApp will
    // not accept a poll with one option — reach into the next week instead.
    if (total < 2) total += 7;

    const grouped = [];
    for (let offset = 0; offset < total; offset += 1) {
        const date = addDays(from, offset);
        if (grouped.length === 0 || weekdayIndex(date) === 0) grouped.push([]);
        grouped[grouped.length - 1].push(date);
    }

    // Same one-option problem, now for the leading Sunday of a longer range.
    if (grouped.length > 1 && grouped[0].length < 2) {
        grouped[1] = grouped[0].concat(grouped[1]);
        grouped.shift();
    }
    return grouped;
}

module.exports = { today, addDays, formatDay, formatShort, upcomingWeeks };
