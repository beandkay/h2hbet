// Additional, independent prediction signals for the dashboard prediction card:
// a Poisson goal model and an Elo-style online classifier, for both OU (2.5 goals)
// and H2H (winner) markets. Validated in model_lab/ against production on a 45-day
// backtest (see plan notes) — hyperparameters below are the winning configs found
// there. State is rebuilt from historical_fifa.json via one forward pass every call
// (no persisted rating file), matching how the rest of the pipeline always recomputes
// stats from scratch each tick. That same forward pass also tallies each model's
// live bets/wins/profit against its own historical picks (predict-before-update, so
// it's the identical walk-forward, zero-lookahead check used in model_lab), giving a
// running $5-stake/1.7x-payout performance figure that refreshes every tick.
const fs = require('fs');

const STAKE = 5;
const PAYOUT = 1.7;

// Thresholds re-tuned for the 1.7x payout (was 1.6x): grid-searched per market for
// max profit against a 45-day window (tmp_backtest/recent_45day_fresh.json), then
// confirmed on the live 31-day history (historical_fifa.json) — see
// tmp_backtest/grid_payout17.js. The higher payout lowers break-even win rate, so
// every threshold moved down to trade some win-rate for materially higher coverage.
const OU_POISSON = { alpha: 0.15, threshOver: 0.58, threshUnder: 0.65, minMatches: 3 };
const OU_ELO = { K: 0.15, threshOver: 0.61, threshUnder: 0.70, minMatches: 3 };
const H2H_POISSON = { alpha: 0.3, threshold: 0.525, minMatches: 3 };
const H2H_ELO = { K: 12, threshold: 0.615, minMatches: 3, initRating: 1500 };

function sigmoid(x) {
    return 1 / (1 + Math.exp(-x));
}

function poissonPMF(k, lambda) {
    if (lambda <= 0) return k === 0 ? 1 : 0;
    let p = Math.exp(-lambda);
    for (let i = 1; i <= k; i++) p *= lambda / i;
    return p;
}

function poissonCDF(k, lambda) {
    let sum = 0;
    for (let i = 0; i <= k; i++) sum += poissonPMF(i, lambda);
    return sum;
}

function jointWinProb(lambdaHome, lambdaAway, N = 30) {
    let pHome = 0, pAway = 0, pDraw = 0;
    for (let h = 0; h <= N; h++) {
        const ph = poissonPMF(h, lambdaHome);
        for (let a = 0; a <= N; a++) {
            const pa = poissonPMF(a, lambdaAway) * ph;
            if (h > a) pHome += pa;
            else if (h < a) pAway += pa;
            else pDraw += pa;
        }
    }
    return { pHome, pAway, pDraw };
}

function summarize(bets, wins, totalMatches) {
    const wr = bets > 0 ? (wins / bets) * 100 : 0;
    const profit = bets * STAKE * (wr / 100 * PAYOUT - 1);
    const cov = totalMatches > 0 ? (bets / totalMatches) * 100 : 0;
    return { bets, wins, wr, profit, cov };
}

// Same 4am/16:00 AEST rotation window analyzer.js uses to scope upcoming matches —
// duplicated here (rather than imported) since analyzer.js doesn't export it as a
// standalone helper; used to tally a second, rotation-only performance figure
// alongside the all-time one, from the same forward pass.
function getCurrentRotationBounds() {
    const now = new Date();
    const aest = new Date(now.getTime() + 10 * 60 * 60 * 1000);
    const hour = aest.getUTCHours();
    const startAEST = new Date(aest);
    const endAEST = new Date(aest);
    startAEST.setUTCMinutes(0, 0, 0);
    endAEST.setUTCMinutes(0, 0, 0);
    if (hour >= 4 && hour < 16) {
        startAEST.setUTCHours(4);
        endAEST.setUTCHours(16);
    } else if (hour >= 16) {
        startAEST.setUTCHours(16);
        endAEST.setUTCHours(4);
        endAEST.setUTCDate(endAEST.getUTCDate() + 1);
    } else {
        startAEST.setUTCHours(16);
        startAEST.setUTCDate(startAEST.getUTCDate() - 1);
        endAEST.setUTCHours(4);
    }
    return { startAEST, endAEST };
}

function isInRotation(startDate, bounds) {
    const matchAEST = new Date(new Date(startDate).getTime() + 10 * 60 * 60 * 1000);
    return matchAEST >= bounds.startAEST && matchAEST < bounds.endAEST;
}

