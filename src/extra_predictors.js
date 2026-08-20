// Additional, independent prediction signals for the dashboard prediction card:
// a Poisson goal model and an Elo-style online classifier, for both OU (2.5 goals)
// and H2H (winner) markets. Validated in model_lab/ against production on a 45-day
// backtest (see plan notes) — hyperparameters below are the winning configs found
// there. State is rebuilt from historical_fifa.json via one forward pass every call
// (no persisted rating file), matching how the rest of the pipeline always recomputes
// stats from scratch each tick. That same forward pass also tallies each model's
// live bets/wins/profit against its own historical picks (predict-before-update, so
// it's the identical walk-forward, zero-lookahead check used in model_lab), giving a
// running $5-stake performance figure that refreshes every tick.
//
// Dynamic Odds: Payouts are no longer flat 1.6x — they adjust per-pair based on
// consecutive same-side results (OU streaks for Over/Under, H2H winner streaks).
// See src/dynamic_odds.js for the tiered odds table.
const fs = require('fs');
const { OUDynamicOddsTracker, H2HDynamicOddsTracker, OU_BASELINE_ODDS, H2H_BASELINE_ODDS } = require('./dynamic_odds');

const STAKE = 5;
const PAYOUT = OU_BASELINE_ODDS; // Default payout for global summarize(); per-bet payout uses dynamic odds

// Reverted to the 1.6x payout (was 1.7x) and originally re-tuned with a hard
// >=20% coverage floor per model — see tmp_backtest/grid_payout16_cov15.js.
//
// OU_POISSON's own goal model was later replaced by a hard-window (last-N simple
// moving average) rolling estimate with a direct threshold on expected total
// goals, instead of exponential decay + Poisson-CDF probability — found to be a
// more temporally stable edge in tmp_backtest/tune_window_model.js (robustness
// selection: >=20% coverage on full/first-half/second-half, maximize the worse
// of the two halves' profit: full=$375, firsthalf=$206, secondhalf=$195, all
// ~22-23% cov, vs. the old Poisson model's secondhalf=$19). A rotation-isolated
// variant (resetting the window at every 12h AEST rotation boundary instead of
// carrying it across all history) was also tested and is clearly worse — see
// tmp_backtest/tune_window_rotation_isolated.js — so state stays continuous.
// The `OU_POISSON` name and its `ouPoisson*` output fields are kept as-is for
// compatibility with the dashboard/pipeline code that reads them.
//
// All four models were then re-tuned a second time with the >=20% coverage
// floor DROPPED, optimizing instead for mean PROFIT PER 12h AEST ROTATION
// (bucket-based, edge buckets excluded) — see tmp_backtest/tune_per_rotation_profit.js.
// Rotation-isolated state (resetting each model at every rotation boundary) was
// tested for this objective too and lost robustly in both the OU and H2H
// markets — see tmp_backtest/tune_rotation_isolated_v2.js and
// tmp_backtest/tune_h2h_rotation_isolated.js — so state stays continuous
// everywhere. Every winning config below was cross-checked against a widened
// parameter grid to rule out edge-of-grid drift before being applied.
// OU_POISSON was already sitting at its own optimum for this objective (no
// change). The other three moved to fewer, higher-conviction bets:
//   OU_ELO:       full=$7.55/rotation (was $4.57), firsthalf=$9.23 (was $5.39),
//                 secondhalf=$6.40 (was $0.63); coverage ~fewer bets, mostly
//                 confident calls near the extremes of the sigmoid.
//   H2H_POISSON:  full=$8.00/rotation (was $5.87), firsthalf=$6.23 (was $1.39),
//                 secondhalf=$9.27 (was $4.33); coverage drops from ~20% to ~13%.
//   H2H_ELO:      full=$9.60/rotation (was $3.85), firsthalf=$5.87 (was $1.94),
//                 secondhalf=$6.57 (was $3.17); coverage drops from ~17% to ~6.4%
//                 (733 bets full-set) — fewest bets of the four models now, but
//                 the highest per-rotation mean and fewest losing rotations
//                 (12/62, vs. its prior config's higher bet volume).
// --- DEFAULT (fallback) parameters — overridden at runtime by dynamicTuneParams() ---
const DEFAULT_OU_POISSON = { windowN: 20, threshOver: 3.9, threshUnder: 2.1, minMatches: 3 };
const DEFAULT_OU_ELO = { K: 0.03, threshOver: 0.59, threshUnder: 0.56, minMatches: 3 };
const DEFAULT_H2H_POISSON = { alpha: 0.5, threshold: 0.50, minMatches: 3 };
const DEFAULT_H2H_ELO = { K: 25, threshold: 0.61, minMatches: 3, initRating: 1500 };

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

