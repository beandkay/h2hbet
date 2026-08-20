const { calculateStatistics } = require('./statistics');
const { calculateH2H } = require('./h2h_engine');
const { computeExtraPredictions } = require('./extra_predictors');

function runAnalysis(allMatches) {
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
            if (m.matchStatus === 'MATCH_ENDED' && !m.isCancelled && typeof m.teamAScore === 'number' && typeof m.teamBScore === 'number') {
                endedMatches.push(m);
            } else if (!m.isCancelled && m.matchStatus !== 'PERMANENT_BET_SUSPEND' && d > nowTime) {
                upcomingMatches.push(m);
            }
        }
    });

    // All stats below are scoped to the current rotation only (endedMatches) —
    // no multi-day history is used.
    const totalGoals = endedMatches.reduce((sum, m) => sum + m.teamAScore + m.teamBScore, 0);
    const leagueAvgGoalsPerTeam = endedMatches.length > 0 ? (totalGoals / (endedMatches.length * 2)) : 1.5;

    // 2. Build stats from the current rotation's completed matches
    const { playerStats, standings } = calculateStatistics(endedMatches, leagueAvgGoalsPerTeam);

    // 3. Build H2H from the current rotation's completed matches
    const { h2hStats, h2hArr } = calculateH2H(endedMatches);

    const activePairs = new Set();
    upcomingMatches.forEach(m => {
        activePairs.add(`${m.participantAName} vs ${m.participantBName}`);
        activePairs.add(`${m.participantBName} vs ${m.participantAName}`);
    });

    const activeH2hArr = h2hArr.filter(h => activePairs.has(h.matchup));
    const h2hData = activeH2hArr.filter(h => h.winRate >= 60);
    const otherH2hData = activeH2hArr.filter(h => h.winRate < 60);

    // 4. Pure-stat fields (style, recent form, all-time H2H leader, raw H2H/OU
    // history) — these are not model output, just facts read off playerStats/h2hStats.
    upcomingMatches.forEach(m => {
        const home = m.participantAName;
        const away = m.participantBName;
        const sHome = playerStats[home];
        const sAway = playerStats[away];

        m.homeStyle = sHome ? sHome.style : 'Unknown';
        m.awayStyle = sAway ? sAway.style : 'Unknown';
        m.homeRecent = sHome ? sHome.streak : [];
        m.awayRecent = sAway ? sAway.streak : [];

        const pairKey = [home, away].sort().join(' vs ');
        const h2h = h2hStats[pairKey] || { matches: 0 };

        let h2hWinrate = 0;
        let h2hFavored = "N/A";
        if (h2h.matches > 0) {
            const hWins = h2h[home] || 0;
            const aWins = h2h[away] || 0;
            if (hWins > aWins) {
                h2hFavored = home;
                h2hWinrate = (hWins / h2h.matches) * 100;
            } else if (aWins > hWins) {
                h2hFavored = away;
                h2hWinrate = (aWins / h2h.matches) * 100;
            } else {
                h2hFavored = "DRAW";
            }
        }
        m.h2hFavored = h2hFavored;
        m.h2hWinrate = h2hWinrate;
        m.h2hAvgGoals = h2h.matches > 0 ? (h2h.totalGoals / h2h.matches) : 0;

        m.h2hHistory = (h2h.history || []).slice(-5).map(matchWinner => ({ matchWinner }));
        m.h2hHistoryOU = (h2h.historyOU || []).slice(-5).map(matchOU => ({ matchOU }));
    });

    // 5. Poisson + Elo prediction signals (production model, both markets)
    const extraModelPerformance = computeExtraPredictions(upcomingMatches);

    // Parlays — best-validated model per market, ranked by probability.
    const winnerParlay = upcomingMatches.filter(m => m.h2hPoissonPick)
        .sort((a, b) => b.h2hPoissonProb - a.h2hPoissonProb).slice(0, 3);

    const totalsParlay = upcomingMatches.filter(m => m.ouEloPick)
        .sort((a, b) => b.ouEloProb - a.ouEloProb).slice(0, 4);

    // Rank sequentially (1..N) over the current rotation's standings, and keep
    // playerStats.rank in sync so rank badges shown elsewhere match the leaderboard.
    standings.forEach((p, idx) => {
        p.rank = idx + 1;
        if (playerStats[p.p]) playerStats[p.p].rank = idx + 1;
    });

    return {
        generatedAt: new Date().toISOString(),
        leagueAvgGoalsPerTeam,
        playerStats,
        standings,
        upcoming: upcomingMatches,
        h2hData,
        otherH2hData,
        totalsParlay,
        winnerParlay,
        extraModelPerformance
    };
}

module.exports = { runAnalysis };
