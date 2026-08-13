const { fetchData } = require('./src/fetcher');
const { runAnalysis } = require('./src/analyzer');
const { runTodayBacktest, runHistoricalBacktest } = require('./src/backtester');
const fs = require('fs');
const path = require('path');

async function forceRun() {
    console.log(`\n[${new Date().toLocaleTimeString()}] Starting GitHub Actions analytical pipeline...`);
    
    // 1. Fetch live data
    const matches = await fetchData();
    if (!matches || matches.length === 0) {
        console.error("No matches retrieved. Aborting pipeline run.");
        process.exit(1);
    }

    // 2. Historical Backtest
    console.log("Running historical backtest...");
    const historicalOUStats = runHistoricalBacktest(matches);

    // 3. Today's Backtest
    console.log("Running today's rotation backtest...");
    const { report: todayReport, currentRotationOUStats } = runTodayBacktest(matches, historicalOUStats);

    // 4. Analysis and Prediction Generation
    console.log("Running pattern analysis and prediction engines...");
    const analysisData = runAnalysis(matches, currentRotationOUStats);

    // 5. Combine and export state
    analysisData.backtestOutput = todayReport;
    
    const outputJs = `const dashboardData = ${JSON.stringify(analysisData, null, 2)};`;
    fs.writeFileSync(path.join(__dirname, 'dashboard_data.js'), outputJs);
    console.log("✅ Pipeline complete. dashboard_data.js generated successfully.");
}

forceRun().catch(e => {
    console.error("❌ Fatal error in pipeline execution:", e);
    process.exit(1);
});
