// Tests excluding the first N hours of each rotation (4am-4pm / 4pm-4am AEST blocks)
// from betting - the window where the model is still "building history" (rotation-scoped
// Winner/OU Acc guards have little/no data yet, so the Poor-History SKIP filters can't act).
// Uses the ACTUAL production predictor files with the currently-shipped thresholds.
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
console.log(`Total rotation blocks: ${keys.length}`);
console.log(`Range: ${keys[0]} .. ${keys.at(-1)}`);

const MIN_PAST = 50;
const STAKE = 5, PAYOUT = 1.6;
function pct(n, d) { return d > 0 ? (n / d * 100) : 0; }

// AEST hour-of-day for a match, plus hours elapsed since this match's rotation started (4am or 4pm AEST).
function hoursIntoRotation(startDate) {
    const aestDate = new Date(new Date(startDate).getTime() + 10 * 60 * 60 * 1000);
    const hour = aestDate.getUTCHours();
    const minute = aestDate.getUTCMinutes();
    let sinceStart;
    if (hour >= 4 && hour < 16) sinceStart = (hour - 4) + minute / 60;
    else if (hour >= 16) sinceStart = (hour - 16) + minute / 60;
    else sinceStart = (hour + 8) + minute / 60; // 0-3am belongs to previous day's PM block, started at 4pm
    return sinceStart;
}

function runFull(matches, evalHours) {
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

    let h2hBets = 0, h2hWins = 0, h2hAttempted = 0, h2hTotalMatches = 0, h2hEligible = 0;
    let ouBets = 0, ouWins = 0, ouTotalMatches = 0, ouEligible = 0;
    const h2hHistoryState = {};
    const ouPlayerState = {};

    evalKeys.forEach(key => {
        const { playerStats, h2hStats, matches: rawMatches } = perRotation[key];

        // H2H pass - rotation-scoped history must still be built from ALL matches (order matters),
        // but we only COUNT bets/coverage for matches past the excluded early window.
        const h2hMatches = JSON.parse(JSON.stringify(rawMatches));
        const rotH2HHistory = {};
        Object.keys(h2hHistoryState).forEach(k => rotH2HHistory[k] = { dnbBets: h2hHistoryState[k].dnbBets, dnbCorrect: h2hHistoryState[k].dnbCorrect });
        generateH2HPredictions(h2hMatches, playerStats, h2hStats, { currentRotationH2HStats: { h2hHistory: rotH2HHistory } });
        h2hMatches.forEach(m => {
            const pairKey = [m.participantAName, m.participantBName].sort().join(' vs ');
            if (!h2hHistoryState[pairKey]) h2hHistoryState[pairKey] = { dnbBets: 0, dnbCorrect: 0 };
            const early = hoursIntoRotation(m.startDate) < evalHours;
            if (!early) { h2hTotalMatches++; }
            if (m.predictionType === 'SKIP') return;
            if (!early) h2hAttempted++;
            if (m.teamAScore === m.teamBScore) { h2hHistoryState[pairKey].dnbBets += 0; return; }
            h2hHistoryState[pairKey].dnbBets++;
            const won = (m.computedPrediction.includes(m.participantAName) && m.teamAScore > m.teamBScore) || (m.computedPrediction.includes(m.participantBName) && m.teamBScore > m.teamAScore);
            if (won) h2hHistoryState[pairKey].dnbCorrect++;
            if (!early) { h2hBets++; if (won) h2hWins++; }
        });

        const ouMatches = JSON.parse(JSON.stringify(rawMatches));
        const rotOUPlayer = {};
        Object.keys(ouPlayerState).forEach(k => rotOUPlayer[k] = { bets: ouPlayerState[k].bets, correct: ouPlayerState[k].correct });
        generateOUPredictions(ouMatches, playerStats, h2hStats, { currentRotationOUStats: { playerOU: rotOUPlayer, h2hHistory: {} } });
        ouMatches.forEach(m => {
            if (!ouPlayerState[m.participantAName]) ouPlayerState[m.participantAName] = { bets: 0, correct: 0 };
            if (!ouPlayerState[m.participantBName]) ouPlayerState[m.participantBName] = { bets: 0, correct: 0 };
            const early = hoursIntoRotation(m.startDate) < evalHours;
            if (!early) ouTotalMatches++;
            if (!m.isOUPick) return;
            const totalG = m.teamAScore + m.teamBScore;
            const won = (m.ou25Pick.includes('OVER') && totalG > 2.5) || (m.ou25Pick.includes('UNDER') && totalG < 2.5);
            ouPlayerState[m.participantAName].bets++; ouPlayerState[m.participantBName].bets++;
            if (won) { ouPlayerState[m.participantAName].correct++; ouPlayerState[m.participantBName].correct++; }
            if (!early) { ouBets++; if (won) ouWins++; }
        });
    });

    const h2hWR = pct(h2hWins, h2hBets);
    const h2hProfit = h2hBets * STAKE * (h2hWR / 100 * PAYOUT - 1);
    const ouWR = pct(ouWins, ouBets);
    const ouProfit = ouBets * STAKE * (ouWR / 100 * PAYOUT - 1);
    return {
        h2h: { bets: h2hBets, cov: pct(h2hAttempted, h2hTotalMatches), wr: h2hWR, profit: h2hProfit },
        ou: { bets: ouBets, cov: pct(ouBets, ouTotalMatches), wr: ouWR, profit: ouProfit },
    };
}

[0, 1, 2].forEach(hrs => {
    const r = runFull(allMatches, hrs);
    console.log(`\nExcluding first ${hrs} hour(s) of each rotation from betting/settlement:`);
    console.log(`  H2H: bets=${r.h2h.bets} cov=${r.h2h.cov.toFixed(1)}% WR=${r.h2h.wr.toFixed(1)}% Profit=$${r.h2h.profit.toFixed(0)}`);
    console.log(`  OU:  bets=${r.ou.bets} cov=${r.ou.cov.toFixed(1)}% WR=${r.ou.wr.toFixed(1)}% Profit=$${r.ou.profit.toFixed(0)}`);
});
