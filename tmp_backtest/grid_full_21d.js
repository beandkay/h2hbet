const fs = require('fs');
const { calculateStatistics } = require('../src/statistics');
const { calculateH2H } = require('../src/h2h_engine');
const { groupMatchesByRotation, genH2HVariant, genOUVariant } = require('./tune');

const DATA_FILE = process.argv[2] || 'recent_21day.json';
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
console.log(`Evaluating over ${evalKeys.length} rotation blocks (warm-up requires >= ${MIN_PAST} past matches)`);

const STAKE = 5;
const PAYOUT = 1.6;

function pct(n, d) { return d > 0 ? (n / d * 100) : 0; }

// Rotation-level profit for a given win/loss count, using the same $5-stake/1.6x-payout convention.
function rotProfit(r) {
    return r.wins * STAKE * (PAYOUT - 1) - r.losses * STAKE;
}

function evalH2H(cfg) {
    let bets = 0, wins = 0, losses = 0;
    const h2hHistory = {};
    const rotStats = {};
    evalKeys.forEach(key => {
        rotStats[key] = { bets: 0, wins: 0, losses: 0 };
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
            else { losses++; rotStats[key].losses++; }
        });
    });
    const winRate = pct(wins, bets);
    const roi = (winRate / 100 * PAYOUT - 1) * 100;
    const profit = bets * STAKE * (winRate / 100 * PAYOUT - 1);
    // Consistency measure — count profitable rotations
    const rotList = Object.values(rotStats).filter(r => r.bets > 0);
    const profitableRotations = rotList.filter(r => (r.wins / r.bets) >= 0.625).length;
    const bettingRotations = rotList.length;
    // "Upside" profit: sum only the rotations that were net-positive, discarding
    // losing rotations entirely rather than netting them against winners.
    const upsideProfit = rotList.reduce((sum, r) => { const p = rotProfit(r); return p > 0 ? sum + p : sum; }, 0);
    const losingRotations = rotList.filter(r => rotProfit(r) < 0).length;
    return { bets, wins, losses, winRate, roi, profit, profitableRotations, bettingRotations, upsideProfit, losingRotations };
}

function evalOU(cfg) {
    let bets = 0, wins = 0, losses = 0;
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
    const rotList = Object.values(rotStats).filter(r => r.bets > 0);
    const profitableRotations = rotList.filter(r => (r.wins / r.bets) >= 0.625).length;
    const bettingRotations = rotList.length;
    const upsideProfit = rotList.reduce((sum, r) => { const p = rotProfit(r); return p > 0 ? sum + p : sum; }, 0);
    const losingRotations = rotList.filter(r => rotProfit(r) < 0).length;
    return { bets, wins, losses, winRate, roi, profit, profitableRotations, bettingRotations, upsideProfit, losingRotations };
}

// ==== H2H grid ====
const H2H_BASE = { minMatchesForStats: 3, phase1MinMatches: 5, poorHistMinBets: 3, poorHistAccThresh: 60 };
const P1_HIGH = [55, 60, 65, 68, 70, 72, 75, 78, 80];
const P1_LOW = [25, 30, 35, 40, 45, 50];
const P2_H2H = [50, 55, 60, 65, 70, 75];
const P2_FORM = [35, 40, 45, 50, 55, 60];
const P3_H2H = [55, 60, 65, 70, 75, 80];

console.log('\nRunning H2H grid...');
const h2hResults = [];
P1_HIGH.forEach(p1h => P1_LOW.forEach(p1l => {
    if (p1l >= p1h - 10) return;
    P2_H2H.forEach(p2h => P2_FORM.forEach(p2f => P3_H2H.forEach(p3h => {
        const cfg = { ...H2H_BASE, phase1HighWR: p1h, phase1LowWR: p1l, phase2H2HWR: p2h, phase2FormWR: p2f, phase3H2HWR: p3h };
        const r = evalH2H(cfg);
        h2hResults.push({ cfg, ...r });
    })));
}));

// ==== OU grid ====
const OU_BASE = {};
const OV = [2.9, 3.0, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8];
const UN = [2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7];
const STYLES = ['mixed', 'strict', 'loose', 'none'];
const POOR = [40, 45, 50, 55, 60, 65];

console.log('Running OU grid...');
const ouResults = [];
OV.forEach(ov => UN.forEach(un => STYLES.forEach(sm => POOR.forEach(ph => {
    if (un >= ov) return;
    const cfg = { ...OU_BASE, optimalOv: ov, optimalUn: un, styleMode: sm, poorHistAccThresh: ph };
    const r = evalOU(cfg);
    ouResults.push({ cfg, ...r });
}))));

