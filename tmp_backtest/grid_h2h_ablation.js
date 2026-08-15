// Structural ablation of the H2H 3-phase model, per user request:
// "could just remove phase 1 and 2, or just phase 2, or just use simple filter?"
// Compares 4 structures at/near the 10% coverage target:
//   FULL          - current 3-phase (phase1 <3, phase2 3-9, phase3 10+)  [reference]
//   PHASE3_ONLY   - remove phase1 AND phase2, only bet h2hMatches>=10
//   PHASE1_PHASE3 - remove phase2 only, bet <3 (form) or >=10 (h2h wr), skip 3-9
//   SIMPLE        - single global h2h-winrate threshold from simpleMinH2H matches on,
//                   optional form-based fallback below that, no phase2/phase3 split
const fs = require('fs');
const { calculateStatistics } = require('../src/statistics');
const { calculateH2H } = require('../src/h2h_engine');
const { groupMatchesByRotation, genH2HVariant } = require('./tune');

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

// Mirrors genH2HVariant's per-match plumbing but swaps in structural variants.
function genH2HAblation(matches, playerStats, h2hStats, historicalH2HStats, cfg) {
    const results = [];
    matches.forEach(m => {
        const home = m.participantAName;
        const away = m.participantBName;
        let sHome = playerStats[home] || { matches: 0, wins: 0 };
        let sAway = playerStats[away] || { matches: 0, wins: 0 };
        const needsStats = (sHome.matches < cfg.minMatchesForStats || sAway.matches < cfg.minMatchesForStats);
        const homeWinRate = sHome.matches > 0 ? (sHome.wins / sHome.matches) * 100 : 0;
        const awayWinRate = sAway.matches > 0 ? (sAway.wins / sAway.matches) * 100 : 0;
        const pairKey = [home, away].sort().join(' vs ');
        const h2h = h2hStats[pairKey] || { matches: 0 };
        let h2hMatches = h2h.matches || 0;
        let h2hHomeWins = h2h[home] || 0;
        let h2hAwayWins = h2h[away] || 0;
        const h2hHomeWR = h2hMatches > 0 ? (h2hHomeWins / h2hMatches) * 100 : 0;
        const h2hAwayWR = h2hMatches > 0 ? (h2hAwayWins / h2hMatches) * 100 : 0;

        let predictionType = "SKIP";
        let pick = null;

        const formRule = () => {
            if (sHome.matches >= cfg.phase1MinMatches && sAway.matches >= cfg.phase1MinMatches) {
                if (homeWinRate >= cfg.phase1HighWR && awayWinRate <= cfg.phase1LowWR) { pick = home; predictionType = "FORM"; }
                else if (awayWinRate >= cfg.phase1HighWR && homeWinRate <= cfg.phase1LowWR) { pick = away; predictionType = "FORM"; }
            }
        };

        if (cfg.structure === 'PHASE3_ONLY') {
            if (h2hMatches >= 10) {
                if (h2hHomeWR >= cfg.phase3H2HWR) { pick = home; predictionType = "PHASE3"; }
                else if (h2hAwayWR >= cfg.phase3H2HWR) { pick = away; predictionType = "PHASE3"; }
            }
        } else if (cfg.structure === 'PHASE1_PHASE3') {
            if (h2hMatches < 3) {
                formRule();
            } else if (h2hMatches >= 10) {
                if (h2hHomeWR >= cfg.phase3H2HWR) { pick = home; predictionType = "PHASE3"; }
                else if (h2hAwayWR >= cfg.phase3H2HWR) { pick = away; predictionType = "PHASE3"; }
            }
            // 3-9 matches: no phase2 -> always SKIP
        } else if (cfg.structure === 'SIMPLE') {
            if (h2hMatches >= cfg.simpleMinH2H) {
                if (h2hHomeWR >= cfg.simpleH2HWR) { pick = home; predictionType = "SIMPLE"; }
                else if (h2hAwayWR >= cfg.simpleH2HWR) { pick = away; predictionType = "SIMPLE"; }
            } else if (cfg.simpleFallbackForm) {
                formRule();
            }
        }

        if (needsStats) { predictionType = "SKIP"; pick = null; }

        let h2hPredAcc = null, h2hPredBets = 0;
        if (historicalH2HStats[pairKey] && historicalH2HStats[pairKey].dnbBets > 0) {
            h2hPredBets = historicalH2HStats[pairKey].dnbBets;
            h2hPredAcc = (historicalH2HStats[pairKey].dnbCorrect / h2hPredBets) * 100;
        }
        if (predictionType !== "SKIP" && h2hPredBets >= cfg.poorHistMinBets && h2hPredAcc < cfg.poorHistAccThresh) {
            predictionType = "SKIP"; pick = null;
        }

        results.push({ home, away, hs: m.teamAScore, as: m.teamBScore, pick, predictionType, pairKey });
    });
    return results;
}

