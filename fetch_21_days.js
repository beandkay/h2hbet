const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const histDir = path.join(__dirname, 'hist_data');
if (!fs.existsSync(histDir)) {
    fs.mkdirSync(histDir);
}

// Today is 2026-08-07
const baseDate = new Date('2026-08-07T00:00:00+10:00');

for (let i = 20; i >= 0; i--) {
    const d = new Date(baseDate);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    const urlDate = `${dateStr}T00:00:00%2B10:00`;
    
    console.log(`Fetching data for ${dateStr}...`);
    
    const curlCmd = `curl -s 'https://api-h2h.hudstats.com/v1/schedule/fifa?date=${urlDate}' \
  -H 'sec-ch-ua-platform: "macOS"' \
  -H 'Referer: https://h2hggl.com/' \
  -H 'User-Agent: Mozilla/5.0'`;

    try {
        const output = execSync(curlCmd, { encoding: 'utf8' });
        const data = JSON.parse(output);
        const fileName = `fifa_${dateStr}.json`;
        fs.writeFileSync(path.join(histDir, fileName), JSON.stringify(data, null, 2));
        console.log(` -> Saved ${data.length} matches to ${fileName}`);
    } catch (e) {
        console.error(` -> Failed for ${dateStr}:`, e.message);
    }
}
console.log('All 21 days fetched successfully.');
