const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const HISTORICAL_FILE = path.join(__dirname, '..', 'historical_fifa.json');
const DEFAULT_WINDOW_DAYS = 45;

function aestDateString(offsetDays) {
    const d = new Date(new Date().getTime() + 10 * 60 * 60 * 1000);
    d.setUTCDate(d.getUTCDate() + offsetDays);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function fetchDayFromAPI(dateStr) {
    const url = `https://api-h2h.hudstats.com/v1/schedule/fifa?date=${dateStr}T00:00:00Z`;
    try {
        const cmd = `curl -s '${url}' -H 'sec-ch-ua-platform: "macOS"' -H 'Referer: https://h2hggl.com/' -H 'User-Agent: Mozilla/5.0'`;
        const out = execSync(cmd, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
        const parsed = JSON.parse(out);
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        return [];
    }
}

// One-shot: pull the last `days` days from the API and merge them into the store.
// Used to seed / recover from an outage that produced gaps in the rolling window.
async function backfillHistoricalStore(days = DEFAULT_WINDOW_DAYS) {
    const allFresh = [];
    for (let i = -days; i <= 0; i++) {
        const dateStr = aestDateString(i);
        const dayMatches = fetchDayFromAPI(dateStr);
        allFresh.push(...dayMatches);
    }
    return updateHistoricalStore(allFresh, days);
}

function loadExisting() {
    try {
        const raw = fs.readFileSync(HISTORICAL_FILE, 'utf8');
        const data = JSON.parse(raw);
        return Array.isArray(data) ? data : (data.matches || []);
    } catch (e) {
        return [];
    }
}

// Merge freshly-fetched matches into the on-disk historical store, dedupe by
// externalId, drop anything older than `windowDays`, and write back. Called
// from the pipeline after fetchData() so downstream backtesters read a rolling
// window instead of a frozen snapshot.
function updateHistoricalStore(freshMatches, windowDays = DEFAULT_WINDOW_DAYS) {
    const existing = loadExisting();
    const before = existing.length;
    const seen = new Map(); // externalId -> match

    const isKeepable = (m) => m && m.matchStatus === 'MATCH_ENDED' && !m.isCancelled && m.externalId;

    existing.forEach(m => { if (isKeepable(m)) seen.set(m.externalId, m); });

    let added = 0;
    (freshMatches || []).forEach(m => {
        if (!isKeepable(m)) return;
        if (!seen.has(m.externalId)) added++;
        seen.set(m.externalId, m); // fresh copy overrides in case scores finalised
    });

    const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
    const merged = Array.from(seen.values())
        .filter(m => new Date(m.startDate) >= cutoff)
        .sort((a, b) => new Date(a.startDate) - new Date(b.startDate));

    // Write compact JSON — file is ~3 MB, indented would balloon the git diff
    // on every 5-min commit.
    try {
        fs.writeFileSync(HISTORICAL_FILE, JSON.stringify(merged));
    } catch (e) {
        console.error('⚠️  Failed to write historical_fifa.json:', e.message);
    }

    return {
        total: merged.length,
        added,
        pruned: Math.max(0, before + added - merged.length),
        oldest: merged.length ? merged[0].startDate : null,
        newest: merged.length ? merged[merged.length - 1].startDate : null,
        windowDays
    };
}

module.exports = { updateHistoricalStore, backfillHistoricalStore };

// Allow one-off CLI backfill: `node src/historical_store.js [days]`
if (require.main === module) {
    const days = parseInt(process.argv[2], 10) || DEFAULT_WINDOW_DAYS;
    console.log(`Backfilling historical store for the last ${days} days...`);
    backfillHistoricalStore(days).then(info => {
        console.log(`✅ Backfill complete: ${info.total} matches, ${info.oldest?.slice(0,10)} → ${info.newest?.slice(0,10)}`);
    }).catch(e => {
        console.error('❌ Backfill failed:', e.message);
        process.exit(1);
    });
}
