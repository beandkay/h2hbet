const fs = require('fs');
const { calculateStatistics } = require('../src/statistics');
const { calculateH2H } = require('../src/h2h_engine');
const { generateH2HPredictions } = require('../src/predictor_h2h');
const { generateOUPredictions } = require('../src/predictor_ou');
const { groupMatchesByRotation } = require('./tune');

const allMatches = JSON.parse(fs.readFileSync(__dirname + '/recent_21day_fresh.json', 'utf8'));
const blocks = groupMatchesByRotation(allMatches);
const keys = Object.keys(blocks).sort();
const MIN_PAST = 50;
const STAKE = 5, PAYOUT = 1.6;
function pct(n, d) { return d > 0 ? (n / d * 100) : 0; }
function hoursIntoRotation(startDate) {
    const aestDate = new Date(new Date(startDate).getTime() + 10 * 60 * 60 * 1000);
    const hour = aestDate.getUTCHours();
    const minute = aestDate.getUTCMinutes();
    if (hour >= 4 && hour < 16) return (hour - 4) + minute / 60;
    else if (hour >= 16) return (hour - 16) + minute / 60;
    else return (hour + 8) + minute / 60;
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

// Pass 1: run live thresholds once to classify stable days (H2H WR>60% AND OU WR>60% per day, min 3 bets each)
const h2hHist1 = {}, ouPl1 = {};
const rotH2H = {}, rotOU = {};
evalKeys.forEach(key => {
    const { playerStats, h2hStats, matches: rawMatches } = perRotation[key];
    rotH2H[key] = { bets: 0, wins: 0 }; rotOU[key] = { bets: 0, wins: 0 };
    const h2hMatches = JSON.parse(JSON.stringify(rawMatches));
    const rotH2HHistory = {};
    Object.keys(h2hHist1).forEach(k => rotH2HHistory[k] = { dnbBets: h2hHist1[k].dnbBets, dnbCorrect: h2hHist1[k].dnbCorrect });
    generateH2HPredictions(h2hMatches, playerStats, h2hStats, { currentRotationH2HStats: { h2hHistory: rotH2HHistory } });
    h2hMatches.forEach(m => {
        const pairKey = [m.participantAName, m.participantBName].sort().join(' vs ');
        if (!h2hHist1[pairKey]) h2hHist1[pairKey] = { dnbBets: 0, dnbCorrect: 0 };
        if (m.predictionType === 'SKIP' || m.teamAScore === m.teamBScore) return;
        h2hHist1[pairKey].dnbBets++;
        const won = (m.computedPrediction.includes(m.participantAName) && m.teamAScore > m.teamBScore) || (m.computedPrediction.includes(m.participantBName) && m.teamBScore > m.teamAScore);
        if (won) h2hHist1[pairKey].dnbCorrect++;
        rotH2H[key].bets++; if (won) rotH2H[key].wins++;
    });
    const ouMatches = JSON.parse(JSON.stringify(rawMatches));
    const rotOUPlayer = {};
    Object.keys(ouPl1).forEach(k => rotOUPlayer[k] = { bets: ouPl1[k].bets, correct: ouPl1[k].correct });
    generateOUPredictions(ouMatches, playerStats, h2hStats, { currentRotationOUStats: { playerOU: rotOUPlayer, h2hHistory: {} } });
    ouMatches.forEach(m => {
        if (!ouPl1[m.participantAName]) ouPl1[m.participantAName] = { bets: 0, correct: 0 };
        if (!ouPl1[m.participantBName]) ouPl1[m.participantBName] = { bets: 0, correct: 0 };
        if (!m.isOUPick) return;
        const totalG = m.teamAScore + m.teamBScore;
        const won = (m.ou25Pick.includes('OVER') && totalG > 2.5) || (m.ou25Pick.includes('UNDER') && totalG < 2.5);
        ouPl1[m.participantAName].bets++; ouPl1[m.participantBName].bets++;
        if (won) { ouPl1[m.participantAName].correct++; ouPl1[m.participantBName].correct++; }
        rotOU[key].bets++; if (won) rotOU[key].wins++;
    });
});
const dayOf = key => key.replace(/_AM$|_PM$/, '');
const days = {};
evalKeys.forEach(key => {
    const d = dayOf(key);
    if (!days[d]) days[d] = { h2hBets: 0, h2hWins: 0, ouBets: 0, ouWins: 0, rotKeys: [] };
    days[d].h2hBets += rotH2H[key].bets; days[d].h2hWins += rotH2H[key].wins;
    days[d].ouBets += rotOU[key].bets; days[d].ouWins += rotOU[key].wins;
    days[d].rotKeys.push(key);
});
const stableKeys = new Set();
Object.values(days).forEach(day => {
    const h2hWR = pct(day.h2hWins, day.h2hBets), ouWR = pct(day.ouWins, day.ouBets);
    const enough = day.h2hBets >= 3 && day.ouBets >= 3;
    if (enough && h2hWR > 60 && ouWR > 60) day.rotKeys.forEach(k => stableKeys.add(k));
});
console.log(`Stable rotation blocks: ${stableKeys.size} / ${evalKeys.length}\n`);

// Pass 2: hourly breakdown restricted to stable rotations only
const h2hHist2 = {}, ouPl2 = {};
const h2hBuckets = {}, ouBuckets = {};
for (let h = 0; h < 12; h++) { h2hBuckets[h] = { bets: 0, wins: 0 }; ouBuckets[h] = { bets: 0, wins: 0 }; }
evalKeys.forEach(key => {
    const { playerStats, h2hStats, matches: rawMatches } = perRotation[key];
    const isStable = stableKeys.has(key);

    const h2hMatches = JSON.parse(JSON.stringify(rawMatches));
    const rotH2HHistory = {};
    Object.keys(h2hHist2).forEach(k => rotH2HHistory[k] = { dnbBets: h2hHist2[k].dnbBets, dnbCorrect: h2hHist2[k].dnbCorrect });
    generateH2HPredictions(h2hMatches, playerStats, h2hStats, { currentRotationH2HStats: { h2hHistory: rotH2HHistory } });
    h2hMatches.forEach(m => {
        const pairKey = [m.participantAName, m.participantBName].sort().join(' vs ');
        if (!h2hHist2[pairKey]) h2hHist2[pairKey] = { dnbBets: 0, dnbCorrect: 0 };
        const hr = Math.min(11, Math.floor(hoursIntoRotation(m.startDate)));
        if (m.predictionType === 'SKIP' || m.teamAScore === m.teamBScore) return;
        h2hHist2[pairKey].dnbBets++;
        const won = (m.computedPrediction.includes(m.participantAName) && m.teamAScore > m.teamBScore) || (m.computedPrediction.includes(m.participantBName) && m.teamBScore > m.teamAScore);
        if (won) h2hHist2[pairKey].dnbCorrect++;
        if (isStable) { h2hBuckets[hr].bets++; if (won) h2hBuckets[hr].wins++; }
    });

    const ouMatches = JSON.parse(JSON.stringify(rawMatches));
    const rotOUPlayer = {};
    Object.keys(ouPl2).forEach(k => rotOUPlayer[k] = { bets: ouPl2[k].bets, correct: ouPl2[k].correct });
    generateOUPredictions(ouMatches, playerStats, h2hStats, { currentRotationOUStats: { playerOU: rotOUPlayer, h2hHistory: {} } });
    ouMatches.forEach(m => {
        if (!ouPl2[m.participantAName]) ouPl2[m.participantAName] = { bets: 0, correct: 0 };
        if (!ouPl2[m.participantBName]) ouPl2[m.participantBName] = { bets: 0, correct: 0 };
        const hr = Math.min(11, Math.floor(hoursIntoRotation(m.startDate)));
        if (!m.isOUPick) return;
        const totalG = m.teamAScore + m.teamBScore;
        const won = (m.ou25Pick.includes('OVER') && totalG > 2.5) || (m.ou25Pick.includes('UNDER') && totalG < 2.5);
        ouPl2[m.participantAName].bets++; ouPl2[m.participantBName].bets++;
        if (won) { ouPl2[m.participantAName].correct++; ouPl2[m.participantBName].correct++; }
        if (isStable) { ouBuckets[hr].bets++; if (won) ouBuckets[hr].wins++; }
    });
});

console.log('=== H2H by hour-into-rotation (STABLE days only) ===');
for (let h = 0; h < 12; h++) {
    const b = h2hBuckets[h]; const wr = pct(b.wins, b.bets); const profit = b.bets * STAKE * (wr / 100 * PAYOUT - 1);
    console.log(`hour ${h}-${h+1}: bets=${String(b.bets).padStart(3)} WR=${wr.toFixed(1).padStart(5)}% Profit=$${profit.toFixed(0).padStart(4)}`);
}
console.log('\n=== OU by hour-into-rotation (STABLE days only) ===');
for (let h = 0; h < 12; h++) {
    const b = ouBuckets[h]; const wr = pct(b.wins, b.bets); const profit = b.bets * STAKE * (wr / 100 * PAYOUT - 1);
    console.log(`hour ${h}-${h+1}: bets=${String(b.bets).padStart(3)} WR=${wr.toFixed(1).padStart(5)}% Profit=$${profit.toFixed(0).padStart(4)}`);
}
