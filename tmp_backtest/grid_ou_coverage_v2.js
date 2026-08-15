// OU-only profit/coverage frontier, in the same bucketed format as grid_h2h_coverage.js,
// for direct side-by-side comparison. Baseline anchor per request: OV=3.1/UN=2.5.
const fs = require('fs');
const { calculateStatistics } = require('../src/statistics');
const { calculateH2H } = require('../src/h2h_engine');
const { groupMatchesByRotation, genOUVariant } = require('./tune');

const DATA_FILE = process.argv[2] || 'recent_7day_fresh.json';
const allMatches = JSON.parse(fs.readFileSync(__dirname + '/' + DATA_FILE, 'utf8'));
const blocks = groupMatchesByRotation(allMatches);
const keys = Object.keys(blocks).sort();
console.log(`Total rotation blocks: ${keys.length}`);
console.log(`Range: ${keys[0]} .. ${keys.at(-1)}`);

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
console.log(`Evaluating over ${evalKeys.length} rotation blocks (warm-up requires >= ${MIN_PAST} past matches)\n`);

const STAKE = 5, PAYOUT = 1.6;
function pct(n, d) { return d > 0 ? (n / d * 100) : 0; }

function evalOU(cfg) {
    let bets = 0, wins = 0, losses = 0, totalMatches = 0;
    const playerOU = {};
    const h2hHistory = {};
    const rotStats = {};
    evalKeys.forEach(key => {
        const { playerStats, h2hStats, matches } = perRotation[key];
        rotStats[key] = { bets: 0, wins: 0, losses: 0, matches: matches.length };
        totalMatches += matches.length;
        const predicted = genOUVariant(matches, playerStats, h2hStats, { playerOU, h2hHistory }, cfg);
        predicted.forEach(p => {
            if (!playerOU[p.home]) playerOU[p.home] = { bets: 0, correct: 0 };
            if (!playerOU[p.away]) playerOU[p.away] = { bets: 0, correct: 0 };
            if (!h2hHistory[p.pairKey]) h2hHistory[p.pairKey] = { ouBets: 0, ouCorrect: 0 };
            if (!p.pick) return;
            const totalG = p.hs + p.as;
            bets++; rotStats[key].bets++;
            playerOU[p.home].bets++; playerOU[p.away].bets++;
            h2hHistory[p.pairKey].ouBets++;
            const won = (p.pick === 'OVER' && totalG > 2.5) || (p.pick === 'UNDER' && totalG < 2.5);
            if (won) { wins++; rotStats[key].wins++; playerOU[p.home].correct++; playerOU[p.away].correct++; h2hHistory[p.pairKey].ouCorrect++; }
            else { losses++; rotStats[key].losses++; }
        });
    });
    const winRate = pct(wins, bets);
    const roi = (winRate / 100 * PAYOUT - 1) * 100;
    const profit = bets * STAKE * (winRate / 100 * PAYOUT - 1);
    const rotList = Object.values(rotStats);
    const coverage = totalMatches > 0 ? bets / totalMatches : 0;
    const rotCoverages = rotList.map(r => r.matches > 0 ? r.bets / r.matches : 0);
    const avgRotCoverage = rotCoverages.length > 0 ? rotCoverages.reduce((a, b) => a + b, 0) / rotCoverages.length : 0;
    const profitableRotations = rotList.filter(r => r.bets > 0 && (r.wins / r.bets) >= 0.625).length;
    const bettingRotations = rotList.filter(r => r.bets > 0).length;
    return { bets, wins, losses, totalMatches, coverage, avgRotCoverage, winRate, roi, profit, profitableRotations, bettingRotations };
}

const OV = [2.6, 2.7, 2.8, 2.9, 3.0, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8];
const UN = [1.9, 2.0, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 3.0];
const STYLES = ['strict', 'mixed', 'loose', 'none'];
const POOR = [0, 40, 45, 50, 55, 60, 65, 70];

console.log('Running OU-only grid (coverage/profit frontier)...');
const results = [];
OV.forEach(ov => UN.forEach(un => STYLES.forEach(sm => POOR.forEach(ph => {
    if (un >= ov) return;
    const cfg = { optimalOv: ov, optimalUn: un, styleMode: sm, poorHistAccThresh: ph };
    const r = evalOU(cfg);
    if (r.bets < 5) return;
    results.push({ cfg, ...r });
}))));
console.log(`Configs tested (with >=5 bets): ${results.length}`);

