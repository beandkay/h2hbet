// From-scratch OU 2.5 model: per-player EWMA goals-scored/conceded (no full-history
// recompute, single forward pass, zero lookahead), blended with H2H average goals the
// same way production does, decided via a hand-written Poisson CDF instead of an xG cutoff.
const { poissonCDF } = require('../backtest');

function run(matches, params) {
    const { alpha = 0.15, threshOver = 0.6, threshUnder = 0.6, minMatches = 3 } = params;
    const playerState = {};
    const h2hState = {};
    let bets = 0, wins = 0;
    const totalMatches = matches.length;

    matches.forEach(m => {
        const home = m.participantAName, away = m.participantBName;
        if (!playerState[home]) playerState[home] = { scored: null, conceded: null, matches: 0 };
        if (!playerState[away]) playerState[away] = { scored: null, conceded: null, matches: 0 };
        const sHome = playerState[home], sAway = playerState[away];

        const pairKey = [home, away].sort().join(' vs ');
        if (!h2hState[pairKey]) h2hState[pairKey] = { matches: 0, totalGoals: 0 };
        const h2h = h2hState[pairKey];

        const needsStats = sHome.matches < minMatches || sAway.matches < minMatches;

        let pick = null;
        if (!needsStats) {
            const lambdaHome = (sHome.scored + sAway.conceded) / 2;
            const lambdaAway = (sAway.scored + sHome.conceded) / 2;
            let lambdaTotal = lambdaHome + lambdaAway;
            if (h2h.matches > 0) {
                const h2hAvg = h2h.totalGoals / h2h.matches;
                const w = Math.min(h2h.matches * 0.15, 0.40);
                lambdaTotal = (1 - w) * lambdaTotal + w * h2hAvg;
            }
            lambdaTotal = Math.max(lambdaTotal, 0.05);

            const pUnder = poissonCDF(2, lambdaTotal);
            const pOver = 1 - pUnder;
            if (pOver >= threshOver) pick = 'OVER';
            else if (pUnder >= threshUnder) pick = 'UNDER';
        }

        const totalG = m.teamAScore + m.teamBScore;
        if (pick) {
            bets++;
            const won = (pick === 'OVER' && totalG > 2.5) || (pick === 'UNDER' && totalG < 2.5);
            if (won) wins++;
        }

        sHome.scored = sHome.scored == null ? m.teamAScore : sHome.scored + alpha * (m.teamAScore - sHome.scored);
        sHome.conceded = sHome.conceded == null ? m.teamBScore : sHome.conceded + alpha * (m.teamBScore - sHome.conceded);
        sHome.matches++;
        sAway.scored = sAway.scored == null ? m.teamBScore : sAway.scored + alpha * (m.teamBScore - sAway.scored);
        sAway.conceded = sAway.conceded == null ? m.teamAScore : sAway.conceded + alpha * (m.teamAScore - sAway.conceded);
        sAway.matches++;

        h2h.totalGoals += totalG;
        h2h.matches++;
    });

    const wr = bets > 0 ? (wins / bets) * 100 : 0;
    const profit = bets * 5 * (wr / 100 * 1.6 - 1);
    return { bets, cov: (bets / totalMatches) * 100, wr, profit, params };
}

module.exports = { run };
