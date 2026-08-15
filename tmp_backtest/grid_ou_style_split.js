// Tests the user's observation: DefVsDef and mixed (Agg-vs-Def) matchups can still
// clear 2.5 goals when totalXG is well above 3.1, but the current strict style gate
// (Over requires isAggVsAgg, Under requires isDefVsDef) blocks those buckets entirely
// regardless of xG. This sweeps SEPARATE per-style-bucket thresholds instead of one
// binary gate + one shared threshold, to see if a calibrated-per-bucket approach
// recovers profitable coverage from DefDef/Mixed matchups.
const fs = require('fs');
const { calculateStatistics } = require('../src/statistics');
const { calculateH2H } = require('../src/h2h_engine');
const { groupMatchesByRotation } = require('./tune');

const DATA_FILE = process.argv[2] || 'recent_21day_fresh.json';
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

// Mirrors src/predictor_ou.js's xG/style computation exactly, but with independent
// Over/Under thresholds per style bucket instead of one shared threshold + binary gate.
function genOUStyleSplit(matches, playerStats, h2hStats, historicalOUStats, cfg) {
    const results = [];
    matches.forEach(m => {
        const home = m.participantAName;
        const away = m.participantBName;
        let sHome = playerStats[home] || { avgScored: 0, avgConceded: 0, wins: 0, matches: 0, streak: [], adjScoringAbility: 0, adjDefendingAbility: 0 };
        let sAway = playerStats[away] || { avgScored: 0, avgConceded: 0, wins: 0, matches: 0, streak: [], adjScoringAbility: 0, adjDefendingAbility: 0 };
        const needsStats = (sHome.matches < 3 || sAway.matches < 3);

        let homeXG = ((parseFloat(sHome.adjScoringAbility) + parseFloat(sAway.adjDefendingAbility)) / 2);
        let awayXG = ((parseFloat(sAway.adjScoringAbility) + parseFloat(sHome.adjDefendingAbility)) / 2);
        const calcPoints = (form) => form.reduce((acc, val) => acc + (val === 'W' ? 3 : val === 'D' ? 1 : 0), 0);
        homeXG += calcPoints((sHome.streak || []).slice(-5)) * 0.05;
        awayXG += calcPoints((sAway.streak || []).slice(-5)) * 0.05;

        const pairKey = [home, away].sort().join(' vs ');
        const hStyle = (parseFloat(sHome.avgScored) + parseFloat(sHome.avgConceded)) > 3.0 ? 'Aggressive' : 'Defensive';
        const aStyle = (parseFloat(sAway.avgScored) + parseFloat(sAway.avgConceded)) > 3.0 ? 'Aggressive' : 'Defensive';

        const h2h = h2hStats[pairKey] || { matches: 0 };
        const baseTotalXG = homeXG + awayXG;
        let totalXG = baseTotalXG;
        if (h2h.matches > 0 && h2h.totalGoals !== undefined) {
            const h2hAvgGoals = h2h.totalGoals / h2h.matches;
            const h2hWeight = Math.min(h2h.matches * 0.15, 0.40);
            totalXG = (1 - h2hWeight) * baseTotalXG + h2hWeight * h2hAvgGoals;
        }

        let bucket;
        if (hStyle === 'Aggressive' && aStyle === 'Aggressive') bucket = 'AggAgg';
        else if (hStyle === 'Defensive' && aStyle === 'Defensive') bucket = 'DefDef';
        else bucket = 'Mixed';

        const overThresh = cfg.overThresh[bucket]; // null/undefined = disabled
        const underThresh = cfg.underThresh[bucket];

        let pick = null;
        if (overThresh != null && totalXG >= overThresh) pick = 'OVER';
        else if (underThresh != null && totalXG < underThresh) pick = 'UNDER';

        if (needsStats) pick = null;

        let totalOUBets = 0, combinedAcc = 0;
        if (historicalOUStats.playerOU) {
            const hOU = historicalOUStats.playerOU[home] || { bets: 0, correct: 0 };
            const aOU = historicalOUStats.playerOU[away] || { bets: 0, correct: 0 };
            totalOUBets = hOU.bets + aOU.bets;
            const totalOUCorrect = hOU.correct + aOU.correct;
            combinedAcc = totalOUBets > 0 ? (totalOUCorrect / totalOUBets) * 100 : 0;
        }
        if (pick && totalOUBets > 0 && combinedAcc < cfg.poorHistAccThresh) pick = null;

        results.push({ home, away, hs: m.teamAScore, as: m.teamBScore, pick, bucket, pairKey });
    });
    return results;
}