const baselineCfg = { optimalOv: 3.1, optimalUn: 2.5, styleMode: 'strict', poorHistAccThresh: 40 };
const baseline = evalOU(baselineCfg);
console.log(`\nNEW BASELINE (OV=3.1/UN=2.5/strict/<40): bets=${baseline.bets}/${baseline.totalMatches} cov=${(baseline.coverage*100).toFixed(1)}% WR=${baseline.winRate.toFixed(1)}% ROI=${baseline.roi.toFixed(1)}% Profit=$${baseline.profit.toFixed(0)} prof-rot=${baseline.profitableRotations}/${baseline.bettingRotations}`);

const prodCfg = { optimalOv: 3.1, optimalUn: 2.6, styleMode: 'strict', poorHistAccThresh: 40 };
const prod = evalOU(prodCfg);
console.log(`CURRENT LIVE (OV=3.1/UN=2.6/strict/<40): bets=${prod.bets}/${prod.totalMatches} cov=${(prod.coverage*100).toFixed(1)}% WR=${prod.winRate.toFixed(1)}% ROI=${prod.roi.toFixed(1)}% Profit=$${prod.profit.toFixed(0)} prof-rot=${prod.profitableRotations}/${prod.bettingRotations}`);

const best = [...results].sort((a, b) => b.profit - a.profit || b.bets - a.bets)[0];
console.log(`\nGLOBAL BEST by profit (any coverage): bets=${best.bets} cov=${(best.coverage*100).toFixed(1)}% WR=${best.winRate.toFixed(1)}% ROI=${best.roi.toFixed(1)}% Profit=$${best.profit.toFixed(0)} | OV=${best.cfg.optimalOv} UN=${best.cfg.optimalUn} ${best.cfg.styleMode} poor<${best.cfg.poorHistAccThresh}`);

console.log('\n=== Best-by-profit within each coverage bucket ===');
const buckets = [[0, 0.05], [0.05, 0.10], [0.10, 0.15], [0.15, 0.20], [0.20, 0.25], [0.25, 0.30], [0.30, 0.40], [0.40, 0.50], [0.50, 1.0]];
buckets.forEach(([lo, hi]) => {
    const inBucket = results.filter(r => r.coverage >= lo && r.coverage < hi);
    if (!inBucket.length) { console.log(`${(lo*100).toFixed(0)}-${(hi*100).toFixed(0)}%: no configs`); return; }
    const b = [...inBucket].sort((a, b2) => b2.profit - a.profit || b2.bets - a.bets)[0];
    console.log(`${(lo*100).toFixed(0)}-${(hi*100).toFixed(0)}%: bets=${String(b.bets).padStart(4)} cov=${(b.coverage*100).toFixed(1).padStart(5)}% WR=${b.winRate.toFixed(1).padStart(5)}% ROI=${b.roi.toFixed(1).padStart(6)}% Profit=$${b.profit.toFixed(0).padStart(5)} prof-rot=${b.profitableRotations}/${b.bettingRotations} | OV=${b.cfg.optimalOv} UN=${b.cfg.optimalUn} ${b.cfg.styleMode.padEnd(6)} poor<${b.cfg.poorHistAccThresh}`);
});

console.log('\n=== TOP 15 by PROFIT (all configs, any coverage) ===');
[...results].sort((a, b) => b.profit - a.profit || b.bets - a.bets).slice(0, 15).forEach(r => {
    console.log(`bets=${String(r.bets).padStart(4)} cov=${(r.coverage*100).toFixed(1).padStart(5)}% WR=${r.winRate.toFixed(1).padStart(5)}% ROI=${r.roi.toFixed(1).padStart(6)}% Profit=$${r.profit.toFixed(0).padStart(5)} prof-rot=${r.profitableRotations}/${r.bettingRotations} | OV=${r.cfg.optimalOv} UN=${r.cfg.optimalUn} ${r.cfg.styleMode.padEnd(6)} poor<${r.cfg.poorHistAccThresh}`);
});
