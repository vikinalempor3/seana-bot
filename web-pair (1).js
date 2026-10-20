'use strict';
/**
 * web-pair.js — pair a WhatsApp number from a web page (no Telegram needed)
 *
 *   GET  /pair              the page
 *   POST /api/pair          { phone }  -> { ok, code }   starts a session and returns the pairing code
 *   GET  /api/pair/status   ?phone=    -> { connected }  lets the page show "connected"
 *
 * Registered from index.js:  require('./web-pair').register(_app, { createSession, sessions, codes, getBase })
 */
const express = require('express');

const PAGE = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Seana - Link your WhatsApp</title>
<meta property="og:title" content="Seana - Link your WhatsApp">
<meta property="og:description" content="Get a pairing code and connect Seana to your WhatsApp in a minute.">
<style>
:root{--bg:#060307;--card:#12060b;--red:#e81828;--dred:#7a0a14;--text:#f0f0f6;--mute:#a8a8b2}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;background:radial-gradient(900px 600px at 50% -10%,#4a0510 0%,var(--bg) 60%);color:var(--text);font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;display:flex;justify-content:center;padding:28px 16px}
.wrap{width:100%;max-width:460px}
h1{font-size:44px;margin:6px 0 0;letter-spacing:2px}
h1 span{color:var(--red)}
.tag{color:var(--mute);margin:4px 0 22px}
.card{background:var(--card);border:1px solid var(--dred);border-radius:18px;padding:20px}
label{display:block;font-weight:600;margin-bottom:8px}
input[type=tel]{width:100%;padding:14px;border-radius:12px;border:1px solid #3a1018;background:#0b0407;color:var(--text);font-size:18px;letter-spacing:1px}
input[type=tel]:focus{outline:2px solid var(--red)}
.hint{color:var(--mute);font-size:13px;margin:8px 0 14px}
.consent{display:flex;gap:10px;align-items:flex-start;font-size:13px;color:var(--mute);margin:6px 0 16px}
.consent input{margin-top:3px}
button{width:100%;padding:14px;border:0;border-radius:12px;background:var(--red);color:#fff;font-size:17px;font-weight:700;cursor:pointer}
button:disabled{opacity:.5;cursor:default}
.hp{position:absolute;left:-9999px;opacity:0;height:0;overflow:hidden}
.err{color:#ff7a85;margin-top:12px;font-size:14px;min-height:18px}
.code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:40px;font-weight:800;letter-spacing:6px;text-align:center;background:#0b0407;border:1px dashed var(--red);border-radius:14px;padding:18px 8px;margin:14px 0 8px;user-select:all}
.timer{text-align:center;color:var(--mute);font-size:14px;margin-bottom:12px}
ol{padding-left:20px;margin:12px 0;color:var(--mute);line-height:1.6}
ol b{color:var(--text)}
.ok{text-align:center}
.ok h2{margin:6px 0}
.alt{margin-top:18px;text-align:center;color:var(--mute);font-size:14px}
.alt a{color:var(--red);text-decoration:none;font-weight:600}
.small{color:var(--mute);font-size:12px;margin-top:14px;line-height:1.5}
.hide{display:none}
</style></head>
<body><div class="wrap">
<h1>SEA<span>NA</span></h1>
<p class="tag">Link your WhatsApp in about a minute.</p>

<div class="card" id="formCard">
  <form id="f" autocomplete="off">
    <label for="phone">Your WhatsApp number</label>
    <input id="phone" type="tel" inputmode="numeric" placeholder="2348012345678" required>
    <div class="hint">Country code first, digits only. No +, spaces or dashes.</div>
    <div class="hp"><input id="website" type="text" tabindex="-1" autocomplete="off"></div>
    <label class="consent"><input type="checkbox" id="agree" required>
      <span>I understand this connects the bot to my WhatsApp account. I can disconnect it any time in WhatsApp &gt; Linked Devices.</span></label>
    <button id="go" type="submit">Get my code</button>
    <div class="err" id="err"></div>
  </form>
</div>

<div class="card hide" id="codeCard">
  <div style="text-align:center;color:var(--mute)">Your pairing code</div>
  <div class="code" id="code">----</div>
  <div class="timer" id="timer"></div>
  <ol>
    <li>Open <b>WhatsApp</b> on that number</li>
    <li>Go to <b>Settings &gt; Linked Devices</b></li>
    <li>Tap <b>Link a Device</b>, then <b>Link with phone number instead</b></li>
    <li>Type the code above</li>
  </ol>
  <button id="copy" type="button">Copy code</button>
</div>

<div class="card ok hide" id="okCard">
  <h2>Connected</h2>
  <p>Seana is now live on your WhatsApp. Send her a message or type <b>.menu</b> to see everything she can do.</p>
</div>

<div class="alt">Prefer Telegram? <a href="https://t.me/chtildabot">Open @chtildabot</a> and send <b>/pair 234XXXXXXXXXX</b></div>
<div class="small">Linking gives the bot access to your WhatsApp the same way a linked device does. Only link a number you own. To remove it, delete the device under Linked Devices.</div>
</div>
<script>
var f=document.getElementById('f'),go=document.getElementById('go'),err=document.getElementById('err');
var phoneEl=document.getElementById('phone'),formCard=document.getElementById('formCard'),codeCard=document.getElementById('codeCard'),okCard=document.getElementById('okCard');
var tmr=null,poll=null,phone='';
function show(el){formCard.classList.add('hide');codeCard.classList.add('hide');okCard.classList.add('hide');el.classList.remove('hide');}
function startPolling(){
  var tries=0;
  poll=setInterval(function(){
    tries++; if(tries>120){clearInterval(poll);return;}
    fetch('/api/pair/status?phone='+encodeURIComponent(phone)).then(function(r){return r.json();}).then(function(j){
      if(j&&j.connected){clearInterval(poll);clearInterval(tmr);show(okCard);}
    }).catch(function(){});
  },3000);
}
function startTimer(sec){
  var t=document.getElementById('timer');
  clearInterval(tmr);
  tmr=setInterval(function(){
    sec--; if(sec<=0){clearInterval(tmr);t.textContent='Code expired. Refresh the page to get a new one.';return;}
    t.textContent='Expires in '+Math.floor(sec/60)+':'+('0'+(sec%60)).slice(-2);
  },1000);
  t.textContent='Expires in 3:00';
}
f.addEventListener('submit',function(e){
  e.preventDefault(); err.textContent='';
  phone=phoneEl.value.replace(/\\D/g,'');
  if(!/^[1-9][0-9]{7,14}$/.test(phone)){err.textContent='Enter the number with country code, digits only. Example: 2348012345678';return;}
  go.disabled=true; go.textContent='Getting your code... (up to 30s)';
  fetch('/api/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:phone,website:document.getElementById('website').value})})
  .then(function(r){return r.json();}).then(function(j){
    go.disabled=false; go.textContent='Get my code';
    if(!j||!j.ok){err.textContent=(j&&j.error)||'Something went wrong. Try again.';return;}
    if(j.alreadyLinked){show(okCard);return;}
    document.getElementById('code').textContent=j.code;
    show(codeCard); startTimer(j.expiresIn||180); startPolling();
  }).catch(function(){go.disabled=false;go.textContent='Get my code';err.textContent='Network problem. Try again.';});
});
document.getElementById('copy').addEventListener('click',function(){
  var c=document.getElementById('code').textContent.replace('-','');
  try{navigator.clipboard.writeText(c);this.textContent='Copied';}catch(e){this.textContent=c;}
});
</script></body></html>`;

function register(app, { createSession, sessions, codes, getBase }) {
  const json = express.json({ limit: '2kb' });
  const ipHits = new Map();     // ip    -> [timestamps]
  const phoneLast = new Map();  // phone -> last request time
  const clean = p => String(p || '').replace(/\D/g, '');
  const ipOf = req => String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // Any live session already using this number (Telegram-paired, owner, or web)?
  function connectedFor(phone) {
    for (const [, s] of sessions) {
      if (!s?.connected) continue;
      const num = clean(s.phone) || clean(String(s.sock?.user?.id || '').split(':')[0].split('@')[0]);
      if (num && num === phone) return true;
    }
    return false;
  }

  app.get('/pair', (_req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(PAGE);
  });

  app.get('/api/pair/status', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ connected: connectedFor(clean(req.query.phone)) });
  });

  app.post('/api/pair', json, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const body = req.body || {};
      if (body.website) return res.json({ ok: false, error: 'Request blocked.' }); // honeypot
      const phone = clean(body.phone);
      if (!/^[1-9]\d{7,14}$/.test(phone)) {
        return res.status(400).json({ ok: false, error: 'Enter the number with country code, digits only. Example: 2348012345678' });
      }
      if (connectedFor(phone)) return res.json({ ok: true, alreadyLinked: true });
      const now = Date.now();
      const ip = ipOf(req);
      const hits = (ipHits.get(ip) || []).filter(t => now - t < 15 * 60 * 1000);
      if (hits.length >= 4) return res.status(429).json({ ok: false, error: 'Too many tries. Wait a few minutes and try again.' });
      const last = phoneLast.get(phone) || 0;
      if (now - last < 60 * 1000) return res.status(429).json({ ok: false, error: 'A code was just requested for this number. Wait a minute, then try again.' });
      // cap simultaneous unfinished pairings so the page cannot be used to flood WhatsApp
      let pending = 0;
      for (const [, v] of codes) if (v && now - v.ts < 3 * 60 * 1000) pending++;
      if (pending >= 10) return res.status(429).json({ ok: false, error: 'Busy right now. Try again in a minute.' });

      hits.push(now); ipHits.set(ip, hits); phoneLast.set(phone, now);
      const id = 'web_' + phone;
      codes.delete(id);
      try { await createSession(id, phone, null, null, { forceNew: true }); }
      catch (e) { return res.status(500).json({ ok: false, error: 'Could not start the session. Try again.' }); }

      const t0 = Date.now(); let r = null;
      while (Date.now() - t0 < 35000) { r = codes.get(id); if (r) break; await sleep(500); }
      if (!r) return res.status(504).json({ ok: false, error: 'WhatsApp took too long to answer. Try again in a minute.' });
      if (!r.code) return res.status(502).json({ ok: false, error: 'Could not get a code. Check that the number is active on WhatsApp, then try again.' });
      console.log(`[web-pair] code issued for +${phone}`);
      return res.json({ ok: true, code: r.code, expiresIn: 180 });
    } catch (e) {
      console.error('[web-pair]', e.message);
      return res.status(500).json({ ok: false, error: 'Something went wrong. Try again.' });
    }
  });
  console.log('[web-pair] page ready at /pair');
}

module.exports = { register };