function evalCfg(cfg) {
    let bets = 0, wins = 0, losses = 0, totalMatches = 0;
    const bucketStats = { AggAgg: { bets: 0, wins: 0 }, DefDef: { bets: 0, wins: 0 }, Mixed: { bets: 0, wins: 0 } };
    const playerOU = {};
    const rotStats = {};
    evalKeys.forEach(key => {
        const { playerStats, h2hStats, matches } = perRotation[key];
        rotStats[key] = { bets: 0, wins: 0, losses: 0, matches: matches.length };
        totalMatches += matches.length;
        const predicted = genOUStyleSplit(matches, playerStats, h2hStats, { playerOU }, cfg);
        predicted.forEach(p => {
            if (!playerOU[p.home]) playerOU[p.home] = { bets: 0, correct: 0 };
            if (!playerOU[p.away]) playerOU[p.away] = { bets: 0, correct: 0 };
            if (!p.pick) return;
            const totalG = p.hs + p.as;
            bets++; rotStats[key].bets++;
            playerOU[p.home].bets++; playerOU[p.away].bets++;
            const won = (p.pick === 'OVER' && totalG > 2.5) || (p.pick === 'UNDER' && totalG < 2.5);
            bucketStats[p.bucket].bets++;
            if (won) { wins++; rotStats[key].wins++; playerOU[p.home].correct++; playerOU[p.away].correct++; bucketStats[p.bucket].wins++; }
            else { losses++; rotStats[key].losses++; }
        });
    });
    const winRate = pct(wins, bets);
    const roi = (winRate / 100 * PAYOUT - 1) * 100;
    const profit = bets * STAKE * (winRate / 100 * PAYOUT - 1);
    const rotList = Object.values(rotStats);
    const coverage = totalMatches > 0 ? bets / totalMatches : 0;
    const profitableRotations = rotList.filter(r => r.bets > 0 && (r.wins / r.bets) >= 0.625).length;
    const bettingRotations = rotList.filter(r => r.bets > 0).length;
    const bucketProfit = {};
    Object.entries(bucketStats).forEach(([k, v]) => {
        const wr = pct(v.wins, v.bets);
        bucketProfit[k] = { bets: v.bets, wr, profit: v.bets * STAKE * (wr / 100 * PAYOUT - 1) };
    });
    return { bets, wins, losses, totalMatches, coverage, winRate, roi, profit, profitableRotations, bettingRotations, bucketProfit };
}

// Baseline: current live (AggAgg-over@3.1 only, DefDef-under@2.6 only, Mixed fully disabled)
const BASE = { overThresh: { AggAgg: 3.1, DefDef: null, Mixed: null }, underThresh: { AggAgg: null, DefDef: 2.6, Mixed: null }, poorHistAccThresh: 40 };
const baseR = evalCfg(BASE);
console.log(`CURRENT LIVE (strict, AggAgg-over@3.1 / DefDef-under@2.6, Mixed disabled): bets=${baseR.bets} cov=${(baseR.coverage*100).toFixed(1)}% WR=${baseR.winRate.toFixed(1)}% Profit=$${baseR.profit.toFixed(0)}`);
console.log(`  by bucket: AggAgg bets=${baseR.bucketProfit.AggAgg.bets} WR=${baseR.bucketProfit.AggAgg.wr.toFixed(1)}% profit=$${baseR.bucketProfit.AggAgg.profit.toFixed(0)} | DefDef bets=${baseR.bucketProfit.DefDef.bets} WR=${baseR.bucketProfit.DefDef.wr.toFixed(1)}% profit=$${baseR.bucketProfit.DefDef.profit.toFixed(0)} | Mixed bets=${baseR.bucketProfit.Mixed.bets} WR=${baseR.bucketProfit.Mixed.wr.toFixed(1)}% profit=$${baseR.bucketProfit.Mixed.profit.toFixed(0)}`);

// First pass: how does each bucket perform STANDALONE at various thresholds, holding
// the other two buckets fully disabled? This isolates whether DefDef/Mixed Over, or
// AggAgg/Mixed Under, carry any real signal on their own before combining anything.
console.log('\n=== DefDef-Over standalone (AggAgg-over@3.1 fixed, everything else off) ===');
[3.0, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 4.0].forEach(t => {
    const cfg = { overThresh: { AggAgg: null, DefDef: t, Mixed: null }, underThresh: { AggAgg: null, DefDef: null, Mixed: null }, poorHistAccThresh: 40 };
    const r = evalCfg(cfg);
    if (r.bets < 3) return;
    console.log(`  DefDef-over>=${t}: bets=${r.bets} cov=${(r.coverage*100).toFixed(1)}% WR=${r.winRate.toFixed(1)}% Profit=$${r.profit.toFixed(0)}`);
});

console.log('\n=== Mixed-Over standalone ===');
[3.0, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 4.0].forEach(t => {
    const cfg = { overThresh: { AggAgg: null, DefDef: null, Mixed: t }, underThresh: { AggAgg: null, DefDef: null, Mixed: null }, poorHistAccThresh: 40 };
    const r = evalCfg(cfg);
    if (r.bets < 3) return;
    console.log(`  Mixed-over>=${t}: bets=${r.bets} cov=${(r.coverage*100).toFixed(1)}% WR=${r.winRate.toFixed(1)}% Profit=$${r.profit.toFixed(0)}`);
});

