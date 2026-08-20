// Dynamic Odds Engine — Per-Pair Streak-Based Odds Adjustment
//
// OU Market: Baseline 1.60/1.60. Adjusts 1.50/2.30 -> 1.30/2.60
// H2H Market: Baseline 1.83/1.83. Adjusts 1.60/2.40 -> 1.30/2.70 (Sum = 4.0)

const OU_BASELINE_ODDS = 1.60;
const OU_WINNING_SIDE_TIERS = [1.50, 1.40, 1.35, 1.30];  // streak 3, 4, 5, 6+
const OU_OPPOSITE_SIDE_TIERS = [2.30, 2.40, 2.50, 2.60];  // streak 3, 4, 5, 6+

const H2H_BASELINE_ODDS = 1.83;
const H2H_WINNING_SIDE_TIERS = [1.60, 1.50, 1.40, 1.30]; // streak 3, 4, 5, 6+
const H2H_OPPOSITE_SIDE_TIERS = [2.40, 2.50, 2.60, 2.70]; // streak 3, 4, 5, 6+

const MIN_STREAK_FOR_ADJUSTMENT = 3;
const MAX_STREAK = MIN_STREAK_FOR_ADJUSTMENT + OU_WINNING_SIDE_TIERS.length - 1; // 6

function getOUOdds(streakLength) {
    if (streakLength < MIN_STREAK_FOR_ADJUSTMENT) {
        return { winningSideOdds: OU_BASELINE_ODDS, oppositeSideOdds: OU_BASELINE_ODDS };
    }
    const tierIdx = Math.min(streakLength - MIN_STREAK_FOR_ADJUSTMENT, OU_WINNING_SIDE_TIERS.length - 1);
    return {
        winningSideOdds: OU_WINNING_SIDE_TIERS[tierIdx],
        oppositeSideOdds: OU_OPPOSITE_SIDE_TIERS[tierIdx]
    };
}

function getH2HOdds(streakLength) {
    if (streakLength < MIN_STREAK_FOR_ADJUSTMENT) {
        return { winningSideOdds: H2H_BASELINE_ODDS, oppositeSideOdds: H2H_BASELINE_ODDS };
    }
    const tierIdx = Math.min(streakLength - MIN_STREAK_FOR_ADJUSTMENT, H2H_WINNING_SIDE_TIERS.length - 1);
    return {
        winningSideOdds: H2H_WINNING_SIDE_TIERS[tierIdx],
        oppositeSideOdds: H2H_OPPOSITE_SIDE_TIERS[tierIdx]
    };
}

// ---------------------------------------------------------------------------
// OU (Over/Under 2.5) Dynamic Odds Tracker
// ---------------------------------------------------------------------------

class OUDynamicOddsTracker {
    constructor() {
        this.pairState = {};
    }

    _ensurePair(pairKey) {
        if (this.pairState[pairKey] === undefined) {
            this.pairState[pairKey] = 0;
        }
    }

    getOdds(pairKey) {
        this._ensurePair(pairKey);
        const balance = this.pairState[pairKey];
        const absBalance = Math.abs(balance);
        const { winningSideOdds, oppositeSideOdds } = getOUOdds(absBalance);

        if (balance > 0) {
            return { overOdds: winningSideOdds, underOdds: oppositeSideOdds };
        } else if (balance < 0) {
            return { overOdds: oppositeSideOdds, underOdds: winningSideOdds };
        }
        return { overOdds: OU_BASELINE_ODDS, underOdds: OU_BASELINE_ODDS };
    }

    recordResult(pairKey, result) {
        this._ensurePair(pairKey);
        let balance = this.pairState[pairKey];

        if (result === 'OVER') {
            balance++;
        } else if (result === 'UNDER') {
            balance--;
        }

        if (balance > MAX_STREAK) balance = MAX_STREAK;
        if (balance < -MAX_STREAK) balance = -MAX_STREAK;

        this.pairState[pairKey] = balance;
    }
}

// ---------------------------------------------------------------------------
// H2H (Winner) Dynamic Odds Tracker
// ---------------------------------------------------------------------------

class H2HDynamicOddsTracker {
    constructor() {
        this.pairState = {};
    }

    _ensurePair(pairKey, home, away) {
        if (!this.pairState[pairKey] && home && away) {
            const players = [home, away].sort();
            this.pairState[pairKey] = {
                balance: 0,
                playerA: players[0],
                playerB: players[1]
            };
        }
    }

    getOdds(pairKey, home, away) {
        this._ensurePair(pairKey, home, away);
        const state = this.pairState[pairKey];
        if (!state) return { homeOdds: H2H_BASELINE_ODDS, awayOdds: H2H_BASELINE_ODDS };

        const absBalance = Math.abs(state.balance);
        const { winningSideOdds, oppositeSideOdds } = getH2HOdds(absBalance);

        if (state.balance > 0) {
            if (home === state.playerA) return { homeOdds: winningSideOdds, awayOdds: oppositeSideOdds };
            else return { homeOdds: oppositeSideOdds, awayOdds: winningSideOdds };
        } else if (state.balance < 0) {
            if (home === state.playerB) return { homeOdds: winningSideOdds, awayOdds: oppositeSideOdds };
            else return { homeOdds: oppositeSideOdds, awayOdds: winningSideOdds };
        }
        return { homeOdds: H2H_BASELINE_ODDS, awayOdds: H2H_BASELINE_ODDS };
    }

    recordResult(pairKey, winner) {
        if (!winner) return;
        
        if (!this.pairState[pairKey]) {
            const players = pairKey.split(' vs ');
            this.pairState[pairKey] = {
                balance: 0,
                playerA: players[0],
                playerB: players[1]
            };
        }
        
        const state = this.pairState[pairKey];
        
        if (winner === state.playerA) {
            state.balance++;
        } else if (winner === state.playerB) {
            state.balance--;
        }

        if (state.balance > MAX_STREAK) state.balance = MAX_STREAK;
        if (state.balance < -MAX_STREAK) state.balance = -MAX_STREAK;
    }
}

module.exports = {
    OU_BASELINE_ODDS,
    H2H_BASELINE_ODDS,
    MIN_STREAK_FOR_ADJUSTMENT,
    OUDynamicOddsTracker,
    H2HDynamicOddsTracker
};
