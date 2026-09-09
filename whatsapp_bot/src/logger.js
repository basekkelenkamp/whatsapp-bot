'use strict';

const LEVELS = { trace: 10, debug: 20, info: 30, warn: 40, error: 50 };

let threshold = LEVELS.info;

function setLevel(level) {
    threshold = LEVELS[level] || LEVELS.info;
}

function format(level, scope, args) {
    const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
    return [`[${stamp}] ${level.toUpperCase().padEnd(5)} [${scope}]`, ...args];
}

function createLogger(scope) {
    const emit = (level, stream) => (...args) => {
        if (LEVELS[level] < threshold) return;
        stream(...format(level, scope, args));
    };
    return {
        scope,
        child: (sub) => createLogger(`${scope}:${sub}`),
        trace: emit('trace', console.log),
        debug: emit('debug', console.log),
        info: emit('info', console.log),
        warn: emit('warn', console.warn),
        error: emit('error', console.error),
    };
}

module.exports = { createLogger, setLevel, LEVELS };