function loadHistoricalMatches() {
    let raw;
    try {
        raw = fs.readFileSync('historical_fifa.json', 'utf8');
    } catch (e) {
        return [];
    }
    let data;
    try {
        data = JSON.parse(raw);
    } catch (e) {
        return [];
    }
    const matches = data.matches || data;
    if (!Array.isArray(matches)) return [];
    return matches
        .filter(m => m.matchStatus === 'MATCH_ENDED' && !m.isCancelled && typeof m.teamAScore === 'number' && typeof m.teamBScore === 'number')
        .sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
}

// Each build*State function walks the full historical window once: for every match
// it predicts using state built from strictly-earlier matches (no lookahead), tallies
// that prediction against the actual result, then folds the result into state. The
// final `state` is what upcoming (not-yet-played) matches get predicted against.

function buildOUPoissonState(matches, params, rotationBounds) {
    const { alpha, threshOver, threshUnder, minMatches } = params;
    const playerState = {};
    const h2hState = {};
    const rotationPairStats = {};
    let bets = 0, wins = 0;
    let rotationBets = 0, rotationWins = 0, rotationMatchCount = 0;
    let rotationOverBets = 0, rotationOverWins = 0, rotationUnderBets = 0, rotationUnderWins = 0;

    matches.forEach(m => {
        const inRotation = isInRotation(m.startDate, rotationBounds);
        if (inRotation) rotationMatchCount++;
        const home = m.participantAName, away = m.participantBName;
        if (!playerState[home]) playerState[home] = { scored: null, conceded: null, matches: 0 };
        if (!playerState[away]) playerState[away] = { scored: null, conceded: null, matches: 0 };
        const sHome = playerState[home], sAway = playerState[away];

        const pairKey = [home, away].sort().join(' vs ');
        if (!h2hState[pairKey]) h2hState[pairKey] = { matches: 0, totalGoals: 0 };
        const h2h = h2hState[pairKey];

        const totalG = m.teamAScore + m.teamBScore;
        if (sHome.matches >= minMatches && sAway.matches >= minMatches) {
            let lambdaTotal = (sHome.scored + sAway.conceded) / 2 + (sAway.scored + sHome.conceded) / 2;
            if (h2h.matches > 0) {
                const h2hAvg = h2h.totalGoals / h2h.matches;
                const w = Math.min(h2h.matches * 0.15, 0.40);
                lambdaTotal = (1 - w) * lambdaTotal + w * h2hAvg;
            }
            lambdaTotal = Math.max(lambdaTotal, 0.05);
            const pUnder = poissonCDF(2, lambdaTotal);
            const pOver = 1 - pUnder;
            let pick = null;
            if (pOver >= threshOver) pick = 'OVER';
            else if (pUnder >= threshUnder) pick = 'UNDER';
            if (pick) {
                bets++;
                const won = (pick === 'OVER' && totalG > 2.5) || (pick === 'UNDER' && totalG < 2.5);
                if (won) wins++;
                if (inRotation) {
                    rotationBets++;
                    if (won) rotationWins++;
                    if (pick === 'OVER') { rotationOverBets++; if (won) rotationOverWins++; }
                    else { rotationUnderBets++; if (won) rotationUnderWins++; }
                    if (!rotationPairStats[pairKey]) rotationPairStats[pairKey] = { bets: 0, wins: 0 };
                    rotationPairStats[pairKey].bets++;
                    if (won) rotationPairStats[pairKey].wins++;
                }
            }
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

    return {
        state: { playerState, h2hState },
        performance: summarize(bets, wins, matches.length),
        rotationPerformance: summarize(rotationBets, rotationWins, rotationMatchCount),
        rotationOverPerformance: summarize(rotationOverBets, rotationOverWins, rotationMatchCount),
        rotationUnderPerformance: summarize(rotationUnderBets, rotationUnderWins, rotationMatchCount),
        rotationPairStats
    };
}

function predictOUPoisson(state, home, away, params = OU_POISSON) {
    const { threshOver, threshUnder, minMatches } = params;
    const sHome = state.playerState[home], sAway = state.playerState[away];
    if (!sHome || !sAway || sHome.matches < minMatches || sAway.matches < minMatches) return null;

    const lambdaHome = (sHome.scored + sAway.conceded) / 2;
    const lambdaAway = (sAway.scored + sHome.conceded) / 2;
    let lambdaTotal = lambdaHome + lambdaAway;

    const pairKey = [home, away].sort().join(' vs ');
    const h2h = state.h2hState[pairKey];
    if (h2h && h2h.matches > 0) {
        const h2hAvg = h2h.totalGoals / h2h.matches;
        const w = Math.min(h2h.matches * 0.15, 0.40);
        lambdaTotal = (1 - w) * lambdaTotal + w * h2hAvg;
    }
    lambdaTotal = Math.max(lambdaTotal, 0.05);

    const pUnder = poissonCDF(2, lambdaTotal);
    const pOver = 1 - pUnder;
    if (pOver >= threshOver) return { pick: 'OVER', prob: pOver * 100 };
    if (pUnder >= threshUnder) return { pick: 'UNDER', prob: pUnder * 100 };
    return null;
}

function buildOUEloState(matches, params, rotationBounds) {
    const { K, threshOver, threshUnder, minMatches } = params;
    const rating = {};
    const matchCount = {};
    const rotationPairStats = {};
    let bets = 0, wins = 0;
    let rotationBets = 0, rotationWins = 0, rotationMatchCount = 0;
    let rotationOverBets = 0, rotationOverWins = 0, rotationUnderBets = 0, rotationUnderWins = 0;

    matches.forEach(m => {
        const inRotation = isInRotation(m.startDate, rotationBounds);
        if (inRotation) rotationMatchCount++;
        const home = m.participantAName, away = m.participantBName;
        if (rating[home] === undefined) { rating[home] = 0; matchCount[home] = 0; }
        if (rating[away] === undefined) { rating[away] = 0; matchCount[away] = 0; }
        const pairKey = [home, away].sort().join(' vs ');

        const predictedP = sigmoid(rating[home] + rating[away]);
        const totalG = m.teamAScore + m.teamBScore;
        const actualOver = totalG > 2.5 ? 1 : 0;

        if (matchCount[home] >= minMatches && matchCount[away] >= minMatches) {
            let pick = null;
            if (predictedP >= threshOver) pick = 'OVER';
            else if ((1 - predictedP) >= threshUnder) pick = 'UNDER';
            if (pick) {
                bets++;
                const won = (pick === 'OVER' && actualOver === 1) || (pick === 'UNDER' && actualOver === 0);
                if (won) wins++;
                if (inRotation) {
                    rotationBets++;
                    if (won) rotationWins++;
                    if (pick === 'OVER') { rotationOverBets++; if (won) rotationOverWins++; }
                    else { rotationUnderBets++; if (won) rotationUnderWins++; }
                    if (!rotationPairStats[pairKey]) rotationPairStats[pairKey] = { bets: 0, wins: 0 };
                    rotationPairStats[pairKey].bets++;
                    if (won) rotationPairStats[pairKey].wins++;
                }
            }
        }

        const delta = K * (actualOver - predictedP);
        rating[home] += delta;
        rating[away] += delta;
        matchCount[home]++;
        matchCount[away]++;
    });

    return {
        state: { rating, matchCount },
        performance: summarize(bets, wins, matches.length),
        rotationPerformance: summarize(rotationBets, rotationWins, rotationMatchCount),
        rotationOverPerformance: summarize(rotationOverBets, rotationOverWins, rotationMatchCount),
        rotationUnderPerformance: summarize(rotationUnderBets, rotationUnderWins, rotationMatchCount),
        rotationPairStats
    };
}

function predictOUElo(state, home, away, params = OU_ELO) {
    const { threshOver, threshUnder, minMatches } = params;
    if (state.matchCount[home] === undefined || state.matchCount[away] === undefined) return null;
    if (state.matchCount[home] < minMatches || state.matchCount[away] < minMatches) return null;

    const predictedP = sigmoid(state.rating[home] + state.rating[away]);
    if (predictedP >= threshOver) return { pick: 'OVER', prob: predictedP * 100 };
    if ((1 - predictedP) >= threshUnder) return { pick: 'UNDER', prob: (1 - predictedP) * 100 };
    return null;
}

function buildH2HPoissonState(matches, params, rotationBounds) {
    const { alpha, threshold, minMatches } = params;
    const playerState = {};
    const h2hState = {};
    const rotationPairStats = {};
    let bets = 0, wins = 0;
    let rotationBets = 0, rotationWins = 0, rotationMatchCount = 0;

    matches.forEach(m => {
        const inRotation = isInRotation(m.startDate, rotationBounds);
        if (inRotation) rotationMatchCount++;
        const home = m.participantAName, away = m.participantBName;
        if (!playerState[home]) playerState[home] = { scored: null, conceded: null, matches: 0 };
        if (!playerState[away]) playerState[away] = { scored: null, conceded: null, matches: 0 };
        const sHome = playerState[home], sAway = playerState[away];

        const pairKey = [home, away].sort().join(' vs ');
        if (!h2hState[pairKey]) h2hState[pairKey] = { matches: 0, goalsFor: {} };
        const h2h = h2hState[pairKey];

        if (sHome.matches >= minMatches && sAway.matches >= minMatches) {
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
            let pick = null;
            if (pHome >= threshold) pick = home;
            else if (pAway >= threshold) pick = away;

            if (pick && m.teamAScore !== m.teamBScore) {
                bets++;
                const won = (pick === home && m.teamAScore > m.teamBScore) || (pick === away && m.teamBScore > m.teamAScore);
                if (won) wins++;
                if (inRotation) {
                    rotationBets++;
                    if (won) rotationWins++;
                    if (!rotationPairStats[pairKey]) rotationPairStats[pairKey] = { bets: 0, wins: 0 };
                    rotationPairStats[pairKey].bets++;
                    if (won) rotationPairStats[pairKey].wins++;
                }
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

    return {
        state: { playerState, h2hState },
        performance: summarize(bets, wins, matches.length),
        rotationPerformance: summarize(rotationBets, rotationWins, rotationMatchCount),
        rotationPairStats
    };
}

function predictH2HPoisson(state, home, away, params = H2H_POISSON) {
    const { threshold, minMatches } = params;
    const sHome = state.playerState[home], sAway = state.playerState[away];
    if (!sHome || !sAway || sHome.matches < minMatches || sAway.matches < minMatches) return null;

    let lambdaHome = (sHome.scored + sAway.conceded) / 2;
    let lambdaAway = (sAway.scored + sHome.conceded) / 2;

    const pairKey = [home, away].sort().join(' vs ');
    const h2h = state.h2hState[pairKey];
    if (h2h && h2h.matches > 0) {
        const w = Math.min(h2h.matches * 0.15, 0.40);
        const h2hHomeAvg = (h2h.goalsFor[home] || 0) / h2h.matches;
        const h2hAwayAvg = (h2h.goalsFor[away] || 0) / h2h.matches;
        lambdaHome = (1 - w) * lambdaHome + w * h2hHomeAvg;
        lambdaAway = (1 - w) * lambdaAway + w * h2hAwayAvg;
    }
    lambdaHome = Math.max(lambdaHome, 0.05);
    lambdaAway = Math.max(lambdaAway, 0.05);

    const { pHome, pAway } = jointWinProb(lambdaHome, lambdaAway);
    if (pHome >= threshold) return { pick: home, prob: pHome * 100 };
    if (pAway >= threshold) return { pick: away, prob: pAway * 100 };
    return null;
}

function buildH2HEloState(matches, params, rotationBounds) {
    const { K, threshold, minMatches, initRating } = params;
    const rating = {};
    const matchCount = {};
    const rotationPairStats = {};
    let bets = 0, wins = 0;
    let rotationBets = 0, rotationWins = 0, rotationMatchCount = 0;

    matches.forEach(m => {
        const inRotation = isInRotation(m.startDate, rotationBounds);
        if (inRotation) rotationMatchCount++;
        const home = m.participantAName, away = m.participantBName;
        if (rating[home] === undefined) { rating[home] = initRating; matchCount[home] = 0; }
        if (rating[away] === undefined) { rating[away] = initRating; matchCount[away] = 0; }
        const pairKey = [home, away].sort().join(' vs ');

        const pHome = 1 / (1 + Math.pow(10, (rating[away] - rating[home]) / 400));

        if (matchCount[home] >= minMatches && matchCount[away] >= minMatches) {
            let pick = null;
            if (pHome >= threshold) pick = home;
            else if ((1 - pHome) >= threshold) pick = away;

            if (pick && m.teamAScore !== m.teamBScore) {
                bets++;
                const won = (pick === home && m.teamAScore > m.teamBScore) || (pick === away && m.teamBScore > m.teamAScore);
                if (won) wins++;
                if (inRotation) {
                    rotationBets++;
                    if (won) rotationWins++;
                    if (!rotationPairStats[pairKey]) rotationPairStats[pairKey] = { bets: 0, wins: 0 };
                    rotationPairStats[pairKey].bets++;
                    if (won) rotationPairStats[pairKey].wins++;
                }
            }
        }

        const sHome = m.teamAScore > m.teamBScore ? 1 : m.teamAScore === m.teamBScore ? 0.5 : 0;
        rating[home] += K * (sHome - pHome);
        rating[away] += K * ((1 - sHome) - (1 - pHome));
        matchCount[home]++;
        matchCount[away]++;
    });

    return {
        state: { rating, matchCount },
        performance: summarize(bets, wins, matches.length),
        rotationPerformance: summarize(rotationBets, rotationWins, rotationMatchCount),
        rotationPairStats
    };
}

function predictH2HElo(state, home, away, params = H2H_ELO) {
    const { threshold, minMatches } = params;
    if (state.matchCount[home] === undefined || state.matchCount[away] === undefined) return null;
    if (state.matchCount[home] < minMatches || state.matchCount[away] < minMatches) return null;

    const pHome = 1 / (1 + Math.pow(10, (state.rating[away] - state.rating[home]) / 400));
    if (pHome >= threshold) return { pick: home, prob: pHome * 100 };
    if ((1 - pHome) >= threshold) return { pick: away, prob: (1 - pHome) * 100 };
    return null;
}

// Mutates each match in `upcomingMatches` with the 4 models' picks/probabilities, and
// returns each model's live bets/wins/win-rate/profit tallied over the same historical
// window used to build its state (fresh every call — see file header).
function computeExtraPredictions(upcomingMatches) {
    const historical = loadHistoricalMatches();
    if (historical.length === 0) return null;

    const rotationBounds = getCurrentRotationBounds();
    const ouPoisson = buildOUPoissonState(historical, OU_POISSON, rotationBounds);
    const ouElo = buildOUEloState(historical, OU_ELO, rotationBounds);
    const h2hPoisson = buildH2HPoissonState(historical, H2H_POISSON, rotationBounds);
    const h2hElo = buildH2HEloState(historical, H2H_ELO, rotationBounds);

    const attachPairAcc = (m, prefix, pairStats) => {
        const pairKey = [m.participantAName, m.participantBName].sort().join(' vs ');
        const stat = pairStats[pairKey];
        if (stat && stat.bets > 0) {
            m[`${prefix}PairAcc`] = (stat.wins / stat.bets) * 100;
            m[`${prefix}PairBets`] = stat.bets;
            m[`${prefix}PairCorrect`] = stat.wins;
        }
    };

    upcomingMatches.forEach(m => {
        const home = m.participantAName, away = m.participantBName;

        const p1 = predictOUPoisson(ouPoisson.state, home, away);
        m.ouPoissonPick = p1 ? p1.pick : null;
        m.ouPoissonProb = p1 ? p1.prob : null;

        const p2 = predictOUElo(ouElo.state, home, away);
        m.ouEloPick = p2 ? p2.pick : null;
        m.ouEloProb = p2 ? p2.prob : null;

        const p3 = predictH2HPoisson(h2hPoisson.state, home, away);
        m.h2hPoissonPick = p3 ? p3.pick : null;
        m.h2hPoissonProb = p3 ? p3.prob : null;

        const p4 = predictH2HElo(h2hElo.state, home, away);
        m.h2hEloPick = p4 ? p4.pick : null;
        m.h2hEloProb = p4 ? p4.prob : null;

        attachPairAcc(m, 'ouPoisson', ouPoisson.rotationPairStats);
        attachPairAcc(m, 'ouElo', ouElo.rotationPairStats);
        attachPairAcc(m, 'h2hPoisson', h2hPoisson.rotationPairStats);
        attachPairAcc(m, 'h2hElo', h2hElo.rotationPairStats);
    });

    return {
        ouPoisson: ouPoisson.performance,
        ouElo: ouElo.performance,
        h2hPoisson: h2hPoisson.performance,
        h2hElo: h2hElo.performance,
        rotation: {
            ouPoisson: { ...ouPoisson.rotationPerformance, over: ouPoisson.rotationOverPerformance, under: ouPoisson.rotationUnderPerformance },
            ouElo: { ...ouElo.rotationPerformance, over: ouElo.rotationOverPerformance, under: ouElo.rotationUnderPerformance },
            h2hPoisson: h2hPoisson.rotationPerformance,
            h2hElo: h2hElo.rotationPerformance
        }
    };
}

module.exports = { computeExtraPredictions };
