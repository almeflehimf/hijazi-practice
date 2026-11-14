/* Shared practice engine. Each language page sets window.LANG and loads window.UNITS before this file. */
(function () {
const L = window.LANG, UNITS = window.UNITS || {};
const ORDER = Object.values(UNITS).sort((a, b) => a.n - b.n);
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const store = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };
let LOG = store.get(L.logKey, []);
let FLAGS = store.get(L.logKey + '.flags', {});
const SESSION = Date.now().toString(36);
const saveLog = () => store.set(L.logKey, LOG);
const unitOf = x => x.unit || (x.lesson ? 'l' + String(x.lesson).padStart(2, '0') : ORDER[0].id);
const keyOf = x => unitOf(x) + '|' + x.id;
let U = UNITS[store.get(L.logKey + '.unit', '')] || ORDER[0];

// ---------- text helpers ----------
const tcls = size => L.rtl ? 'ar ' + (size || 'mid') : 'es ' + (size === 'big' ? '' : size || 'mid');
const tgt = (text, tr, size) => `<div class="${tcls(size)}" lang="${L.code}">${esc(text)}</div>${tr ? `<div class="tr">${esc(tr)}</div>` : ''}`;
const PLAY = '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5v11l9-5.5z" fill="currentColor"/></svg>';

// ---------- audio ----------
const cache = {}; let playing = null;
const aud = (key, u) => ((u || U).audio || {})[key];
function clip(key, u) { u = u || U; const a = aud(key, u); if (!a) return null; const ck = u.id + '/' + key; if (!cache[ck]) { cache[ck] = new Audio(L.audioBase + u.id + '/' + a.file); cache[ck].preload = 'auto'; } return cache[ck]; }
function play(key, u) { return new Promise(res => { const a = clip(key, u); if (!a) return res(); if (playing && playing !== a) { playing.pause(); playing.currentTime = 0; } playing = a; a.currentTime = 0; a.onended = () => res(); a.play().catch(() => res()); }); }
async function playSeq(keys) { for (const k of keys) { await play(k); await new Promise(r => setTimeout(r, 450)); } }
function speak(text) { if (!L.tts || !('speechSynthesis' in window)) return; const u = new SpeechSynthesisUtterance(text); u.lang = L.tts; u.rate = 0.9; speechSynthesis.cancel(); speechSynthesis.speak(u); }
const AC = window.AudioContext || window.webkitAudioContext; let ac = null;
const actx = () => ac || (AC ? (ac = new AC()) : null);
const cssv = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
function drawWave(canvas, buf, color) {
  const c = canvas.getContext('2d'), W = canvas.width, H = canvas.height; c.clearRect(0, 0, W, H); if (!buf) return;
  const ch = buf.getChannelData(0), bars = 80, step = Math.max(1, Math.floor(ch.length / bars)); c.fillStyle = color;
  for (let i = 0; i < bars; i++) { let s = 0, n = 0; for (let j = 0; j < step; j += 8) { s += Math.abs(ch[i * step + j] || 0); n++; } const h = Math.max(3, Math.min(1, (s / n) * 4) * (H - 6)); c.fillRect(i * (W / bars) + 1, (H - h) / 2, W / bars - 3, h); }
}
async function tapeBuffer(key, u) { const a = actx(), m = aud(key, u); if (!a || !m) return null; try { const r = await fetch(L.audioBase + u.id + '/' + m.file); return await a.decodeAudioData(await r.arrayBuffer()); } catch (e) { return null; } }

// ---------- items ----------
const KIND = { repetition: 'Listen and repeat', cue: 'Respond to the cue', translate: 'Say it in ' + L.name, listening: 'Listening' };
function itemsOf(e, u) {
  u = u || U;
  return (e.items || []).map((it, k) => {
    const id = e.id + '_' + k; let fromKey = null;
    if (it.from) { const cumulative = k > 0 && e.items[k - 1].answer === it.from.text; fromKey = cumulative ? e.id + '_' + (k - 1) : e.id + '_base'; }
    return { u, ex: e, k, it, id, key: u.id + '|' + id, fromKey, answer: e.type === 'repetition' ? it.text : it.answer, tr: it.tr };
  });
}
const allItems = u => u.exercises.flatMap(e => itemsOf(e, u));
function lastRating(key) { for (let i = LOG.length - 1; i >= 0; i--) if (keyOf(LOG[i]) === key && LOG[i].rating) return LOG[i].rating; return 0; }

// ---------- routing ----------
const views = ['home', 'conv', 'ex', 'drill', 'listen', 'quiz', 'test', 'progress'];
function route() {
  let h = (location.hash || '#home').slice(1); if (!views.includes(h)) h = 'home';
  views.forEach(v => { const el = $('#v-' + v); if (el) el.hidden = v !== h; });
  const navv = (h === 'drill' || h === 'listen') ? 'ex' : h;
  document.querySelectorAll('nav a[data-v]').forEach(a => { a.dataset.v === navv ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'); });
  ({ home: renderHome, conv: renderConv, ex: renderExList, progress: renderProgress, quiz: renderQuiz, listen: renderListen, test: startTest }[h] || (() => {}))();
  if (h === 'drill' && !queue.length) startMixed();
  window.scrollTo(0, 0);
}
addEventListener('hashchange', route);
function setUnit(id) { U = UNITS[id] || U; store.set(L.logKey + '.unit', U.id); queue = []; T = null; chrome(); }
function chrome() {
  document.querySelectorAll('.unitname').forEach(x => { x.textContent = `${L.unitLabel} ${U.n} · ${U.title}`; });
  const q = document.querySelector('nav a[data-v="quiz"]'); if (q) q.hidden = !U.quiz;
}

// ---------- home ----------
function renderHome() {
  $('#unitList').innerHTML = ORDER.map(u => {
    const its = allItems(u), done = its.filter(x => lastRating(x.key) >= 2).length, weak = its.filter(x => lastRating(x.key) === 1).length, pct = its.length ? Math.round(100 * done / its.length) : 0;
    return `<a class="exrow" href="#conv" data-unit="${u.id}" style="${u.id === U.id ? 'border-color:var(--accent)' : ''}"><div><div style="font-weight:600">${L.unitLabel} ${u.n} · ${esc(u.title)}</div><div class="note">${u.conversation.length} ${L.convLabel.toLowerCase()} lines · ${u.exercises.length} exercises · ${its.length} items${weak ? ` · ${weak} to redo` : ''}</div><div class="bar" style="margin-top:8px;max-width:320px"><i style="width:${pct}%"></i></div></div><span class="tag ${pct === 100 ? 'ok' : done ? '' : 'mute'}">${done} of ${its.length}</span></a>`;
  }).join('');
  document.querySelectorAll('#unitList a').forEach(a => a.onclick = () => setUnit(a.dataset.unit));
  const n = LOG.filter(x => x.rating).length; $('#homeStats').textContent = n ? `${n} attempts logged so far.` : 'No attempts yet.';
}

// ---------- conversation ----------
function renderConv() {
  const box = $('#convLines'); box.innerHTML = '';
  $('#playConv').hidden = !aud('conv_full') && !U.conversation.some(c => aud(c.id));
  $('#playConvSlow').hidden = !U.conversation.some(c => aud(c.id + '_slow'));
  U.conversation.forEach(c => {
    const words = (c.build_up || []).map((b, k) => `<span class="row" style="gap:8px;display:inline-flex;margin:4px 12px 4px 0">${aud(c.id + '_b' + k) ? `<button class="btn round" style="width:32px;height:32px;min-height:32px" data-play="${c.id}_b${k}" aria-label="Play ${esc(b.tr || b.text)}">${PLAY}</button>` : ''}<span class="${tcls('sm')}" lang="${L.code}">${esc(b.text)}</span>${b.tr ? `<span class="tr" style="font-size:14px">${esc(b.tr)}</span>` : ''}<span class="en" style="font-size:13px">${esc(b.en)}</span></span>`).join('');
    const el = document.createElement('div'); el.className = 'line';
    el.innerHTML = `<div><div class="row" style="gap:10px"><span class="tag mute">${esc(c.speaker)}</span><span class="en">${esc(c.en)}${c.lit ? ` <span style="opacity:.8">(lit. ${esc(c.lit)})</span>` : ''}</span></div><div class="convtext">${tgt(c.text, c.tr)}</div>${words ? `<div style="margin-top:8px">${words}</div>` : ''}</div>
      <div class="row" style="flex-direction:column;align-items:stretch;gap:8px">${aud(c.id + '_slow') ? `<button class="btn" data-play="${c.id}_slow">${PLAY} Slow</button>` : ''}${aud(c.id) ? `<button class="btn primary" data-play="${c.id}">${PLAY} ${aud(c.id + '_slow') ? 'At speed' : 'Play'}</button>` : ''}</div>`;
    box.appendChild(el);
  });
  box.querySelectorAll('[data-play]').forEach(b => b.onclick = () => play(b.dataset.play));
  $('#hideText').checked = false;
  $('#convNotes').innerHTML = (U.notes || []).map((n, i) => `<div class="line" style="grid-template-columns:1fr"><div><b style="font-weight:600">${i + 1}. ${esc(n.topic)}.</b> <span class="note" style="font-size:14px">${esc(n.text)}</span></div></div>`).join('') || '<div class="ghost">No notes for this one.</div>';
}
$('#playConv').onclick = () => aud('conv_full') ? play('conv_full') : playSeq(U.conversation.map(c => c.id).filter(k => aud(k)));
$('#playConvSlow').onclick = () => playSeq(U.conversation.map(c => c.id + '_slow').filter(k => aud(k)));
$('#hideText').onchange = e => document.querySelectorAll('.convtext').forEach(x => { x.style.visibility = e.target.checked ? 'hidden' : 'visible'; });

// ---------- exercise list ----------
function renderExList() {
  $('#exList').innerHTML = U.exercises.map(e => {
    const its = itemsOf(e), done = its.filter(x => lastRating(x.key) >= 2).length, weak = its.filter(x => lastRating(x.key) === 1).length;
    const hasAudio = its.some(x => aud(x.id));
    const status = e.type === 'listening' ? '' : (done === its.length && its.length ? '<span class="tag ok">done</span>' : weak ? `<span class="tag warn">${weak} to redo</span>` : done ? `<span class="tag">${done} of ${its.length}</span>` : '<span class="tag mute">not started</span>');
    return `<a class="exrow" href="#${e.type === 'listening' ? 'listen' : 'drill'}" data-ex="${e.id}"><div><div style="font-weight:500">${esc(e.title)} · ${KIND[e.type]}</div><div class="note">${esc(e.pattern)}${e.items ? ' · ' + e.items.length + ' items' : ''}${e.type !== 'listening' && !hasAudio ? ' · no tape' : ''}${e.answers_by ? ' · answers not printed in the book' : ''}</div></div>${status}</a>`;
  }).join('');
  document.querySelectorAll('#exList a').forEach(a => a.onclick = () => { const e = U.exercises.find(x => x.id === a.dataset.ex); if (e.type !== 'listening') startExercise(e); else listenEx = e; });
}

// ---------- drill ----------
let queue = [], pos = 0, mode = '', mineUrl = null, mineBuf = null, mineBlob = null, heard = '', conf = null, shownAt = 0, takes = 0, revealedFirst = false, latency = null, pendingRating = null, peeked = false;
let studyMode = store.get(L.logKey + '.mode', 'auto');
function startExercise(e) { queue = itemsOf(e); pos = 0; mode = e.title; show(); }
function startMixed() {
  queue = ORDER.filter(u => u.n <= U.n).flatMap(u => u.exercises.flatMap(e => itemsOf(e, u)).filter(x => x.ex.type === 'cue' || x.ex.type === 'translate' || (x.ex.type === 'repetition' && x.it.en && lastRating(x.key) >= 2)));
  queue.forEach(q => { q.r = Math.random() + (q.u.id === U.id ? 0 : 0.35); });
  queue.sort((a, b) => (lastRating(a.key) || 0.5) - (lastRating(b.key) || 0.5) || a.r - b.r);
  queue = queue.slice(0, 20).sort(() => Math.random() - 0.5); pos = 0; mode = 'Mixed practice'; show();
}
document.querySelectorAll('.mixed').forEach(a => a.onclick = () => { queue = []; });
const cur = () => queue[pos];
const setTag = (t, c) => { $('#heardTag').textContent = t; $('#heardTag').className = 'tag ' + c; };
async function show() {
  const q = cur(); if (!q) return; const e = q.ex, it = q.it;
  const seen = lastRating(q.key) >= 2;
  const recall = e.type === 'repetition' ? (!!it.en && (studyMode === 'hide' || (studyMode === 'auto' && (seen || mode === 'Mixed practice')))) : studyMode !== 'show';
  const repRecall = recall && e.type === 'repetition';
  q.recall = recall; peeked = false; $('#studyMode').value = studyMode;
  $('#dCrumb').textContent = `${L.unitLabel} ${q.u.n} · ${mode}` + (mode === e.title ? '' : ' · from ' + e.title);
  $('#dTitle').textContent = repRecall ? 'Say it from memory' : KIND[e.type]; $('#dPos').textContent = `${pos + 1} of ${queue.length}`;
  $('#pills').innerHTML = queue.map((_, i) => `<i class="${i < pos ? 'done' : i === pos ? 'now' : ''}"></i>`).join('');
  $('#dInstr').textContent = repRecall ? 'Say it in ' + L.name + ' from memory. The text and the tape come after your attempt.' : e.type === 'repetition' ? 'First time through: play the tape, say it, and compare. Next time the text will be hidden.' : e.instruction + (recall ? ' Try it before you look at anything.' : '');
  $('#dModel').innerHTML = e.model ? `Example: you hear <b>${esc(e.model.cue)}</b>, you say <b>${esc(e.model.answer)}</b>` : '';
  // start-from sentence (substitution drills)
  $('#fromCard').hidden = !it.from;
  if (it.from) { const fk = q.fromKey, full = tgt(it.from.text, it.from.tr), hideFrom = recall && !!aud(fk, q.u);
    $('#fromBody').innerHTML = hideFrom ? '<span class="note">Play it on the tape. </span><button class="linkbtn" id="peekFrom">Show the text</button>' : full;
    if (hideFrom) $('#peekFrom').onclick = () => { peeked = true; $('#fromBody').innerHTML = full; };
    $('#playFrom').hidden = !aud(fk, q.u); $('#playFrom').onclick = () => play(fk, q.u); }
  $('#cueLabel').textContent = repRecall || e.type === 'translate' ? 'Say in ' + L.name : e.type === 'repetition' ? 'Repeat' : it.from ? 'Cue: change it to' : 'Cue';
  const cueKey = e.type === 'repetition' ? q.id : q.id + '_cue';
  const hideCue = recall && !!it.cue_tr && !!aud(cueKey, q.u);
  const cueFull = e.type === 'repetition' ? tgt(it.text, it.tr) + (it.en ? `<div style="font-size:15px;font-weight:400;opacity:.9;margin-top:4px">${esc(it.en)}</div>` : '') : e.type === 'translate' ? esc(it.en) : it.cue_tr ? tgt(it.cue, it.cue_tr) : esc(it.cue) + (it.en ? `<div style="font-size:15px;font-weight:400;opacity:.9;margin-top:4px">${esc(it.en)}</div>` : '');
  $('#cueText').innerHTML = repRecall ? esc(it.en) : hideCue ? '<span style="font-size:18px;font-weight:400">Listen to the cue. </span><button class="linkbtn" id="peekCue" style="color:#fff">Show the text</button>' : cueFull;
  if (hideCue) $('#peekCue').onclick = () => { peeked = true; $('#cueText').innerHTML = cueFull; $('#cueText').style.fontSize = ''; };
  $('#cueText').style.fontSize = ((e.type === 'repetition' || it.cue_tr) && !repRecall && !hideCue) ? '' : '30px';
  $('#playCue').hidden = !aud(cueKey, q.u) || repRecall; $('#playCue').innerHTML = PLAY + (e.type === 'repetition' ? ' Tape' : ' Hear the cue'); $('#playCue').onclick = () => play(cueKey, q.u);
  $('#ansText').innerHTML = tgt(q.answer, q.tr, 'mid'); $('#ansEn').textContent = e.type === 'translate' ? '' : (it.en || ''); $('#ansAlt').textContent = it.alt ? 'Also correct: ' + it.alt : '';
  $('#ansBy').hidden = !e.answers_by;
  const hide = e.type !== 'repetition' || repRecall; $('#ansBody').hidden = hide; $('#reveal').hidden = !hide;
  const has = !!aud(q.id, q.u);
  $('#playAns').hidden = !has && !L.tts; $('#playAns').innerHTML = PLAY + (has ? ' Tape' : ' Computer voice (not on the tape)');
  $('#flag').hidden = !has; paintFlag();
  $('#noteCard').hidden = !e.note; $('#dNote').textContent = e.note || '';
  mineBlob = null; mineBuf = null; heard = ''; conf = null; takes = 0; revealedFirst = false; latency = null; pendingRating = null;
  $('#whyRow').hidden = true; $('#rateRow').hidden = false;
  $('#playMine').disabled = true; $('#durMine').textContent = 'You: —'; $('#heardText').textContent = '—'; setTag('waiting', 'mute'); drawWave($('#waveMine'), null);
  $('#recHint').textContent = micLive() ? 'Tap to record.' : 'Tap once to turn the microphone on.';
  $('#next').textContent = pos === queue.length - 1 ? 'Finish' : 'Skip →';
  $('#durTape').textContent = has ? `Tape: ${aud(q.id, q.u).dur.toFixed(1)} s` : 'Tape: —';
  drawWave($('#waveTape'), null); shownAt = Date.now();
  const key = q.key; const buf = await tapeBuffer(q.id, q.u); if (cur() && cur().key === key) drawWave($('#waveTape'), buf, cssv('--accent'));
}
$('#studyMode').onchange = ev => { studyMode = ev.target.value; store.set(L.logKey + '.mode', studyMode); if (cur()) show(); };
function playAnswer() { const q = cur(); aud(q.id, q.u) ? play(q.id, q.u) : speak(q.answer); }
function revealAnswer(playIt) { if ($('#ansBody').hidden && !takes) revealedFirst = true; $('#ansBody').hidden = false; $('#reveal').hidden = true; if (playIt) playAnswer(); }
$('#reveal').onclick = () => revealAnswer(true);
$('#playAns').onclick = playAnswer;
$('#playMine').onclick = () => { if (mineUrl) new Audio(mineUrl).play().catch(() => {}); };
function paintFlag() { const q = cur(); const on = !!FLAGS[q.key]; $('#flag').textContent = on ? 'Reported as wrong audio. Undo' : 'Wrong audio?'; }
$('#flag').onclick = () => { const q = cur(); if (FLAGS[q.key]) delete FLAGS[q.key]; else FLAGS[q.key] = { t: Date.now(), target: q.answer }; store.set(L.logKey + '.flags', FLAGS); paintFlag(); };
function advance() { if (pos < queue.length - 1) { pos++; show(); } else { queue = []; location.hash = '#ex'; } }
$('#next').onclick = advance; $('#prev').onclick = () => { if (pos > 0) { pos--; show(); } };
function logAttempt(rating, why) {
  const q = cur(), m = aud(q.id, q.u);
  LOG.push({ t: Date.now(), session: SESSION, lang: L.code, unit: q.u.id, id: q.id, ex: q.ex.id, pattern: q.ex.pattern, type: q.ex.type, cue: q.it.cue || q.it.en || null, target: q.answer, rating, why: why || null,
    recorded: !!mineBlob, takes, revealedFirst, latencyMs: latency, mineSec: mineBuf ? +mineBuf.duration.toFixed(2) : null, tapeSec: m ? m.dur : null,
    mode: q.recall ? 'recall' : 'shown', peeked, heard: heard || null, conf: conf, match: heard ? +match(heard, q.answer, q.it.alt).toFixed(2) : null, mixed: mode === 'Mixed practice', flagged: !!FLAGS[q.key] });
  saveLog(); advance();
}
document.querySelectorAll('#rateRow button').forEach(b => b.onclick = () => { const r = +b.dataset.r; if (r === 1) { pendingRating = 1; $('#rateRow').hidden = true; $('#whyRow').hidden = false; } else logAttempt(r); });
document.querySelectorAll('#whyRow button').forEach(b => b.onclick = () => logAttempt(1, b.dataset.why || null));

// ---------- recording + recognizer ----------
const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ًͯ-ْـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();
function lev(a, b) { const d = Array.from({ length: a.length + 1 }, (_, i) => [i]); for (let j = 1; j <= b.length; j++) d[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; }
function match(h, target, alt) { const one = t => { const a = norm(h), b = norm(t); return a ? Math.max(0, 1 - lev(a, b) / Math.max(a.length, b.length)) : 0; }; return Math.max(one(target), alt ? one(alt) : 0); }
let micStream = null, rec = null, chunks = [], sr = null;
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let useSR = store.get(L.logKey + '.sr', location.protocol !== 'file:' && L.srDefault !== false);
$('#srToggle').checked = !!useSR; $('#srToggle').onchange = e => { useSR = e.target.checked; store.set(L.logKey + '.sr', useSR); };
$('#heardNote').textContent = L.srNote;
if (!SR) { $('#heardNote').textContent = 'Speech recognition is not available in this browser. Chrome on a computer or Android supports it.'; $('#srToggle').disabled = true; }
function micLive() { return !!(micStream && micStream.getTracks().some(t => t.readyState === 'live')); }
function micMsg(e) { const n = (e && e.name) || ''; if (n === 'NotAllowedError' || n === 'SecurityError') return 'The browser blocked the microphone. Click the icon at the left of the address bar, set Microphone to Allow, then reload.'; if (n === 'NotFoundError') return 'No microphone was found.'; if (n === 'NotReadableError') return 'The microphone is in use by another app.'; return 'Could not start the microphone (' + (n || 'unknown error') + ').'; }
function micFail(m) { $('#micBanner').textContent = m; $('#micBanner').hidden = false; }
function startRec() {
  const q = cur(); rec = new MediaRecorder(micStream); chunks = []; rec.ondataavailable = e => chunks.push(e.data);
  takes++; if (latency == null) latency = Date.now() - shownAt;
  rec.onstop = async () => {
    mineBlob = new Blob(chunks, { type: rec.mimeType }); if (mineUrl) URL.revokeObjectURL(mineUrl); mineUrl = URL.createObjectURL(mineBlob); $('#playMine').disabled = false;
    const a = actx(); if (a) { try { mineBuf = await a.decodeAudioData(await mineBlob.arrayBuffer()); drawWave($('#waveMine'), mineBuf, cssv('--you')); $('#durMine').textContent = `You: ${mineBuf.duration.toFixed(1)} s`; const ch = mineBuf.getChannelData(0); let pk = 0; for (let i = 0; i < ch.length; i += 16) pk = Math.max(pk, Math.abs(ch[i])); if (pk < 0.03) $('#recHint').textContent = 'That take was almost silent. Check the microphone level and record again.'; } catch (e) {} }
    revealAnswer(false); setTimeout(playAnswer, 300);
  };
  rec.start(); $('#recBtn').classList.add('on'); $('#recHint').textContent = 'Recording… tap to stop.';
  if (SR && useSR) { try { sr = new SR(); sr.lang = L.sr; sr.interimResults = false; sr.maxAlternatives = 3;
    sr.onresult = ev => { let best = '', bs = -1, bc = null; for (const alt of ev.results[0]) { const s = match(alt.transcript, q.answer, q.it.alt); if (s > bs) { bs = s; best = alt.transcript; bc = alt.confidence; } } heard = best; conf = bc ? +bc.toFixed(2) : null; $('#heardText').textContent = best; bs > 0.85 ? setTag('matches', 'ok') : bs > 0.6 ? setTag('close', 'warn') : setTag('different', 'mute'); };
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

// ---------- listening (exercise type) ----------
let listenEx = null;
function renderListen() {
  const e = listenEx || U.exercises.find(x => x.type === 'listening'); if (!e) { location.hash = '#ex'; return; }
  $('#lTitle').textContent = e.title + ' · ' + e.pattern; $('#lInstr').textContent = e.instruction || ''; $('#lNote').textContent = e.note || '';
  $('#listenLines').hidden = true; $('#showListen').textContent = 'Show the text';
  $('#listenLines').innerHTML = e.lines.map((l, k) => `<div class="line"><div><div class="row" style="gap:10px"><span class="tag mute">${esc(l.speaker)}</span><span class="en">${esc(l.en)}</span></div>${tgt(l.text, l.tr)}</div><button class="btn round" data-k="${k}" aria-label="Play line">${PLAY}</button></div>`).join('');
  document.querySelectorAll('#listenLines button').forEach(b => b.onclick = () => play(e.id + '_' + b.dataset.k));
  $('#playListen').onclick = () => play(e.id + '_full');
}
$('#showListen').onclick = () => { const x = $('#listenLines'); x.hidden = !x.hidden; $('#showListen').textContent = x.hidden ? 'Show the text' : 'Hide the text'; };

// ---------- quiz ----------
function renderQuiz() {
  if (!U.quiz) { location.hash = '#ex'; return; }
  $('#quizList').innerHTML = U.quiz.map((q, i) => `<div class="line" style="grid-template-columns:1fr"><div><div><b style="font-weight:600">${i + 1}.</b> ${esc(q.situation)}</div><details style="margin-top:8px"><summary class="note">Show answer</summary><div style="margin-top:6px">${tgt(q.answer, q.tr)}</div>${L.tts ? `<button class="btn" data-say="${esc(q.answer)}" style="margin-top:8px;min-height:36px">Hear it (computer voice)</button>` : ''}</details></div></div>`).join('');
  document.querySelectorAll('[data-say]').forEach(b => b.onclick = () => speak(b.dataset.say));
}


// ---------- graded test ----------
let T = null;
function testPool(u) {
  const out = [], seenK = new Set();
  const add = (id, text, tr, en, akey) => { if (!en || !text) return; const ans = tr || text, k = ans + '|' + en; if (seenK.has(k)) return; seenK.add(k); out.push({ u, id: 'q:' + id, key: u.id + '|q:' + id, text, tr, en, ans, akey: aud(akey, u) ? akey : null }); };
  u.conversation.forEach(c => (c.build_up || []).forEach((b, k) => add(c.id + '_b' + k, b.text, b.tr, b.en, c.id + '_b' + k)));
  u.exercises.filter(e => e.type === 'repetition').forEach(e => e.items.forEach((it, k) => add(e.id + '_' + k, it.text, it.tr, it.en, e.id + '_' + k)));
  return out;
}
const tstrip = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9ñÑ]/g, '');
function gradeTyped(typed, ans) {
  const a = tstrip(typed), b = tstrip(ans); if (!a) return 'wrong';
  if (a === b) return 'correct'; if (a.toLowerCase() === b.toLowerCase()) return L.rtl ? 'caps' : 'correct';
  const d = lev(a.toLowerCase(), b.toLowerCase()); return (b.length >= 4 && d <= 1) || (b.length >= 10 && d <= 2) ? 'close' : 'wrong';
}
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
function startTest(force) {
  if (T && !force && T.unit === U.id) return;
  const pool = testPool(U), wider = ORDER.filter(u => u.n <= U.n).flatMap(testPool);
  pool.forEach(p => { p.r = Math.random(); });
  const qs = pool.sort((a, b) => (lastRating(a.key) || 0.5) - (lastRating(b.key) || 0.5) || a.r - b.r).slice(0, 12);
  shuffle(qs).forEach((q, i) => {
    const kinds = ['type', q.akey ? 'hear' : 'read', 'read']; q.kind = kinds[i % 3];
    if (q.kind !== 'type') { const ds = []; shuffle(wider.filter(x => x.ans !== q.ans && x.en !== q.en && norm(x.text) !== norm(q.text))).forEach(x => { if (ds.length < 3 && !ds.some(d => d.en === x.en)) ds.push(x); }); q.choices = shuffle([q, ...ds]); if (ds.length < 2) q.kind = 'type'; }
  });
  T = { unit: U.id, qs, i: 0, right: 0, misses: [] }; showTest();
}
const TKIND = { type: 'Type it', hear: 'Listen and choose the meaning', read: 'Read and choose the meaning' };
function showTest() {
  const done = T.i >= T.qs.length; $('#tCard').hidden = done; $('#tDone').hidden = !done;
  $('#tPills').innerHTML = T.qs.map((q, i) => `<i class="${i < T.i ? (q.ok ? 'done' : 'now') : ''}"></i>`).join('');
  if (done) {
    $('#tScore').textContent = T.qs.length ? `${T.right} of ${T.qs.length} correct` : 'Nothing to test in this one yet.';
    $('#tMisses').innerHTML = T.misses.map(q => `<div class="line"><div>${tgt(q.text, q.tr, 'sm')}<div class="en">${esc(q.en)}</div></div>${q.akey ? `<button class="btn round" data-tplay="${q.akey}" aria-label="Play">${PLAY}</button>` : ''}</div>`).join('') || '<div class="ghost">No misses.</div>';
    document.querySelectorAll('[data-tplay]').forEach(b => b.onclick = () => play(b.dataset.tplay)); return;
  }
  const q = T.qs[T.i]; T.t0 = Date.now();
  $('#tKind').textContent = `${T.i + 1} of ${T.qs.length} · ${TKIND[q.kind]}`; $('#tFeedback').innerHTML = ''; $('#tNext').hidden = true;
  $('#tChoices').hidden = q.kind === 'type'; $('#tForm').hidden = q.kind !== 'type';
  if (q.kind === 'type') { $('#tPrompt').innerHTML = `<div style="font-size:26px;font-weight:500">${esc(q.en)}</div><div class="note" style="margin-top:6px">${esc(L.typeHint || '')}</div>`; $('#tInput').value = ''; $('#tInput').disabled = false; $('#tCheck').disabled = false; setTimeout(() => $('#tInput').focus(), 50); }
  else {
    $('#tPrompt').innerHTML = q.kind === 'hear' ? `<button class="btn primary" id="tPlay">${PLAY} Play</button>` : `<div class="${tcls('big')}" lang="${L.code}">${esc(q.text)}</div>`;
    if (q.kind === 'hear') { $('#tPlay').onclick = () => play(q.akey); play(q.akey); }
    $('#tChoices').innerHTML = q.choices.map((c, k) => `<button class="choice" data-k="${k}">${esc(c.en)}</button>`).join('');
    document.querySelectorAll('#tChoices .choice').forEach(b => b.onclick = () => { const c = q.choices[+b.dataset.k]; document.querySelectorAll('#tChoices .choice').forEach((x, k) => { x.disabled = true; if (q.choices[k].ans === q.ans) x.classList.add('right'); }); const ok = c.ans === q.ans; if (!ok) b.classList.add('wrong'); finishTest(q, ok ? 'correct' : 'wrong', c.en); });
  }
}
function finishTest(q, verdict, given) {
  const ok = verdict === 'correct' || verdict === 'caps'; q.ok = ok; if (ok) T.right++; else T.misses.push(q);
  const msg = { correct: 'Correct.', caps: 'Correct, but watch the capitals: they mark different sounds.', close: 'Close, but not right.', wrong: 'Not this time.' }[verdict];
  $('#tFeedback').innerHTML = `<div class="tag ${ok ? 'ok' : 'warn'}" style="margin:12px 0 8px">${msg}</div>${tgt(q.text, q.tr)}<div class="en">${esc(q.en)}</div>${q.akey ? `<button class="btn" id="tHear" style="margin-top:10px;min-height:36px">${PLAY} Tape</button>` : ''}`;
  if (q.akey) { $('#tHear').onclick = () => play(q.akey); if (q.kind !== 'hear') play(q.akey); }
  LOG.push({ t: Date.now(), session: SESSION, lang: L.code, unit: q.u.id, id: q.id, ex: 'test', pattern: 'test: ' + TKIND[q.kind].toLowerCase(), type: 'test', kind: q.kind, cue: q.en, target: q.text, answer: q.ans, given, verdict, graded: true, rating: ok ? 3 : verdict === 'close' ? 2 : 1, ms: Date.now() - T.t0 }); saveLog();
  $('#tNext').hidden = false; $('#tNext').textContent = T.i === T.qs.length - 1 ? 'See the result' : 'Next'; $('#tNext').focus();
}
$('#tForm').onsubmit = ev => { ev.preventDefault(); const q = T.qs[T.i]; if ($('#tInput').disabled) return; $('#tInput').disabled = true; $('#tCheck').disabled = true; finishTest(q, gradeTyped($('#tInput').value, q.ans), $('#tInput').value); };
$('#tNext').onclick = () => { T.i++; showTest(); };
$('#tAgain').onclick = () => startTest(true);

// ---------- progress ----------
const avg = xs => xs.reduce((s, x) => s + x.rating, 0) / xs.length;
const median = xs => { const a = xs.slice().sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : null; };
function renderProgress() {
  const R = LOG.filter(x => x.rating);
  const lat = median(R.filter(x => x.latencyMs && x.latencyMs < 60000).map(x => x.latencyMs));
  const why = {}; R.forEach(x => { if (x.why) why[x.why] = (why[x.why] || 0) + 1; }); const G = R.filter(x => x.graded);
  $('#summary').innerHTML = R.length ? `<span><b>${R.length}</b> attempts</span><span><b>${R.filter(x => x.rating === 1).length}</b> rated needs work</span>${lat ? `<span><b>${(lat / 1000).toFixed(1)} s</b> median time to start speaking</span>` : ''}${G.length ? `<span><b>${G.filter(x => x.rating === 3).length} of ${G.length}</b> test answers correct</span>` : ''}<span><b>${Object.keys(FLAGS).length}</b> clips reported</span>${Object.keys(why).length ? `<span>Reasons: ${Object.entries(why).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${esc(k)} ${v}`).join(' · ')}</span>` : ''}` : '';
  const by = {}; R.forEach(x => { const k = unitOf(x) + '|' + x.pattern; (by[k] = by[k] || []).push(x); });
  const tb = $('#patTable tbody'); tb.innerHTML = ''; const keys = Object.keys(by); $('#patEmpty').hidden = keys.length > 0; $('#patTable').hidden = !keys.length;
  keys.sort((a, b) => avg(by[a]) - avg(by[b])).forEach(k => { const xs = by[k], u = UNITS[k.split('|')[0]], l = median(xs.filter(x => x.latencyMs && x.latencyMs < 60000).map(x => x.latencyMs)); const tr = document.createElement('tr'); tr.innerHTML = `<td><span class="note">${u ? L.unitLabel + ' ' + u.n : ''}</span><br>${esc(xs[0].pattern)}</td><td>${xs.length}</td><td title="● needs work ○ good ◆ nailed it">${xs.slice(-5).map(x => '●○◆'[x.rating - 1]).join(' ')}</td><td>${l ? (l / 1000).toFixed(1) + ' s' : '—'}</td><td style="width:90px"><div class="bar"><i style="width:${Math.round((avg(xs) - 1) / 2 * 100)}%"></i></div></td>`; tb.appendChild(tr); });
  $('#recent').innerHTML = R.slice(-12).reverse().map(x => `<div class="line"><div><div lang="${L.code}" ${L.rtl ? 'dir="rtl" style="text-align:left"' : ''}>${esc(x.target || x.cue || x.id)}</div><div class="note">${new Date(x.t).toLocaleString()}${x.heard ? ` · heard: <span lang="${L.code}">${esc(x.heard)}</span>` : ''}${x.match != null ? ` · ${Math.round(x.match * 100)}% match` : ''}${x.latencyMs ? ` · ${(x.latencyMs / 1000).toFixed(1)} s to start` : ''}${x.why ? ` · ${esc(x.why)}` : ''}</div></div><span class="tag ${x.rating === 3 ? 'ok' : x.rating === 1 ? 'warn' : ''}">${['Needs work', 'Good', 'Nailed it'][x.rating - 1]}</span></div>`).join('') || '<div class="ghost">Nothing yet.</div>';
}
const exportJson = () => JSON.stringify({ lang: L.code, exportedAt: new Date().toISOString(), log: LOG, flags: FLAGS });
$('#exportLog').onclick = () => { const t = $('#logToast'), s = exportJson(); if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(s).then(() => { t.textContent = 'Copied. Paste it into the chat.'; }, () => { t.textContent = 'Could not copy. Use Download.'; }); else t.textContent = 'Could not copy. Use Download.'; };
$('#downloadLog').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([exportJson()], { type: 'application/json' })); a.download = `${L.code}-practice-log-${new Date().toISOString().slice(0, 10)}.json`; document.body.appendChild(a); a.click(); a.remove(); };
$('#clearLog').onclick = () => { const b = $('#clearLog'); if (b.dataset.arm) { LOG = []; FLAGS = {}; saveLog(); store.set(L.logKey + '.flags', FLAGS); renderProgress(); b.textContent = 'Clear log'; delete b.dataset.arm; } else { b.textContent = 'Really clear?'; b.dataset.arm = '1'; } };

chrome(); route();
})();