function windowAvg(arr) {
    return arr.reduce((a, x) => a + x, 0) / arr.length;
}

function windowedLambda(sHome, sAway) {
    return (windowAvg(sHome.scored) + windowAvg(sAway.conceded)) / 2 +
        (windowAvg(sAway.scored) + windowAvg(sHome.conceded)) / 2;
}

function buildOUPoissonState(matches, params, rotationBounds) {
    const { windowN, threshOver, threshUnder, minMatches } = params;
    const playerState = {};
    const h2hState = {};
    const rotationPairStats = {};
    const ouOddsTracker = new OUDynamicOddsTracker();
    let bets = 0, wins = 0, totalProfit = 0;
    let rotationBets = 0, rotationWins = 0, rotationMatchCount = 0, rotationProfit = 0;
    let rotationOverBets = 0, rotationOverWins = 0, rotationOverProfit = 0;
    let rotationUnderBets = 0, rotationUnderWins = 0, rotationUnderProfit = 0;

    matches.forEach(m => {
        const inRotation = isInRotation(m.startDate, rotationBounds);
        if (inRotation) rotationMatchCount++;
        const home = m.participantAName, away = m.participantBName;
        if (!playerState[home]) playerState[home] = { scored: [], conceded: [] };
        if (!playerState[away]) playerState[away] = { scored: [], conceded: [] };
        const sHome = playerState[home], sAway = playerState[away];

        const pairKey = [home, away].sort().join(' vs ');
        if (!h2hState[pairKey]) h2hState[pairKey] = { matches: 0, totalG: 0 };
        const h2h = h2hState[pairKey];

        const totalG = m.teamAScore + m.teamBScore;
        const actualOU = totalG > 2.5 ? 'OVER' : 'UNDER';

        if (sHome.scored.length >= minMatches && sAway.scored.length >= minMatches) {
            let lambdaTotal = windowedLambda(sHome, sAway);
            if (h2h.matches > 0) {
                const w = Math.min(h2h.matches * 0.15, 0.40);
                const h2hAvgTotal = h2h.totalG / h2h.matches;
                lambdaTotal = (1 - w) * lambdaTotal + w * h2hAvgTotal;
            }
            let pick = null;
            if (lambdaTotal >= threshOver) pick = 'OVER';
            else if (lambdaTotal <= threshUnder) pick = 'UNDER';
            if (pick) {
                // Get dynamic odds for this pair BEFORE recording result
                const { overOdds, underOdds } = ouOddsTracker.getOdds(pairKey);
                const payout = pick === 'OVER' ? overOdds : underOdds;
                bets++;
                const won = (pick === 'OVER' && totalG > 2.5) || (pick === 'UNDER' && totalG < 2.5);
                if (won) { wins++; totalProfit += STAKE * (payout - 1); }
                else { totalProfit -= STAKE; }
                if (inRotation) {
                    rotationBets++;
                    if (won) { rotationWins++; rotationProfit += STAKE * (payout - 1); }
                    else { rotationProfit -= STAKE; }
                    if (pick === 'OVER') {
                        rotationOverBets++;
                        if (won) { rotationOverWins++; rotationOverProfit += STAKE * (payout - 1); }
                        else { rotationOverProfit -= STAKE; }
                    } else {
                        rotationUnderBets++;
                        if (won) { rotationUnderWins++; rotationUnderProfit += STAKE * (payout - 1); }
                        else { rotationUnderProfit -= STAKE; }
                    }
                    if (!rotationPairStats[pairKey]) rotationPairStats[pairKey] = { bets: 0, wins: 0 };
                    rotationPairStats[pairKey].bets++;
                    if (won) rotationPairStats[pairKey].wins++;
                }
            }
        }

        // Record OU result to update streak AFTER prediction
        ouOddsTracker.recordResult(pairKey, actualOU);

        h2h.totalG += totalG;
        h2h.matches++;

        sHome.scored.push(m.teamAScore); sHome.conceded.push(m.teamBScore);
        sAway.scored.push(m.teamBScore); sAway.conceded.push(m.teamAScore);
        if (sHome.scored.length > windowN) { sHome.scored.shift(); sHome.conceded.shift(); }
        if (sAway.scored.length > windowN) { sAway.scored.shift(); sAway.conceded.shift(); }
    });

    const wr = bets > 0 ? (wins / bets) * 100 : 0;
    const rotWr = rotationBets > 0 ? (rotationWins / rotationBets) * 100 : 0;
    const rotOverWr = rotationOverBets > 0 ? (rotationOverWins / rotationOverBets) * 100 : 0;
    const rotUnderWr = rotationUnderBets > 0 ? (rotationUnderWins / rotationUnderBets) * 100 : 0;

    return {
        state: { playerState, h2hState, ouOddsTracker },
        performance: { bets, wins, wr, profit: totalProfit, cov: matches.length > 0 ? (bets / matches.length) * 100 : 0 },
        rotationPerformance: { bets: rotationBets, wins: rotationWins, wr: rotWr, profit: rotationProfit, cov: rotationMatchCount > 0 ? (rotationBets / rotationMatchCount) * 100 : 0 },
        rotationOverPerformance: { bets: rotationOverBets, wins: rotationOverWins, wr: rotOverWr, profit: rotationOverProfit, cov: rotationMatchCount > 0 ? (rotationOverBets / rotationMatchCount) * 100 : 0 },
        rotationUnderPerformance: { bets: rotationUnderBets, wins: rotationUnderWins, wr: rotUnderWr, profit: rotationUnderProfit, cov: rotationMatchCount > 0 ? (rotationUnderBets / rotationMatchCount) * 100 : 0 },
        rotationPairStats
    };
}

