/* Band Note Map — drum / bass / keys piano-roll trainer. Drum samples: VCSL (CC0), see samples/CREDITS.txt */
(() => {
'use strict';
/* ================= basics ================= */
const IDS = ['drum', 'bass', 'keys'];
const NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const SOLF = ['도','도#','레','레#','미','파','파#','솔','솔#','라','라#','시'];
const FLAT = {1:'D♭',3:'E♭',6:'G♭',8:'A♭',10:'B♭'};
const mod = (a, n) => ((a % n) + n) % n;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const octOf = n => Math.floor(n / 12) - 2;               // Logic: C3 = 60
const noteName = n => NAMES[mod(n, 12)] + octOf(n);
const isBlack = n => [1,3,6,8,10].includes(mod(n, 12));
const PC_NAT = {0:'c', 2:'d', 4:'e', 5:'f', 7:'g', 9:'a', 11:'b'};
const pcColor = n => { const p = mod(n, 12); return (p in PC_NAT) ? `var(--pc-${PC_NAT[p]})` : `color-mix(in oklab, var(--pc-${PC_NAT[p - 1]}), var(--pc-${PC_NAT[p + 1]}))`; };
const range = (hi, lo) => { const a = []; for (let n = hi; n >= lo; n--) a.push(n); return a; };
const $ = s => document.querySelector(s);
const NS = 'http://www.w3.org/2000/svg';
const mk = (tag, attrs, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const canHover = matchMedia('(hover: hover)').matches;
const store = { get(k){ try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v){ try { localStorage.setItem(k, v); } catch (e) {} } };
const restart = (el, cls) => { if (!el) return; el.classList.remove(cls); void el.getBoundingClientRect(); el.classList.add(cls); };
const STEPS = tr => tr.bars * 16;
const posLabel = s => `${Math.floor(s / 16) + 1}.${Math.floor(mod(s, 16) / 4) + 1}.${s % 4 + 1}`;

const ICON = {
  drum:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="9.5" rx="8" ry="3"/><path d="M4 9.5v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/><path d="M8 6 5 2.5M16 6l3-3.5"/></svg>`,
  bass:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10.5 13.5 18 6"/><path d="M17 4.2 19.8 7l1.7-1.7L18.7 2.5z"/><path d="M9.6 10.1C6.9 9.3 3.5 11.2 3.5 14.6c0 3.3 2.6 5.9 5.9 5.9 3.4 0 5.3-3.4 4.5-6.1"/><path d="M7.6 14.4l2 2"/></svg>`,
  keys:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M8.8 12.5V19M15.2 12.5V19"/><path d="M7.4 5v7.5h2.8V5M13.8 5v7.5h2.8V5" fill="currentColor"/></svg>`,
};

/* ================= audio core ================= */
let ctx = null, master = null, OUT = null, noiseBuf = null, openHat = null, revIn = null;
const BUS = {};
const MIX = { drum:{ vol:.85, mute:false, rvb:.08 }, bass:{ vol:.72, mute:false, rvb:0 }, keys:{ vol:.62, mute:false, rvb:.26 } };
let rvbAmt = .5;
function makeIR(sec){
  const len = Math.floor(ctx.sampleRate * sec), b = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c); let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len, k = .25 + .7 * t;               // darker tail
      lp = lp * k + (Math.random() * 2 - 1) * (1 - k);
      d[i] = lp * Math.pow(1 - t, 2.6) * (i < ctx.sampleRate * .012 ? i / (ctx.sampleRate * .012) : 1);
    }
  }
  return b;
}
function ensureAudio(){
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC({ latencyHint:'interactive' });
    // master: headroom gain → gentle glue compressor → brick-wall-ish limiter (keeps the band from clipping)
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20; comp.knee.value = 8; comp.ratio.value = 2.5; comp.attack.value = .008; comp.release.value = .25;
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -3; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = .001; lim.release.value = .1;
    master = ctx.createGain(); master.gain.value = .5;
    master.connect(comp); comp.connect(lim); lim.connect(ctx.destination);
    const conv = ctx.createConvolver(); conv.buffer = makeIR(1.8);
    const rvHp = ctx.createBiquadFilter(); rvHp.type = 'highpass'; rvHp.frequency.value = 320; rvHp.connect(conv);   // no low-end in the reverb = less mud
    const wet = ctx.createGain(); wet.gain.value = .9; conv.connect(wet); wet.connect(master);
    revIn = rvHp;
    IDS.forEach(k => {
      const g = ctx.createGain(), s = ctx.createGain();
      let head = g;
      if (k === 'bass') { const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 32; hp.connect(g); head = hp; }
      g.connect(master); g.connect(s); s.connect(rvHp); BUS[k] = { g, s, in:head };
    });
    OUT = master;
    applyMix();
    const len = ctx.sampleRate * 2; noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    loadSamples();
  }
  if (!ctx.onstatechange) ctx.onstatechange = updateSoundUI;
  if (ctx.state !== 'running') { const p = ctx.resume(); if (p && p.then) p.then(updateSoundUI, updateSoundUI); }
  updateSoundUI();
  return true;
}
/* browsers keep sound locked until a click or key press on the page — MIDI notes don't count. Say so plainly. */
const audioLocked = () => !ctx || ctx.state !== 'running';
function updateSoundUI(){
  const on = !audioLocked();
  $('#soundChip').classList.toggle('on', on);
  $('#soundTxt').textContent = on ? '소리 켜짐' : (ctx ? '소리 꺼짐 · 클릭하면 켜져요' : '소리는 첫 클릭에 켜져요');
  if (on) $('#unlock').hidden = true;
}
function askToUnlock(){ if (audioLocked()) $('#unlock').hidden = false; }
function applyMix(){
  if (!ctx) return;
  IDS.forEach(k => { BUS[k].g.gain.value = MIX[k].mute ? 0 : MIX[k].vol; BUS[k].s.gain.value = MIX[k].rvb * rvbAmt * 2; });
}
function env(t, peak, a, d, dest = OUT){
  const g = ctx.createGain(); g.gain.setValueAtTime(.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(peak, .0002), t + a);
  g.gain.exponentialRampToValueAtTime(.0001, t + a + d);
  g.connect(dest); return g;
}
function osc(type, f, t, dur, dest){ const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); o.connect(dest); o.start(t); o.stop(t + dur + .05); return o; }
function noise(t, dur, dest){ const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true; s.connect(dest); s.start(t, Math.random() * 1.5); s.stop(t + dur + .05); return s; }
function filt(type, f, q, dest){ const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; if (q) b.Q.value = q; b.connect(dest); return b; }
function metal(t, peak, decay, hp){
  const out = env(t, peak, .001, decay);
  const h = filt('highpass', hp, .6, out); const b = filt('bandpass', 10000, .8, h);
  const mix = ctx.createGain(); mix.gain.value = .3; mix.connect(b);
  [2, 3, 4.16, 5.43, 6.79, 8.21].forEach(r => osc('square', 40 * r, t, decay + .1, mix));
  return out;
}
function choke(t){
  if (!openHat) return;
  const p = openHat.gain;
  if (p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(t); else p.cancelScheduledValues(t);
  p.setTargetAtTime(.0001, t, .015); openHat = null;
}
function tom(t, v, f, dec = .5){
  const out = env(t, v * .9, .002, dec);
  const o = osc('sine', f * 1.5, t, dec + .1, out); o.frequency.exponentialRampToValueAtTime(f, t + .12);
  const o2 = env(t, v * .18, .002, dec * .5); const p = osc('triangle', f * 2.4, t, dec, o2); p.frequency.exponentialRampToValueAtTime(f * 1.6, t + .1);
  noise(t, .06, filt('lowpass', 1400, 0, env(t, v * .16, .001, .04)));
}
/* synthesized fallback drums (used until samples decode, or when "합성음" is chosen) */
const VOICE = {
  kick(t, v){ const o = osc('sine', 155, t, .55, env(t, v, .002, .45)); o.frequency.exponentialRampToValueAtTime(45, t + .13);
              noise(t, .03, filt('highpass', 1800, 0, env(t, v * .25, .001, .018))); },
  snare(t, v){ noise(t, .26, filt('highpass', 1300, .7, env(t, v * .55, .001, .19)));
               const o = osc('triangle', 225, t, .14, env(t, v * .5, .001, .09)); o.frequency.exponentialRampToValueAtTime(172, t + .07);
               osc('sine', 340, t, .08, env(t, v * .18, .001, .05)); },
  side(t, v){ osc('triangle', 790, t, .07, env(t, v * .55, .0005, .04)); osc('sine', 1650, t, .05, env(t, v * .28, .0005, .025));
              noise(t, .05, filt('bandpass', 2600, 3, env(t, v * .4, .0005, .03))); },
  clap(t, v){ [0, .011, .022].forEach(d => noise(t + d, .02, filt('bandpass', 1300, 1.2, env(t + d, v * .5, .001, .012))));
              noise(t + .03, .2, filt('bandpass', 1200, .9, env(t + .03, v * .35, .001, .14))); },
  hhc(t, v){ choke(t); metal(t, v * .42, .055, 7500); },
  hhp(t, v){ choke(t); metal(t, v * .3, .04, 6000); noise(t, .04, filt('bandpass', 4200, 2, env(t, v * .08, .002, .03))); },
  hho(t, v){ choke(t); openHat = metal(t, v * .38, .55, 7000); },
  tom1(t, v){ tom(t, v, 210, .45); },
  tom2(t, v){ tom(t, v, 158, .52); },
  floor(t, v){ tom(t, v, 96, .75); },
  crash(t, v){ noise(t, 2.1, filt('highpass', 4500, .5, env(t, v * .42, .002, 1.9)));
               metal(t, v * .22, 1.3, 5200);
               noise(t, .7, filt('bandpass', 2200, .8, env(t, v * .12, .002, .6))); },
  ride(t, v){ metal(t, v * .15, 1.1, 6500);
              [523, 1243, 1987, 2810, 3577].forEach((f, i) => osc('sine', f, t, 1.5, env(t, v * (.07 - i * .009), .001, 1.3 - i * .14)));
              noise(t, .2, filt('highpass', 8000, 0, env(t, v * .09, .001, .16))); },
  bell(t, v){ [812, 1218, 1611, 2433, 3260].forEach((f, i) => osc('sine', f, t, 1.9, env(t, v * (.11 - i * .016), .0008, 1.7 - i * .2)));
              metal(t, v * .1, .6, 5000); },
  tamb(t, v){ noise(t, .25, filt('highpass', 6000, .7, env(t, v * .4, .002, .2)));
              [5400, 7200, 9100].forEach(f => osc('square', f, t, .15, filt('bandpass', f, 6, env(t, v * .04, .001, .12)))); },
  cowbell(t, v){ const out = filt('bandpass', 900, 1.5, env(t, v * .45, .001, .35)); osc('square', 540, t, .4, out); osc('square', 800, t, .4, out); },
};
function click(t, accent){ osc('sine', accent ? 1760 : 1180, t, .05, env(t, accent ? .32 : .2, .001, .03, master)); }
const curve = vel => Math.pow(vel / 127, 1.35);
const NOOP = { off(){} };
const hz = n => 440 * Math.pow(2, (n - 69) / 12);
function releaser(out, srcs, rel){
  return { off(t){
    t = Math.max(t, ctx.currentTime);
    const g = out.gain;
    if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(t); else g.cancelScheduledValues(t);
    g.setTargetAtTime(.0001, t, rel);
    srcs.forEach(s => { try { s.stop(t + rel * 7 + .05); } catch (e) {} });
  }};
}

/* ---- sampled drum kit (VCSL, CC0) ---- */
const KIT_SRC = { drum:'samples/drumkit.js', ebass:'samples/ebasskit.js', bass:'samples/basskit.js', piano:'samples/pianokit.js' };
const KIT_OF = { drum:'drum', bass:'bass', keys:'piano' };
const SMPK = { drum:{}, ebass:{}, bass:{}, piano:{} };
const kitState = { drum:'none', ebass:'none', bass:'none', piano:'none', pianoext:'none' };   // none → fetching → fetched → decoding → ready | failed
const KIT_LAZY = { pianoext:'samples/pianoextkit.js' };   // the piano's lowest and highest notes: loaded only when 88-key range is used
const KIT_INTO = { pianoext:'piano' };                     // …and decoded into the main piano kit
const TONES = {
  bass:{ finger:{ ko:'일렉 베이스 · 핑거', kit:'ebass' }, pick:{ ko:'일렉 베이스 · 피크', kit:'ebass' },
         upright:{ ko:'업라이트 베이스', kit:'bass' }, synth:{ ko:'신스 베이스', kit:null } },
  keys:{ steinway:{ ko:'그랜드 피아노 · Steinway B', kit:'piano' }, ep:{ ko:'일렉트릭 피아노', kit:null }, synth:{ ko:'신스', kit:null } },
};
const tone = { bass:'finger', keys:'steinway' };
function setTone(id, t){ if (TONES[id] && TONES[id][t]) tone[id] = t; updateSndUI(); }
const useSmp = { drum:true, bass:true, keys:true };
const kitData = k => k === 'drum' ? window.DRUM_SAMPLES : (window.BNM_KITS || {})[k];
function fetchKits(){
  Object.entries(KIT_SRC).forEach(([k, src]) => {
    if (kitData(k)) { kitState[k] = 'fetched'; decodeKit(k); return; }
    kitState[k] = 'fetching';
    const s = document.createElement('script'); s.src = src; s.async = true;
    s.onload = () => { kitState[k] = kitData(k) ? 'fetched' : 'failed'; decodeKit(k); updateSndUI(); };
    s.onerror = () => { kitState[k] = 'failed'; updateSndUI(); };
    document.head.appendChild(s);
  });
}
function decodeKit(k){
  if (!ctx || kitState[k] !== 'fetched') return;
  kitState[k] = 'decoding'; updateSndUI();
  const into = SMPK[KIT_INTO[k] || k]; let got = 0;
  const jobs = Object.entries(kitData(k)).map(([name, b64]) => new Promise(res => {
    try {
      const bin = atob(b64), buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      ctx.decodeAudioData(buf.buffer, b => { into[name] = b; got++; res(); }, () => res());
    } catch (e) { res(); }
  }));
  Promise.all(jobs).then(() => { kitState[k] = got ? 'ready' : 'failed'; updateSndUI(); });
}
function ensureKit(k){                               // fetch an on-demand kit the first time it's needed
  if (kitState[k] !== 'none') { decodeKit(k); return; }
  if (kitData(k)) { kitState[k] = 'fetched'; decodeKit(k); return; }
  kitState[k] = 'fetching';
  const s = document.createElement('script'); s.src = KIT_LAZY[k]; s.async = true;
  s.onload = () => { kitState[k] = kitData(k) ? 'fetched' : 'failed'; decodeKit(k); };
  s.onerror = () => { kitState[k] = 'failed'; };
  document.head.appendChild(s);
}
function loadSamples(){ Object.keys(kitState).forEach(decodeKit); updateSndUI(); }
/* melodic sampler: nearest recorded pitch, re-pitched; soft/loud layers cross-faded by velocity */
// Steinway B recordings every major third, A#0–G#7; roots outside 48–76 arrive with the on-demand kit
const PIANO_OPT = { roots:[22,24,28,32,36,40,44,48,52,56,60,64,68,72,76,80,84,88,92,96,100,104], gain:.62, rel:.09, lp:v => 1800 + 15000 * v, maxShift:6 };
const BASS_OPT = { roots:[28,30,31,34,36,38,40,42,44,45,49,52], gain:1.0, rel:.05, lp:v => 700 + 5200 * v, shelf:1.5 };
const EB_FINGER = { pre:'f', roots:[28,29,30,31,32,33,34,35,36,37,38,39], gain:.85, rel:.05, lp:v => 900 + 6500 * v };
const EB_PICK = { pre:'p', roots:[28,29,30,31,32,33,34,35,36,37,38,39,40], gain:.8, rel:.04, lp:v => 1500 + 10000 * v };
function sampledVoice(kit, n, t, v, o){
  const K0 = SMPK[kit]; if (kitState[kit] !== 'ready') return null;
  const pre = o.pre || '', K = {};
  o.roots.forEach(x => { ['_s', '_h'].forEach(sfx => { if (K0[pre + x + sfx]) K[x + sfx] = K0[pre + x + sfx]; }); });
  let r = null; o.roots.forEach(x => { if (K[x + '_s'] && (r === null || Math.abs(x - n) < Math.abs(r - n))) r = x; });
  if (r === null) return null;
  if (o.maxShift && Math.abs(n - r) > o.maxShift) return null;   // too far from any recording (e.g. still loading): use the fallback voice
  const out = ctx.createGain(); out.gain.value = o.gain * (.12 + .88 * v);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = o.lp(v); lp.Q.value = .5; lp.connect(out);
  let tail = out;
  if (o.shelf) { const sh = ctx.createBiquadFilter(); sh.type = 'lowshelf'; sh.frequency.value = 140; sh.gain.value = o.shelf; out.connect(sh); tail = sh; }
  tail.connect(OUT);
  // one recording per note (soft or loud zone) — blending two different takes of the same note smears the sound
  const b = (v > .5 && K[r + '_h']) ? K[r + '_h'] : K[r + '_s'];
  const s = ctx.createBufferSource(); s.buffer = b; s.playbackRate.value = Math.pow(2, (n - r) / 12);
  s.connect(lp); s.start(t);
  return releaser(out, [s], o.rel);
}
const DRUM_SMP = {
  kick:{ l:['kick_soft','kick_hard'], g:1.0, thump:true }, snare:{ l:['snare_soft','snare_hard'], g:.95 }, side:{ l:['side'], g:.85 },
  clap:{ l:['clap'], g:.8 }, hhc:{ l:['hhc_soft','hhc_hard'], g:.55, choke:true }, hhp:{ l:['hhp'], g:.5, choke:true },
  hho:{ l:['hho'], g:.5, open:true }, tom1:{ l:['tom_hi'], g:.85, rate:1.08 }, tom2:{ l:['tom_hi'], g:.85, rate:.86 },
  floor:{ l:['tom_lo'], g:.95, rate:.9 }, crash:{ l:['crash'], g:.62 }, ride:{ l:['ride'], g:.55 }, bell:{ l:['bell'], g:.5 },
  tamb:{ l:['tamb'], g:.5 }, cowbell:{ l:['cowbell'], g:.55 },
};
const DRUM_DEC = { kick:.42, snare:.5, side:.25, clap:.35, hhc:.25, hhp:.25, hho:1.2, tom1:.9, tom2:1.0, floor:1.2, crash:2.4, ride:1.4, bell:1.6, tamb:.5, cowbell:.4 };
const CYM = new Set(['crash', 'ride', 'bell', 'tamb']);
const lastHit = {};
function playSample(id, t, v){
  const m = DRUM_SMP[id]; if (!m) return false;
  const b = SMPK.drum[m.l.length > 1 && v > .55 ? m.l[1] : m.l[0]]; if (!b) return false;
  if (m.choke || m.open) choke(t);
  const src = ctx.createBufferSource(); src.buffer = b;
  src.playbackRate.value = (m.rate || 1) * (1 + (Math.random() - .5) * .014);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400 + 17000 * v;
  const g = ctx.createGain();
  const d = DRUM_DEC[id] || 1;                       // a kit drum rings shorter than the orchestral recordings: shape the tail
  g.gain.setValueAtTime(m.g * (.16 + .84 * v), t); g.gain.setTargetAtTime(.0001, t + d * .3, d * .3);
  const prev = lastHit[id];                          // re-hitting a drum damps its previous ring instead of stacking it
  if (prev && prev !== openHat) { try { prev.gain.cancelScheduledValues(t); prev.gain.setTargetAtTime(.0001, t, CYM.has(id) ? .12 : .015); } catch (e) {} }
  lastHit[id] = g;
  src.connect(lp); lp.connect(g); g.connect(OUT); src.start(t); src.stop(t + d * 2.5 + .1);
  if (m.open) openHat = g;
  if (m.thump) { const o = osc('sine', 118, t, .3, env(t, v * .35, .002, .2)); o.frequency.exponentialRampToValueAtTime(46, t + .1); }
  return true;
}
const SND_TXT = { drum:['실제 드럼 (VCSL)', '합성 드럼'], bass:['업라이트 베이스 (VSCO 2)', '신스 베이스'], keys:['그랜드 피아노 (Steinway B)', '일렉트릭 피아노 (FM)'] };
let sndTab = 'drum';
function updateSndUI(){
  const b = $('#sndTog'); if (!b) return;
  const sel = $('#toneSel'), picker = !!TONES[sndTab];
  b.hidden = picker; if (sel) sel.hidden = !picker;
  if (picker) {
    const opts = TONES[sndTab];
    if (sel.dataset.for !== sndTab) {
      sel.textContent = '';
      Object.entries(opts).forEach(([k, t]) => { const o = document.createElement('option'); o.value = k; o.textContent = t.ko; sel.appendChild(o); });
      sel.dataset.for = sndTab;
      sel.setAttribute('aria-label', sndTab === 'bass' ? '베이스 소리' : '건반 소리');
    }
    const k = opts[tone[sndTab]].kit, st = k ? kitState[k] : 'ready';
    sel.value = tone[sndTab];
    sel.title = st === 'failed' ? '샘플을 못 불러와 합성음으로 연주 중이에요' : (ctx && st !== 'ready') ? '샘플 준비 중… 잠시 합성음으로 연주해요' : '소리 고르기';
    return;
  }
  const id = sndTab, st = kitState[KIT_OF[id]], on = useSmp[id], [real, alt] = SND_TXT[id];
  b.setAttribute('aria-pressed', on);
  b.textContent = !on ? alt : st === 'ready' ? real : st === 'failed' ? `${alt} (샘플을 못 불러옴)` : ctx ? `${real} 준비 중…` : real;
  b.title = on ? `실제 녹음 샘플로 연주 중 · 누르면 ${alt}로 바꿔 비교해요` : `${alt}로 연주 중 · 누르면 ${real}로`;
}

/* ---- bass & electric piano ---- */
function bassVoice(n, t, v){
  const f = hz(n);
  const out = ctx.createGain(); const g = out.gain;
  g.setValueAtTime(.0001, t);
  g.exponentialRampToValueAtTime(.0002 + v * .8, t + .006);
  g.exponentialRampToValueAtTime(.0002 + v * .45, t + .3);
  g.exponentialRampToValueAtTime(.0001, t + 3.4);
  out.connect(OUT);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 3;
  lp.frequency.setValueAtTime(300 + v * 2200, t); lp.frequency.exponentialRampToValueAtTime(380, t + .32);
  lp.connect(out);
  const saw = ctx.createOscillator(); saw.type = 'sawtooth'; saw.frequency.value = f;
  const sg = ctx.createGain(); sg.gain.value = .42; saw.connect(sg); sg.connect(lp);
  const sub = ctx.createOscillator(); sub.type = 'sine'; sub.frequency.value = f;
  const bg = ctx.createGain(); bg.gain.value = .62; sub.connect(bg); bg.connect(out);
  [saw, sub].forEach(o => { o.start(t); o.stop(t + 3.5); });
  noise(t, .02, filt('bandpass', 1500, 1.4, env(t, v * .14, .001, .014)));
  return releaser(out, [saw, sub], .03);
}
function keysVoice(n, t, v){       // FM electric piano: sine carrier + decaying modulator + short "tine" partial
  const f = hz(n);
  const out = ctx.createGain(); const g = out.gain;
  g.setValueAtTime(.0001, t);
  g.exponentialRampToValueAtTime(.0002 + v * .3, t + .004);
  g.exponentialRampToValueAtTime(.0002 + v * .12, t + 1);
  g.exponentialRampToValueAtTime(.0001, t + 5);
  out.connect(OUT);
  const car = ctx.createOscillator(); car.type = 'sine'; car.frequency.value = f;
  const mod1 = ctx.createOscillator(); mod1.type = 'sine'; mod1.frequency.value = f;
  const mi = ctx.createGain(); mi.gain.setValueAtTime(f * (.5 + 2.3 * v), t); mi.gain.exponentialRampToValueAtTime(f * .1 + 1, t + 1.3);
  mod1.connect(mi); mi.connect(car.frequency);
  const tine = ctx.createOscillator(); tine.type = 'sine'; tine.frequency.value = f * 14;
  const ti = ctx.createGain(); ti.gain.setValueAtTime(f * 2.6 * v + 1, t); ti.gain.exponentialRampToValueAtTime(1, t + .06);
  tine.connect(ti); ti.connect(car.frequency);
  const cg = ctx.createGain(); cg.gain.value = .8; car.connect(cg); cg.connect(out);
  const body = ctx.createOscillator(); body.type = 'triangle'; body.frequency.value = f;
  const bg = ctx.createGain(); bg.gain.value = .22; body.connect(bg); bg.connect(out);
  const srcs = [car, mod1, tine, body]; srcs.forEach(o => { o.start(t); o.stop(t + 5.1); });
  return releaser(out, srcs, .12);
}
function synthKeysVoice(n, t, v){   // poly synth: two detuned saws + square sub-octave through a resonant low-pass sweep
  const f = hz(n);
  const out = ctx.createGain(); const g = out.gain;
  g.setValueAtTime(.0001, t);
  g.exponentialRampToValueAtTime(.0002 + v * .16, t + .012);
  g.exponentialRampToValueAtTime(.0002 + v * .11, t + .4);
  out.connect(OUT);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 4;
  const peak = Math.min(14000, f * 3 + 2500 * v + 600);
  lp.frequency.setValueAtTime(Math.min(18000, peak * 2.2), t); lp.frequency.exponentialRampToValueAtTime(peak, t + .35);
  lp.connect(out);
  const srcs = [];
  [-7, 7].forEach(c => { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = c; o.connect(lp); srcs.push(o); });
  const sq = ctx.createOscillator(); sq.type = 'square'; sq.frequency.value = f / 2;
  const sg = ctx.createGain(); sg.gain.value = .3; sq.connect(sg); sg.connect(lp); srcs.push(sq);
  srcs.forEach(o => { o.start(t); o.stop(t + 8); });
  return releaser(out, srcs, .18);
}
function playOn(tr, n, t, v){ OUT = BUS[tr.id] ? BUS[tr.id].in : master; const h = tr.voice(n, t, v); OUT = master; return h; }

/* ================= shared helpers ================= */
function stagePoint(stage, x, y){ const r = stage.getBoundingClientRect(); return { x: x - r.left, y: y - r.top, w: r.width, h: r.height }; }
const rectCenter = (el, fy = .5) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height * fy }; };
const LEGEND_PC = [0,2,4,5,7,9,11].map(p => [SOLF[p], pcColor(p)]);
const LEN_TXT = {1:'16분음표', 2:'8분음표', 3:'점8분음표', 4:'4분음표', 6:'점4분음표', 8:'2분음표', 12:'점2분음표', 16:'온음표'};
const lenTxt = l => LEN_TXT[l] || `16분음표 ${l}칸`;
const velViz = '<div class="viz v-vel"><i style="height:90%"></i><i style="height:45%"></i><i style="height:70%"></i><i style="height:45%"></i><i style="height:90%"></i><i style="height:45%"></i><i style="height:70%"></i><i style="height:45%"></i></div>';
function melodicAxes(rows, unit, velTip){
  return `
  <div class="axis"><span class="k">세로 축</span><h3>어떤 음을 칠까</h3>
    <p>위로 갈수록 <b>높은 음</b>이에요. 한 줄 = 반음(${unit}). 12줄 올라가면 같은 이름의 <b>한 옥타브 위</b> 음이에요.</p>
    <div class="viz v-rows">${rows.map(([n, t]) => `<div style="--c:${pcColor(n)}"><span>${noteName(n)}</span><span>${t}</span></div>`).join('')}</div></div>
  <div class="axis"><span class="k">가로 축</span><h3>언제, 얼마나 길게</h3>
    <p>노트의 <b>왼쪽 끝이 시작</b>, <b>가로 길이가 음 길이</b>예요. 드럼은 길이와 상관없이 ‘탁’ 하고 끝나지만, 이 악기는 노트가 길면 소리도 길게 이어져요.</p>
    <div class="viz v-len">${[[1,'16분'],[2,'8분'],[4,'4분'],[8,'2분']].map(([l, t]) => `<div><span>${t}</span><i style="width:${l / 8 * 100}%"></i></div>`).join('')}</div></div>
  <div class="axis"><span class="k">벨로시티</span><h3>얼마나 세게 칠까</h3>
    <p>0~127 사이 숫자예요. 노트 안의 가로선 길이와 아래 세로 막대 높이가 세기를 보여줍니다. ${velTip}</p>${velViz}</div>`;
}
const FINE_MELODIC = 'Logic의 실제 피아노 롤에서는 노트 색이 <b>세기(벨로시티)</b>를 뜻해요. 이 페이지는 같은 계이름을 찾기 쉽도록 <b>도·레·미·파·솔·라·시</b>마다 색을 정했어요(#은 양옆 두 색의 중간). 음 이름은 Logic 기준(C3 = MIDI 60)이라, C4 = 60을 쓰는 다른 프로그램에선 숫자가 하나씩 크게 보일 수 있어요.';
const STEPS_COMMON = `<li><span>트랙 빈 곳을 우클릭해 <b>MIDI 리전 생성</b>을 고릅니다.</span></li>`;

