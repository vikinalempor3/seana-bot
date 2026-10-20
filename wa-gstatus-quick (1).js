'use strict';

/**
 * wa-gstatus-quick.js — WhatsApp-native gstatus for quickpair sessions
 *
 * Permission tier: sq_sudo (session owner + sudo)
 *
 * Flow:
 *   {p}gstatus
 *     → "160 groups — reply: all | <name> | cancel"
 *     → user searches by name → numbered results shown
 *     → user types number to toggle that group in/out of selection
 *     → repeat searches until done; "done" when ≥1 selected
 *     → confirm screen lists all selected groups
 *     → user sends content (text / image / video) → broadcast fires
 *
 *   {p}gstatus all  — shortcut: skip to confirm with every group selected
 *   {p}cgstatus     — cancel wizard or live broadcast
 *
 * Integration (unchanged from v1):
 *   quick-commands.js  — import { gstatusCommand, cgstatusCommand }
 *   quick-handler.js   — call tryHandleInput() before the isFromMe skip
 */

const {
  proto,
  generateWAMessageContent,
  generateWAMessageFromContent,
  downloadContentFromMessage,
} = require('@whiskeysockets/baileys');
const { randomBytes } = require('crypto');

// WhatsApp monospace wrapper (was wa-codeblock.js)
function codeBlock(text) { return '```\n' + (text || '') + '\n```'; }
const CMD_PREFIX = '.';

/* ── State ──────────────────────────────────────────────────────────────────
 *
 * senderJid → {
 *   sock, chatJid, sessionKey,
 *   step:        'group_search' | 'search_results' | 'content_await',
 *   groups:      [{ id, subject }],   — full sorted list
 *   selected:    Set<id>,             — toggled-in group IDs
 *   lastResults: [{ id, subject }],   — results of the last search (for number-pick)
 * }
 */
const gstatusState   = new Map();
const activeBroadcasts = new Map();   // senderKey -> { cancelled:boolean }

const STATUS_MIN_DELAY = 5_000;
const STATUS_JITTER_MS = 4_000;

/* ── Misc helpers ────────────────────────────────────────────────────────── */

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function nextDelay() { return STATUS_MIN_DELAY + Math.floor(Math.random() * STATUS_JITTER_MS); }