// `prob` is informational only (drives the dashboard's confidence display) —
// the pick itself is decided purely by thresholding the windowed mean above,
// not by this figure. Poisson CDF is a reasonable way to turn a mean expected
// goal count into a display percentage regardless of how that mean was estimated.
function predictOUPoisson(state, home, away, params = DEFAULT_OU_POISSON) {
    const { threshOver, threshUnder, minMatches } = params;
    const sHome = state.playerState[home], sAway = state.playerState[away];
    if (!sHome || !sAway || sHome.scored.length < minMatches || sAway.scored.length < minMatches) return null;

    const pairKey = [home, away].sort().join(' vs ');
    const { overOdds, underOdds } = state.ouOddsTracker ? state.ouOddsTracker.getOdds(pairKey) : { overOdds: OU_BASELINE_ODDS, underOdds: OU_BASELINE_ODDS };

    let lambdaTotal = windowedLambda(sHome, sAway);
    if (state.h2hState) {
        const h2h = state.h2hState[pairKey];
        if (h2h && h2h.matches > 0) {
            const w = Math.min(h2h.matches * 0.15, 0.40);
            const h2hAvgTotal = h2h.totalG / h2h.matches;
            lambdaTotal = (1 - w) * lambdaTotal + w * h2hAvgTotal;
        }
    }

    if (lambdaTotal >= threshOver) return { pick: 'OVER', prob: (1 - poissonCDF(2, lambdaTotal)) * 100, overOdds, underOdds };
    if (lambdaTotal <= threshUnder) return { pick: 'UNDER', prob: poissonCDF(2, lambdaTotal) * 100, overOdds, underOdds };
    return null;
}

