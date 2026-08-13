const http = require('http');
const fs = require('fs');
const path = require('path');
const { fetchData } = require('./src/fetcher');
const { runAnalysis } = require('./src/analyzer');
const { runTodayBacktest, runHistoricalBacktest } = require('./src/backtester');

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
            res.writeHead(200, { 'Content-Type': contentType });
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

        // 2. Historical Backtest (updates local memory cache and exports to disk)
        console.log("Running historical backtest...");
        const historicalOUStats = runHistoricalBacktest(matches);

        // 3. Today's Backtest
        console.log("Running today's rotation backtest...");
        const { report: todayReport, currentRotationOUStats } = runTodayBacktest(matches, historicalOUStats);

        // 4. Analysis and Prediction Generation (Using Current Rotation OU Stats!)
        console.log("Running pattern analysis and prediction engines...");
        const analysisData = runAnalysis(matches, currentRotationOUStats);

        // 5. Combine and export state
        analysisData.backtestOutput = todayReport;
        
        const outputJs = `const dashboardData = ${JSON.stringify(analysisData, null, 2)};`;
        fs.writeFileSync(path.join(__dirname, 'dashboard_data.js'), outputJs);
        console.log("✅ Pipeline complete. Dashboard data refreshed.");
        
    } catch (e) {
        console.error("❌ Fatal error in pipeline execution:", e);
    }
}

server.listen(PORT, async () => {
    console.log(`\n🚀 Local dashboard running at http://localhost:${PORT}`);
    
    // Run pipeline immediately on boot
    await runPipeline();
    
    // Set pipeline to run every 5 minutes natively
    const INTERVAL_MS = 5 * 60 * 1000;
    console.log(`⏱️ Auto-fetcher pipeline scheduled every 5 minutes.`);
    setInterval(runPipeline, INTERVAL_MS);
});
