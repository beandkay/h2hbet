const { execSync } = require('child_process');
const path = require('path');
process.chdir(__dirname); // Ensure script always runs in its own directory

function fetchAndAnalyze() {
    console.log(`\n[${new Date().toLocaleTimeString()}] Fetching new eSoccer data (GitHub Actions)...`);
    
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
        
        const curlCmdYesterday = `curl -s 'https://api-h2h.hudstats.com/v1/schedule/fifa?date=${yesterdayStr}T00:00:00Z' \
          -H 'sec-ch-ua-platform: "macOS"' \
          -H 'Referer: https://h2hggl.com/' \
          -H 'User-Agent: Mozilla/5.0' \
          -o api_data_yesterday.json`;
          
        const curlCmdToday = `curl -s 'https://api-h2h.hudstats.com/v1/schedule/fifa?date=${todayStr}T00:00:00Z' \
          -H 'sec-ch-ua-platform: "macOS"' \
          -H 'Referer: https://h2hggl.com/' \
          -H 'User-Agent: Mozilla/5.0' \
          -o api_data_latest.json`;
          
        const curlCmdTomorrow = `curl -s 'https://api-h2h.hudstats.com/v1/schedule/fifa?date=${tomorrowStr}T00:00:00Z' \
          -H 'sec-ch-ua-platform: "macOS"' \
          -H 'Referer: https://h2hggl.com/' \
          -H 'User-Agent: Mozilla/5.0' \
          -o api_data_tomorrow.json`;
          
        execSync(curlCmdYesterday);
        execSync(curlCmdToday);
        execSync(curlCmdTomorrow);
        console.log(`✅ Data successfully downloaded for ${yesterdayStr}, ${todayStr}, and ${tomorrowStr}`);
    } catch (error) {
        console.error("❌ Error fetching data:", error.message);
        process.exit(1);
    }

    // 2. Run the analysis script
    try {
        console.log("⚙️ Running pattern analysis...");
        execSync('node analyze_patterns.js', { stdio: 'inherit' });
        console.log("✅ Analysis complete!");
    } catch (error) {
        console.error("❌ Error running analysis:", error.message);
        process.exit(1);
    }
}

// Run immediately and exit
fetchAndAnalyze();
