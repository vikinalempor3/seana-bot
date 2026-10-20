'use strict';
/**
 * natural-intents.js — talk to the bot like a person (no dot commands needed)
 *
 *  No dots or slashes needed. Just talk naturally:
 *  • "how can I pair?" → asks for number → sends code
 *  • "turn on antilink" → does it (or asks for admin first)
 *  • "what time is it?" → tells the time
 *  • "what's today's date?" → tells the date
 *  • "can we play a game?" → shows game options
 *  • "start trivia" → starts trivia right away
 *  • "what can you do?" → friendly help overview
 *  • "check my balance" → shows wallet balance
 *  • "claim my daily" → claims daily reward
 *  • "show my profile" → shows profile/stats
 *
 * index.js calls: init(deps) once, then handleWA / handleTG for plain messages,
 * looksAddressed() to let owner's own name-addressed messages through, and
 * onParticipants() from the group-participants event.
 */

let D = null;
function init(deps) { D = deps; }

/* ── name detection ─────────────────────────────────────────────────────── */
const NAME_RE = /\b(?:seana|chandra|shay|chanelle|seanie)\b/i;

/* ── feature toggles ────────────────────────────────────────────────────── */
const FEATURES = {
  antilink:   { col: 'antilink_on',   cmd: '.antilink',   label: 'Anti-link',          needsAdmin: true,
                re: /\banti[\s-]?links?\b|\blink[\s-]?(?:blocker|blocking|protection|guard)\b|\b(?:stop|block|delete|remove|prevent)\b[^.?!]{0,25}\blinks?\b/i },
  antiflood:  { col: 'antiflood_on',  cmd: '.antiflood',  label: 'Anti-flood',         needsAdmin: true,
                re: /\banti[\s-]?(?:flood|spam)\b|\bstop\b[^.?!]{0,20}\bspam/i },
  antigm:     { col: 'antigm_on',     cmd: '.antigm',     label: 'Anti-group-mention', needsAdmin: true,
                re: /\banti[\s-]?(?:gm|group[\s-]?mention)\b/i },
  antistatus: { col: 'antistatus_on', cmd: '.antistatus', label: 'Anti-status-tag',    needsAdmin: true,
                re: /\banti[\s-]?status\b/i },
  badword:    { col: 'badword_on',    cmd: '.badword',    label: 'Bad-word filter',     needsAdmin: true,
                re: /\bbad[\s-]?words?\b|\bswear(?:ing)?\s+filter\b/i },
  welcome:    { col: 'welcome_on',    cmd: '.welcome',    label: 'Welcome messages',    needsAdmin: false,
                re: /\bwelcome\s+(?:message|msg|text)s?\b|\bwelcome\s+(?:new\s+)?members?\b|\bgreet\s+(?:new\s+)?members?\b/i },
};

const ON_RE  = /\b(?:activate|activat\w*|turn(?:ing)?\s+on|switch(?:ing)?\s+on|enable|set\s?up|setup|start|put\s+on|use|add|want|need|open|how)\b|\b(?:stop|block|delete|remove|prevent)\b[^.?!]{0,25}\b(?:links?|spam)/i;
const OFF_RE = /\b(?:deactivate|disactivate|disable|turn(?:ing)?\s+off|switch(?:ing)?\s+off|cancel)\b|\b(?:stop|remove)\s+(?:the\s+|my\s+|using\s+)?(?:anti|bad|welcome)/i;
const EXPLAIN_RE = /\b(?:what\s+is|what\s+does|how\s+does|how\s+do\s+\w+\s+work|explain)\b/i;

/* ── pairing ────────────────────────────────────────────────────────────── */
const PAIR_RE = new RegExp([
  /\b(?:pair|peer|pairing|paired)\b[\s\S]{0,40}\b(?:you|u|bot|seana|me|my|number|whatsapp)\b/.source,
  /\b(?:you|bot|seana)\b[\s\S]{0,30}\b(?:pair|peer|pairing)\b/.source,
  /\b(?:link|connect|add)\b[\s\S]{0,14}\b(?:my|me)\b[\s\S]{0,14}\b(?:whatsapp|number|account|phone|wa)\b/.source,
  /\bhow\s+(?:can|do|to|should|could)\s+(?:i|we)\b[\s\S]{0,14}\b(?:pair|peer|connect|link)\b/.source,
  /\bi\s+(?:want|wanna|need)\s+(?:to\s+)?(?:pair|peer|link|connect)\b/.source,
].join('|'), 'i');