/* ================= DRUM ================= */
const CATS = {
  kick:{ko:'킥', v:'--c-kick'}, snare:{ko:'스네어', v:'--c-snare'}, tom:{ko:'탐', v:'--c-tom'},
  hat:{ko:'하이햇', v:'--c-hat'}, cym:{ko:'심벌', v:'--c-cym'}, perc:{ko:'퍼커션', v:'--c-perc'}
};
const INST = [
  { id:'kick', note:36, cat:'kick', key:'Z', ko:'킥 드럼', short:'킥', en:'Kick Drum · Bass Drum', part:'p-kick', anim:'thump',
    desc:'발로 페달을 밟아 치는 가장 큰 북이에요. 낮고 묵직한 <strong>“쿵”</strong> 소리로 곡의 심장 박동을 만듭니다.',
    where:'<strong>1박과 3박</strong>(정박)이 기본. 댄스 음악은 매 박마다 쿵-쿵-쿵-쿵.', mini:[0,8,10],
    tip:'드럼 노트는 거의 늘 <strong>C1</strong>(킥)에서 시작해요. 피아노 롤 맨 아래 C1을 기준점으로 삼으면 나머지 위치가 쉽게 외워집니다.' },
  { id:'side', note:37, cat:'snare', key:'C', ko:'사이드 스틱', short:'사이드스틱', en:'Side Stick · Cross Stick', part:'p-snare', anim:'thump',
    desc:'스틱을 스네어 위에 눕혀 테두리(림)를 <strong>“톡”</strong> 치는 주법이에요. 나무 두드리는 듯한 작은 소리입니다.',
    where:'조용한 발라드·보사노바에서 <strong>스네어 대신</strong> 2·4박에.', mini:[4,12],
    tip:'<strong>C#1</strong>, 킥 바로 위 검은 건반이에요. 이 페이지에선 스네어 <strong>테두리</strong>를 클릭하면 나요.' },
  { id:'snare', note:38, cat:'snare', key:'X', ko:'스네어 드럼', short:'스네어', en:'Snare Drum', part:'p-snare', anim:'thump',
    desc:'<strong>“딱!”</strong> 하고 튀는 소리. 북 아래에 철사 줄(스냅)이 붙어 있어 지글거리는 여운이 남아요.',
    where:'<strong>2박과 4박</strong>(백비트). 킥과 번갈아 쿵-딱-쿵-딱이 대부분 비트의 뼈대예요.', mini:[4,12],
    tip:'<strong>D1</strong>, 킥(C1)에서 흰 건반 하나 위예요. “쿵(C1) 딱(D1)”으로 외우세요. 아주 약하게(세기 30~50) 찍으면 <strong>고스트 노트</strong>가 돼요.' },
  { id:'clap', note:39, cat:'perc', key:'F', ko:'핸드 클랩', short:'박수', en:'Hand Clap', part:'p-clap', anim:'press',
    desc:'여러 사람이 동시에 치는 박수 <strong>“짝!”</strong>. 스네어 대신, 또는 스네어와 겹쳐서 백비트를 강조해요.',
    where:'댄스·팝·힙합의 <strong>2박과 4박</strong>.', mini:[4,12],
    tip:'<strong>D#1</strong>, 스네어(D1) 바로 위 검은 건반. 스네어와 같은 칸에 겹쳐 찍으면 두툼한 백비트가 돼요.' },
  { id:'floor', note:41, cat:'tom', key:'V', ko:'플로어 탐', short:'플로어 탐', en:'Low Floor Tom', part:'p-floor', anim:'thump',
    desc:'다리로 바닥에 서 있는 가장 크고 낮은 탐이에요. <strong>“둥”</strong> 하고 깊게 울립니다.',
    where:'필인(Fill)의 마지막, 마디 끝에서 다음 구간으로 내려앉을 때.', mini:[12,13,14,15],
    tip:'<strong>F1</strong>. 탐은 실제 음이 낮을수록 피아노 롤에서도 아래쪽이에요: 플로어 F1 &lt; 미드 C2 &lt; 하이 D2.' },
  { id:'hhc', note:42, cat:'hat', key:'A', ko:'하이햇 (닫힘)', short:'하이햇 닫힘', en:'Closed Hi-Hat', part:'p-hat', anim:'wobble',
    desc:'두 장의 심벌을 꽉 닫은 채 치는 짧은 <strong>“칫”</strong> 소리. 박을 잘게 쪼개 속도감을 만들어요.',
    where:'<strong>8분음표</strong>(한 박에 두 번)나 16분음표로 꾸준히.', mini:[0,2,4,6,8,10,12,14],
    tip:'<strong>F#1</strong>. 하이햇 세 가지(F#1·G#1·A#1)는 모두 <strong>검은 건반</strong>에 모여 있어요.' },
  { id:'hhp', note:44, cat:'hat', key:'D', ko:'하이햇 페달', short:'하이햇 페달', en:'Pedal Hi-Hat', part:'p-hpedal', anim:'press',
    desc:'손으로 치지 않고 왼발로 페달만 밟아 두 심벌이 맞부딪히는 <strong>“칙”</strong> 소리예요.',
    where:'재즈의 2·4박, 또는 손이 라이드를 칠 때 박자 유지용.', mini:[4,12],
    tip:'<strong>G#1</strong>. 하이햇 스탠드 아래 <strong>페달</strong>을 클릭하세요.' },
  { id:'hho', note:46, cat:'hat', key:'S', ko:'하이햇 (열림)', short:'하이햇 열림', en:'Open Hi-Hat', part:'p-hat', anim:'wobble',
    desc:'심벌을 벌린 채 쳐서 <strong>“치이-”</strong> 하고 길게 울리는 소리. 닫힌 하이햇을 치면 바로 끊겨요.',
    where:'<strong>엇박</strong>(박과 박 사이)에 넣으면 디스코·하우스 느낌.', mini:[2,6,10,14],
    tip:'<strong>A#1</strong>. 실제로는 왼발 페달을 떼서 열지만, 여기선 하이햇 <strong>바깥 링</strong>을 클릭하세요.' },
  { id:'tom2', note:48, cat:'tom', key:'E', ko:'미드 탐', short:'미드 탐', en:'Hi-Mid Tom', part:'p-tom2', anim:'thump',
    desc:'킥 위에 달린 두 번째 탐. 하이 탐보다 한 단계 낮은 <strong>“통”</strong> 소리예요.',
    where:'필인의 중간 단계. 높은 탐에서 낮은 탐으로 내려가며 두구두구.', mini:[10,11],
    tip:'<strong>C2</strong>. 킥(C1)에서 정확히 한 옥타브 위라 찾기 쉬워요.' },
  { id:'crash', note:49, cat:'cym', key:'Q', ko:'크래시 심벌', short:'크래시', en:'Crash Cymbal', part:'p-crash', anim:'wobble',
    desc:'<strong>“촤아앙”</strong> 하고 터지는 심벌. 새 구간(후렴 등)이 시작되는 순간을 알려줘요.',
    where:'마디의 <strong>첫 박</strong>에 킥과 함께 한 번.', mini:[0],
    tip:'<strong>C#2</strong>. 크래시를 찍을 땐 같은 칸 C1에 킥도 함께 찍는 게 보통이에요.' },
  { id:'tom1', note:50, cat:'tom', key:'W', ko:'하이 탐', short:'하이 탐', en:'High Tom', part:'p-tom1', anim:'thump',
    desc:'가장 작고 높은 탐. 맑고 짧은 <strong>“통”</strong> 소리예요.',
    where:'<strong>필인</strong>의 시작. 마디 끝에서 높은 탐 → 낮은 탐 순서로.', mini:[8,9],
    tip:'<strong>D2</strong>. 탐 세 개 중 가장 위쪽 줄이에요.' },
  { id:'ride', note:51, cat:'cym', key:'R', ko:'라이드 심벌', short:'라이드', en:'Ride Cymbal', part:'p-ride', anim:'wobble',
    desc:'가장 큰 심벌. <strong>“팅- 팅-”</strong> 하고 맑게 울려서 하이햇 대신 박자를 새길 때 써요.',
    where:'후렴처럼 에너지가 큰 구간이나 재즈에서 4분·8분음표로.', mini:[0,4,6,8,12,14],
    tip:'<strong>D#2</strong>. 하이햇(F#1) 줄의 패턴을 이 줄로 옮기면 분위기가 확 바뀌어요.' },
  { id:'bell', note:53, cat:'cym', key:'T', ko:'라이드 벨', short:'라이드 벨', en:'Ride Bell', part:'p-ride', anim:'wobble',
    desc:'라이드 가운데 볼록한 부분(벨)을 치는 <strong>“띵!”</strong> 소리. 다른 소리를 뚫고 나와요.',
    where:'엇박이나 후렴에서 포인트로.', mini:[2,6,10,14],
    tip:'<strong>F2</strong>. 라이드 한가운데 볼록한 부분을 클릭하세요.' },
  { id:'tamb', note:54, cat:'perc', key:'G', ko:'탬버린', short:'탬버린', en:'Tambourine', part:'p-tamb', anim:'wobble',
    desc:'둥근 테에 달린 작은 금속판(징글)이 <strong>“찰랑”</strong> 하고 울려요.',
    where:'후렴에서 <strong>엇박 8분음표</strong>나 2·4박에 더하면 밝고 들뜬 느낌.', mini:[2,6,10,14],
    tip:'<strong>F#2</strong>. GM 표준의 손 퍼커션은 F#2(탬버린)부터 위쪽에 모여 있어요.' },
  { id:'cowbell', note:56, cat:'perc', key:'H', ko:'카우벨', short:'카우벨', en:'Cowbell', part:'p-cow', anim:'wobble',
    desc:'금속 종을 스틱으로 치는 <strong>“깡!”</strong> 소리. 라틴·펑크 리듬의 박자 길잡이예요.',
    where:'라틴 음악에선 정해진 리듬 꼴로 계속, 록에선 포인트로.', mini:[0,3,6,8,10,13],
    tip:'<strong>G#2</strong>. 탬버린(F#2)에서 검은 건반 하나 위예요.' },
];
const GM_EXTRA = {40:'Electric Snare', 43:'High Floor Tom', 45:'Low Tom', 47:'Low-Mid Tom', 52:'Chinese Cymbal', 55:'Splash Cymbal'};
const BY_ID = {}, BY_NOTE = {}, BY_CODE = {};
INST.forEach(i => { BY_ID[i.id] = i; BY_NOTE[i.note] = i; BY_CODE['Key' + i.key] = i.id; i.color = `var(${CATS[i.cat].v})`; });

const P = (id, steps, vel) => steps.map((s, k) => ({ step:s, note:BY_ID[id].note, vel: typeof vel === 'function' ? vel(s, k) : vel, len:1 }));
const hatVel = s => s % 4 === 0 ? 108 : 72;
const DRUM_PRESETS = [
  { id:'rock', name:'8비트 록', bpm:100, desc:'하이햇 8분음표 + 킥 1·3박 + 스네어 2·4박. 대부분 록·팝의 기본 비트예요.',
    notes:[...P('crash',[0],112), ...P('hhc',[2,4,6,8,10,12,14],hatVel), ...P('kick',[0,8,10],s=>s===10?96:116), ...P('snare',[4,12],112)] },
  { id:'four', name:'포 온 더 플로어', bpm:122, desc:'킥을 매 박마다 쿵-쿵-쿵-쿵, 열린 하이햇은 엇박에. 디스코·하우스의 기본.',
    notes:[...P('kick',[0,4,8,12],118), ...P('clap',[4,12],96), ...P('hho',[2,6,10,14],96), ...P('hhc',[0,4,8,12],60)] },
  { id:'boom', name:'붐뱁 힙합', bpm:88, swing:[16,57], desc:'살짝 늦게 들어오는 킥과 묵직한 스네어. 16분 스윙을 살짝 걸어 90년대 힙합 느낌을 냈어요.',
    notes:[...P('kick',[0,7,10],s=>s===7?88:116), ...P('snare',[4,12],118), ...P('hhc',[0,2,4,6,8,10,12,14],s=>s%4===0?100:62), ...P('hho',[14],70)] },
  { id:'ballad', name:'발라드', bpm:72, desc:'사이드 스틱과 라이드로 조용하게. 큰 소리 없이 박자만 받쳐줘요.',
    notes:[...P('kick',[0,6,8],s=>s===6?80:104), ...P('side',[4,12],100), ...P('ride',[0,2,4,6,8,10,12,14],s=>s%4===0?92:64), ...P('hhp',[4,12],70)] },
  { id:'shuffle', name:'블루스 셔플', bpm:96, swing:[8,67], desc:'음표는 8비트와 거의 같은데 스윙 67%가 걸려 ‘따-단 따-단’ 셔플이 돼요. 스윙을 ‘없음’으로 바꿔 비교해 보세요.',
    notes:[...P('hhc',[0,2,4,6,8,10,12,14],s=>s%4===0?104:70), ...P('kick',[0,8,10],s=>s===10?90:112), ...P('snare',[4,12],112)] },
  { id:'jazz', name:'재즈 스윙', bpm:132, swing:[8,64], desc:'라이드가 ‘팅- 팅따 팅- 팅따’, 하이햇 페달이 2·4박, 킥은 아주 약하게(페더링). 재즈 트리오의 기본.',
    notes:[...P('ride',[0,4,6,8,12,14],s=>s%4===0?96:74), ...P('hhp',[4,12],86), ...P('kick',[0,4,8,12],38)] },
  { id:'funk', name:'펑크 고스트 노트', bpm:96, desc:'16분 하이햇 + 백비트 사이에 아주 약한 스네어(세기 34). 피아노 롤에서 세기선이 짧은 노트가 고스트 노트예요.',
    notes:[...P('hhc',[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14],s=>s%2?58:96), ...P('hho',[15],80), ...P('kick',[0,3,10],s=>s===0?116:96), ...P('snare',[4,12],118), ...P('snare',[7,9,14],34)] },
  { id:'bossa', name:'보사노바', bpm:128, desc:'사이드 스틱이 클라베 리듬을 치고, 킥이 ‘쿵—따 쿵—따’ 하고 굴러요. 하이햇은 부드럽게 8분음표.',
    notes:[...P('side',[0,3,6,10,13],88), ...P('kick',[0,3,4,7,8,11,12,15],s=>s%4===0?100:70), ...P('hhc',[0,2,4,6,8,10,12,14],s=>s%4===0?70:52)] },
  { id:'reggae', name:'레게 원 드롭', bpm:76, desc:'1박을 비우고 3박에 킥과 림을 한꺼번에 ‘쿵!’. 하이햇은 엇박을 강조해요.',
    notes:[...P('kick',[8],116), ...P('side',[8],106), ...P('hhc',[0,2,4,6,8,10,12,14],s=>s%4===2?96:60)] },
  { id:'latin', name:'라틴 퍼커션', bpm:104, desc:'카우벨·탬버린·박수로 색을 더한 라틴 팝 그루브. 퍼커션만 바꿔도 곡 분위기가 확 달라져요.',
    notes:[...P('cowbell',[0,3,6,8,10,13],s=>s%8===0?104:80), ...P('tamb',[2,6,10,14],84), ...P('clap',[4,12],100), ...P('kick',[0,8],110), ...P('kick',[11],86)] },
  { id:'fill', name:'2마디 + 탐 필인', bpm:96, bars:2, desc:'1마디는 기본 비트, 2마디 끝에서 탐 필인 → 다음 루프 첫 박에 크래시. “여기서 새 구간 시작!”이라는 신호예요.',
    notes:[...P('crash',[0],118), ...P('kick',[0,8,10,16,24],110), ...P('hhc',[2,4,6,8,10,12,14,16,18,20,22],hatVel), ...P('snare',[4,12,20],112), ...P('snare',[24,25],92), ...P('tom1',[26,27],104), ...P('tom2',[28,29],104), ...P('floor',[30,31],112)] },
];

const kit = $('#kit');
const zoneOf = id => kit.querySelector(`.zone[data-inst="${id}"]`);
function animatePart(id){
  const i = BY_ID[id]; const part = document.getElementById(i.part);
  restart(zoneOf(id), 'flash');
  if (reduced) return;
  restart(part, i.anim);
  if (id === 'hhp') restart($('#p-hat'), 'press');
}
(function decorateKit(){
  const rods = $('#kickRods');
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2 + Math.PI / 12;
    const x = 450 + Math.cos(a) * 154, y = 448 + Math.sin(a) * 144;
    mk('rect', {x:x-4, y:y-9, width:8, height:18, rx:2, fill:'#c4cad2', stroke:'rgba(0,0,0,.35)', transform:`rotate(${a * 180 / Math.PI + 90} ${x} ${y})`}, rods);
  }
  document.querySelectorAll('.lugs').forEach(g => {
    const cx = +g.dataset.cx, cy = +g.dataset.cy, rx = +g.dataset.rx, h = +g.dataset.h;
    [-.8, -.35, .35, .8].forEach(f => {
      const x = cx + f * rx; const lh = Math.min(22, h * .45);
      mk('rect', {x:x-3.5, y:cy + h*.5 - lh/2 + 6, width:7, height:lh, rx:3, fill:'#c9cfd6', stroke:'rgba(0,0,0,.3)'}, g);
    });
  });
  const tj = $('#tambJ');
  for (let k = 0; k < 6; k++) {
    const a = k / 6 * Math.PI * 2 + .3, x = 458 + Math.cos(a) * 34, y = 132 + Math.sin(a) * 34;
    mk('ellipse', {cx:x, cy:y, rx:7, ry:4.5, fill:'#dfe4ea', stroke:'rgba(0,0,0,.4)', transform:`rotate(${a * 180 / Math.PI + 90} ${x} ${y})`}, tj);
  }
  const badges = $('#badges');
  const pos = { crash:[310,150], ride:[640,190], bell:[742,140], hho:[196,322], hhc:[88,322], hhp:[125,604],
                snare:[245,434], side:[343,404], kick:[450,420], tom1:[372,252], tom2:[532,250], floor:[700,438],
                clap:[430,34], tamb:[498,104], cowbell:[592,72] };
  for (const id in pos) {
    const [x, y] = pos[id];
    const g = mk('g', {class:'badge'}, badges);
    mk('rect', {x:x-12, y:y-12, width:24, height:24, rx:7}, g);
    const t = mk('text', {x, y:y+.5}, g); t.textContent = BY_ID[id].key;
  }
  kit.querySelectorAll('.zone').forEach(z => {
    const i = BY_ID[z.dataset.inst];
    z.setAttribute('tabindex', '0'); z.setAttribute('role', 'button');
    z.setAttribute('aria-label', `${i.ko} (${i.en}) · 피아노 롤 ${noteName(i.note)}`);
    z.style.setProperty('--c', i.color);
  });
})();
function velFromPoint(zone, cx, cy){
  try {
    const m = zone.getScreenCTM().inverse();
    const p = new DOMPoint(cx, cy).matrixTransform(m);
    const b = zone.getBBox();
    const dx = (p.x - (b.x + b.width / 2)) / (b.width / 2), dy = (p.y - (b.y + b.height / 2)) / (b.height / 2);
    return Math.round(127 - Math.min(1, Math.hypot(dx, dy)) * 55);
  } catch (e) { return 100; }
}

const drum = {
  id:'drum', ko:'드럼', en:'Drum', melodic:false, rows:range(56, 36), stage:$('#stage-drum'), defaultNote:36,
  meta:'Drum · C1–G#2 · 15개',
  lede:'드럼을 두드리면 그 악기의 이름과, Logic Pro 피아노 롤의 어느 줄에 노트가 찍히는지 동시에 보여줍니다. 소리는 실제 드럼을 녹음한 샘플이에요.',
  chip:'킥 = <b>C1</b> (MIDI 36)',
  kitH:'Drum Kit <span class="ko">드럼 킷</span>',
  hint(){ return '부위를 클릭하세요 · 가운데를 칠수록 세게(벨로시티↑)'; },
  keyHint:'Shift를 같이 누르면 최대 세기(127)',
  legendHint:'빈 칸을 클릭하면 노트 추가, 노트를 클릭하면 삭제 · 왼쪽 건반을 누르면 소리 듣기',
  legend(){ return Object.values(CATS).map(c => [c.ko, `var(${c.v})`]); },
  presets:DRUM_PRESETS,
  voice(n, t, v){ const i = BY_NOTE[n]; if (!i) return NOOP; if (!(useSmp.drum && playSample(i.id, t, v))) VOICE[i.id](t, v); return NOOP; },
  colorOf:n => BY_NOTE[n] ? BY_NOTE[n].color : 'var(--ink-3)',
  label:n => BY_NOTE[n] ? BY_NOTE[n].ko : noteName(n),
  rowMeta(n){
    const i = BY_NOTE[n];
    if (i) return { used:true, color:i.color, b:i.short, i:i.en.split(' · ')[0], title:`${i.ko} · ${noteName(n)} (MIDI ${n}) — 클릭해서 소리 듣기` };
    return { used:false, i:GM_EXTRA[n] || '', title:`${noteName(n)} (MIDI ${n}) · GM ${GM_EXTRA[n] || ''} — 이 킷에서는 쓰지 않는 자리` };
  },
  keyAction(code){ const id = BY_CODE[code]; return id ? { note:BY_ID[id].note } : null; },
  visual:{
    down(n){ const i = BY_NOTE[n]; if (i) animatePart(i.id); },
    up(){}, reset(){},
    center(n){ return rectCenter(zoneOf(BY_NOTE[n].id)); },
    link(n){ const i = BY_NOTE[n]; if (i) zoneOf(i.id).classList.add('linked'); },
  },
  floatText(n){ const i = BY_NOTE[n]; return { title:i.ko, sub:i.en }; },
  tipText(n){ return `${BY_NOTE[n].ko}<span>${noteName(n)}</span>`; },
  info(n, vel){
    const i = BY_NOTE[n];
    setInfo({ note:n, color:i.color, key:i.key, name:i.ko, en:i.en, vel,
      h1:'어떤 소리?', p1:i.desc, h2:'주로 어디에?', p2:i.where, h3:'Logic 피아노 롤 팁', p3:i.tip,
      mini(el){
        el.className = 'mini';
        for (let b = 0; b < 4; b++) {
          const beat = document.createElement('div'); beat.className = 'beat';
          for (let s = 0; s < 4; s++) { const c = document.createElement('i'); c.className = 'cell' + (i.mini.includes(b * 4 + s) ? ' on' : ''); beat.appendChild(c); }
          const bn = document.createElement('span'); bn.className = 'bn'; bn.textContent = (b + 1) + '박'; beat.appendChild(bn);
          el.appendChild(beat);
        }
      } });
  },
  keymapRows(){
    return [[0, ['Q','W','E','R','T']], [18, ['A','S','D','F','G','H']], [36, ['Z','X','C','V']]].map(([pad, ks]) => ({ pad,
      items: ks.map(k => { const i = INST.find(x => x.key === k); return { k, sub:i.short, note:i.note, color:i.color, title:`${i.ko} · ${noteName(i.note)}` }; }) }));
  },
  axes:`
    <div class="axis"><span class="k">세로 축</span><h3>어떤 악기를 칠까</h3>
      <p>드럼에선 건반 하나가 음 높이가 아니라 <b>악기 하나</b>예요. 줄(건반)이 정해지면 소리가 정해집니다.</p>
      <div class="viz v-rows"><div style="--c:var(--c-hat)"><span>F#1</span><span>하이햇</span></div><div style="--c:var(--c-snare)"><span>D1</span><span>스네어</span></div><div style="--c:var(--c-kick)"><span>C1</span><span>킥</span></div></div></div>
    <div class="axis"><span class="k">가로 축</span><h3>언제 칠까</h3>
      <p>왼쪽에서 오른쪽으로 시간이 흘러요. <b>1.2</b>는 ‘1마디의 2번째 박’이라는 뜻이고, 한 박은 16분음표 네 칸입니다.</p>
      <div class="viz v-time"><span>1</span><span>1.2</span><span>1.3</span><span>1.4</span></div></div>
    <div class="axis"><span class="k">벨로시티</span><h3>얼마나 세게 칠까</h3>
      <p>0~127 사이 숫자예요. 노트 안의 가로선 길이와 아래 세로 막대 높이가 세기를 보여줍니다. 하이햇은 강약을 섞으면 사람이 친 것처럼 들려요.</p>${velViz}</div>`,
  fineRoll:'Logic의 실제 피아노 롤에서는 노트 색이 <b>세기(벨로시티)</b>를 뜻해요. 이 페이지는 악기와 노트를 쉽게 짝지을 수 있도록 악기 종류별로 색을 나눴습니다. 음 이름은 Logic 기준(C3 = MIDI 60)이라, C4 = 60을 쓰는 다른 프로그램에선 킥이 C2로 보일 수 있어요.',
  steps:`
    <li><span><kbd>⌥⌘S</kbd> 새 소프트웨어 악기 트랙을 만들고, 라이브러리(<kbd>Y</kbd>)에서 <b>Drum Kit</b> 계열 패치를 고릅니다.</span></li>
    ${STEPS_COMMON}
    <li><span>리전을 선택하고 <kbd>P</kbd>를 눌러 <b>피아노 롤</b>을 엽니다.</span></li>
    <li><span><kbd>T</kbd>로 도구 메뉴를 열어 <b>연필 도구</b>를 고른 뒤, C1(킥)·D1(스네어)·F#1(하이햇) 줄을 클릭해 노트를 찍습니다.</span></li>
    <li><span>직접 연주해 녹음했다면 노트를 선택하고 <kbd>Q</kbd>로 <b>퀀타이즈</b>(박자 칸에 맞추기)합니다. 스윙은 퀀타이즈 메뉴의 <b>Swing</b> 값으로 줄 수 있어요.</span></li>`,
  fineLogic:'노트 배치는 General MIDI(GM) 드럼 표준을 따릅니다. 소리는 VCSL(Versilian Community Sample Library, CC0 퍼블릭 도메인)의 실제 녹음을 다듬어 썼고, 세기에 따라 약하게/세게 친 샘플이 바뀌어요.',
};

