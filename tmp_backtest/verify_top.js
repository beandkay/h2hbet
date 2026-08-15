const fs = require('fs');
const { calculateStatistics } = require('../src/statistics');
const { calculateH2H } = require('../src/h2h_engine');
const { groupMatchesByRotation, genH2HVariant, genOUVariant } = require('./tune');

const allMatches = JSON.parse(fs.readFileSync(__dirname + '/recent_7day.json', 'utf8'));
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

const H2H_CFGS = [
    { name: 'BASELINE (70/40, 60/50, 70)',      minMatchesForStats: 3, phase1MinMatches: 5, phase1HighWR: 70, phase1LowWR: 40, phase2H2HWR: 60, phase2FormWR: 50, phase3H2HWR: 70, poorHistMinBets: 3, poorHistAccThresh: 60 },
    { name: 'BEST-PROFIT (60/45, 50/55, 70)',   minMatchesForStats: 3, phase1MinMatches: 5, phase1HighWR: 60, phase1LowWR: 45, phase2H2HWR: 50, phase2FormWR: 55, phase3H2HWR: 70, poorHistMinBets: 3, poorHistAccThresh: 60 },
    { name: 'BEST-ROI (60/45, 50/55, 80)',      minMatchesForStats: 3, phase1MinMatches: 5, phase1HighWR: 60, phase1LowWR: 45, phase2H2HWR: 50, phase2FormWR: 55, phase3H2HWR: 80, poorHistMinBets: 3, poorHistAccThresh: 60 },
    { name: 'HIGH-VOLUME (60/45, 60/45, 70)',   minMatchesForStats: 3, phase1MinMatches: 5, phase1HighWR: 60, phase1LowWR: 45, phase2H2HWR: 60, phase2FormWR: 45, phase3H2HWR: 70, poorHistMinBets: 3, poorHistAccThresh: 60 },
];

const OU_CFGS = [
    { name: 'BASELINE (3.1/2.5, strict, <50)',      optimalOv: 3.1, optimalUn: 2.5, styleMode: 'strict', poorHistAccThresh: 50 },
    { name: 'BEST-PROFIT (3.7/2.7, loose, <60)',    optimalOv: 3.7, optimalUn: 2.7, styleMode: 'loose',  poorHistAccThresh: 60 },
    { name: 'BEST-ROI (3.7/2.3, loose, <60)',       optimalOv: 3.7, optimalUn: 2.3, styleMode: 'loose',  poorHistAccThresh: 60 },
    { name: 'HIGH-VOLUME (3.6/2.7, loose, <60)',    optimalOv: 3.6, optimalUn: 2.7, styleMode: 'loose',  poorHistAccThresh: 60 },
];

function pct(n, d) { return d > 0 ? (n / d * 100) : 0; }

function evalH2H(cfg, includeKeys) {
    let bets = 0, wins = 0, losses = 0;
    const h2hHistory = {};
    evalKeys.forEach(key => {
        const { playerStats, h2hStats, matches } = perRotation[key];
        const predicted = genH2HVariant(matches, playerStats, h2hStats, h2hHistory, cfg);
        predicted.forEach(p => {
            if (!h2hHistory[p.pairKey]) h2hHistory[p.pairKey] = { dnbBets: 0, dnbCorrect: 0 };
            if (p.predictionType === "SKIP" || !p.pick) return;
            if (p.hs === p.as) return;
            h2hHistory[p.pairKey].dnbBets++;
            const won = (p.pick === p.home && p.hs > p.as) || (p.pick === p.away && p.as > p.hs);
            if (won) h2hHistory[p.pairKey].dnbCorrect++;
            if (includeKeys && !includeKeys.includes(key)) return;
            bets++;
            if (won) wins++; else losses++;
        });
    });
    const winRate = pct(wins, bets);
    const roi = (winRate / 100 * 1.6 - 1) * 100;
    return { bets, wins, losses, winRate, roi, profit: bets * 5 * (winRate / 100 * 1.6 - 1) };
}

function evalOU(cfg, includeKeys) {
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
            playerOU[p.home].bets++; playerOU[p.away].bets++;
            const won = (p.pick === 'OVER' && totalG > 2.5) || (p.pick === 'UNDER' && totalG < 2.5);
            if (won) { playerOU[p.home].correct++; playerOU[p.away].correct++; }
            if (includeKeys && !includeKeys.includes(key)) return;
            bets++;
            if (won) wins++; else losses++;
        });
    });
    const winRate = pct(wins, bets);
    const roi = (winRate / 100 * 1.6 - 1) * 100;
    return { bets, wins, losses, winRate, roi, profit: bets * 5 * (winRate / 100 * 1.6 - 1) };
}

const yesterdayKeys = ['2026-08-13_AM', '2026-08-13_PM'];

console.log('=== H2H — 7-day full window vs yesterday-only ===');
console.log('CONFIG                                   | FULL 7-DAY (16 rotations)                          | YESTERDAY ONLY (2 rotations)');
console.log('-'.repeat(160));
H2H_CFGS.forEach(cfg => {
    const full = evalH2H(cfg);
    const y = evalH2H(cfg, yesterdayKeys);
    console.log(`${cfg.name.padEnd(40)} | bets=${String(full.bets).padStart(3)} WR=${full.winRate.toFixed(1).padStart(5)}% ROI=${full.roi.toFixed(1).padStart(6)}% Profit=$${full.profit.toFixed(0).padStart(4)} | bets=${String(y.bets).padStart(2)} WR=${y.winRate.toFixed(1).padStart(5)}% ROI=${y.roi.toFixed(1).padStart(6)}% Profit=$${y.profit.toFixed(0).padStart(4)}`);
});

console.log('\n=== OU — 7-day full window vs yesterday-only ===');
console.log('CONFIG                                   | FULL 7-DAY (16 rotations)                          | YESTERDAY ONLY (2 rotations)');
console.log('-'.repeat(160));
OU_CFGS.forEach(cfg => {
    const full = evalOU(cfg);
    const y = evalOU(cfg, yesterdayKeys);
    console.log(`${cfg.name.padEnd(40)} | bets=${String(full.bets).padStart(4)} WR=${full.winRate.toFixed(1).padStart(5)}% ROI=${full.roi.toFixed(1).padStart(6)}% Profit=$${full.profit.toFixed(0).padStart(4)} | bets=${String(y.bets).padStart(2)} WR=${y.winRate.toFixed(1).padStart(5)}% ROI=${y.roi.toFixed(1).padStart(6)}% Profit=$${y.profit.toFixed(0).padStart(4)}`);
});
