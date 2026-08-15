// Per-day stability filter, replacing the noisy 7-day cross-check.
// Definition of a "stable" day: using the CURRENT LIVE configs, that calendar day's
// H2H (player winner/DNB) win rate AND OU2.5 win rate are BOTH > 60% (min 3 bets each
// side, else the day is excluded as insufficient data to judge). We then re-run the
// candidate widenings restricted to ONLY matches inside stable days, for both markets.
const fs = require('fs');
const { calculateStatistics } = require('../src/statistics');
const { calculateH2H } = require('../src/h2h_engine');
const { groupMatchesByRotation, genH2HVariant, genOUVariant } = require('./tune');

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
const dayOf = key => key.replace(/_AM$|_PM$/, '');

const LIVE_H2H = { minMatchesForStats: 3, phase1MinMatches: 5, phase1HighWR: 65, phase1LowWR: 50, phase2H2HWR: 70, phase2FormWR: 30, phase3H2HWR: 65, poorHistMinBets: 3, poorHistAccThresh: 70 };
const LIVE_OU = { optimalOv: 3.1, optimalUn: 2.6, styleMode: 'strict', poorHistAccThresh: 40 };

// Step 1: run LIVE configs across all rotations, tracking per-rotation bets/wins for both markets.
const h2hHistoryState = {};
const ouPlayerState = {};
const rotH2H = {}, rotOU = {};
evalKeys.forEach(key => {
    const { playerStats, h2hStats, matches } = perRotation[key];
    rotH2H[key] = { bets: 0, wins: 0 };
    rotOU[key] = { bets: 0, wins: 0 };

    const h2hPred = genH2HVariant(matches, playerStats, h2hStats, h2hHistoryState, LIVE_H2H);
    h2hPred.forEach(p => {
        if (!h2hHistoryState[p.pairKey]) h2hHistoryState[p.pairKey] = { dnbBets: 0, dnbCorrect: 0 };
        if (p.predictionType === "SKIP" || !p.pick || p.hs === p.as) return;
        rotH2H[key].bets++;
        h2hHistoryState[p.pairKey].dnbBets++;
        const won = (p.pick === p.home && p.hs > p.as) || (p.pick === p.away && p.as > p.hs);
        if (won) { rotH2H[key].wins++; h2hHistoryState[p.pairKey].dnbCorrect++; }
    });

    const ouPred = genOUVariant(matches, playerStats, h2hStats, { playerOU: ouPlayerState }, LIVE_OU);
    ouPred.forEach(p => {
        if (!ouPlayerState[p.home]) ouPlayerState[p.home] = { bets: 0, correct: 0 };
        if (!ouPlayerState[p.away]) ouPlayerState[p.away] = { bets: 0, correct: 0 };
        if (!p.pick) return;
        const totalG = p.hs + p.as;
        rotOU[key].bets++;
        ouPlayerState[p.home].bets++; ouPlayerState[p.away].bets++;
        const won = (p.pick === 'OVER' && totalG > 2.5) || (p.pick === 'UNDER' && totalG < 2.5);
        if (won) { rotOU[key].wins++; ouPlayerState[p.home].correct++; ouPlayerState[p.away].correct++; }
    });
});

// Step 2: merge AM+PM into calendar days, classify stability.
const days = {};
evalKeys.forEach(key => {
    const d = dayOf(key);
    if (!days[d]) days[d] = { h2hBets: 0, h2hWins: 0, ouBets: 0, ouWins: 0, rotKeys: [] };
    days[d].h2hBets += rotH2H[key].bets; days[d].h2hWins += rotH2H[key].wins;
    days[d].ouBets += rotOU[key].bets; days[d].ouWins += rotOU[key].wins;
    days[d].rotKeys.push(key);
});

const MIN_BETS_PER_SIDE = 3;
const stableDayKeys = [];
console.log('=== Per-day LIVE performance (H2H / OU) ===');
Object.keys(days).sort().forEach(d => {
    const day = days[d];
    const h2hWR = pct(day.h2hWins, day.h2hBets);
    const ouWR = pct(day.ouWins, day.ouBets);
    const hasEnough = day.h2hBets >= MIN_BETS_PER_SIDE && day.ouBets >= MIN_BETS_PER_SIDE;
    const stable = hasEnough && h2hWR > 60 && ouWR > 60;
    if (stable) stableDayKeys.push(...day.rotKeys);
    console.log(`${d}: H2H bets=${String(day.h2hBets).padStart(3)} WR=${h2hWR.toFixed(1).padStart(5)}% | OU bets=${String(day.ouBets).padStart(3)} WR=${ouWR.toFixed(1).padStart(5)}% ${stable ? '<-- STABLE' : (hasEnough ? '' : '(insufficient bets)')}`);
});