/* ================= BASS ================= */
const BSTR = [ {name:'G', open:43, num:1}, {name:'D', open:38, num:2}, {name:'A', open:33, num:3}, {name:'E', open:28, num:4} ];
const BY_S = [112, 162, 212, 262];
const NUT = 96, FRETS = 12;
const fretX = f => NUT + 1560 * (1 - Math.pow(2, -f / 12));
const cellX = f => f === 0 ? [30, NUT - 8] : [fretX(f - 1), fretX(f)];
const dotX = f => { const [a, b] = cellX(f); return f === 0 ? (a + b) / 2 : b - (b - a) * .45; };
const BKROWS = [
  ['Digit1','Digit2','Digit3','Digit4','Digit5','Digit6','Digit7','Digit8','Digit9','Digit0'],
  ['KeyQ','KeyW','KeyE','KeyR','KeyT','KeyY','KeyU','KeyI','KeyO','KeyP'],
  ['KeyA','KeyS','KeyD','KeyF','KeyG','KeyH','KeyJ','KeyK','KeyL','Semicolon'],
  ['KeyZ','KeyX','KeyC','KeyV','KeyB','KeyN','KeyM','Comma','Period','Slash'],
];
const BKLBL = ['1234567890', 'QWERTYUIOP', 'ASDFGHJKL;', 'ZXCVBNM,./'];
const BASS_KEYS = {}, BASS_KEYLBL = {};
BKROWS.forEach((row, s) => row.forEach((code, f) => { BASS_KEYS[code] = { s, f }; BASS_KEYLBL[s + ':' + f] = BKLBL[s][f]; }));
const bassPositions = n => BSTR.map((st, s) => ({ s, f: n - st.open })).filter(p => p.f >= 0 && p.f <= FRETS);
const bassDefault = n => bassPositions(n).sort((a, b) => a.f - b.f)[0];
const posTxt = p => `${BSTR[p.s].name}줄 ${p.f === 0 ? '개방현' : p.f + '프렛'}`;
const bassZones = {};
const bassSvg = $('#bassSvg');
(function buildBass(){
  const svg = bassSvg;
  svg.innerHTML = `<defs>
    <linearGradient id="gBoard" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#2f1d14"/><stop offset=".5" stop-color="#4a2e20"/><stop offset="1" stop-color="#2f1d14"/></linearGradient>
    <linearGradient id="gHead2" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="#20242b"/><stop offset="1" stop-color="#363b45"/></linearGradient>
    <linearGradient id="gFret" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="#8d949e"/><stop offset=".5" stop-color="#f3f5f7"/><stop offset="1" stop-color="#8d949e"/></linearGradient>
    <radialGradient id="gPearl" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#fffdf6"/><stop offset="1" stop-color="#cfc6b2"/></radialGradient>
    <radialGradient id="gShadowB" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#000" stop-opacity=".28"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
  </defs>`;
  const top = BY_S[0] - 32, bot = BY_S[3] + 32;
  mk('ellipse', {cx:470, cy:bot + 14, rx:440, ry:16, fill:'url(#gShadowB)'}, svg);
  mk('path', {d:`M${NUT - 6} ${top - 6} L40 ${top - 30} Q10 ${top - 34} 10 ${top - 4} L10 ${bot + 4} Q10 ${bot + 34} 40 ${bot + 30} L${NUT - 6} ${bot + 6} Z`, fill:'url(#gHead2)', stroke:'rgba(0,0,0,.45)'}, svg);
  mk('rect', {x:NUT, y:top, width:892 - NUT, height:bot - top, fill:'url(#gBoard)', stroke:'rgba(0,0,0,.35)'}, svg);
  for (let k = 0; k < 7; k++) mk('line', {x1:NUT, x2:892, y1:top + 18 + k * 30 + (k % 2) * 7, y2:top + 22 + k * 30, stroke:'rgba(255,255,255,.035)', 'stroke-width':3}, svg);
  mk('rect', {x:NUT - 8, y:top - 2, width:9, height:bot - top + 4, rx:2, fill:'#efe6d2', stroke:'rgba(0,0,0,.3)'}, svg);
  const midY = (BY_S[1] + BY_S[2]) / 2;
  [3, 5, 7, 9].forEach(f => mk('circle', {cx:(fretX(f - 1) + fretX(f)) / 2, cy:midY, r:8, fill:'url(#gPearl)'}, svg));
  [(BY_S[0] + BY_S[1]) / 2, (BY_S[2] + BY_S[3]) / 2].forEach(y => mk('circle', {cx:(fretX(11) + fretX(12)) / 2, cy:y, r:8, fill:'url(#gPearl)'}, svg));
  for (let f = 1; f <= FRETS; f++) mk('rect', {x:fretX(f) - 2, y:top, width:4, height:bot - top, fill:'url(#gFret)'}, svg);
  for (let f = 0; f <= FRETS; f++) {
    const [a, b] = cellX(f);
    const t = mk('text', {class:'fretnum' + ([3,5,7,9,12].includes(f) ? ' mk' : ''), x:(a + b) / 2, y:bot + 26}, svg);
    t.textContent = f === 0 ? '개방' : f;
  }
  const W = [2.2, 2.9, 3.7, 4.6];
  BSTR.forEach((st, s) => {
    const g = mk('g', {class:'bstring', 'data-s':s}, svg);
    mk('line', {x1:22, y1:BY_S[s] + 2.2, x2:900, y2:BY_S[s] + 2.2, stroke:'rgba(0,0,0,.45)', 'stroke-width':W[s]}, g);
    mk('line', {x1:22, y1:BY_S[s], x2:900, y2:BY_S[s], stroke:'#c9ced6', 'stroke-width':W[s]}, g);
    mk('line', {x1:22, y1:BY_S[s] - W[s] * .25, x2:900, y2:BY_S[s] - W[s] * .25, stroke:'rgba(255,255,255,.55)', 'stroke-width':.8}, g);
    mk('circle', {cx:24, cy:BY_S[s], r:11, fill:'#c4cad2', stroke:'rgba(0,0,0,.45)'}, svg);
    const tl = mk('text', {class:'pegl', x:24, y:BY_S[s] + .5}, svg); tl.textContent = st.name;
  });
  const names = mk('g', {}, svg);
  BSTR.forEach((st, s) => { for (let f = 0; f <= FRETS; f++) {
    const n = st.open + f; const g = mk('g', {class:'fbn'}, names); g.style.setProperty('--c', pcColor(n));
    mk('circle', {cx:dotX(f), cy:BY_S[s], r:10.5}, g); const t = mk('text', {x:dotX(f), y:BY_S[s] + .5}, g); t.textContent = noteName(n);
  } });
  const zones = mk('g', {}, svg);
  BSTR.forEach((st, s) => { for (let f = 0; f <= FRETS; f++) {
    const n = st.open + f, [a, b] = cellX(f);
    const z = mk('g', {class:'zone fbz', tabindex:'0', role:'button', 'aria-label':`${posTxt({s, f})} · ${noteName(n)} ${SOLF[mod(n, 12)]}`}, zones);
    z.style.setProperty('--c', pcColor(n)); z.dataset.note = n; z.dataset.s = s; z.dataset.f = f;
    mk('rect', {class:'cellr', x:a, y:BY_S[s] - 25, width:b - a, height:50}, z);
    mk('rect', {class:'hl', x:a + 2, y:BY_S[s] - 22, width:b - a - 4, height:44, rx:8}, z);
    const d = mk('g', {class:'fdot'}, z);
    mk('circle', {cx:dotX(f), cy:BY_S[s], r:13.5}, d);
    const t = mk('text', {x:dotX(f), y:BY_S[s] + .5}, d); t.textContent = noteName(n);
    bassZones[s + ':' + f] = z;
  } });
})();
const bassZone = (n, pos) => { pos = pos || bassDefault(n); return pos ? bassZones[pos.s + ':' + pos.f] : null; };
function bassMini(el, n, pos){
  el.className = 'fmini';
  const add = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; el.appendChild(e); return e; };
  add('span', '', '');
  for (let f = 0; f <= FRETS; f++) add('span', '', [0, 3, 5, 7, 9, 12].includes(f) ? f : '');
  BSTR.forEach((st, s) => {
    add('span', '', st.name);
    for (let f = 0; f <= FRETS; f++) add('i', [f === 0 ? 'f0' : '', st.open + f === n ? 'on' : '', pos.s === s && pos.f === f ? 'cur' : ''].join(' ').trim());
  });
}
function bassTip(n, pos){
  const st = BSTR[pos.s], f = pos.f;
  if (n === 28) return '<strong>E0</strong>은 4현 베이스에서 가장 낮은 음이에요. Logic 피아노 롤에서 C1(드럼 킥 자리)보다도 반음 8개 아래에 있어요.';
  if (f === 0) return '개방현 4개는 낮은 줄부터 <strong>E0 · A0 · D1 · G1</strong>. 이웃한 줄은 반음 5개 차이라, 피아노 롤에서도 정확히 5줄씩 떨어져 있어요.';
  if (f === 12) return `12프렛은 개방현보다 <strong>정확히 한 옥타브 위</strong>예요. 피아노 롤에서는 ${noteName(st.open)}에서 12줄 위, 같은 이름(${NAMES[mod(n, 12)]})의 줄이에요.`;
  if (f === 5 && pos.s > 0) { const up = BSTR[pos.s - 1]; return `${st.name}줄 5프렛 = 바로 위 <strong>${up.name}줄 개방현</strong>. 그래서 두 자리 모두 피아노 롤의 같은 줄(${noteName(n)})에 찍혀요. 베이스 튜닝을 맞출 때도 이 원리를 써요.`; }
  if (pos.s >= 2 && f + 2 <= FRETS) { const up2 = BSTR[pos.s - 2]; return `옥타브 모양: <strong>두 줄 위, 두 프렛 오른쪽</strong>(${up2.name}줄 ${f + 2}프렛)을 치면 ${noteName(n + 12)}, 피아노 롤에서 12줄 위예요. 디스코 베이스의 ‘둥-둥’ 옥타브가 바로 이 모양이에요.`; }
  if (pos.s >= 1 && f + 2 <= FRETS) { const up = BSTR[pos.s - 1]; return `<strong>한 줄 위, 두 프렛 오른쪽</strong>(${up.name}줄 ${f + 2}프렛)을 치면 ${noteName(n + 7)}, 이 음의 5도예요. 루트와 5도는 록 베이스 라인의 기본 재료예요.`; }
  return '같은 줄에서 프렛을 한 칸 옮길 때마다 피아노 롤에서는 한 줄(반음)씩 움직여요. 베이스는 악보보다 한 옥타브 낮게 울리는 악기라, 피아노 롤에서도 C3보다 한참 아래에 모여 있어요.';
}
const B = (step, note, len, vel) => ({ step, note, len, vel });
const seqB = (list, len, v1, v2) => list.map((n, k) => B(k * len, n, len, k % 2 ? v2 : v1));
const BASS_PRESETS = [
  { id:'rock', name:'8비트 록', bpm:100, desc:'근음(A)을 8분음표로 꾸준히. 코드가 바뀌면 근음만 따라가요(A–F–G). 드럼 「8비트 록」, 건반 「8비트 록」과 합주돼요.',
    notes:[B(0,33,2,112),B(2,33,2,90),B(4,33,2,104),B(6,33,2,90),B(8,29,2,108),B(10,29,2,90),B(12,31,2,108),B(14,31,2,90)] },
  { id:'four', name:'디스코 옥타브', bpm:122, desc:'근음과 한 옥타브 위를 번갈아 ‘둥-둥’. 지판에선 두 줄 위·두 프렛 오른쪽 모양이에요.',
    notes:[B(0,33,1,112),B(2,45,1,96),B(4,33,1,108),B(6,45,1,96),B(8,38,1,112),B(10,50,1,96),B(12,38,1,108),B(14,50,1,96)] },
  { id:'boom', name:'붐뱁 힙합', bpm:88, swing:[16,57], desc:'킥 드럼과 같은 자리를 노리는 짧고 굵은 음. 붐뱁 드럼과 같이 들으면 하나처럼 붙어요.',
    notes:[B(0,38,3,116),B(7,38,1,88),B(10,33,2,104),B(12,36,3,108)] },
  { id:'ballad', name:'발라드', bpm:72, desc:'C에서 B로 반음 내려가는 긴 음(2분음표). 화성의 바닥을 받쳐요.', notes:[B(0,36,8,100),B(8,35,8,96)] },
  { id:'pop', name:'팝 진행', bpm:100, desc:'I–V–vi–IV(C–G–Am–F) 근음을 4분음표로. 수많은 팝송이 쓰는 코드 진행이에요.',
    notes:[B(0,36,4,108),B(4,31,4,100),B(8,33,4,104),B(12,29,4,100)] },
  { id:'bossa', name:'보사노바', bpm:128, bars:2, desc:'근음–5도를 ‘점4분음표 + 8분음표’로 출렁이게. Cmaj7 → Dm7–G7 위에서.',
    notes:[B(0,36,6,104),B(6,31,2,86),B(8,31,6,96),B(14,36,2,84),B(16,38,6,104),B(22,33,2,86),B(24,31,6,100),B(30,38,2,84)] },
  { id:'reggae', name:'레게', bpm:76, desc:'1박을 비우고 2박부터 노래하듯 움직이는 레게 베이스. 드럼 「레게 원 드롭」과 짝이에요.',
    notes:[B(4,33,3,108),B(7,36,1,86),B(8,40,3,104),B(11,40,1,80),B(12,38,2,96),B(14,36,2,90)] },
  { id:'money', name:'머니 코드', group:'recipe', bpm:92, bars:2, desc:'C–G–Am–F 근음을 피아노와 같은 3+3+2 리듬으로. 베이스와 건반 리듬이 맞으면 밴드가 한 덩어리로 들려요.',
    notes:[36,31,33,29].flatMap((n, k) => [B(k * 8, n, 3, 104), B(k * 8 + 3, n, 3, 86), B(k * 8 + 6, n, 2, 94)]) },
  { id:'royal', name:'왕도 진행', group:'recipe', bpm:80, bars:2, desc:'F–G–E–A 근음을 3+3+2 리듬으로. 건반 「왕도 진행」과 짝이에요.',
    notes:[29,31,28,33].flatMap((n, k) => [B(k * 8, n, 3, 100), B(k * 8 + 3, n, 3, 84), B(k * 8 + 6, n, 2, 92)]) },
  { id:'canon', name:'캐논 (파헬벨)', group:'lick', bpm:72, bars:2, desc:'파헬벨 「캐논」(1680년경, 퍼블릭 도메인)의 반복 저음 D–A–B–F#–G–D–G–A. 건반 「캐논 진행」과 함께 들어보세요.',
    notes:seqB([38,33,35,30,31,38,31,33], 4, 100, 92) },
  { id:'boogie', name:'부기우기', group:'lick', bpm:112, bars:2, swing:[8,66], scale:[4,'blues'], desc:'1–3–5–6–♭7–6–5–3을 오르내리는 전통 블루스 베이스. E7 → A7. 셔플 스윙이 걸려 있어요. 드럼 「블루스 셔플」, 건반 「찰스턴 블루스」와 합주돼요.',
    notes:seqB([28,32,35,37,38,37,35,32, 33,37,40,42,43,42,40,37], 2, 106, 86) },
  { id:'walk', name:'재즈 워킹 ii–V–I', group:'lick', bpm:132, bars:2, swing:[8,64], scale:[0,'major'], desc:'Dm7–G7–Cmaj7 위를 4분음표로 걷는 워킹 베이스. 마지막 C#은 다음 루프의 D로 반음 올라가는 접근음이에요. 드럼 「재즈 스윙」, 건반 「ii–V–I 루트리스」와 합주돼요.',
    notes:seqB([38,41,31,35,36,40,43,37], 4, 100, 88) },
  { id:'motown', name:'모타운 스타일', group:'lick', bpm:104, bars:2, desc:'근음에서 3·5·6도를 오가며 싱코페이션으로 노래하는 60년대 소울 스타일. 마디 끝 반음 접근(E→F, B→C)에 귀 기울여 보세요.',
    notes:[B(0,36,3,110),B(3,36,1,80),B(4,40,2,96),B(6,43,2,96),B(8,45,3,104),B(11,43,1,80),B(12,40,2,96),B(14,28,2,92),
           B(16,29,3,110),B(19,29,1,80),B(20,33,2,96),B(22,36,2,96),B(24,38,3,104),B(27,36,1,80),B(28,33,2,96),B(30,35,2,92)] },
  { id:'funk', name:'펑크 슬랩', group:'lick', bpm:98, swing:[16,55], scale:[4,'minpent'], desc:'옥타브 점프(E0↔E1)와 아주 약한 고스트 노트로 튀는 펑크 스타일. E 마이너 펜타토닉 안에서 움직여요.',
    notes:[B(0,28,1,114),B(2,40,1,102),B(3,28,1,46),B(6,40,1,98),B(7,38,1,84),B(8,28,1,110),B(10,31,1,96),B(11,32,1,90),B(12,33,1,104),B(14,40,1,100),B(15,38,1,84)] },
];
const BASS_TONE_OF = { rock:'pick', four:'finger', boom:'finger', ballad:'finger', pop:'finger', bossa:'upright', reggae:'finger',
  canon:'upright', boogie:'upright', walk:'upright', motown:'finger', funk:'finger', money:'finger', royal:'finger' };
const setBassTone = t => setTone('bass', t);
const bass = {
  id:'bass', ko:'베이스', en:'Bass', melodic:true, rows:range(55, 28), stage:$('#stage-bass'), defaultNote:28, svg:bassSvg,
  meta:'Bass · E0–G1 · 4줄 12프렛',
  lede:'베이스 지판의 줄과 프렛을 누르면 그 음의 이름과, Logic Pro 피아노 롤의 어느 줄에 노트가 찍히는지 동시에 보여줍니다. 프렛 한 칸이 피아노 롤 한 줄이라는 것, 같은 음이 여러 자리에서 난다는 것을 눈으로 확인해 보세요. 소리는 실제 일렉 베이스와 업라이트 베이스 녹음이에요.',
  chip:'E줄 개방 = <b>E0</b> (MIDI 28)',
  kitH:'Bass Neck <span class="ko">베이스 지판</span>',
  hint(){ return '줄 위 칸을 클릭하세요 · 누르고 있는 동안 소리가 이어져요'; },
  keyHint:'숫자줄 = G줄 · Q줄 = D줄 · A줄 = A줄 · Z줄 = E줄, 왼쪽부터 0~9프렛',
  legendHint:'빈 칸을 클릭하면 ‘입력 간격’ 길이의 노트 추가, 노트를 클릭하면 삭제 · 왼쪽 건반을 누르고 있으면 소리 듣기',
  legend(){ return LEGEND_PC; },
  presets:BASS_PRESETS,
  voice(n, t, v){
    const b = tone.bass;
    const h = b === 'finger' ? sampledVoice('ebass', n, t, v, EB_FINGER)
            : b === 'pick' ? sampledVoice('ebass', n, t, v, EB_PICK)
            : b === 'upright' ? sampledVoice('bass', n, t, v, BASS_OPT) : null;
    return h || bassVoice(n, t, v);
  },
  colorOf:pcColor,
  label:n => SOLF[mod(n, 12)],
  rowMeta(n){
    const st = BSTR.find(x => x.open === n);
    return { used:true, color:pcColor(n), b:SOLF[mod(n, 12)], i: st ? `${st.name}줄 개방` : '', title:`${noteName(n)} · ${SOLF[mod(n, 12)]} (MIDI ${n}) — 누르고 있으면 소리 듣기` };
  },
  keyAction(code){ const p = BASS_KEYS[code]; return p ? { note:BSTR[p.s].open + p.f, pos:{ s:p.s, f:p.f } } : null; },
  visual:{
    down(n, pos){
      pos = pos || bassDefault(n); const z = bassZone(n, pos); if (!z) return;
      z._n = (z._n || 0) + 1; z.classList.add('down'); restart(z, 'flash');
      if (!reduced) restart(bassSvg.querySelector(`.bstring[data-s="${pos.s}"]`), 'vib');
    },
    up(n, pos){ const z = bassZone(n, pos); if (!z) return; z._n = Math.max(0, (z._n || 0) - 1); if (!z._n) z.classList.remove('down'); },
    reset(){ Object.values(bassZones).forEach(z => { z._n = 0; z.classList.remove('down'); }); },
    center(n, pos){ const z = bassZone(n, pos); return rectCenter(z.querySelector('.fdot circle')); },
    link(n){ bassPositions(n).forEach(p => bassZones[p.s + ':' + p.f].classList.add('linked')); },
  },
  floatText(n, pos){ pos = pos || bassDefault(n); return { title:`${SOLF[mod(n, 12)]} (${NAMES[mod(n, 12)]})`, sub:posTxt(pos) }; },
  tipText(n, pos){ pos = pos || bassDefault(n); const k = BASS_KEYLBL[pos.s + ':' + pos.f]; return `${posTxt(pos)} · ${SOLF[mod(n, 12)]}<span>${noteName(n)}${k ? ' · 키 ' + k : ''}</span>`; },
  info(n, vel, o = {}){
    const pos = (o.pos && BSTR[o.pos.s].open + o.pos.f === n) ? o.pos : bassDefault(n);
    const st = BSTR[pos.s], pc = mod(n, 12);
    const others = bassPositions(n).filter(p => p.s !== pos.s);
    setInfo({ note:n, color:pcColor(n), key:BASS_KEYLBL[pos.s + ':' + pos.f] || NAMES[pc], vel,
      name:`${noteName(n)} · ${SOLF[pc]}`, en:`${st.name}줄(${st.num}번 줄) · ${pos.f === 0 ? '개방현' : pos.f + '번 프렛'}`,
      h1:'자리 읽기',
      p1: pos.f === 0
        ? `왼손으로 아무 프렛도 누르지 않고 <strong>${st.name}줄</strong>을 튕긴 소리예요(개방현). 4개 줄 중 ${['가장 높은', '두 번째로 높은', '두 번째로 낮은', '가장 낮은'][pos.s]} 줄이에요.`
        : `<strong>${st.name}줄</strong>의 <strong>${pos.f}번 프렛</strong>을 누르고 튕긴 소리예요. 개방현 ${noteName(st.open)}에서 반음 ${pos.f}개 위라, 피아노 롤에서도 ${pos.f}줄 위에 찍혀요.`,
      h2:'같은 음, 다른 자리',
      p2: others.length
        ? `<strong>${others.map(posTxt).join(', ')}</strong>에서도 똑같은 ${noteName(n)} 소리가 나요. 어느 자리로 쳐도 피아노 롤에는 <strong>같은 줄</strong>에 찍혀요.`
        : '4줄·12프렛 안에서는 이 자리에서만 낼 수 있는 음이에요.',
      mini(el){ bassMini(el, n, pos); },
      h3:'Logic 피아노 롤 팁', p3:bassTip(n, pos) });
  },
  keymapRows(){
    return BKLBL.map((row, s) => ({ pad:s * 14, items:[...row].map((k, f) => { const n = BSTR[s].open + f; return { k, sub:noteName(n), note:n, pos:{ s, f }, color:pcColor(n), title:`${posTxt({ s, f })} · ${noteName(n)}` }; }) }));
  },
  axes:melodicAxes([[45, '라 · 한 옥타브 위'], [33, '라 · A줄 개방'], [28, '미 · E줄 개방']], '프렛 한 칸', '베이스는 박의 첫 음을 조금 더 세게, 사이 음은 약하게 치면 그루브가 살아나요.'),
  fineRoll:FINE_MELODIC,
  steps:`
    <li><span><kbd>⌥⌘S</kbd> 새 소프트웨어 악기 트랙을 만들고, 라이브러리(<kbd>Y</kbd>)의 <b>Bass</b> 카테고리에서 패치를 고릅니다.</span></li>
    ${STEPS_COMMON}
    <li><span>리전을 선택하고 <kbd>P</kbd>를 눌러 <b>피아노 롤</b>을 엽니다. 왼쪽 건반에서 <b>C1</b>을 찾으면, 베이스 음은 대부분 그 근처(E0~G1)에 있어요.</span></li>
    <li><span><kbd>T</kbd>로 <b>연필 도구</b>를 고르고 줄을 클릭해 노트를 찍은 뒤, 노트 <b>오른쪽 끝을 끌어</b> 길이를 정합니다.</span></li>
    <li><span>베이스는 보통 한 번에 한 음만 내요. 노트끼리 겹치지 않게 정리하고 <kbd>Q</kbd>로 <b>퀀타이즈</b>합니다.</span></li>`,
  fineLogic:'소리는 위의 선택 상자로 바꿔요. <b>일렉 베이스</b>는 FreePats의 Yamaha RBX 녹음(손가락·피크 두 가지), <b>업라이트 베이스</b>는 VSCO 2 CE의 콘트라베이스 피치카토 녹음이에요(모두 CC0 퍼블릭 도메인). 예시 패턴을 고르면 장르에 맞는 소리로 자동으로 바뀌어요: 록은 피크, 재즈·보사노바는 업라이트. 4현 베이스 표준 튜닝(E·A·D·G) 기준입니다. 실제 베이스는 악보에 적힌 음보다 한 옥타브 낮게 소리 나서, 피아노 롤에서도 가운데 도(C3)보다 한참 아래에 찍혀요. 릭은 저작권이 있는 곡을 그대로 옮기지 않고, 퍼블릭 도메인 곡과 장르의 전통 패턴으로 골랐어요.',
};

