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
const H2H_TIGHT = { ...H2H_BASELINE, name: 'Tightened (75/35)', phase1HighWR: 75, phase1LowWR: 35 };

const OU_BASELINE = { name: 'CURRENT (baseline)', optimalOv: 3.1, optimalUn: 2.5, styleMode: 'strict', poorHistAccThresh: 50 };
const OU_WIDE = { ...OU_BASELINE, name: 'Widened (3.3/2.3) + tighter poor-hist(<60%)', optimalOv: 3.3, optimalUn: 2.3, poorHistAccThresh: 60 };

const { h2hResults, ouResults } = runWalkForward(allMatches, [H2H_BASELINE, H2H_TIGHT], [OU_BASELINE, OU_WIDE], 50);

// Identify rotation keys, sorted, and pick out yesterday's two (2026-08-13 AM/PM)
const allKeys = Object.keys(h2hResults[0].byRotation).sort();
console.log('All evaluated rotation keys:', allKeys.join(', '));

const holdoutKeys = allKeys.filter(k => k.startsWith('2026-08-13'));
console.log('\nHold-out (yesterday) rotation keys:', holdoutKeys.join(', ') || '(none found)');

function pct(n, d) { return d > 0 ? (n / d * 100) : 0; }
function summarize(results, keys) {
    return results.map(r => {
        let bets = 0, wins = 0, losses = 0;
        keys.forEach(k => {
            const rot = r.byRotation[k];
            if (rot) { bets += rot.bets; wins += rot.wins; losses += rot.losses; }
        });
        return { name: r.cfg.name, bets, wins, losses, winRate: pct(wins, bets), roi: (pct(wins, bets) / 100 * 1.6 - 1) * 100 };
    });
}

console.log('\n=== H2H — per-rotation breakdown for yesterday (2026-08-13) ===');
holdoutKeys.forEach(k => {
    h2hResults.forEach(r => {
        const rot = r.byRotation[k];
        console.log(`${k.padEnd(16)} ${r.cfg.name.padEnd(25)} bets=${rot.bets} wins=${rot.wins} losses=${rot.losses} winRate=${pct(rot.wins, rot.bets).toFixed(1)}%`);
    });
});
console.log('\nH2H combined over hold-out rotations:');
summarize(h2hResults, holdoutKeys).forEach(s => {
    console.log(`${s.name.padEnd(25)} bets=${s.bets} wins=${s.wins} losses=${s.losses} winRate=${s.winRate.toFixed(1)}% ROI=${s.roi.toFixed(1)}%`);
});

console.log('\n=== OU — per-rotation breakdown for yesterday (2026-08-13) ===');
holdoutKeys.forEach(k => {
    ouResults.forEach(r => {
        const rot = r.byRotation[k];
        console.log(`${k.padEnd(16)} ${r.cfg.name.padEnd(45)} bets=${rot.bets} wins=${rot.wins} losses=${rot.losses} winRate=${pct(rot.wins, rot.bets).toFixed(1)}%`);
    });
});
console.log('\nOU combined over hold-out rotations:');
summarize(ouResults, holdoutKeys).forEach(s => {
    console.log(`${s.name.padEnd(45)} bets=${s.bets} wins=${s.wins} losses=${s.losses} winRate=${s.winRate.toFixed(1)}% ROI=${s.roi.toFixed(1)}%`);
});

// Also show "training" rotations (everything except the hold-out) for comparison
const trainKeys = allKeys.filter(k => !holdoutKeys.includes(k));
console.log('\n=== H2H combined over training rotations (everything except yesterday) ===');
summarize(h2hResults, trainKeys).forEach(s => {
    console.log(`${s.name.padEnd(25)} bets=${s.bets} wins=${s.wins} losses=${s.losses} winRate=${s.winRate.toFixed(1)}% ROI=${s.roi.toFixed(1)}%`);
});
console.log('\n=== OU combined over training rotations (everything except yesterday) ===');
summarize(ouResults, trainKeys).forEach(s => {
    console.log(`${s.name.padEnd(45)} bets=${s.bets} wins=${s.wins} losses=${s.losses} winRate=${s.winRate.toFixed(1)}% ROI=${s.roi.toFixed(1)}%`);
});