function buildOUEloState(matches, params, rotationBounds) {
    const { K, threshOver, threshUnder, minMatches } = params;
    const rating = {};
    const matchCount = {};
    const rotationPairStats = {};
    const ouOddsTracker = new OUDynamicOddsTracker();
    let bets = 0, wins = 0, totalProfit = 0;
    let rotationBets = 0, rotationWins = 0, rotationMatchCount = 0, rotationProfit = 0;
    let rotationOverBets = 0, rotationOverWins = 0, rotationOverProfit = 0;
    let rotationUnderBets = 0, rotationUnderWins = 0, rotationUnderProfit = 0;

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
        const actualOU = actualOver ? 'OVER' : 'UNDER';

        if (matchCount[home] >= minMatches && matchCount[away] >= minMatches) {
            let pick = null;
            if (predictedP >= threshOver) pick = 'OVER';
            else if ((1 - predictedP) >= threshUnder) pick = 'UNDER';
            if (pick) {
                const { overOdds, underOdds } = ouOddsTracker.getOdds(pairKey);
                const payout = pick === 'OVER' ? overOdds : underOdds;
                bets++;
                const won = (pick === 'OVER' && actualOver === 1) || (pick === 'UNDER' && actualOver === 0);
                if (won) { wins++; totalProfit += STAKE * (payout - 1); }
                else { totalProfit -= STAKE; }
                if (inRotation) {
                    rotationBets++;
                    if (won) { rotationWins++; rotationProfit += STAKE * (payout - 1); }
                    else { rotationProfit -= STAKE; }
                    if (pick === 'OVER') {
                        rotationOverBets++;
                        if (won) { rotationOverWins++; rotationOverProfit += STAKE * (payout - 1); }
                        else { rotationOverProfit -= STAKE; }
                    } else {
                        rotationUnderBets++;
                        if (won) { rotationUnderWins++; rotationUnderProfit += STAKE * (payout - 1); }
                        else { rotationUnderProfit -= STAKE; }
                    }
                    if (!rotationPairStats[pairKey]) rotationPairStats[pairKey] = { bets: 0, wins: 0 };
                    rotationPairStats[pairKey].bets++;
                    if (won) rotationPairStats[pairKey].wins++;
                }
            }
        }

        // Record OU result to update streak AFTER prediction
        ouOddsTracker.recordResult(pairKey, actualOU);

        const delta = K * (actualOver - predictedP);
        rating[home] += delta;
        rating[away] += delta;
        matchCount[home]++;
        matchCount[away]++;
    });

    const wr = bets > 0 ? (wins / bets) * 100 : 0;
    const rotWr = rotationBets > 0 ? (rotationWins / rotationBets) * 100 : 0;
    const rotOverWr = rotationOverBets > 0 ? (rotationOverWins / rotationOverBets) * 100 : 0;
    const rotUnderWr = rotationUnderBets > 0 ? (rotationUnderWins / rotationUnderBets) * 100 : 0;

    return {
        state: { rating, matchCount, ouOddsTracker },
        performance: { bets, wins, wr, profit: totalProfit, cov: matches.length > 0 ? (bets / matches.length) * 100 : 0 },
        rotationPerformance: { bets: rotationBets, wins: rotationWins, wr: rotWr, profit: rotationProfit, cov: rotationMatchCount > 0 ? (rotationBets / rotationMatchCount) * 100 : 0 },
        rotationOverPerformance: { bets: rotationOverBets, wins: rotationOverWins, wr: rotOverWr, profit: rotationOverProfit, cov: rotationMatchCount > 0 ? (rotationOverBets / rotationMatchCount) * 100 : 0 },
        rotationUnderPerformance: { bets: rotationUnderBets, wins: rotationUnderWins, wr: rotUnderWr, profit: rotationUnderProfit, cov: rotationMatchCount > 0 ? (rotationUnderBets / rotationMatchCount) * 100 : 0 },
        rotationPairStats
    };
}

function predictOUElo(state, home, away, params = DEFAULT_OU_ELO) {
    const { threshOver, threshUnder, minMatches } = params;
    if (state.matchCount[home] === undefined || state.matchCount[away] === undefined) return null;
    if (state.matchCount[home] < minMatches || state.matchCount[away] < minMatches) return null;

    const pairKey = [home, away].sort().join(' vs ');
    const { overOdds, underOdds } = state.ouOddsTracker ? state.ouOddsTracker.getOdds(pairKey) : { overOdds: BASELINE_ODDS, underOdds: BASELINE_ODDS };

    const predictedP = sigmoid(state.rating[home] + state.rating[away]);
    if (predictedP >= threshOver) return { pick: 'OVER', prob: predictedP * 100, overOdds, underOdds };
    if ((1 - predictedP) >= threshUnder) return { pick: 'UNDER', prob: (1 - predictedP) * 100, overOdds, underOdds };
    return null;
}