/* ================= KEYS ================= */
const KLO = 48, KHI = 76;                            // chord-builder voicing range (always the middle of the keyboard)
const KR = { lo:48, hi:76, full:false };            // what the keys tab shows: C2–E4, or all 88 keys (A-1–C7, MIDI 21–108)
const MT =[['KeyA',0,'A'],['KeyW',1,'W'],['KeyS',2,'S'],['KeyE',3,'E'],['KeyD',4,'D'],['KeyF',5,'F'],['KeyT',6,'T'],['KeyG',7,'G'],['KeyY',8,'Y'],['KeyH',9,'H'],['KeyU',10,'U'],['KeyJ',11,'J'],['KeyK',12,'K'],['KeyO',13,'O'],['KeyL',14,'L'],['KeyP',15,'P'],['Semicolon',16,';'],['Quote',17,"'"]];
let keysBase = 60;
const mtFor = n => { const m = MT.find(x => keysBase + x[1] === n); return m ? m[2] : null; };
const keysZones = {};
const keysSvg = $('#keysSvg');
function buildKeys(lo, hi){
  const svg = keysSvg;
  Object.keys(keysZones).forEach(k => delete keysZones[k]);
  svg.classList.toggle('full88', hi - lo > 40);
  svg.innerHTML = `<defs>
    <linearGradient id="gWK" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".82" stop-color="#f1f2f5"/><stop offset="1" stop-color="#d4d7de"/></linearGradient>
    <linearGradient id="gBK" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#2b2f37"/><stop offset=".86" stop-color="#121418"/><stop offset="1" stop-color="#3a3f49"/></linearGradient>
    <radialGradient id="gShadowK" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#000" stop-opacity=".28"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
  </defs>`;
  const whites = []; for (let n = lo; n <= hi; n++) if (!isBlack(n)) whites.push(n);
  const WW = 860 / whites.length, X0 = 20, KY = 76, WH = 236, BH = 148;
  const BW = Math.min(30, WW * .62), dot = Math.min(5.5, WW * .3);
  const wx = n => X0 + whites.indexOf(n) * WW;
  mk('ellipse', {cx:450, cy:330, rx:440, ry:12, fill:'url(#gShadowK)'}, svg);
  mk('rect', {x:6, y:30, width:888, height:300, rx:16, fill:'#1b1e25', stroke:'rgba(0,0,0,.5)'}, svg);
  mk('rect', {x:X0, y:KY - 6, width:860, height:6, fill:'#7a1f2b'}, svg);
  for (let c = lo; c <= hi; c++) {
    if (mod(c, 12) !== 0) continue;
    const x = wx(c), wEnd = Math.min(X0 + 860, x + 7 * WW);
    mk('line', {x1:x + 2, x2:wEnd - 4, y1:62, y2:62, stroke:'#f2c066', 'stroke-opacity':c === 60 ? .7 : .3, 'stroke-width':1.5}, svg);
    const t = mk('text', {class:'octl' + (c === 60 ? '' : ' dim'), x:x + 4, y:54}, svg);
    t.textContent = c === 60 ? (hi - lo > 40 ? 'C3 가운데 도' : 'C3 · 가운데 도') : noteName(c);
  }
  const mkKey = (n, black) => {
    const pc = mod(n, 12);
    const z = mk('g', {class:`zone pk ${black ? 'bk' : 'wk'}`, tabindex:'0', role:'button', 'aria-label':`${noteName(n)} ${SOLF[pc]}${n === 60 ? ' (가운데 도)' : ''}`}, svg);
    z.style.setProperty('--c', pcColor(n)); z.dataset.note = n;
    const x = black ? wx(n - 1) + WW - BW / 2 : wx(n) + 1, w = black ? BW : WW - 2, h = black ? BH : WH;
    mk('rect', {class:'kb', x, y:KY, width:w, height:h, rx:black ? 3 : Math.min(6, WW / 4)}, z);
    mk('rect', {class:'hl', x:x + 1.5, y:KY + 1.5, width:w - 3, height:h - 3, rx:black ? 3 : Math.min(6, WW / 4)}, z);
    const cx = x + w / 2;
    mk('circle', {class:'scd', cx, cy:black ? KY + 96 : KY + 128, r:dot}, z);
    if (n === 60) mk('circle', {cx, cy:KY + 150, r:Math.min(4, WW * .22), fill:'#e5ae52'}, z);
    mk('text', {class:'kd', x:cx, y:black ? KY + 78 : KY + 172}, z);
    const kl = mk('text', {class:'kl', x:cx, y:black ? KY + 116 : KY + 194}, z); kl.textContent = mtFor(n) || '';
    const kn = mk('text', {class:'kn' + (pc === 0 ? ' c' : ''), x:cx, y:black ? KY + 136 : KY + 220}, z); kn.textContent = noteName(n);
    keysZones[n] = z;
  };
  whites.forEach(n => mkKey(n, false));
  for (let n = lo; n <= hi; n++) if (isBlack(n)) mkKey(n, true);
}
buildKeys(KR.lo, KR.hi);
function refreshKeyLetters(){ Object.entries(keysZones).forEach(([n, z]) => { z.querySelector('.kl').textContent = mtFor(+n) || ''; }); }
function setKeyDegrees(map){ Object.entries(keysZones).forEach(([n, z]) => { z.querySelector('.kd').textContent = (map && map[n]) || ''; }); }

/* ---- chord theory ---- */
const QUALS = [
  ['maj','','메이저'], ['m','m','마이너'], ['7','7','세븐(도미넌트)'], ['maj7','maj7','메이저 세븐'], ['m7','m7','마이너 세븐'],
  ['m7b5','m7♭5','하프 디미니시'], ['dim7','dim7','디미니시 세븐'], ['sus4','sus4','서스포'], ['7sus4','7sus4','세븐 서스포'],
  ['aug','aug','어그먼트'], ['6','6','식스'], ['m6','m6','마이너 식스'], ['mM7','m(maj7)','마이너 메이저 세븐'],
];
const QIV = { maj:[0,4,7], m:[0,3,7], '7':[0,4,7,10], maj7:[0,4,7,11], m7:[0,3,7,10], m7b5:[0,3,6,10], dim7:[0,3,6,9], sus4:[0,5,7], '7sus4':[0,5,7,10], aug:[0,4,8], '6':[0,4,7,9], m6:[0,3,7,9], mM7:[0,3,7,11] };
const TENS = [['b9','♭9',13], ['9','9',14], ['#9','♯9',15], ['11','11',17], ['#11','♯11',18], ['b13','♭13',20], ['13','13',21]];
const DEG = {0:'R', 3:'♭3', 4:'3', 5:'4', 6:'♭5', 7:'5', 8:'♯5', 9:'6', 10:'♭7', 11:'7'};
const degLabel = (i, q) => (q === 'dim7' && i === 9) ? '°7' : DEG[i];
const qName = q => QUALS.find(x => x[0] === q);
const ALIAS = {'7:9':'9', '7:13':'13', '7:13,9':'13', 'm7:9':'m9', 'm7:11':'m11', 'm7:11,9':'m11', 'maj7:9':'maj9', '6:9':'6/9', 'm6:9':'m6/9', 'maj7:#11':'maj7♯11', '7:#9':'7♯9', '7:b9':'7♭9', 'maj:9':'add9', 'm:9':'m(add9)'};
function chordSymbol(root, q, tens){
  const tl = TENS.filter(t => tens.includes(t[0])).map(t => t[1]);
  const name = NAMES[root] + qName(q)[1] + (tl.length ? `(${tl.join(', ')})` : '');
  const al = ALIAS[q + ':' + [...tens].sort().join(',')];
  return { name, alias: al ? NAMES[root] + al : null };
}
/* recognizer: every quality × up to two tensions (also with the 5th left out) */
const CHORD_DB = new Map();
(function buildChordDB(){
  const subsets = [[]]; TENS.forEach((a, i) => { subsets.push([a[0]]); TENS.slice(i + 1).forEach(b => subsets.push([a[0], b[0]])); });
  QUALS.forEach(([q], qi) => subsets.forEach(ts => {
    const tiv = ts.map(t => TENS.find(x => x[0] === t)[2] % 12);
    const forms = [QIV[q]]; if (QIV[q].length === 4 && QIV[q].includes(7)) forms.push(QIV[q].filter(i => i !== 7));
    forms.forEach((iv, fi) => {
      const rel = [...new Set([...iv, ...tiv])];
      if (rel.length !== iv.length + tiv.length) return;
      for (let r = 0; r < 12; r++) {
        const key = rel.map(i => (i + r) % 12).sort((a, b) => a - b).join(',');
        const cand = { root:r, q, tens:ts, cost: ts.length * 2 + fi + qi * .01 };
        const list = CHORD_DB.get(key); if (list) list.push(cand); else CHORD_DB.set(key, [cand]);
      }
    });
  }));
})();
function chordOf(nums){
  if (!nums || !nums.length) return null;
  const pcs = [...new Set(nums.map(n => mod(n, 12)))].sort((a, b) => a - b);
  if (pcs.length < 3) return null;
  const list = CHORD_DB.get(pcs.join(',')); if (!list) return null;
  const low = mod(Math.min(...nums), 12);
  const best = list.slice().sort((a, b) => (a.cost - (a.root === low ? 1.5 : 0)) - (b.cost - (b.root === low ? 1.5 : 0)))[0];
  const sym = chordSymbol(best.root, best.q, best.tens);
  const inv = best.root !== low;
  return { name: sym.name + (inv ? '/' + NAMES[low] : ''), alias:sym.alias, ko:`${NAMES[best.root]} ${qName(best.q)[2]}${best.tens.length ? ' + 텐션' : ''}`, inv, low };
}
const PC_FIND = [
  '검은 건반 <strong>2개 묶음 바로 왼쪽</strong>의 흰 건반이 도(C)예요. 모든 위치 찾기의 출발점이에요.',
  '검은 건반 2개 묶음 중 <strong>왼쪽</strong> 검은 건반. 도보다 반음 높아요(= 레♭).',
  '검은 건반 2개 묶음 <strong>사이에 낀</strong> 흰 건반이 레(D)예요.',
  '검은 건반 2개 묶음 중 <strong>오른쪽</strong> 검은 건반. 레보다 반음 높아요(= 미♭).',
  '검은 건반 2개 묶음 <strong>바로 오른쪽</strong> 흰 건반이 미(E)예요. 미와 파 사이엔 검은 건반이 없어요.',
  '검은 건반 <strong>3개 묶음 바로 왼쪽</strong>의 흰 건반이 파(F)예요.',
  '검은 건반 3개 묶음의 <strong>첫 번째</strong> 검은 건반(= 솔♭)이에요.',
  '검은 건반 3개 묶음의 첫째와 둘째 <strong>사이</strong> 흰 건반이 솔(G)이에요.',
  '검은 건반 3개 묶음의 <strong>가운데</strong> 검은 건반(= 라♭)이에요.',
  '검은 건반 3개 묶음의 둘째와 셋째 <strong>사이</strong> 흰 건반이 라(A)예요.',
  '검은 건반 3개 묶음의 <strong>세 번째</strong> 검은 건반(= 시♭)이에요.',
  '검은 건반 3개 묶음 <strong>바로 오른쪽</strong> 흰 건반이 시(B)예요. 시와 도 사이에도 검은 건반이 없어요.',
];
function keysTip(n, chord){
  const pc = mod(n, 12);
  if (chord) return '화음은 피아노 롤에서 <strong>같은 세로선에 쌓인 노트</strong>예요. 바닥 음(루트)에서 메이저는 <strong>4줄·7줄 위</strong>, 마이너는 <strong>3줄·7줄 위</strong>, 7th는 <strong>10줄(♭7)·11줄(7) 위</strong>에 하나 더 얹으면 돼요.';
  if (n === 60) return 'Logic은 가운데 도를 <strong>C3</strong>로 써요. 피아노 롤 왼쪽 건반에서 C3 줄을 기준점으로 삼으면 나머지 음을 찾기 쉬워요.';
  if (isBlack(n)) return `검은 건반은 이름이 두 개예요: <strong>${NAMES[pc]} = ${FLAT[pc]}</strong>. Logic 피아노 롤은 보통 #(샵) 이름으로 보여줘요.`;
  if (pc === 4 || pc === 5 || pc === 11 || pc === 0) return '<strong>미-파, 시-도</strong> 사이에는 검은 건반이 없어요. 그래서 피아노 롤에서도 이 두 곳에서만 흰 줄 두 개가 바로 붙어 있어요.';
  return `같은 이름은 옥타브마다 반복돼요: ${NAMES[pc]}2 → ${NAMES[pc]}3 → ${NAMES[pc]}4. 피아노 롤에서는 <strong>12줄 간격</strong>이고, 이 페이지에선 같은 색이에요.`;
}
const CH = (step, len, notes, vel) => notes.map((n, i) => ({ step, note:n, len, vel: i === notes.length - 1 ? Math.min(127, vel + 8) : vel }));
// pop piano: left hand = one low root, right hand = colour chord in the middle, played 3+3+2 across each half bar
const POP332 = chords => chords.flatMap(([lh, rh], k) => { const s = k * 8; return [{ step:s, note:lh, len:8, vel:70 }, ...CH(s, 3, rh, 80), ...CH(s + 3, 3, rh, 66), ...CH(s + 6, 2, rh, 72)]; });
const KEYS_PRESETS = [
  { id:'rock', name:'8비트 록', bpm:100, desc:'Am–F–G 3화음을 길게. 손이 덜 움직이도록 전위(F/A, G/B)를 써서 위 성부가 거의 제자리예요.',
    notes:[...CH(0,8,[57,60,64],96), ...CH(8,4,[57,60,65],92), ...CH(12,4,[59,62,67],92)] },
  { id:'four', name:'하우스 스탭', bpm:122, desc:'Am7·Dm7 코드를 엇박에 짧게 ‘착!’. 하우스 피아노의 상징적인 리듬이에요.',
    notes:[...CH(2,1,[57,60,64,67],92), ...CH(6,1,[57,60,64,67],84), ...CH(10,1,[57,60,62,65],92), ...CH(14,1,[57,60,62,65],84)] },
  { id:'boom', name:'붐뱁 패드', bpm:88, swing:[16,57], desc:'Dm9·Am7 같은 7th·텐션 코드를 길게 깔아 몽환적인 분위기를 만들어요.',
    notes:[...CH(0,8,[62,65,69,72,76],80), ...CH(10,6,[57,60,64,67],76)] },
  { id:'ballad', name:'발라드 아르페지오', bpm:72, desc:'C와 G/B 코드를 한 음씩 풀어 치는 아르페지오.',
    notes:[[0,60],[2,64],[4,67],[6,72],[8,59],[10,62],[12,67],[14,74]].map(([s, n], k) => ({ step:s, note:n, len:2, vel:k % 4 === 0 ? 92 : 74 })) },
  { id:'pop', name:'팝 진행', bpm:100, desc:'I–V–vi–IV(C–G/B–Am–F/A). 전위를 써서 손이 거의 안 움직여요. 베이스 「팝 진행」과 합주돼요.',
    notes:[...CH(0,4,[60,64,67],98), ...CH(4,4,[59,62,67],92), ...CH(8,4,[57,60,64],94), ...CH(12,4,[57,60,65],92)] },
  { id:'bossa', name:'보사노바 컴핑', bpm:128, bars:2, desc:'루트리스 Cmaj9 → Dm9 → G13을 보사노바 싱코페이션으로. 베이스 「보사노바」, 드럼 「보사노바」와 합주돼요.',
    notes:[...CH(0,2,[64,67,71,74],84), ...CH(3,2,[64,67,71,74],72), ...CH(6,3,[64,67,71,74],80), ...CH(10,2,[64,67,71,74],72), ...CH(13,2,[64,67,71,74],76),
           ...CH(16,2,[65,69,72,76],84), ...CH(19,2,[65,69,72,76],72), ...CH(22,2,[65,69,72,76],78), ...CH(24,2,[65,69,71,76],84), ...CH(27,2,[65,69,71,76],72), ...CH(30,2,[65,69,71,76],76)] },
  { id:'reggae', name:'레게 스캥크', bpm:76, desc:'엇박마다 짧게 끊어 치는 스캥크(Skank). 레게 기타·건반의 상징이에요.',
    notes:[2,6,10,14].flatMap(s => CH(s,1,[57,60,64],s % 8 === 6 ? 96 : 88)) },
  { id:'money', name:'머니 코드 · 기본형', group:'recipe', bpm:92, bars:2, desc:'흔히 ‘머니 코드’라 부르는 I–V–vi–IV(C–G–Am–F)를 근음 자리 3화음으로 꾹꾹 누른 버전. 코드가 바뀔 때마다 손이 크게 점프해서 뚝뚝 끊겨 들려요. 「머니 코드 · 예쁘게」와 비교해 보세요.',
    notes:[[60,64,67],[55,59,62],[57,60,64],[53,57,60]].flatMap((c, k) => CH(k * 8, 8, c, 90)) },
  { id:'money2', name:'머니 코드 · 예쁘게', group:'recipe', bpm:92, bars:2, desc:'같은 C–G–Am–F인데 ① 왼손은 낮은 근음 하나 ② 오른손에 9·7을 더해 Cadd9·Am7·Fmaj7로 반짝이게 ③ 맨 위 음이 레–레–도–도로 거의 제자리(전위) ④ 3+3+2 리듬. 베이스 「머니 코드」, 드럼 「8비트 록」과 합주돼요.',
    notes:POP332([[48,[64,67,74]], [55,[67,71,74]], [57,[64,67,72]], [53,[64,69,72]]]) },
  { id:'royal', name:'왕도 진행', group:'recipe', bpm:80, bars:2, desc:'IV–V–iii–vi(Fmaj7–G7–Em7–Am9). 한국·일본 발라드와 아이돌 곡에서 특히 사랑받는 감성 진행이에요. 오른손 위 성부가 한 칸씩 내려오며 이어지고, 마지막 Am9이 살짝 아련하게 끝나요.',
    notes:POP332([[53,[64,69,72]], [55,[62,65,71]], [52,[62,67,71]], [57,[60,64,67,71]]]) },
  { id:'two5one', name:'ii–V–I 루트리스', group:'lick', bpm:132, bars:2, swing:[8,64], scale:[0,'major'], desc:'Dm9 → G13 → Cmaj9 루트리스 보이싱. 위 성부가 반음·온음씩만 움직여 부드럽게 이어져요(C→B, F→E…). 재즈의 가장 중요한 진행. 베이스 「재즈 워킹」과 함께.',
    notes:[...CH(0,8,[65,69,72,76],86), ...CH(8,8,[65,69,71,76],88), ...CH(16,14,[64,67,71,74],84)] },
  { id:'charleston', name:'찰스턴 블루스', group:'lick', bpm:112, bars:2, swing:[8,66], scale:[4,'blues'], desc:'‘짠—짠’ 찰스턴 리듬(점4분음표 + 8분음표)으로 치는 E7·A7 블루스 컴핑. 베이스 「부기우기」, 드럼 「블루스 셔플」과 합주돼요.',
    notes:[...CH(0,3,[62,64,68,71],96), ...CH(6,2,[62,64,68,71],86), ...CH(16,3,[61,64,67,69],96), ...CH(22,2,[61,64,67,69],86)] },
  { id:'canon', name:'캐논 진행', group:'lick', bpm:72, bars:2, desc:'파헬벨 「캐논」의 코드 진행 D–A–Bm–F#m–G–D–G–A(퍼블릭 도메인). 오늘날 수많은 팝 발라드가 이 진행을 빌려 써요.',
    notes:[[62,66,69],[61,64,69],[59,62,66],[57,61,66],[59,62,67],[57,62,66],[59,62,67],[57,61,64]].flatMap((c, k) => CH(k * 4, 4, c, 84)) },
  { id:'elise', name:'엘리제를 위하여', group:'lick', bpm:84, bars:2, desc:'베토벤 「엘리제를 위하여」(1810, 퍼블릭 도메인) 첫 부분. 원래 3/8박자라 4/4 격자에 16분음표 흐름 그대로 옮겼어요. 반음(E–D#) 떨림이 특징.',
    notes:[[0,76],[1,75],[2,76],[3,75],[4,76],[5,71],[6,74],[7,72],[8,69,2],[11,60],[12,64],[13,69],[14,71,2],[17,64],[18,68],[19,71],[20,72,2],[23,64],[24,76],[25,75],[26,76],[27,75],[28,76],[29,71],[30,74],[31,72]]
      .map(([s, n, l]) => ({ step:s, note:n, len:l || 1, vel:[0,8,14,20,24].includes(s) ? 96 : 78 }))
      .concat([{ step:8, note:57, len:6, vel:66 }, { step:14, note:52, len:6, vel:62 }, { step:20, note:57, len:4, vel:66 }]) },
  { id:'thelick', name:'‘더 릭’', group:'lick', bpm:132, bars:2, swing:[8,62], scale:[2,'dorian'], desc:'재즈 연주자들 사이에서 농담처럼 주고받는 유명한 짧은 프레이즈 ‘The Lick’(D 도리안, 작자 미상의 관용구). 2마디째엔 Dm9 코드가 받쳐줘요.',
    notes:[[0,62,2],[2,64,2],[4,65,2],[6,67,2],[8,64,4],[12,60,2],[14,62,10]].map(([s, n, l]) => ({ step:s, note:n, len:l, vel:s === 8 ? 100 : 90 })).concat(CH(16,16,[53,57,60,64],60)) },
];
const VOICINGS = [
  ['close','기본형','근음부터 3·5·7도를 차곡차곡 쌓은 모양. 피아노 롤에서 노트가 계단처럼 붙어 있어요.'],
  ['inv1','1전위','맨 아래 근음을 한 옥타브 올려 3도가 바닥에 오게 한 모양. 코드가 바뀔 때 손이 덜 움직여요.'],
  ['inv2','2전위','5도가 바닥에 오는 모양. 근음은 위로 올라가요.'],
  ['inv3','3전위','7도가 바닥에 와요. 7도가 다음 코드의 3도로 반음 내려가며 이어질 때 아름다워요.'],
  ['drop2','드롭 2','기본형에서 위에서 두 번째 음을 한 옥타브 내린 모양. 재즈 피아노·기타에서 넓고 부드럽게 들리는 대표 보이싱이에요.'],
  ['shell','쉘','근음·3도·7도만 남긴 뼈대. 코드의 성격(메이저/마이너/도미넌트)을 정하는 핵심 음만 남겨서 깔끔해요.'],
  ['rootless','루트리스','근음을 빼고(베이스가 맡아요) 3·7도와 텐션으로 채운 재즈 피아노 보이싱. 9가 근음 자리를, 13이 5도 자리를 대신해요.'],
  ['open','오픈','음 사이를 넓게 벌린 모양. 근음과 5도는 아래, 3·7도는 한 옥타브 위로. 웅장하고 탁 트인 소리.'],
];
const cb = { root:0, q:'maj7', tens:new Set(['9']), voicing:'close' };
// tensions in the same family are alternatives (♭9 vs 9 a half step apart = cluster). ♭9 + ♯9 together is the classic altered combo, so it stays allowed.
const TENS_EXCL = { b9:['9'], '9':['b9','#9'], '#9':['9'], '11':['#11'], '#11':['11'], b13:['13'], '13':['b13'] };
const famOf = id => ({ b9:'9', '9':'9', '#9':'9', '11':'11', '#11':'11', b13:'13', '13':'13' })[id];
const FAMILY_TXT = {
  '9':'♭9·9·♯9는 모두 ‘9도 자리’(근음 바로 위)의 다른 버전이에요. 9는 부드럽고 화사하고, ♭9·♯9는 세븐(7) 코드에서 긴장감을 만들 때 써요.',
  '11':'11과 ♯11은 ‘11도 자리’의 두 버전이에요. 마이너 코드에는 11, 메이저·세븐 코드에는 ♯11이 어울려요.',
  '13':'♭13과 13은 ‘13도 자리’의 두 버전이에요. 보통은 13, 세븐 코드에서 어두운 긴장감을 낼 땐 ♭13을 써요.',
};
const TENS_REC = { maj:['9'], m:['9'], '7':['9','13','b9','#9','#11','b13'], maj7:['9','#11','13'], m7:['9','11'], m7b5:['11','b13'],
  dim7:[], sus4:['9'], '7sus4':['9','13'], aug:['9'], '6':['9'], m6:['9'], mM7:['9','11'] };