// Removes ONLY lone (broken) surrogates and control chars. The old version stripped
// every surrogate, which deleted all fancy-font letters and emoji from group names.
function sanitize(s) {
  return String(s || '')
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '')
    .replace(/(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '$1')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

// Cuts by whole characters so a pair like 𝐍 or 💀 is never split in half.
function trim(s, max = 38) {
  const chars = Array.from(sanitize((s || '').trim()));
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : chars.join('');
}

// "234xxx:12@s.whatsapp.net" -> "234xxx@s.whatsapp.net" so the same person always matches.
function normJid(j) {
  return String(j || '').replace(/:\d+(?=@)/, '');
}

/* ── Unicode-aware group search ─────────────────────────────────────────────
 *
 * Strips NFD combining diacritics before comparing so that "eglise" matches
 * "Église", "a" matches "À / Á / Â / Ã", "esi" matches "Ɛsi", etc.
 * Case-insensitive substring match after normalisation.
 */
function normalizeForSearch(s) {
  return sanitize(s)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')   // strip accents; NFKD also folds fancy fonts (𝐍𝐀𝐔𝐑𝐀 -> naura)
    .toLowerCase();
}

function searchGroups(groups, term) {
  const needle = normalizeForSearch(term);
  return groups.filter(g => normalizeForSearch(g.subject).includes(needle));
}

/* ── Message builders ───────────────────────────────────────────────────────
 *
 * All text builders return plain strings; codeBlock() is applied at the
 * sendMessage call site so every message uses consistent WA monospace style.
 */

/** The main search prompt — shown at start and after every number-pick. */
function buildSearchPrompt(total, selected) {
  const selPart  = selected.size > 0 ? ` (${selected.size} selected)` : '';
  const donePart = selected.size > 0 ? ' | done' : '';
  return (
    `🎀 group status — ${total} groups${selPart}\n\n` +
    `reply: all | <name>${donePart} | cancel`
  );
}

/** Numbered list of search results with 💀 tick for already-selected groups. */
function buildSearchResults(results, selected, term) {
  const lines = results.map((g, i) => {
    const tick = selected.has(g.id) ? ' 💀' : '';
    return `${i + 1}. ${trim(g.subject)}${tick}`;
  });
  const count    = results.length;
  const plural   = count === 1 ? 'match' : 'matches';
  const donePart = selected.size > 0 ? ' | done' : '';
  return (
    `🎀 ${count} ${plural} for "${trim(term, 25)}":\n\n` +
    `${lines.join('\n')}\n\n` +
    `type a number to toggle${donePart} | <name> | cancel`
  );
}

/** Confirm + content-await screen — lists every selected group. */
function buildConfirmPrompt(groups, selected) {
  const targets  = groups.filter(g => selected.has(g.id));
  const preview  = targets.slice(0, 10).map(g => `  • ${trim(g.subject, 35)}`).join('\n');
  const moreRow  = targets.length > 10 ? `\n  +${targets.length - 10} more` : '';
  return (
    `🎀 broadcasting to ${targets.length} group(s):\n\n` +
    `${preview}${moreRow}\n\n` +
    `send your content (text, image, or video)\n` +
    `or cancel`
  );
}

/* ── Group status builder ───────────────────────────────────────────────────
 *
 * Content is built ONCE (media uploaded once, not once per group). For every
 * group we wrap it in groupStatusMessageV2 with a fresh 32-byte messageSecret.
 * Text statuses get a background colour, otherwise WhatsApp shows them blank.
 */
async function buildInnerContent(sock, payload) {
  const upload = sock.waUploadToServer;
  if (payload.text) {
    return generateWAMessageContent(
      { text: payload.text }, { upload, backgroundColor: '#1a1a2e', font: 0 });
  }
  if (payload.image) {
    return generateWAMessageContent(
      { image: payload.image, caption: payload.caption || '' }, { upload });
  }
  if (payload.video) {
    return generateWAMessageContent(
      { video: payload.video, caption: payload.caption || '', gifPlayback: false }, { upload });
  }
  throw new Error('unsupported payload type');
}

function wrapForGroup(groupId, inner, sock) {
  const messageSecret = randomBytes(32);
  const innerCopy = proto.Message.fromObject(proto.Message.toObject(inner, { defaults: false }));
  innerCopy.messageContextInfo = { ...(innerCopy.messageContextInfo || {}), messageSecret };
  return generateWAMessageFromContent(groupId, {
    messageContextInfo: { messageSecret },
    groupStatusMessageV2: { message: innerCopy },
  }, { userJid: sock.user?.id });
}

/* ── Diagnostics: does this Baileys build support group status? ────────────
 * If the installed protobuf has no groupStatusMessageV2 field, the field is
 * silently dropped, WhatsApp receives an empty message, and nothing shows up
 * even though the send "succeeds". We test for that up front.
 */
function protoSupportsGroupStatus() {
  try {
    const m = proto.Message.fromObject({
      groupStatusMessageV2: { message: { extendedTextMessage: { text: 'x' } } },
    });
    const back = proto.Message.decode(proto.Message.encode(m).finish());
    return !!back.groupStatusMessageV2;
  } catch (_) { return false; }
}

function baileysVersion() {
  try { return require('@whiskeysockets/baileys/package.json').version; } catch (_) { return 'unknown'; }
}

// Sends and waits for WhatsApp's own ack, so "sent" means the server took it.
async function relayWithAck(sock, groupId, message, messageId) {
  let ackNode = null, resolveAck;
  const acked = new Promise(r => { resolveAck = r; });
  const evt = `CB:ack,id:${messageId}`;
  const onAck = n => { ackNode = n; resolveAck(); };
  try { sock.ws?.on?.(evt, onAck); } catch (_) {}
  try {
    await sock.relayMessage(groupId, message, { messageId });
    await Promise.race([acked, sleep(10_000)]);
  } finally {
    try { sock.ws?.off?.(evt, onAck); } catch (_) {}
  }
  const attrs = ackNode?.attrs || null;
  console.log(`[wa-gstatus-quick] ack for ${groupId}:`, attrs ? JSON.stringify(attrs) : 'none within 10s');
  if (attrs?.error) throw new Error(`rejected by WhatsApp (error ${attrs.error})`);
  return attrs;
}

/* ── WhatsApp media download ─────────────────────────────────────────────── */

async function downloadWAMedia(sock, msg, type) {
  const mediaMsg = type === 'image'
    ? msg.message?.imageMessage
    : msg.message?.videoMessage;
  if (!mediaMsg) throw new Error(`no ${type} in message`);
  const stream = await downloadContentFromMessage(mediaMsg, type);
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

/* ── Broadcast loop ─────────────────────────────────────────────────────────
 *
 * Iterates targets with organic rate-limiting, edits a single progress
 * message in place, and honours the cancel flag before each send.
 */
async function runBroadcast(sock, chatJid, targets, payload, senderJid) {
  const ctl = { cancelled: false };
  activeBroadcasts.set(senderJid, ctl);
  try { await runBroadcastInner(sock, chatJid, targets, payload, senderJid, ctl); }
  finally { if (activeBroadcasts.get(senderJid) === ctl) activeBroadcasts.delete(senderJid); }
}

async function runBroadcastInner(sock, chatJid, targets, payload, senderJid, ctl) {
  const total = targets.length;
  let sent = 0, failed = 0;
  const errs = [];

  function buildProgressText(currentGroup) {
    const done = sent + failed;
    let t = `🎀 group status — sending\n\n`;
    if (currentGroup) t += `📤 ${currentGroup}\n`;
    t += `${done} / ${total} done  💀 ${sent} sent  ⚰️ ${failed} failed`;
    if (errs.length) {
      t += `\n\nerrors (${errs.length}):\n` +
        errs.slice(0, 4).map(e => `— ${e}`).join('\n');
      if (errs.length > 4) t += `\n+${errs.length - 4} more`;
    }
    t += `\n\ngoing slowly to stay safe…`;
    return t;
  }

  let progressKey = null;
  try {
    const m = await sock.sendMessage(chatJid, { text: codeBlock(buildProgressText(null)) });
    progressKey = m?.key;
  } catch (_) {}

  async function updateProgress(currentGroup) {
    if (!progressKey || ctl.cancelled) return;
    try {
      await sock.sendMessage(chatJid, {
        text: codeBlock(buildProgressText(currentGroup)),
        edit: progressKey,
      });
    } catch (_) {}
  }

  if (!protoSupportsGroupStatus()) {
    const msgTxt = `⚰️ this Baileys version (${baileysVersion()}) has no group status support, so WhatsApp gets an empty message.\n\nnothing was sent.\nrestart so the bot installs the group-status build, or update Baileys.`;
    console.log(`[wa-gstatus-quick] ❌ groupStatusMessageV2 missing in installed Baileys ${baileysVersion()}`);
    try { await sock.sendMessage(chatJid, { text: codeBlock(msgTxt) }); } catch (_) {}
    return;
  }

  let inner;
  try {
    inner = await buildInnerContent(sock, payload);
  } catch (e) {
    const failText = `⚰️ couldn't prepare the content: ${(e.message || '').slice(0, 80)}\n\nnothing was sent.`;
    console.log(`[wa-gstatus-quick] ❌ prepare failed: ${e.message}`);
    try {
      await sock.sendMessage(chatJid, progressKey
        ? { text: codeBlock(failText), edit: progressKey }
        : { text: codeBlock(failText) });
    } catch (_) {}
    return;
  }

  for (let i = 0; i < targets.length; i++) {
    if (ctl.cancelled) {
      const skipped    = targets.length - i;
      const cancelText =
        `🎀 group status cancelled\n\n` +
        `💀 ${sent} sent  ⚰️ ${failed} failed  🕷️ ${skipped} skipped`;
      try {
        await sock.sendMessage(chatJid, progressKey
          ? { text: codeBlock(cancelText), edit: progressKey }
          : { text: codeBlock(cancelText) }
        );
      } catch (_) {}
      return;
    }

    const { id: groupId, subject } = targets[i];
    await updateProgress(trim(subject, 35));

    try {
      const built = wrapForGroup(groupId, inner, sock);
      await relayWithAck(sock, groupId, built.message, built.key.id);
      sent++;
      console.log(`[wa-gstatus-quick] sent to ${groupId}`);
    } catch (e) {
      failed++;
      errs.push(`${trim(subject, 20)}: ${(e.message || '').slice(0, 40)}`);
      console.log(`[wa-gstatus-quick] ❌ ${groupId}: ${e.message}`);
    }

    await updateProgress(null);
    if (i < targets.length - 1) await sleep(nextDelay());
  }

  let finalText = `🎀 group status complete\n\n💀 ${sent} sent  ⚰️ ${failed} failed`;
  if (errs.length) {
    finalText += `\n\nerrors (${errs.length}):\n` +
      errs.slice(0, 6).map(e => `— ${e}`).join('\n');
    if (errs.length > 6) finalText += `\n+${errs.length - 6} more`;
  }

  try {
    await sock.sendMessage(chatJid, progressKey
      ? { text: codeBlock(finalText), edit: progressKey }
      : { text: codeBlock(finalText) }
    );
  } catch (_) {
    try { await sock.sendMessage(chatJid, { text: codeBlock(finalText) }); } catch (_) {}
  }
}

/* ── Shared helpers for state transitions ───────────────────────────────── */

/** Transition to content_await and send the confirm prompt. */
async function enterContentAwait(sock, chatJid, msg, state) {
  state.step = 'content_await';
  await sock.sendMessage(chatJid, {
    text: codeBlock(buildConfirmPrompt(state.groups, state.selected)),
  }, { quoted: msg });
}

/* ── Wizard input handler ───────────────────────────────────────────────────
 *
 * Called from quick-handler.js for every inbound message, placed BEFORE the
 * `isFromMe && !text…` continue so the session owner's own media messages
 * (image/video in content_await) are not dropped.
 *
 * Returns true if consumed; caller should `continue`.
 */
async function tryHandleInput(sock, { senderJid, chatJid, msg, text, sessionKey }) {
  senderJid = normJid(senderJid);
  const state = gstatusState.get(senderJid);
  if (!state || state.chatJid !== chatJid) return false;

  const raw = (text || '').trim();
  const lo  = raw.toLowerCase();

  // A real command (.wagstatus / .cwagstatus ...) must reach the command router,
  // not be swallowed by the wizard as a search term.
  if (/^[.!/#]c?w?a?gstatus\b/i.test(raw)) return false;
  // The bot's own replies are code blocks; never treat them as user input.
  if (raw.startsWith('```')) return false;

  if (state.step === 'group_search') {

    if (lo === 'cancel') {
      gstatusState.delete(senderJid);
      await sock.sendMessage(chatJid,
        { text: codeBlock('🎀 group status cancelled.') }, { quoted: msg });
      return true;
    }

    if (lo === 'all') {
      state.groups.forEach(g => state.selected.add(g.id));
      await enterContentAwait(sock, chatJid, msg, state);
      return true;
    }

    if ((lo === 'done' || lo === 'proceed') && state.selected.size > 0) {
      await enterContentAwait(sock, chatJid, msg, state);
      return true;
    }

    if (!raw) return true;

    const results = searchGroups(state.groups, raw);

    if (!results.length) {
      await sock.sendMessage(chatJid, {
        text: codeBlock(
          `🎀 no groups found for "${trim(raw, 30)}"\n\n` +
          buildSearchPrompt(state.groups.length, state.selected)
        ),
      }, { quoted: msg });
      return true;
    }

    state.lastResults = results;
    state.step        = 'search_results';
    await sock.sendMessage(chatJid, {
      text: codeBlock(buildSearchResults(results, state.selected, raw)),
    }, { quoted: msg });
    return true;
  }

  if (state.step === 'search_results') {

    if (lo === 'cancel') {
      gstatusState.delete(senderJid);
      await sock.sendMessage(chatJid,
        { text: codeBlock('🎀 group status cancelled.') }, { quoted: msg });
      return true;
    }

    if (lo === 'all') {
      state.groups.forEach(g => state.selected.add(g.id));
      await enterContentAwait(sock, chatJid, msg, state);
      return true;
    }

    if ((lo === 'done' || lo === 'proceed') && state.selected.size > 0) {
      await enterContentAwait(sock, chatJid, msg, state);
      return true;
    }

    const n = parseInt(raw, 10);
    if (!isNaN(n) && n >= 1 && n <= (state.lastResults?.length || 0)) {
      const group     = state.lastResults[n - 1];
      const wasIn     = state.selected.has(group.id);
      wasIn ? state.selected.delete(group.id) : state.selected.add(group.id);
      const action    = wasIn ? 'removed' : 'added';

      state.step = 'group_search';
      await sock.sendMessage(chatJid, {
        text: codeBlock(
          `🎀 ${action}: ${trim(group.subject)}\n\n` +
          buildSearchPrompt(state.groups.length, state.selected)
        ),
      }, { quoted: msg });
      return true;
    }

    if (!raw) return true;

    const results = searchGroups(state.groups, raw);

    if (!results.length) {
      state.step = 'group_search';
      await sock.sendMessage(chatJid, {
        text: codeBlock(
          `🎀 no groups found for "${trim(raw, 30)}"\n\n` +
          buildSearchPrompt(state.groups.length, state.selected)
        ),
      }, { quoted: msg });
      return true;
    }

    state.lastResults = results;
    await sock.sendMessage(chatJid, {
      text: codeBlock(buildSearchResults(results, state.selected, raw)),
    }, { quoted: msg });
    return true;
  }

  if (state.step === 'content_await') {

    if (lo === 'cancel') {
      gstatusState.delete(senderJid);
      await sock.sendMessage(chatJid,
        { text: codeBlock('🎀 group status cancelled.') }, { quoted: msg });
      return true;
    }

    const mc = msg.message || {};
    let payload = null;

    if (mc.imageMessage) {
      try {
        const buf = await downloadWAMedia(sock, msg, 'image');
        payload = { image: buf, caption: mc.imageMessage.caption || '' };
      } catch (e) {
        await sock.sendMessage(chatJid, {
          text: codeBlock(`⚰️ image download failed: ${e.message}\n\ntry again or cancel`),
        }, { quoted: msg });
        return true;
      }

    } else if (mc.videoMessage) {
      try {
        const buf = await downloadWAMedia(sock, msg, 'video');
        payload = { video: buf, caption: mc.videoMessage.caption || '' };
      } catch (e) {
        await sock.sendMessage(chatJid, {
          text: codeBlock(`⚰️ video download failed: ${e.message}\n\ntry again or cancel`),
        }, { quoted: msg });
        return true;
      }

    } else if (raw) {
      payload = { text: raw };

    }

    if (!payload) {
      await sock.sendMessage(chatJid, {
        text: codeBlock(
          '🎀 send text, an image, or a video. or cancel'
        ),
      }, { quoted: msg });
      return true;
    }

    const { sock: stateSock, groups, selected } = state;
    const targets = groups.filter(g => selected.has(g.id));
    gstatusState.delete(senderJid);

    const prefix = CMD_PREFIX;
    await sock.sendMessage(chatJid, {
      text: codeBlock(
        `🎀 starting broadcast to ${targets.length} group(s)…\n\n` +
        `send ${prefix}cgstatus to cancel.`
      ),
    }, { quoted: msg });

    runBroadcast(stateSock, chatJid, targets, payload, senderJid)
      .catch(e => console.log(`[wa-gstatus-quick] broadcast error: ${e.message}`));

    return true;
  }

  return false;
}

/* ── Command: {p}gstatus ────────────────────────────────────────────────────
 *
 *   {p}gstatus      — start the search-based selection wizard
 *   {p}gstatus all  — shortcut: skip straight to confirm with all groups
 */
const gstatusCommand = {
  tier: 'sq_sudo',

  async run(ctx) {
    let { sock, groupId: chatJid, senderJid, sessionKey, args } = ctx;

    senderJid = normJid(senderJid);
    gstatusState.delete(senderJid);

    let groups = [];
    try {
      const raw = await sock.groupFetchAllParticipating();
      groups = Object.values(raw || {}).map(g => ({
        id:      g.id,
        subject: sanitize(g.subject || g.id),
      }));
      groups.sort((a, b) => (a.subject || '').localeCompare(b.subject || ''));
    } catch (e) {
      return `⚰️ couldn't fetch groups: ${e.message}`;
    }

    if (!groups.length) return '🎀 no groups found for this session.';

    const allFlag = (args?.[0] || '').toLowerCase() === 'all';

    if (allFlag) {
      const selected = new Set(groups.map(g => g.id));
      gstatusState.set(senderJid, {
        sock, chatJid, sessionKey,
        step: 'content_await',
        groups, selected,
        lastResults: [],
      });
      return buildConfirmPrompt(groups, selected);
    }

    gstatusState.set(senderJid, {
      sock, chatJid, sessionKey,
      step:        'group_search',
      groups,
      selected:    new Set(),
      lastResults: [],
    });

    const term = (args || []).join(' ').trim();
    if (term) {
      const st = gstatusState.get(senderJid);
      const results = searchGroups(groups, term);
      if (results.length) {
        st.lastResults = results;
        st.step        = 'search_results';
        return buildSearchResults(results, st.selected, term);
      }
      return `🎀 no groups found for "${trim(term, 30)}"\n\n` + buildSearchPrompt(groups.length, new Set());
    }

    return buildSearchPrompt(groups.length, new Set());
  },
};

/* ── Command: {p}cgstatus ─────────────────────────────────────────────────── */
const cgstatusCommand = {
  tier: 'sq_sudo',

  run(ctx) {
    const key = normJid(ctx.senderJid);
    const hadWizard = gstatusState.delete(key);
    const live = activeBroadcasts.get(key);
    if (live) {
      live.cancelled = true;
      return '🎀 cancelling broadcast… current group will finish, then it stops.';
    }
    return hadWizard ? '🎀 group status wizard cancelled.' : '🎀 nothing to cancel.';
  },
};

module.exports = { gstatusCommand, cgstatusCommand, tryHandleInput, codeBlock };
