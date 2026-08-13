function calculateStatistics(endedMatches) {
    const playerStats = {};

    function initPlayer(name) {
        if (!playerStats[name]) {
            playerStats[name] = { matches: 0, wins: 0, draws: 0, losses: 0, goalsScored: 0, goalsConceded: 0, streak: [], goalsList: [], concededList: [] };
        }
    }

    // Sort matches chronologically
    endedMatches.sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
    
    endedMatches.forEach(m => {
        const home = m.participantAName;
        const away = m.participantBName;
        const homeScore = m.teamAScore;
        const awayScore = m.teamBScore;
        
        initPlayer(home);
        initPlayer(away);
        
        playerStats[home].matches++;
        playerStats[away].matches++;
        playerStats[home].goalsScored += homeScore;
        playerStats[home].goalsConceded += awayScore;
        playerStats[away].goalsScored += awayScore;
        playerStats[away].goalsConceded += homeScore;
        playerStats[home].goalsList.push(homeScore);
        playerStats[home].concededList.push(awayScore);
        playerStats[away].goalsList.push(awayScore);
        playerStats[away].concededList.push(homeScore);
        
        if (homeScore > awayScore) {
            playerStats[home].wins++;
            playerStats[away].losses++;
            playerStats[home].streak.push('W');
            playerStats[away].streak.push('L');
        } else if (homeScore < awayScore) {
            playerStats[away].wins++;
            playerStats[home].losses++;
            playerStats[away].streak.push('W');
            playerStats[home].streak.push('L');
        } else {
            playerStats[home].draws++;
            playerStats[away].draws++;
            playerStats[home].streak.push('D');
            playerStats[away].streak.push('D');
        }
    });

    const sortedPlayers = [];
    for (let p in playerStats) {
        const s = playerStats[p];
        const winRate = s.matches > 0 ? ((s.wins / s.matches) * 100).toFixed(1) : "0.0";
        const avgScored = s.matches > 0 ? (s.goalsScored / s.matches).toFixed(2) : "0.00";
        const avgConceded = s.matches > 0 ? (s.goalsConceded / s.matches).toFixed(2) : "0.00";
        const totalAvg = parseFloat(avgScored) + parseFloat(avgConceded);
        const style = s.matches > 0 ? (totalAvg > 3.0 ? 'Aggressive' : 'Defensive') : 'Unknown';
        const recentForm = s.matches > 0 ? s.streak.join('-') : 'None';
        
        // Points System: Win=3, Draw=1, Lose=0
        const points = (s.wins * 3) + (s.draws * 1);
        const gd = s.goalsScored - s.goalsConceded;
        
        s.winRate = winRate;
        s.avgScored = avgScored;
        s.avgConceded = avgConceded;
        s.style = style;
        s.recentForm = recentForm;
        s.points = points;
        s.gd = gd;
        
        sortedPlayers.push({ p, ...s });
    }
    
    // Sort by win rate for general list
    sortedPlayers.sort((a, b) => parseFloat(b.winRate) - parseFloat(a.winRate));

    // Create a copy for Standings sorted by Points, then GD, then Matches
    const standings = [...sortedPlayers].sort((a, b) => b.points - a.points || b.gd - a.gd || b.matches - a.matches);

    return {
        playerStats,
        sortedPlayers,
        standings
    };
}

module.exports = {
    calculateStatistics
};
