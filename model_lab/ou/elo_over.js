// From-scratch OU 2.5 model: a single continuous "over-proneness" rating per player
// (init 0), online logistic update after every match - mechanistically distinct from the
// Poisson goal model (this is one step of online logistic regression with per-player
// additive bias terms, not a goal-count model at all).
const { sigmoid } = require('../backtest');

function run(matches, params) {
    const { K = 0.3, threshOver = 0.62, threshUnder = 0.62, minMatches = 3 } = params;
    const rating = {};
    const matchCount = {};
    let bets = 0, wins = 0;
    const totalMatches = matches.length;

    matches.forEach(m => {
        const home = m.participantAName, away = m.participantBName;
        if (rating[home] === undefined) { rating[home] = 0; matchCount[home] = 0; }
        if (rating[away] === undefined) { rating[away] = 0; matchCount[away] = 0; }

        const needsStats = matchCount[home] < minMatches || matchCount[away] < minMatches;
        const predictedP = sigmoid(rating[home] + rating[away]);

        let pick = null;
        if (!needsStats) {
            if (predictedP >= threshOver) pick = 'OVER';
            else if ((1 - predictedP) >= threshUnder) pick = 'UNDER';
        }

        const totalG = m.teamAScore + m.teamBScore;
        const actualOver = totalG > 2.5 ? 1 : 0;
        if (pick) {
            bets++;
            const won = (pick === 'OVER' && actualOver === 1) || (pick === 'UNDER' && actualOver === 0);
            if (won) wins++;
        }

        const delta = K * (actualOver - predictedP);
        rating[home] += delta;
        rating[away] += delta;
        matchCount[home]++;
        matchCount[away]++;
    });

    const wr = bets > 0 ? (wins / bets) * 100 : 0;
    const profit = bets * 5 * (wr / 100 * 1.6 - 1);
    return { bets, cov: (bets / totalMatches) * 100, wr, profit, params };
}

module.exports = { run };
