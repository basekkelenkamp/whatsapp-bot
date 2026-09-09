'use strict';

const fs = require('fs');
const path = require('path');

const { createLogger } = require('../logger');

const log = createLogger('store');

/**
 * A small JSON document under /data, for the bits of state a module has to
 * remember across restarts — which Drive files have already been announced,
 * for example.
 *
 * Writes go to a temporary file first and are then renamed, so a crash or a
 * power cut can never leave a half-written file behind.
 */
class Store {
    constructor(dataDir, name, defaults = {}) {
        this.file = path.join(dataDir, `${name}.json`);
        this.defaults = defaults;
        this.data = { ...defaults };
    }

    load() {
        try {
            this.data = { ...this.defaults, ...JSON.parse(fs.readFileSync(this.file, 'utf8')) };
        } catch (err) {
            if (err.code !== 'ENOENT') {
                log.warn(`${this.file} is unreadable (${err.message}); starting from defaults`);
            }
            this.data = { ...this.defaults };
        }
        return this.data;
    }

    save() {
        const tmp = `${this.file}.tmp`;
        try {
            fs.mkdirSync(path.dirname(this.file), { recursive: true });
            fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
            fs.renameSync(tmp, this.file);
        } catch (err) {
            log.error(`Could not write ${this.file}: ${err.message}`);
        }
    }
}

module.exports = { Store };