const TRIAD_TO7 = { maj:'maj7', m:'m7', sus4:'7sus4', aug:'7' };
const tLabel = id => TENS.find(t => t[0] === id)[1];
let cbNote = null;      // last guidance message from a user action: { kind, title, text, fixes:[{label, run}] }
function tensionDup(id){                 // a tension that is the same pitch as a chord tone just doubles it
  const pc = TENS.find(t => t[0] === id)[2] % 12;
  return QIV[cb.q].some(i => i % 12 === pc) ? '이 코드에 이미 같은 음이 있어요(예: 마이너 코드의 ♭3 = ♯9).' : null;
}
function cbBuild(){
  const iv = QIV[cb.q];
  const CT = iv.map(i => ({ iv:i, lab:degLabel(i, cb.q) }));
  const TN = TENS.filter(t => cb.tens.has(t[0])).map(t => ({ iv:t[2], lab:t[1] }));
  let r0 = 48 + cb.root; if (r0 < 52) r0 += 12;
  const at = x => ({ n:r0 + x.iv, lab:x.lab });
  const above = (list, floor) => list.map(x => { let n = r0 + x.iv; while (n <= floor) n += 12; return { n, lab:x.lab }; });
  const cluster = (list, base) => list.map(x => { let n = r0 + mod(x.iv, 12); while (n < base) n += 12; while (n >= base + 12) n -= 12; return { n, lab:x.lab }; });
  const has7 = CT.length === 4;
  const third = CT.find(x => [3, 4, 5].includes(x.iv));
  const maxOf = l => Math.max(...l.map(x => x.n));
  const warn = [];
  let v, voicing = cb.voicing;
  const G = (kind, title, text, fixes) => warn.push({ kind, title, text, fixes: fixes || [] });
  const to7 = TRIAD_TO7[cb.q];
  const fix7 = to7 ? [{ label:`${NAMES[cb.root]}${qName(to7)[1]} 코드로 바꾸기`, run(){ cb.q = to7; } }] : [];
  if (voicing === 'inv3' && !has7) { voicing = 'inv2'; G('info', '3전위는 7th 코드에서만 돼요.', '3전위는 7도를 맨 아래에 두는 모양이라, 7도가 없는 3화음은 2전위로 쳤어요.', fix7); }
  if (voicing === 'rootless' && !has7) { voicing = 'close'; G('info', '루트리스는 7th 코드에서 써요.', '3화음에서 근음을 빼면 두 음만 남아 화음이 되지 않아요. 그래서 기본형으로 쳤어요.', fix7); }
  const ctLabs = new Set(CT.map(x => x.lab));
  switch (voicing) {
    case 'inv1': case 'inv2': case 'inv3': {
      const k = { inv1:1, inv2:2, inv3:3 }[voicing];
      const base = CT.map(at); for (let i = 0; i < k; i++) base[i].n += 12;
      v = base.concat(above(TN, maxOf(base))); break; }
    case 'drop2': {
      const c = cluster([...CT, ...TN], r0).sort((a, b) => a.n - b.n);
      if (c.length >= 3) c[c.length - 2].n -= 12;
      v = c; break; }
    case 'shell': {
      const top = CT.find(x => [9, 10, 11].includes(x.iv) && x !== third) || CT.find(x => [6, 7, 8].includes(x.iv));
      const base = [at(CT[0]), at(third), at(top)];
      v = base.concat(above(TN, maxOf(base))); break; }
    case 'rootless': {
      const no5 = TN.some(t => t.iv === 21 || t.iv === 20);
      const list = CT.filter(x => x.iv !== 0 && !(no5 && x.iv === 7)).concat(TN);
      v = cluster(list, r0 + third.iv);
      if (!TN.length) G('tip', '루트리스엔 텐션을 함께 넣어요.', '근음을 빼면 그 자리가 비어서 소리가 허전해요. 보통 9가 근음 자리를 채워요.', tensionDup('9') ? [] : [{ label:'9 넣기', run(){ cb.tens.add('9'); } }]);
      break; }
    case 'open': {
      const R = at(CT[0]); const fifth = CT.find(x => [6, 7, 8].includes(x.iv));
      v = [R]; if (fifth) v.push(at(fifth));
      CT.filter(x => x !== CT[0] && x !== fifth).forEach(x => v.push({ n:r0 + x.iv + 12, lab:x.lab }));
      v = v.concat(above(TN, maxOf(v))); break; }
    default: v = CT.map(at).concat(above(TN, r0 + Math.max(...iv)));
  }
  v.sort((a, b) => a.n - b.n);
  v = v.filter((x, i) => i === 0 || x.n !== v[i - 1].n);
  // thin out big stacks: with 2+ tensions the perfect 5th adds nothing but mud, so pianists leave it out
  if (TN.length >= 2 && v.length > 5 && voicing !== 'shell') {
    const i5 = v.findIndex(x => x.lab === '5');
    if (i5 > 0) { v.splice(i5, 1); G('info', '5도는 뺐어요.', '텐션이 여러 개면 음이 너무 많아져 탁해져요. 5도는 빠져도 코드 성격이 안 바뀌어서 피아니스트들도 보통 생략해요.'); }
  }
  // no half-step rubs between neighbouring voices: lift the upper note an octave (or drop the lower one)
  // fit into the keyboard one note at a time — shifting the whole chord down would bury it in the muddy low register
  const cut = [];
  for (let guard = 0; guard < 24; guard++) {
    v.sort((a, b) => a.n - b.n);
    const top = v[v.length - 1]; if (top.n <= KHI) break;
    if (top.n - 12 >= KLO && !v.some(x => x !== top && x.n === top.n - 12)) top.n -= 12; else cut.push(v.pop());
  }
  while (v[0].n < KLO) v.forEach(x => x.n += 12);
  // no half-step rubs between neighbours, and no close intervals down low (below G2 even a 3rd sounds like mud)
  let moved = false;
  for (let guard = 0; guard < 16; guard++) {
    v.sort((a, b) => a.n - b.n);
    // a half step between two chord tones (7th under the root in an inverted maj7) belongs to the chord itself, so it stays
    const i = v.findIndex((x, k) => k > 0 && ((x.n - v[k - 1].n === 1 && !(ctLabs.has(x.lab) && ctLabs.has(v[k - 1].lab))) || (x.n < 55 && x.n - v[k - 1].n < 7)));
    if (i < 0) break;
    moved = true;
    if (v[i].n + 12 <= KHI && !v.some(x => x.n === v[i].n + 12)) v[i].n += 12; else cut.push(v.splice(i, 1)[0]);
  }
  if (moved) G('info', '부딪히는 음을 옮겼어요.', '바로 옆 건반(반음)끼리, 또는 아주 낮은 곳에서 가까운 음끼리 같이 누르면 ‘웅웅’ 하고 탁하게 들려요. 그래서 그 음을 한 옥타브 위로 옮겨 띄웠어요.');
  v.sort((a, b) => a.n - b.n);
  v = v.filter((x, i) => i === 0 || x.n !== v[i - 1].n);
  if (v.some((x, k) => k > 0 && x.n - v[k - 1].n === 1)) G('tip', '7도와 근음이 반음으로 붙어 있어요.', '이 전위에서는 7(시)과 근음(도)이 바로 옆 건반이라 살짝 ‘찡’ 하게 부딪혀요. 틀린 건 아니지만, 더 부드럽게 하려면 드롭 2나 기본형을 써 보세요.', [{ label:'드롭 2로 바꾸기', run(){ cb.voicing = 'drop2'; } }]);
  if (cut.length) G('info', `${cut.map(x => x.lab).join('·')}는 뺐어요.`, '이 건반(C2~E4) 안에서 다른 음과 부딪히지 않게 넣을 자리가 없었어요. 음이 너무 많으면 오히려 탁해지니, 텐션을 하나 줄여 보세요.');
  if (cb.tens.has('11') && iv.includes(4)) G('warn', '11은 이 코드와 부딪혀요(어보이드 노트).', '11(파)은 코드의 3도(미)보다 반음 높아서 같이 울리면 거슬려요. 메이저·세븐 코드에서는 반음 올린 ♯11을 써요.', [{ label:'♯11로 바꾸기', run(){ cb.tens.delete('11'); cb.tens.add('#11'); } }]);
  if (!has7 && [...cb.tens].some(t => t !== '9')) G('warn', '텐션은 7th 코드 위에 얹어요.', '3화음(도·미·솔)에 9 말고 다른 텐션을 바로 얹으면 어색하게 들리기 쉬워요. 먼저 7도를 넣어 7th 코드로 만든 다음 텐션을 더해 보세요.', fix7);
  const altered = ['b9','#9','b13'].filter(t => cb.tens.has(t));
  if (altered.length && !['7','7sus4'].includes(cb.q)) G('warn', `${altered.map(tLabel).join('·')}는 세븐(7) 코드용이에요.`, '♭9·♯9·♭13 같은 ‘변화 텐션’은 다음 코드로 넘어가기 직전의 긴장감을 만드는 소리라, 도미넌트 세븐(7) 코드에서 써요. 다른 코드에 넣으면 틀린 음처럼 들려요.',
    [{ label:`${NAMES[cb.root]}7 코드로 바꾸기`, run(){ cb.q = '7'; } }, { label:'변화 텐션 빼기', run(){ altered.forEach(t => cb.tens.delete(t)); } }]);
  // anything else that is legal but not a usual colour for this chord: a gentle nudge toward the ● ones
  const rec = TENS_REC[cb.q] || [];
  const covered = new Set([...(iv.includes(4) ? ['11'] : []), ...(['7', '7sus4'].includes(cb.q) ? [] : altered)]);
  const odd = [...cb.tens].filter(t => !rec.includes(t) && !covered.has(t) && (has7 || t === '9'));
  if (odd.length) {
    const alt = odd.map(t => rec.find(r => famOf(r) === famOf(t) && !cb.tens.has(r))).filter(Boolean);
    G('tip', `${odd.map(tLabel).join('·')}는 ${NAMES[cb.root]}${qName(cb.q)[1]}에 흔히 쓰는 텐션이 아니에요.`,
      `틀린 건 아니지만 독특하고 낯선 소리가 나요. ${odd.map(t => FAMILY_TXT[famOf(t)]).filter((x, i, a) => a.indexOf(x) === i).join(' ')} 처음엔 ● 표시된 텐션부터 써 보세요.`,
      alt.length ? [{ label:`${alt.map(tLabel).join('·')}로 바꾸기`, run(){ odd.forEach(t => cb.tens.delete(t)); alt.forEach(t => cb.tens.add(t)); } }] : []);
  }
  if (v.length < 3 && cb.voicing !== 'close') {          // nothing usable left in this shape: fall back to root position
    const saved = cb.voicing; cb.voicing = 'close'; const r2 = cbBuild(); cb.voicing = saved;
    r2.warn.unshift({ kind:'info', title:'이 조합은 기본형으로 쳤어요.', text:'고른 보이싱으로는 음끼리 부딪혀서 두 음밖에 남지 않았어요. 그래서 기본형으로 바꿔 쳤어요.', fixes:[] });
    return r2;
  }
  const sym = chordSymbol(cb.root, cb.q, [...cb.tens]);
  const lowPc = mod(v[0].n, 12);
  const slash = (voicing.startsWith('inv') || voicing === 'drop2') && lowPc !== cb.root ? '/' + NAMES[lowPc] : '';
  const vInfo = VOICINGS.find(x => x[0] === voicing);
  const det = chordOf(v.map(x => x.n));
  return { notes:v, name:sym.name + slash, alias:sym.alias, vname:vInfo[1], vdesc:vInfo[2], warn, detected: det ? det.name : null };
}

const keys = {
  id:'keys', ko:'건반', en:'Keys', melodic:true, rows:range(KHI, KLO), stage:$('#stage-keys'), defaultNote:60, svg:keysSvg,
  meta:'Keys · C2–E4 · 29건반',
  lede:'건반을 누르면 계이름(도레미)과 Logic Pro 피아노 롤의 위치를 동시에 보여줍니다. 소리는 실제 스타인웨이 그랜드 피아노 녹음이에요. 피아노 롤 왼쪽의 세로 건반은 이 건반을 세워 놓은 모양이에요. 코드 만들기로 7th·텐션·보이싱을 쌓아 보세요.',
  chip:'가운데 도 = <b>C3</b> (MIDI 60)',
  kitH:'Keyboard <span class="ko">건반</span>',
  hint(){ return `누르고 있는 동안 소리가 이어져요 · <kbd>Z</kbd>/<kbd>X</kbd> 옥타브, 지금 A키 = ${noteName(keysBase)}`; },
  keyHint:'Logic의 Musical Typing과 같은 배치 · <kbd>Z</kbd>/<kbd>X</kbd> 옥타브 · Shift = 최대 세기',
  legendHint:'빈 칸을 클릭하면 ‘입력 간격’ 길이의 노트 추가, 노트를 클릭하면 삭제 · 왼쪽 건반을 누르고 있으면 소리 듣기',
  legend(){ return LEGEND_PC; },
  presets:KEYS_PRESETS,
  voice(n, t, v){
    if (tone.keys === 'synth') return synthKeysVoice(n, t, v);
    if (tone.keys === 'steinway') {
      if ((n < 46 || n > 78) && kitState.pianoext !== 'ready') ensureKit('pianoext');   // first low/high note: fetch those recordings
      return sampledVoice('piano', n, t, v, PIANO_OPT) || keysVoice(n, t, v);
    }
    return keysVoice(n, t, v);
  },
  colorOf:pcColor,
  label:n => SOLF[mod(n, 12)],
  rowMeta(n){ return { used:true, color:pcColor(n), b:SOLF[mod(n, 12)], i:n === 60 ? '가운데 도' : '', title:`${noteName(n)} · ${SOLF[mod(n, 12)]} (MIDI ${n}) — 누르고 있으면 소리 듣기` }; },
  keyAction(code){
    if (code === 'KeyZ') return { octave:-1 };
    if (code === 'KeyX') return { octave:1 };
    const m = MT.find(x => x[0] === code); if (!m) return null;
    const n = keysBase + m[1]; return (n < KR.lo || n > KR.hi) ? { none:true } : { note:n };
  },
  visual:{
    down(n){ const z = keysZones[n]; if (!z) return; z._n = (z._n || 0) + 1; z.classList.add('down'); restart(z, 'flash'); },
    up(n){ const z = keysZones[n]; if (!z) return; z._n = Math.max(0, (z._n || 0) - 1); if (!z._n) z.classList.remove('down'); },
    reset(){ Object.values(keysZones).forEach(z => { z._n = 0; z.classList.remove('down'); }); setKeyDegrees(null); },
    center(n){ return rectCenter(keysZones[n].querySelector('.kb'), isBlack(n) ? .55 : .62); },
    link(n){ if (keysZones[n]) keysZones[n].classList.add('linked'); },
  },
  floatText(n){ const pc = mod(n, 12); return { title:`${SOLF[pc]} (${NAMES[pc]})`, sub: n === 60 ? '가운데 도' : (isBlack(n) ? `검은 건반 · ${FLAT[pc]}` : '흰 건반') }; },
  tipText(n){ const k = mtFor(n); return `${SOLF[mod(n, 12)]}${n === 60 ? ' · 가운데 도' : ''}<span>${noteName(n)}${k ? ' · 키 ' + k : ''}</span>`; },
  info(n, vel, o = {}){
    const pc = mod(n, 12);
    const ns = [...new Set(o.stepNotes && o.stepNotes.length ? o.stepNotes : [n])].sort((a, b) => a - b);
    const ch = o.cb ? null : chordOf(ns);
    let p2, labs = {};
    if (o.cb) {
      p2 = `<strong>${o.cb.name}</strong>${o.cb.alias ? ` (흔히 ${o.cb.alias})` : ''} · ${o.cb.vname} 보이싱.${o.cb.detected && o.cb.detected !== o.cb.name ? ` 건반 모양만 보면 <strong>${o.cb.detected}</strong>로도 읽혀요.` : ''}`;
      o.cb.notes.forEach(x => { labs[x.n] = x.lab; });
    } else if (ch) p2 = `<strong>${ch.name}</strong>${ch.alias ? ` (= ${ch.alias})` : ''} · ${ch.ko} 화음이에요.${ch.inv ? ` 맨 아래 음이 ${NAMES[ch.low]}라서 뒤에 ‘/${NAMES[ch.low]}’를 붙여요(자리바꿈).` : ''}`;
    else if (ns.length >= 3) p2 = `음 ${ns.length}개가 쌓여 있지만, 이 페이지가 아는 화음 모양은 아니에요.`;
    else p2 = `지금 이 칸엔 ${ns.map(noteName).join(' · ')}. 같은 칸에 <strong>3개 이상</strong> 쌓으면 화음 이름을 알려줘요. 여러 건반을 동시에 누르거나 ‘코드 만들기’를 써 보세요.`;
    const rubs = []; for (let i = 1; i < ns.length; i++) if (ns[i] - ns[i - 1] === 1) rubs.push(`${noteName(ns[i - 1])}–${noteName(ns[i])}`);
    if (!o.cb && rubs.length) p2 += ` <strong style="color:var(--rec)">주의:</strong> ${rubs.join(', ')}는 바로 옆 건반(반음)이라 함께 울리면 탁하게 부딪혀요. 한 음을 한 옥타브 옮기거나 빼 보세요.`;
    setInfo({ note:n, color:pcColor(n), key:mtFor(n) || NAMES[pc], vel,
      name:`${noteName(n)} · ${SOLF[pc]}${n === 60 ? ' (가운데 도)' : ''}`,
      en: isBlack(n) ? `검은 건반 · ${NAMES[pc]}${octOf(n)} = ${FLAT[pc]}${octOf(n)}` : `흰 건반 · 옥타브 번호 ${octOf(n)}`,
      h1:'건반 찾기', p1:PC_FIND[pc], h2:'이 칸의 화음', p2,
      mini(el){
        el.className = 'nchips';
        const nm = o.cb ? o.cb.name : ch && ch.name;
        if (nm) { const c = document.createElement('span'); c.className = 'cname'; c.textContent = nm; el.appendChild(c); }
        ns.forEach(x => { const s = document.createElement('span'); s.style.setProperty('--c', pcColor(x)); s.innerHTML = `${noteName(x)}<small>${labs[x] || SOLF[mod(x, 12)]}</small>`; el.appendChild(s); });
      },
      h3:'Logic 피아노 롤 팁', p3:keysTip(n, ch || o.cb) });
  },
  keymapRows(){
    const cap = k => { const m = MT.find(x => x[2] === k); const n = keysBase + m[1];
      return { k, sub:`${noteName(n)}`, note:n, color:pcColor(n), off:n > KR.hi, title:`${noteName(n)} · ${SOLF[mod(n, 12)]}` }; };
    return [
      { pad:28, items:['W','E',null,'T','Y','U',null,'O','P'].map(k => k ? cap(k) : null) },
      { pad:0, items:['A','S','D','F','G','H','J','K','L',';',"'"].map(cap) },
    ];
  },
  axes:melodicAxes([[72, '도 · 한 옥타브 위'], [67, '솔'], [60, '도 · 가운데 도']], '건반 한 칸, 흰·검은 건반 모두', '화음의 맨 위 음을 조금 더 세게 치면 멜로디가 또렷하게 들려요. 이 페이지의 코드 예시도 그렇게 찍혀 있어요.'),
  fineRoll:FINE_MELODIC,
  steps:`
    <li><span><kbd>⌥⌘S</kbd> 새 소프트웨어 악기 트랙을 만들고, 라이브러리(<kbd>Y</kbd>)의 <b>Keyboards</b> 카테고리에서 피아노나 일렉트릭 피아노 패치를 고릅니다.</span></li>
    ${STEPS_COMMON}
    <li><span><kbd>⌘K</kbd>로 <b>Musical Typing</b> 창을 열면 컴퓨터 키보드로 바로 연주할 수 있어요.</span></li>
    <li><span><kbd>P</kbd>로 피아노 롤을 열고, 연필 도구로 C3·E3·G3·B3를 <b>같은 세로선</b>에 찍으면 Cmaj7 코드예요. D4를 하나 더 얹으면 Cmaj7(9).</span></li>
    <li><span>노트 <b>오른쪽 끝을 끌어</b> 길이를 정하고, <kbd>Q</kbd>로 <b>퀀타이즈</b>합니다.</span></li>`,
  fineLogic:'Musical Typing 배치: <b>A</b> = 도, <b>W</b> = 도#, <b>S</b> = 레 … 흰 건반은 가운데 줄, 검은 건반은 그 윗줄이에요. 소리는 VCSL(CC0)의 <b>스타인웨이 B 그랜드 피아노</b> 녹음이고, 여리게·세게 친 두 녹음을 세기에 따라 섞어요. 위의 선택 상자로 <b>일렉트릭 피아노</b>(FM 방식)나 <b>신스</b>(톱니파 두 개를 살짝 어긋나게 겹친 아날로그풍 소리)로 바꿀 수 있어요. 명곡 예시는 퍼블릭 도메인 곡(베토벤, 파헬벨)과 작자 미상의 관용구만 골랐어요.',
};

/* ================= engine ================= */
const TRACKS = { drum, bass, keys }, ORDER = IDS;
ORDER.forEach(k => { const t = TRACKS[k]; t.notes = []; t.undo = []; t.cursor = 0; t.preset = null; t.top = t.rows[0]; t.rowSet = new Set(t.rows); t.names = false; t.bars = 1; });
let active = 'drum';
const T = () => TRACKS[active];

const rollEl = $('#roll'), keysEl = $('#keys'), grid = $('#grid'), notesEl = $('#notes'), velEl = $('#vel'), ruler = $('#ruler'), ph = $('#ph');
let keyRow = {}, gridRow = {};
function buildRuler(){
  const tr = T(), S = STEPS(tr);
  ruler.textContent = '';
  for (let s = 0; s < S; s++) {
    const t = document.createElement('div');
    t.className = 'tk' + (s % 4 === 0 ? ' beat' : '') + (s % 16 === 0 ? ' bar' : '');
    t.style.left = (s / S * 100) + '%';
    if (s % 4 === 0) { const bar = Math.floor(s / 16) + 1, beat = (s % 16) / 4 + 1; t.innerHTML = `<span>${beat === 1 ? bar : bar + '.' + beat}</span>`; }
    ruler.appendChild(t);
  }
  rollEl.style.setProperty('--barw', (100 / tr.bars) + '%');
  rollEl.style.setProperty('--beatw', (25 / tr.bars) + '%');
  rollEl.style.setProperty('--stepw', (6.25 / tr.bars) + '%');
  $('#bars').value = tr.bars;
  $('#rollHint').textContent = `${tr.bars}마디 반복 · 4/4 · 16분음표 격자`;
}
function buildRoll(){
  const tr = T();
  rollEl.classList.toggle('melodic', tr.melodic);
  rollEl.classList.toggle('full88', tr.id === 'keys' && KR.full);
  keysEl.textContent = '';
  grid.querySelectorAll('.grow').forEach(g => g.remove());
  keyRow = {}; gridRow = {};
  $('#cornerL').textContent = tr.melodic ? '계이름' : '악기';
  tr.rows.forEach(n => {
    const m = tr.rowMeta(n);
    const k = document.createElement('div');
    k.className = `krow ${isBlack(n) ? 'black' : 'white'} ${m.used ? 'used' : 'unused'} ${mod(n, 12) === 0 ? 'c' : ''}`;
    k.dataset.note = n;
    if (m.used) k.style.setProperty('--c', m.color);
    k.innerHTML = `<span class="kname">${m.used ? '<span class="sw"></span>' : ''}${m.b ? `<b>${m.b}</b>` : ''}<i>${m.i || ''}</i></span><span class="pkey"><span>${noteName(n)}</span></span>`;
    k.title = m.title;
    keysEl.appendChild(k); keyRow[n] = k;
    const g = document.createElement('div');
    g.className = `grow ${isBlack(n) ? 'black' : ''} ${m.used ? '' : 'unused'}`;
    if (m.used) g.style.setProperty('--c', m.color);
    grid.insertBefore(g, notesEl); gridRow[n] = g;
  });
  const lg = $('#legend'); lg.querySelectorAll('.it').forEach(x => x.remove());
  const hint = $('#legendHint');
  tr.legend().forEach(([label, color]) => {
    const s = document.createElement('span'); s.className = 'it'; s.style.setProperty('--c', color);
    s.innerHTML = `<i></i>${label}`; lg.insertBefore(s, hint);
  });
  hint.innerHTML = tr.legendHint;
  buildRuler();
}

let lastAdded = null;
const keyOf = (s, n) => s + ':' + n;
const sounding = (tr, step) => tr.notes.filter(x => step >= x.step && step < x.step + (x.len || 1));
function snapshot(tr = T()){ tr.undo.push(JSON.stringify({ bars:tr.bars, notes:tr.notes.map(({ step, note, vel, len, pos }) => ({ step, note, vel, len, pos })) })); if (tr.undo.length > 60) tr.undo.shift(); }
function undo(){
  const tr = T(); if (!tr.undo.length) return;
  const s = JSON.parse(tr.undo.pop()); tr.notes = s.notes; tr.bars = s.bars || 1;
  lastAdded = null; markPreset(null); buildRuler(); renderNotes();
}

