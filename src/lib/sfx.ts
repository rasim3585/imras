// Tiny synthesized match sounds (Web Audio) -- no asset files, mobile-light,
// works offline. Off by default; enable() must run from a user gesture so the
// browser lets audio play. Royalty-free by construction (generated tones/noise).
let ctx: AudioContext | null = null;
let on = false;

type WinAudio = typeof window & { webkitAudioContext?: typeof AudioContext };

export function sfxEnabled() { return on; }

export function toggleSfx(): boolean {
  on = !on;
  if (on) {
    if (!ctx) { const W = window as WinAudio; ctx = new (W.AudioContext || W.webkitAudioContext!)(); }
    void ctx.resume();
  }
  return on;
}

function tone(freq: number, start: number, dur: number, gain = 0.18) {
  if (!ctx) return;
  const o = ctx.createOscillator(); const g = ctx.createGain();
  o.type = 'square'; o.frequency.value = freq;
  o.frequency.setValueAtTime(freq, ctx.currentTime + start);
  o.frequency.linearRampToValueAtTime(freq * 1.03, ctx.currentTime + start + dur); // slight vibrato
  g.gain.setValueAtTime(0, ctx.currentTime + start);
  g.gain.linearRampToValueAtTime(gain, ctx.currentTime + start + 0.02);
  g.gain.setValueAtTime(gain, ctx.currentTime + start + dur - 0.04);
  g.gain.linearRampToValueAtTime(0, ctx.currentTime + start + dur);
  o.connect(g); g.connect(ctx.destination);
  o.start(ctx.currentTime + start); o.stop(ctx.currentTime + start + dur + 0.02);
}

// referee whistle: two short blips (kick-off) / one long (full time handled by caller)
export function whistle(long = false) {
  if (!on || !ctx) return;
  if (long) { tone(2050, 0, 0.5); }
  else { tone(2050, 0, 0.16); tone(2050, 0.22, 0.16); }
}

// crowd cheer: a short filtered-noise swell
export function cheer() {
  if (!on || !ctx) return;
  const dur = 1.2;
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 0.6;
  const src = ctx.createBufferSource(); src.buffer = buf;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 750; bp.Q.value = 0.7;
  const g = ctx.createGain();
  const t = ctx.currentTime;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.28, t + 0.25);   // swell up
  g.gain.linearRampToValueAtTime(0.14, t + 0.6);
  g.gain.linearRampToValueAtTime(0, t + dur);       // fade
  src.connect(bp); bp.connect(g); g.connect(ctx.destination);
  src.start(t); src.stop(t + dur);
}
