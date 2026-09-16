// Short synthesised cues (no audio files) for everything that happens at the
// table. Browsers only allow audio after a user gesture, so `unlock()` is
// called from the first click.

const KEY = 'cardgame:sound';
let context = null;
let enabled = true;
try { enabled = localStorage.getItem(KEY) !== 'off'; } catch { /* storage unavailable */ }

function ensureContext() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    context ??= new Ctx();
    if (context.state === 'suspended') context.resume().catch(() => {});
    return context;
}

function tone(frequency, start, duration, { volume = 0.06, type = 'sine', to = null } = {}) {
    const ctx = ensureContext();
    if (!ctx) return;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    const at = ctx.currentTime + start;
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, at);
    if (to) oscillator.frequency.exponentialRampToValueAtTime(to, at + duration);
    gain.gain.setValueAtTime(volume, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start(at);
    oscillator.stop(at + duration);
}

const CUES = {
    deal: () => { for (let i = 0; i < 3; i++) tone(900 + i * 120, i * 0.07, 0.06, { volume: 0.03, type: 'triangle' }); },
    play: () => tone(1100, 0, 0.05, { volume: 0.035, type: 'triangle' }),
    select: () => tone(1500, 0, 0.03, { volume: 0.025, type: 'triangle' }),
    swap: () => { tone(700, 0, 0.06, { volume: 0.03, type: 'triangle', to: 1000 }); tone(1000, 0.06, 0.06, { volume: 0.03, type: 'triangle', to: 700 }); },
    flip: () => { tone(500, 0, 0.08, { volume: 0.04, type: 'triangle', to: 900 }); tone(1300, 0.09, 0.05, { volume: 0.03, type: 'triangle' }); },
    burn: () => { tone(700, 0, 0.35, { volume: 0.05, type: 'sawtooth', to: 90 }); tone(1400, 0, 0.2, { volume: 0.02, to: 300 }); },
    pickUp: () => tone(180, 0, 0.16, { volume: 0.05, type: 'triangle', to: 110 }),
    skip: () => { tone(880, 0, 0.06, { volume: 0.04 }); tone(660, 0.07, 0.08, { volume: 0.04 }); },
    reverse: () => tone(300, 0, 0.3, { volume: 0.04, type: 'triangle', to: 1200 }),
    ready: () => { tone(784, 0, 0.08, { volume: 0.035 }); tone(1046, 0.09, 0.14, { volume: 0.035 }); },
    join: () => { tone(523, 0, 0.09, { volume: 0.03, type: 'triangle' }); tone(659, 0.1, 0.12, { volume: 0.03, type: 'triangle' }); },
    chat: () => tone(1200, 0, 0.04, { volume: 0.02, type: 'triangle' }),
    reaction: () => tone(600, 0, 0.09, { volume: 0.035, type: 'triangle', to: 950 }),
    yourTurn: () => { tone(660, 0, 0.15); tone(880, 0.16, 0.25); },
    warning: () => tone(440, 0, 0.1, { volume: 0.04 }),
    win: () => { tone(523, 0, 0.2); tone(659, 0.2, 0.2); tone(784, 0.4, 0.2); tone(1047, 0.6, 0.5); },
    lose: () => { tone(392, 0, 0.25, { type: 'triangle' }); tone(330, 0.25, 0.25, { type: 'triangle' }); tone(262, 0.5, 0.55, { type: 'triangle' }); },
};

export function unlock() {
    if (enabled) ensureContext();
}

export function isEnabled() {
    return enabled;
}

export function setEnabled(value) {
    enabled = Boolean(value);
    try { localStorage.setItem(KEY, enabled ? 'on' : 'off'); } catch { /* storage unavailable */ }
    if (enabled) ensureContext();
}

export function play(name) {
    if (enabled) CUES[name]?.();
}
