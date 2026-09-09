#!/usr/bin/with-contenv bashio
# shellcheck shell=bash
set -e

# /data is the only directory that survives an add-on restart, rebuild or
# update, so the WhatsApp pairing lives there and never has to be re-scanned.
mkdir -p /data/wwebjs_auth /data/wwebjs_cache

bashio::log.info "Starting WhatsApp bot..."

# The bot reads its own settings straight from /data/options.json, including the
# timezone, so there is nothing to translate from bashio here.
exec node /app/src/index.js