function renderNotes(){
  const tr = T(), S = STEPS(tr);
  notesEl.textContent = ''; velEl.textContent = '';
  const perStep = {};
  tr.notes.slice().sort((a, b) => a.note - b.note).forEach(n => {
    if (n.step >= S || !tr.rowSet.has(n.note) || !tr.rowMeta(n.note).used) return;
    const len = n.len || 1, k = keyOf(n.step, n.note), c = tr.colorOf(n.note);
    const el = document.createElement('div');
    el.className = 'note'; el.dataset.k = k;
    el.style.left = `calc(${n.step / S * 100}% + 1px)`;
    el.style.width = `calc(${Math.min(len, S - n.step) / S * 100}% - 2px)`;
    el.style.top = `calc(var(--rowh) * ${tr.top - n.note})`;
    el.style.setProperty('--c', c);
    el.style.setProperty('--v', (n.vel / 127).toFixed(3));
    el.style.setProperty('--mix', Math.round(40 + n.vel / 127 * 60) + '%');
    if (tr.melodic && len >= 2 * tr.bars) el.innerHTML = `<span>${noteName(n.note)}</span>`;
    if (lastAdded === k) el.classList.add('pop');
    el.title = `${tr.label(n.note)} · ${noteName(n.note)} · 위치 ${posLabel(n.step)}${tr.melodic ? ' · 길이 ' + lenTxt(len) : ''} · 세기 ${n.vel}`;
    notesEl.appendChild(el);
    const idx = perStep[n.step] = (perStep[n.step] || 0) + 1;
    const st = document.createElement('div');
    st.className = 'stem'; st.style.setProperty('--c', c);
    st.style.left = `calc(${(n.step + .5) / S * 100}% + ${(idx - 1) * 4 - 4}px)`;
    st.style.height = `${Math.max(6, n.vel / 127 * 46)}px`;
    velEl.appendChild(st);
  });
  lastAdded = null;
}
function upsert(tr, step, note, vel, len, extra){
  let n = tr.notes.find(x => x.step === step && x.note === note);
  if (n) { n.vel = vel; n.len = len; } else { n = { step, note, vel, len }; tr.notes.push(n); }
  if (extra) Object.assign(n, extra);
  if (tr.melodic) {
    tr.notes = tr.notes.filter(x => x === n || x.note !== note || x.step <= step || x.step >= step + len);
    tr.notes.forEach(x => { if (x !== n && x.note === note && x.step < step && x.step + (x.len || 1) > step) x.len = step - x.step; });
  }
  lastAdded = keyOf(step, note);
  if (tr === T()) renderNotes();
  return n;
}
function ghostAt(step, note, tr, len){
  const S = STEPS(tr);
  const g = document.createElement('div'); g.className = 'ghost';
  g.style.left = `calc(${step / S * 100}% + 1px)`; g.style.width = `calc(${Math.min(len, S - step) / S * 100}% - 2px)`;
  g.style.top = `calc(var(--rowh) * ${tr.top - note})`; g.style.setProperty('--c', tr.colorOf(note));
  notesEl.appendChild(g); g.addEventListener('animationend', () => g.remove());
  return g;
}
function keyDown(n){
  const k = keyRow[n]; if (!k) return;
  k._n = (k._n || 0) + 1; k.classList.add('down');
  const g = gridRow[n]; g.classList.remove('flash'); void g.offsetWidth; g.classList.add('flash');
}
function keyUp(n){ const k = keyRow[n]; if (!k) return; k._n = Math.max(0, (k._n || 0) - 1); if (!k._n) k.classList.remove('down'); }
function keyBlink(n){ keyDown(n); setTimeout(() => keyUp(n), 170); }
function flyDot(from, target, color){
  if (reduced || !target) return;
  const r = target.getBoundingClientRect();
  if (r.bottom < 0 || r.top > innerHeight) return;
  const tx = r.left + Math.min(r.width, 30) / 2, ty = r.top + r.height / 2;
  const d = document.createElement('div'); d.className = 'flydot'; d.style.setProperty('--c', color);
  document.body.appendChild(d);
  const mx = (from.x + tx) / 2, my = Math.min(from.y, ty) - 80;
  const a = d.animate([
    { transform:`translate(${from.x}px, ${from.y}px) scale(.6)`, opacity:0 },
    { transform:`translate(${from.x}px, ${from.y}px) scale(1.1)`, opacity:1, offset:.08 },
    { transform:`translate(${mx}px, ${my}px) scale(1)`, opacity:1, offset:.5 },
    { transform:`translate(${tx}px, ${ty}px) scale(.5)`, opacity:.2 }
  ], { duration:560, easing:'cubic-bezier(.45,.05,.4,1)' });
  a.onfinish = () => d.remove();
}
function spawnFloat(tr, n, cx, cy, vel, pos, txt){
  const fx = tr.stage.querySelector('.fx');
  const p = stagePoint(tr.stage, cx, cy);
  const t = txt || tr.floatText(n, pos);
  const el = document.createElement('div');
  el.className = 'float';
  el.style.setProperty('--c', tr.colorOf(n));
  el.innerHTML = `<b>${t.title}</b><span class="en">${t.sub}</span><span class="nt">${t.chip || noteName(n)} <s>${t.chipSub != null ? t.chipSub : `· MIDI ${n} · vel ${vel}`}</s></span>`;
  el.style.left = Math.min(Math.max(p.x, 92), p.w - 92) + 'px'; el.style.top = p.y + 'px';
  if (p.y < 100) el.classList.add('below');
  fx.appendChild(el);
  const all = fx.querySelectorAll('.float'); if (all.length > 4) all[0].remove();
  el.addEventListener('animationend', () => el.remove());
  if (!reduced) {
    const r = document.createElement('div'); r.className = 'ripple'; r.style.setProperty('--c', tr.colorOf(n));
    r.style.left = p.x + 'px'; r.style.top = p.y + 'px'; fx.appendChild(r);
    r.addEventListener('animationend', () => r.remove());
  }
}

/* ================= info card ================= */
const info = $('#info');
function setInfo(o){
  info.style.setProperty('--c', o.color);
  $('#iKey').textContent = o.key;
  $('#iName').textContent = o.name;
  $('#iEn').textContent = o.en;
  $('#iNote').textContent = noteName(o.note);
  $('#iMidi').textContent = o.note;
  $('#iVel').textContent = o.vel == null ? '—' : o.vel;
  $('#iVelBar').style.width = o.vel == null ? '0' : (o.vel / 127 * 100) + '%';
  $('#iH1').textContent = o.h1; $('#iDesc').innerHTML = o.p1;
  $('#iH2').textContent = o.h2; $('#iWhere').innerHTML = o.p2;
  $('#iH3').textContent = o.h3; $('#iTip').innerHTML = o.p3;
  const mini = $('#iMini'); mini.textContent = ''; mini.className = '';
  if (o.mini) o.mini(mini);
  Object.values(keyRow).forEach(k => k.classList.remove('sel'));
  Object.values(gridRow).forEach(g => g.classList.remove('sel'));
  if (keyRow[o.note]) { keyRow[o.note].classList.add('sel'); gridRow[o.note].classList.add('sel'); }
  restart(info, 'swap');
}
function showChord(nums){ const c = chordOf(nums); $('#lcdChord').textContent = c ? c.name : '—'; }
function midiMonitor(tr, n, vel, stepNotes){
  $('#lcdMidi').textContent = `${noteName(n).padEnd(3, ' ')} ${String(n).padStart(3, ' ')} v${vel}`;
  if (tr.id === 'keys') showChord(stepNotes);
}

/* ================= playing notes ================= */
const held = new Map();
function noteDown(src, n, o = {}){
  const tr = T();
  if (held.has(src)) noteUp(src, true);          // re-striking a sustained key restarts it
  const vel = clamp(Math.round(o.vel ?? 100), 1, 127);
  const pos = tr.id === 'bass' ? (o.pos || bassDefault(n)) : undefined;
  let handle = NOOP;
  if (ensureAudio()) handle = playOn(tr, n, ctx.currentTime, curve(vel));
  tr.visual.down(n, pos);
  const pt = o.point || tr.visual.center(n, pos);
  if (!o.nofloat) spawnFloat(tr, n, pt.x, pt.y, vel, pos);
  keyDown(n);
  const h = { tr, n, pos, handle, t0:performance.now(), ref:null, startAbs:null, stepEntry:false };
  held.set(src, h);
  let stepNotes = null;
  if (o.record !== false) {
    const S = STEPS(tr);
    let step, abs = null;
    if (playing) { abs = Math.round(currentPos()); step = mod(abs, S); } else step = tr.cursor;
    const len = playing ? 1 : (tr.melodic ? (stepSize || 2) : 1);
    let target;
    if (recOn) {
      if (!o.nosnap) { snapshot(tr); markPreset(null); }
      const extra = {}; if (pos) extra.pos = pos;
      if (playing && abs >= nextStep) extra.skipAbs = abs;
      h.ref = upsert(tr, step, n, vel, len, extra);
      h.startAbs = playing ? abs : null;
      h.stepEntry = !playing;
      target = notesEl.querySelector(`[data-k="${keyOf(step, n)}"]`);
      stepNotes = sounding(tr, step).map(x => x.note);
    } else target = ghostAt(step, n, tr, len);
    if (!o.nofloat) flyDot(pt, target, tr.colorOf(n));
  }
  if (!stepNotes) stepNotes = [...held.values()].filter(x => x.tr === tr).map(x => x.n);
  if (!o.noinfo) tr.info(n, vel, { pos, stepNotes });
  midiMonitor(tr, n, vel, stepNotes);
  return stepNotes;
}
/* sustain: a real pedal (MIDI CC 64), the on-screen switch, or holding the ` key. While any is down, notes you
   release on bass/keys keep ringing until sustain lifts — exactly like a piano's damper pedal. */
const sus = { pedal:false, latch:false, key:false, held:new Set() };
const sustainOn = () => sus.pedal || sus.latch || sus.key;
const PLAYED = /^(p|k|m|z)/;               // notes you play by hand; previews and demos always stop on time
function sustainChanged(){
  if (!sustainOn()) { const list = [...sus.held]; sus.held.clear(); list.forEach(s => noteUp(s, true)); }
  if (typeof pedalUI === 'function') pedalUI();
}
function noteUp(src, force){
  const h = held.get(src); if (!h) return;
  if (!force && sustainOn() && h.tr.melodic && PLAYED.test(src)) {
    if (!h.sustained) {
      h.sustained = true; sus.held.add(src);
      if (h.stepEntry) {                               // fingers left the keys: step input still moves on
        h.stepEntry = false;
        if (stepSize && ![...held.values()].some(x => x.stepEntry && x.tr === h.tr)) h.tr.cursor = mod(h.tr.cursor + stepSize, STEPS(h.tr));
      }
    }
    return;
  }
  held.delete(src); sus.held.delete(src);
  const tr = h.tr;
  if (ctx) h.handle.off(ctx.currentTime);
  const wait = tr.melodic ? 0 : Math.max(0, 150 - (performance.now() - h.t0));
  setTimeout(() => { tr.visual.up(h.n, h.pos); if (tr === T()) keyUp(h.n); }, wait);
  if (h.ref && tr.melodic && playing && h.startAbs != null) {
    h.ref.len = clamp(Math.round(currentPos() - h.startAbs), 1, STEPS(tr));
    if (tr === T()) renderNotes();
  }
  if (h.stepEntry && stepSize && ![...held.values()].some(x => x.stepEntry && x.tr === tr)) tr.cursor = mod(tr.cursor + stepSize, STEPS(tr));
}
function releaseAll(){ [...held.keys()].forEach(k => noteUp(k, true)); sus.held.clear(); }

/* ================= transport ================= */
let playing = false, recOn = true, metroOn = false, mixOn = false, bpm = 100, stepSize = 2;
let swingType = 0, swingAmt = 62, humanOn = false;
let nextStep = 0, nextTime = 0, timer = null, playHandles = [], vTimers = [];
const stepDur = () => 60 / bpm / 4;
const vt = (fn, ms) => { const id = setTimeout(() => { vTimers = vTimers.filter(x => x !== id); fn(); }, ms); vTimers.push(id); };
function currentPos(){ return nextStep - (nextTime - ctx.currentTime) / stepDur(); }
function swingOffset(abs){
  if (!swingType) return 0;
  const r = swingAmt / 100, beat = stepDur() * 4, p = mod(abs, 4);
  if (swingType === 8) return ([0, r * .5, r, r + (1 - r) * .5][p] - p * .25) * beat;
  return p % 2 ? (r - .5) * beat / 2 : 0;
}
function tick(){
  while (nextTime < ctx.currentTime + .12) { scheduleStep(nextStep, nextTime); nextStep++; nextTime += stepDur(); }
  playHandles = playHandles.filter(p => p.end > ctx.currentTime);
}
function scheduleStep(abs, t){
  if (metroOn && abs % 4 === 0) click(t, mod(abs, 16) === 0);
  const sw = swingOffset(abs);
  const list = mixOn ? ORDER.filter(k => !mixParts || mixParts.has(k)).map(k => TRACKS[k]) : [T()];
  list.forEach(tr => {
    const s = mod(abs, STEPS(tr));
    tr.notes.forEach(n => {
      if (n.step !== s) return;
      if (n.skipAbs === abs) { delete n.skipAbs; return; }
      // drums: only kit rows exist. Bass/keys: a note outside the visible rows (e.g. A0 while the 88-key view is off) still plays.
      if (!tr.melodic && (!tr.rowSet.has(n.note) || !tr.rowMeta(n.note).used)) return;
      const tt = Math.max(ctx.currentTime, t + sw + (humanOn ? (Math.random() - .5) * .02 : 0));
      const vel = humanOn ? clamp(n.vel + Math.round((Math.random() - .5) * 18), 1, 127) : n.vel;
      const dur = (n.len || 1) * stepDur();
      const h = playOn(tr, n.note, tt, curve(vel));
      if (tr.melodic) { h.off(tt + dur * .95); playHandles.push({ h, end:tt + dur }); }
      if (tr !== T()) return;
      vt(() => {
        if (!playing || tr !== T()) return;
        tr.visual.down(n.note, n.pos); keyDown(n.note);
        const el = notesEl.querySelector(`[data-k="${keyOf(n.step, n.note)}"]`);
        if (el) restart(el, 'on');
        if (tr.id === 'keys') showChord(sounding(tr, s).map(x => x.note));
        vt(() => { tr.visual.up(n.note, n.pos); if (tr === T()) keyUp(n.note); }, tr.melodic ? dur * 950 : 170);
      }, Math.max(0, (tt - ctx.currentTime) * 1000));
    });
  });
}
function start(){
  if (!ensureAudio()) return;
  if (playing) return;
  playing = true; nextStep = 0; nextTime = ctx.currentTime + .06;
  tick(); timer = setInterval(tick, 25);
  syncUI();
}
function stop(){
  playing = false; clearInterval(timer);
  vTimers.forEach(clearTimeout); vTimers = [];
  if (ctx) playHandles.forEach(p => p.h.off(ctx.currentTime));
  playHandles = [];
  ORDER.forEach(k => { TRACKS[k].visual.reset(); TRACKS[k].cursor = 0; });
  Object.values(keyRow).forEach(k => { k._n = 0; k.classList.remove('down'); });
  syncUI();
}
function toggle(){ playing ? stop() : start(); }

const STEP_TXT = {1:'16분음표', 2:'8분음표', 4:'4분음표'};
function syncUI(){
  const tr = T();
  $('#play').setAttribute('aria-pressed', playing);
  $('#playIc').innerHTML = playing ? '<rect x="3.5" y="3.5" width="9" height="9" rx="1.5"/>' : '<path d="M4 2.5v11l9.5-5.5z"/>';
  $('#playTxt').textContent = playing ? '정지' : '재생';
  const rp = $('#rollPlay'); rp.setAttribute('aria-pressed', playing); rp.textContent = playing ? '■ 정지' : '▶ 재생';
  $('#rec').setAttribute('aria-pressed', recOn);
  $('#metro').setAttribute('aria-pressed', metroOn);
  $('#mix').setAttribute('aria-pressed', mixOn);
  $('#human').setAttribute('aria-pressed', humanOn);
  $('#swingType').value = swingType; $('#swing').value = swingAmt; $('#swingOut').textContent = swingAmt + '%';
  $('#swing').disabled = !swingType;
  ph.classList.toggle('stopped', !playing);
  const ic = $('#modeIc'), tx = $('#modeTxt');
  let mixTxt = '';
  if (mixOn) {
    const parts = IDS.map(k => {
      const t = TRACKS[k], playingIt = !mixParts || mixParts.has(k);
      const p = t.presets.find(x => x.id === t.preset);
      return `${t.ko} ${playingIt ? (p ? `「${p.name}」` : '(직접 찍은 노트)') : '쉼'}`;
    });
    mixTxt = ` <b>합주</b> · ${parts.join(' + ')}.` + (!mixParts ? ' 직접 찍은 노트끼리 합주 중이라 조(키)가 다르면 어색할 수 있어요. 예시 패턴을 고르면 어울리는 짝을 자동으로 맞춰요.' : '');
  }
  IDS.forEach(k => { const ch = document.querySelector(`.ch[data-k="${k}"]`); if (ch) ch.classList.toggle('rest', mixOn && !!mixParts && !mixParts.has(k)); });
  const extra = mixTxt + (swingType ? ` <b>${swingType}분 스윙 ${swingAmt}%</b>.` : '');
  if (!recOn) { ic.textContent = 'MONITOR'; ic.className = 'ic'; tx.innerHTML = '<b>REC 꺼짐</b> · 소리만 나고 노트는 기록되지 않아요. 피아노 롤에 잠깐 점선으로 위치만 표시됩니다.' + extra; }
  else if (playing) { ic.textContent = 'LIVE'; ic.className = 'ic live';
    tx.innerHTML = (tr.melodic
      ? '<b>실시간 녹음 중</b> · 치는 순간 가장 가까운 16분음표 칸에서 노트가 시작되고, <b>누르고 있던 시간</b>만큼 길어져요. 칸에 맞추는 걸 <b>퀀타이즈(Quantize)</b>라고 해요.'
      : '<b>실시간 녹음 중</b> · 치는 순간 가장 가까운 16분음표 칸에 맞춰 기록돼요. 이렇게 칸에 맞추는 걸 <b>퀀타이즈(Quantize)</b>라고 해요.') + extra; }
  else { ic.textContent = 'STEP'; ic.className = 'ic';
    const stack = tr.melodic ? ` 여러 ${tr.id === 'bass' ? '줄' : '건반'}을 <b>동시에 누르면</b> 같은 칸에 쌓여요.` : '';
    tx.innerHTML = (stepSize
      ? `<b>스텝 입력</b> · ${tr.melodic ? `치면 점선 커서 위치에 ${STEP_TXT[stepSize]} 길이의 노트가 찍히고` : '드럼을 치면 점선 커서 위치에 노트가 찍히고'}, 커서가 ${STEP_TXT[stepSize]}만큼 오른쪽으로 이동해요.${stack} 눈금자를 클릭하거나 ←/→ 키로 커서를 옮길 수 있어요.`
      : '<b>스텝 입력</b> · 커서가 움직이지 않아요. 여러 소리를 같은 칸에 겹쳐 찍어보세요. 눈금자를 클릭하거나 ←/→ 키로 커서를 옮겨요.') + extra; }
}
function setSwing(type, amt){ swingType = type; if (amt) swingAmt = amt; syncUI(); }

/* ================= zone input ================= */
let tipHoldUntil = 0;
function clearLinks(){ document.querySelectorAll('.zone.linked').forEach(z => z.classList.remove('linked')); }
function hoverRow(n, on){ if (keyRow[n]) { keyRow[n].classList.toggle('hover', on); gridRow[n].classList.toggle('hover', on); } }
function wireZone(tr, z, note, pos, velFn){
  const tipEl = tr.stage.querySelector('.tip');
  z.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    tipEl.classList.remove('show'); tipHoldUntil = performance.now() + 700;
    noteDown('p' + e.pointerId, note, { vel:velFn ? velFn(e) : 100, pos, point:{ x:e.clientX, y:e.clientY } });
  });
  z.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault(); e.stopPropagation();
    if (!e.repeat) noteDown('z', note, { vel:100, pos });
  });
  z.addEventListener('keyup', e => { if (e.key === 'Enter' || e.key === ' ') noteUp('z'); });
  z.addEventListener('blur', () => noteUp('z'));
  z.addEventListener('pointerenter', () => hoverRow(note, true));
  z.addEventListener('pointerleave', () => { hoverRow(note, false); tipEl.classList.remove('show'); });
  if (canHover) z.addEventListener('pointermove', e => {
    if (performance.now() < tipHoldUntil) return;
    const p = stagePoint(tr.stage, e.clientX, e.clientY);
    tipEl.innerHTML = tr.tipText(note, pos);
    tipEl.style.left = Math.min(p.x, p.w - 190) + 'px'; tipEl.style.top = p.y + 'px'; tipEl.classList.add('show');
  });
}
kit.querySelectorAll('.zone').forEach(z => {
  const id = z.dataset.inst;
  wireZone(drum, z, BY_ID[id].note, undefined, e => { let v = velFromPoint(z, e.clientX, e.clientY); if (['side', 'hhp', 'hho', 'clap', 'tamb', 'cowbell'].includes(id)) v = Math.max(v, 96); return v; });
});
Object.values(bassZones).forEach(z => wireZone(bass, z, +z.dataset.note, { s:+z.dataset.s, f:+z.dataset.f }));
Object.values(keysZones).forEach(z => wireZone(keys, z, +z.dataset.note));
[kit, bassSvg, keysSvg].forEach(svg => svg.addEventListener('animationend', e => { e.target.classList && e.target.classList.remove('thump', 'wobble', 'press', 'vib'); }));
window.addEventListener('pointerup', e => noteUp('p' + e.pointerId));
window.addEventListener('pointercancel', e => noteUp('p' + e.pointerId));
window.addEventListener('blur', releaseAll);

/* ================= roll input ================= */
keysEl.addEventListener('pointerdown', e => {
  const k = e.target.closest('.krow'); if (!k) return;
  const n = +k.dataset.note; if (!T().rowMeta(n).used) return;
  e.preventDefault();
  noteDown('p' + e.pointerId, n, { vel:100, record:false });
});
keysEl.addEventListener('pointerover', e => {
  const k = e.target.closest('.krow'); clearLinks();
  if (!k) return; const n = +k.dataset.note; if (T().rowMeta(n).used) T().visual.link(n);
});
keysEl.addEventListener('pointerleave', clearLinks);
const rowAt = (tr, e) => { const r = grid.getBoundingClientRect(); return tr.rows[Math.floor((e.clientY - r.top) / (r.height / tr.rows.length))]; };
grid.addEventListener('pointerdown', e => {
  const tr = T(), S = STEPS(tr); const r = grid.getBoundingClientRect();
  const step = clamp(Math.floor((e.clientX - r.left) / r.width * S), 0, S - 1);
  const note = rowAt(tr, e); if (note == null || !tr.rowMeta(note).used) return;
  e.preventDefault();
  snapshot(tr); markPreset(null);
  const i = tr.notes.findIndex(n => n.note === note && step >= n.step && step < n.step + (n.len || 1));
  if (i >= 0) { tr.notes.splice(i, 1); renderNotes(); return; }
  const len = tr.melodic ? (stepSize || 2) : 1;
  const pos = tr.id === 'bass' ? bassDefault(note) : undefined;
  if (ensureAudio()) playOn(tr, note, ctx.currentTime, curve(100)).off(ctx.currentTime + Math.min(len * stepDur(), .7));
  tr.visual.down(note, pos); setTimeout(() => tr.visual.up(note, pos), 240);
  keyBlink(note);
  const c = tr.visual.center(note, pos); spawnFloat(tr, note, c.x, c.y, 100, pos);
  upsert(tr, step, note, 100, len, pos ? { pos } : null);
  const sn = sounding(tr, step).map(x => x.note);
  tr.info(note, 100, { pos, stepNotes:sn }); midiMonitor(tr, note, 100, sn);
});
grid.addEventListener('pointermove', e => { const tr = T(); const n = rowAt(tr, e); clearLinks(); if (n != null && tr.rowMeta(n).used) tr.visual.link(n); });
grid.addEventListener('pointerleave', clearLinks);
ruler.addEventListener('pointerdown', e => {
  if (playing) return;
  const r = ruler.getBoundingClientRect(), S = STEPS(T());
  T().cursor = clamp(Math.round((e.clientX - r.left) / r.width * S - .5), 0, S - 1);
});

/* ================= controls ================= */
$('#play').addEventListener('click', toggle);
$('#rollPlay').addEventListener('click', toggle);
$('#rec').addEventListener('click', () => { recOn = !recOn; syncUI(); });
$('#metro').addEventListener('click', () => { metroOn = !metroOn; syncUI(); });
$('#mix').addEventListener('click', () => {
  mixOn = !mixOn;
  if (mixOn) { const s = songFor(active, T().preset); if (s) { applySong(s, active); setTab(active, true); } else mixParts = null; }
  syncUI();
});
$('#human').addEventListener('click', () => { humanOn = !humanOn; syncUI(); });
$('#undo').addEventListener('click', undo);
$('#clear').addEventListener('click', () => { const tr = T(); if (!tr.notes.length) return; snapshot(tr); tr.notes = []; markPreset(null); tr.cursor = 0; renderNotes(); });
const bpmIn = $('#bpm');
function setBpm(v){ bpm = v; bpmIn.value = v; $('#bpmOut').textContent = v; $('#lcdBpm').textContent = v; }
bpmIn.addEventListener('input', () => setBpm(+bpmIn.value));
$('#stepSize').addEventListener('change', e => { stepSize = +e.target.value; syncUI(); });
$('#swingType').addEventListener('change', e => setSwing(+e.target.value));
$('#swing').addEventListener('input', e => setSwing(swingType, +e.target.value));
$('#bars').addEventListener('change', e => {
  const tr = T(), nb = +e.target.value; if (nb === tr.bars) return;
  snapshot(tr);
  if (nb === 2 && !tr.notes.some(n => n.step >= 16)) tr.notes = tr.notes.concat(tr.notes.filter(n => n.step < 16).map(({ step, note, vel, len, pos }) => ({ step:step + 16, note, vel, len, pos })));
  if (nb === 1) tr.notes = tr.notes.filter(n => n.step < 16).map(n => ({ ...n, len:Math.min(n.len || 1, 16 - n.step) }));
  tr.bars = nb; tr.cursor = mod(tr.cursor, STEPS(tr)); markPreset(null); buildRuler(); renderNotes();
});
$('#namesTog').addEventListener('click', () => {
  const tr = T(); if (!tr.svg) return;
  tr.names = !tr.names; tr.svg.classList.toggle('shownames', tr.names);
  $('#namesTog').setAttribute('aria-pressed', tr.names);
});
$('#toneSel').addEventListener('change', e => {
  const id = active; setTone(id, e.target.value); ensureAudio();
  if (id === 'keys') { [57, 60, 64, 67].forEach((n, i) => noteDown('snd' + i, n, { vel:96, record:false, nofloat:i > 0, noinfo:true })); setTimeout(() => [0, 1, 2, 3].forEach(i => noteUp('snd' + i)), 900); }
  else { noteDown('snd', 33, { vel:100, record:false }); setTimeout(() => noteUp('snd'), 700); }
});
$('#sndTog').addEventListener('click', () => {
  useSmp[active] = !useSmp[active]; ensureAudio(); updateSndUI();
  noteDown('snd', { drum:38, bass:33, keys:60 }[active], { vel:100, record:false });
  setTimeout(() => noteUp('snd'), active === 'drum' ? 120 : 700);
});

/* ---- mixer ---- */
(function buildMixer(){
  const m = $('#mixer');
  ORDER.forEach(k => {
    const tr = TRACKS[k];
    const d = document.createElement('div'); d.className = 'ch'; d.dataset.k = k;
    d.innerHTML = `<span class="ti" aria-hidden="true">${ICON[k]}</span><b>${tr.ko}</b><button class="mbtn" aria-pressed="false" title="${tr.ko} 음소거">M</button><input type="range" id="vol-${k}" min="0" max="100" value="${Math.round(MIX[k].vol * 100)}" aria-label="${tr.ko} 볼륨">`;
    d.querySelector('.mbtn').addEventListener('click', ev => { MIX[k].mute = !MIX[k].mute; ev.currentTarget.setAttribute('aria-pressed', MIX[k].mute); d.classList.toggle('muted', MIX[k].mute); applyMix(); });
    d.querySelector('input').addEventListener('input', ev => { MIX[k].vol = ev.target.value / 100; applyMix(); });
    m.appendChild(d);
  });
  const r = document.createElement('div'); r.className = 'ch';
  r.innerHTML = `<b>리버브</b><input type="range" id="rvb" min="0" max="100" value="${rvbAmt * 100}" aria-label="리버브 양">`;
  r.querySelector('input').addEventListener('input', ev => { rvbAmt = ev.target.value / 100; applyMix(); });
  r.title = '방의 울림. 건반엔 넉넉히, 베이스엔 거의 안 걸리게 미리 맞춰 놨어요.';
  m.appendChild(r);
})();

