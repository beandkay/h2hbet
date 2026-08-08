const { execSync } = require('child_process');
const fs = require('fs');

function getDateString(offsetDays) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

const allFifa = [];
const allNba = [];

console.log("Fetching 21 days of historical data... (This may take ~30 seconds)");

for (let i = -21; i <= 0; i++) {
    const dateStr = getDateString(i);
    console.log(`Fetching ${dateStr}...`);
    
    // FIFA
    try {
        const curlCmdFifa = `curl -s 'https://api-h2h.hudstats.com/v1/schedule/fifa?date=${dateStr}T00:00:00Z' -H 'sec-ch-ua-platform: "macOS"' -H 'Referer: https://h2hggl.com/' -H 'User-Agent: Mozilla/5.0'`;
        const resFifa = execSync(curlCmdFifa, { encoding: 'utf8' });
        const dataFifa = JSON.parse(resFifa);
        if (Array.isArray(dataFifa)) allFifa.push(...dataFifa);
    } catch (e) { console.log(`  -> Error fetching FIFA for ${dateStr}`); }
    
    // NBA
    try {
        const curlCmdNba = `curl -s 'https://api-h2h.hudstats.com/v1/schedule/nba?date=${dateStr}T00:00:00Z' -H 'sec-ch-ua-platform: "macOS"' -H 'Referer: https://h2hggl.com/' -H 'User-Agent: Mozilla/5.0'`;
        const resNba = execSync(curlCmdNba, { encoding: 'utf8' });
        const dataNba = JSON.parse(resNba);
        if (Array.isArray(dataNba)) allNba.push(...dataNba);
    } catch (e) { console.log(`  -> Error fetching NBA for ${dateStr}`); }
}

fs.writeFileSync('historical_fifa.json', JSON.stringify(allFifa, null, 2));
fs.writeFileSync('historical_nba.json', JSON.stringify(allNba, null, 2));
console.log(`\n✅ Done! Fetched ${allFifa.length} FIFA matches and ${allNba.length} NBA matches.`);
