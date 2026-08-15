// Stacked "Over 3.0 Goal Line" side bet on top of every currently-shipped OVER 2.5 pick.
// Settlement: WIN if totalGoals>=4, PUSH (stake refunded, not a loss) if totalGoals==3,
// LOSE if totalGoals<=2. Since the base Over 2.5 pick ALREADY wins at totalGoals==3, this
// side bet's only new downside is identical to the base pick's existing downside (<=2) -
// it adds upside on 4+-goal matches for free, at the cost of "wasting" the push-refunded
// stake on 3-goal matches instead of turning a profit on that specific leg.
// Uses the ACTUAL production predictor (src/predictor_ou.js), current shipped thresholds
// (AggAgg-over@3.1, Mixed-over@3.8, rotation-warmup skip already baked in).
const fs = require('fs');
const { calculateStatistics } = require('../src/statistics');
const { calculateH2H } = require('../src/h2h_engine');
const { generateOUPredictions } = require('../src/predictor_ou');
const { groupMatchesByRotation } = require('./tune');

const DATA_FILE = process.argv[2] || 'recent_21day_fresh.json';
const allMatches = JSON.parse(fs.readFileSync(__dirname + '/' + DATA_FILE, 'utf8'));
const blocks = groupMatchesByRotation(allMatches);
const keys = Object.keys(blocks).sort();
console.log(`Total rotation blocks: ${keys.length}`);
console.log(`Range: ${keys[0]} .. ${keys.at(-1)}`);

const MIN_PAST = 50;
const perRotation = {};
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

const ouPlayerState = {};
const overPicks = []; // every match where the base OVER 2.5 pick actually fired
let baseBets = 0, baseWins = 0, totalMatches = 0;

evalKeys.forEach(key => {
    const { playerStats, h2hStats, matches } = perRotation[key];
    totalMatches += matches.length;
    const ouMatches = JSON.parse(JSON.stringify(matches));
    generateOUPredictions(ouMatches, playerStats, h2hStats, { currentRotationOUStats: { playerOU: ouPlayerState, h2hHistory: {} } });
    ouMatches.forEach(m => {
        if (!ouPlayerState[m.participantAName]) ouPlayerState[m.participantAName] = { bets: 0, correct: 0 };
        if (!ouPlayerState[m.participantBName]) ouPlayerState[m.participantBName] = { bets: 0, correct: 0 };
        if (!m.isOUPick) return;
        const totalG = m.teamAScore + m.teamBScore;
        const won = (m.ou25Pick.includes('OVER') && totalG > 2.5) || (m.ou25Pick.includes('UNDER') && totalG < 2.5);
        baseBets++;
        ouPlayerState[m.participantAName].bets++; ouPlayerState[m.participantBName].bets++;
        if (won) { baseWins++; ouPlayerState[m.participantAName].correct++; ouPlayerState[m.participantBName].correct++; }
        if (m.ou25Pick.includes('OVER')) {
            // predictor_ou.js doesn't attach xG/style back onto m - recompute the same way it does internally.
            const home = m.participantAName, away = m.participantBName;
            const sHome = playerStats[home] || { avgScored: 0, avgConceded: 0, matches: 0, streak: [], adjScoringAbility: 0, adjDefendingAbility: 0 };
            const sAway = playerStats[away] || { avgScored: 0, avgConceded: 0, matches: 0, streak: [], adjScoringAbility: 0, adjDefendingAbility: 0 };
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
            const bucket = (hStyle === 'Aggressive' && aStyle === 'Aggressive') ? 'AggAgg' : (hStyle === 'Defensive' && aStyle === 'Defensive') ? 'DefDef' : 'Mixed';
            overPicks.push({ totalG, totalXG, bucket });
        }
    });
});
const baseWR = pct(baseWins, baseBets);
const baseProfit = baseBets * STAKE * (baseWR / 100 * PAYOUT - 1);
console.log(`BASE (current shipped, all OU picks): bets=${baseBets} cov=${pct(baseBets,totalMatches).toFixed(1)}% WR=${baseWR.toFixed(1)}% Profit=$${baseProfit.toFixed(0)}`);
console.log(`Of which OVER picks (candidates for stacked Goal Line 3.0): ${overPicks.length}\n`);

// Stacked Over-3.0 Goal Line settlement on every OVER pick.
let g3Win = 0, g3Push = 0, g3Loss = 0;
overPicks.forEach(p => {
    if (p.totalG >= 4) g3Win++;
    else if (p.totalG === 3) g3Push++;
    else g3Loss++;
});
const g3Decided = g3Win + g3Loss;
const g3WR = pct(g3Win, g3Decided);
const g3Profit = g3Win * STAKE * (PAYOUT - 1) - g3Loss * STAKE; // pushes contribute $0
console.log(`=== Stacked Over-3.0 Goal Line on ALL ${overPicks.length} existing OVER picks ===`);
console.log(`Win=${g3Win} Push=${g3Push} Loss=${g3Loss} (decided WR=${g3WR.toFixed(1)}% over ${g3Decided} decided bets)`);
console.log(`Incremental profit from stacking: $${g3Profit.toFixed(0)} (combined with base: $${(baseProfit + g3Profit).toFixed(0)})`);

// Breakdown by bucket, to see where losses actually concentrate.
console.log(`\n=== Breakdown by style bucket ===`);
['AggAgg', 'Mixed', 'DefDef'].forEach(b => {
    const rows = overPicks.filter(p => p.bucket === b);
    if (!rows.length) return;
    let w=0,psh=0,l=0;
    rows.forEach(p => { if (p.totalG>=4) w++; else if (p.totalG===3) psh++; else l++; });
    const dec = w+l;
    const wr = pct(w,dec);
    const profit = w*STAKE*(PAYOUT-1) - l*STAKE;
    console.log(`${b}: n=${rows.length} win=${w} push=${psh} loss=${l} decided-WR=${wr.toFixed(1)}% profit=$${profit.toFixed(0)}`);
});

// Find an empirical "absolute confidence" (guaranteed no-lose) xG cutoff: the xG level
// above which zero historical losses (totalG<=2) occurred among OVER picks.
console.log(`\n=== Sweep xG floor: find where losses (totalG<=2) stop occurring entirely ===`);
const xgFloors = [3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 4.0, 4.2, 4.5, 5.0];
xgFloors.forEach(floor => {
    const rows = overPicks.filter(p => p.totalXG >= floor);
    if (!rows.length) return;
    let w=0,psh=0,l=0;
    rows.forEach(p => { if (p.totalG>=4) w++; else if (p.totalG===3) psh++; else l++; });
    console.log(`xG>=${floor}: n=${rows.length} win=${w} push=${psh} loss=${l} ${l===0 ? '<-- ZERO LOSSES (guaranteed win-or-push in this sample)' : ''}`);
});
