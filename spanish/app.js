(function () {
const U = window.UNIT, AUD = U.audio, BASE = 'audio/' + U.id + '/';
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const LOGKEY = 'es.log';
let LOG = []; try { LOG = JSON.parse(localStorage.getItem(LOGKEY) || '[]'); } catch (e) {}
const saveLog = () => { try { localStorage.setItem(LOGKEY, JSON.stringify(LOG)); } catch (e) {} };

// ---------- audio ----------
const cache = {}; let playing = null;
function clip(key) { if (!AUD[key]) return null; if (!cache[key]) { cache[key] = new Audio(BASE + AUD[key].file); cache[key].preload = 'auto'; } return cache[key]; }
function play(key) { return new Promise(res => { const a = clip(key); if (!a) return res(); if (playing && playing !== a) { playing.pause(); playing.currentTime = 0; } playing = a; a.currentTime = 0; a.onended = () => res(); a.play().catch(() => res()); }); }
function speak(text) { if (!('speechSynthesis' in window)) return; const u = new SpeechSynthesisUtterance(text); u.lang = 'es-MX'; u.rate = 0.9; speechSynthesis.cancel(); speechSynthesis.speak(u); }
const AC = window.AudioContext || window.webkitAudioContext; let ac = null;
const ctx = () => ac || (AC ? (ac = new AC()) : null);
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
function drawWave(canvas, buf, color) {
  const c = canvas.getContext('2d'), W = canvas.width, H = canvas.height; c.clearRect(0, 0, W, H); if (!buf) return;
  const ch = buf.getChannelData(0), bars = 80, step = Math.max(1, Math.floor(ch.length / bars)); c.fillStyle = color;
  for (let i = 0; i < bars; i++) { let s = 0, n = 0; for (let j = 0; j < step; j += 8) { s += Math.abs(ch[i * step + j] || 0); n++; } const h = Math.max(3, Math.min(1, (s / n) * 4) * (H - 6)); c.fillRect(i * (W / bars) + 1, (H - h) / 2, W / bars - 3, h); }
}
async function tapeBuffer(key) { const a = ctx(); if (!a || !AUD[key]) return null; try { const r = await fetch(BASE + AUD[key].file); return await a.decodeAudioData(await r.arrayBuffer()); } catch (e) { return null; } }

// ---------- routing ----------
const views = ['home', 'conv', 'ex', 'drill', 'listen', 'quiz', 'progress'];
function route() {
  let h = (location.hash || '#home').slice(1); if (!views.includes(h)) h = 'home';
  views.forEach(v => { $('#v-' + v).hidden = v !== h; });
  const navv = (h === 'drill' || h === 'listen') ? 'ex' : h;
  document.querySelectorAll('nav a[data-v]').forEach(a => { a.dataset.v === navv ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'); });
  if (h === 'progress') renderProgress(); if (h === 'home') renderHome(); if (h === 'ex') renderExList();
  if (h === 'drill' && !queue.length) startMixed();
  window.scrollTo(0, 0);
}
addEventListener('hashchange', route);

// ---------- conversation ----------
(function () {
  const box = $('#convLines');
  U.conversation.forEach(c => {
    const el = document.createElement('div'); el.className = 'line';
    el.innerHTML = `<div><div class="row" style="gap:10px"><span class="tag mute">${esc(c.speaker)}</span><span class="en">${esc(c.en)}</span></div><div class="es mid convtext" lang="es">${esc(c.text)}</div></div><button class="btn round" aria-label="Play line">▶</button>`;
    el.querySelector('button').onclick = () => play(c.id); box.appendChild(el);
  });
  $('#playConv').onclick = () => play('conv_full');
  $('#hideText').onchange = e => document.querySelectorAll('.convtext').forEach(x => { x.style.visibility = e.target.checked ? 'hidden' : 'visible'; });
  $('#convNotes').innerHTML = U.notes.map((n, i) => `<div class="line" style="grid-template-columns:1fr"><div><b style="font-weight:600" lang="es">${i + 1}. ${esc(n.topic)}</b> <span class="note" style="font-size:14px">${esc(n.text)}</span></div></div>`).join('');
})();

// ---------- exercises ----------
const EX = U.exercises, exById = Object.fromEntries(EX.map(e => [e.id, e]));
const KIND = { repetition: 'Listen and repeat', cue: 'Respond to the cue', translate: 'Say it in Spanish', listening: 'Listening' };
const itemsOf = e => (e.items || []).map((it, k) => ({ ex: e, k, it, id: e.id + '_' + k }));
const lastRating = id => { for (let i = LOG.length - 1; i >= 0; i--) if (LOG[i].id === id) return LOG[i].rating; return 0; };
function renderExList() {
  $('#exList').innerHTML = EX.map(e => {
    const its = itemsOf(e), done = its.filter(x => lastRating(x.id) >= 2).length, weak = its.filter(x => lastRating(x.id) === 1).length;
    const status = e.type === 'listening' ? '' : (done === its.length && its.length ? '<span class="tag ok">done</span>' : weak ? `<span class="tag warn">${weak} to redo</span>` : done ? `<span class="tag">${done} of ${its.length}</span>` : '<span class="tag mute">not started</span>');
    return `<a class="exrow" href="#${e.type === 'listening' ? 'listen' : 'drill'}" data-ex="${e.id}"><div><div style="font-weight:500">${esc(e.title)} · ${KIND[e.type]}</div><div class="note" lang="es">${esc(e.pattern)}${e.items ? ' · ' + e.items.length + ' items' : ''}</div></div>${status}</a>`;
  }).join('');
  document.querySelectorAll('#exList a').forEach(a => a.onclick = () => { if (exById[a.dataset.ex].type !== 'listening') startExercise(a.dataset.ex); });
}

// ---------- drill ----------
let queue = [], pos = 0, mode = '', mineUrl = null, mineBuf = null, mineBlob = null, heard = '', shownAt = 0;
function startExercise(id) { queue = itemsOf(exById[id]); pos = 0; mode = exById[id].title; show(); }
function startMixed() {
  queue = EX.filter(e => e.type === 'cue' || e.type === 'translate').flatMap(itemsOf);
  queue.forEach(q => { q.r = Math.random(); });
  queue.sort((a, b) => (lastRating(a.id) || 0.5) - (lastRating(b.id) || 0.5) || a.r - b.r);
  queue = queue.slice(0, 20); pos = 0; mode = 'Mixed practice'; show();
}
$('#mixedBtn').onclick = $('#mixedLink').onclick = () => { queue = []; };
const cur = () => queue[pos];
async function show() {
  const q = cur(); if (!q) return; const e = q.ex, it = q.it;
  $('#dCrumb').textContent = 'Unit 1 · ' + mode + (mode === e.title ? '' : ' · from ' + e.title);
  $('#dTitle').textContent = KIND[e.type]; $('#dPos').textContent = `${pos + 1} of ${queue.length}`;
  $('#pills').innerHTML = queue.map((_, i) => `<i class="${i < pos ? 'done' : i === pos ? 'now' : ''}"></i>`).join('');
  $('#dInstr').textContent = e.type === 'repetition' ? 'Play the tape, then say it yourself and compare.' : e.instruction;
  $('#dModel').innerHTML = e.model ? `Example: you hear <b lang="es">${esc(e.model.cue)}</b>, you say <b lang="es">${esc(e.model.answer)}</b>` : '';
  const answer = e.type === 'repetition' ? it.text : it.answer;
  $('#cueLabel').textContent = e.type === 'repetition' ? 'Repeat' : e.type === 'translate' ? 'Say in Spanish' : 'You hear';
  $('#cueText').textContent = e.type === 'repetition' ? it.text : e.type === 'translate' ? it.en : it.cue;
  $('#cueText').lang = e.type === 'translate' || e.id === 'ex3' ? 'en' : 'es';
  const cueKey = e.type === 'repetition' ? q.id : q.id + '_cue';
  $('#playCue').hidden = !AUD[cueKey]; $('#playCue').textContent = e.type === 'repetition' ? '▶ Tape' : '▶ Hear the cue'; $('#playCue').onclick = () => play(cueKey);
  $('#ansText').textContent = answer; $('#ansEn').textContent = e.type === 'translate' ? '' : (it.en || ''); $('#ansAlt').textContent = it.alt ? 'Also correct: ' + it.alt : '';
  const hide = e.type !== 'repetition'; $('#ansBody').hidden = hide; $('#reveal').hidden = !hide;
  $('#playAns').textContent = AUD[q.id] ? '▶ Tape' : '▶ Computer voice (not on the tape)'; $('#noteCard').hidden = !e.note; $('#dNote').textContent = e.note || '';
  mineBlob = null; mineBuf = null; heard = ''; $('#playMine').disabled = true; $('#durMine').textContent = 'You: —';
  $('#heardText').textContent = '—'; setTag('waiting', 'mute'); drawWave($('#waveMine'), null);
  $('#next').textContent = pos === queue.length - 1 ? 'Finish' : 'Skip →';
  $('#durTape').textContent = AUD[q.id] ? `Tape: ${AUD[q.id].dur.toFixed(1)} s` : 'Tape: —';
  drawWave($('#waveTape'), null); shownAt = Date.now();
  const id = q.id; const buf = await tapeBuffer(id); if (cur() && cur().id === id) drawWave($('#waveTape'), buf, css('--accent'));
}
function setTag(t, c) { $('#heardTag').textContent = t; $('#heardTag').className = 'tag ' + c; }
function revealAnswer(playIt) { $('#ansBody').hidden = false; $('#reveal').hidden = true; if (playIt) play(cur().id); }
$('#reveal').onclick = () => revealAnswer(true);
$('#playAns').onclick = () => { const q = cur(); AUD[q.id] ? play(q.id) : speak(q.ex.type === 'repetition' ? q.it.text : q.it.answer); };
$('#playMine').onclick = () => { if (mineUrl) new Audio(mineUrl).play().catch(() => {}); };
function advance() { if (pos < queue.length - 1) { pos++; show(); } else { queue = []; location.hash = '#ex'; } }
$('#next').onclick = advance; $('#prev').onclick = () => { if (pos > 0) { pos--; show(); } };
document.querySelectorAll('.rate button').forEach(b => b.onclick = () => {
  const q = cur(), ans = q.ex.type === 'repetition' ? q.it.text : q.it.answer;
  LOG.push({ t: Date.now(), unit: U.id, id: q.id, ex: q.ex.id, pattern: q.ex.pattern, type: q.ex.type, target: ans, rating: +b.dataset.r, recorded: !!mineBlob, mineSec: mineBuf ? +mineBuf.duration.toFixed(2) : null, tapeSec: AUD[q.id] ? AUD[q.id].dur : null, heard: heard || null, match: heard ? +match(heard, ans, q.it.alt).toFixed(2) : null, latencyMs: q.latency || null, mixed: mode === 'Mixed practice' });
  saveLog(); advance();
});

// ---------- recording + recognizer ----------
const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ ]/g, ' ').replace(/\s+/g, ' ').trim();
function lev(a, b) { const d = Array.from({ length: a.length + 1 }, (_, i) => [i]); for (let j = 1; j <= b.length; j++) d[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; }
function match(h, target, alt) { const one = t => { const a = norm(h).replace(/^yo /, ''), b = norm(t).replace(/^yo /, ''); return a ? Math.max(0, 1 - lev(a, b) / Math.max(a.length, b.length)) : 0; }; return Math.max(one(target), alt ? one(alt) : 0); }
let micStream = null, rec = null, chunks = [], sr = null;
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let useSR = true; try { const v = localStorage.getItem('es.sr'); useSR = v === null ? location.protocol !== 'file:' : v === '1'; } catch (e) {}
$('#srToggle').checked = useSR; $('#srToggle').onchange = e => { useSR = e.target.checked; try { localStorage.setItem('es.sr', useSR ? '1' : '0'); } catch (x) {} };
if (!SR) { $('#heardNote').textContent = 'Speech recognition is not available in this browser. Chrome on a computer or Android supports it.'; $('#srToggle').disabled = true; }
const micLive = () => !!(micStream && micStream.getTracks().some(t => t.readyState === 'live'));
function micMsg(e) { const n = (e && e.name) || ''; if (n === 'NotAllowedError' || n === 'SecurityError') return 'The browser blocked the microphone. Click the icon at the left of the address bar, set Microphone to Allow, then reload.'; if (n === 'NotFoundError') return 'No microphone was found.'; if (n === 'NotReadableError') return 'The microphone is in use by another app.'; return 'Could not start the microphone (' + (n || 'unknown error') + ').'; }
function micFail(m) { $('#micBanner').textContent = m; $('#micBanner').hidden = false; }
async function startRec() {
  rec = new MediaRecorder(micStream); chunks = []; rec.ondataavailable = e => chunks.push(e.data);
  const q = cur(); q.latency = Date.now() - shownAt;
  rec.onstop = async () => {
    mineBlob = new Blob(chunks, { type: rec.mimeType }); if (mineUrl) URL.revokeObjectURL(mineUrl); mineUrl = URL.createObjectURL(mineBlob); $('#playMine').disabled = false;
    const a = ctx(); if (a) { try { mineBuf = await a.decodeAudioData(await mineBlob.arrayBuffer()); drawWave($('#waveMine'), mineBuf, css('--you')); $('#durMine').textContent = `You: ${mineBuf.duration.toFixed(1)} s`; const ch = mineBuf.getChannelData(0); let pk = 0; for (let i = 0; i < ch.length; i += 16) pk = Math.max(pk, Math.abs(ch[i])); if (pk < 0.03) $('#recHint').textContent = 'That take was almost silent. Check the microphone level and record again.'; } catch (e) {} }
    revealAnswer(false); setTimeout(() => play(q.id), 300);
  };
  rec.start(); $('#recBtn').classList.add('on'); $('#recHint').textContent = 'Recording… tap to stop.';
  if (SR && useSR) { try { sr = new SR(); sr.lang = 'es-MX'; sr.interimResults = false; sr.maxAlternatives = 3;
    sr.onresult = ev => { let best = '', bs = -1; for (const alt of ev.results[0]) { const s = match(alt.transcript, q.ex.type === 'repetition' ? q.it.text : q.it.answer, q.it.alt); if (s > bs) { bs = s; best = alt.transcript; } } heard = best; $('#heardText').textContent = best; bs > 0.85 ? setTag('matches', 'ok') : bs > 0.6 ? setTag('close', 'warn') : setTag('different', 'mute'); };
    sr.onerror = ev => { setTag('no result', 'warn'); $('#heardNote').textContent = 'Recognizer gave nothing: ' + ({ 'not-allowed': 'the browser blocked it', 'no-speech': 'it heard no speech', network: 'it could not reach the speech service' }[ev.error] || ev.error) + '.'; };
    sr.start(); setTag('listening', 'mute'); } catch (e) { sr = null; } }
}
function stopRec() { if (rec && rec.state !== 'inactive') rec.stop(); if (sr) { try { sr.stop(); } catch (e) {} } $('#recBtn').classList.remove('on'); $('#recHint').textContent = 'Recorded. Compare with the tape, then rate yourself.'; }
$('#recBtn').onclick = async () => {
  if (rec && rec.state === 'recording') return stopRec();
  if (!micLive()) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return micFail('This page cannot reach the microphone here.');
    try { micStream = await navigator.mediaDevices.getUserMedia({ audio: true }); $('#micBanner').hidden = true; $('#recHint').textContent = 'Microphone is on. Tap to record.'; shownAt = Date.now(); } catch (e) { micFail(micMsg(e)); }
    return;
  }
  startRec();
};

// ---------- listening ----------
(function () {
  const e = exById.ex13; if (!e) return;
  $('#lInstr').textContent = e.instruction; $('#lNote').textContent = e.note || '';
  $('#listenLines').innerHTML = e.lines.map((l, k) => `<div class="line"><div><div class="row" style="gap:10px"><span class="tag mute">${esc(l.speaker)}</span><span class="en">${esc(l.en)}</span></div><div class="es mid" lang="es">${esc(l.text)}</div></div><button class="btn round" data-k="${k}" aria-label="Play line">▶</button></div>`).join('');
  document.querySelectorAll('#listenLines button').forEach(b => b.onclick = () => play('ex13_' + b.dataset.k));
  $('#playListen').onclick = () => play('ex13_full');
  $('#showListen').onclick = () => { const x = $('#listenLines'); x.hidden = !x.hidden; $('#showListen').textContent = x.hidden ? 'Show the text' : 'Hide the text'; };
})();

// ---------- quiz ----------
$('#quizList').innerHTML = U.quiz.map((q, i) => `<div class="line" style="grid-template-columns:1fr"><div><div><b style="font-weight:600">${i + 1}.</b> ${esc(q.situation)}</div><details style="margin-top:8px"><summary class="note">Show answer</summary><div class="es mid" lang="es" style="margin-top:6px">${esc(q.answer)}</div><button class="btn" data-say="${esc(q.answer)}" style="margin-top:8px;min-height:36px">Hear it (computer voice)</button></details></div></div>`).join('');
document.querySelectorAll('[data-say]').forEach(b => b.onclick = () => speak(b.dataset.say));

// ---------- progress ----------
const avg = xs => xs.reduce((s, x) => s + x.rating, 0) / xs.length;
function renderProgress() {
  const by = {}; LOG.forEach(x => { (by[x.pattern] = by[x.pattern] || []).push(x); });
  const tb = $('#patTable tbody'); tb.innerHTML = ''; const keys = Object.keys(by); $('#patEmpty').hidden = keys.length > 0; $('#patTable').hidden = !keys.length;
  keys.sort((a, b) => avg(by[a]) - avg(by[b])).forEach(k => { const xs = by[k], tr = document.createElement('tr'); tr.innerHTML = `<td lang="es">${esc(k)}</td><td>${xs.length}</td><td title="● needs work ○ good ◆ nailed it">${xs.slice(-5).map(x => '●○◆'[x.rating - 1]).join(' ')}</td><td style="width:110px"><div class="bar"><i style="width:${Math.round((avg(xs) - 1) / 2 * 100)}%"></i></div></td>`; tb.appendChild(tr); });
  $('#recent').innerHTML = LOG.slice(-12).reverse().map(x => `<div class="line"><div><div lang="es">${esc(x.target)}</div><div class="note">${new Date(x.t).toLocaleString()}${x.heard ? ` · heard: <span lang="es">${esc(x.heard)}</span>` : ''}${x.match != null ? ` · ${Math.round(x.match * 100)}% match` : ''}${x.latencyMs ? ` · ${(x.latencyMs / 1000).toFixed(1)} s to start` : ''}</div></div><span class="tag ${x.rating === 3 ? 'ok' : x.rating === 1 ? 'warn' : ''}">${['Needs work', 'Good', 'Nailed it'][x.rating - 1]}</span></div>`).join('') || '<div class="ghost">Nothing yet.</div>';
}
function renderHome() { const n = LOG.length, all = EX.flatMap(itemsOf), done = all.filter(x => lastRating(x.id) >= 2).length; $('#homeStats').textContent = n ? `${done} of ${all.length} items rated good or better · ${n} attempts logged` : `${all.length} items in this unit. No attempts yet.`; }
$('#exportLog').onclick = () => { const t = $('#logToast'), s = JSON.stringify({ lang: 'es', log: LOG }); if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(s).then(() => { t.textContent = 'Copied.'; }, () => { t.textContent = 'Could not copy.'; }); else t.textContent = 'Could not copy.'; };
$('#clearLog').onclick = () => { const b = $('#clearLog'); if (b.dataset.arm) { LOG = []; saveLog(); renderProgress(); b.textContent = 'Clear log'; delete b.dataset.arm; } else { b.textContent = 'Really clear?'; b.dataset.arm = '1'; } };

route();
})();
