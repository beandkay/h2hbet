// Grid-search the ACTUAL shipped src/extra_predictors.js model (Poisson/Elo, probability
// thresholds) for configs that raise coverage above today's baseline, showing the
// profit/WR cost at each step. Walk-forward, zero-lookahead — mirrors buildOUPoissonState
// etc. exactly, just parameterized over threshOver/threshUnder/threshold/minMatches.
const fs = require('fs');

const DATA_FILE = process.argv[2] || 'recent_31day_fresh.json';
const matches = JSON.parse(fs.readFileSync(__dirname + '/' + DATA_FILE, 'utf8'))
    .filter(m => m.matchStatus === 'MATCH_ENDED' && !m.isCancelled && typeof m.teamAScore === 'number' && typeof m.teamBScore === 'number')
    .sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
console.log(`Loaded ${matches.length} matches from ${DATA_FILE}`);

const STAKE = 5, PAYOUT = 1.6;
function summarize(bets, wins, total) {
    const wr = bets > 0 ? (wins / bets) * 100 : 0;
    const profit = bets * STAKE * (wr / 100 * PAYOUT - 1);
    const cov = total > 0 ? (bets / total) * 100 : 0;
    return { bets, wins, wr, profit, cov };
}
function poissonPMF(k, lambda) {
    if (lambda <= 0) return k === 0 ? 1 : 0;
    let p = Math.exp(-lambda);
    for (let i = 1; i <= k; i++) p *= lambda / i;
    return p;
}
function poissonCDF(k, lambda) { let s = 0; for (let i = 0; i <= k; i++) s += poissonPMF(i, lambda); return s; }
function jointWinProb(lh, la, N = 30) {
    let pHome = 0, pAway = 0;
    for (let h = 0; h <= N; h++) {
        const ph = poissonPMF(h, lh);
        for (let a = 0; a <= N; a++) {
            const pa = poissonPMF(a, la) * ph;
            if (h > a) pHome += pa; else if (h < a) pAway += pa;
        }
    }
    return { pHome, pAway };
}
function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }

function runOUPoisson({ alpha, threshOver, threshUnder, minMatches }) {
    const ps = {}; const h2h = {}; let bets = 0, wins = 0;
    matches.forEach(m => {
        const home = m.participantAName, away = m.participantBName;
        if (!ps[home]) ps[home] = { scored: null, conceded: null, matches: 0 };
        if (!ps[away]) ps[away] = { scored: null, conceded: null, matches: 0 };
        const sH = ps[home], sA = ps[away];
        const pk = [home, away].sort().join(' vs ');
        if (!h2h[pk]) h2h[pk] = { matches: 0, totalGoals: 0 };
        const h = h2h[pk];
        const totalG = m.teamAScore + m.teamBScore;
        if (sH.matches >= minMatches && sA.matches >= minMatches) {
            let lam = (sH.scored + sA.conceded) / 2 + (sA.scored + sH.conceded) / 2;
            if (h.matches > 0) { const avg = h.totalGoals / h.matches; const w = Math.min(h.matches * 0.15, 0.40); lam = (1 - w) * lam + w * avg; }
            lam = Math.max(lam, 0.05);
            const pU = poissonCDF(2, lam), pO = 1 - pU;
            let pick = null;
            if (pO >= threshOver) pick = 'OVER'; else if (pU >= threshUnder) pick = 'UNDER';
            if (pick) { bets++; if ((pick === 'OVER' && totalG > 2.5) || (pick === 'UNDER' && totalG < 2.5)) wins++; }
        }
        sH.scored = sH.scored == null ? m.teamAScore : sH.scored + alpha * (m.teamAScore - sH.scored);
        sH.conceded = sH.conceded == null ? m.teamBScore : sH.conceded + alpha * (m.teamBScore - sH.conceded);
        sH.matches++;
        sA.scored = sA.scored == null ? m.teamBScore : sA.scored + alpha * (m.teamBScore - sA.scored);
        sA.conceded = sA.conceded == null ? m.teamAScore : sA.conceded + alpha * (m.teamAScore - sA.conceded);
        sA.matches++;
        h.totalGoals += totalG; h.matches++;
    });
    return summarize(bets, wins, matches.length);
}

