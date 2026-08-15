const fs = require('fs');
const { calculateStatistics } = require('../src/statistics');
const { calculateH2H } = require('../src/h2h_engine');
const { generateOUPredictions } = require('../src/predictor_ou');
const { generateH2HPredictions } = require('../src/predictor_h2h');
const { groupMatchesByRotation } = require('../tmp_backtest/tune');

const STAKE = 5;
const PAYOUT = 1.6;
const MIN_PAST = 50;

function pct(n, d) { return d > 0 ? (n / d) * 100 : 0; }

function loadMatches(datafile) {
    const raw = JSON.parse(fs.readFileSync(datafile, 'utf8'));
    return raw
        .filter(m => m.matchStatus === 'MATCH_ENDED' && !m.isCancelled && typeof m.teamAScore === 'number' && typeof m.teamBScore === 'number')
        .sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
}

function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }

// Poisson pmf/cdf, hand-written (no stats library in package.json).
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

// P(home>away)/P(away>home)/P(draw) for two independent Poisson goal counts,
// via direct convolution over a truncated support (no Bessel/Skellam formula needed).
function jointWinProb(lambdaHome, lambdaAway, N = 30) {
    const pmfHome = new Array(N + 1);
    const pmfAway = new Array(N + 1);
    pmfHome[0] = Math.exp(-lambdaHome);
    pmfAway[0] = Math.exp(-lambdaAway);
    for (let i = 1; i <= N; i++) {
        pmfHome[i] = pmfHome[i - 1] * lambdaHome / i;
        pmfAway[i] = pmfAway[i - 1] * lambdaAway / i;
    }
    let pHome = 0, pAway = 0, pDraw = 0;
    for (let h = 0; h <= N; h++) {
        for (let a = 0; a <= N; a++) {
            const p = pmfHome[h] * pmfAway[a];
            if (h > a) pHome += p;
            else if (h < a) pAway += p;
            else pDraw += p;
        }
    }
    return { pHome, pAway, pDraw };
}

function bucketFrontier(rows, buckets, labelFn) {
    buckets.forEach(([lo, hi]) => {
        const bucket = rows.filter(r => r.cov >= lo && r.cov < hi);
        if (!bucket.length) { console.log(`  ${lo}-${hi}%: none`); return; }
        const best = [...bucket].sort((a, b) => b.profit - a.profit)[0];
        console.log(`  ${lo}-${hi}%: bets=${best.bets} cov=${best.cov.toFixed(1)}% WR=${best.wr.toFixed(1)}% Profit=$${best.profit.toFixed(0)} | ${labelFn(best)}`);
    });
}

// Reproduces the shipped src/predictor_ou.js exactly via the same rotation-block
// walk-forward used throughout tmp_backtest/ this session - the control arm.
function runProductionOUBaseline(matches) {
    const blocks = groupMatchesByRotation(matches);
    const keys = Object.keys(blocks).sort();
    let bets = 0, wins = 0, totalMatches = 0;
    const ouPlayerState = {};

    keys.forEach((key, idx) => {
        const past = [];
        keys.slice(0, idx).forEach(k => past.push(...blocks[k]));
        if (past.length < MIN_PAST) return;
        const totalGoals = past.reduce((s, m) => s + m.teamAScore + m.teamBScore, 0);
        const leagueAvg = totalGoals / (past.length * 2);
        const { playerStats } = calculateStatistics(JSON.parse(JSON.stringify(past)), leagueAvg);
        const { h2hStats } = calculateH2H(JSON.parse(JSON.stringify(past)));
        const current = blocks[key];
        totalMatches += current.length;

        const ouMatches = JSON.parse(JSON.stringify(current));
        generateOUPredictions(ouMatches, playerStats, h2hStats, { currentRotationOUStats: { playerOU: ouPlayerState, h2hHistory: {} } });
        ouMatches.forEach(m => {
            if (!ouPlayerState[m.participantAName]) ouPlayerState[m.participantAName] = { bets: 0, correct: 0 };
            if (!ouPlayerState[m.participantBName]) ouPlayerState[m.participantBName] = { bets: 0, correct: 0 };
            if (!m.isOUPick) return;
            const totalG = m.teamAScore + m.teamBScore;
            const won = (m.ou25Pick.includes('OVER') && totalG > 2.5) || (m.ou25Pick.includes('UNDER') && totalG < 2.5);
            bets++;
            ouPlayerState[m.participantAName].bets++; ouPlayerState[m.participantBName].bets++;
            if (won) { wins++; ouPlayerState[m.participantAName].correct++; ouPlayerState[m.participantBName].correct++; }
        });
    });

    const wr = pct(wins, bets);
    const profit = bets * STAKE * (wr / 100 * PAYOUT - 1);
    return { bets, cov: pct(bets, totalMatches), wr, profit };
}

// Reproduces the shipped src/predictor_h2h.js exactly - the control arm for H2H.
function runProductionH2HBaseline(matches) {
    const blocks = groupMatchesByRotation(matches);
    const keys = Object.keys(blocks).sort();
    let bets = 0, wins = 0, attempted = 0, totalMatches = 0;
    const h2hHistoryState = {};

    keys.forEach((key, idx) => {
        const past = [];
        keys.slice(0, idx).forEach(k => past.push(...blocks[k]));
        if (past.length < MIN_PAST) return;
        const totalGoals = past.reduce((s, m) => s + m.teamAScore + m.teamBScore, 0);
        const leagueAvg = totalGoals / (past.length * 2);
        const { playerStats } = calculateStatistics(JSON.parse(JSON.stringify(past)), leagueAvg);
        const { h2hStats } = calculateH2H(JSON.parse(JSON.stringify(past)));
        const current = blocks[key];
        totalMatches += current.length;

        const h2hMatches = JSON.parse(JSON.stringify(current));
        const rotH2HHistory = {};
        Object.keys(h2hHistoryState).forEach(k => rotH2HHistory[k] = { dnbBets: h2hHistoryState[k].dnbBets, dnbCorrect: h2hHistoryState[k].dnbCorrect });
        generateH2HPredictions(h2hMatches, playerStats, h2hStats, { currentRotationH2HStats: { h2hHistory: rotH2HHistory } });
        h2hMatches.forEach(m => {
            const pairKey = [m.participantAName, m.participantBName].sort().join(' vs ');
            if (!h2hHistoryState[pairKey]) h2hHistoryState[pairKey] = { dnbBets: 0, dnbCorrect: 0 };
            if (m.predictionType === 'SKIP') return;
            attempted++;
            if (m.teamAScore === m.teamBScore) return;
            h2hHistoryState[pairKey].dnbBets++;
            const won = (m.computedPrediction.includes(m.participantAName) && m.teamAScore > m.teamBScore) ||
                        (m.computedPrediction.includes(m.participantBName) && m.teamBScore > m.teamAScore);
            bets++;
            if (won) { wins++; h2hHistoryState[pairKey].dnbCorrect++; }
        });
    });

    const wr = pct(wins, bets);
    const profit = bets * STAKE * (wr / 100 * PAYOUT - 1);
    return { bets, attempted, cov: pct(attempted, totalMatches), wr, profit };
}

module.exports = {
    STAKE, PAYOUT,
    pct, loadMatches, sigmoid,
    poissonPMF, poissonCDF, jointWinProb,
    bucketFrontier,
    runProductionOUBaseline, runProductionH2HBaseline,
};
