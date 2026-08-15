const fs = require('fs');
const { calculateStatistics } = require('../src/statistics');
const { calculateH2H } = require('../src/h2h_engine');
const { groupMatchesByRotation, genH2HVariant, genOUVariant } = require('./tune');

const allMatches = JSON.parse(fs.readFileSync(__dirname + '/recent_7day.json', 'utf8'));
const blocks = groupMatchesByRotation(allMatches);
const keys = Object.keys(blocks).sort();

// Precompute playerStats/h2hStats for each rotation (walk-forward, strictly-prior matches only).
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
console.log(`Evaluating over ${evalKeys.length} rotation blocks: ${evalKeys[0]} .. ${evalKeys.at(-1)}`);

const STAKE = 5;
const PAYOUT = 1.6;

function pct(n, d) { return d > 0 ? (n / d * 100) : 0; }

function evalH2H(cfg) {
    let bets = 0, wins = 0, losses = 0;
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
            if (won) { wins++; h2hHistory[p.pairKey].dnbCorrect++; } else { losses++; }
        });
    });
    const winRate = pct(wins, bets);
    const roi = (winRate / 100 * PAYOUT - 1) * 100;
    const profit = bets * STAKE * (winRate / 100 * PAYOUT - 1);
    return { bets, wins, losses, winRate, roi, profit };
}

function evalOU(cfg) {
    let bets = 0, wins = 0, losses = 0;
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
            if (won) { wins++; playerOU[p.home].correct++; playerOU[p.away].correct++; } else { losses++; }
        });
    });
    const winRate = pct(wins, bets);
    const roi = (winRate / 100 * PAYOUT - 1) * 100;
    const profit = bets * STAKE * (winRate / 100 * PAYOUT - 1);
    return { bets, wins, losses, winRate, roi, profit };
}

// ==== H2H grid ====
const H2H_BASE = { minMatchesForStats: 3, phase1MinMatches: 5, poorHistMinBets: 3, poorHistAccThresh: 60 };
const P1_HIGH = [60, 65, 68, 70, 72, 75, 78, 80];
const P1_LOW = [25, 30, 35, 40, 45];
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
const OU_BASE = { poorHistAccThresh: 50 };
const OV = [2.9, 3.0, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7];
const UN = [2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7];
const STYLES = ['strict', 'loose', 'none'];
const POOR = [40, 45, 50, 55, 60, 65];

console.log('Running OU grid...');
const ouResults = [];
OV.forEach(ov => UN.forEach(un => STYLES.forEach(sm => POOR.forEach(ph => {
    if (un >= ov) return;
    const cfg = { ...OU_BASE, optimalOv: ov, optimalUn: un, styleMode: sm, poorHistAccThresh: ph };
    const r = evalOU(cfg);
    ouResults.push({ cfg, ...r });
}))));

// Ranking: primary = profit ($), with a small volume tiebreak. Filter min bet count for stat robustness.
const MIN_BETS_H2H = 30;
const MIN_BETS_OU = 50;

const h2hFiltered = h2hResults.filter(r => r.bets >= MIN_BETS_H2H);
h2hFiltered.sort((a, b) => b.profit - a.profit || b.bets - a.bets);

const ouFiltered = ouResults.filter(r => r.bets >= MIN_BETS_OU);
ouFiltered.sort((a, b) => b.profit - a.profit || b.bets - a.bets);

console.log(`\nH2H configs tested: ${h2hResults.length}  (kept ${h2hFiltered.length} with >=${MIN_BETS_H2H} bets)`);
console.log(`OU configs tested:  ${ouResults.length}  (kept ${ouFiltered.length} with >=${MIN_BETS_OU} bets)`);

// Baseline reference lines
const h2hBaseR = evalH2H({ ...H2H_BASE, phase1HighWR: 70, phase1LowWR: 40, phase2H2HWR: 60, phase2FormWR: 50, phase3H2HWR: 70 });
const ouBaseR = evalOU({ ...OU_BASE, optimalOv: 3.1, optimalUn: 2.5, styleMode: 'strict', poorHistAccThresh: 50 });

console.log(`\nBaseline H2H (70/40, 60/50, 70): bets=${h2hBaseR.bets} wins=${h2hBaseR.wins} WR=${h2hBaseR.winRate.toFixed(1)}% ROI=${h2hBaseR.roi.toFixed(1)}% Profit=$${h2hBaseR.profit.toFixed(2)}`);
console.log(`Baseline OU  (3.1/2.5, strict, <50): bets=${ouBaseR.bets} wins=${ouBaseR.wins} WR=${ouBaseR.winRate.toFixed(1)}% ROI=${ouBaseR.roi.toFixed(1)}% Profit=$${ouBaseR.profit.toFixed(2)}`);

console.log('\n=== TOP 15 H2H configs by PROFIT ($5 stake, 1.6x payout) ===');
h2hFiltered.slice(0, 15).forEach(r => {
    console.log(`bets=${String(r.bets).padStart(3)} wins=${String(r.wins).padStart(3)} losses=${String(r.losses).padStart(3)} WR=${r.winRate.toFixed(1).padStart(5)}% ROI=${r.roi.toFixed(1).padStart(5)}% Profit=$${r.profit.toFixed(2).padStart(7)} | P1:${r.cfg.phase1HighWR}/${r.cfg.phase1LowWR} P2:${r.cfg.phase2H2HWR}/${r.cfg.phase2FormWR} P3:${r.cfg.phase3H2HWR}`);
});

console.log('\n=== TOP 15 H2H configs by ROI (min 30 bets) ===');
[...h2hFiltered].sort((a, b) => b.roi - a.roi || b.bets - a.bets).slice(0, 15).forEach(r => {
    console.log(`bets=${String(r.bets).padStart(3)} wins=${String(r.wins).padStart(3)} losses=${String(r.losses).padStart(3)} WR=${r.winRate.toFixed(1).padStart(5)}% ROI=${r.roi.toFixed(1).padStart(5)}% Profit=$${r.profit.toFixed(2).padStart(7)} | P1:${r.cfg.phase1HighWR}/${r.cfg.phase1LowWR} P2:${r.cfg.phase2H2HWR}/${r.cfg.phase2FormWR} P3:${r.cfg.phase3H2HWR}`);
});

console.log('\n=== TOP 15 OU configs by PROFIT ===');
ouFiltered.slice(0, 15).forEach(r => {
    console.log(`bets=${String(r.bets).padStart(4)} wins=${String(r.wins).padStart(4)} losses=${String(r.losses).padStart(4)} WR=${r.winRate.toFixed(1).padStart(5)}% ROI=${r.roi.toFixed(1).padStart(5)}% Profit=$${r.profit.toFixed(2).padStart(8)} | OV=${r.cfg.optimalOv} UN=${r.cfg.optimalUn} style=${r.cfg.styleMode.padEnd(6)} poor<${r.cfg.poorHistAccThresh}%`);
});

console.log('\n=== TOP 15 OU configs by ROI (min 50 bets) ===');
[...ouFiltered].sort((a, b) => b.roi - a.roi || b.bets - a.bets).slice(0, 15).forEach(r => {
    console.log(`bets=${String(r.bets).padStart(4)} wins=${String(r.wins).padStart(4)} losses=${String(r.losses).padStart(4)} WR=${r.winRate.toFixed(1).padStart(5)}% ROI=${r.roi.toFixed(1).padStart(5)}% Profit=$${r.profit.toFixed(2).padStart(8)} | OV=${r.cfg.optimalOv} UN=${r.cfg.optimalUn} style=${r.cfg.styleMode.padEnd(6)} poor<${r.cfg.poorHistAccThresh}%`);
});