console.log('\n=== AggAgg-Under standalone ===');
[1.6, 1.8, 2.0, 2.2, 2.4, 2.6, 2.8].forEach(t => {
    const cfg = { overThresh: { AggAgg: null, DefDef: null, Mixed: null }, underThresh: { AggAgg: t, DefDef: null, Mixed: null }, poorHistAccThresh: 40 };
    const r = evalCfg(cfg);
    if (r.bets < 3) return;
    console.log(`  AggAgg-under<${t}: bets=${r.bets} cov=${(r.coverage*100).toFixed(1)}% WR=${r.winRate.toFixed(1)}% Profit=$${r.profit.toFixed(0)}`);
});

console.log('\n=== Mixed-Under standalone ===');
[1.6, 1.8, 2.0, 2.2, 2.4, 2.6, 2.8].forEach(t => {
    const cfg = { overThresh: { AggAgg: null, DefDef: null, Mixed: null }, underThresh: { AggAgg: null, DefDef: null, Mixed: t }, poorHistAccThresh: 40 };
    const r = evalCfg(cfg);
    if (r.bets < 3) return;
    console.log(`  Mixed-under<${t}: bets=${r.bets} cov=${(r.coverage*100).toFixed(1)}% WR=${r.winRate.toFixed(1)}% Profit=$${r.profit.toFixed(0)}`);
});

// Full combined grid: base rule always on, sweep whether adding each extra bucket rule helps.
console.log('\n=== Combined grid: base (AggAgg-over@3.1, DefDef-under@2.6) + optional extra buckets ===');
const DEFDEF_OVER = [null, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8];
const MIXED_OVER = [null, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8];
const AGGAGG_UNDER = [null, 2.0, 2.2, 2.4, 2.6];
const MIXED_UNDER = [null, 2.0, 2.2, 2.4, 2.6];
const results = [];
DEFDEF_OVER.forEach(dOver => MIXED_OVER.forEach(mOver => AGGAGG_UNDER.forEach(aUnder => MIXED_UNDER.forEach(mUnder => {
    const cfg = {
        overThresh: { AggAgg: 3.1, DefDef: dOver, Mixed: mOver },
        underThresh: { AggAgg: aUnder, DefDef: 2.6, Mixed: mUnder },
        poorHistAccThresh: 40
    };
    const r = evalCfg(cfg);
    if (r.bets < 5) return;
    results.push({ cfg, ...r });
}))));
console.log(`Configs tested: ${results.length}`);

const best = [...results].sort((a, b) => b.profit - a.profit)[0];
console.log(`\nGLOBAL BEST by profit: bets=${best.bets} cov=${(best.coverage*100).toFixed(1)}% WR=${best.winRate.toFixed(1)}% Profit=$${best.profit.toFixed(0)} | DefDef-over=${best.cfg.overThresh.DefDef} Mixed-over=${best.cfg.overThresh.Mixed} AggAgg-under=${best.cfg.underThresh.AggAgg} Mixed-under=${best.cfg.underThresh.Mixed}`);

console.log('\n=== Best-by-profit within each coverage bucket (combined grid) ===');
const buckets = [[0, 0.15], [0.15, 0.20], [0.20, 0.25], [0.25, 0.30], [0.30, 0.35], [0.35, 0.40], [0.40, 1.0]];
buckets.forEach(([lo, hi]) => {
    const inBucket = results.filter(r => r.coverage >= lo && r.coverage < hi);
    if (!inBucket.length) { console.log(`${(lo*100).toFixed(0)}-${(hi*100).toFixed(0)}%: no configs`); return; }
    const b = [...inBucket].sort((a, b2) => b2.profit - a.profit || b2.bets - a.bets)[0];
    console.log(`${(lo*100).toFixed(0)}-${(hi*100).toFixed(0)}%: bets=${String(b.bets).padStart(4)} cov=${(b.coverage*100).toFixed(1).padStart(5)}% WR=${b.winRate.toFixed(1).padStart(5)}% Profit=$${b.profit.toFixed(0).padStart(5)} prof-rot=${b.profitableRotations}/${b.bettingRotations} | DefDef-over=${b.cfg.overThresh.DefDef} Mixed-over=${b.cfg.overThresh.Mixed} AggAgg-under=${b.cfg.underThresh.AggAgg} Mixed-under=${b.cfg.underThresh.Mixed}`);
});

console.log('\n=== TOP 10 by profit (combined grid) ===');
[...results].sort((a, b) => b.profit - a.profit).slice(0, 10).forEach(r => {
    console.log(`bets=${String(r.bets).padStart(4)} cov=${(r.coverage*100).toFixed(1).padStart(5)}% WR=${r.winRate.toFixed(1).padStart(5)}% Profit=$${r.profit.toFixed(0).padStart(5)} | DefDef-over=${r.cfg.overThresh.DefDef} Mixed-over=${r.cfg.overThresh.Mixed} AggAgg-under=${r.cfg.underThresh.AggAgg} Mixed-under=${r.cfg.underThresh.Mixed}`);
});
