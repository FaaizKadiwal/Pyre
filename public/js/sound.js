// Short synthesised cues (no audio files): your turn, game over, timer warning.
// Browsers only allow audio after a user gesture, so `unlock()` is called from clicks.

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

function tone(frequency, start, duration, volume = 0.06) {
    const ctx = ensureContext();
    if (!ctx) return;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(volume, ctx.currentTime + start);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + duration);
    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start(ctx.currentTime + start);
    oscillator.stop(ctx.currentTime + start + duration);
}

const CUES = {
    yourTurn: () => { tone(660, 0, 0.15); tone(880, 0.16, 0.25); },
    gameOver: () => { tone(523, 0, 0.2); tone(659, 0.2, 0.2); tone(784, 0.4, 0.45); },
    warning: () => tone(440, 0, 0.1, 0.04),
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