/* ---- presets ---- */
const presetsEl = $('#presets');
function buildPresets(){
  presetsEl.textContent = '';
  const tr = T();
  [['rhythm', '리듬 패턴'], ['recipe', '팝 레시피'], ['lick', '릭 · 명곡']].forEach(([g, label]) => {
    const ps = tr.presets.filter(p => (p.group || 'rhythm') === g); if (!ps.length) return;
    const row = document.createElement('div'); row.className = 'prow';
    row.innerHTML = `<span class="lbl">${label}</span>`;
    ps.forEach(p => {
      const b = document.createElement('button'); b.className = 'pchip'; b.dataset.id = p.id; b.setAttribute('aria-pressed', 'false');
      b.innerHTML = `${p.name}<small>${p.bars === 2 ? '2마디 · ' : ''}${p.bpm}</small>`;
      b.title = p.desc;
      b.addEventListener('click', () => loadPreset(T(), p.id, true));
      row.appendChild(b);
    });
    presetsEl.appendChild(row);
  });
  const d = document.createElement('p'); d.className = 'pdesc'; d.id = 'presetDesc'; presetsEl.appendChild(d);
}
function markPreset(id, tr = T()){
  tr.preset = id;
  if (id === null && mixOn && mixParts && !mixParts.has(tr.id)) { mixParts.add(tr.id); syncUI(); }   // editing a resting track brings it back in
  if (tr !== T()) return;
  presetsEl.querySelectorAll('.pchip').forEach(b => b.setAttribute('aria-pressed', b.dataset.id === id));
  const p = tr.presets.find(x => x.id === id); const d = $('#presetDesc'); if (d) d.textContent = p ? p.desc : '';
}
/* ---- songs: which example patterns belong together (same key, tempo feel) when 합주 is on ---- */
const SONGS = [
  { id:'rock', drum:'rock', bass:'rock', keys:'rock' }, { id:'four', drum:'four', bass:'four', keys:'four' },
  { id:'boom', drum:'boom', bass:'boom', keys:'boom' }, { id:'ballad', drum:'ballad', bass:'ballad', keys:'ballad' },
  { id:'pop', drum:'rock', bass:'pop', keys:'pop' }, { id:'bossa', drum:'bossa', bass:'bossa', keys:'bossa' },
  { id:'reggae', drum:'reggae', bass:'reggae', keys:'reggae' }, { id:'blues', drum:'shuffle', bass:'boogie', keys:'charleston' },
  { id:'jazz', drum:'jazz', bass:'walk', keys:'two5one' }, { id:'canon', drum:'ballad', bass:'canon', keys:'canon' },
  { id:'motown', drum:'rock', bass:'motown' }, { id:'funk', drum:'funk', bass:'funk' }, { id:'latin', drum:'latin' },
  { id:'fill', drum:'fill' }, { id:'elise', keys:'elise' }, { id:'thelick', drum:'jazz', keys:'thelick' },
  { id:'money', drum:'rock', bass:'money', keys:'money2' }, { id:'money_plain', drum:'rock', bass:'money', keys:'money' },
  { id:'royal', drum:'ballad', bass:'royal', keys:'royal' },
];
let mixParts = null;            // tracks that play in 합주 (null = all of them)
const songFor = (trId, pid) => SONGS.find(s => s.id === pid && s[trId] === pid) || SONGS.find(s => s[trId] === pid);
function applySong(song, fromId){
  IDS.forEach(k => { if (k !== fromId && song[k]) loadPreset(TRACKS[k], song[k], false); });
  if (song.bass) setBassTone(BASS_TONE_OF[song.bass] || tone.bass);
  mixParts = new Set(IDS.filter(k => song[k]));
}
function loadPreset(tr, id, user){
  const p = tr.presets.find(x => x.id === id); if (!p) return;
  if (user) {
    snapshot(tr); setBpm(p.bpm); setSwing(p.swing ? p.swing[0] : 0, p.swing ? p.swing[1] : 0);
    if (p.scale && tr.melodic) setScale(p.scale[0], p.scale[1]);
    if (tr.id === 'bass' && BASS_TONE_OF[id]) setBassTone(BASS_TONE_OF[id]);
  }
  tr.bars = p.bars || 1;
  tr.notes = p.notes.map(n => ({ len:1, ...n }));
  tr.cursor = 0; markPreset(id, tr);
  if (tr === T()) { buildRuler(); renderNotes(); }
  if (user && mixOn) { const s = songFor(tr.id, id); if (s) applySong(s, tr.id); else mixParts = new Set([tr.id]); syncUI(); }
}

/* ---- scale lens ---- */
const SCALES = {
  major:{ ko:'메이저', iv:[0,2,4,5,7,9,11], tip:'밝고 안정적인 기본 음계(도레미파솔라시).' },
  minor:{ ko:'내추럴 마이너', iv:[0,2,3,5,7,8,10], tip:'어둡고 차분한 음계(라시도레미파솔).' },
  majpent:{ ko:'메이저 펜타토닉', iv:[0,2,4,7,9], tip:'4·7음을 뺀 5음 음계. 어떤 음을 쳐도 잘 어울려요.' },
  minpent:{ ko:'마이너 펜타토닉', iv:[0,3,5,7,10], tip:'록·블루스 솔로와 베이스 릭의 기본 재료예요.' },
  blues:{ ko:'블루스', iv:[0,3,5,6,7,10], tip:'마이너 펜타토닉에 ♭5(블루 노트)를 더한 끈적한 음계.' },
  dorian:{ ko:'도리안', iv:[0,2,3,5,7,9,10], tip:'마이너인데 6음이 밝아요. 재즈·펑크의 단골.' },
  mixo:{ ko:'믹솔리디안', iv:[0,2,4,5,7,9,10], tip:'메이저인데 7음이 ♭. 도미넌트 7 코드 위의 음계.' },
};
const scale = { root:9, type:'' };
(function buildScaleUI(){
  const r = $('#scRoot'), t = $('#scType');
  NAMES.forEach((n, i) => { const o = document.createElement('option'); o.value = i; o.textContent = `${n} (${SOLF[i]})`; r.appendChild(o); });
  const off = document.createElement('option'); off.value = ''; off.textContent = '끄기'; t.appendChild(off);
  Object.entries(SCALES).forEach(([k, s]) => { const o = document.createElement('option'); o.value = k; o.textContent = s.ko; t.appendChild(o); });
  r.addEventListener('change', () => setScale(+r.value, scale.type || 'minpent'));
  t.addEventListener('change', () => setScale(scale.root, t.value));
})();
function setScale(root, type){ scale.root = root; scale.type = type; $('#scRoot').value = root; $('#scType').value = type; applyScale(); }
function applyScale(){
  const tr = T(), on = !!scale.type && tr.melodic;
  const set = on ? new Set(SCALES[scale.type].iv.map(i => mod(scale.root + i, 12))) : null;
  const cls = pc => !on ? '' : pc === scale.root ? 'scroot' : set.has(pc) ? 'sc' : 'scout';
  Object.keys(gridRow).forEach(n => { const c = cls(mod(+n, 12)); [gridRow[n], keyRow[n]].forEach(el => { el.classList.remove('sc', 'scroot', 'scout'); if (c) el.classList.add(c); }); });
  const all = scale.type ? new Set(SCALES[scale.type].iv.map(i => mod(scale.root + i, 12))) : null;
  [...Object.values(bassZones), ...Object.values(keysZones)].forEach(z => {
    const pc = mod(+z.dataset.note, 12);
    z.classList.toggle('sc', !!all && all.has(pc)); z.classList.toggle('scroot', !!all && pc === scale.root);
  });
  $('#scTxt').innerHTML = scale.type
    ? `<b>${NAMES[scale.root]} ${SCALES[scale.type].ko}</b>: ${SCALES[scale.type].iv.map(i => NAMES[mod(scale.root + i, 12)]).join(' · ')} — ${SCALES[scale.type].tip}`
    : '곡에 어울리는 음들을 피아노 롤과 악기 위에 겹쳐 보여줘요. 근음은 진하게, 음계 밖 줄은 빗금으로.';
}

/* ---- chord builder ---- */
function renderCB(){
  const seg = (el, items, isOn, set, cls, blockedWhy, recOf) => {
    el.textContent = '';
    items.forEach(([id, label, title]) => {
      const b = document.createElement('button'); b.className = 'sb' + (cls ? ' ' + cls : ''); b.textContent = label;
      const why = blockedWhy ? blockedWhy(id) : null;
      if (recOf && recOf(id)) b.classList.add('rec');
      b.title = why ? why.text : (title || '');
      b.setAttribute('aria-pressed', isOn(id));
      if (why) { b.classList.add('blocked'); b.setAttribute('aria-disabled', 'true'); }
      b.addEventListener('click', () => {
        if (why) { cbNote = { kind:'warn', title:why.title, text:why.text, fixes:why.fixes || [] }; renderCB(); return; }   // explain instead of silently refusing
        set(id); renderCB(); cbSound(false);
      });
      el.appendChild(b);
    });
  };
  seg($('#cbRoot'), NAMES.map((n, i) => [i, n, SOLF[i]]), id => cb.root === id, id => { cb.root = id; cbNote = null; });
  seg($('#cbQual'), QUALS.map(q => [q[0], q[1] || 'M', q[2]]), id => cb.q === id, id => {
    cb.q = id; cbNote = null;
    const dropped = [...cb.tens].filter(t => tensionDup(t)); dropped.forEach(t => cb.tens.delete(t));
    if (dropped.length) cbNote = { kind:'info', title:'겹치는 텐션을 뺐어요.', text:`${dropped.map(tLabel).join('·')}는 이 코드에 이미 들어 있는 음과 같은 음이라서 자동으로 뺐어요.`, fixes:[] };
  });
  seg($('#cbTens'), TENS.map(t => [t[0], t[1], `근음에서 반음 ${t[2]}개 위`]), id => cb.tens.has(id), id => {
    cbNote = null;
    if (cb.tens.has(id)) { cb.tens.delete(id); return; }
    const clash = (TENS_EXCL[id] || []).filter(x => cb.tens.has(x));   // ♭9/9/♯9, 11/♯11, ♭13/13 are alternatives, not a stack
    clash.forEach(x => cb.tens.delete(x));
    cb.tens.add(id);
    if (clash.length) cbNote = { kind:'info', title:`${clash.map(tLabel).join('·')} 대신 ${tLabel(id)}를 넣었어요.`,
      text:`${clash.map(tLabel).join('·')}와 ${tLabel(id)}는 반음 차이라 함께 누르면 ‘지지직’ 하고 탁하게 부딪혀요. ${FAMILY_TXT[famOf(id)]} 한 계열에서는 하나만 골라요.${famOf(id) === '9' ? ' (예외: ♭9 + ♯9는 재즈의 ‘알터드’ 소리라 함께 쓸 수 있어요.)' : ''}`, fixes:[] };
  }, '', id => {
    const dup = tensionDup(id);
    if (dup) return { title:`${tLabel(id)}는 이 코드에 넣을 수 없어요.`, text:dup };
    const replacing = [...cb.tens].some(t => (TENS_EXCL[id] || []).includes(t));
    if (!cb.tens.has(id) && !replacing && cb.tens.size >= 3) return { title:'텐션은 3개까지만 골라요.', text:'텐션을 많이 쌓을수록 소리가 탁해져요. 처음엔 9 하나만 넣고 들어 본 뒤, 마음에 들면 하나씩 더해 보세요.', fixes:[{ label:'텐션 모두 빼기', run(){ cb.tens.clear(); } }] };
    return null;
  }, id => (TENS_REC[cb.q] || []).includes(id));
  seg($('#cbVoice'), VOICINGS.map(v => [v[0], v[1], v[2]]), id => cb.voicing === id, id => { cb.voicing = id; cbNote = null; }, 'ko');
  const r = cbBuild();
  $('#cbName').innerHTML = `${r.name}${r.alias ? `<small>흔히 ${r.alias}</small>` : ''}`;
  const tones = $('#cbTones'); tones.textContent = '';
  r.notes.forEach(x => { const s = document.createElement('span'); s.style.setProperty('--c', pcColor(x.n)); s.innerHTML = `${noteName(x.n)}<small>${x.lab}</small>`; tones.appendChild(s); });
  $('#cbWhy').innerHTML = `<b>${r.vname}</b> · ${r.vdesc}${r.detected && r.detected !== r.name ? ` 건반 모양만 보면 <b>${r.detected}</b>로도 읽혀요.` : ''}`;
  const RANK = { warn:0, tip:1, info:2 };
  const items = (cbNote ? [cbNote] : []).concat(r.warn.filter(w => !cbNote || w.title !== cbNote.title).sort((a, b) => RANK[a.kind] - RANK[b.kind]));
  const box = $('#cbGuide'); box.textContent = '';
  box.hidden = !items.length;
  const KIND = { warn:'주의', info:'알림', tip:'팁' };
  items.forEach(w => {
    const d = document.createElement('div'); d.className = 'gi ' + w.kind;
    d.innerHTML = `<span class="gk">${KIND[w.kind] || '가이드'}</span><div><b>${w.title}</b> ${w.text}</div>`;
    if (w.fixes && w.fixes.length) {
      const acts = document.createElement('div'); acts.className = 'gfix';
      w.fixes.forEach(f => {
        const b = document.createElement('button'); b.className = 'pchip'; b.textContent = f.label;
        b.addEventListener('click', () => { f.run(); cbNote = null; renderCB(); cbSound(false); });
        acts.appendChild(b);
      });
      d.lastElementChild.appendChild(acts);
    }
    box.appendChild(d);
  });
  return r;
}
let cbTimer = null;
function cbSound(record, arp){
  const r = cbBuild();
  clearTimeout(cbTimer);
  [...held.keys()].filter(k => k.startsWith('cb')).forEach(noteUp);
  const labs = {}; r.notes.forEach(x => { labs[x.n] = x.lab; }); setKeyDegrees(labs);
  const top = r.notes[r.notes.length - 1].n;
  if (record && recOn) { snapshot(keys); markPreset(null); }
  const c = keys.visual.center(r.notes[Math.floor(r.notes.length / 2)].n);
  spawnFloat(keys, r.notes[0].n, c.x, c.y, 96, null, { title:r.name, sub:`${r.vname} 보이싱`, chip:r.notes.map(x => x.lab).join(' · '), chipSub:'' });
  let sn = null;
  r.notes.forEach((x, i) => {
    const go = () => {
      const res = noteDown('cb' + i, x.n, { vel: x.n === top ? 104 : 88, record: !!record && !arp, nofloat:true, noinfo:true, nosnap:true });
      if (!arp) sn = res;
    };
    if (arp) setTimeout(go, i * 120); else go();
  });
  keys.info(top, 104, { cb:r, stepNotes: r.notes.map(x => x.n) });
  cbTimer = setTimeout(() => { [...held.keys()].filter(k => k.startsWith('cb')).forEach(noteUp); setKeyDegrees(null); }, arp ? r.notes.length * 120 + 900 : record ? 600 : 900);
}
/* ---- pop recipes: short "why it sounds prettier" lessons with listen buttons ---- */
function recipe(id){ ensureAudio(); setTab('keys'); loadPreset(keys, id, true); setTab('keys', true); play(); }
function demoChord(root, q, tens, voicing){ ensureAudio(); if (playing) stop(); cb.root = root; cb.q = q; cb.tens = new Set(tens); cb.voicing = voicing || 'close'; cbNote = null; renderCB(); cbSound(false); }
function demoSeq(list){ list.forEach((c, i) => setTimeout(() => demoChord(...c), i * 1000)); }
function demoNotes(nums){
  ensureAudio(); if (playing) stop();
  nums.forEach((n, i) => noteDown('demo' + i, n, { vel:92, record:false, nofloat:i > 0, noinfo:i < nums.length - 1 }));
  setTimeout(() => nums.forEach((n, i) => noteUp('demo' + i)), 1100);
}
const POP_TIPS = [
  { k:'Progression', t:'머니 코드 (I–V–vi–IV)', p:'C–G–Am–F. 흔히 ‘머니 코드’라고 부르는, 수많은 히트곡이 쓴 진행이에요. 같은 진행도 치는 방법에 따라 느낌이 확 달라져요.',
    how:'예쁘게 버전에서 바뀐 점: 왼손은 낮은 근음 하나, 오른손엔 9·7을 더한 화음, 맨 위 음은 거의 제자리, 리듬은 3+3+2.',
    ab:[['기본형', () => recipe('money')], ['예쁘게', () => recipe('money2')]] },
  { k:'Progression', t:'왕도 진행 (IV–V–iii–vi)', p:'Fmaj7–G7–Em7–Am9. 한국·일본 발라드와 아이돌 곡에서 특히 사랑받는 감성 진행이에요.',
    how:'오른손 위 성부가 한 칸씩 내려오며 이어져서 아련하게 들려요.', ab:[['듣기', () => recipe('royal')]] },
  { k:'Color', t:'add9 한 방울', p:'3화음(도·미·솔)에 9(레)만 더해도 맑고 반짝이는 팝 사운드가 돼요. 텐션 입문용으로 가장 안전해요.',
    ab:[['C', () => demoChord(0, 'maj', [])], ['Cadd9', () => demoChord(0, 'maj', ['9'])]] },
  { k:'Color', t:'7th로 감성 더하기', p:'C를 Cmaj7으로, Am을 Am7으로 바꾸면 도시적이고 몽글몽글해져요. 발라드·시티팝의 단골이에요.',
    ab:[['C', () => demoChord(0, 'maj', [])], ['Cmaj7', () => demoChord(0, 'maj7', [])], ['Cmaj7(9)', () => demoChord(0, 'maj7', ['9'])]] },
  { k:'Tension', t:'sus4 → 풀어주기', p:'Gsus4(솔·도·레)에서 G(솔·시·레)로 한 음만 내려 ‘풀어 주면’ 기대감이 생겼다가 해소돼요. 후렴 직전에 자주 써요.',
    ab:[['Gsus4 → G', () => demoSeq([[7, 'sus4', []], [7, 'maj', []]])]] },
  { k:'Voicing', t:'낮은 음은 비워 두기', p:'C2 근처 낮은 곳에서 3도를 촘촘히 쌓으면 ‘웅웅’ 탁해져요. 왼손은 근음만 낮게, 화음은 가운데 도(C3) 위에서 쳐요.',
    ab:[['탁한 예', () => demoNotes([48, 52, 55, 59])], ['맑은 예', () => demoNotes([48, 64, 67, 71])]] },
  { k:'Melody', t:'맨 위 음을 노래처럼', p:'코드가 바뀔 때 맨 위 음이 가깝게 이어지면(전위) 화음만 쳐도 멜로디처럼 들려요. 맨 위 음을 조금 세게 치는 것도 요령이에요.',
    ab:[['점프하는 예', () => recipe('money')], ['이어지는 예', () => recipe('pop')]] },
  { k:'Rhythm', t:'3+3+2 리듬', p:'8칸을 3·3·2로 나눠 치면 ‘쿵—짝—짝’ 하고 통통 튀는 팝 리듬이 돼요. 계속 누르고만 있는 블록 코드보다 훨씬 살아나요.',
    ab:[['블록 코드', () => recipe('money')], ['3+3+2', () => recipe('money2')]] },
];
(function buildPopGuide(){
  const box = $('#pcards');
  POP_TIPS.forEach(c => {
    const d = document.createElement('div'); d.className = 'pcard';
    d.innerHTML = `<span class="k">${c.k}</span><h4>${c.t}</h4><p>${c.p}</p>${c.how ? `<p class="how">${c.how}</p>` : ''}<div class="ab"></div>`;
    c.ab.forEach(([label, run]) => { const b = document.createElement('button'); b.className = 'pchip'; b.textContent = '▶ ' + label; b.addEventListener('click', run); d.querySelector('.ab').appendChild(b); });
    box.appendChild(d);
  });
})();
$('#cbPlay').addEventListener('click', () => cbSound(true));
$('#cbArp').addEventListener('click', () => cbSound(false, true));

/* keymap guide */
function buildKeymap(){
  const tr = T(), km = $('#keymap');
  km.textContent = ''; km.className = 'keymap k-' + tr.id;
  tr.keymapRows().forEach(row => {
    const r = document.createElement('div'); r.className = 'krowmap'; r.style.paddingLeft = row.pad + 'px';
    row.items.forEach(it => {
      if (!it) { const sp = document.createElement('span'); sp.className = 'spacer'; r.appendChild(sp); return; }
      const b = document.createElement('button'); b.className = 'cap' + (it.off ? ' off' : ''); b.style.setProperty('--c', it.color);
      b.innerHTML = `<b>${it.k}<i></i></b><span>${it.sub}</span>`;
      b.title = it.title;
      if (!it.off) {
        b.addEventListener('pointerdown', e => { if (e.button !== 0) return; e.preventDefault(); noteDown('p' + e.pointerId, it.note, { vel:100, pos:it.pos }); });
        b.addEventListener('click', e => { if (e.detail !== 0) return; noteDown('cap', it.note, { vel:100, pos:it.pos }); setTimeout(() => noteUp('cap'), 200); });
      } else b.disabled = true;
      r.appendChild(b);
    });
    km.appendChild(r);
  });
}
function setOctave(d){
  const nb = KR.full ? clamp(keysBase + 12 * d, 24, 96) : clamp(keysBase + 12 * d, 48, 60);
  if (nb === keysBase) return;
  keysBase = nb; refreshKeyLetters();
  if (active === 'keys') { $('#kitHint').innerHTML = keys.hint(); buildKeymap(); }
}

/* ================= tabs ================= */
const tabsEl = $('#tabs');
ORDER.forEach(id => {
  const tr = TRACKS[id];
  const b = document.createElement('button');
  b.className = 'tab'; b.dataset.t = id; b.id = 'tab-' + id;
  b.setAttribute('role', 'tab'); b.setAttribute('aria-controls', 'console');
  b.innerHTML = `<span class="ti" aria-hidden="true">${ICON[id]}</span><span class="tt"><b>${tr.ko}</b><small>${tr.meta}</small></span>`;
  b.addEventListener('click', () => setTab(id));
  tabsEl.appendChild(b);
});
tabsEl.addEventListener('keydown', e => {
  const i = ORDER.indexOf(active); let j = null;
  if (e.key === 'ArrowRight') j = (i + 1) % 3; else if (e.key === 'ArrowLeft') j = (i + 2) % 3; else if (e.key === 'Home') j = 0; else if (e.key === 'End') j = 2;
  if (j == null) return;
  e.preventDefault(); e.stopPropagation(); setTab(ORDER[j]); $('#tab-' + ORDER[j]).focus();
});
function setTab(id, first){
  if (!TRACKS[id]) id = 'drum';
  if (!first && id === active) return;
  releaseAll(); clearLinks();
  active = id; const tr = T();
  store.set('bnm-tab', id);
  document.querySelectorAll('.tab').forEach(b => { const on = b.dataset.t === id; b.setAttribute('aria-selected', on); b.tabIndex = on ? 0 : -1; });
  ORDER.forEach(k => { TRACKS[k].stage.hidden = k !== id; });
  $('#mark').innerHTML = ICON[id];
  $('#hTitle').innerHTML = `${tr.ko} 노트 지도 <span class="en">${tr.en} Note Map</span>`;
  $('#lede').textContent = tr.lede;
  $('#chip2').innerHTML = tr.chip;
  $('#kitH').innerHTML = tr.kitH;
  $('#kitHint').innerHTML = tr.hint();
  const tog = $('#namesTog'); tog.hidden = !tr.svg; tog.setAttribute('aria-pressed', tr.names);
  sndTab = id; updateSndUI();
  $('#cbuild').hidden = id !== 'keys';
  $('#popGuide').hidden = id !== 'keys';
  modEl('tools').hidden = id !== 'keys'; updateCols();
  if (midi.access) midiBind();     // refresh the "what your keys do on this tab" line
  $('#susTog').hidden = !tr.melodic;
  $('#rangeTog').hidden = id !== 'keys'; $('#cbNotice').hidden = true;
  $('#scalebar').hidden = !tr.melodic;
  $('#lcdChordCell').hidden = id !== 'keys';
  buildRoll(); renderNotes(); buildPresets(); markPreset(tr.preset); applyScale();
  tr.info(tr.defaultNote, null, { stepNotes: id === 'keys' ? sounding(tr, 0).map(x => x.note) : null });
  if (id === 'keys') { showChord(sounding(tr, 0).map(x => x.note)); renderCB(); }
  $('#axes').innerHTML = tr.axes; $('#fineRoll').innerHTML = tr.fineRoll;
  $('#keyHint').innerHTML = tr.keyHint; buildKeymap();
  $('#steps').innerHTML = tr.steps; $('#fineLogic').innerHTML = tr.fineLogic;
  syncUI();
}

