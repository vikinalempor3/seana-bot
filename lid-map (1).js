// lid-map.js
// Remembers which WhatsApp "@lid" ids belong to which real phone numbers (and usernames),
// and saves them to ./lid-map.json so they survive restarts.
const fs = require('fs');

let file = './lid-map.json';
const lidToPn = new Map();     // lid digits -> phone digits
const pnToLid = new Map();     // phone digits -> lid digits
const userToPn = new Map();    // username (lowercase) -> phone digits
let dirty = false, timer = null;

const dig = x => String(x || '').split('@')[0].split(':')[0].replace(/\D/g, '');

function scheduleSave() {
  dirty = true;
  if (timer) return;
  timer = setTimeout(() => { timer = null; flush(); }, 5000);
  if (timer.unref) timer.unref();
}

function init(path) {
  if (path) file = path;
  try {
    if (!fs.existsSync(file)) return;
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const [l, p] of Object.entries(j.lids || {})) { lidToPn.set(l, p); pnToLid.set(p, l); }
    for (const [u, p] of Object.entries(j.usernames || {})) userToPn.set(u, p);
    console.log(`🗺️ lid-map loaded: ${lidToPn.size} lids, ${userToPn.size} usernames`);
  } catch (e) { console.error('[lid-map] load failed:', e.message); }
}

function flush() {
  if (!dirty) return;
  try {
    fs.writeFileSync(file, JSON.stringify({ lids: Object.fromEntries(lidToPn), usernames: Object.fromEntries(userToPn) }));
    dirty = false;
  } catch (e) { console.error('[lid-map] save failed:', e.message); }
}

// set(lidJidOrDigits, phoneJidOrDigits)
function set(lid, pn) {
  const l = dig(lid), p = dig(pn);
  if (!l || !p || l === p || p.length < 7 || p.length > 15) return false;
  if (lidToPn.get(l) === p) return false;
  lidToPn.set(l, p); pnToLid.set(p, l); scheduleSave();
  return true;
}
function setUsername(name, pn) {
  const u = String(name || '').trim().replace(/^@/, '').toLowerCase(), p = dig(pn);
  if (!u || !p || userToPn.get(u) === p) return false;
  userToPn.set(u, p); scheduleSave();
  return true;
}
const get = lid => lidToPn.get(dig(lid)) || null;                 // lid -> phone digits
const getLid = pn => pnToLid.get(dig(pn)) || null;                // phone -> lid digits
const getByUsername = name => userToPn.get(String(name || '').trim().replace(/^@/, '').toLowerCase()) || null;
const size = () => lidToPn.size;
const usernameSize = () => userToPn.size;

module.exports = { init, flush, set, setUsername, get, getLid, getByUsername, size, usernameSize };
