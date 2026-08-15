const fs = require('fs');
const { calculateStatistics } = require('../src/statistics');
const { calculateH2H } = require('../src/h2h_engine');
const { generateH2HPredictions } = require('../src/predictor_h2h');
const { generateOUPredictions } = require('../src/predictor_ou');
const { groupMatchesByRotation } = require('./tune');

const DATA_FILE = process.argv[2] || 'recent_21day_fresh.json';
const allMatches = JSON.parse(fs.readFileSync(__dirname + '/' + DATA_FILE, 'utf8'));
const blocks = groupMatchesByRotation(allMatches);
const keys = Object.keys(blocks).sort();
const MIN_PAST = 50;
const STAKE = 5, PAYOUT = 1.6;
function pct(n, d) { return d > 0 ? (n / d * 100) : 0; }

function hoursIntoRotation(startDate) {
    const aestDate = new Date(new Date(startDate).getTime() + 10 * 60 * 60 * 1000);
    const hour = aestDate.getUTCHours();
    const minute = aestDate.getUTCMinutes();
    let sinceStart;
    if (hour >= 4 && hour < 16) sinceStart = (hour - 4) + minute / 60;
    else if (hour >= 16) sinceStart = (hour - 16) + minute / 60;
    else sinceStart = (hour + 8) + minute / 60;
    return sinceStart;
}

const perRotation = {};
keys.forEach((key, idx) => {
    const past = [];
    keys.slice(0, idx).forEach(k => past.push(...blocks[k]));
    if (past.length < MIN_PAST) return;
    const totalGoals = past.reduce((s, m) => s + m.teamAScore + m.teamBScore, 0);
    const leagueAvg = totalGoals / (past.length * 2);
    const { playerStats } = calculateStatistics(JSON.parse(JSON.stringify(past)), leagueAvg);
    const { h2hStats } = calculateH2H(JSON.parse(JSON.stringify(past)));
    perRotation[key] = { playerStats, h2hStats, matches: blocks[key] };
});
const evalKeys = Object.keys(perRotation).sort();

const h2hHistoryState = {};
const ouPlayerState = {};
const h2hBuckets = {}, ouBuckets = {};
for (let h = 0; h < 12; h++) { h2hBuckets[h] = { bets: 0, wins: 0 }; ouBuckets[h] = { bets: 0, wins: 0 }; }

evalKeys.forEach(key => {
    const { playerStats, h2hStats, matches: rawMatches } = perRotation[key];

    const h2hMatches = JSON.parse(JSON.stringify(rawMatches));
    const rotH2HHistory = {};
    Object.keys(h2hHistoryState).forEach(k => rotH2HHistory[k] = { dnbBets: h2hHistoryState[k].dnbBets, dnbCorrect: h2hHistoryState[k].dnbCorrect });
    generateH2HPredictions(h2hMatches, playerStats, h2hStats, { currentRotationH2HStats: { h2hHistory: rotH2HHistory } });
    h2hMatches.forEach(m => {
        const pairKey = [m.participantAName, m.participantBName].sort().join(' vs ');
        if (!h2hHistoryState[pairKey]) h2hHistoryState[pairKey] = { dnbBets: 0, dnbCorrect: 0 };
        const hr = Math.min(11, Math.floor(hoursIntoRotation(m.startDate)));
        if (m.predictionType === 'SKIP') return;
        if (m.teamAScore === m.teamBScore) return;
        h2hHistoryState[pairKey].dnbBets++;
        const won = (m.computedPrediction.includes(m.participantAName) && m.teamAScore > m.teamBScore) || (m.computedPrediction.includes(m.participantBName) && m.teamBScore > m.teamAScore);
        if (won) h2hHistoryState[pairKey].dnbCorrect++;
        h2hBuckets[hr].bets++; if (won) h2hBuckets[hr].wins++;
    });

    const ouMatches = JSON.parse(JSON.stringify(rawMatches));
    const rotOUPlayer = {};
    Object.keys(ouPlayerState).forEach(k => rotOUPlayer[k] = { bets: ouPlayerState[k].bets, correct: ouPlayerState[k].correct });
    generateOUPredictions(ouMatches, playerStats, h2hStats, { currentRotationOUStats: { playerOU: rotOUPlayer, h2hHistory: {} } });
    ouMatches.forEach(m => {
        if (!ouPlayerState[m.participantAName]) ouPlayerState[m.participantAName] = { bets: 0, correct: 0 };
        if (!ouPlayerState[m.participantBName]) ouPlayerState[m.participantBName] = { bets: 0, correct: 0 };
        const hr = Math.min(11, Math.floor(hoursIntoRotation(m.startDate)));
        if (!m.isOUPick) return;
        const totalG = m.teamAScore + m.teamBScore;
        const won = (m.ou25Pick.includes('OVER') && totalG > 2.5) || (m.ou25Pick.includes('UNDER') && totalG < 2.5);
        ouPlayerState[m.participantAName].bets++; ouPlayerState[m.participantBName].bets++;
        if (won) { ouPlayerState[m.participantAName].correct++; ouPlayerState[m.participantBName].correct++; }
        ouBuckets[hr].bets++; if (won) ouBuckets[hr].wins++;
    });
});

console.log('=== H2H by hour-into-rotation ===');
for (let h = 0; h < 12; h++) {
    const b = h2hBuckets[h];
    const wr = pct(b.wins, b.bets);
    const profit = b.bets * STAKE * (wr / 100 * PAYOUT - 1);
    console.log(`hour ${h}-${h+1}: bets=${String(b.bets).padStart(3)} WR=${wr.toFixed(1).padStart(5)}% Profit=$${profit.toFixed(0).padStart(4)}`);
}
console.log('\n=== OU by hour-into-rotation ===');
for (let h = 0; h < 12; h++) {
    const b = ouBuckets[h];
    const wr = pct(b.wins, b.bets);
    const profit = b.bets * STAKE * (wr / 100 * PAYOUT - 1);
    console.log(`hour ${h}-${h+1}: bets=${String(b.bets).padStart(3)} WR=${wr.toFixed(1).padStart(5)}% Profit=$${profit.toFixed(0).padStart(4)}`);
}