/* ---- color & groove cards ---- */
function play(){ if (!playing) start(); }
function trio(d, b, k){ loadPreset(drum, d, false); loadPreset(bass, b, false); loadPreset(keys, k, false); setBassTone(BASS_TONE_OF[b] || tone.bass); mixParts = new Set(IDS); }
const CCARDS = [
  { k:'Groove', t:'스윙(셔플)', p:'8분음표 두 개 중 뒤의 음을 살짝 늦게 치면 ‘따-단 따-단’ 하고 출렁여요. 50%는 똑바로, 66% 근처가 셋잇단 느낌이에요. 재즈·블루스·힙합의 핵심.', b:'블루스 셔플 듣기',
    run(){ setTab('drum'); loadPreset(drum, 'shuffle', true); play(); } },
  { k:'Dynamics', t:'고스트 노트', p:'세기 30~50으로 아주 약하게 치는 숨은 음. 들릴 듯 말 듯한 스네어가 펑크 그루브를 쫀득하게 만들어요. 피아노 롤에서 세기선이 짧은 노트를 찾아보세요.', b:'펑크 고스트 노트',
    run(){ setTab('drum'); loadPreset(drum, 'funk', true); play(); } },
  { k:'Feel', t:'휴머나이즈', p:'컴퓨터는 매번 똑같은 세기와 타이밍으로 쳐서 딱딱하게 들려요. 아주 조금씩 흔들어 주면 사람이 친 것처럼 자연스러워져요.', b:'휴머나이즈 켜고 듣기',
    run(){ humanOn = true; syncUI(); play(); } },
  { k:'Harmony', t:'7th와 텐션', p:'3화음(도미솔)에 7도를 얹으면 세련되고, 9·11·13 텐션을 더하면 색이 짙어져요. 같은 C라도 C → Cmaj7 → Cmaj7(9)는 전혀 다른 분위기.', b:'Cmaj7(9) 만들기',
    run(){ setTab('keys'); cb.root = 0; cb.q = 'maj7'; cb.tens = new Set(['9']); cb.voicing = 'close'; renderCB(); cbSound(false, true); $('#cbuild').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block:'center' }); } },
  { k:'Voicing', t:'보이싱과 보이스 리딩', p:'같은 코드라도 어떤 순서·간격으로 쌓느냐에 따라 소리가 달라요. 코드가 바뀔 때 음이 가장 적게 움직이게 고르면 부드럽게 이어져요.', b:'ii–V–I 재즈 트리오',
    run(){ trio('jazz', 'walk', 'two5one'); setBpm(132); setSwing(8, 64); setScale(0, 'major'); mixOn = true; setTab('keys', true); play(); } },
  { k:'Scale', t:'스케일(음계)', p:'곡에 어울리는 음들의 모음. 스케일 안의 음만 쓰면 틀린 음 없이 릭을 만들 수 있어요. 스케일 렌즈를 켜면 피아노 롤과 지판에 표시돼요.', b:'A 마이너 펜타토닉 보기',
    run(){ setTab('bass'); setScale(9, 'minpent'); $('#scalebar').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block:'center' }); } },
  { k:'Mix', t:'합주와 리버브', p:'리버브는 방의 울림이에요. 건반엔 넉넉히, 베이스엔 거의 안 거는 게 보통. 악기별 볼륨과 음소거(M)만 바꿔도 곡 인상이 달라져요.', b:'블루스 밴드 합주',
    run(){ trio('shuffle', 'boogie', 'charleston'); setBpm(112); setSwing(8, 66); setScale(4, 'blues'); mixOn = true; setTab('bass', true); play(); } },
  { k:'Arrange', t:'필인과 크래시', p:'몇 마디마다 끝에서 탐을 굴리고(필인) 다음 마디 첫 박에 크래시를 치면 “여기서 새 구간 시작!”이라는 신호가 돼요.', b:'2마디 탐 필인',
    run(){ setTab('drum'); loadPreset(drum, 'fill', true); play(); } },
];
(function buildCards(){
  const box = $('#ccards');
  CCARDS.forEach(c => {
    const d = document.createElement('div'); d.className = 'ccard';
    d.innerHTML = `<span class="k">${c.k}</span><h3>${c.t}</h3><p>${c.p}</p><button>${c.b}</button>`;
    d.querySelector('button').addEventListener('click', () => { ensureAudio(); c.run(); });
    box.appendChild(d);
  });
})();

/* ================= 88-key range for the keys tab ================= */
function setKeyRange(full, why){
  if (KR.full === full) return;
  releaseAll();
  KR.full = full; KR.lo = full ? 21 : 48; KR.hi = full ? 108 : 76;
  if (!full) keysBase = clamp(keysBase, 48, 60);
  buildKeys(KR.lo, KR.hi);
  Object.values(keysZones).forEach(z => wireZone(keys, z, +z.dataset.note));
  keys.rows = range(KR.hi, KR.lo); keys.top = keys.rows[0]; keys.rowSet = new Set(keys.rows);
  keys.meta = full ? 'Keys · A-1–C7 · 88건반' : 'Keys · C2–E4 · 29건반';
  const small = $('#tab-keys small'); if (small) small.textContent = keys.meta;
  $('#stage-keys .stage-cap').textContent = full ? 'Keyboard · 88건반 (A-1~C7)' : 'Keyboard · 건반 2옥타브 반';
  const t = $('#rangeTog'); t.setAttribute('aria-pressed', full); t.textContent = full ? '88건반 ●' : '88건반 ○';
  store.set('bnm-keys88', full ? '1' : '0');
  if (full && tone.keys === 'steinway') ensureKit('pianoext');
  applyScale();
  if (active === 'keys') {
    buildRoll(); renderNotes(); applyScale(); $('#kitHint').innerHTML = keys.hint(); buildKeymap();
    $('#cbNotice').hidden = !(why === 'midi');
  }
}
$('#rangeTog').addEventListener('click', () => { setKeyRange(!KR.full); $('#cbNotice').hidden = true; });

/* ================= MIDI keyboard (Web MIDI: USB, and Bluetooth once the OS has connected it) ================= */
const midi = { access:null, sustain:false, soft:false, held:new Set(), names:[], invert: store.get('bnm-pedal-inv') === '1',
  pedalCC: +(store.get('bnm-pedal-cc') || 64), learn:false, ccSeen:false };
const inFrame = (() => { try { return window.self !== window.top; } catch (e) { return true; } })();
const MIDI_MAP_TXT = {
  drum:'드럼 탭은 GM 드럼 배치예요: C1 킥, D1 스네어, F#1 닫힌 하이햇, A#1 열린 하이햇… 다른 옥타브에서 쳐도 같은 이름 자리의 악기가 나요. 서스테인 페달을 밟으면 드러머의 왼발처럼 하이햇 페달(G#1)이 울려요.',
  bass:'베이스 탭은 친 음을 베이스 음역(E0~G1)에 맞게 옥타브만 옮겨서 연주·기록해요. 서스테인 페달을 밟고 있는 동안 음이 이어져요.',
  keys:'건반 탭은 친 음 그대로, 88건반 전체(A-1~C7)를 실제 음높이로 연주해요. C2~E4 밖의 건반을 치면 화면도 88건반 보기로 넓어져요. 서스테인 페달을 밟고 있는 동안 음이 이어지고, 실시간 녹음에선 페달을 뗄 때까지 노트가 길어져요.',
};
function midiFold(tr, n){
  if (tr.id === 'drum') { if (BY_NOTE[n]) return n; const f = 36 + mod(n - 36, 12); return BY_NOTE[f] ? f : null; }
  // keys: a piano key outside C2–E4 opens the full 88-key view so it plays at its real pitch
  if (tr.id === 'keys' && n >= 21 && n <= 108 && (n < KR.lo || n > KR.hi)) { setKeyRange(true, 'midi'); return n; }
  const lo = tr.rows[tr.rows.length - 1], hi = tr.rows[0];
  while (n < lo) n += 12; while (n > hi) n -= 12;
  return n;
}
function midiBlink(){ ['#midiBtn', '#midiChip'].forEach(s => { const el = $(s); el.classList.add('hit'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('hit'), 90); }); }
function midiNoteOn(raw, vel){
  const tr = T(), n = midiFold(tr, raw); if (n == null) return;
  askToUnlock();                                   // playing while sound is still locked: show the big "소리 켜기" button
  if (midi.soft) vel = Math.max(1, Math.round(vel * .6));   // soft pedal (CC 67)
  noteDown('m' + raw, n, { vel, pos: tr.id === 'bass' ? bassDefault(n) : undefined });
  midiBlink();
}
function midiNoteOff(raw){ noteUp('m' + raw); }     // sustain (pedal, switch or ` key) is handled inside noteUp
function pedalUI(){
  const on = sustainOn();
  const by = [sus.pedal && '페달', sus.latch && '화면 스위치', sus.key && '` 키'].filter(Boolean).join(' + ');
  $('#pedalLamp').classList.toggle('on', on);
  $('#pedalLamp').textContent = on ? `서스테인 ● ${by}` : '서스테인 ○';
  $('#softLamp').hidden = !midi.soft;
  $('#pedalInv').setAttribute('aria-pressed', midi.invert);
  const t = $('#susTog');
  t.setAttribute('aria-pressed', sus.latch);
  t.classList.toggle('held', on && !sus.latch);
  t.textContent = sus.latch ? '서스테인 ● 켜짐' : (on ? `서스테인 ● ${by}` : '서스테인 ○');
}
function midiPedal(value){
  const down = midi.invert ? value < 64 : value >= 64;
  if (down === sus.pedal) return;
  sus.pedal = down; sustainChanged();
  if (T().id === 'drum' && down) {                   // drums: the pedal is the drummer's left foot on the hi-hat
    askToUnlock(); noteDown('mpedal', BY_ID.hhp.note, { vel:92 }); setTimeout(() => noteUp('mpedal'), 60); midiBlink();
  }
}
// Some keyboards (e.g. M-VAVE SMK-25) send every message on two ports at once ("SMK25" + "MIDIIN2 (SMK25)").
// Drop the copy that arrives from a different port a few ms later, or each key would play and record twice.
const recentMsg = new Map();
function midiTrace(d){
  const st = d[0] & 0xf0, mon = $('#midiMon'); if (!mon) return;
  let t;
  if (st === 0x90 && d[2]) t = `건반 누름 ${noteName(d[1])} · 세기 ${d[2]}`;
  else if (st === 0x80 || st === 0x90) t = `건반 뗌 ${noteName(d[1])}`;
  else if (st === 0xb0) t = `컨트롤 CC ${d[1]} = ${d[2]}${d[1] === midi.pedalCC ? ' (서스테인 페달)' : d[1] === 67 ? ' (소프트 페달)' : ''}`;
  else if (st === 0xe0) t = '피치 벤드'; else if (st === 0xc0) t = `프로그램 ${d[1]}`; else t = `기타 신호 [${[...d].join(', ')}]`;
  mon.textContent = '마지막 신호: ' + t;
  if (st === 0xb0) { midi.ccSeen = true; $('#pedalSeen').textContent = d[1] === midi.pedalCC ? '페달 신호가 들어오고 있어요.' : `CC ${d[1]} 신호가 들어와요. 이게 페달이라면 ‘페달 신호 찾기’를 눌러 지정하세요.`; }
}
function midiMessage(e){
  const d = e.data; if (d[0] >= 0xf8) return;      // clock / active sensing
  const key = Array.prototype.join.call(d, ','), now = performance.now(), port = e.currentTarget || e.target;
  const prev = recentMsg.get(key);
  if (prev && prev.port !== port && now - prev.t < 25) return;
  recentMsg.set(key, { t:now, port }); if (recentMsg.size > 96) recentMsg.clear();
  midiTrace(d);
  const [st, d1, d2] = d, cmd = st & 0xf0;
  if (midi.learn && cmd === 0xb0) {                 // "페달 신호 찾기": the next controller message becomes the sustain pedal
    midi.learn = false; midi.pedalCC = d1; store.set('bnm-pedal-cc', String(d1));
    $('#pedalLearn').setAttribute('aria-pressed', 'false'); $('#pedalLearn').textContent = `페달 = CC ${d1}`;
    $('#pedalSeen').textContent = `CC ${d1}을(를) 서스테인 페달로 쓸게요.`;
  }
  if (cmd === 0x90 && d2 > 0) midiNoteOn(d1, d2);
  else if (cmd === 0x80 || (cmd === 0x90 && d2 === 0)) midiNoteOff(d1);
  else if (cmd === 0xb0 && d1 === midi.pedalCC) midiPedal(d2);
  else if (cmd === 0xb0 && d1 === 67) { midi.soft = d2 >= 64; pedalUI(); }
  else if (cmd === 0xb0 && (d1 === 120 || d1 === 123)) { sus.pedal = false; [...held.keys()].filter(k => k[0] === 'm').forEach(k => noteUp(k, true)); sustainChanged(); }
}
function midiShow(state, detail){
  const box = $('#midiStatus'), txt = $('#midiTxt'), ic = $('#midiIc'), chip = $('#midiChip');
  box.hidden = false; box.classList.toggle('ok', state === 'ready'); box.classList.toggle('bad', ['blocked', 'unsupported', 'error'].includes(state));
  $('#midiBtn').setAttribute('aria-pressed', state === 'ready');
  $('#midiPedalRow').hidden = state !== 'ready'; pedalUI();
  chip.hidden = false; chip.classList.toggle('on', state === 'ready');
  ic.textContent = { ready:'연결됨', none:'대기 중', asking:'허용 대기', blocked:'막힘', unsupported:'미지원', error:'오류' }[state] || 'MIDI';
  const name = midi.names.join(', ');
  $('#midiChipTxt').textContent = { ready:`MIDI · ${name}`, none:'MIDI · 건반 없음', asking:'MIDI · 허용 대기 중' }[state] || 'MIDI · 연결 안 됨';
  const soundOff = !ctx || ctx.state !== 'running';
  txt.innerHTML = {
    asking:'Chrome이 MIDI 장치를 써도 되는지 묻고 있어요. <b>주소창 바로 아래 왼쪽에 뜬 작은 창에서 ‘허용’</b>을 눌러 주세요. 한 번 허용하면 다음부터는 페이지를 열 때 자동으로 연결돼요.',
    ready:`<b>${name}</b> 연결됨.${soundOff ? ' <b>화면을 아무 곳이나 한 번 클릭하면 소리가 켜져요</b>(브라우저 규칙상 건반만으로는 소리를 켤 수 없어요).' : ''} 건반을 치면 지금 탭의 악기로 소리 나고, REC가 켜져 있으면 피아노 롤에 기록돼요. ${MIDI_MAP_TXT[active]}`,
    none:'MIDI는 켜졌지만 연결된 건반이 없어요. USB 건반은 꽂으면 바로 나타나고, 블루투스 건반은 먼저 컴퓨터에 연결해야 해요(아래 방법).',
    unsupported:'이 브라우저는 MIDI 건반을 지원하지 않아요(Safari, iPhone·iPad 포함). PC나 Mac의 <b>Chrome</b> 또는 <b>Edge</b>에서 열어 주세요.',
    blocked: inFrame
      ? '이 화면(Claude 아티팩트 보기) 안에서는 보안상 브라우저가 MIDI 장치를 열지 못하게 막혀 있어요. 내려받은 <b>index.html</b>을 Chrome이나 Edge로 열면 건반을 연결할 수 있어요.'
      : 'MIDI 사용이 거절됐어요. 주소창 왼쪽의 사이트 정보 아이콘 → 사이트 설정에서 ‘MIDI 장치’를 <b>허용</b>으로 바꾼 뒤 MIDI 버튼을 다시 눌러 주세요.',
    error:`MIDI를 여는 중 문제가 생겼어요${detail ? ` (${detail})` : ''}. 건반을 다시 꽂고 MIDI 버튼을 눌러 보세요.`,
  }[state];
}
function midiBind(){
  const ins = [...midi.access.inputs.values()];
  ins.forEach(inp => { if (inp.onmidimessage !== midiMessage) inp.onmidimessage = midiMessage; });   // assigning opens the port
  // one keyboard often shows up as several ports on Windows ("SMK25", "MIDIIN2 (SMK25)", …): show it once
  midi.names = [...new Set(ins.filter(i => i.state === 'connected').map(i => (i.name || 'MIDI 건반').replace(/^MIDIIN\d+\s*\((.*)\)$/i, '$1').trim()))];
  midiShow(midi.names.length ? 'ready' : 'none');
  if (midi.names.length) askToUnlock();
}
async function midiConnect(auto){
  if (auto !== true) ensureAudio();                // a click is the gesture that lets sound start; MIDI notes alone can't
  if (midi.access) { midiBind(); return; }
  if (!navigator.requestMIDIAccess) { midiShow('unsupported'); return; }
  midiShow('asking');
  try {
    midi.access = await navigator.requestMIDIAccess({ sysex:false });
    midi.access.onstatechange = midiBind;           // plugging in / Bluetooth connect while the page is open
    midiBind();
  } catch (e) {
    midi.access = null;
    midiShow(e && (e.name === 'SecurityError' || e.name === 'NotAllowedError') ? 'blocked' : 'error', e && e.name);
  }
}
$('#midiBtn').addEventListener('click', midiConnect);
$('#pedalLearn').textContent = midi.pedalCC === 64 ? '페달 신호 찾기' : `페달 = CC ${midi.pedalCC}`;
$('#pedalLearn').addEventListener('click', () => {
  midi.learn = !midi.learn;
  $('#pedalLearn').setAttribute('aria-pressed', midi.learn);
  $('#pedalLearn').textContent = midi.learn ? '페달을 밟아 보세요…' : (midi.pedalCC === 64 ? '페달 신호 찾기' : `페달 = CC ${midi.pedalCC}`);
  if (midi.learn) $('#pedalSeen').textContent = '지금 페달을 한 번 밟으세요. 들어오는 컨트롤 신호를 서스테인으로 지정해요.';
});
$('#pedalInv').addEventListener('click', () => {
  midi.invert = !midi.invert; store.set('bnm-pedal-inv', midi.invert ? '1' : '0');
  sus.pedal = false; sustainChanged();
});
$('#midiChip').addEventListener('click', () => { midiConnect(); $('#midiStatus').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block:'center' }); });
if (navigator.requestMIDIAccess && !inFrame) $('#midiChip').hidden = false;
// already allowed on this computer → connect by itself on load (and as soon as the viewer allows it in site settings)
(async () => {
  if (!navigator.requestMIDIAccess || !navigator.permissions) return;
  try {
    const p = await navigator.permissions.query({ name:'midi' });
    const go = () => { if (p.state === 'granted') midiConnect(true); };
    go(); p.onchange = go;
  } catch (e) {}
})();
// browsers only start sound after a click or key press on the page: the first one anywhere turns it on
['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, () => {
  if (ctx && ctx.state === 'running') return;
  ensureAudio(); if (midi.access) setTimeout(midiBind, 150);
}, { capture:true }));
$('#unlock').addEventListener('click', () => { ensureAudio(); setTimeout(updateSoundUI, 100); });

/* ================= movable panels ================= */
const MOD_NAMES = { inst:'악기', tools:'코드 도구', info:'정보 카드', ctrl:'재생 · 설정', roll:'피아노 롤' };
const ZONES = ['top', 'left', 'right', 'bottom'];
const ZONE_KO = { top:'위쪽 전체 너비', left:'왼쪽 열', right:'오른쪽 열', bottom:'아래쪽 전체 너비' };
const LAYOUTS = [
  { id:'ctrl', ko:'악기 옆에 설정', top:[], left:['inst', 'tools', 'info'], right:['ctrl', 'roll'], bottom:[] },
  { id:'roll', ko:'악기 옆에 피아노 롤', top:[], left:['inst', 'tools', 'info'], right:['roll', 'ctrl'], bottom:[] },
  { id:'wide', ko:'피아노 롤 넓게', top:[], left:['inst', 'tools'], right:['ctrl', 'info'], bottom:['roll'] },
  { id:'big', ko:'악기 크게 위로', top:['inst'], left:['roll'], right:['ctrl', 'tools', 'info'], bottom:[] },
];
const consoleEl = $('#console');
const modEl = id => consoleEl.querySelector(`.mod[data-mod="${id}"]`);
const zoneEl = z => consoleEl.querySelector(`.zone[data-zone="${z}"]`);
const copyLayout = l => Object.fromEntries(ZONES.map(z => [z, [...(l[z] || [])]]));
let layout = (() => {
  try {
    const s = JSON.parse(store.get('bnm-layout') || 'null'); const all = ZONES.flatMap(z => (s && s[z]) || []);
    if (all.length === 5 && Object.keys(MOD_NAMES).every(id => all.includes(id))) return copyLayout(s);
  } catch (e) {}
  return copyLayout(LAYOUTS[0]);
})();
const where = id => { const z = ZONES.find(k => layout[k].includes(id)); return { z, i:layout[z].indexOf(id) }; };
function moveMod(id, z, idx){
  const w = where(id); layout[w.z].splice(w.i, 1);
  const arr = layout[z]; arr.splice(idx == null ? arr.length : clamp(idx, 0, arr.length), 0, id);
  applyLayout();
  const sel = modEl(id).querySelector('.modmove'); if (sel) sel.focus({ preventScroll:true });
}
function updateCols(){
  const vis = z => layout[z].some(id => !modEl(id).hidden);
  ZONES.forEach(z => zoneEl(z).classList.toggle('vacant', !vis(z)));
  consoleEl.classList.toggle('one-col', !vis('left') || !vis('right'));
}
function applyLayout(){
  ZONES.forEach(z => layout[z].forEach(id => zoneEl(z).appendChild(modEl(id))));
  updateCols();
  store.set('bnm-layout', JSON.stringify(layout));
  document.querySelectorAll('.lay-chip').forEach(b => { const l = LAYOUTS.find(x => x.id === b.dataset.id); b.setAttribute('aria-pressed', ZONES.every(z => l[z].join() === layout[z].join())); });
  document.querySelectorAll('.modmove').forEach(refreshMoveMenu);
}
function refreshMoveMenu(sel){
  const w = where(sel.dataset.mod);
  const opts = [['', '⋯ 옮기기'], ['up', '↑ 위로'], ['down', '↓ 아래로'], ...ZONES.map(z => ['z:' + z, `→ ${ZONE_KO[z]}로`])];
  sel.innerHTML = opts.map(([v, t]) => {
    const off = (v === 'up' && w.i === 0) || (v === 'down' && w.i === layout[w.z].length - 1) || v === 'z:' + w.z;
    return `<option value="${v}"${off ? ' disabled' : ''}>${t}</option>`;
  }).join('');
  sel.value = '';
}
(function buildLayoutUI(){
  const bar = $('#layoutbar');
  bar.innerHTML = '<span class="lbl">화면 배치</span>';
  LAYOUTS.forEach(l => {
    const b = document.createElement('button'); b.className = 'pchip lay-chip'; b.dataset.id = l.id; b.textContent = l.ko;
    b.addEventListener('click', () => { layout = copyLayout(l); applyLayout(); });
    bar.appendChild(b);
  });
  const h = document.createElement('span'); h.className = 'hint'; h.textContent = '패널 제목 옆 ⠿를 끌어 원하는 자리에 놓거나, ⋯ 메뉴로 옮길 수 있어요. 배치는 이 브라우저에 기억돼요.';
  bar.appendChild(h);

  let dragId = null, dropAt = null;
  const line = document.createElement('div'); line.className = 'dropline';
  const clearOver = () => ZONES.forEach(z => zoneEl(z).classList.remove('over'));
  Object.keys(MOD_NAMES).forEach(id => {
    const m = modEl(id), head = m.querySelector('.phead');
    const mb = document.createElement('span'); mb.className = 'modbar';
    mb.innerHTML = `<button class="grip" type="button" title="끌어서 옮기기" aria-label="${MOD_NAMES[id]} 패널 끌어서 옮기기">⠿</button><select class="modmove" data-mod="${id}" aria-label="${MOD_NAMES[id]} 패널 옮기기"></select>`;
    head.appendChild(mb);
    const grip = mb.querySelector('.grip');
    grip.addEventListener('pointerdown', () => { m.draggable = true; });
    grip.addEventListener('pointerup', () => { if (!dragId) m.draggable = false; });
    m.addEventListener('dragstart', e => {
      if (!m.draggable || e.target !== m) return;
      dragId = id; e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', id); e.dataTransfer.setDragImage(head, 24, 18); } catch (err) {}
      requestAnimationFrame(() => { if (dragId !== id) return; consoleEl.classList.add('dragging'); m.classList.add('drag-src'); });
    });
    m.addEventListener('dragend', () => { m.draggable = false; dragId = null; dropAt = null; consoleEl.classList.remove('dragging'); m.classList.remove('drag-src'); line.remove(); clearOver(); });
    mb.querySelector('select').addEventListener('change', e => {
      const v = e.target.value, w = where(id); if (!v) return;
      if (v === 'up') moveMod(id, w.z, w.i - 1);
      else if (v === 'down') moveMod(id, w.z, w.i + 1);
      else moveMod(id, v.slice(2));
    });
  });
  ZONES.forEach(z => {
    const el = zoneEl(z); el.dataset.label = `${ZONE_KO[z]}에 놓기`;
    el.addEventListener('dragover', e => {
      if (!dragId) return;
      e.preventDefault(); e.dataTransfer.dropEffect = 'move';
      const ids = layout[z].filter(x => x !== dragId && !modEl(x).hidden);
      const before = ids.find(x => { const r = modEl(x).getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
      const rest = layout[z].filter(x => x !== dragId);
      dropAt = { z, idx: before ? rest.indexOf(before) : rest.length };
      if (before) el.insertBefore(line, modEl(before)); else el.appendChild(line);
      clearOver(); el.classList.add('over');
    });
    el.addEventListener('drop', e => { if (!dragId || !dropAt) return; e.preventDefault(); const id = dragId, t = dropAt; line.remove(); moveMod(id, t.z, t.idx); });
  });
  applyLayout();
})();

/* global keys */
document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.code === 'KeyZ') { e.preventDefault(); undo(); return; }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const tag = e.target.tagName;
  if (e.code === 'Space') {
    if (tag === 'BUTTON' || tag === 'SELECT' || tag === 'INPUT') return;
    e.preventDefault(); if (!e.repeat) toggle(); return;
  }
  if (e.code === 'Backquote') {                       // hold ` = sustain pedal stand-in
    e.preventDefault(); if (!e.repeat && !sus.key) { sus.key = true; sustainChanged(); } return;
  }
  if (tag === 'SELECT') return;
  if (!playing && (e.code === 'ArrowLeft' || e.code === 'ArrowRight') && tag !== 'INPUT') {
    e.preventDefault(); const tr = T(); tr.cursor = mod(tr.cursor + (e.code === 'ArrowRight' ? 1 : -1), STEPS(tr)); return;
  }
  const act = T().keyAction(e.code);
  if (!act) return;
  e.preventDefault();
  if (e.repeat || act.none) return;
  if (act.octave) { setOctave(act.octave); return; }
  noteDown('k' + e.code, act.note, { vel:e.shiftKey ? 127 : 100, pos:act.pos });
});
document.addEventListener('keyup', e => {
  if (e.code === 'Backquote') { sus.key = false; sustainChanged(); return; }
  noteUp('k' + e.code);
});
window.addEventListener('blur', () => { if (sus.key) { sus.key = false; sustainChanged(); } });
$('#susTog').addEventListener('click', () => { sus.latch = !sus.latch; sustainChanged(); });

/* ================= animation loop ================= */
let shownStep = -1;
function frame(){
  const S = STEPS(T());
  const pos = playing && ctx ? Math.max(0, currentPos()) : T().cursor;
  const p = mod(pos, S);
  ph.style.left = (p / S * 100) + '%';
  const st = Math.floor(p + 1e-6);
  if (st !== shownStep) { shownStep = st; $('#lcdPos').textContent = `${Math.floor(st / 16) + 1} . ${Math.floor(mod(st, 16) / 4) + 1} . ${st % 4 + 1}`; }
  requestAnimationFrame(frame);
}

/* ================= init ================= */
ORDER.forEach(k => loadPreset(TRACKS[k], 'rock', false));
tone.bass = BASS_TONE_OF.rock;
if (store.get('bnm-keys88') === '1') setKeyRange(true);
setBpm(100);
setTab(store.get('bnm-tab') || 'drum', true);
fetchKits();
info.classList.remove('swap');
requestAnimationFrame(frame);
})();