function runOUElo({ K, threshOver, threshUnder, minMatches }) {
    const rating = {}, mc = {}; let bets = 0, wins = 0;
    matches.forEach(m => {
        const home = m.participantAName, away = m.participantBName;
        if (rating[home] === undefined) { rating[home] = 0; mc[home] = 0; }
        if (rating[away] === undefined) { rating[away] = 0; mc[away] = 0; }
        const pP = sigmoid(rating[home] + rating[away]);
        const totalG = m.teamAScore + m.teamBScore;
        const actualOver = totalG > 2.5 ? 1 : 0;
        if (mc[home] >= minMatches && mc[away] >= minMatches) {
            let pick = null;
            if (pP >= threshOver) pick = 'OVER'; else if ((1 - pP) >= threshUnder) pick = 'UNDER';
            if (pick) { bets++; if ((pick === 'OVER' && actualOver === 1) || (pick === 'UNDER' && actualOver === 0)) wins++; }
        }
        const delta = K * (actualOver - pP);
        rating[home] += delta; rating[away] += delta;
        mc[home]++; mc[away]++;
    });
    return summarize(bets, wins, matches.length);
}

function runH2HPoisson({ alpha, threshold, minMatches }) {
    const ps = {}, h2h = {}; let bets = 0, wins = 0;
    matches.forEach(m => {
        const home = m.participantAName, away = m.participantBName;
        if (!ps[home]) ps[home] = { scored: null, conceded: null, matches: 0 };
        if (!ps[away]) ps[away] = { scored: null, conceded: null, matches: 0 };
        const sH = ps[home], sA = ps[away];
        const pk = [home, away].sort().join(' vs ');
        if (!h2h[pk]) h2h[pk] = { matches: 0, goalsFor: {} };
        const h = h2h[pk];
        if (sH.matches >= minMatches && sA.matches >= minMatches) {
            let lH = (sH.scored + sA.conceded) / 2, lA = (sA.scored + sH.conceded) / 2;
            if (h.matches > 0) {
                const w = Math.min(h.matches * 0.15, 0.40);
                const hHome = (h.goalsFor[home] || 0) / h.matches, hAway = (h.goalsFor[away] || 0) / h.matches;
                lH = (1 - w) * lH + w * hHome; lA = (1 - w) * lA + w * hAway;
            }
            lH = Math.max(lH, 0.05); lA = Math.max(lA, 0.05);
            const { pHome, pAway } = jointWinProb(lH, lA);
            let pick = null;
            if (pHome >= threshold) pick = home; else if (pAway >= threshold) pick = away;
            if (pick && m.teamAScore !== m.teamBScore) {
                bets++;
                if ((pick === home && m.teamAScore > m.teamBScore) || (pick === away && m.teamBScore > m.teamAScore)) wins++;
            }
        }
        sH.scored = sH.scored == null ? m.teamAScore : sH.scored + alpha * (m.teamAScore - sH.scored);
        sH.conceded = sH.conceded == null ? m.teamBScore : sH.conceded + alpha * (m.teamBScore - sH.conceded);
        sH.matches++;
        sA.scored = sA.scored == null ? m.teamBScore : sA.scored + alpha * (m.teamBScore - sA.scored);
        sA.conceded = sA.conceded == null ? m.teamAScore : sA.conceded + alpha * (m.teamAScore - sA.conceded);
        sA.matches++;
        h.goalsFor[home] = (h.goalsFor[home] || 0) + m.teamAScore;
        h.goalsFor[away] = (h.goalsFor[away] || 0) + m.teamBScore;
        h.matches++;
    });
    return summarize(bets, wins, matches.length);
}

function runH2HElo({ K, threshold, minMatches, initRating }) {
    const rating = {}, mc = {}; let bets = 0, wins = 0;
    matches.forEach(m => {
        const home = m.participantAName, away = m.participantBName;
        if (rating[home] === undefined) { rating[home] = initRating; mc[home] = 0; }
        if (rating[away] === undefined) { rating[away] = initRating; mc[away] = 0; }
        const pHome = 1 / (1 + Math.pow(10, (rating[away] - rating[home]) / 400));
        if (mc[home] >= minMatches && mc[away] >= minMatches) {
            let pick = null;
            if (pHome >= threshold) pick = home; else if ((1 - pHome) >= threshold) pick = away;
            if (pick && m.teamAScore !== m.teamBScore) {
                bets++;
                if ((pick === home && m.teamAScore > m.teamBScore) || (pick === away && m.teamBScore > m.teamAScore)) wins++;
            }
        }
        const sHome = m.teamAScore > m.teamBScore ? 1 : m.teamAScore === m.teamBScore ? 0.5 : 0;
        rating[home] += K * (sHome - pHome); rating[away] += K * ((1 - sHome) - (1 - pHome));
        mc[home]++; mc[away]++;
    });
    return summarize(bets, wins, matches.length);
}

