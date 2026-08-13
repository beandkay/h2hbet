const { execSync } = require('child_process');

function getDateString(offsetDays = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function fetchWithCurl(url) {
    try {
        const cmd = `curl -s '${url}' -H 'sec-ch-ua-platform: "macOS"' -H 'Referer: https://h2hggl.com/' -H 'User-Agent: Mozilla/5.0'`;
        const output = execSync(cmd, { encoding: 'utf8' });
        return JSON.parse(output);
    } catch (e) {
        console.error("Curl error:", e.message);
        return [];
    }
}

async function fetchData() {
    console.log(`[${new Date().toLocaleTimeString()}] Fetching new eSoccer data via curl...`);
    const yesterdayStr = getDateString(-1);
    const todayStr = getDateString(0);
    const tomorrowStr = getDateString(1);

    const urls = [
        `https://api-h2h.hudstats.com/v1/schedule/fifa?date=${yesterdayStr}T00:00:00Z`,
        `https://api-h2h.hudstats.com/v1/schedule/fifa?date=${todayStr}T00:00:00Z`,
        `https://api-h2h.hudstats.com/v1/schedule/fifa?date=${tomorrowStr}T00:00:00Z`
    ];

    try {
        const results = urls.map(url => fetchWithCurl(url));
        
        let allMatches = [];
        if (Array.isArray(results[0])) allMatches = allMatches.concat(results[0]);
        if (Array.isArray(results[1])) allMatches = allMatches.concat(results[1]);
        if (Array.isArray(results[2])) allMatches = allMatches.concat(results[2]);
        
        console.log(`✅ Data successfully downloaded and parsed. Total matches retrieved: ${allMatches.length}`);
        return allMatches;
    } catch (e) {
        console.error("❌ Error fetching data:", e.message);
        return [];
    }
}

module.exports = { fetchData };
