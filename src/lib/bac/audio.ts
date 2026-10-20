let ctx: AudioContext | null = null;

export function primeAudio() {
  try {
    ctx = ctx ?? new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
  } catch {
    ctx = null;
  }
}

export function chime() {
  try {
    primeAudio();
    if (!ctx) return;
    const now = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(523.25, now);
    o.frequency.setValueAtTime(659.25, now + 0.14);
    o.frequency.setValueAtTime(783.99, now + 0.28);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.18, now + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.7);
    o.connect(g);
    g.connect(ctx.destination);
    o.start(now);
    o.stop(now + 0.75);
  } catch {
    /* autoplay or missing API */
  }
}