const stableSet = new Set(stableDayKeys);
console.log(`\nStable rotation blocks: ${stableDayKeys.length} / ${evalKeys.length} (days with H2H WR>60% AND OU WR>60%, min ${MIN_BETS_PER_SIDE} bets each)`);
const stableEvalKeys = evalKeys.filter(k => stableSet.has(k));
if (!stableEvalKeys.length) { console.log('No stable rotations found - cannot proceed.'); process.exit(0); }

// Step 3: re-run baseline vs candidates restricted to stable rotations only.
function evalH2HOn(keysToUse, cfg) {
    let bets = 0, wins = 0, totalMatches = 0, attempted = 0;
    const h2hHistory = {};
    keysToUse.forEach(key => {
        const { playerStats, h2hStats, matches } = perRotation[key];
        totalMatches += matches.length;
        const predicted = genH2HVariant(matches, playerStats, h2hStats, h2hHistory, cfg);
        predicted.forEach(p => {
            if (!h2hHistory[p.pairKey]) h2hHistory[p.pairKey] = { dnbBets: 0, dnbCorrect: 0 };
            if (p.predictionType === "SKIP" || !p.pick) return;
            attempted++;
            if (p.hs === p.as) return;
            bets++;
            h2hHistory[p.pairKey].dnbBets++;
            const won = (p.pick === p.home && p.hs > p.as) || (p.pick === p.away && p.as > p.hs);
            if (won) { wins++; h2hHistory[p.pairKey].dnbCorrect++; }
        });
    });
    const winRate = pct(wins, bets);
    const profit = bets * STAKE * (winRate / 100 * PAYOUT - 1);
    return { bets, winRate, profit, coverage: totalMatches > 0 ? attempted / totalMatches : 0, totalMatches };
}

function evalOUOn(keysToUse, cfg) {
    let bets = 0, wins = 0, totalMatches = 0;
    const playerOU = {};
    keysToUse.forEach(key => {
        const { playerStats, h2hStats, matches } = perRotation[key];
        totalMatches += matches.length;
        const predicted = genOUVariant(matches, playerStats, h2hStats, { playerOU }, cfg);
        predicted.forEach(p => {
            if (!playerOU[p.home]) playerOU[p.home] = { bets: 0, correct: 0 };
            if (!playerOU[p.away]) playerOU[p.away] = { bets: 0, correct: 0 };
            if (!p.pick) return;
            const totalG = p.hs + p.as;
            bets++;
            playerOU[p.home].bets++; playerOU[p.away].bets++;
            const won = (p.pick === 'OVER' && totalG > 2.5) || (p.pick === 'UNDER' && totalG < 2.5);
            if (won) { wins++; playerOU[p.home].correct++; playerOU[p.away].correct++; }
        });
    });
    const winRate = pct(wins, bets);
    const profit = bets * STAKE * (winRate / 100 * PAYOUT - 1);
    return { bets, winRate, profit, coverage: totalMatches > 0 ? bets / totalMatches : 0, totalMatches };
}

