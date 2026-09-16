// A personal record kept in this browser: rounds played, times out first,
// times shithead, and the current and best "safe" streaks.

const KEY = 'cardgame:record';
const EMPTY = { games: 0, firstOut: 0, shithead: 0, streak: 0, bestStreak: 0 };

export function loadRecord() {
    try {
        const saved = JSON.parse(localStorage.getItem(KEY));
        return saved && typeof saved === 'object' ? { ...EMPTY, ...saved } : { ...EMPTY };
    } catch {
        return { ...EMPTY };
    }
}

/** Fold one finished round into the record and return the new totals. */
export function recordRound({ firstOut, shithead }) {
    const record = loadRecord();
    record.games += 1;
    if (firstOut) record.firstOut += 1;
    if (shithead) {
        record.shithead += 1;
        record.streak = 0;
    } else {
        record.streak += 1;
        record.bestStreak = Math.max(record.bestStreak, record.streak);
    }
    try { localStorage.setItem(KEY, JSON.stringify(record)); } catch { /* storage unavailable */ }
    return record;
}
