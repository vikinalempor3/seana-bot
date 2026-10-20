'use strict';

/**
 * store.js
 * Minimal config store for quick-session modules.
 * Returns the bot's command prefix (hardcoded to '.' to match index.js).
 */

let _config = { prefix: '.' };

function load() {
  return _config;
}

function save(data) {
  _config = { ..._config, ...data };
}

module.exports = { load, save };
