const { fetchData } = require('./src/fetcher');
const { runAnalysis } = require('./src/analyzer');
const { updateHistoricalStore } = require('./src/historical_store');
const fs = require('fs');
const path = require('path');

function line(label, p) {
    return `  ${label.padEnd(13)} Bets: ${p.bets} | ${p.wins}W/${p.bets - p.wins}L | WR: ${p.wr.toFixed(1)}% | Profit: $${p.profit.toFixed(2)} | Coverage: ${p.cov.toFixed(1)}%`;
}

function formatReport(perf) {
    if (!perf) return 'No historical data available yet.';
    const r = perf.rotation;
    const rotationTotalProfit = r.h2hPoisson.profit + r.h2hElo.profit + r.ouPoisson.profit + r.ouElo.profit;
    const rotationOverProfit = r.ouPoisson.over.profit + r.ouElo.over.profit;
    const rotationUnderProfit = r.ouPoisson.under.profit + r.ouElo.under.profit;

    return `🧪 Poisson/Elo Prediction Models — Live 45-Day Performance (All-Time)
${line('OU·Poisson', perf.ouPoisson)}
${line('OU·Elo', perf.ouElo)}
${line('H2H·Poisson', perf.h2hPoisson)}
${line('H2H·Elo', perf.h2hElo)}

====================================
📊 This Rotation
${line('OU·Poisson', r.ouPoisson)}
${line('OU·Elo', r.ouElo)}
${line('H2H·Poisson', r.h2hPoisson)}
${line('H2H·Elo', r.h2hElo)}

  Over 2.5  — Poisson: $${r.ouPoisson.over.profit.toFixed(2)} | Elo: $${r.ouElo.over.profit.toFixed(2)} | Total: $${rotationOverProfit.toFixed(2)}
  Under 2.5 — Poisson: $${r.ouPoisson.under.profit.toFixed(2)} | Elo: $${r.ouElo.under.profit.toFixed(2)} | Total: $${rotationUnderProfit.toFixed(2)}

====================================
📊 GRAND TOTAL (This Rotation)
Total Profit: $${rotationTotalProfit.toFixed(2)}`;
}

async function forceRun() {
    console.log(`\n[${new Date().toLocaleTimeString()}] Starting GitHub Actions analytical pipeline...`);

    // 1. Fetch live data
    const matches = await fetchData();
    if (!matches || matches.length === 0) {
        console.error("No matches retrieved. Aborting pipeline run.");
        process.exit(1);
    }

    // 1b. Roll the historical store forward with any newly-ended matches. The
    //     Poisson/Elo models read historical_fifa.json — updating it here means
    //     they train against a fresh 30-day rolling window, not stale data.
    const storeInfo = updateHistoricalStore(matches);
    if (storeInfo.oldest) {
        console.log(`📚 Historical store: ${storeInfo.total} matches (${storeInfo.oldest.slice(0,10)} → ${storeInfo.newest.slice(0,10)}), +${storeInfo.added} added this tick, window=${storeInfo.windowDays}d.`);
    }

    // 2. Analysis and Prediction Generation (Poisson + Elo models)
    console.log("Running pattern analysis and prediction engines...");
    const analysisData = runAnalysis(matches);

    // 3. Combine and export state
    analysisData.backtestOutput = formatReport(analysisData.extraModelPerformance);

    const outputJs = `const dashboardData = ${JSON.stringify(analysisData, null, 2)};`;
    fs.writeFileSync(path.join(__dirname, 'dashboard_data.js'), outputJs);
    console.log("✅ Pipeline complete. dashboard_data.js generated successfully.");
}

forceRun().catch(e => {
    console.error("❌ Fatal error in pipeline execution:", e);
    process.exit(1);
});