function sweep(name, runner, base, sweeps) {
    console.log(`\n=== ${name} ===`);
    const baseR = runner(base);
    console.log(`SHIPPED: bets=${baseR.bets} cov=${baseR.cov.toFixed(1)}% WR=${baseR.wr.toFixed(1)}% Profit=$${baseR.profit.toFixed(0)}`);
    const results = [];
    sweeps.forEach(cfg => {
        const r = runner({ ...base, ...cfg });
        results.push({ cfg, ...r });
    });
    results.sort((a, b) => a.cov - b.cov);
    results.forEach(r => {
        console.log(`cov=${r.cov.toFixed(1).padStart(5)}% bets=${String(r.bets).padStart(5)} WR=${r.wr.toFixed(1).padStart(5)}% Profit=$${r.profit.toFixed(0).padStart(5)} | ${JSON.stringify(r.cfg)}`);
    });
}

sweep('OU_POISSON', runOUPoisson, { alpha: 0.15, threshOver: 0.65, threshUnder: 0.80, minMatches: 3 }, [
    { threshOver: 0.60, threshUnder: 0.75 },
    { threshOver: 0.58, threshUnder: 0.72 },
    { threshOver: 0.55, threshUnder: 0.70 },
    { threshOver: 0.60, threshUnder: 0.75, minMatches: 2 },
    { threshOver: 0.55, threshUnder: 0.70, minMatches: 2 },
    { threshOver: 0.52, threshUnder: 0.65, minMatches: 2 },
]);

sweep('OU_ELO', runOUElo, { K: 0.15, threshOver: 0.68, threshUnder: 0.75, minMatches: 3 }, [
    { threshOver: 0.62, threshUnder: 0.68 },
    { threshOver: 0.58, threshUnder: 0.63 },
    { threshOver: 0.55, threshUnder: 0.60 },
    { threshOver: 0.58, threshUnder: 0.63, minMatches: 2 },
    { threshOver: 0.55, threshUnder: 0.60, minMatches: 2 },
]);

sweep('H2H_POISSON', runH2HPoisson, { alpha: 0.3, threshold: 0.55, minMatches: 3 }, [
    { threshold: 0.53 },
    { threshold: 0.52 },
    { threshold: 0.51 },
    { threshold: 0.53, minMatches: 2 },
    { threshold: 0.52, minMatches: 2 },
]);

sweep('H2H_ELO', runH2HElo, { K: 12, threshold: 0.62, minMatches: 3, initRating: 1500 }, [
    { threshold: 0.58 },
    { threshold: 0.56 },
    { threshold: 0.54 },
    { threshold: 0.58, minMatches: 2 },
    { threshold: 0.56, minMatches: 2 },
]);

console.log('\n\n========== FINE-GRAINED (small steps near shipped) ==========');
sweep('OU_POISSON (fine)', runOUPoisson, { alpha: 0.15, threshOver: 0.65, threshUnder: 0.80, minMatches: 3 }, [
    { threshOver: 0.64, threshUnder: 0.79 },
    { threshOver: 0.63, threshUnder: 0.78 },
    { threshOver: 0.62, threshUnder: 0.77 },
    { threshOver: 0.61, threshUnder: 0.76 },
]);
sweep('OU_ELO (fine)', runOUElo, { K: 0.15, threshOver: 0.68, threshUnder: 0.75, minMatches: 3 }, [
    { threshOver: 0.67, threshUnder: 0.74 },
    { threshOver: 0.66, threshUnder: 0.72 },
    { threshOver: 0.65, threshUnder: 0.70 },
    { threshOver: 0.64, threshUnder: 0.69 },
]);
sweep('H2H_POISSON (fine)', runH2HPoisson, { alpha: 0.3, threshold: 0.55, minMatches: 3 }, [
    { threshold: 0.545 },
    { threshold: 0.54 },
    { threshold: 0.535 },
    { threshold: 0.53 },
]);
sweep('H2H_ELO (fine)', runH2HElo, { K: 12, threshold: 0.62, minMatches: 3, initRating: 1500 }, [
    { threshold: 0.61 },
    { threshold: 0.60 },
    { threshold: 0.59 },
    { threshold: 0.58 },
]);
