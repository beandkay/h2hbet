// Tune OU2.5 params on a 7-day trailing window, maximizing profit subject to a
// coverage constraint: bets placed must exceed 50% of that rotation's total matches.
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

const STAKE = 5;
const PAYOUT = 1.6;
const COVERAGE_MIN = 0.50;

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
    // Per-rotation coverage — how many rotations individually clear the 50% bar
    const rotCoverages = rotList.map(r => r.matches > 0 ? r.bets / r.matches : 0);
    const rotationsMeetingCoverage = rotCoverages.filter(c => c > COVERAGE_MIN).length;
    const avgRotCoverage = rotCoverages.length > 0 ? rotCoverages.reduce((a, b) => a + b, 0) / rotCoverages.length : 0;
    const profitableRotations = rotList.filter(r => r.bets > 0 && (r.wins / r.bets) >= 0.625).length;
    const bettingRotations = rotList.filter(r => r.bets > 0).length;
    return { bets, wins, losses, totalMatches, coverage, avgRotCoverage, rotationsMeetingCoverage, totalRotations: rotList.length, winRate, roi, profit, profitableRotations, bettingRotations };
}

const OV = [2.6, 2.7, 2.8, 2.9, 3.0, 3.1, 3.2, 3.3, 3.4, 3.5];
const UN = [2.0, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 3.0];
const STYLES = ['strict', 'mixed', 'loose', 'none'];
const POOR = [0, 40, 45, 50, 55, 60, 65]; // 0 = disabled (poorHistAccThresh never triggers since combinedAcc >= 0)

console.log('Running OU grid (7-day window, coverage-constrained)...');
const results = [];
OV.forEach(ov => UN.forEach(un => STYLES.forEach(sm => POOR.forEach(ph => {
    if (un >= ov) return;
    const cfg = { optimalOv: ov, optimalUn: un, styleMode: sm, poorHistAccThresh: ph };
    const r = evalOU(cfg);
    results.push({ cfg, ...r });
}))));

console.log(`Configs tested: ${results.length}`);

// Overall aggregate base rate for reference
const allEndedTotal = allMatches.length;
const allOver = allMatches.filter(m => (m.teamAScore + m.teamBScore) > 2.5).length;
console.log(`\nRaw base rate this window: ${allOver}/${allEndedTotal} = ${(allOver/allEndedTotal*100).toFixed(1)}% Over 2.5 (avg ${(allMatches.reduce((s,m)=>s+m.teamAScore+m.teamBScore,0)/allEndedTotal).toFixed(2)} goals/match)`);

const coverageFiltered = results.filter(r => r.coverage > COVERAGE_MIN);
console.log(`\nConfigs clearing >${(COVERAGE_MIN*100).toFixed(0)}% overall coverage: ${coverageFiltered.length} / ${results.length}`);

coverageFiltered.sort((a, b) => b.profit - a.profit || b.bets - a.bets);

console.log('\n=== TOP 20 by PROFIT (coverage > 50% of all matches in window) ===');
coverageFiltered.slice(0, 20).forEach(r => {
    console.log(`bets=${String(r.bets).padStart(4)}/${String(r.totalMatches).padStart(4)} cov=${(r.coverage*100).toFixed(0).padStart(3)}% rot-cov=${(r.avgRotCoverage*100).toFixed(0)}% (${r.rotationsMeetingCoverage}/${r.totalRotations} rots >50%) WR=${r.winRate.toFixed(1).padStart(5)}% ROI=${r.roi.toFixed(1).padStart(6)}% Profit=$${r.profit.toFixed(0).padStart(5)} prof-rot=${r.profitableRotations}/${r.bettingRotations} | OV=${r.cfg.optimalOv} UN=${r.cfg.optimalUn} style=${r.cfg.styleMode.padEnd(6)} poor<${r.cfg.poorHistAccThresh}%`);
});

console.log('\n=== TOP 10 by BETS placed (still >50% coverage), tie-break profit ===');
[...coverageFiltered].sort((a, b) => b.bets - a.bets || b.profit - a.profit).slice(0, 10).forEach(r => {
    console.log(`bets=${String(r.bets).padStart(4)}/${String(r.totalMatches).padStart(4)} cov=${(r.coverage*100).toFixed(0).padStart(3)}% WR=${r.winRate.toFixed(1).padStart(5)}% ROI=${r.roi.toFixed(1).padStart(6)}% Profit=$${r.profit.toFixed(0).padStart(5)} prof-rot=${r.profitableRotations}/${r.bettingRotations} | OV=${r.cfg.optimalOv} UN=${r.cfg.optimalUn} style=${r.cfg.styleMode.padEnd(6)} poor<${r.cfg.poorHistAccThresh}%`);
});

console.log('\n=== BEST-BY-PROFIT within each style mode (coverage > 50%) ===');
STYLES.forEach(sm => {
    const byStyle = coverageFiltered.filter(r => r.cfg.styleMode === sm);
    if (!byStyle.length) { console.log(`${sm}: no configs clear >50% coverage`); return; }
    const best = [...byStyle].sort((a, b) => b.profit - a.profit || b.bets - a.bets)[0];
    console.log(`${sm.padEnd(6)} best: bets=${best.bets}/${best.totalMatches} cov=${(best.coverage*100).toFixed(0)}% WR=${best.winRate.toFixed(1)}% ROI=${best.roi.toFixed(1)}% Profit=$${best.profit.toFixed(0)} prof-rot=${best.profitableRotations}/${best.bettingRotations} | OV=${best.cfg.optimalOv} UN=${best.cfg.optimalUn} poor<${best.cfg.poorHistAccThresh}%`);
});

// Current production (post-revert): OV=3.1/UN=2.6, strict, poor<40 — how does it fare here?
const prod = evalOU({ optimalOv: 3.1, optimalUn: 2.6, styleMode: 'strict', poorHistAccThresh: 40 });
console.log(`\nCurrent PROD (3.1/2.6, strict, <40) on this 7-day window: bets=${prod.bets}/${prod.totalMatches} cov=${(prod.coverage*100).toFixed(0)}% WR=${prod.winRate.toFixed(1)}% ROI=${prod.roi.toFixed(1)}% Profit=$${prod.profit.toFixed(0)} prof-rot=${prod.profitableRotations}/${prod.bettingRotations}`);