const MIN_BETS_H2H = 50;
const MIN_BETS_OU = 100;

// Ranking is by upsideProfit: losing rotations are excluded entirely (treated as
// "we didn't bet that day") rather than netted against winning rotations — per
// request, parameter search should not be penalized for days that didn't pay off.
const h2hFiltered = h2hResults.filter(r => r.bets >= MIN_BETS_H2H);
h2hFiltered.sort((a, b) => b.upsideProfit - a.upsideProfit || b.bets - a.bets);

const ouFiltered = ouResults.filter(r => r.bets >= MIN_BETS_OU);
ouFiltered.sort((a, b) => b.upsideProfit - a.upsideProfit || b.bets - a.bets);

console.log(`\nH2H configs tested: ${h2hResults.length}  (kept ${h2hFiltered.length} with >=${MIN_BETS_H2H} bets)`);
console.log(`OU configs tested:  ${ouResults.length}  (kept ${ouFiltered.length} with >=${MIN_BETS_OU} bets)`);

const h2hBaseR = evalH2H({ ...H2H_BASE, phase1HighWR: 70, phase1LowWR: 40, phase2H2HWR: 60, phase2FormWR: 50, phase3H2HWR: 70 });
const ouBaseR = evalOU({ ...OU_BASE, optimalOv: 3.1, optimalUn: 2.5, styleMode: 'strict', poorHistAccThresh: 50 });
const ouCurrentProdR = evalOU({ ...OU_BASE, optimalOv: 3.3, optimalUn: 2.4, styleMode: 'mixed', poorHistAccThresh: 40 });

console.log(`\nBaseline H2H (70/40, 60/50, 70): bets=${h2hBaseR.bets} wins=${h2hBaseR.wins} WR=${h2hBaseR.winRate.toFixed(1)}% Upside=$${h2hBaseR.upsideProfit.toFixed(2)} (all-days Profit=$${h2hBaseR.profit.toFixed(2)})  prof-rot=${h2hBaseR.profitableRotations}/${h2hBaseR.bettingRotations} losing-rot=${h2hBaseR.losingRotations}`);
console.log(`Baseline OU  (3.1/2.5, strict, <50): bets=${ouBaseR.bets} wins=${ouBaseR.wins} WR=${ouBaseR.winRate.toFixed(1)}% Upside=$${ouBaseR.upsideProfit.toFixed(2)} (all-days Profit=$${ouBaseR.profit.toFixed(2)})  prof-rot=${ouBaseR.profitableRotations}/${ouBaseR.bettingRotations} losing-rot=${ouBaseR.losingRotations}`);
console.log(`Current PROD OU (3.1/2.6, strict, <40): bets=${ouCurrentProdR.bets} wins=${ouCurrentProdR.wins} WR=${ouCurrentProdR.winRate.toFixed(1)}% Upside=$${ouCurrentProdR.upsideProfit.toFixed(2)} (all-days Profit=$${ouCurrentProdR.profit.toFixed(2)})  prof-rot=${ouCurrentProdR.profitableRotations}/${ouCurrentProdR.bettingRotations} losing-rot=${ouCurrentProdR.losingRotations}`);

// Prior 7-day recommendations — how do they hold up on 21 days?
const h2hPriorRec = evalH2H({ ...H2H_BASE, phase1HighWR: 60, phase1LowWR: 45, phase2H2HWR: 50, phase2FormWR: 55, phase3H2HWR: 70 });
const ouPriorRec = evalOU({ optimalOv: 3.7, optimalUn: 2.7, styleMode: 'loose', poorHistAccThresh: 60 });
console.log(`\nPrior 7-day H2H rec (60/45,50/55,70): bets=${h2hPriorRec.bets} WR=${h2hPriorRec.winRate.toFixed(1)}% Upside=$${h2hPriorRec.upsideProfit.toFixed(2)} (all-days Profit=$${h2hPriorRec.profit.toFixed(2)})  prof-rot=${h2hPriorRec.profitableRotations}/${h2hPriorRec.bettingRotations} losing-rot=${h2hPriorRec.losingRotations}`);
console.log(`Prior 7-day OU rec (3.7/2.7,loose,<60): bets=${ouPriorRec.bets} WR=${ouPriorRec.winRate.toFixed(1)}% Upside=$${ouPriorRec.upsideProfit.toFixed(2)} (all-days Profit=$${ouPriorRec.profit.toFixed(2)})  prof-rot=${ouPriorRec.profitableRotations}/${ouPriorRec.bettingRotations} losing-rot=${ouPriorRec.losingRotations}`);