/* ── time / date ────────────────────────────────────────────────────────── */
const TIME_RE = /\b(?:what(?:'s|\s+is)\s+(?:the\s+)?(?:current\s+)?time|what\s+time\s+is\s+it|tell\s+me\s+the\s+time|current\s+time|time\s+(?:now|right\s+now)|do\s+you\s+know\s+the\s+time|check\s+(?:the\s+)?time)\b/i;
const DATE_RE = /\b(?:what(?:'s|\s+is)\s+(?:the\s+)?(?:current\s+|today'?s?\s+)?date|what\s+(?:day|date)\s+is\s+(?:it|today)|today'?s?\s+date|what\s+day\s+(?:is\s+it\s+today|today|is\s+today)|current\s+date|what\s+month|what\s+year|what\s+day\s+is\s+today)\b/i;
const DATETIME_RE = /\b(?:time\s+and\s+date|date\s+and\s+time|what\s+is\s+today(?:'s\s+date)?|tell\s+me\s+(?:the\s+)?(?:time\s+and\s+date|date\s+and\s+time))\b/i;

/* ── games ──────────────────────────────────────────────────────────────── */
const GAME_START_RE = /\b(?:(?:can\s+we|let'?s?|wanna|want\s+to|i\s+want\s+to|i\s+wanna|shall\s+we)\s+play(?:\s+a\s+game)?|start\s+(?:a\s+)?game|play\s+a\s+game|game\s+time)\b/i;
const GAME_TYPE_RE  = /\b(?:trivia|quiz|riddle|hangman|scramble|word[\s-]?chain|number[\s-]?guess|guess[\s-]?(?:the\s+)?number|math[\s-]?duel)\b/i;
const GAME_MAP = {
  trivia: '.trivia', quiz: '.trivia', riddle: '.riddle',
  hangman: '.hangman', scramble: '.scramble',
  'wordchain': '.wordchain', 'word chain': '.wordchain',
  'numguess': '.numguess', 'number guess': '.numguess', 'guess number': '.numguess',
  'mathduel': '.mathduel', 'math duel': '.mathduel',
};

/* ── help / menu ────────────────────────────────────────────────────────── */
const HELP_RE = /\b(?:what\s+(?:can|do)\s+(?:you|u)\s+(?:do|help|offer)|what\s+are\s+your\s+(?:features|commands|abilities|functions)|show\s+me\s+(?:your\s+)?(?:commands|menu|features|what\s+you\s+can\s+do)|how\s+(?:do\s+you\s+work|can\s+you\s+help|do\s+i\s+use\s+you)|what'?s?\s+(?:on\s+the\s+)?menu|everything\s+you\s+(?:can\s+)?do|list\s+(?:your\s+)?(?:commands|features)|help\s+me\s+(?:out|please)|show\s+(?:me\s+)?(?:all\s+)?commands)\b/i;

/* ── balance / bank ─────────────────────────────────────────────────────── */
const BALANCE_RE = /\b(?:(?:check|see|show|tell\s+me|what'?s?|show\s+me)\s+(?:my\s+)?(?:balance|money|cash|wallet|coins?|bank)|how\s+much\s+(?:do\s+i\s+have|money\s+(?:do\s+i\s+have)?|is\s+in\s+my\s+(?:wallet|bank|account)))\b/i;

/* ── daily claim ────────────────────────────────────────────────────────── */
const DAILY_RE = /\b(?:claim\s+(?:my\s+)?(?:daily|coins?|reward)|(?:my\s+)?daily\s+(?:reward|claim|coins?|bonus)|get\s+(?:my\s+)?daily|collect\s+(?:my\s+)?(?:daily|reward))\b/i;

/* ── profile / stats ────────────────────────────────────────────────────── */
const PROFILE_RE = /\b(?:(?:show|check|see|what'?s?|show\s+me)\s+(?:my\s+)?(?:profile|stats?|level|rank|xp)|my\s+(?:profile|stats?|level|xp|rank)|how\s+(?:am\s+i\s+doing|many\s+levels\s+do\s+i\s+have))\b/i;

/* ── uptime / status ────────────────────────────────────────────────────── */
const STATUS_RE = /\b(?:are\s+you\s+(?:online|alive|there|up|working|active)|(?:is|are)\s+(?:you|the\s+bot|seana)\s+(?:online|alive|there|up|working)|you\s+(?:online|there|up)|how\s+long\s+(?:have\s+you\s+been|are\s+you)\s+(?:up|online|running))\b/i;

/* ── member activity ─────────────────────────────────────────────────────── */
const ACTIVE_RE   = /\b(?:who(?:'?s|\s+(?:is|are))\s+(?:the\s+)?most\s+active|show\s+(?:me\s+)?(?:the\s+)?(?:most\s+)?active|top\s+(?:active\s+)?members?|most\s+active\s+members?|active\s+members?)\b/i;
const INACTIVE_RE = /\b(?:show\s+(?:me\s+)?(?:the\s+)?inactive|who(?:'?s|\s+(?:is|are))\s+inactive|inactive\s+members?|who\s+(?:hasn'?t|has\s+not)\s+(?:been\s+)?(?:talking|active|chatting))\b/i;

/* ── ─────────────────────────────────────────────────────────────────────── */

function detect(text) {
  const t = String(text || '').trim();
  if (!t || t.length > 300 || t.startsWith('.') || t.startsWith('/')) return null;

  // Time / date — check combined first so "time and date" hits datetime, not just time
  if (DATETIME_RE.test(t)) return { type: 'datetime' };
  if (TIME_RE.test(t))     return { type: 'time' };
  if (DATE_RE.test(t))     return { type: 'date' };

  // Help / menu
  if (HELP_RE.test(t)) return { type: 'help' };

  // Status / ping
  if (STATUS_RE.test(t)) return { type: 'command', cmd: '.ping' };

  // Balance
  if (BALANCE_RE.test(t)) return { type: 'command', cmd: '.balance' };

  // Daily
  if (DAILY_RE.test(t)) return { type: 'command', cmd: '.daily' };

  // Profile
  if (PROFILE_RE.test(t)) return { type: 'command', cmd: '.profile' };

  // Specific game type mentioned
  const gameTypeMatch = t.match(GAME_TYPE_RE);
  if (gameTypeMatch) {
    const gt = gameTypeMatch[0].toLowerCase().replace(/[\s-]+/g, '');
    const cmd = GAME_MAP[gt] || GAME_MAP[gameTypeMatch[0].toLowerCase()] || null;
    if (cmd) return { type: 'game', cmd };
  }

  // General "let's play a game"
  if (GAME_START_RE.test(t)) return { type: 'game_menu' };

  // Feature toggles
  for (const [key, F] of Object.entries(FEATURES)) {
    if (!F.re.test(t)) continue;
    if (EXPLAIN_RE.test(t) && !/\b(?:activate|turn\s+on|enable|set\s?up)\b/i.test(t)) return null;
    const off = OFF_RE.test(t);
    if (!off && !ON_RE.test(t)) return null;
    return { type: 'feature', feature: key, value: off ? 0 : 1 };
  }

  // Member activity
  if (ACTIVE_RE.test(t))   return { type: 'command', cmd: '.active' };
  if (INACTIVE_RE.test(t)) return { type: 'command', cmd: '.inactive 7' };

  // Pairing
  if (PAIR_RE.test(t)) return { type: 'pair' };

  return null;
}

// The owner's own messages normally only count when they start with "."; a natural request
// is let through only when it is clearly aimed at the bot (her name, or the owner's own chat).
function looksAddressed(text, isSelfChat) {
  const t = String(text || '');
  return !!detect(t) && (isSelfChat || NAME_RE.test(t));
}

/* ── time helpers ────────────────────────────────────────────────────────── */
function getNow(tz) {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: tz || 'Africa/Lagos',
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: true,
    }).format(new Date());
  } catch (_) {
    return new Date().toLocaleString('en-US', { timeZone: 'Africa/Lagos', hour12: true });
  }
}
function getTime(tz) {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: tz || 'Africa/Lagos',
      hour: '2-digit', minute: '2-digit', hour12: true,
    }).format(new Date());
  } catch (_) { return new Date().toLocaleTimeString(); }
}
function getDate(tz) {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: tz || 'Africa/Lagos',
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    }).format(new Date());
  } catch (_) { return new Date().toLocaleDateString(); }
}

function timeHandler(type) {
  const tz = 'Africa/Lagos';
  if (type === 'time')     return { reply: `it's ${getTime(tz)} right now ⏰` };
  if (type === 'date')     return { reply: `today is ${getDate(tz)} 📅` };
  return { reply: `right now it's ${getNow(tz)} 🕐` };
}

/* ── pairing by chat ─────────────────────────────────────────────────────── */
const awaiting = new Map();
const WAIT_MS = 10 * 60 * 1000;

function extractPhone(t) {
  const m = String(t || '').match(/\+?\d[\d\s\-().]{6,20}\d/);
  if (!m) return null;
  const d = m[0].replace(/\D/g, '');
  return d.length >= 8 && d.length <= 15 ? d : null;
}

async function pairFlow(a, intent) {
  const key = a.platform + ':' + a.userId;
  const active = (awaiting.get(key) || 0) > Date.now();
  if (!active && !intent) return null;

  if (a.isGroup) {
    return intent ? { reply: "message me privately and I'll pair you there — your code stays between us 🙈" } : null;
  }
  if (active && /\b(?:cancel|never\s?mind|forget\s+it|leave\s+it)\b/i.test(a.text)) {
    awaiting.delete(key);
    return { reply: 'no problem, just ask me again whenever you want to pair 💕' };
  }
  const phone = extractPhone(a.text);
  if (!phone) {
    awaiting.set(key, Date.now() + WAIT_MS);
    return intent ? { reply: "sure! send me your WhatsApp number with the country code, digits only — for example 2348012345678 and I'll get your pairing code right away 💕" } : null;
  }
  if (phone.startsWith('0')) {
    awaiting.set(key, Date.now() + WAIT_MS);
    return { reply: 'put your country code instead of the 0 — for example 2348012345678 for Nigeria. send it again 🌸' };
  }
  awaiting.delete(key);
  return a.platform === 'wa' ? pairWA(a, phone) : pairTG(a, phone);
}

async function pairWA(a, phone) {
  const wp = require('./web-pair').api?.();
  if (!wp) return { reply: "i'm not ready to pair just yet — try again in a minute 🥺" };
  const r = await wp.issueCode(phone, 'chat:' + a.userId);
  if (r.body.alreadyLinked) return { reply: "that number is already linked to me! message me from it and i'll be right there 💕" };
  if (!r.body.ok) return { reply: r.body.error || "couldn't get a code right now — try again in a minute 🥺" };
  let tries = 0;
  const watch = setInterval(async () => {
    tries++;
    try {
      if (wp.connectedFor(phone)) {
        clearInterval(watch);
        await a.sock.sendMessage(a.replyJid, { text: `you're connected! i'm live on +${phone} now 🎉 just talk to me normally anytime 💕` });
      } else if (tries > 40) clearInterval(watch);
    } catch (_) { clearInterval(watch); }
  }, 5000);
  return { reply: `here's your pairing code: *${r.body.code}*\n\nopen WhatsApp on that number → Settings → Linked Devices → Link a Device → Link with phone number instead → type the code. it expires in about 3 minutes ⏳` };
}

async function pairTG(a, phone) {
  if (!a.pairTelegram) return { reply: "i can't pair from here just yet — try using the web page instead." };
  const out = await a.pairTelegram(phone);
  return { reply: out || 'on it! your pairing code will arrive in a few seconds 💕' };
}

/* ── game handlers ───────────────────────────────────────────────────────── */
const GAME_MENU_REPLY =
  `ooh a game! 🎮 which one do you want to play?\n\n` +
  `🧠 trivia — answer questions, first right wins\n` +
  `🎭 riddle — figure out my riddle\n` +
  `🔤 hangman — guess the word letter by letter\n` +
  `🔀 scramble — unscramble the word\n` +
  `🔗 word chain — each word starts where the last ended\n` +
  `🔢 number guess — guess a number between 1 and 100\n\n` +
  `just say the name of the game and i'll start it! 💕`;

async function gameHandler(a, intent) {
  if (intent.type === 'game_menu') {
    return { reply: GAME_MENU_REPLY };
  }
  // Specific game type — run the dot command behind the scenes
  if (!D) return null;
  const r = await D.handleCommand(intent.cmd, a.jid, a.userId, a.name, a.rawUserId, a.allMentionedJids || []);
  return r ? { reply: r } : null;
}

/* ── help reply ──────────────────────────────────────────────────────────── */
const HELP_REPLY =
  `here's what i can do 🌸\n\n` +
  `💰 *money* — earn with work, crime, beg, daily reward, check your balance, send money to friends\n` +
  `🎮 *games* — trivia, hangman, scramble, word chain, number guess, riddle — just tell me which!\n` +
  `👥 *group stuff* — anti-link, anti-spam, welcome messages, warnings, kick — just ask me naturally\n` +
  `🎵 *music* — ask me to play a song, e.g. "play Rema Calm Down"\n` +
  `⏰ *reminders* — say "remind me to [thing] in [time]" and i'll ping you\n` +
  `🔗 *pairing* — say "i want to pair" or "link my WhatsApp" and i'll walk you through it\n` +
  `🕐 *time & date* — just ask me what time or date it is\n` +
  `💬 *just chat* — i'm always here. ask me anything, i'll reply like a real person 💕\n\n` +
  `_you don't need any dots or commands — just talk to me normally!_`;

/* ── general command intent ──────────────────────────────────────────────── */
async function commandIntent(a, intent) {
  if (!D) return null;
  const r = await D.handleCommand(intent.cmd, a.jid, a.userId, a.name, a.rawUserId, a.allMentionedJids || []);
  return r ? { reply: r } : null;
}

/* ── protection features (WA) ────────────────────────────────────────────── */
const PENDING_KEY = 'natural_pending';
function loadPending() { try { return JSON.parse(D.kvGet(PENDING_KEY) || '{}'); } catch (_) { return {}; } }
function savePending(o) { try { D.kvSet(PENDING_KEY, JSON.stringify(o)); } catch (_) {} }
function addPending(jid, feature, by) {
  const all = loadPending(); const week = 7 * 24 * 3600 * 1000;
  const list = (all[jid] || []).filter(p => Date.now() - p.ts < week && p.feature !== feature);
  list.push({ feature, by, ts: Date.now() });
  all[jid] = list; savePending(all);
}
function takePending(jid) {
  const all = loadPending(); const week = 7 * 24 * 3600 * 1000;
  const list = (all[jid] || []).filter(p => Date.now() - p.ts < week);
  if (all[jid]) { delete all[jid]; savePending(all); }
  return list;
}
function peekPending(jid) {
  const week = 7 * 24 * 3600 * 1000;
  return (loadPending()[jid] || []).filter(p => Date.now() - p.ts < week);
}

function applyFeature(jid, feature) {
  const F = FEATURES[feature];
  if (feature === 'antiflood') { try { D.db.exec('ALTER TABLE group_settings ADD COLUMN antiflood_on INTEGER DEFAULT 0'); } catch (_) {} }
  D.setGroupSetting(jid, F.col, 1);
}

async function featureFlowWA(a, intent) {
  const F = FEATURES[intent.feature];
  const store = D.selfCtx.getStore();
  let meta = null;
  try { meta = await D.gtWaMeta(a.sock, a.jid); } catch (_) {}
  if (meta && store) {
    store.groupAdmin = D.gtWaIsAdmin(meta, a.senderJid) || D.gtWaIsAdmin(meta, a.msg?.key?.participant || '');
    store.botAdmin = D.gtWaBotIsAdmin(a.sock, meta);
  }
  const isMod = D.isSudo(a.userId) || !!store?.linked || !!store?.groupAdmin;
  if (!isMod) return { reply: `only group admins can change ${F.label.toLowerCase()} — ask an admin to tell me 🌸` };

  if (intent.value === 1 && F.needsAdmin && store && store.botAdmin === false) {
    addPending(a.jid, intent.feature, a.userId);
    return { reply: `i'd love to do that! but i need to be an admin first. make me a group admin and i'll turn ${F.label.toLowerCase()} on right away by myself 💕` };
  }
  const r = await D.handleCommand(`${F.cmd} ${intent.value ? 'on' : 'off'}`, a.jid, a.userId, a.name, a.rawUserId, a.allMentionedJids || []);
  return r ? { reply: r } : null;
}

async function adminDoneWA(a) {
  if (!peekPending(a.jid).length) return null;
  if (!/(?:made|make|set|put)\s+you\s+(?:an?\s+)?admin|you(?:'re|\s+are)\s+(?:now\s+)?(?:an?\s+)?admin|\bdone\b|\bcheck\s+again\b/i.test(a.text)) return null;
  let ok = false;
  try { const meta = await D.gtWaMeta(a.sock, a.jid, true); ok = D.gtWaBotIsAdmin(a.sock, meta); } catch (_) {}
  if (!ok) return { reply: "i still don't see admin on my side 🥺 make sure you picked me, then tell me again!" };
  const done = takePending(a.jid);
  done.forEach(p => { try { applyFeature(a.jid, p.feature); } catch (_) {} });
  return { reply: `thank you! i turned on: ${done.map(p => FEATURES[p.feature].label).join(', ')} 💕` };
}

/* ── main WA handler ─────────────────────────────────────────────────────── */
async function handleWA(a) {
  if (!D) return null;
  a.platform = 'wa';
  const intent = detect(a.text);

  if (a.isGroup) {
    const done = await adminDoneWA(a); if (done) return done;
    if (!intent) return null;
    if (intent.type === 'feature')   return featureFlowWA(a, intent);
    if (intent.type === 'pair')      return pairFlow(a, intent);
    if (intent.type === 'time' || intent.type === 'date' || intent.type === 'datetime') return timeHandler(intent.type);
    if (intent.type === 'help')      return { reply: HELP_REPLY };
    if (intent.type === 'game' || intent.type === 'game_menu') return gameHandler(a, intent);
    if (intent.type === 'command')   return commandIntent(a, intent);
    return null;
  }

  // DM branch — unreachable: all DMs are blocked in index.js (group-only mode).
  // Kept here in case DM mode is ever re-enabled; do not remove.
  if (!intent) return null;
  if (intent.type === 'feature') return { reply: 'add me to your group and ask me there — i can only change group settings inside the group 🌸' };
  if (intent.type === 'pair')    return pairFlow(a, intent);
  if (intent.type === 'time' || intent.type === 'date' || intent.type === 'datetime') return timeHandler(intent.type);
  if (intent.type === 'help')    return { reply: HELP_REPLY };
  if (intent.type === 'game' || intent.type === 'game_menu') return gameHandler(a, intent);
  if (intent.type === 'command') return commandIntent(a, intent);
  return null;
}

/* ── main TG handler ─────────────────────────────────────────────────────── */
async function handleTG(a) {
  if (!D) return null;
  a.platform = 'tg';
  const intent = detect(a.text);
  if (!intent) return null;

  if (intent.type === 'time' || intent.type === 'date' || intent.type === 'datetime') return timeHandler(intent.type);
  if (intent.type === 'help')    return { reply: HELP_REPLY };
  if (intent.type === 'game' || intent.type === 'game_menu') return gameHandler(a, intent);
  if (intent.type === 'command') return commandIntent(a, intent);

  if (intent.type === 'feature') {
    if (!a.isGroup) return { reply: 'ask me inside your group — i can only change group settings there 🌸' };
    const F = FEATURES[intent.feature];
    const r = await D.handleCommand(`${F.cmd} ${intent.value ? 'on' : 'off'}`, a.chatId, a.userId, a.name, a.rawUserId);
    return r ? { reply: r } : null;
  }
  return pairFlow(a, intent.type === 'pair' ? intent : null);
}

/* ── on-promote event (auto-apply pending features) ─────────────────────── */
const digits = j => String(j || '').split('@')[0].split(':')[0].replace(/\D/g, '');
async function onParticipants(sock, ev) {
  try {
    if (!D || !ev || ev.action !== 'promote') return;
    const pend = peekPending(ev.id);
    if (!pend.length) return;
    const own = [sock.user?.id, sock.user?.lid].map(digits).filter(Boolean);
    const ids = x => (typeof x === 'string' ? [x] : [x?.id, x?.lid, x?.phoneNumber, x?.jid]).filter(Boolean);
    if (!(ev.participants || []).some(p => ids(p).some(j => own.includes(digits(j))))) return;
    let ok = true;
    try { const meta = await D.gtWaMeta(sock, ev.id, true); ok = D.gtWaBotIsAdmin(sock, meta); } catch (_) {}
    if (!ok) return;
    const done = takePending(ev.id);
    done.forEach(p => { try { applyFeature(ev.id, p.feature); } catch (e) { console.error('[natural] apply', e.message); } });
    await sock.sendMessage(ev.id, { text: `thank you for making me admin! i turned on: ${done.map(p => FEATURES[p.feature].label).join(', ')} 💕` });
  } catch (e) { console.error('[natural] onParticipants', e.message); }
}

module.exports = { init, detect, looksAddressed, handleWA, handleTG, onParticipants, NAME_RE };
