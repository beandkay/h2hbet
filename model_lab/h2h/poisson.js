// From-scratch H2H winner model: same per-player EWMA goals scored/conceded as
// model_lab/ou/poisson.js, but decided via a hand-written Skellam-equivalent (direct
// convolution of two independent Poisson goal counts) instead of win-rate phase buckets.
// Draws are pushes (excluded from the win/loss ledger), matching production's DNB convention.
const { jointWinProb } = require('../backtest');

function run(matches, params) {
    const { alpha = 0.15, threshold = 0.58, minMatches = 3 } = params;
    const playerState = {};
    const h2hState = {}; // pairKey -> { matches, goalsFor: { playerName: totalGoals } }
    let bets = 0, wins = 0, attempted = 0;
    const totalMatches = matches.length;

    matches.forEach(m => {
        const home = m.participantAName, away = m.participantBName;
        if (!playerState[home]) playerState[home] = { scored: null, conceded: null, matches: 0 };
        if (!playerState[away]) playerState[away] = { scored: null, conceded: null, matches: 0 };
        const sHome = playerState[home], sAway = playerState[away];

        const pairKey = [home, away].sort().join(' vs ');
        if (!h2hState[pairKey]) h2hState[pairKey] = { matches: 0, goalsFor: {} };
        const h2h = h2hState[pairKey];

        const needsStats = sHome.matches < minMatches || sAway.matches < minMatches;

        let pick = null;
        if (!needsStats) {
            let lambdaHome = (sHome.scored + sAway.conceded) / 2;
            let lambdaAway = (sAway.scored + sHome.conceded) / 2;
            if (h2h.matches > 0) {
                const w = Math.min(h2h.matches * 0.15, 0.40);
                const h2hHomeAvg = (h2h.goalsFor[home] || 0) / h2h.matches;
                const h2hAwayAvg = (h2h.goalsFor[away] || 0) / h2h.matches;
                lambdaHome = (1 - w) * lambdaHome + w * h2hHomeAvg;
                lambdaAway = (1 - w) * lambdaAway + w * h2hAwayAvg;
            }
            lambdaHome = Math.max(lambdaHome, 0.05);
            lambdaAway = Math.max(lambdaAway, 0.05);

            const { pHome, pAway } = jointWinProb(lambdaHome, lambdaAway);
            if (pHome >= threshold) pick = home;
            else if (pAway >= threshold) pick = away;
        }

        if (pick) {
            attempted++;
            if (m.teamAScore !== m.teamBScore) {
                bets++;
                const won = (pick === home && m.teamAScore > m.teamBScore) || (pick === away && m.teamBScore > m.teamAScore);
                if (won) wins++;
            }
        }

        sHome.scored = sHome.scored == null ? m.teamAScore : sHome.scored + alpha * (m.teamAScore - sHome.scored);
        sHome.conceded = sHome.conceded == null ? m.teamBScore : sHome.conceded + alpha * (m.teamBScore - sHome.conceded);
        sHome.matches++;
        sAway.scored = sAway.scored == null ? m.teamBScore : sAway.scored + alpha * (m.teamBScore - sAway.scored);
        sAway.conceded = sAway.conceded == null ? m.teamAScore : sAway.conceded + alpha * (m.teamAScore - sAway.conceded);
        sAway.matches++;

        h2h.goalsFor[home] = (h2h.goalsFor[home] || 0) + m.teamAScore;
        h2h.goalsFor[away] = (h2h.goalsFor[away] || 0) + m.teamBScore;
        h2h.matches++;
    });

    const wr = bets > 0 ? (wins / bets) * 100 : 0;
    const profit = bets * 5 * (wr / 100 * 1.6 - 1);
    return { bets, attempted, cov: (attempted / totalMatches) * 100, wr, profit, params };
}

module.exports = { run };
