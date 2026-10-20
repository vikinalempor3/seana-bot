// wa-lid.js
// Helps the bot work with WhatsApp's newer "@lid" ids: it learns which lid belongs to which
// phone number, and turns senders / mentions / quoted people back into real phone JIDs.
const lidMap = require('./lid-map');

const dig = x => String(x || '').split('@')[0].split(':')[0].replace(/\D/g, '');
const isLid = j => /@lid(\.us)?$/.test(String(j || ''));
const isPn = j => /@s\.whatsapp\.net$/.test(String(j || ''));
const toPn = d => d + '@s.whatsapp.net';

// Turn any jid into a phone-number jid if we can; otherwise return it unchanged.
function toRealJid(j) {
  if (!j) return j;
  if (!isLid(j)) return j;
  const p = lidMap.get(j);
  return p ? toPn(p) : j;
}

// Learn lid <-> phone pairs from anything that carries both.
function learn(a, b) {
  if (!a || !b) return;
  if (isLid(a) && isPn(b)) lidMap.set(a, b);
  else if (isLid(b) && isPn(a)) lidMap.set(b, a);
}
function learnParticipant(p) {
  if (!p || typeof p !== 'object') return;
  const ids = [p.id, p.lid, p.phoneNumber, p.jid, p.pn].filter(Boolean);
  const lid = ids.find(isLid), pn = ids.find(isPn);
  if (lid && pn) lidMap.set(lid, pn);
}

function attachLidTracking(sock) {
  if (!sock || !sock.ev || sock.__lidTracking) return;
  sock.__lidTracking = true;
  const safe = fn => (...a) => { try { fn(...a); } catch (_) {} };

  // Baileys 7 announces new mappings directly
  sock.ev.on('lid-mapping.update', safe(m => {
    const list = Array.isArray(m) ? m : [m];
    for (const x of list) learn(x && (x.lid || x.id), x && (x.pn || x.phoneNumber || x.jid));
  }));

  sock.ev.on('messages.upsert', safe(({ messages }) => {
    for (const m of messages || []) {
      const k = m.key || {};
      learn(k.remoteJid, k.remoteJidAlt);
      learn(k.participant, k.participantAlt);
      learn(k.participant, k.participantPn);
      if (m.pushName && k.participant && isLid(k.participant) === false) {/* nothing to learn */}
    }
  }));

  const contacts = safe(list => {
    for (const c of list || []) {
      learn(c.id, c.lid || c.phoneNumber);
      if (c.username) { const pn = isPn(c.id) ? c.id : (c.phoneNumber || toRealJid(c.lid || c.id)); if (isPn(pn)) lidMap.setUsername(c.username, pn); }
    }
  });
  sock.ev.on('contacts.upsert', contacts);
  sock.ev.on('contacts.update', contacts);

  sock.ev.on('groups.upsert', safe(gs => { for (const g of gs || []) for (const p of g.participants || []) learnParticipant(p); }));
  sock.ev.on('group-participants.update', safe(ev => { for (const p of ev.participants || []) learnParticipant(p); }));
}

// Find the real phone JID of whoever sent a message. Returns null when it can't be worked out.
async function resolveSenderJid(sock, msg, isGroup, jid) {
  const k = (msg && msg.key) || {};
  const raw = isGroup ? (k.participant || '') : (k.remoteJid || jid || '');
  const alt = isGroup ? (k.participantAlt || k.participantPn) : k.remoteJidAlt;
  if (alt && isPn(alt)) { if (isLid(raw)) lidMap.set(raw, alt); return alt; }
  if (!raw) return null;
  if (isPn(raw)) return raw;
  if (isLid(raw)) {
    const p = lidMap.get(raw);
    if (p) return toPn(p);
    if (isGroup && sock && typeof sock.groupMetadata === 'function') {
      try {
        const meta = await sock.groupMetadata(jid);
        for (const x of meta.participants || []) learnParticipant(x);
        const p2 = lidMap.get(raw);
        if (p2) return toPn(p2);
      } catch (_) {}
    }
    return null;
  }
  return raw;
}

// Who got @mentioned / replied to in this message? -> { mentioned: [jids], quoted: jid|null }
async function resolveMentions(sock, msg, isGroup, jid) {
  const m = (msg && msg.message) || {};
  const ctx = (m.extendedTextMessage || m.imageMessage || m.videoMessage || m.documentMessage || m.audioMessage || m.stickerMessage || {}).contextInfo || {};
  const out = { mentioned: [], quoted: null };
  let needMeta = false;
  const all = [...(Array.isArray(ctx.mentionedJid) ? ctx.mentionedJid : []), ctx.participant].filter(Boolean);
  if (all.some(j => isLid(j) && !lidMap.get(j))) needMeta = true;
  if (needMeta && isGroup && sock && typeof sock.groupMetadata === 'function') {
    try { const meta = await sock.groupMetadata(jid); for (const x of meta.participants || []) learnParticipant(x); } catch (_) {}
  }
  out.mentioned = [...new Set((Array.isArray(ctx.mentionedJid) ? ctx.mentionedJid : []).map(toRealJid))];
  if (ctx.participant) out.quoted = toRealJid(ctx.participant);
  return out;
}

// Turn "@2348012345678" typed in a text into real WhatsApp mentions.
function mentionify(text) {
  const mentions = [];
  const re = /@(\d{7,15})\b/g;
  let m;
  while ((m = re.exec(String(text || '')))) mentions.push(toPn(m[1]));
  return { text: String(text || ''), mentions: [...new Set(mentions)] };
}

// .wanumber <@lid | username>  ->  phone digits, or null
function lookupNumber(query) {
  const q = String(query || '').trim();
  if (!q) return null;
  const d = dig(q);
  if (/^@?\d+(@lid)?$/.test(q) && d) { const p = lidMap.get(d); if (p) return p; }
  return lidMap.getByUsername(q) || (d && lidMap.get(d)) || null;
}

module.exports = { attachLidTracking, resolveSenderJid, resolveMentions, mentionify, lookupNumber, toRealJid };