function buildH2HPoissonState(matches, params, rotationBounds) {
    const { alpha, threshold, minMatches } = params;
    const playerState = {};
    const h2hState = {};
    const rotationPairStats = {};
    const h2hOddsTracker = new H2HDynamicOddsTracker();
    let bets = 0, wins = 0, totalProfit = 0;
    let rotationBets = 0, rotationWins = 0, rotationMatchCount = 0, rotationProfit = 0;

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

        // Determine actual winner for streak tracking
        let actualWinner = null;
        if (m.teamAScore > m.teamBScore) actualWinner = home;
        else if (m.teamBScore > m.teamAScore) actualWinner = away;

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
                // Get dynamic odds BEFORE recording result
                const { homeOdds, awayOdds } = h2hOddsTracker.getOdds(pairKey, home, away);
                const payout = pick === home ? homeOdds : awayOdds;
                bets++;
                const won = (pick === home && m.teamAScore > m.teamBScore) || (pick === away && m.teamBScore > m.teamAScore);
                if (won) { wins++; totalProfit += STAKE * (payout - 1); }
                else { totalProfit -= STAKE; }
                if (inRotation) {
                    rotationBets++;
                    if (won) { rotationWins++; rotationProfit += STAKE * (payout - 1); }
                    else { rotationProfit -= STAKE; }
                    if (!rotationPairStats[pairKey]) rotationPairStats[pairKey] = { bets: 0, wins: 0 };
                    rotationPairStats[pairKey].bets++;
                    if (won) rotationPairStats[pairKey].wins++;
                }
            }
        }

        // Record winner to update H2H streak AFTER prediction (draws ignored)
        h2hOddsTracker.recordResult(pairKey, actualWinner);

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
    const rotWr = rotationBets > 0 ? (rotationWins / rotationBets) * 100 : 0;

    return {
        state: { playerState, h2hState, h2hOddsTracker },
        performance: { bets, wins, wr, profit: totalProfit, cov: matches.length > 0 ? (bets / matches.length) * 100 : 0 },
        rotationPerformance: { bets: rotationBets, wins: rotationWins, wr: rotWr, profit: rotationProfit, cov: rotationMatchCount > 0 ? (rotationBets / rotationMatchCount) * 100 : 0 },
        rotationPairStats
    };
}

function predictH2HPoisson(state, home, away, params = DEFAULT_H2H_POISSON) {
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

    const { homeOdds, awayOdds } = state.h2hOddsTracker ? state.h2hOddsTracker.getOdds(pairKey, home, away) : { homeOdds: BASELINE_ODDS, awayOdds: BASELINE_ODDS };

    const { pHome, pAway } = jointWinProb(lambdaHome, lambdaAway);
    if (pHome >= threshold) return { pick: home, prob: pHome * 100, homeOdds, awayOdds };
    if (pAway >= threshold) return { pick: away, prob: pAway * 100, homeOdds, awayOdds };
    return null;
}

function buildH2HEloState(matches, params, rotationBounds) {
    const { K, threshold, minMatches, initRating } = params;
    const rating = {};
    const matchCount = {};
    const rotationPairStats = {};
    const h2hOddsTracker = new H2HDynamicOddsTracker();
    let bets = 0, wins = 0, totalProfit = 0;
    let rotationBets = 0, rotationWins = 0, rotationMatchCount = 0, rotationProfit = 0;

    matches.forEach(m => {
        const inRotation = isInRotation(m.startDate, rotationBounds);
        if (inRotation) rotationMatchCount++;
        const home = m.participantAName, away = m.participantBName;
        if (rating[home] === undefined) { rating[home] = initRating; matchCount[home] = 0; }
        if (rating[away] === undefined) { rating[away] = initRating; matchCount[away] = 0; }
        const pairKey = [home, away].sort().join(' vs ');

        // Determine actual winner for streak tracking
        let actualWinner = null;
        if (m.teamAScore > m.teamBScore) actualWinner = home;
        else if (m.teamBScore > m.teamAScore) actualWinner = away;

        const pHome = 1 / (1 + Math.pow(10, (rating[away] - rating[home]) / 400));

        if (matchCount[home] >= minMatches && matchCount[away] >= minMatches) {
            let pick = null;
            if (pHome >= threshold) pick = home;
            else if ((1 - pHome) >= threshold) pick = away;

            if (pick && m.teamAScore !== m.teamBScore) {
                const { homeOdds, awayOdds } = h2hOddsTracker.getOdds(pairKey, home, away);
                const payout = pick === home ? homeOdds : awayOdds;
                bets++;
                const won = (pick === home && m.teamAScore > m.teamBScore) || (pick === away && m.teamBScore > m.teamAScore);
                if (won) { wins++; totalProfit += STAKE * (payout - 1); }
                else { totalProfit -= STAKE; }
                if (inRotation) {
                    rotationBets++;
                    if (won) { rotationWins++; rotationProfit += STAKE * (payout - 1); }
                    else { rotationProfit -= STAKE; }
                    if (!rotationPairStats[pairKey]) rotationPairStats[pairKey] = { bets: 0, wins: 0 };
                    rotationPairStats[pairKey].bets++;
                    if (won) rotationPairStats[pairKey].wins++;
                }
            }
        }

        // Record winner to update H2H streak AFTER prediction (draws ignored)
        h2hOddsTracker.recordResult(pairKey, actualWinner);

        const sHome = m.teamAScore > m.teamBScore ? 1 : m.teamAScore === m.teamBScore ? 0.5 : 0;
        rating[home] += K * (sHome - pHome);
        rating[away] += K * ((1 - sHome) - (1 - pHome));
        matchCount[home]++;
        matchCount[away]++;
    });

    const wr = bets > 0 ? (wins / bets) * 100 : 0;
    const rotWr = rotationBets > 0 ? (rotationWins / rotationBets) * 100 : 0;

    return {
        state: { rating, matchCount, h2hOddsTracker },
        performance: { bets, wins, wr, profit: totalProfit, cov: matches.length > 0 ? (bets / matches.length) * 100 : 0 },
        rotationPerformance: { bets: rotationBets, wins: rotationWins, wr: rotWr, profit: rotationProfit, cov: rotationMatchCount > 0 ? (rotationBets / rotationMatchCount) * 100 : 0 },
        rotationPairStats
    };
}

