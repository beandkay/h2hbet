// User's new hypothesis: for DefDef or Mixed matchups where totalXG clears some lower
// bar (e.g. 3.5) but not the bucket's normal Over threshold (DefDef has no Over gate at
// all today; Mixed requires 3.8), if this exact pairing's H2H history shows a MAJORITY
// of past meetings went over 2.5, add an OVER pick anyway - h2h scoring pattern as a
// secondary signal that overrides a merely-borderline xG read.
// Sweeps: xG low-bound for the override band, min H2H matches required, and the
// majority threshold (h2hOverRate > X%), stacked ON TOP of the current shipped config
// (AggAgg-over@3.1, DefDef-under@2.6, Mixed-over@3.8/Mixed-under@2.6, rotation-warmup skip).
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

function hoursIntoRotation(startDate) {
    const aestDate = new Date(new Date(startDate).getTime() + 10 * 60 * 60 * 1000);
    const hour = aestDate.getUTCHours();
    const minute = aestDate.getUTCMinutes();
    if (hour >= 4 && hour < 16) return (hour - 4) + minute / 60;
    else if (hour >= 16) return (hour - 16) + minute / 60;
    else return (hour + 8) + minute / 60;
}

// Mirrors src/predictor_ou.js exactly (current shipped state: style-bucket split +
// rotation-warmup skip), plus the new H2H-majority-override rule.
function genOUWithH2HOverride(matches, playerStats, h2hStats, historicalOUStats, cfg) {
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

        // New rule: DefDef/Mixed, xG in [overrideLow, bucket's normal over threshold),
        // h2h history majority-over -> OVER anyway.
        if (!pick && cfg.overrideEnabled && (bucket === 'DefDef' || bucket === 'Mixed') && h2h.matches >= cfg.overrideMinH2H) {
            const overCount = (h2h.historyOU || []).filter(x => x === 'OVER').length;
            const h2hOverRate = (overCount / h2h.matches) * 100;
            const bucketOverCap = overThresh != null ? overThresh : Infinity;
            if (totalXG >= cfg.overrideLowXG && totalXG < bucketOverCap && h2hOverRate > cfg.overrideMajorityPct) {
                pick = 'OVER';
            }
        }

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

        if (pick && cfg.rotationWarmupSkip && hoursIntoRotation(m.startDate) < 1) pick = null;

        results.push({ home, away, hs: m.teamAScore, as: m.teamBScore, pick, bucket, pairKey, viaOverride: pick === 'OVER' && !(overThresh != null && totalXG >= overThresh) });
    });
    return results;
}

function evalCfg(cfg) {
    let bets = 0, wins = 0, totalMatches = 0;
    let ovrBets = 0, ovrWins = 0;
    const playerOU = {};
    evalKeys.forEach(key => {
        const { playerStats, h2hStats, matches } = perRotation[key];
        totalMatches += matches.length;
        const predicted = genOUWithH2HOverride(matches, playerStats, h2hStats, { playerOU }, cfg);
        predicted.forEach(p => {
            if (!playerOU[p.home]) playerOU[p.home] = { bets: 0, correct: 0 };
            if (!playerOU[p.away]) playerOU[p.away] = { bets: 0, correct: 0 };
            if (!p.pick) return;
            const totalG = p.hs + p.as;
            const won = (p.pick === 'OVER' && totalG > 2.5) || (p.pick === 'UNDER' && totalG < 2.5);
            bets++;
            playerOU[p.home].bets++; playerOU[p.away].bets++;
            if (won) { wins++; playerOU[p.home].correct++; playerOU[p.away].correct++; }
            if (p.viaOverride) { ovrBets++; if (won) ovrWins++; }
        });
    });
    const winRate = pct(wins, bets);
    const profit = bets * STAKE * (winRate / 100 * PAYOUT - 1);
    const ovrWR = pct(ovrWins, ovrBets);
    const ovrProfit = ovrBets * STAKE * (ovrWR / 100 * PAYOUT - 1);
    return { bets, winRate, profit, coverage: totalMatches > 0 ? bets / totalMatches : 0, totalMatches, ovrBets, ovrWR, ovrProfit };
}

const BASELINE = { overThresh: { AggAgg: 3.1, DefDef: null, Mixed: 3.8 }, underThresh: { AggAgg: null, DefDef: 2.6, Mixed: 2.6 }, poorHistAccThresh: 40, rotationWarmupSkip: true, overrideEnabled: false };
const base = evalCfg(BASELINE);
console.log(`CURRENT SHIPPED (AggAgg-over@3.1, DefDef-under@2.6, Mixed@3.8/2.6, rotation-warmup skip): bets=${base.bets} cov=${(base.coverage*100).toFixed(1)}% WR=${base.winRate.toFixed(1)}% Profit=$${base.profit.toFixed(0)}`);

console.log('\n=== + H2H-majority-override for DefDef/Mixed, sweeping (xG low-bound, min H2H matches, majority %) ===');
const results = [];
[3.2, 3.3, 3.4, 3.5, 3.6, 3.7].forEach(lowXG => {
    [2, 3, 5].forEach(minH2H => {
        [50, 55, 60, 65, 70].forEach(majPct => {
            const cfg = { ...BASELINE, overrideEnabled: true, overrideLowXG: lowXG, overrideMinH2H: minH2H, overrideMajorityPct: majPct };
            const r = evalCfg(cfg);
            if (r.ovrBets < 1) return;
            results.push({ lowXG, minH2H, majPct, ...r });
        });
    });
});
console.log(`Configs with >=1 override bet triggered: ${results.length}`);

console.log('\n=== All configs (sorted by total profit desc) ===');
[...results].sort((a, b) => b.profit - a.profit).forEach(r => {
    console.log(`xGlow=${r.lowXG} minH2H=${r.minH2H} maj>${r.majPct}%: total bets=${String(r.bets).padStart(4)} cov=${(r.coverage*100).toFixed(1).padStart(5)}% WR=${r.winRate.toFixed(1).padStart(5)}% Profit=$${r.profit.toFixed(0).padStart(5)} || override-only: bets=${String(r.ovrBets).padStart(3)} WR=${r.ovrWR.toFixed(1).padStart(5)}% profit=$${r.ovrProfit.toFixed(0).padStart(4)}`);
});

console.log(`\nBaseline total profit for reference: $${base.profit.toFixed(0)} (bets=${base.bets})`);
