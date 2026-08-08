const { execSync } = require('child_process');

function fetchAndAnalyze() {
    console.log(`\n[${new Date().toLocaleTimeString()}] Fetching new eBasketball data...`);
    
    function getDateString(offsetDays = 0) {
        const d = new Date();
        d.setDate(d.getDate() + offsetDays);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    try {
        const yesterdayStr = getDateString(-1);
        const todayStr = getDateString(0);
        const tomorrowStr = getDateString(1);
        
        const curlCmdYesterday = `curl -s 'https://api-h2h.hudstats.com/v1/schedule/nba?date=${yesterdayStr}T00:00:00Z' \
          -H 'sec-ch-ua-platform: "macOS"' \
          -H 'Referer: https://h2hggl.com/' \
          -H 'User-Agent: Mozilla/5.0' \
          -o nba_api_yesterday.json`;
          
        const curlCmdToday = `curl -s 'https://api-h2h.hudstats.com/v1/schedule/nba?date=${todayStr}T00:00:00Z' \
          -H 'sec-ch-ua-platform: "macOS"' \
          -H 'Referer: https://h2hggl.com/' \
          -H 'User-Agent: Mozilla/5.0' \
          -o nba_api_latest.json`;
          
        const curlCmdTomorrow = `curl -s 'https://api-h2h.hudstats.com/v1/schedule/nba?date=${tomorrowStr}T00:00:00Z' \
          -H 'sec-ch-ua-platform: "macOS"' \
          -H 'Referer: https://h2hggl.com/' \
          -H 'User-Agent: Mozilla/5.0' \
          -o nba_api_tomorrow.json`;
          
        execSync(curlCmdYesterday);
        execSync(curlCmdToday);
        execSync(curlCmdTomorrow);
        console.log(`✅ Data successfully downloaded for ${yesterdayStr}, ${todayStr}, and ${tomorrowStr}`);
    } catch (error) {
        console.error("❌ Error fetching data:", error.message);
        return;
    }

    // 2. Run the analysis script
    try {
        console.log("⚙️ Running pattern analysis...");
        execSync('node analyze_patterns_nba.js', { stdio: 'inherit' });
        console.log("✅ Analysis complete! Check ebasketball_analysis.md");
    } catch (error) {
        console.error("❌ Error running analyze_patterns_nba.js:", error.message);
    }
}

// Run immediately on start
fetchAndAnalyze();

// Set interval to run every 5 minutes (5 * 60 * 1000 = 300,000 ms)
const INTERVAL_MS = 5 * 60 * 1000;
console.log(`\n⏱️ Auto-fetcher started. Waiting ${INTERVAL_MS / 1000 / 60} minutes until next run... (Press Ctrl+C to stop)`);

setInterval(fetchAndAnalyze, INTERVAL_MS);
