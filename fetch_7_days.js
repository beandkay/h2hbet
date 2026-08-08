const { execSync } = require('child_process');
const fs = require('fs');

const baseDate = new Date('2026-07-28T00:00:00+10:00');
let allMatches = [];

for (let i = 6; i >= 0; i--) {
    const d = new Date(baseDate);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    const urlDate = `${dateStr}T00:00:00%2B10:00`;
    
    console.log(`Fetching data for ${dateStr}...`);
    
    const curlCmd = `curl -s 'https://api-h2h.hudstats.com/v1/schedule/fifa?date=${urlDate}' \
  -H 'sec-ch-ua-platform: "macOS"' \
  -H 'Referer: https://h2hggl.com/' \
  -H 'User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36 Edg/149.0.0.0' \
  -H 'Accept: application/json, text/plain, */*' \
  -H 'sec-ch-ua: "Microsoft Edge";v="149", "Chromium";v="149", "Not)A;Brand";v="24"' \
  -H 'DNT: 1' \
  -H 'sec-ch-ua-mobile: ?0'`;

    try {
        const output = execSync(curlCmd, { encoding: 'utf8' });
        const data = JSON.parse(output);
        allMatches = allMatches.concat(data);
    } catch (e) {
        console.error(`Failed for ${dateStr}`, e.message);
    }
}

fs.writeFileSync('api_data_7days.json', JSON.stringify(allMatches));
console.log(`Saved ${allMatches.length} matches to api_data_7days.json`);
