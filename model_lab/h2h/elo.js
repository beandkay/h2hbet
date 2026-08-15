// From-scratch H2H winner model: classic chess-style Elo (init 1500, swept K), draws
// scored 0.5 for both sides, win probability via the standard logistic Elo formula.
// Draws are pushes (excluded from the win/loss ledger) but still update ratings.
function run(matches, params) {
    const { K = 24, threshold = 0.58, minMatches = 3, initRating = 1500 } = params;
    const rating = {};
    const matchCount = {};
    let bets = 0, wins = 0, attempted = 0;
    const totalMatches = matches.length;

    matches.forEach(m => {
        const home = m.participantAName, away = m.participantBName;
        if (rating[home] === undefined) { rating[home] = initRating; matchCount[home] = 0; }
        if (rating[away] === undefined) { rating[away] = initRating; matchCount[away] = 0; }

        const needsStats = matchCount[home] < minMatches || matchCount[away] < minMatches;
        const pHome = 1 / (1 + Math.pow(10, (rating[away] - rating[home]) / 400));

        let pick = null;
        if (!needsStats) {
            if (pHome >= threshold) pick = home;
            else if ((1 - pHome) >= threshold) pick = away;
        }

        if (pick) {
            attempted++;
            if (m.teamAScore !== m.teamBScore) {
                bets++;
                const won = (pick === home && m.teamAScore > m.teamBScore) || (pick === away && m.teamBScore > m.teamAScore);
                if (won) wins++;
            }
        }

        const sHome = m.teamAScore > m.teamBScore ? 1 : m.teamAScore === m.teamBScore ? 0.5 : 0;
        rating[home] += K * (sHome - pHome);
        rating[away] += K * ((1 - sHome) - (1 - pHome));
        matchCount[home]++;
        matchCount[away]++;
    });

    const wr = bets > 0 ? (wins / bets) * 100 : 0;
    const profit = bets * 5 * (wr / 100 * 1.6 - 1);
    return { bets, attempted, cov: (attempted / totalMatches) * 100, wr, profit, params };
}

module.exports = { run };
