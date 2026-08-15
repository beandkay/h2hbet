// Does adding a pair-specific H2H OU accuracy gate (on top of the current live
// OV=3.1/UN=2.6/strict/poor<40 config) improve profit? historicalOUStats.h2hHistory[pairKey]
// is already computed and passed into src/predictor_ou.js but currently only used to build a
// decorative "[OU Acc: x%]" label -- never to suppress a pick. This sweeps whether gating on it helps.
const fs = require('fs');
const { calculateStatistics } = require('../src/statistics');
const { calculateH2H } = require('../src/h2h_engine');
const { groupMatchesByRotation, genOUVariant } = require('./tune');

const STAKE = 5, PAYOUT = 1.6;
function pct(n, d) { return d > 0 ? (n / d * 100) : 0; }
function rotProfit(r) { return r.wins * STAKE * (PAYOUT - 1) - r.losses * STAKE; }

function buildRotations(dataFile) {
    const allMatches = JSON.parse(fs.readFileSync(__dirname + '/' + dataFile, 'utf8'));
    const blocks = groupMatchesByRotation(allMatches);
    const keys = Object.keys(blocks).sort();
    const perRotation = {};
    const MIN_PAST = 50;
    keys.forEach((key, idx) => {
        const past = [];
        keys.slice(0, idx).forEach(k => past.push(...blocks[k]));
        if (past.length < MIN_PAST) return;
        const totalGoals = past.reduce((s, m) => s + m.teamAScore + m.teamBScore, 0);
        const leagueAvg = totalGoals / (past.length * 2);
        const { playerStats } = calculateStatistics(JSON.parse(JSON.stringify(past)), leagueAvg);
        const { h2hStats } = calculateH2H(JSON.parse(JSON.stringify(past)));
        perRotation[key] = { playerStats, h2hStats, matches: blocks[key] };
    });
    const evalKeys = Object.keys(perRotation).sort();
    return { perRotation, evalKeys, range: [keys[0], keys.at(-1)], totalBlocks: keys.length };
}

function evalOU(perRotation, evalKeys, cfg) {
    const playerOU = {};
    const h2hHistory = {};
    const rotStats = {};
    evalKeys.forEach(key => {
        rotStats[key] = { bets: 0, wins: 0, losses: 0 };
        const { playerStats, h2hStats, matches } = perRotation[key];
        const predicted = genOUVariant(matches, playerStats, h2hStats, { playerOU, h2hHistory }, cfg);
        predicted.forEach(p => {
            if (!playerOU[p.home]) playerOU[p.home] = { bets: 0, correct: 0 };
            if (!playerOU[p.away]) playerOU[p.away] = { bets: 0, correct: 0 };
            if (!h2hHistory[p.pairKey]) h2hHistory[p.pairKey] = { ouBets: 0, ouCorrect: 0 };
            if (!p.pick) return;
            const totalG = p.hs + p.as;
            rotStats[key].bets++;
            playerOU[p.home].bets++; playerOU[p.away].bets++;
            h2hHistory[p.pairKey].ouBets++;
            const won = (p.pick === 'OVER' && totalG > 2.5) || (p.pick === 'UNDER' && totalG < 2.5);
            if (won) { rotStats[key].wins++; playerOU[p.home].correct++; playerOU[p.away].correct++; h2hHistory[p.pairKey].ouCorrect++; }
            else { rotStats[key].losses++; }
        });
    });
    const rotList = Object.values(rotStats).filter(r => r.bets > 0);
    const bets = rotList.reduce((s, r) => s + r.bets, 0);
    const wins = rotList.reduce((s, r) => s + r.wins, 0);
    const losses = rotList.reduce((s, r) => s + r.losses, 0);
    const winRate = pct(wins, bets);
    const roi = (winRate / 100 * PAYOUT - 1) * 100;
    const profit = bets * STAKE * (winRate / 100 * PAYOUT - 1);
    const profitableRotations = rotList.filter(r => (r.wins / r.bets) >= 0.625).length;
    const losingRotations = rotList.filter(r => rotProfit(r) < 0).length;
    return { bets, wins, losses, winRate, roi, profit, profitableRotations, bettingRotations: rotList.length, losingRotations };
}

const BASE_CFG = { optimalOv: 3.1, optimalUn: 2.6, styleMode: 'strict', poorHistAccThresh: 40 };
const PAIR_MIN_BETS = [0, 3, 5, 8, 10, 15, 20, 25, 30];   // 0 = gate disabled (current live behavior)
const PAIR_ACC_THRESH = [30, 40, 45, 50, 55, 60, 65, 70, 75];

['recent_7day_fresh.json', 'recent_21day_fresh.json'].forEach(dataFile => {
    const { perRotation, evalKeys, range, totalBlocks } = buildRotations(dataFile);
    console.log(`\n########## ${dataFile}  (${totalBlocks} blocks, range ${range[0]}..${range[1]}, ${evalKeys.length} evaluable) ##########`);

    const baseline = evalOU(perRotation, evalKeys, { ...BASE_CFG, pairMinBets: 0 });
    console.log(`BASELINE (no pair-H2H gate): bets=${baseline.bets} WR=${baseline.winRate.toFixed(1)}% ROI=${baseline.roi.toFixed(1)}% Profit=$${baseline.profit.toFixed(0)} prof-rot=${baseline.profitableRotations}/${baseline.bettingRotations} losing-rot=${baseline.losingRotations}`);

    const rows = [];
    PAIR_MIN_BETS.forEach(minBets => {
        if (minBets === 0) return;
        PAIR_ACC_THRESH.forEach(acc => {
            const cfg = { ...BASE_CFG, pairMinBets: minBets, pairAccThresh: acc };
            const r = evalOU(perRotation, evalKeys, cfg);
            rows.push({ minBets, acc, ...r });
        });
    });

    console.log('\nminBets  accThresh  bets  WR%    ROI%     Profit  prof-rot  losing-rot');
    rows.forEach(r => {
        console.log(`${String(r.minBets).padStart(7)}  ${String(r.acc).padStart(9)}  ${String(r.bets).padStart(4)}  ${r.winRate.toFixed(1).padStart(5)}  ${r.roi.toFixed(1).padStart(6)}  $${r.profit.toFixed(0).padStart(6)}  ${String(r.profitableRotations).padStart(3)}/${String(r.bettingRotations).padStart(3)}     ${r.losingRotations}`);
    });

    const best = [...rows].sort((a, b) => b.profit - a.profit || b.bets - a.bets)[0];
    console.log(`\nBest by profit: minBets=${best.minBets} accThresh=${best.acc} -> bets=${best.bets} WR=${best.winRate.toFixed(1)}% Profit=$${best.profit.toFixed(0)} (vs baseline $${baseline.profit.toFixed(0)})`);
});
