const fs = require('fs');

const matches7d = JSON.parse(fs.readFileSync('api_data_7days.json', 'utf8'));
const matchesToday = JSON.parse(fs.readFileSync('api_data_latest.json', 'utf8'));

// Build Team Stats from 7 days of historical data to get a large sample size per club
const teamStats = {};
matches7d.forEach(m => {
    if (m.matchStatus !== 'MATCH_ENDED' || m.isCancelled) return;
    
    const teamA = m.teamAName;
    const teamB = m.teamBName;
    const scoreA = m.teamAScore;
    const scoreB = m.teamBScore;
    
    if (!teamStats[teamA]) teamStats[teamA] = { matches: 0, goalsScored: 0, goalsConceded: 0, wins: 0 };
    if (!teamStats[teamB]) teamStats[teamB] = { matches: 0, goalsScored: 0, goalsConceded: 0, wins: 0 };
    
    teamStats[teamA].matches++;
    teamStats[teamB].matches++;
    teamStats[teamA].goalsScored += scoreA;
    teamStats[teamA].goalsConceded += scoreB;
    teamStats[teamB].goalsScored += scoreB;
    teamStats[teamB].goalsConceded += scoreA;
    
    if (scoreA > scoreB) teamStats[teamA].wins++;
    else if (scoreB > scoreA) teamStats[teamB].wins++;
});

// Calculate global league average goals for teams
let totalLeagueMatches = 0;
let totalLeagueGoals = 0;
for (let t in teamStats) {
    totalLeagueMatches += teamStats[t].matches;
    totalLeagueGoals += teamStats[t].goalsScored;
}
const avgTeamGoals = totalLeagueMatches > 0 ? (totalLeagueGoals / totalLeagueMatches) : 1.5;

const getTeamMod = (teamName) => {
    if (!teamStats[teamName] || teamStats[teamName].matches < 10) return 0;
    const avgScored = teamStats[teamName].goalsScored / teamStats[teamName].matches;
    // Difference between this team's average and the league average
    // We scale it down slightly so the player's skill remains the primary factor
    return (avgScored - avgTeamGoals) * 0.5; 
};

// Now evaluate today's matches
const endedToday = matchesToday
    .filter(m => m.matchStatus === 'MATCH_ENDED' && !m.isCancelled)
    .sort((a, b) => new Date(a.startDate) - new Date(b.startDate));

const playerStats = {};
function initPlayer(name) {
    if (!playerStats[name]) {
        playerStats[name] = { matches: 0, goalsScored: 0, goalsConceded: 0, streak: [] };
    }
}

let evaluatedMatches = 0;
let correctPredictions = 0;

endedToday.forEach(m => {
    const home = m.participantAName;
    const away = m.participantBName;
    const homeTeam = m.teamAName;
    const awayTeam = m.teamBName;
    const homeScore = m.teamAScore;
    const awayScore = m.teamBScore;
    
    initPlayer(home);
    initPlayer(away);
    
    const sHome = playerStats[home];
    const sAway = playerStats[away];
    
    if (sHome.matches >= 3 && sAway.matches >= 3) {
        const homeAvgScored = sHome.goalsScored / sHome.matches;
        const homeAvgConceded = sHome.goalsConceded / sHome.matches;
        const awayAvgScored = sAway.goalsScored / sAway.matches;
        const awayAvgConceded = sAway.goalsConceded / sAway.matches;
        
        let homeXG = (homeAvgScored + awayAvgConceded) / 2;
        let awayXG = (awayAvgScored + homeAvgConceded) / 2;
        
        // Form Momentum
        const calcPoints = (form) => form.reduce((acc, val) => acc + (val === 'W' ? 3 : val === 'D' ? 1 : 0), 0);
        homeXG += calcPoints(sHome.streak.slice(-5)) * 0.05;
        awayXG += calcPoints(sAway.streak.slice(-5)) * 0.05;
        
        // --- TEAM MODIFIER ---
        homeXG += getTeamMod(homeTeam);
        awayXG += getTeamMod(awayTeam);
        
        const diff = homeXG - awayXG;
        let prediction = "";
        
        if (diff > 0.20) prediction = "HOME";
        else if (diff < -0.20) prediction = "AWAY";
        else prediction = "DRAW";
        
        let actual = "";
        if (homeScore > awayScore) actual = "HOME";
        else if (homeScore < awayScore) actual = "AWAY";
        else actual = "DRAW";
        
        // Draw No Bet logic
        if (actual !== "DRAW" && prediction !== "DRAW") {
            evaluatedMatches++;
            if (prediction === actual) correctPredictions++;
        }
    }
    
    // Update player stats for the day
    sHome.matches++;
    sAway.matches++;
    sHome.goalsScored += homeScore;
    sHome.goalsConceded += awayScore;
    sAway.goalsScored += awayScore;
    sAway.goalsConceded += homeScore;
    sHome.streak.push(homeScore > awayScore ? 'W' : homeScore < awayScore ? 'L' : 'D');
    sAway.streak.push(awayScore > homeScore ? 'W' : awayScore < homeScore ? 'L' : 'D');
});

const accuracy = evaluatedMatches > 0 ? ((correctPredictions / evaluatedMatches) * 100).toFixed(2) : 0;
console.log(`--- TEAM-WEIGHTED BACKTEST (TODAY'S RESULTS) ---`);
console.log(`Decisive Matches Evaluated: ${evaluatedMatches}`);
console.log(`Correct Predictions: ${correctPredictions}`);
console.log(`Accuracy: ${accuracy}%`);
