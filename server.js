const http = require('http');
const fs = require('fs');
const path = require('path');
const { fetchData } = require('./src/fetcher');
const { runAnalysis } = require('./src/analyzer');
const { updateHistoricalStore } = require('./src/historical_store');

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

const PORT = 3000;
const PUBLIC_DIR = __dirname; 

const mimeTypes = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.json': 'application/json'
};

const server = http.createServer((req, res) => {
    let filePath = path.join(PUBLIC_DIR, req.url === '/' ? 'index.html' : req.url);
    const extname = path.extname(filePath);
    const contentType = mimeTypes[extname] || 'text/plain';

    fs.readFile(filePath, (err, content) => {
        if (err) {
            if (err.code === 'ENOENT') {
                res.writeHead(404);
                res.end('404 Not Found');
            } else {
                res.writeHead(500);
                res.end('500 Internal Server Error');
            }
        } else {
            const headers = { 'Content-Type': contentType };
            // dashboard_data.js is regenerated every 5 min; the browser poll relies on always
            // seeing the latest bytes, so never let it be cached. Same for the HTML shell.
            const base = path.basename(filePath);
            if (base === 'dashboard_data.js' || base === 'index.html') {
                headers['Cache-Control'] = 'no-store, must-revalidate';
                headers['Pragma'] = 'no-cache';
                headers['Expires'] = '0';
            }
            res.writeHead(200, headers);
            res.end(content, 'utf-8');
        }
    });
});

async function runPipeline() {
    try {
        console.log(`\n[${new Date().toLocaleTimeString()}] Starting backend analytical pipeline...`);

        // 1. Fetch live data
        const matches = await fetchData();
        if (!matches || matches.length === 0) {
            console.error("No matches retrieved. Aborting pipeline run.");
            return;
        }

        // 1b. Roll the 30-day raw match store forward — a cheap dedupe/merge, not a
        // replay — so H2H/OU2.5 results outlive the API's 3-day fetch window.
        updateHistoricalStore(matches);

        // 2. Analysis and Prediction Generation (Poisson + Elo models)
        console.log("Running pattern analysis and prediction engines...");
        const analysisData = runAnalysis(matches);

        // 3. Combine and export state
        analysisData.backtestOutput = formatReport(analysisData.extraModelPerformance);

        const outputJs = `const dashboardData = ${JSON.stringify(analysisData, null, 2)};`;
        fs.writeFileSync(path.join(__dirname, 'dashboard_data.js'), outputJs);
        console.log("✅ Pipeline complete. Dashboard data refreshed.");
        
    } catch (e) {
        console.error("❌ Fatal error in pipeline execution:", e);
    }
}

const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes — matches GitHub Actions cadence
let pipelineInFlight = false;

async function safeRunPipeline() {
    if (pipelineInFlight) {
        console.log("Pipeline already running — skipping this tick.");
        return;
    }
    pipelineInFlight = true;
    try {
        await runPipeline();
    } finally {
        pipelineInFlight = false;
    }
}

server.listen(PORT, async () => {
    console.log(`\n🚀 Local dashboard running at http://localhost:${PORT}`);

    // Run pipeline immediately on boot
    await safeRunPipeline();

    // Then re-run every 5 minutes so data (and profit numbers) stay fresh locally.
    setInterval(safeRunPipeline, REFRESH_INTERVAL_MS);
    console.log(`⏱  Auto-refresh scheduled every ${REFRESH_INTERVAL_MS / 60000} min.`);
});