function predictH2HElo(state, home, away, params = DEFAULT_H2H_ELO) {
    const { threshold, minMatches } = params;
    if (state.matchCount[home] === undefined || state.matchCount[away] === undefined) return null;
    if (state.matchCount[home] < minMatches || state.matchCount[away] < minMatches) return null;

    const pairKey = [home, away].sort().join(' vs ');
    const { homeOdds, awayOdds } = state.h2hOddsTracker ? state.h2hOddsTracker.getOdds(pairKey, home, away) : { homeOdds: H2H_BASELINE_ODDS, awayOdds: H2H_BASELINE_ODDS };

    const pHome = 1 / (1 + Math.pow(10, (state.rating[away] - state.rating[home]) / 400));
    if (pHome >= threshold) return { pick: home, prob: pHome * 100, homeOdds, awayOdds };
    if ((1 - pHome) >= threshold) return { pick: away, prob: (1 - pHome) * 100, homeOdds, awayOdds };
    return null;
}

// ---------------------------------------------------------------------------
// DYNAMIC PARAMETER TUNING
// Runs a compact grid search over the current rotation's completed matches
// to find the parameters that maximize absolute profit ($5 stakes).
// Called every pipeline tick before generating predictions.
// ---------------------------------------------------------------------------
function dynamicTuneParams(historical, rotationBounds) {
    const startT = Date.now();

    // --- Compact grids (kept small for speed: ~200-300 configs each) ---
    const ouPoissonGrid = [];
    [12, 16, 20, 24, 28].forEach(windowN => {
        [3.2, 3.5, 3.8, 3.9, 4.0].forEach(threshOver => {
            [1.6, 1.8, 2.0, 2.1, 2.2, 2.4].forEach(threshUnder => {
                if (threshUnder < threshOver)
                    ouPoissonGrid.push({ windowN, threshOver, threshUnder, minMatches: 3 });
            });
        });
    });

    const h2hPoissonGrid = [];
    [0.2, 0.3, 0.5, 0.6, 0.7].forEach(alpha => {
        [0.42, 0.45, 0.48, 0.50, 0.52, 0.55, 0.58, 0.60, 0.65].forEach(threshold => {
            h2hPoissonGrid.push({ alpha, threshold, minMatches: 3 });
        });
    });

    const h2hEloGrid = [];
    [8, 16, 25, 32, 40, 50].forEach(K => {
        [0.49, 0.52, 0.54, 0.56, 0.58, 0.61, 0.64, 0.67, 0.70].forEach(threshold => {
            h2hEloGrid.push({ K, threshold, minMatches: 3, initRating: 1500 });
        });
    });

    // --- Helper to run a single model config and return rotation-only profit ---
    function evalOUPoisson(cfg) {
        const state = buildOUPoissonState(historical, cfg, rotationBounds);
        return state.rotationPerformance.profit;
    }
    function evalH2HPoisson(cfg) {
        const state = buildH2HPoissonState(historical, cfg, rotationBounds);
        return state.rotationPerformance.profit;
    }
    function evalH2HElo(cfg) {
        const state = buildH2HEloState(historical, cfg, rotationBounds);
        return state.rotationPerformance.profit;
    }

    // --- Search each grid for max profit ---
    function searchBest(grid, evalFn, defaultCfg) {
        let bestProfit = -Infinity;
        let bestCfg = defaultCfg;
        grid.forEach(cfg => {
            const p = evalFn(cfg);
            if (p > bestProfit) { bestProfit = p; bestCfg = cfg; }
        });
        // Fall back to defaults if nothing is profitable
        if (bestProfit <= 0) return { cfg: defaultCfg, profit: bestProfit, tuned: false };
        return { cfg: bestCfg, profit: bestProfit, tuned: true };
    }

    const ouP = searchBest(ouPoissonGrid, evalOUPoisson, DEFAULT_OU_POISSON);
    const h2hP = searchBest(h2hPoissonGrid, evalH2HPoisson, DEFAULT_H2H_POISSON);
    const h2hE = searchBest(h2hEloGrid, evalH2HElo, DEFAULT_H2H_ELO);

    const elapsed = ((Date.now() - startT) / 1000).toFixed(1);
    console.log(`  🔧 Dynamic tune (${elapsed}s):`);
    console.log(`     OU_POISSON:  ${ouP.tuned ? '✅ TUNED' : '⚪ DEFAULT'} -> W=${ouP.cfg.windowN} thO=${ouP.cfg.threshOver} thU=${ouP.cfg.threshUnder} (profit=$${ouP.profit.toFixed(1)})`);
    console.log(`     H2H_POISSON: ${h2hP.tuned ? '✅ TUNED' : '⚪ DEFAULT'} -> α=${h2hP.cfg.alpha} th=${h2hP.cfg.threshold} (profit=$${h2hP.profit.toFixed(1)})`);
    console.log(`     H2H_ELO:     ${h2hE.tuned ? '✅ TUNED' : '⚪ DEFAULT'} -> K=${h2hE.cfg.K} th=${h2hE.cfg.threshold} (profit=$${h2hE.profit.toFixed(1)})`);

    return {
        ouPoisson: ouP.cfg,
        ouElo: DEFAULT_OU_ELO,  // OU_ELO is never profitable, always use default
        h2hPoisson: h2hP.cfg,
        h2hElo: h2hE.cfg
    };
}

