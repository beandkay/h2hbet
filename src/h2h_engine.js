function calculateH2H(endedMatches) {
    const h2hStats = {};

    endedMatches.forEach(m => {
        const home = m.participantAName;
        const away = m.participantBName;
        const homeScore = m.teamAScore;
        const awayScore = m.teamBScore;
        
        const players = [home, away].sort();
        const pairKey = `${players[0]} vs ${players[1]}`;
        
        if (!h2hStats[pairKey]) {
            h2hStats[pairKey] = { matches: 0, [players[0]]: 0, [players[1]]: 0, draws: 0, totalGoals: 0, history: [], historyOU: [] };
        }
        
        h2hStats[pairKey].matches++;
        h2hStats[pairKey].totalGoals += (homeScore + awayScore);
        
        let winner = "DRAW";
        if (homeScore > awayScore) {
            h2hStats[pairKey][home]++;
            winner = home;
        } else if (homeScore < awayScore) {
            h2hStats[pairKey][away]++;
            winner = away;
        } else {
            h2hStats[pairKey].draws++;
        }
        h2hStats[pairKey].history.push(winner);
        h2hStats[pairKey].historyOU.push((homeScore + awayScore) >= 3 ? "OVER" : "UNDER");
    });

    const h2hArr = [];
    for (let key in h2hStats) {
        const stat = h2hStats[key];
        if (stat.matches >= 3) {
            const players = key.split(' vs ');
            const p1Wins = stat[players[0]];
            const p2Wins = stat[players[1]];
            
            let dominantPlayer = "None";
            let maxWins = 0;
            let winRate = 0;
            
            if (p1Wins > p2Wins) {
                dominantPlayer = players[0];
                maxWins = p1Wins;
            } else if (p2Wins > p1Wins) {
                dominantPlayer = players[1];
                maxWins = p2Wins;
            }
            
            if (dominantPlayer !== "None") {
                winRate = (maxWins / stat.matches) * 100;
                h2hArr.push({
                    matchup: key,
                    matches: stat.matches,
                    dominantPlayer,
                    winRate,
                    breakdown: `${players[0]}: ${p1Wins}W | ${players[1]}: ${p2Wins}W | Draws: ${stat.draws}`,
                    avgGoals: stat.totalGoals / stat.matches,
                    recentForm: stat.history.slice(-5)
                });
            }
        }
    }
    
    h2hArr.sort((a, b) => b.winRate - a.winRate || b.matches - a.matches);

    return {
        h2hStats,
        h2hArr
    };
}

module.exports = {
    calculateH2H
};