function evalStructure(cfg, genFn) {
    let bets = 0, wins = 0, losses = 0, totalMatches = 0, attempted = 0;
    const h2hHistory = {};
    const rotStats = {};
    evalKeys.forEach(key => {
        const { playerStats, h2hStats, matches } = perRotation[key];
        rotStats[key] = { bets: 0, wins: 0, losses: 0, matches: matches.length };
        totalMatches += matches.length;
        const predicted = genFn(matches, playerStats, h2hStats, h2hHistory, cfg);
        predicted.forEach(p => {
            if (!h2hHistory[p.pairKey]) h2hHistory[p.pairKey] = { dnbBets: 0, dnbCorrect: 0 };
            if (p.predictionType === "SKIP" || !p.pick) return;
            attempted++;
            if (p.hs === p.as) return;
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
    const coverage = totalMatches > 0 ? attempted / totalMatches : 0;
    const profitableRotations = rotList.filter(r => r.bets > 0 && (r.wins / r.bets) >= 0.625).length;
    const bettingRotations = rotList.filter(r => r.bets > 0).length;
    return { bets, wins, losses, attempted, totalMatches, coverage, winRate, roi, profit, profitableRotations, bettingRotations };
}

const results = [];

// --- PHASE3_ONLY ---
[50, 55, 60, 65, 70, 75, 80].forEach(p3h => [0, 50, 55, 60, 65, 70].forEach(ph => {
    const cfg = { structure: 'PHASE3_ONLY', minMatchesForStats: 3, phase1MinMatches: 5, phase3H2HWR: p3h, poorHistMinBets: 3, poorHistAccThresh: ph };
    const r = evalStructure(cfg, genH2HAblation);
    if (r.bets < 5) return;
    results.push({ structure: 'PHASE3_ONLY', cfg, ...r });
}));

// --- PHASE1_PHASE3 (no phase2) ---
[50, 55, 60, 65, 70, 75, 80].forEach(p1h => [25, 30, 35, 40, 45, 50].forEach(p1l => {
    if (p1l >= p1h - 5) return;
    [50, 55, 60, 65, 70, 75, 80].forEach(p3h => [0, 50, 55, 60, 65, 70].forEach(ph => {
        const cfg = { structure: 'PHASE1_PHASE3', minMatchesForStats: 3, phase1MinMatches: 5, phase1HighWR: p1h, phase1LowWR: p1l, phase3H2HWR: p3h, poorHistMinBets: 3, poorHistAccThresh: ph };
        const r = evalStructure(cfg, genH2HAblation);
        if (r.bets < 5) return;
        results.push({ structure: 'PHASE1_PHASE3', cfg, ...r });
    }));
}));

// --- SIMPLE (single global h2h threshold, optional form fallback) ---
[1, 2, 3, 5, 8, 10].forEach(minH2H => [50, 55, 60, 65, 70, 75, 80].forEach(h2hwr => [false, true].forEach(fallback => [0, 50, 55, 60, 65, 70].forEach(ph => {
    const cfg = {
        structure: 'SIMPLE', minMatchesForStats: 3, phase1MinMatches: 5,
        simpleMinH2H: minH2H, simpleH2HWR: h2hwr, simpleFallbackForm: fallback,
        phase1HighWR: 65, phase1LowWR: 50, // fixed at previously-tuned form thresholds
        poorHistMinBets: 3, poorHistAccThresh: ph
    };
    const r = evalStructure(cfg, genH2HAblation);
    if (r.bets < 5) return;
    results.push({ structure: 'SIMPLE', cfg, ...r });
}))));

console.log(`Configs tested (with >=5 bets): ${results.length} (PHASE3_ONLY / PHASE1_PHASE3 / SIMPLE)`);

// Reference: current live FULL 3-phase (post-update thresholds)
const fullCfg = { minMatchesForStats: 3, phase1MinMatches: 5, phase1HighWR: 65, phase1LowWR: 50, phase2H2HWR: 70, phase2FormWR: 30, phase3H2HWR: 65, poorHistMinBets: 3, poorHistAccThresh: 70 };
const fullEval = (() => {
    let bets = 0, wins = 0, losses = 0, totalMatches = 0, attempted = 0;
    const h2hHistory = {};
    evalKeys.forEach(key => {
        const { playerStats, h2hStats, matches } = perRotation[key];
        totalMatches += matches.length;
        const predicted = genH2HVariant(matches, playerStats, h2hStats, h2hHistory, fullCfg);
        predicted.forEach(p => {
            if (!h2hHistory[p.pairKey]) h2hHistory[p.pairKey] = { dnbBets: 0, dnbCorrect: 0 };
            if (p.predictionType === "SKIP" || !p.pick) return;
            attempted++;
            if (p.hs === p.as) return;
            bets++;
            h2hHistory[p.pairKey].dnbBets++;
            const won = (p.pick === p.home && p.hs > p.as) || (p.pick === p.away && p.as > p.hs);
            if (won) { wins++; h2hHistory[p.pairKey].dnbCorrect++; } else { losses++; }
        });
    });
    const winRate = pct(wins, bets);
    const roi = (winRate / 100 * PAYOUT - 1) * 100;
    const profit = bets * STAKE * (winRate / 100 * PAYOUT - 1);
    return { bets, wins, losses, attempted, totalMatches, coverage: totalMatches > 0 ? attempted / totalMatches : 0, winRate, roi, profit };
})();
console.log(`\nFULL 3-phase (current live, P1:65/50 P2:70/30 P3:65 poor<70): bets=${fullEval.bets} cov=${(fullEval.coverage*100).toFixed(1)}% WR=${fullEval.winRate.toFixed(1)}% Profit=$${fullEval.profit.toFixed(0)}`);

['PHASE3_ONLY', 'PHASE1_PHASE3', 'SIMPLE'].forEach(structure => {
    const rows = results.filter(r => r.structure === structure);
    console.log(`\n=== ${structure}: best-by-profit within each coverage bucket ===`);
    const buckets = [[0, 0.05], [0.05, 0.10], [0.10, 0.15], [0.15, 0.20], [0.20, 0.25], [0.25, 1.0]];
    buckets.forEach(([lo, hi]) => {
        const inBucket = rows.filter(r => r.coverage >= lo && r.coverage < hi);
        if (!inBucket.length) { console.log(`  ${(lo*100).toFixed(0)}-${(hi*100).toFixed(0)}%: no configs`); return; }
        const b = [...inBucket].sort((a, b2) => b2.profit - a.profit || b2.bets - a.bets)[0];
        const cfgStr = structure === 'PHASE3_ONLY' ? `P3:${b.cfg.phase3H2HWR} poor<${b.cfg.poorHistAccThresh}`
            : structure === 'PHASE1_PHASE3' ? `P1:${b.cfg.phase1HighWR}/${b.cfg.phase1LowWR} P3:${b.cfg.phase3H2HWR} poor<${b.cfg.poorHistAccThresh}`
            : `minH2H:${b.cfg.simpleMinH2H} h2hWR:${b.cfg.simpleH2HWR} fallback:${b.cfg.simpleFallbackForm} poor<${b.cfg.poorHistAccThresh}`;
        console.log(`  ${(lo*100).toFixed(0)}-${(hi*100).toFixed(0)}%: bets=${String(b.bets).padStart(4)} cov=${(b.coverage*100).toFixed(1).padStart(5)}% WR=${b.winRate.toFixed(1).padStart(5)}% ROI=${b.roi.toFixed(1).padStart(6)}% Profit=$${b.profit.toFixed(0).padStart(5)} prof-rot=${b.profitableRotations}/${b.bettingRotations} | ${cfgStr}`);
    });
});

console.log(`\n=== Closest-to-10% coverage, best profit, per structure ===`);
['PHASE3_ONLY', 'PHASE1_PHASE3', 'SIMPLE'].forEach(structure => {
    const rows = results.filter(r => r.structure === structure && r.coverage >= 0.08 && r.coverage <= 0.13);
    if (!rows.length) { console.log(`${structure}: no configs in 8-13% coverage band`); return; }
    const best = [...rows].sort((a, b) => b.profit - a.profit)[0];
    const cfgStr = structure === 'PHASE3_ONLY' ? `P3:${best.cfg.phase3H2HWR} poor<${best.cfg.poorHistAccThresh}`
        : structure === 'PHASE1_PHASE3' ? `P1:${best.cfg.phase1HighWR}/${best.cfg.phase1LowWR} P3:${best.cfg.phase3H2HWR} poor<${best.cfg.poorHistAccThresh}`
        : `minH2H:${best.cfg.simpleMinH2H} h2hWR:${best.cfg.simpleH2HWR} fallback:${best.cfg.simpleFallbackForm} poor<${best.cfg.poorHistAccThresh}`;
    console.log(`${structure}: bets=${best.bets} cov=${(best.coverage*100).toFixed(1)}% WR=${best.winRate.toFixed(1)}% Profit=$${best.profit.toFixed(0)} | ${cfgStr}`);
});