// Mutates each match in `upcomingMatches` with the 4 models' picks/probabilities, and
// returns each model's live bets/wins/win-rate/profit tallied over the same historical
// window used to build its state (fresh every call — see file header).
function computeExtraPredictions(upcomingMatches) {
    const historical = loadHistoricalMatches();
    if (historical.length === 0) return null;

    const rotationBounds = getCurrentRotationBounds();

    // --- Dynamic tuning: find best params for THIS rotation ---
    const tuned = dynamicTuneParams(historical, rotationBounds);

    const ouPoisson = buildOUPoissonState(historical, tuned.ouPoisson, rotationBounds);
    const ouElo = buildOUEloState(historical, tuned.ouElo, rotationBounds);
    const h2hPoisson = buildH2HPoissonState(historical, tuned.h2hPoisson, rotationBounds);
    const h2hElo = buildH2HEloState(historical, tuned.h2hElo, rotationBounds);

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

        const p1 = predictOUPoisson(ouPoisson.state, home, away, tuned.ouPoisson);
        m.ouPoissonPick = p1 ? p1.pick : null;
        m.ouPoissonProb = p1 ? p1.prob : null;
        m.ouPoissonOverOdds = p1 ? p1.overOdds : OU_BASELINE_ODDS;
        m.ouPoissonUnderOdds = p1 ? p1.underOdds : OU_BASELINE_ODDS;

        const p2 = predictOUElo(ouElo.state, home, away, tuned.ouElo);
        m.ouEloPick = p2 ? p2.pick : null;
        m.ouEloProb = p2 ? p2.prob : null;
        m.ouEloOverOdds = p2 ? p2.overOdds : OU_BASELINE_ODDS;
        m.ouEloUnderOdds = p2 ? p2.underOdds : OU_BASELINE_ODDS;

        const p3 = predictH2HPoisson(h2hPoisson.state, home, away, tuned.h2hPoisson);
        m.h2hPoissonPick = p3 ? p3.pick : null;
        m.h2hPoissonProb = p3 ? p3.prob : null;
        m.h2hPoissonHomeOdds = p3 ? p3.homeOdds : H2H_BASELINE_ODDS;
        m.h2hPoissonAwayOdds = p3 ? p3.awayOdds : H2H_BASELINE_ODDS;

        const p4 = predictH2HElo(h2hElo.state, home, away, tuned.h2hElo);
        m.h2hEloPick = p4 ? p4.pick : null;
        m.h2hEloProb = p4 ? p4.prob : null;
        m.h2hEloHomeOdds = p4 ? p4.homeOdds : H2H_BASELINE_ODDS;
        m.h2hEloAwayOdds = p4 ? p4.awayOdds : H2H_BASELINE_ODDS;

        attachPairAcc(m, 'ouPoisson', ouPoisson.rotationPairStats);
        attachPairAcc(m, 'ouElo', ouElo.rotationPairStats);
        attachPairAcc(m, 'h2hPoisson', h2hPoisson.rotationPairStats);
        attachPairAcc(m, 'h2hElo', h2hElo.rotationPairStats);
    });

    // --- Compute per-segment (4-hour block) profits ---
    const segmentProfits = computeSegmentProfits(historical, rotationBounds, tuned);

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
        },
        segments: segmentProfits
    };
}