console.log('\n=== H2H: LIVE vs widening candidates, restricted to STABLE rotations only ===');
const H2H_CANDIDATES = {
    'LIVE (4.6% target)': LIVE_H2H,
    'WIDEN ~7% (P1:55/45 P2:70/30 P3:65 poor<70)': { minMatchesForStats: 3, phase1MinMatches: 5, phase1HighWR: 55, phase1LowWR: 45, phase2H2HWR: 70, phase2FormWR: 30, phase3H2HWR: 65, poorHistMinBets: 3, poorHistAccThresh: 70 },
    'WIDEN ~10% (P1:55/45 P2:70/30 P3:55 poor<50)': { minMatchesForStats: 3, phase1MinMatches: 5, phase1HighWR: 55, phase1LowWR: 45, phase2H2HWR: 70, phase2FormWR: 30, phase3H2HWR: 55, poorHistMinBets: 3, poorHistAccThresh: 50 },
};
Object.entries(H2H_CANDIDATES).forEach(([label, cfg]) => {
    const rAll = evalH2HOn(evalKeys, cfg);
    const rStable = evalH2HOn(stableEvalKeys, cfg);
    console.log(`${label}:`);
    console.log(`  ALL rotations:    bets=${rAll.bets} cov=${(rAll.coverage*100).toFixed(1)}% WR=${rAll.winRate.toFixed(1)}% Profit=$${rAll.profit.toFixed(0)}`);
    console.log(`  STABLE only:      bets=${rStable.bets} cov=${(rStable.coverage*100).toFixed(1)}% WR=${rStable.winRate.toFixed(1)}% Profit=$${rStable.profit.toFixed(0)}`);
});

// Style-bucket-split OU model (mirrors grid_ou_style_split.js's genOUStyleSplit exactly),
// needed because the real candidate under discussion is "add Mixed-Over@3.8" on top of
// the existing AggAgg-over@3.1/DefDef-under@2.6 gate - not a generic loose-style widen.
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

        const overThresh = cfg.overThresh[bucket];
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

function evalOUStyleSplitOn(keysToUse, cfg) {
    let bets = 0, wins = 0, totalMatches = 0;
    const playerOU = {};
    keysToUse.forEach(key => {
        const { playerStats, h2hStats, matches } = perRotation[key];
        totalMatches += matches.length;
        const predicted = genOUStyleSplit(matches, playerStats, h2hStats, { playerOU }, cfg);
        predicted.forEach(p => {
            if (!playerOU[p.home]) playerOU[p.home] = { bets: 0, correct: 0 };
            if (!playerOU[p.away]) playerOU[p.away] = { bets: 0, correct: 0 };
            if (!p.pick) return;
            const totalG = p.hs + p.as;
            bets++;
            playerOU[p.home].bets++; playerOU[p.away].bets++;
            const won = (p.pick === 'OVER' && totalG > 2.5) || (p.pick === 'UNDER' && totalG < 2.5);
            if (won) { wins++; playerOU[p.home].correct++; playerOU[p.away].correct++; }
        });
    });
    const winRate = pct(wins, bets);
    const profit = bets * STAKE * (winRate / 100 * PAYOUT - 1);
    return { bets, winRate, profit, coverage: totalMatches > 0 ? bets / totalMatches : 0, totalMatches };
}

console.log('\n=== OU: LIVE vs Mixed-bucket widening candidates, restricted to STABLE rotations only ===');
const OU_CANDIDATES = {
    'LIVE (AggAgg-over@3.1 / DefDef-under@2.6, Mixed off)': { overThresh: { AggAgg: 3.1, DefDef: null, Mixed: null }, underThresh: { AggAgg: null, DefDef: 2.6, Mixed: null }, poorHistAccThresh: 40 },
    '+Mixed-Over@3.8 only': { overThresh: { AggAgg: 3.1, DefDef: null, Mixed: 3.8 }, underThresh: { AggAgg: null, DefDef: 2.6, Mixed: null }, poorHistAccThresh: 40 },
    '+Mixed-Over@3.8 +Mixed-Under@2.6 (combined-grid global best)': { overThresh: { AggAgg: 3.1, DefDef: null, Mixed: 3.8 }, underThresh: { AggAgg: null, DefDef: 2.6, Mixed: 2.6 }, poorHistAccThresh: 40 },
};
Object.entries(OU_CANDIDATES).forEach(([label, cfg]) => {
    const rAll = evalOUStyleSplitOn(evalKeys, cfg);
    const rStable = evalOUStyleSplitOn(stableEvalKeys, cfg);
    console.log(`${label}:`);
    console.log(`  ALL rotations:    bets=${rAll.bets} cov=${(rAll.coverage*100).toFixed(1)}% WR=${rAll.winRate.toFixed(1)}% Profit=$${rAll.profit.toFixed(0)}`);
    console.log(`  STABLE only:      bets=${rStable.bets} cov=${(rStable.coverage*100).toFixed(1)}% WR=${rStable.winRate.toFixed(1)}% Profit=$${rStable.profit.toFixed(0)}`);
});
