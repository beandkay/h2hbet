const fs = require('fs');
const { calculateStatistics } = require('../src/statistics');
const { calculateH2H } = require('../src/h2h_engine');
const { groupMatchesByRotation, genH2HVariant, genOUVariant } = require('./tune');

const allMatches = JSON.parse(fs.readFileSync(__dirname + '/recent_21day.json', 'utf8'));
const blocks = groupMatchesByRotation(allMatches);
const keys = Object.keys(blocks).sort();

const perRotation = {};
keys.forEach((key, idx) => {
    const past = [];
    keys.slice(0, idx).forEach(k => past.push(...blocks[k]));
    if (past.length < 50) return;
    const totalGoals = past.reduce((s, m) => s + m.teamAScore + m.teamBScore, 0);
    const leagueAvg = totalGoals / (past.length * 2);
    const { playerStats } = calculateStatistics(JSON.parse(JSON.stringify(past)), leagueAvg);
    const { h2hStats } = calculateH2H(JSON.parse(JSON.stringify(past)));
    perRotation[key] = { playerStats, h2hStats, matches: blocks[key] };
});

const evalKeys = Object.keys(perRotation).sort();
const STAKE = 5, PAYOUT = 1.6;
function pct(n, d) { return d > 0 ? (n / d * 100) : 0; }

function runH2H(cfg) {
    const rotStats = {};
    const h2hHistory = {};
    let bets = 0, wins = 0;
    evalKeys.forEach(key => {
        rotStats[key] = { bets: 0, wins: 0 };
        const { playerStats, h2hStats, matches } = perRotation[key];
        const predicted = genH2HVariant(matches, playerStats, h2hStats, h2hHistory, cfg);
        predicted.forEach(p => {
            if (!h2hHistory[p.pairKey]) h2hHistory[p.pairKey] = { dnbBets: 0, dnbCorrect: 0 };
            if (p.predictionType === "SKIP" || !p.pick) return;
            if (p.hs === p.as) return;
            bets++; rotStats[key].bets++;
            h2hHistory[p.pairKey].dnbBets++;
            const won = (p.pick === p.home && p.hs > p.as) || (p.pick === p.away && p.as > p.hs);
            if (won) { wins++; rotStats[key].wins++; h2hHistory[p.pairKey].dnbCorrect++; }
        });
    });
    return { bets, wins, rotStats };
}

function runOU(cfg) {
    const rotStats = {};
    const playerOU = {};
    let bets = 0, wins = 0;
    evalKeys.forEach(key => {
        rotStats[key] = { bets: 0, wins: 0 };
        const { playerStats, h2hStats, matches } = perRotation[key];
        const predicted = genOUVariant(matches, playerStats, h2hStats, { playerOU }, cfg);
        predicted.forEach(p => {
            if (!playerOU[p.home]) playerOU[p.home] = { bets: 0, correct: 0 };
            if (!playerOU[p.away]) playerOU[p.away] = { bets: 0, correct: 0 };
            if (!p.pick) return;
            const totalG = p.hs + p.as;
            bets++; rotStats[key].bets++;
            playerOU[p.home].bets++; playerOU[p.away].bets++;
            const won = (p.pick === 'OVER' && totalG > 2.5) || (p.pick === 'UNDER' && totalG < 2.5);
            if (won) { wins++; rotStats[key].wins++; playerOU[p.home].correct++; playerOU[p.away].correct++; }
        });
    });
    return { bets, wins, rotStats };
}

const H2H_CFG = { minMatchesForStats: 3, phase1MinMatches: 5, phase1HighWR: 55, phase1LowWR: 40, phase2H2HWR: 70, phase2FormWR: 35, phase3H2HWR: 60, poorHistMinBets: 3, poorHistAccThresh: 60 };
const OU_CFG = { optimalOv: 3.3, optimalUn: 2.4, styleMode: 'strict', poorHistAccThresh: 40 };

const h2h = runH2H(H2H_CFG);
const ou = runOU(OU_CFG);

const h2hProfit = h2h.bets * STAKE * (h2h.wins / h2h.bets * PAYOUT - 1);
const ouProfit = ou.bets * STAKE * (ou.wins / ou.bets * PAYOUT - 1);

