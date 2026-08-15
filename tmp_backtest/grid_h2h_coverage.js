// H2H-only profit/coverage frontier — mirrors grid_7day_coverage.js's OU approach but
// for the 3-phase winner/DNB market, evaluated independently (no OU coverage requirement).
// Question: is the current live H2H config (P1:55/40 P2:70/35 P3:60 poor<60) actually
// optimal, or does some other combination yield more profit at the same/better coverage?
const fs = require('fs');
const { calculateStatistics } = require('../src/statistics');
const { calculateH2H } = require('../src/h2h_engine');
const { groupMatchesByRotation, genH2HVariant } = require('./tune');

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

function pct(n, d) { return d > 0 ? (n / d * 100) : 0; }

function evalH2H(cfg) {
    let bets = 0, wins = 0, losses = 0, totalMatches = 0, attempted = 0;
    const h2hHistory = {};
    const rotStats = {};
    evalKeys.forEach(key => {
        const { playerStats, h2hStats, matches } = perRotation[key];
        rotStats[key] = { bets: 0, wins: 0, losses: 0, matches: matches.length };
        totalMatches += matches.length;
        const predicted = genH2HVariant(matches, playerStats, h2hStats, h2hHistory, cfg);
        predicted.forEach(p => {
            if (!h2hHistory[p.pairKey]) h2hHistory[p.pairKey] = { dnbBets: 0, dnbCorrect: 0 };
            if (p.predictionType === "SKIP" || !p.pick) return;
            attempted++; // counted for coverage even on eventual draws (DNB push)
            if (p.hs === p.as) return; // draw -> push, ignore for win-rate/settlement
            bets++; rotStats[key].bets++;
            h2hHistory[p.pairKey].dnbBets++;
            const won = (p.pick === p.home && p.hs > p.as) || (p.pick === p.away && p.as > p.hs);
            if (won) { wins++; rotStats[key].wins++; h2hHistory[p.pairKey].dnbCorrect++; }
            else { losses++; rotStats[key].losses++; }
        });
    });
    const winRate = pct(wins, bets);
    const roi = (winRate / 100 * PAYOUT - 1) * 100;
    const profit = bets * STAKE * (winRate / 100 * PAYOUT - 1);
    const rotList = Object.values(rotStats);
    // Coverage = attempted (all non-SKIP picks, including eventual draws) / totalMatches,
    // since "coverage" is about willingness to bet at prediction time, not settlement.
    const coverage = totalMatches > 0 ? attempted / totalMatches : 0;
    const rotCoverages = rotList.map(r => r.matches > 0 ? r.bets / r.matches : 0);
    const avgRotCoverage = rotCoverages.length > 0 ? rotCoverages.reduce((a, b) => a + b, 0) / rotCoverages.length : 0;
    const profitableRotations = rotList.filter(r => r.bets > 0 && (r.wins / r.bets) >= 0.625).length;
    const bettingRotations = rotList.filter(r => r.bets > 0).length;
    return { bets, wins, losses, attempted, totalMatches, coverage, avgRotCoverage, winRate, roi, profit, profitableRotations, bettingRotations };
}

const H2H_BASE = { minMatchesForStats: 3, phase1MinMatches: 5, poorHistMinBets: 3 };
const P1_HIGH = [50, 55, 60, 65, 70, 75, 80];
const P1_LOW = [25, 30, 35, 40, 45, 50];
const P2_H2H = [50, 55, 60, 65, 70, 75, 80];
const P2_FORM = [25, 30, 35, 40, 45, 50];
const P3_H2H = [50, 55, 60, 65, 70, 75, 80];
const POOR = [0, 50, 55, 60, 65, 70];

console.log('Running H2H-only grid (coverage/profit frontier)...');
const results = [];
P1_HIGH.forEach(p1h => P1_LOW.forEach(p1l => {
    if (p1l >= p1h - 5) return;
    P2_H2H.forEach(p2h => P2_FORM.forEach(p2f => P3_H2H.forEach(p3h => POOR.forEach(ph => {
        const cfg = { ...H2H_BASE, phase1HighWR: p1h, phase1LowWR: p1l, phase2H2HWR: p2h, phase2FormWR: p2f, phase3H2HWR: p3h, poorHistAccThresh: ph };
        const r = evalH2H(cfg);
        if (r.bets < 5) return; // drop near-empty configs from the frontier
        results.push({ cfg, ...r });
    }))));
}));
console.log(`Configs tested (with >=5 bets): ${results.length}`);