// ---------------------------------------------------------------------------
// SEGMENT PROFIT TRACKER
// Splits the current 12-hour rotation into 3 × 4-hour segments and tallies
// profit per model in each segment, using the same build*State functions.
// ---------------------------------------------------------------------------
function computeSegmentProfits(historical, rotationBounds, tuned) {
    const { startAEST, endAEST } = rotationBounds;
    const startMs = startAEST.getTime();

    // Create 3 segment boundaries (each 4 hours = 4*60*60*1000 ms)
    const FOUR_HOURS = 4 * 60 * 60 * 1000;
    const seg1Start = new Date(startMs);
    const seg1End = new Date(startMs + FOUR_HOURS);
    const seg2Start = seg1End;
    const seg2End = new Date(startMs + 2 * FOUR_HOURS);
    const seg3Start = seg2End;
    const seg3End = new Date(startMs + 3 * FOUR_HOURS);

    const segments = [
        { bounds: { startAEST: seg1Start, endAEST: seg1End } },
        { bounds: { startAEST: seg2Start, endAEST: seg2End } },
        { bounds: { startAEST: seg3Start, endAEST: seg3End } },
    ];

    // Format segment labels in AEST (hours only)
    function fmtHour(d) {
        const h = d.getUTCHours();
        return h === 0 ? '12am' : h < 12 ? h + 'am' : h === 12 ? '12pm' : (h - 12) + 'pm';
    }

    const result = segments.map((seg, i) => {
        // Build each model state scoped to this segment's bounds
        const ouP = buildOUPoissonState(historical, tuned.ouPoisson, seg.bounds);
        const ouE = buildOUEloState(historical, tuned.ouElo, seg.bounds);
        const h2hP = buildH2HPoissonState(historical, tuned.h2hPoisson, seg.bounds);
        const h2hE = buildH2HEloState(historical, tuned.h2hElo, seg.bounds);

        return {
            label: `${fmtHour(seg.bounds.startAEST)} – ${fmtHour(seg.bounds.endAEST)}`,
            h2hPoisson: { profit: h2hP.rotationPerformance.profit, bets: h2hP.rotationPerformance.bets, wr: h2hP.rotationPerformance.wr },
            h2hElo: { profit: h2hE.rotationPerformance.profit, bets: h2hE.rotationPerformance.bets, wr: h2hE.rotationPerformance.wr },
            ouPoisson: { profit: ouP.rotationPerformance.profit, bets: ouP.rotationPerformance.bets, wr: ouP.rotationPerformance.wr },
            ouElo: { profit: ouE.rotationPerformance.profit, bets: ouE.rotationPerformance.bets, wr: ouE.rotationPerformance.wr },
        };
    });

    return result;
}

module.exports = { computeExtraPredictions };
