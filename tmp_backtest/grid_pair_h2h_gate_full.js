// Same pair-level H2H OU accuracy gate test as grid_pair_h2h_gate.js, but walks
// forward across the FULL available history (~30 days) so pair-history accumulates
// realistically (matching how opts.historicalOUStats.h2hHistory[pairKey] actually
// behaves in production, which persists across days via historical_ou_stats.json)
// -- then reports profit ONLY on the most recent TEST_DAYS as the "live-equivalent" result.
const fs = require('fs');
const { calculateStatistics } = require('../src/statistics');
const { calculateH2H } = require('../src/h2h_engine');
const { groupMatchesByRotation, genOUVariant } = require('./tune');

const STAKE = 5, PAYOUT = 1.6;
const TEST_DAYS = 7;
function pct(n, d) { return d > 0 ? (n / d * 100) : 0; }
function rotProfit(r) { return r.wins * STAKE * (PAYOUT - 1) - r.losses * STAKE; }

const allMatches = JSON.parse(fs.readFileSync(__dirname + '/full_history_fresh.json', 'utf8'));
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
const testKeys = new Set(evalKeys.slice(-Math.round(TEST_DAYS * 2))); // ~2 blocks/day (AM+PM)
console.log(`Full walk: ${evalKeys.length} evaluable blocks. Reporting profit on last ${testKeys.size} blocks (~${TEST_DAYS}d): ${[...testKeys][0]}..${[...testKeys].at(-1)}`);

function evalOU(cfg) {
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
    // Restrict reporting to the test window only, but the walk (and h2hHistory build-up) ran over everything before it.
    const testRotList = Object.entries(rotStats).filter(([k]) => testKeys.has(k)).map(([, r]) => r).filter(r => r.bets > 0);
    const bets = testRotList.reduce((s, r) => s + r.bets, 0);
    const wins = testRotList.reduce((s, r) => s + r.wins, 0);
    const losses = testRotList.reduce((s, r) => s + r.losses, 0);
    const winRate = pct(wins, bets);
    const roi = (winRate / 100 * PAYOUT - 1) * 100;
    const profit = bets * STAKE * (winRate / 100 * PAYOUT - 1);
    const profitableRotations = testRotList.filter(r => (r.wins / r.bets) >= 0.625).length;
    const losingRotations = testRotList.filter(r => rotProfit(r) < 0).length;
    return { bets, wins, losses, winRate, roi, profit, profitableRotations, bettingRotations: testRotList.length, losingRotations };
}

const BASE_CFG = { optimalOv: 3.1, optimalUn: 2.6, styleMode: 'strict', poorHistAccThresh: 40 };
const baseline = evalOU({ ...BASE_CFG, pairMinBets: 0 });
console.log(`\nBASELINE (no pair-H2H gate) on last ${TEST_DAYS}d: bets=${baseline.bets} WR=${baseline.winRate.toFixed(1)}% ROI=${baseline.roi.toFixed(1)}% Profit=$${baseline.profit.toFixed(0)} prof-rot=${baseline.profitableRotations}/${baseline.bettingRotations} losing-rot=${baseline.losingRotations}`);

const PAIR_MIN_BETS = [3, 5, 8, 10, 15, 20];
const PAIR_ACC_THRESH = [40, 45, 50, 55, 60, 65, 70];
const rows = [];
PAIR_MIN_BETS.forEach(minBets => PAIR_ACC_THRESH.forEach(acc => {
    const r = evalOU({ ...BASE_CFG, pairMinBets: minBets, pairAccThresh: acc });
    rows.push({ minBets, acc, ...r });
}));

console.log('\nminBets  accThresh  bets  WR%    ROI%     Profit  prof-rot  losing-rot');
rows.forEach(r => {
    console.log(`${String(r.minBets).padStart(7)}  ${String(r.acc).padStart(9)}  ${String(r.bets).padStart(4)}  ${r.winRate.toFixed(1).padStart(5)}  ${r.roi.toFixed(1).padStart(6)}  $${r.profit.toFixed(0).padStart(6)}  ${String(r.profitableRotations).padStart(3)}/${String(r.bettingRotations).padStart(3)}     ${r.losingRotations}`);
});

const best = [...rows].sort((a, b) => b.profit - a.profit || b.bets - a.bets)[0];
console.log(`\nBest by profit: minBets=${best.minBets} accThresh=${best.acc} -> bets=${best.bets} WR=${best.winRate.toFixed(1)}% Profit=$${best.profit.toFixed(0)} (vs baseline $${baseline.profit.toFixed(0)})`);
