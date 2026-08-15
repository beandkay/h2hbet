const fs = require('fs');
const { runWalkForward } = require('./tune');

const allMatches = JSON.parse(fs.readFileSync(__dirname + '/recent_7day.json', 'utf8'));

const H2H_BASELINE = {
    name: 'CURRENT (baseline)',
    minMatchesForStats: 3,
    phase1MinMatches: 5, phase1HighWR: 70, phase1LowWR: 40,
    phase2H2HWR: 60, phase2FormWR: 50,
    phase3H2HWR: 70,
    poorHistMinBets: 3, poorHistAccThresh: 60
};

const h2hConfigs = [
    H2H_BASELINE,
    { ...H2H_BASELINE, name: 'Phase1 only stricter (75/35)', phase1HighWR: 75, phase1LowWR: 35 },
    { ...H2H_BASELINE, name: 'Phase1+2 stricter (75/35, h2h65/form55)', phase1HighWR: 75, phase1LowWR: 35, phase2H2HWR: 65, phase2FormWR: 55 },
    { ...H2H_BASELINE, name: 'Phase1+2+3 stricter (+5 all)', phase1HighWR: 75, phase1LowWR: 35, phase2H2HWR: 65, phase2FormWR: 55, phase3H2HWR: 75 },
    { ...H2H_BASELINE, name: 'Phase1 72/38 (mild)', phase1HighWR: 72, phase1LowWR: 38 },
    { ...H2H_BASELINE, name: 'Phase1 78/32 (aggressive)', phase1HighWR: 78, phase1LowWR: 32 },
    { ...H2H_BASELINE, name: 'Phase1 75/35 + Phase3 75', phase1HighWR: 75, phase1LowWR: 35, phase3H2HWR: 75 },
    { ...H2H_BASELINE, name: 'Phase1 75/35 + form gate 55 (form>=55 both)', phase1HighWR: 75, phase1LowWR: 35, phase1MinMatches: 5, phase2FormWR: 55 },
    { ...H2H_BASELINE, name: 'Looser phase1 (65/45)', phase1HighWR: 65, phase1LowWR: 45 },
    { ...H2H_BASELINE, name: 'Looser all phases (-5)', phase1HighWR: 65, phase1LowWR: 45, phase2H2HWR: 55, phase2FormWR: 45, phase3H2HWR: 65 },
];

const OU_BASELINE = { name: 'CURRENT (baseline)', optimalOv: 3.1, optimalUn: 2.5, styleMode: 'strict', poorHistAccThresh: 50 };

const ouConfigs = [
    OU_BASELINE,
    { ...OU_BASELINE, name: 'Strict, wider band (3.3 / 2.3)', optimalOv: 3.3, optimalUn: 2.3 },
    { ...OU_BASELINE, name: 'Strict, even wider (3.5 / 2.1)', optimalOv: 3.5, optimalUn: 2.1 },
    { ...OU_BASELINE, name: 'Strict, very wide (3.7 / 1.9)', optimalOv: 3.7, optimalUn: 1.9 },
    { ...OU_BASELINE, name: 'Strict, wide OVER only (3.3 / 2.5)', optimalOv: 3.3, optimalUn: 2.5 },
    { ...OU_BASELINE, name: 'Strict, wide UNDER only (3.1 / 2.3)', optimalOv: 3.1, optimalUn: 2.3 },
    { ...OU_BASELINE, name: 'Strict, wider band + stricter poor-hist (<60%)', optimalOv: 3.3, optimalUn: 2.3, poorHistAccThresh: 60 },
    { ...OU_BASELINE, name: 'Strict, wider band + stricter poor-hist (<65%)', optimalOv: 3.3, optimalUn: 2.3, poorHistAccThresh: 65 },
    { ...OU_BASELINE, name: 'Loose style gate (either side)', styleMode: 'loose' },
    { ...OU_BASELINE, name: 'No style gate', styleMode: 'none' },
];

const { h2hResults, ouResults, rotationsEvaluated, totalRotations } = runWalkForward(allMatches, h2hConfigs, ouConfigs, 50);

console.log(`Rotations evaluated: ${rotationsEvaluated} / ${totalRotations} total blocks (warm-up requires >=50 past matches)\n`);

console.log('=== H2H WINNER PREDICTION (Draw-No-Bet) — $5 stake, 1.6x payout, breakeven=62.5% ===');
h2hResults.forEach(r => {
    console.log(`${r.cfg.name.padEnd(45)} bets=${String(r.bets).padStart(4)}  wins=${String(r.wins).padStart(4)}  losses=${String(r.losses).padStart(4)}  winRate=${r.winRate.toFixed(1)}%  ROI=${r.roi.toFixed(1)}%`);
});

console.log('\n=== OU 2.5 PREDICTION — $5 stake, 1.6x payout, breakeven=62.5% ===');
ouResults.forEach(r => {
    console.log(`${r.cfg.name.padEnd(45)} bets=${String(r.bets).padStart(4)}  wins=${String(r.wins).padStart(4)}  losses=${String(r.losses).padStart(4)}  winRate=${r.winRate.toFixed(1)}%  ROI=${r.roi.toFixed(1)}%`);
});
