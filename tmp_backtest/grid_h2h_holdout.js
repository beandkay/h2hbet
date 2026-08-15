const fs = require('fs');
const { calculateStatistics } = require('../src/statistics');
const { calculateH2H } = require('../src/h2h_engine');
const { groupMatchesByRotation, genH2HVariant } = require('./tune');

const allMatches = JSON.parse(fs.readFileSync(__dirname + '/recent_7day.json', 'utf8'));
const blocks = groupMatchesByRotation(allMatches);
const keys = Object.keys(blocks).sort();

const TARGETS = ['2026-08-13_AM', '2026-08-13_PM'];

// Precompute playerStats/h2hStats (built from strictly-prior matches) for the two target rotations.
const targetData = {};
keys.forEach((key, idx) => {
    if (!TARGETS.includes(key)) return;
    const past = [];
    keys.slice(0, idx).forEach(k => past.push(...blocks[k]));
    const totalGoals = past.reduce((s, m) => s + m.teamAScore + m.teamBScore, 0);
    const leagueAvg = totalGoals / (past.length * 2);
    const { playerStats } = calculateStatistics(JSON.parse(JSON.stringify(past)), leagueAvg);
    const { h2hStats } = calculateH2H(JSON.parse(JSON.stringify(past)));
    targetData[key] = { playerStats, h2hStats, matches: blocks[key] };
});

function pct(n, d) { return d > 0 ? (n / d * 100) : 0; }

function evalCfg(cfg) {
    let bets = 0, wins = 0, losses = 0;
    TARGETS.forEach(key => {
        const { playerStats, h2hStats, matches } = targetData[key];
        const predicted = genH2HVariant(matches, playerStats, h2hStats, {}, cfg);
        predicted.forEach(p => {
            if (p.predictionType === "SKIP" || !p.pick) return;
            if (p.hs === p.as) return; // push
            bets++;
            const won = (p.pick === p.home && p.hs > p.as) || (p.pick === p.away && p.as > p.hs);
            if (won) wins++; else losses++;
        });
    });
    const winRate = pct(wins, bets);
    const roi = (winRate / 100 * 1.6 - 1) * 100;
    return { bets, wins, losses, winRate, roi };
}

const BASE = { minMatchesForStats: 3, phase1MinMatches: 5, poorHistMinBets: 9999, poorHistAccThresh: 60 };

const P1_HIGH = [55, 60, 65, 70, 75, 80, 85, 90];
const P1_LOW = [10, 15, 20, 25, 30, 35, 40, 45, 50];
const P2_H2H = [50, 55, 60, 65, 70, 75, 80];
const P2_FORM = [35, 40, 45, 50, 55, 60];
const P3_H2H = [55, 60, 65, 70, 75, 80, 85];

let results = [];
P1_HIGH.forEach(p1h => {
    P1_LOW.forEach(p1l => {
        if (p1l >= p1h) return;
        P2_H2H.forEach(p2h => {
            P2_FORM.forEach(p2f => {
                P3_H2H.forEach(p3h => {
                    const cfg = { ...BASE, phase1HighWR: p1h, phase1LowWR: p1l, phase2H2HWR: p2h, phase2FormWR: p2f, phase3H2HWR: p3h };
                    const r = evalCfg(cfg);
                    if (r.bets > 0) results.push({ cfg, ...r });
                });
            });
        });
    });
});

console.log(`Total configs evaluated: ${results.length}`);

// Sort by ROI desc, then by bets desc (prefer more volume among ties)
results.sort((a, b) => b.roi - a.roi || b.bets - a.bets);

console.log('\nTop 20 configs by ROI on yesterday hold-out (2026-08-13 AM+PM):');
results.slice(0, 20).forEach(r => {
    console.log(`bets=${String(r.bets).padStart(2)} wins=${String(r.wins).padStart(2)} losses=${String(r.losses).padStart(2)} WR=${r.winRate.toFixed(1)}% ROI=${r.roi.toFixed(1)}%  | P1:${r.cfg.phase1HighWR}/${r.cfg.phase1LowWR} P2:${r.cfg.phase2H2HWR}/${r.cfg.phase2FormWR} P3:${r.cfg.phase3H2HWR}`);
});

// Also show baseline for reference
const baselineCfg = { ...BASE, phase1HighWR: 70, phase1LowWR: 40, phase2H2HWR: 60, phase2FormWR: 50, phase3H2HWR: 70 };
const baselineR = evalCfg(baselineCfg);
console.log(`\nBASELINE (70/40, 60/50, 70): bets=${baselineR.bets} wins=${baselineR.wins} losses=${baselineR.losses} WR=${baselineR.winRate.toFixed(1)}% ROI=${baselineR.roi.toFixed(1)}%`);
