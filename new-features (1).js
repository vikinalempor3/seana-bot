/**
 * ╔══════════════════════════════════════════════════════════╗
 * ║        SEANA BOT — NEW FEATURES MODULE v1.0              ║
 * ║  Drop-in expansion pack. Plug into your existing         ║
 * ║  handleEconomy / handleAura dispatch chain.              ║
 * ╚══════════════════════════════════════════════════════════╝
 *
 * HOW TO INTEGRATE (add to bottom of index.js, BEFORE final Telegraf start):
 *
 *   const newFeatures = require('./new-features');
 *   newFeatures.initDb(db);
 *
 * Then in your TG on('text') handler, right after handleEconomy():
 *   const nfReply = await newFeatures.handle(cmd, userId, name, args, chatId, { groq, db, isOwner, isSudo, addCash, addXP, getUser, randomInt, fmt });
 *   if (nfReply) { return humanReplyTG(ctx, nfReply); }
 *
 * Same pattern for WhatsApp in the isCmd branch.
 *
 * Commands added:
 *   .trivia              Daily AI trivia question (cash+XP reward)
 *   .triviaboard         Trivia leaderboard
 *   .badge / .badges     Achievement badge gallery
 *   .gift @user <amt>    Send cash as a gift with a flair message
 *   .horoscope <sign>    AI daily horoscope
 *   .roast <name>        AI roast (humorous, PG-13)
 *   .compliment @user    AI compliment for someone
 *   .rapbattle @user     AI-judged rap battle
 *   .vibe                AI vibe-check of recent chat energy
 *   .fact <claim>        AI truth meter on any claim
 *   .countdown add/list/del  Event countdowns
 *   .dice @user <bet>    Two-player dice roll gambling
 *   .crush @user         Anonymous secret crush (reveals if mutual)
 *   .wyr                 AI "Would You Rather" dilemma
 *   .tod                 AI Truth or Dare (group game)
 *   .birthday set/check  Set & wish birthdays
 *   .challenge           Daily community challenge
 *   .8ball <question>    Magic 8-ball with AI sass
 *   .rate <thing>        AI rates anything out of 10
 *   .translate <lang> <text>  Quick translation via AI
 *   .poem @user          AI writes a short poem for someone
 *   .debate <topic>      AI argues both sides of a topic
 *   .emoji <word>        AI converts a word/sentence into emojis
 */

'use strict';