console.log('\n=== TOP 20 H2H configs by UPSIDE PROFIT (losing rotations excluded, min 50 bets) ===');
h2hFiltered.slice(0, 20).forEach(r => {
    console.log(`bets=${String(r.bets).padStart(3)} wins=${String(r.wins).padStart(3)} losses=${String(r.losses).padStart(3)} WR=${r.winRate.toFixed(1).padStart(5)}% Upside=$${r.upsideProfit.toFixed(0).padStart(5)} (all-days Profit=$${r.profit.toFixed(0)}) prof-rot=${r.profitableRotations}/${r.bettingRotations} losing-rot=${r.losingRotations} | P1:${r.cfg.phase1HighWR}/${r.cfg.phase1LowWR} P2:${r.cfg.phase2H2HWR}/${r.cfg.phase2FormWR} P3:${r.cfg.phase3H2HWR}`);
});

console.log('\n=== TOP 20 H2H configs by ROI (min 50 bets on 21 days) ===');
[...h2hFiltered].sort((a, b) => b.roi - a.roi || b.bets - a.bets).slice(0, 20).forEach(r => {
    console.log(`bets=${String(r.bets).padStart(3)} wins=${String(r.wins).padStart(3)} losses=${String(r.losses).padStart(3)} WR=${r.winRate.toFixed(1).padStart(5)}% ROI=${r.roi.toFixed(1).padStart(6)}% Upside=$${r.upsideProfit.toFixed(0).padStart(5)} losing-rot=${r.losingRotations} | P1:${r.cfg.phase1HighWR}/${r.cfg.phase1LowWR} P2:${r.cfg.phase2H2HWR}/${r.cfg.phase2FormWR} P3:${r.cfg.phase3H2HWR}`);
});

console.log('\n=== TOP 20 OU configs by UPSIDE PROFIT (losing rotations excluded, min 100 bets) ===');
ouFiltered.slice(0, 20).forEach(r => {
    console.log(`bets=${String(r.bets).padStart(4)} wins=${String(r.wins).padStart(4)} losses=${String(r.losses).padStart(4)} WR=${r.winRate.toFixed(1).padStart(5)}% Upside=$${r.upsideProfit.toFixed(0).padStart(6)} (all-days Profit=$${r.profit.toFixed(0)}) prof-rot=${r.profitableRotations}/${r.bettingRotations} losing-rot=${r.losingRotations} | OV=${r.cfg.optimalOv} UN=${r.cfg.optimalUn} style=${r.cfg.styleMode.padEnd(6)} poor<${r.cfg.poorHistAccThresh}%`);
});

console.log('\n=== TOP 20 OU configs by ROI (min 100 bets on 21 days) ===');
[...ouFiltered].sort((a, b) => b.roi - a.roi || b.bets - a.bets).slice(0, 20).forEach(r => {
    console.log(`bets=${String(r.bets).padStart(4)} wins=${String(r.wins).padStart(4)} losses=${String(r.losses).padStart(4)} WR=${r.winRate.toFixed(1).padStart(5)}% ROI=${r.roi.toFixed(1).padStart(6)}% Upside=$${r.upsideProfit.toFixed(0).padStart(6)} losing-rot=${r.losingRotations} | OV=${r.cfg.optimalOv} UN=${r.cfg.optimalUn} style=${r.cfg.styleMode.padEnd(6)} poor<${r.cfg.poorHistAccThresh}%`);
});

console.log('\n=== BEST-BY-UPSIDE-PROFIT within each style mode (min 100 bets) ===');
STYLES.forEach(sm => {
    const byStyle = ouFiltered.filter(r => r.cfg.styleMode === sm);
    if (!byStyle.length) { console.log(`${sm}: no configs with >=${MIN_BETS_OU} bets`); return; }
    const best = [...byStyle].sort((a, b) => b.upsideProfit - a.upsideProfit || b.bets - a.bets)[0];
    console.log(`${sm.padEnd(6)} best: bets=${best.bets} wins=${best.wins} losses=${best.losses} WR=${best.winRate.toFixed(1)}% Upside=$${best.upsideProfit.toFixed(0)} (all-days Profit=$${best.profit.toFixed(0)}) prof-rot=${best.profitableRotations}/${best.bettingRotations} losing-rot=${best.losingRotations} | OV=${best.cfg.optimalOv} UN=${best.cfg.optimalUn} poor<${best.cfg.poorHistAccThresh}%`);
});