const liveCfg = { minMatchesForStats: 3, phase1MinMatches: 5, phase1HighWR: 55, phase1LowWR: 40, phase2H2HWR: 70, phase2FormWR: 35, phase3H2HWR: 60, poorHistMinBets: 3, poorHistAccThresh: 60 };
const live = evalH2H(liveCfg);
console.log(`\nCURRENT LIVE (P1:55/40 P2:70/35 P3:60 poor<60): bets=${live.bets} attempted=${live.attempted}/${live.totalMatches} cov=${(live.coverage*100).toFixed(1)}% WR=${live.winRate.toFixed(1)}% ROI=${live.roi.toFixed(1)}% Profit=$${live.profit.toFixed(0)} prof-rot=${live.profitableRotations}/${live.bettingRotations}`);

// Global best by profit, no coverage floor.
const best = [...results].sort((a, b) => b.profit - a.profit || b.bets - a.bets)[0];
console.log(`\nGLOBAL BEST by profit (any coverage): bets=${best.bets} cov=${(best.coverage*100).toFixed(1)}% WR=${best.winRate.toFixed(1)}% ROI=${best.roi.toFixed(1)}% Profit=$${best.profit.toFixed(0)} | P1:${best.cfg.phase1HighWR}/${best.cfg.phase1LowWR} P2:${best.cfg.phase2H2HWR}/${best.cfg.phase2FormWR} P3:${best.cfg.phase3H2HWR} poor<${best.cfg.poorHistAccThresh}`);

// Profit/coverage frontier: best profit within each coverage bucket.
console.log('\n=== Best-by-profit within each coverage bucket ===');
const buckets = [[0, 0.05], [0.05, 0.10], [0.10, 0.15], [0.15, 0.20], [0.20, 0.25], [0.25, 0.30], [0.30, 0.40], [0.40, 1.0]];
buckets.forEach(([lo, hi]) => {
    const inBucket = results.filter(r => r.coverage >= lo && r.coverage < hi);
    if (!inBucket.length) { console.log(`${(lo*100).toFixed(0)}-${(hi*100).toFixed(0)}%: no configs`); return; }
    const b = [...inBucket].sort((a, b2) => b2.profit - a.profit || b2.bets - a.bets)[0];
    console.log(`${(lo*100).toFixed(0)}-${(hi*100).toFixed(0)}%: bets=${String(b.bets).padStart(4)} cov=${(b.coverage*100).toFixed(1).padStart(5)}% WR=${b.winRate.toFixed(1).padStart(5)}% ROI=${b.roi.toFixed(1).padStart(6)}% Profit=$${b.profit.toFixed(0).padStart(5)} prof-rot=${b.profitableRotations}/${b.bettingRotations} | P1:${b.cfg.phase1HighWR}/${b.cfg.phase1LowWR} P2:${b.cfg.phase2H2HWR}/${b.cfg.phase2FormWR} P3:${b.cfg.phase3H2HWR} poor<${b.cfg.poorHistAccThresh}`);
});

console.log('\n=== TOP 15 by PROFIT (all configs, any coverage) ===');
[...results].sort((a, b) => b.profit - a.profit || b.bets - a.bets).slice(0, 15).forEach(r => {
    console.log(`bets=${String(r.bets).padStart(4)} cov=${(r.coverage*100).toFixed(1).padStart(5)}% WR=${r.winRate.toFixed(1).padStart(5)}% ROI=${r.roi.toFixed(1).padStart(6)}% Profit=$${r.profit.toFixed(0).padStart(5)} prof-rot=${r.profitableRotations}/${r.bettingRotations} | P1:${r.cfg.phase1HighWR}/${r.cfg.phase1LowWR} P2:${r.cfg.phase2H2HWR}/${r.cfg.phase2FormWR} P3:${r.cfg.phase3H2HWR} poor<${r.cfg.poorHistAccThresh}`);
});

console.log('\n=== TOP 15 by ROI (min 30 bets) ===');
[...results].filter(r => r.bets >= 30).sort((a, b) => b.roi - a.roi || b.bets - a.bets).slice(0, 15).forEach(r => {
    console.log(`bets=${String(r.bets).padStart(4)} cov=${(r.coverage*100).toFixed(1).padStart(5)}% WR=${r.winRate.toFixed(1).padStart(5)}% ROI=${r.roi.toFixed(1).padStart(6)}% Profit=$${r.profit.toFixed(0).padStart(5)} | P1:${r.cfg.phase1HighWR}/${r.cfg.phase1LowWR} P2:${r.cfg.phase2H2HWR}/${r.cfg.phase2FormWR} P3:${r.cfg.phase3H2HWR} poor<${r.cfg.poorHistAccThresh}`);
});