console.log('=== JOINT MAX config — per-rotation results across all 21 days ===');
console.log(`H2H: P1:55/40, P2:70/35, P3:60`);
console.log(`OU:  OV=3.3, UN=2.4, strict, poor<40%\n`);

console.log('Rotation         | H2H bets W/L   WR%    Profit | OU bets W/L   WR%    Profit | Combined Profit');
console.log('-'.repeat(115));
let cumProfit = 0;
let h2hRotsProfit = 0, h2hRotsBet = 0, ouRotsProfit = 0, ouRotsBet = 0, combinedRotsProfit = 0, combinedRotsBet = 0;
evalKeys.forEach(key => {
    const h = h2h.rotStats[key];
    const o = ou.rotStats[key];
    const hWR = h.bets > 0 ? h.wins / h.bets * 100 : 0;
    const oWR = o.bets > 0 ? o.wins / o.bets * 100 : 0;
    const hProfit = h.bets * STAKE * (h.wins / (h.bets || 1) * PAYOUT - 1) * (h.bets > 0 ? 1 : 0);
    const oProfit = o.bets * STAKE * (o.wins / (o.bets || 1) * PAYOUT - 1) * (o.bets > 0 ? 1 : 0);
    const combined = hProfit + oProfit;
    cumProfit += combined;
    if (h.bets > 0) { h2hRotsBet++; if (hProfit > 0) h2hRotsProfit++; }
    if (o.bets > 0) { ouRotsBet++; if (oProfit > 0) ouRotsProfit++; }
    if ((h.bets + o.bets) > 0) { combinedRotsBet++; if (combined > 0) combinedRotsProfit++; }
    const hCell = h.bets > 0 ? `${String(h.bets).padStart(3)} ${String(h.wins)}/${String(h.bets - h.wins)}  ${hWR.toFixed(0).padStart(3)}%  ${(hProfit >= 0 ? '+' : '') + hProfit.toFixed(0).padStart(4)}` : '  —              ';
    const oCell = o.bets > 0 ? `${String(o.bets).padStart(3)} ${String(o.wins)}/${String(o.bets - o.wins)}  ${oWR.toFixed(0).padStart(3)}%  ${(oProfit >= 0 ? '+' : '') + oProfit.toFixed(0).padStart(4)}` : '  —              ';
    console.log(`${key.padEnd(16)} | ${hCell.padEnd(24)} | ${oCell.padEnd(24)} | ${(combined >= 0 ? '+' : '') + combined.toFixed(0).padStart(4)}  (cum ${(cumProfit >= 0 ? '+' : '') + cumProfit.toFixed(0)})`);
});
console.log('-'.repeat(115));
console.log(`TOTAL           | ${h2h.bets} bets, ${h2h.wins}W/${h2h.bets-h2h.wins}L, WR ${(h2h.wins/h2h.bets*100).toFixed(1)}%, Profit $${h2hProfit.toFixed(0)} | ${ou.bets} bets, ${ou.wins}W/${ou.bets-ou.wins}L, WR ${(ou.wins/ou.bets*100).toFixed(1)}%, Profit $${ouProfit.toFixed(0)} | COMBINED $${(h2hProfit+ouProfit).toFixed(0)}`);
console.log(`\nProfitable rotations:  H2H ${h2hRotsProfit}/${h2hRotsBet}  |  OU ${ouRotsProfit}/${ouRotsBet}  |  Combined ${combinedRotsProfit}/${combinedRotsBet}`);
console.log(`Avg profit per rotation (across all ${combinedRotsBet} betting rotations): $${((h2hProfit+ouProfit)/combinedRotsBet).toFixed(2)}`);
console.log(`Avg bets per rotation:  H2H ${(h2h.bets/h2hRotsBet).toFixed(1)}  |  OU ${(ou.bets/ouRotsBet).toFixed(1)}  |  Combined ${((h2h.bets+ou.bets)/combinedRotsBet).toFixed(1)}`);
console.log(`Avg profit/bet:  H2H $${(h2hProfit/h2h.bets).toFixed(2)}  |  OU $${(ouProfit/ou.bets).toFixed(2)}  |  Combined $${((h2hProfit+ouProfit)/(h2h.bets+ou.bets)).toFixed(2)}`);
