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

// Target: profit/bet ≈ $0.50  →  WR ≈ 68.75%
// Accept band: $0.40–$0.70/bet  →  WR 67.5%–71.25%
const PPB_MIN = 0.40, PPB_MAX = 0.70;

function evalH2H(cfg) {
    let bets = 0, wins = 0;
    const h2hHistory = {};
    evalKeys.forEach(key => {
        const { playerStats, h2hStats, matches } = perRotation[key];
        const predicted = genH2HVariant(matches, playerStats, h2hStats, h2hHistory, cfg);
        predicted.forEach(p => {
            if (!h2hHistory[p.pairKey]) h2hHistory[p.pairKey] = { dnbBets: 0, dnbCorrect: 0 };
            if (p.predictionType === "SKIP" || !p.pick) return;
            if (p.hs === p.as) return;
            bets++;
            h2hHistory[p.pairKey].dnbBets++;
            const won = (p.pick === p.home && p.hs > p.as) || (p.pick === p.away && p.as > p.hs);
            if (won) { wins++; h2hHistory[p.pairKey].dnbCorrect++; }
        });
    });
    const winRate = pct(wins, bets);
    const profit = bets * STAKE * (winRate / 100 * PAYOUT - 1);
    return { bets, wins, losses: bets - wins, winRate, profit, ppb: bets > 0 ? profit / bets : 0 };
}

function evalOU(cfg) {
    let bets = 0, wins = 0;
    const playerOU = {};
    evalKeys.forEach(key => {
        const { playerStats, h2hStats, matches } = perRotation[key];
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
    return { bets, wins, losses: bets - wins, winRate, profit, ppb: bets > 0 ? profit / bets : 0 };
}

// H2H grid — sweep around the profitable region
const H2H_BASE = { minMatchesForStats: 3, phase1MinMatches: 5, poorHistMinBets: 3, poorHistAccThresh: 60 };
const P1_HIGH = [55, 60, 65, 70, 75, 80];
const P1_LOW = [25, 30, 35, 40, 45];
const P2_H2H = [55, 60, 65, 70, 75];
const P2_FORM = [30, 35, 40, 45, 50, 55];
const P3_H2H = [60, 65, 70, 75, 80];

console.log('Running H2H grid...');
const h2hResults = [];
P1_HIGH.forEach(p1h => P1_LOW.forEach(p1l => {
    if (p1l >= p1h - 10) return;
    P2_H2H.forEach(p2h => P2_FORM.forEach(p2f => P3_H2H.forEach(p3h => {
        const cfg = { ...H2H_BASE, phase1HighWR: p1h, phase1LowWR: p1l, phase2H2HWR: p2h, phase2FormWR: p2f, phase3H2HWR: p3h };
        const r = evalH2H(cfg);
        if (r.bets >= 50) h2hResults.push({ cfg, ...r });
    })));
}));

// OU grid
const OV = [3.1, 3.3, 3.5, 3.7, 3.9, 4.1];
const UN = [2.0, 2.1, 2.2, 2.3, 2.4, 2.5];
const STYLES = ['strict', 'loose', 'none'];
const POOR = [40, 50, 60, 70];

console.log('Running OU grid...');
const ouResults = [];
OV.forEach(ov => UN.forEach(un => STYLES.forEach(sm => POOR.forEach(ph => {
    if (un >= ov) return;
    const cfg = { optimalOv: ov, optimalUn: un, styleMode: sm, poorHistAccThresh: ph };
    const r = evalOU(cfg);
    if (r.bets >= 50) ouResults.push({ cfg, ...r });
}))));

console.log(`\nH2H configs: ${h2hResults.length}, OU configs: ${ouResults.length}`);

// Configs in target ppb band, sorted by total profit (which also = bets × ppb-in-band)
const h2hInBand = h2hResults.filter(r => r.ppb >= PPB_MIN && r.ppb <= PPB_MAX);
h2hInBand.sort((a, b) => b.profit - a.profit);

const ouInBand = ouResults.filter(r => r.ppb >= PPB_MIN && r.ppb <= PPB_MAX);
ouInBand.sort((a, b) => b.profit - a.profit);

console.log(`\n=== TOP 15 H2H configs with $/bet in [$${PPB_MIN}, $${PPB_MAX}], sorted by total profit ===`);
h2hInBand.slice(0, 15).forEach(r => {
    console.log(`bets=${String(r.bets).padStart(3)} wins=${String(r.wins).padStart(3)} losses=${String(r.losses).padStart(3)} WR=${r.winRate.toFixed(1).padStart(5)}% $/bet=$${r.ppb.toFixed(2)} Profit=$${r.profit.toFixed(0).padStart(4)} | P1:${r.cfg.phase1HighWR}/${r.cfg.phase1LowWR} P2:${r.cfg.phase2H2HWR}/${r.cfg.phase2FormWR} P3:${r.cfg.phase3H2HWR}`);
});

console.log(`\n=== TOP 15 OU configs with $/bet in [$${PPB_MIN}, $${PPB_MAX}], sorted by total profit ===`);
ouInBand.slice(0, 15).forEach(r => {
    console.log(`bets=${String(r.bets).padStart(4)} wins=${String(r.wins).padStart(4)} losses=${String(r.losses).padStart(3)} WR=${r.winRate.toFixed(1).padStart(5)}% $/bet=$${r.ppb.toFixed(2)} Profit=$${r.profit.toFixed(0).padStart(4)} | OV=${r.cfg.optimalOv} UN=${r.cfg.optimalUn} style=${r.cfg.styleMode.padEnd(6)} poor<${r.cfg.poorHistAccThresh}%`);
});

// Also show top by pure volume within band for reference
console.log(`\n=== TOP 5 H2H by VOLUME within band ===`);
[...h2hInBand].sort((a, b) => b.bets - a.bets).slice(0, 5).forEach(r => {
    console.log(`bets=${String(r.bets).padStart(3)} WR=${r.winRate.toFixed(1)}% $/bet=$${r.ppb.toFixed(2)} Profit=$${r.profit.toFixed(0)} | P1:${r.cfg.phase1HighWR}/${r.cfg.phase1LowWR} P2:${r.cfg.phase2H2HWR}/${r.cfg.phase2FormWR} P3:${r.cfg.phase3H2HWR}`);
});
console.log(`\n=== TOP 5 OU by VOLUME within band ===`);
[...ouInBand].sort((a, b) => b.bets - a.bets).slice(0, 5).forEach(r => {
    console.log(`bets=${String(r.bets).padStart(4)} WR=${r.winRate.toFixed(1)}% $/bet=$${r.ppb.toFixed(2)} Profit=$${r.profit.toFixed(0)} | OV=${r.cfg.optimalOv} UN=${r.cfg.optimalUn} style=${r.cfg.styleMode} poor<${r.cfg.poorHistAccThresh}%`);
});