// ── DB bootstrap ──────────────────────────────────────────────────────────────
function initDb(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS trivia_sessions (
      user_id   TEXT PRIMARY KEY,
      question  TEXT,
      answer    TEXT,
      asked_at  INTEGER,
      answered  INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS trivia_scores (
      user_id TEXT PRIMARY KEY,
      correct INTEGER DEFAULT 0,
      streak  INTEGER DEFAULT 0,
      last_at TEXT
    );
    CREATE TABLE IF NOT EXISTS achievements (
      user_id   TEXT NOT NULL,
      badge     TEXT NOT NULL,
      earned_at TEXT NOT NULL,
      PRIMARY KEY (user_id, badge)
    );
    CREATE TABLE IF NOT EXISTS countdowns (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id   TEXT NOT NULL,
      chat_id    TEXT NOT NULL,
      event_name TEXT NOT NULL,
      fire_at    INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS crushes (
      from_id TEXT NOT NULL,
      to_id   TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      set_at  TEXT NOT NULL,
      PRIMARY KEY (from_id, chat_id)
    );
    CREATE TABLE IF NOT EXISTS dice_duels (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      challenger TEXT NOT NULL,
      opponent   TEXT NOT NULL,
      bet        INTEGER NOT NULL,
      chat_id    TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      resolved   INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS birthdays (
      user_id   TEXT PRIMARY KEY,
      name      TEXT,
      birth_day INTEGER NOT NULL,
      birth_mon INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS challenges (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id    TEXT NOT NULL,
      challenge  TEXT NOT NULL,
      pot        INTEGER DEFAULT 0,
      target     INTEGER DEFAULT 10,
      joined     TEXT DEFAULT '[]',
      created_at INTEGER NOT NULL,
      completed  INTEGER DEFAULT 0
    );
  `);
  // Safe migrations
  for (const sql of [
    'ALTER TABLE trivia_scores ADD COLUMN streak INTEGER DEFAULT 0',
    'ALTER TABLE trivia_scores ADD COLUMN last_at TEXT',
  ]) { try { db.exec(sql); } catch (_) {} }
}

// ── BADGE DEFINITIONS ─────────────────────────────────────────────────────────
const BADGES = [
  { id: 'first_trivia',   label: '🎯 Trivia Rookie',    desc: 'Answer your first trivia question'       },
  { id: 'trivia_5',       label: '🧠 Quick Mind',        desc: 'Get 5 trivia answers correct'            },
  { id: 'trivia_25',      label: '🏆 Trivia Champion',   desc: 'Get 25 trivia answers correct'           },
  { id: 'trivia_streak3', label: '🔥 On Fire',           desc: '3-question trivia streak'                },
  { id: 'first_gift',     label: '🎁 Generous',          desc: 'Send your first gift'                    },
  { id: 'gift_10',        label: '💝 Big Heart',         desc: 'Send 10 gifts'                           },
  { id: 'birthday_set',   label: '🎂 Party Planner',     desc: 'Register your birthday'                  },
  { id: 'birthday_wish',  label: '🥳 Good Vibes',        desc: 'Wish someone happy birthday'             },
  { id: 'challenger',     label: '⚔️ Challenger',        desc: 'Start your first dice duel'              },
  { id: 'dice_win_5',     label: '🎲 Lucky Roller',      desc: 'Win 5 dice duels'                        },
  { id: 'crush_mutual',   label: '💞 Love Connection',   desc: 'Have a mutual crush revealed'            },
  { id: 'challenge_done', label: '💪 Community Hero',    desc: 'Complete a community challenge'          },
  { id: 'roast_king',     label: '🔥 Roast King',        desc: 'Get roasted 5 times (legend status)'    },
  { id: 'poet',           label: '✍️ Poet',              desc: 'Receive a poem written for you'          },
  { id: 'debate_master',  label: '⚖️ Debate Master',     desc: 'Trigger 10 AI debates'                  },
];

function awardBadge(db, userId, badgeId) {
  const badge = BADGES.find(b => b.id === badgeId);
  if (!badge) return null;
  const existing = db.prepare('SELECT 1 FROM achievements WHERE user_id=? AND badge=?').get(userId, badgeId);
  if (existing) return null;
  db.prepare('INSERT OR IGNORE INTO achievements (user_id,badge,earned_at) VALUES (?,?,?)').run(userId, badgeId, new Date().toISOString());
  return badge;
}

function checkAndAwardBadge(db, userId, badgeId) {
  const badge = awardBadge(db, userId, badgeId);
  return badge ? `\n\n🏅 *New Badge Unlocked:* ${badge.label}` : '';
}

// ── GROQ AI HELPERS ───────────────────────────────────────────────────────────
async function aiCall(groq, prompt, system, maxTokens = 400) {
  const res = await groq.chat.completions.create({
    model: 'openai/gpt-oss-120b',
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: system || 'You are a clever, witty assistant. Be concise and entertaining.' },
      { role: 'user',   content: prompt },
    ],
  });
  return (res.choices[0]?.message?.content || '').trim();
}

async function aiCallSafe(groq, prompt, system, maxTokens = 400) {
  try { return await aiCall(groq, prompt, system, maxTokens); }
  catch (e) { return null; }
}

// ── MAIN HANDLER ──────────────────────────────────────────────────────────────
/**
 * @param {string}   cmd      - e.g. '.trivia'
 * @param {string}   userId   - resolved user id
 * @param {string}   name     - display name
 * @param {string[]} args     - words after the command
 * @param {string}   chatId   - chat / group id
 * @param {object}   h        - helpers from main index: { groq, db, isOwner, isSudo, addCash, addXP, getUser, randomInt, fmt }
 * @returns {string|null}     - reply text, or null if command not handled
 */
async function handle(cmd, userId, name, args, chatId, h) {
  const { groq, db, isOwner, isSudo, addCash, addXP, getUser, randomInt, fmt } = h;
  const own = isOwner && isOwner(userId);
  const now = new Date();

  // ── 🎯 TRIVIA ──────────────────────────────────────────────────────────────
  if (cmd === '.trivia') {
    // Check if they have a pending question
    const pending = db.prepare('SELECT * FROM trivia_sessions WHERE user_id=? AND answered=0').get(userId);
    if (pending && Date.now() - pending.asked_at < 120000) {
      return `🎯 *Your trivia question is still open!*\n\n${pending.question}\n\n_Reply with .answer <your answer>_`;
    }

    // Cooldown: 1 per 10 minutes
    const scores = db.prepare('SELECT * FROM trivia_scores WHERE user_id=?').get(userId);
    if (scores && scores.last_at && !own) {
      const msAgo = Date.now() - new Date(scores.last_at).getTime();
      if (msAgo < 10 * 60 * 1000) {
        const minsLeft = Math.ceil((10 * 60 * 1000 - msAgo) / 60000);
        return `⏳ Trivia cooldown! Come back in ${minsLeft} min.\n\n🏆 Your score: ${scores.correct || 0} correct · 🔥 Streak: ${scores.streak || 0}`;
      }
    }

    const topics = ['science', 'history', 'geography', 'pop culture', 'music', 'sports', 'food', 'animals', 'technology', 'movies'];
    const topic = topics[randomInt(0, topics.length - 1)];
    const difficulty = own ? 'easy' : (scores?.correct >= 20 ? 'hard' : scores?.correct >= 10 ? 'medium' : 'easy');

    const raw = await aiCallSafe(groq,
      `Generate a single ${difficulty} trivia question about ${topic}. Format EXACTLY as:\nQUESTION: <question here>\nANSWER: <short answer, max 4 words>`,
      'You generate trivia questions. Keep answers short (1-4 words). Output only the QUESTION and ANSWER lines, nothing else.',
      120
    );
    if (!raw) return '❌ Trivia generator is resting. Try again in a moment.';

    const qLine = raw.match(/QUESTION:\s*(.+)/i)?.[1]?.trim();
    const aLine = raw.match(/ANSWER:\s*(.+)/i)?.[1]?.trim();
    if (!qLine || !aLine) return '❌ Got a weird question. Try .trivia again.';

    db.prepare('INSERT OR REPLACE INTO trivia_sessions (user_id,question,answer,asked_at,answered) VALUES (?,?,?,?,0)')
      .run(userId, qLine, aLine.toLowerCase(), Date.now());

    const reward = difficulty === 'hard' ? 800 : difficulty === 'medium' ? 400 : 200;
    return `🎯 *TRIVIA — ${difficulty.toUpperCase()}*\n━━━━━━━━━━━━━━━\n🏷️ Topic: ${topic}\n\n❓ ${qLine}\n\n_You have 2 minutes. Reply: .answer <your answer>_\n💰 Correct = +${fmt(reward)}${scores?.streak >= 2 ? ` (+streak bonus!)` : ''}`;
  }

  // ── .answer (trivia response) ────────────────────────────────────────────────
  if (cmd === '.answer') {
    const session = db.prepare('SELECT * FROM trivia_sessions WHERE user_id=? AND answered=0').get(userId);
    if (!session) return `❌ No active trivia question. Use .trivia to start one!`;
    if (Date.now() - session.asked_at > 120000) {
      db.prepare('UPDATE trivia_sessions SET answered=1 WHERE user_id=?').run(userId);
      return `⏰ Too slow! The answer was: *${session.answer}*\n\nTry .trivia again!`;
    }

    const guess = args.join(' ').toLowerCase().trim();
    const correct = session.answer.toLowerCase();
    const isCorrect = guess === correct || correct.includes(guess) || guess.includes(correct.split(' ')[0]);

    db.prepare('UPDATE trivia_sessions SET answered=1 WHERE user_id=?').run(userId);
    db.prepare('INSERT OR IGNORE INTO trivia_scores (user_id,correct,streak) VALUES (?,0,0)').run(userId);

    if (isCorrect) {
      const scores = db.prepare('SELECT * FROM trivia_scores WHERE user_id=?').get(userId);
      const streak = (scores?.streak || 0) + 1;
      const correct_count = (scores?.correct || 0) + 1;
      const base = correct_count >= 20 ? 800 : correct_count >= 10 ? 400 : 200;
      const streakBonus = streak >= 5 ? 500 : streak >= 3 ? 250 : 0;
      const total = base + streakBonus;

      addCash(userId, total);
      addXP(userId, 30);
      db.prepare('UPDATE trivia_scores SET correct=?,streak=?,last_at=? WHERE user_id=?')
        .run(correct_count, streak, now.toISOString(), userId);

      let badges = '';
      if (correct_count === 1) badges += checkAndAwardBadge(db, userId, 'first_trivia');
      if (correct_count === 5) badges += checkAndAwardBadge(db, userId, 'trivia_5');
      if (correct_count === 25) badges += checkAndAwardBadge(db, userId, 'trivia_25');
      if (streak === 3) badges += checkAndAwardBadge(db, userId, 'trivia_streak3');

      return `✅ *CORRECT!* 🎉\n\nAnswer: *${session.answer}*\n💰 Earned: +${fmt(total)}${streakBonus ? ` (🔥 streak x${streak} +${fmt(streakBonus)})` : ''}\n📊 Total correct: ${correct_count} · Streak: 🔥${streak}${badges}`;
    } else {
      db.prepare('UPDATE trivia_scores SET streak=0,last_at=? WHERE user_id=?').run(now.toISOString(), userId);
      return `❌ *WRONG!* The answer was: *${session.answer}*\n\nStreak lost. Try .trivia again in 10 minutes.`;
    }
  }

  // ── 🏆 TRIVIA LEADERBOARD ─────────────────────────────────────────────────
  if (cmd === '.triviaboard') {
    const top = db.prepare(`
      SELECT ts.user_id, ts.correct, ts.streak, u.name 
      FROM trivia_scores ts LEFT JOIN users u ON u.id=ts.user_id 
      ORDER BY ts.correct DESC LIMIT 10
    `).all();
    if (!top.length) return '🎯 No trivia played yet! Use .trivia to start.';
    const rows = top.map((r, i) => {
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
      return `${medal} ${r.name || r.user_id} — ${r.correct} correct · 🔥${r.streak} streak`;
    });
    return `🎯 *TRIVIA LEADERBOARD*\n━━━━━━━━━━━━━━━\n${rows.join('\n')}\n\n.trivia to play now!`;
  }

  // ── 🏅 BADGES / ACHIEVEMENTS ──────────────────────────────────────────────
  if (cmd === '.badges' || cmd === '.badge' || cmd === '.achievements') {
    const earned = db.prepare('SELECT badge,earned_at FROM achievements WHERE user_id=? ORDER BY earned_at DESC').all(userId);
    if (!earned.length) {
      const preview = BADGES.slice(0, 5).map(b => `${b.label} — ${b.desc}`).join('\n');
      return `🏅 *Your Badge Gallery*\n\nNo badges yet!\n\n*Earn your first:*\n${preview}\n\n...and ${BADGES.length - 5} more`;
    }
    const rows = earned.map(e => {
      const b = BADGES.find(x => x.id === e.badge);
      return b ? `${b.label}` : e.badge;
    });
    const locked = BADGES.filter(b => !earned.find(e => e.badge === b.id));
    return `🏅 *${name}'s Badges* (${earned.length}/${BADGES.length})\n━━━━━━━━━━━━━━━\n${rows.join('\n')}\n\n🔒 *${locked.length} locked:* ${locked.slice(0, 3).map(b => b.label).join(', ')}...`;
  }

  // ── 🎁 GIFT ───────────────────────────────────────────────────────────────
  if (cmd === '.gift') {
    const targetName = args[0]?.replace('@', '');
    const amount = parseInt(args[1]);
    if (!targetName || !amount || amount <= 0) {
      return '😒 .gift <@user or name> <amount>\nExample: .gift @Sarah 500\n\nSend cash as a heartfelt gift 🎁';
    }
    if (amount < 50) return '🎁 Minimum gift is 50 naura. Show a little more love!';

    const sender = getUser(userId, name);
    if (!own && sender.cash < amount) {
      return `❌ Not enough naura. You have ${fmt(sender.cash)}, gift costs ${fmt(amount)}.`;
    }

    const target = db.prepare("SELECT * FROM users WHERE LOWER(name)=LOWER(?) LIMIT 1").get(targetName)
                || db.prepare("SELECT * FROM users WHERE id=? LIMIT 1").get('tg_' + targetName);
    if (!target) return `❌ "${targetName}" not found. They need to have chatted with the bot.`;
    if (target.id === userId) return '😒 You cannot gift yourself. Share the love!';

    if (!own) addCash(userId, -amount);
    addCash(target.id, amount);
    addXP(userId, 20);

    const giftCount = db.prepare("SELECT COUNT(*) as c FROM notes WHERE user_id=? AND title='__gifts_sent__'").get(userId)?.c || 0;
    db.prepare("INSERT INTO notes (user_id,title,content,created_at) VALUES (?,?,?,?) ON CONFLICT(user_id,title) DO UPDATE SET content=?")
      .run(userId, '__gifts_sent__', String(giftCount + 1), now.toISOString(), String(giftCount + 1));

    const giftLines = [
      `🎁 ${name} slid ${fmt(amount)} to ${target.name} like a boss. Generous energy.`,
      `💝 ${name} just gifted ${target.name} ${fmt(amount)}. Heart of gold detected.`,
      `🎀 ${name} dropped ${fmt(amount)} on ${target.name}. The rich share their riches.`,
      `✨ ${name} blessed ${target.name} with ${fmt(amount)}. Manifested and delivered.`,
    ];
    const msg = giftLines[randomInt(0, giftLines.length - 1)];

    let badges = '';
    if (giftCount === 0) badges += checkAndAwardBadge(db, userId, 'first_gift');
    if (giftCount + 1 === 10) badges += checkAndAwardBadge(db, userId, 'gift_10');

    return `${msg}${badges}`;
  }

  // ── 🔮 HOROSCOPE ─────────────────────────────────────────────────────────
  if (cmd === '.horoscope') {
    const SIGNS = ['aries','taurus','gemini','cancer','leo','virgo','libra','scorpio','sagittarius','capricorn','aquarius','pisces'];
    const sign = (args[0] || '').toLowerCase().replace(/[^a-z]/g, '');
    if (!sign || !SIGNS.includes(sign)) {
      return `🔮 *HOROSCOPE*\n\nSigns: ${SIGNS.join(', ')}\n\nUsage: .horoscope <sign>\nExample: .horoscope scorpio`;
    }

    const result = await aiCallSafe(groq,
      `Write a short, fun, slightly cheeky daily horoscope for ${sign}. 3-4 sentences. Be entertaining, mix positivity with playful warnings. End with a lucky number between 1-99.`,
      'You are a witty astrologer. Be fun, engaging, and a tiny bit dramatic. Keep it to 3-4 sentences.',
      200
    );
    if (!result) return '🔮 The stars are clouded right now. Try again soon.';

    const emoji = { aries:'♈', taurus:'♉', gemini:'♊', cancer:'♋', leo:'♌', virgo:'♍',
                    libra:'♎', scorpio:'♏', sagittarius:'♐', capricorn:'♑', aquarius:'♒', pisces:'♓' };
    return `${emoji[sign] || '🔮'} *${sign.toUpperCase()} HOROSCOPE*\n━━━━━━━━━━━━━━━\n${result}`;
  }

  // ── 😂 ROAST ─────────────────────────────────────────────────────────────
  if (cmd === '.roast') {
    const target = args.join(' ').trim() || name;
    const result = await aiCallSafe(groq,
      `Write a funny, playful roast of someone named "${target}". Keep it PG-13, humorous, not truly mean. 2-3 sentences max. Be witty and creative.`,
      'You write playful, funny roasts. Never be genuinely hurtful, racist, or offensive. Keep it lighthearted and comedic.',
      180
    );
    if (!result) return '🔥 The roast machine is cooling down. Try again!';

    // Track roast count for the roastee (if they're in the db)
    if (target !== name) {
      const roastee = db.prepare("SELECT id FROM users WHERE LOWER(name)=LOWER(?) LIMIT 1").get(target);
      if (roastee) {
        const roastCount = db.prepare("SELECT COUNT(*) as c FROM notes WHERE user_id=? AND title='__roasted__'").get(roastee.id)?.c || 0;
        db.prepare("INSERT INTO notes (user_id,title,content,created_at) VALUES (?,?,?,?) ON CONFLICT(user_id,title) DO UPDATE SET content=?")
          .run(roastee.id, '__roasted__', String(roastCount + 1), now.toISOString(), String(roastCount + 1));
        if (roastCount + 1 === 5) checkAndAwardBadge(db, roastee.id, 'roast_king');
      }
    }
    return `🔥 *ROAST — ${target}*\n━━━━━━━━━━━━━━━\n${result}`;
  }

  // ── 💬 COMPLIMENT ────────────────────────────────────────────────────────
  if (cmd === '.compliment') {
    const target = args.join(' ').replace('@', '').trim() || name;
    const result = await aiCallSafe(groq,
      `Write a heartfelt, genuine compliment for someone named "${target}". Make it warm, specific, and uplifting. 2-3 sentences.`,
      'You write beautiful, sincere compliments. Be warm, thoughtful, and uplifting. Avoid clichés.',
      150
    );
    if (!result) return '💕 The compliment engine is warming up. Try again!';

    // Award poet badge to the person who received the poem/compliment
    const targetUser = db.prepare("SELECT id FROM users WHERE LOWER(name)=LOWER(?) LIMIT 1").get(target);
    let badge = '';
    if (targetUser) badge = checkAndAwardBadge(db, targetUser.id, 'poet');

    return `💕 *COMPLIMENT FOR ${target.toUpperCase()}*\n━━━━━━━━━━━━━━━\n${result}${badge}`;
  }

  // ── ⚡ RAP BATTLE ────────────────────────────────────────────────────────
  if (cmd === '.rapbattle') {
    const opponent = args[0]?.replace('@', '') || '';
    if (!opponent) return '🎤 .rapbattle <@opponent name>\nExample: .rapbattle @John';

    const result = await aiCallSafe(groq,
      `Write a fun 2-verse rap battle between "${name}" and "${opponent}". Each gets 2 short rap lines. Then declare a winner and explain why in one line. Keep it playful and entertaining.`,
      'You are a hip-hop battle MC. Write fun, competitive rap battles. Keep it clean, witty, and hype.',
      350
    );
    if (!result) return '🎤 The beat machine is down. Try again!';

    return `🎤 *RAP BATTLE*\n━━━━━━━━━━━━━━━\n${result}\n\n_👑 May the best rapper win!_`;
  }

  // ── 🌡️ VIBE CHECK ───────────────────────────────────────────────────────
  if (cmd === '.vibe') {
    const vibes = ['🔥 This chat is LIT', '😴 Dead chat energy', '💅 Main character vibes only',
      '🤯 Chaotic neutral energy', '✨ Positive and thriving', '😤 Heated in here',
      '🥶 Ice cold, someone warm it up', '💭 Deep thinker mode activated', '🎉 Party mode: ON'];
    const vibe = vibes[randomInt(0, vibes.length - 1)];

    const result = await aiCallSafe(groq,
      `Give a quick, fun "vibe check" reading for a group chat right now. The current vibe detected is: "${vibe.replace(/[^a-zA-Z ]/g, '')}". Explain what that means for the group in 2-3 entertaining sentences.`,
      'You are a vibe analyst. Be fun, a bit sassy, and entertaining. Keep it short.',
      150
    );
    const extra = result ? `\n\n${result}` : '';
    return `🌡️ *VIBE CHECK*\n━━━━━━━━━━━━━━━\n${vibe}${extra}`;
  }

  // ── ✅ FACT CHECK ────────────────────────────────────────────────────────
  if (cmd === '.fact') {
    const claim = args.join(' ').trim();
    if (!claim) return '🔍 .fact <claim>\nExample: .fact the sky is green\n\nAI will rate if it\'s true or false!';

    const result = await aiCallSafe(groq,
      `Fact-check this claim: "${claim}"\n\nGive: (1) a truth rating from 0-100%, (2) a one-line verdict (TRUE/FALSE/PARTIALLY TRUE/MYTH), (3) a 1-2 sentence explanation. Be accurate and clear.`,
      'You are a fact-checker. Be accurate, concise, and clear. Always give a percentage and verdict.',
      200
    );
    if (!result) return '🔍 Fact checker is busy. Try again!';
    return `🔍 *FACT CHECK*\n━━━━━━━━━━━━━━━\n*Claim:* ${claim}\n\n${result}`;
  }

  // ── ⏳ COUNTDOWN ─────────────────────────────────────────────────────────
  if (cmd === '.countdown') {
    const sub = (args[0] || '').toLowerCase();

    if (sub === 'add') {
      const datePart = args[args.length - 1];
      const eventName = args.slice(1, -1).join(' ').trim();
      if (!eventName || !datePart) return '😒 .countdown add <event name> <date>\nExample: .countdown add My Birthday 2025-08-15';
      const ts = new Date(datePart).getTime();
      if (isNaN(ts)) return '❌ Invalid date. Use format: YYYY-MM-DD';
      if (ts < Date.now()) return '❌ That date is in the past!';
      db.prepare('INSERT INTO countdowns (owner_id,chat_id,event_name,fire_at,created_at) VALUES (?,?,?,?,?)')
        .run(userId, chatId, eventName.slice(0, 50), ts, now.toISOString());
      const days = Math.ceil((ts - Date.now()) / 86400000);
      return `⏳ *COUNTDOWN SET!*\n\n🗓️ Event: *${eventName}*\n📅 Date: ${datePart}\n⏰ That's *${days} days* from now!\n\n.countdown list to see all your countdowns`;
    }

    if (sub === 'list') {
      const rows = db.prepare('SELECT * FROM countdowns WHERE owner_id=? AND fire_at > ? ORDER BY fire_at ASC').all(userId, Date.now());
      if (!rows.length) return '⏳ No active countdowns.\n\n.countdown add <event> <date> to create one!';
      const lines = rows.map(r => {
        const days = Math.ceil((r.fire_at - Date.now()) / 86400000);
        return `• *${r.event_name}* — ${days} day${days !== 1 ? 's' : ''} left (ID: ${r.id})`;
      });
      return `⏳ *YOUR COUNTDOWNS*\n━━━━━━━━━━━━━━━\n${lines.join('\n')}\n\n.countdown del <id> to remove`;
    }

    if (sub === 'del') {
      const id = parseInt(args[1]);
      if (!id) return '😒 .countdown del <id>\nGet IDs from .countdown list';
      const row = db.prepare('SELECT * FROM countdowns WHERE id=? AND owner_id=?').get(id, userId);
      if (!row) return '❌ Countdown not found or not yours.';
      db.prepare('DELETE FROM countdowns WHERE id=?').run(id);
      return `✅ Countdown "${row.event_name}" deleted.`;
    }

    const rows = db.prepare('SELECT * FROM countdowns WHERE chat_id=? AND fire_at > ? ORDER BY fire_at ASC LIMIT 5').all(chatId, Date.now());
    if (!rows.length) return `⏳ *COUNTDOWNS*\n\nNo active countdowns in this chat.\n\n.countdown add <event> <date> to create one!`;
    const lines = rows.map(r => {
      const days = Math.ceil((r.fire_at - Date.now()) / 86400000);
      return `• *${r.event_name}* — ${days} day${days !== 1 ? 's' : ''} left`;
    });
    return `⏳ *UPCOMING EVENTS*\n━━━━━━━━━━━━━━━\n${lines.join('\n')}\n\n.countdown add <event> <date> to add one`;
  }

  // ── 🎲 DICE DUEL ─────────────────────────────────────────────────────────
  if (cmd === '.dice') {
    const targetName = args[0]?.replace('@', '');
    const bet = parseInt(args[1]);
    if (!targetName || !bet || bet <= 0) {
      return '🎲 .dice <@opponent> <bet amount>\nExample: .dice @John 500\n\nBoth players roll a dice. Highest wins the pot!';
    }
    if (bet < 100) return '🎲 Minimum dice bet is 100 naura.';

    const sender = getUser(userId, name);
    if (!own && sender.cash < bet) return `❌ Not enough naura. You have ${fmt(sender.cash)}.`;

    const target = db.prepare("SELECT * FROM users WHERE LOWER(name)=LOWER(?) LIMIT 1").get(targetName);
    if (!target) return `❌ "${targetName}" not found.`;
    if (target.id === userId) return '😒 Cannot duel yourself.';
    if (!own && target.cash < bet) return `❌ ${target.name} doesn't have ${fmt(bet)} to match. They have ${fmt(target.cash)}.`;

    // Both roll immediately (no async accept needed — bot rolls for both)
    const roll1 = randomInt(1, 6);
    const roll2 = randomInt(1, 6);
    const dice = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

    if (!own) {
      addCash(userId, -bet);
      addCash(target.id, -bet);
    }

    let resultLine, winnerId;
    if (roll1 > roll2) {
      addCash(userId, bet * 2);
      addXP(userId, 25);
      winnerId = userId;
      resultLine = `🏆 *${name} WINS!* +${fmt(bet * 2)}`;
    } else if (roll2 > roll1) {
      addCash(target.id, bet * 2);
      addXP(target.id, 25);
      winnerId = target.id;
      resultLine = `🏆 *${target.name} WINS!* +${fmt(bet * 2)}`;
    } else {
      // Tie: refund both
      if (!own) { addCash(userId, bet); addCash(target.id, bet); }
      resultLine = `🤝 *TIE! Both get refunded.*`;
    }

    let badge = '';
    if (winnerId === userId) {
      checkAndAwardBadge(db, userId, 'challenger');
      // Check dice wins
      const diceWins = db.prepare("SELECT COUNT(*) as c FROM notes WHERE user_id=? AND title='__dice_wins__'").get(userId)?.c || 0;
      db.prepare("INSERT INTO notes (user_id,title,content,created_at) VALUES (?,?,?,?) ON CONFLICT(user_id,title) DO UPDATE SET content=?")
        .run(userId, '__dice_wins__', String(diceWins + 1), now.toISOString(), String(diceWins + 1));
      if (diceWins + 1 === 5) badge = checkAndAwardBadge(db, userId, 'dice_win_5');
    }

    return `🎲 *DICE DUEL*\n━━━━━━━━━━━━━━━\n${name}: ${dice[roll1 - 1]} (${roll1})\n${target.name}: ${dice[roll2 - 1]} (${roll2})\n\n${resultLine}${badge}`;
  }

  // ── 💌 SECRET CRUSH ──────────────────────────────────────────────────────
  if (cmd === '.crush') {
    const targetName = args[0]?.replace('@', '');
    if (!targetName) return '💌 .crush <name>\nSet a secret crush! Reveals only if it\'s mutual 🤫';

    const target = db.prepare("SELECT * FROM users WHERE LOWER(name)=LOWER(?) LIMIT 1").get(targetName);
    if (!target) return `❌ "${targetName}" not found.`;
    if (target.id === userId) return '💔 You can\'t crush on yourself. Confidence is cute but this is too much.';

    // Check if already set
    const existing = db.prepare('SELECT * FROM crushes WHERE from_id=? AND chat_id=?').get(userId, chatId);
    if (existing) return `💌 You already have a crush in this chat.\n\nChange it: .crush <new name>`;

    // Set the crush
    db.prepare('INSERT OR REPLACE INTO crushes (from_id,to_id,chat_id,set_at) VALUES (?,?,?,?)')
      .run(userId, target.id, chatId, now.toISOString());

    // Check if target already crushes on YOU
    const mutual = db.prepare('SELECT * FROM crushes WHERE from_id=? AND to_id=? AND chat_id=?').get(target.id, userId, chatId);
    if (mutual) {
      // REVEAL! Delete both entries
      db.prepare('DELETE FROM crushes WHERE (from_id=? AND to_id=?) OR (from_id=? AND to_id=?) AND chat_id=?')
        .run(userId, target.id, target.id, userId, chatId);
      checkAndAwardBadge(db, userId, 'crush_mutual');
      checkAndAwardBadge(db, target.id, 'crush_mutual');
      return `💞 *MUTUAL CRUSH REVEALED!*\n━━━━━━━━━━━━━━━\n💘 ${name} and ${target.name} have been crushing on each other!\n\nCupid has done his job. The rest is up to you two 💕`;
    }

    return `💌 Crush set! Your secret is safe.\n\nIf ${target.name} also uses .crush ${name}, it will be revealed as mutual! 🤫`;
  }

  // ── 🤔 WOULD YOU RATHER ─────────────────────────────────────────────────
  if (cmd === '.wyr') {
    const result = await aiCallSafe(groq,
      'Generate a fun "Would You Rather" dilemma. Make it interesting, funny, or thought-provoking. Format: "Would you rather A or B?" Make both options clearly bad OR both clearly tempting.',
      'You generate creative Would You Rather questions. Be creative and entertaining. Output ONLY the question.',
      100
    );
    if (!result) return '🤔 Ideas generator is thinking... Try again!';
    return `🤔 *WOULD YOU RATHER?*\n━━━━━━━━━━━━━━━\n${result}\n\nComment your choice! 👇`;
  }

  // ── 🎭 TRUTH OR DARE ─────────────────────────────────────────────────────
  if (cmd === '.tod') {
    const type = (args[0] || '').toLowerCase();
    const isTruth = type === 't' || type === 'truth';
    const isDare = type === 'd' || type === 'dare';

    if (!isTruth && !isDare) {
      return '🎭 *TRUTH OR DARE*\n\n.tod truth — get a truth question\n.tod dare — get a dare\n\nPlay with friends in the group!';
    }

    const result = await aiCallSafe(groq,
      isTruth
        ? 'Generate a fun, slightly embarrassing truth question for a group game. Keep it PG-13 and appropriate. Make it revealing but not too personal.'
        : 'Generate a fun, entertaining dare for a group game. Make it doable but slightly challenging. Keep it PG-13. No harm to anyone.',
      'You create fun Truth or Dare prompts for groups. Keep them entertaining, appropriate, and fun.',
      120
    );
    if (!result) return '🎭 Game master is thinking... Try again!';

    const emoji = isTruth ? '🤔' : '⚡';
    const label = isTruth ? 'TRUTH' : 'DARE';
    return `${emoji} *${label} — for ${name}*\n━━━━━━━━━━━━━━━\n${result}`;
  }

  // ── 🎂 BIRTHDAY ──────────────────────────────────────────────────────────
  if (cmd === '.birthday') {
    const sub = (args[0] || '').toLowerCase();

    if (sub === 'set') {
      const dateStr = args[1];
      if (!dateStr) return '🎂 .birthday set <MM-DD>\nExample: .birthday set 08-15';
      const match = dateStr.match(/^(\d{1,2})-(\d{1,2})$/);
      if (!match || Number(match[1]) < 1 || Number(match[1]) > 12 || Number(match[2]) < 1 || Number(match[2]) > 31) {
        return '❌ Invalid format. Use MM-DD (e.g. 08-15 for August 15th)';
      }
      db.prepare('INSERT OR REPLACE INTO birthdays (user_id,name,birth_mon,birth_day) VALUES (?,?,?,?)')
        .run(userId, name, Number(match[1]), Number(match[2]));
      const badge = checkAndAwardBadge(db, userId, 'birthday_set');
      return `🎂 Birthday set! I'll remember you were born on ${dateStr}${badge}\n\nOthers can check: .birthday check ${name}`;
    }

    if (sub === 'check') {
      const who = args[1]?.replace('@', '') || name;
      const row = db.prepare("SELECT * FROM birthdays WHERE LOWER(name)=LOWER(?) LIMIT 1").get(who);
      if (!row) return `❓ ${who} hasn't set their birthday yet.\n\nSet yours: .birthday set MM-DD`;
      const today = now;
      const bday = new Date(today.getFullYear(), row.birth_mon - 1, row.birth_day);
      if (bday < today) bday.setFullYear(today.getFullYear() + 1);
      const days = Math.ceil((bday - today) / 86400000);
      const isTodayBday = today.getMonth() + 1 === row.birth_mon && today.getDate() === row.birth_day;

      if (isTodayBday) {
        addXP(userId, 10); // bonus for wishing
        checkAndAwardBadge(db, userId, 'birthday_wish');
        return `🎉 *IT'S ${who.toUpperCase()}'S BIRTHDAY TODAY!* 🎂\n\n🎈 Happy Birthday ${who}! Hope your day is amazing! 🥳`;
      }
      return `🎂 *${who}'s Birthday*\n\n📅 ${row.birth_mon.toString().padStart(2, '0')}-${row.birth_day.toString().padStart(2, '0')}\n⏰ ${days} days until their next birthday!`;
    }

    // List upcoming birthdays
    const allBdays = db.prepare('SELECT * FROM birthdays').all();
    const upcoming = allBdays.map(r => {
      const bday = new Date(now.getFullYear(), r.birth_mon - 1, r.birth_day);
      if (bday < now) bday.setFullYear(now.getFullYear() + 1);
      return { ...r, days: Math.ceil((bday - now) / 86400000) };
    }).sort((a, b) => a.days - b.days).slice(0, 7);

    if (!upcoming.length) return '🎂 No birthdays registered yet!\n\n.birthday set MM-DD to add yours.';
    const rows = upcoming.map(r => {
      const tag = r.days === 0 ? '🎉 TODAY!' : `in ${r.days}d`;
      return `• *${r.name}* — ${r.birth_mon.toString().padStart(2,'0')}-${r.birth_day.toString().padStart(2,'0')} (${tag})`;
    });
    return `🎂 *UPCOMING BIRTHDAYS*\n━━━━━━━━━━━━━━━\n${rows.join('\n')}\n\n.birthday set MM-DD to register yours!`;
  }

  // ── 💪 COMMUNITY CHALLENGE ───────────────────────────────────────────────
  if (cmd === '.challenge') {
    const sub = (args[0] || '').toLowerCase();

    // View or create current challenge
    const active = db.prepare('SELECT * FROM challenges WHERE chat_id=? AND completed=0 AND created_at > ? ORDER BY id DESC LIMIT 1')
      .get(chatId, new Date(Date.now() - 24 * 3600000).toISOString());

    if (!active || sub === 'new') {
      if (!own && !isSudo(userId) && active) return `💪 A challenge is already active! Use .challenge join to participate.`;
      const challenges = [
        'Everyone send a motivational quote!',
        'Drop your funniest meme description in text!',
        'Share one thing you\'re grateful for today!',
        'Tell the group one skill you have that nobody knows about!',
        'Describe yourself in exactly 3 emojis!',
        'Share a life hack that changed your life!',
        'Tell us your hot take on something everyone agrees with!',
      ];
      const challengeText = challenges[randomInt(0, challenges.length - 1)];
      const target = 5; // need 5 participants
      const { lastInsertRowid } = db.prepare('INSERT INTO challenges (chat_id,challenge,pot,target,joined,created_at) VALUES (?,?,?,?,?,?)')
        .run(chatId, challengeText, 0, target, JSON.stringify([userId]), now.toISOString());
      addCash(userId, -100); // entry fee
      return `💪 *COMMUNITY CHALLENGE!*\n━━━━━━━━━━━━━━━\n📋 ${challengeText}\n\n🎯 Need ${target} participants\n💰 Pot: 100 naura\n\n_Join with .challenge join (costs 100 naura)_\n_Completes when ${target} people join!_`;
    }

    if (sub === 'join') {
      const joined = JSON.parse(active.joined || '[]');
      if (joined.includes(userId)) return '💪 Already in this challenge!';
      const sender = getUser(userId, name);
      if (!own && sender.cash < 100) return '❌ Need 100 naura to join the challenge.';
      if (!own) addCash(userId, -100);
      joined.push(userId);
      const newPot = (active.pot || 0) + 100;
      db.prepare('UPDATE challenges SET joined=?,pot=? WHERE id=?').run(JSON.stringify(joined), newPot, active.id);

      if (joined.length >= active.target) {
        // Challenge complete! Split pot among participants
        db.prepare('UPDATE challenges SET completed=1 WHERE id=?').run(active.id);
        const share = Math.floor(newPot * 1.2 / joined.length); // 20% bonus
        for (const uid of joined) {
          addCash(uid, share);
          addXP(uid, 50);
          checkAndAwardBadge(db, uid, 'challenge_done');
        }
        return `🏆 *CHALLENGE COMPLETE!*\n━━━━━━━━━━━━━━━\n📋 ${active.challenge}\n\n🎉 All ${joined.length} participants joined!\n💰 Each earns: +${fmt(share)}\n\nNew challenge coming! Try .challenge new`;
      }
      return `💪 Joined the challenge! (${joined.length}/${active.target})\n💰 Pot now: ${fmt(newPot)}\n📋 ${active.challenge}`;
    }

    if (sub === 'info' || !sub) {
      const joined = JSON.parse(active.joined || '[]');
      const participants = joined.map(uid => {
        const u = db.prepare('SELECT name FROM users WHERE id=?').get(uid);
        return u?.name || uid;
      }).join(', ');
      return `💪 *ACTIVE CHALLENGE*\n━━━━━━━━━━━━━━━\n📋 ${active.challenge}\n👥 Joined: ${joined.length}/${active.target}\n💰 Pot: ${fmt(active.pot || 0)}\n👤 Participants: ${participants || 'none yet'}\n\n.challenge join to participate!`;
    }
  }

  // ── 🎱 MAGIC 8-BALL ──────────────────────────────────────────────────────
  if (cmd === '.8ball') {
    const question = args.join(' ').trim();
    if (!question) return '🎱 .8ball <your question>\nExample: .8ball Will I be rich?';

    const responses = [
      '✅ It is certain', '✅ Without a doubt', '✅ Yes definitely', '✅ You may rely on it',
      '✅ As I see it, yes', '✅ Most likely', '✅ Outlook good', '✅ Signs point to yes',
      '🤷 Reply hazy, try again', '🤷 Ask again later', '🤷 Better not tell you now',
      '🤷 Cannot predict now', '🤷 Concentrate and ask again',
      '❌ Don\'t count on it', '❌ My reply is no', '❌ My sources say no',
      '❌ Outlook not so good', '❌ Very doubtful',
    ];
    const answer = responses[randomInt(0, responses.length - 1)];

    // 20% chance of AI adding a sassy comment
    let extra = '';
    if (randomInt(1, 5) === 1) {
      const comment = await aiCallSafe(groq,
        `The magic 8-ball answered "${answer}" to the question "${question}". Add a single sassy, funny one-liner response to this in the 8-ball's voice.`,
        'You are a sassy, witty magic 8-ball.',
        60
      );
      if (comment) extra = `\n\n_🎱 ${comment}_`;
    }
    return `🎱 *MAGIC 8-BALL*\n━━━━━━━━━━━━━━━\n❓ ${question}\n\n*${answer}*${extra}`;
  }

  // ── ⭐ RATE ───────────────────────────────────────────────────────────────
  if (cmd === '.rate') {
    const thing = args.join(' ').trim();
    if (!thing) return '⭐ .rate <anything>\nExample: .rate pizza\n\nI\'ll rate anything from 0-10!';

    const result = await aiCallSafe(groq,
      `Rate "${thing}" on a scale of 0-10. Give: (1) the score like "X/10", (2) a one-sentence creative reason. Be witty and entertaining. Keep it under 2 sentences total.`,
      'You are a funny, creative rater. Rate things entertainingly. Always include a score in X/10 format.',
      100
    );
    if (!result) return '⭐ Rating machine is calibrating. Try again!';
    return `⭐ *RATING: ${thing.toUpperCase()}*\n━━━━━━━━━━━━━━━\n${result}`;
  }

  // ── 🌐 TRANSLATE ─────────────────────────────────────────────────────────
  if (cmd === '.translate' || cmd === '.tr') {
    const lang = args[0];
    const text = args.slice(1).join(' ').trim();
    if (!lang || !text) return '🌐 .translate <language> <text>\nExample: .translate French Hello, how are you?';

    const result = await aiCallSafe(groq,
      `Translate the following text to ${lang}. Output ONLY the translated text, nothing else: "${text}"`,
      'You are a professional translator. Output ONLY the translated text with no explanation or preamble.',
      200
    );
    if (!result) return '🌐 Translator is resting. Try again!';
    return `🌐 *${lang.toUpperCase()}*\n${result}`;
  }

  // ── ✍️ POEM ───────────────────────────────────────────────────────────────
  if (cmd === '.poem') {
    const about = args.join(' ').replace('@', '').trim() || name;
    const styles = ['haiku', 'short rhyming poem', 'limerick', 'acrostic'];
    const style = styles[randomInt(0, styles.length - 1)];

    const result = await aiCallSafe(groq,
      `Write a ${style} about "${about}". Make it creative, fun, and appropriate. Keep it short (3-6 lines max).`,
      'You are a creative poet. Write fun, entertaining short poems. Keep them concise and well-crafted.',
      150
    );
    if (!result) return '✍️ The muse is sleeping. Try again!';

    const target = db.prepare("SELECT id FROM users WHERE LOWER(name)=LOWER(?) LIMIT 1").get(about);
    let badge = '';
    if (target && target.id !== userId) badge = checkAndAwardBadge(db, target.id, 'poet');

    return `✍️ *A ${style.toUpperCase()} FOR ${about.toUpperCase()}*\n━━━━━━━━━━━━━━━\n${result}${badge}`;
  }

  // ── ⚖️ DEBATE ────────────────────────────────────────────────────────────
  if (cmd === '.debate') {
    const topic = args.join(' ').trim();
    if (!topic) return '⚖️ .debate <topic>\nExample: .debate cats vs dogs\n\nAI argues both sides!';

    const result = await aiCallSafe(groq,
      `Briefly debate the topic "${topic}". Present one strong argument FOR and one strong argument AGAINST. Keep each side to 2 sentences. Then give a cheeky verdict.`,
      'You are a witty debate moderator. Present both sides fairly, then give a funny verdict. Be concise and entertaining.',
      300
    );
    if (!result) return '⚖️ The debate chamber is in session. Try again!';

    // Track debate count for badge
    const debateCount = db.prepare("SELECT COUNT(*) as c FROM notes WHERE user_id=? AND title='__debates__'").get(userId)?.c || 0;
    db.prepare("INSERT INTO notes (user_id,title,content,created_at) VALUES (?,?,?,?) ON CONFLICT(user_id,title) DO UPDATE SET content=?")
      .run(userId, '__debates__', String(debateCount + 1), now.toISOString(), String(debateCount + 1));
    let badge = '';
    if (debateCount + 1 === 10) badge = checkAndAwardBadge(db, userId, 'debate_master');

    return `⚖️ *DEBATE: ${topic.toUpperCase()}*\n━━━━━━━━━━━━━━━\n${result}${badge}`;
  }

  // ── 🎭 EMOJI TRANSLATE ───────────────────────────────────────────────────
  if (cmd === '.emoji') {
    const text = args.join(' ').trim();
    if (!text) return '🎭 .emoji <word or sentence>\nExample: .emoji I love pizza\n\nConverts your text to emojis!';

    const result = await aiCallSafe(groq,
      `Convert this text to emojis only (no words): "${text}". Use relevant emojis creatively. Output ONLY emojis, 3-8 of them.`,
      'You convert text to emoji sequences. Output ONLY emojis, no text.',
      50
    );
    if (!result) return '🎭 Emoji brain is rebooting. Try again!';
    return `🎭 *EMOJI VERSION*\n\n"${text}"\n\n→ ${result}`;
  }

  // ── .newfeatures HELP ─────────────────────────────────────────────────────
  if (cmd === '.newfeatures' || cmd === '.nf') {
    return `✨ *NEW FEATURES*\n━━━━━━━━━━━━━━━
🎯 .trivia — Daily trivia for cash
🏅 .badges — Your achievement gallery
🎁 .gift @user amt — Send gifts with flair
🔮 .horoscope sign — Daily star reading
😂 .roast name — AI roasts someone
💕 .compliment @user — Heartfelt compliment
🎤 .rapbattle @user — AI rap battle
🌡️ .vibe — Group vibe check
🔍 .fact claim — AI truth meter
⏳ .countdown — Event countdowns
🎲 .dice @user bet — Dice duel gambling
💌 .crush @user — Secret crush system
🤔 .wyr — Would You Rather
🎭 .tod truth/dare — Truth or Dare
🎂 .birthday — Birthday tracker
💪 .challenge — Community challenges
🎱 .8ball question — Magic 8-ball
⭐ .rate anything — AI rates things
🌐 .translate lang text — Quick translation
✍️ .poem @user — AI poem for someone
⚖️ .debate topic — AI argues both sides
🎭 .emoji text — Convert to emojis
━━━━━━━━━━━━━━━
📊 .triviaboard — Trivia leaderboard`;
  }

  return null; // Command not handled by this module
}

module.exports = { initDb, handle, BADGES, awardBadge };
