// node model_lab/run_compare.js [datafile]
// Compares two from-scratch models per market against the current shipped production
// model (src/predictor_ou.js / src/predictor_h2h.js), on the same 30-day dataset used
// throughout this session's tuning work.
const path = require('path');
const { loadMatches, bucketFrontier, runProductionOUBaseline, runProductionH2HBaseline } = require('./backtest');
const ouPoisson = require('./ou/poisson');
const ouElo = require('./ou/elo_over');
const h2hPoisson = require('./h2h/poisson');
const h2hElo = require('./h2h/elo');

const DATA_FILE = process.argv[2] || path.join(__dirname, '../tmp_backtest/recent_31day_fresh.json');
const matches = loadMatches(DATA_FILE);
console.log(`Loaded ${matches.length} ended matches from ${DATA_FILE}\n`);

console.log('=== Production baselines (sanity check vs session-verified numbers) ===');
const ouBase = runProductionOUBaseline(matches);
console.log(`OU  production: bets=${ouBase.bets} cov=${ouBase.cov.toFixed(1)}% WR=${ouBase.wr.toFixed(1)}% Profit=$${ouBase.profit.toFixed(0)}`);
const h2hBase = runProductionH2HBaseline(matches);
console.log(`H2H production: bets=${h2hBase.bets} attempted=${h2hBase.attempted} cov=${h2hBase.cov.toFixed(1)}% WR=${h2hBase.wr.toFixed(1)}% Profit=$${h2hBase.profit.toFixed(0)}`);

const OU_ALPHAS = [0.08, 0.12, 0.15, 0.20, 0.25, 0.30];
const OU_K = [0.1, 0.15, 0.2, 0.3, 0.4, 0.5];
const OU_THRESH = [0.50, 0.55, 0.58, 0.60, 0.62, 0.65, 0.68, 0.70, 0.72, 0.75, 0.78, 0.80];
const H2H_ALPHAS = [0.08, 0.12, 0.15, 0.20, 0.25, 0.30];
const H2H_K = [12, 16, 20, 24, 32, 40];
const H2H_THRESH = [0.50, 0.55, 0.58, 0.60, 0.62, 0.65, 0.68, 0.70, 0.75, 0.80];
const OU_BUCKETS = [[10, 15], [15, 20], [18, 22], [20, 25]];
const H2H_BUCKETS = [[8, 12], [12, 16], [15, 20], [18, 22]];

console.log('\n=== OU-Poisson (EWMA goals + Poisson CDF) sweep ===');
const ouPoissonRows = [];
OU_ALPHAS.forEach(alpha => {
    OU_THRESH.forEach(threshOver => {
        OU_THRESH.forEach(threshUnder => {
            const r = ouPoisson.run(matches, { alpha, threshOver, threshUnder });
            if (r.bets >= 5) ouPoissonRows.push(r);
        });
    });
});
console.log(`Configs tested: ${ouPoissonRows.length}`);
bucketFrontier(ouPoissonRows, OU_BUCKETS, r => `alpha=${r.params.alpha} thOver=${r.params.threshOver.toFixed(2)} thUnder=${r.params.threshUnder.toFixed(2)}`);

console.log('\n=== OU-Elo (online logistic over-proneness rating) sweep ===');
const ouEloRows = [];
OU_K.forEach(K => {
    OU_THRESH.forEach(threshOver => {
        OU_THRESH.forEach(threshUnder => {
            const r = ouElo.run(matches, { K, threshOver, threshUnder });
            if (r.bets >= 5) ouEloRows.push(r);
        });
    });
});
console.log(`Configs tested: ${ouEloRows.length}`);
bucketFrontier(ouEloRows, OU_BUCKETS, r => `K=${r.params.K} thOver=${r.params.threshOver.toFixed(2)} thUnder=${r.params.threshUnder.toFixed(2)}`);

console.log('\n=== H2H-Poisson (EWMA goals + Skellam-equivalent convolution) sweep ===');
const h2hPoissonRows = [];
H2H_ALPHAS.forEach(alpha => {
    H2H_THRESH.forEach(threshold => {
        const r = h2hPoisson.run(matches, { alpha, threshold });
        if (r.bets >= 5) h2hPoissonRows.push(r);
    });
});
console.log(`Configs tested: ${h2hPoissonRows.length}`);
bucketFrontier(h2hPoissonRows, H2H_BUCKETS, r => `alpha=${r.params.alpha} threshold=${r.params.threshold.toFixed(2)}`);

console.log('\n=== H2H-Elo (classic chess Elo) sweep ===');
const h2hEloRows = [];
H2H_K.forEach(K => {
    H2H_THRESH.forEach(threshold => {
        const r = h2hElo.run(matches, { K, threshold });
        if (r.bets >= 5) h2hEloRows.push(r);
    });
});
console.log(`Configs tested: ${h2hEloRows.length}`);
bucketFrontier(h2hEloRows, H2H_BUCKETS, r => `K=${r.params.K} threshold=${r.params.threshold.toFixed(2)}`);

function bestInBand(rows, lo, hi) {
    const bucket = rows.filter(r => r.cov >= lo && r.cov < hi);
    if (!bucket.length) return null;
    return [...bucket].sort((a, b) => b.profit - a.profit)[0];
}

console.log('\n\n=========== FINAL COMPARISON ===========');
console.log('\nOU market (matched coverage band ~15-20%, falling back to ~10-25% if empty):');
console.log(`  Production : cov=${ouBase.cov.toFixed(1).padStart(5)}% WR=${ouBase.wr.toFixed(1).padStart(5)}% Profit=$${ouBase.profit.toFixed(0)}`);
[['OU-Poisson', ouPoissonRows], ['OU-Elo', ouEloRows]].forEach(([name, rows]) => {
    const best = bestInBand(rows, 15, 20) || bestInBand(rows, 10, 25);
    console.log(best
        ? `  ${name.padEnd(11)}: cov=${best.cov.toFixed(1).padStart(5)}% WR=${best.wr.toFixed(1).padStart(5)}% Profit=$${best.profit.toFixed(0)} | ${JSON.stringify(best.params)}`
        : `  ${name.padEnd(11)}: no config reached usable coverage`);
});

console.log('\nH2H market (matched coverage band ~12-18%, falling back to ~8-22% if empty):');
console.log(`  Production : cov=${h2hBase.cov.toFixed(1).padStart(5)}% WR=${h2hBase.wr.toFixed(1).padStart(5)}% Profit=$${h2hBase.profit.toFixed(0)}`);
[['H2H-Poisson', h2hPoissonRows], ['H2H-Elo', h2hEloRows]].forEach(([name, rows]) => {
    const best = bestInBand(rows, 12, 18) || bestInBand(rows, 8, 22);
    console.log(best
        ? `  ${name.padEnd(11)}: cov=${best.cov.toFixed(1).padStart(5)}% WR=${best.wr.toFixed(1).padStart(5)}% Profit=$${best.profit.toFixed(0)} | ${JSON.stringify(best.params)}`
        : `  ${name.padEnd(11)}: no config reached usable coverage`);
});
