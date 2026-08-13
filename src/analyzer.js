const { calculateStatistics } = require('./statistics');
const { calculateH2H } = require('./h2h_engine');
const { generatePredictions } = require('./predictor');
const { runAutoTuner } = require('./auto_tuner');

function runAnalysis(allMatches, historicalOUStats = {}) {
    // 1. Group into ended and upcoming
    const endedMatches = [];
    const upcomingMatches = [];
    
    // Sort matches chronologically
    allMatches.sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
    
    // Calculate rotation bounds
    const now = new Date();
    const aest = new Date(now.getTime() + 10 * 60 * 60 * 1000);
    const hour = aest.getUTCHours();
    const startAEST = new Date(aest);
    const endAEST = new Date(aest);
    startAEST.setUTCMinutes(0, 0, 0);
    endAEST.setUTCMinutes(0, 0, 0);
    if (hour >= 4 && hour < 16) {
        startAEST.setUTCHours(4);
        endAEST.setUTCHours(16);
    } else if (hour >= 16) {
        startAEST.setUTCHours(16);
        endAEST.setUTCHours(4);
        endAEST.setUTCDate(endAEST.getUTCDate() + 1);
    } else {
        startAEST.setUTCHours(16);
        startAEST.setUTCDate(startAEST.getUTCDate() - 1);
        endAEST.setUTCHours(4);
    }

    const nowTime = new Date();

    allMatches.forEach(m => {
        const d = new Date(m.startDate);
        const matchAEST = new Date(d.getTime() + 10 * 60 * 60 * 1000);
        if (matchAEST >= startAEST && matchAEST < endAEST) {
            if (m.matchStatus === 'MATCH_ENDED' && !m.isCancelled) {
                endedMatches.push(m);
            } else if (!m.isCancelled && m.matchStatus !== 'PERMANENT_BET_SUSPEND' && d > nowTime) {
                upcomingMatches.push(m);
            }
        }
    });

    const allEnded = allMatches.filter(m => m.matchStatus === 'MATCH_ENDED' && !m.isCancelled);

    const totalGoals = allEnded.reduce((sum, m) => sum + m.teamAScore + m.teamBScore, 0);
    const leagueAvgGoalsPerTeam = allEnded.length > 0 ? (totalGoals / (allEnded.length * 2)) : 1.5;

    // 2. Build stats using ALL fetched history to ensure players have 3+ matches
    const { playerStats, sortedPlayers, standings } = calculateStatistics(allEnded, leagueAvgGoalsPerTeam);

    // 3. Build H2H
    const { h2hStats, h2hArr } = calculateH2H(allEnded);
    const h2hData = h2hArr.filter(h => h.winRate >= 60);
    const otherH2hData = h2hArr.filter(h => h.winRate < 60);

    // 4. Auto-Tune DNB Thresholds (Phase 1 and Phase 3)
    const tunedOpts = runAutoTuner(endedMatches, playerStats, h2hStats);
    console.log(`[Auto-Tuner] Optimal Thresholds -> P1: ${tunedOpts.optimalP1}% (Diff ${tunedOpts.optimalP1Diff}%) | P3: ${tunedOpts.optimalP3}% | Over: ${tunedOpts.optimalOv} | Under: ${tunedOpts.optimalUn}`);

    // 5. Generate Predictions
    generatePredictions(upcomingMatches, playerStats, h2hStats, { 
        historicalOUStats, 
        ...tunedOpts
    });

    // Identify active players
    const activePlayers = new Set();
    upcomingMatches.forEach(m => {
        activePlayers.add(m.participantAName);
        activePlayers.add(m.participantBName);
    });

    // Extract parlay/strong picks
    const winnerParlay = upcomingMatches.filter(m => 
        m.computedPrediction && !m.computedPrediction.includes('SKIP') && m.h2hPreferred
    );

    return {
        generatedAt: new Date().toISOString(),
        leagueAvgGoalsPerTeam,
        playerStats,
        standings: standings.filter(p => activePlayers.has(p.p)),
        upcoming: upcomingMatches,
        h2hData,
        otherH2hData,
        winnerParlay,
        optimalP1: tunedOpts.optimalP1,
        optimalP1Diff: tunedOpts.optimalP1Diff,
        optimalP3: tunedOpts.optimalP3,
        optimalOv: tunedOpts.optimalOv,
        optimalUn: tunedOpts.optimalUn
    };
}

module.exports = { runAnalysis };
