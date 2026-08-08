const fs = require('fs');

const matches = JSON.parse(fs.readFileSync('api_data_7days.json', 'utf8'));
const endedMatches = matches
    .filter(m => m.matchStatus === 'MATCH_ENDED' && !m.isCancelled)
    .sort((a, b) => new Date(a.startDate) - new Date(b.startDate));

const playerStats = {};

let totalLeagueMatches = 0;
let totalLeagueGoals = 0;

function initPlayer(name) {
    if (!playerStats[name]) {
        playerStats[name] = {
            matches: 0, wins: 0, draws: 0, losses: 0, goalsScored: 0, goalsConceded: 0, streak: []
        };
    }
}

// First pass to get global league averages (for the first few days, this is lookahead, but it's just to establish the baseline style definition)
endedMatches.forEach(m => {
    totalLeagueMatches++;
    totalLeagueGoals += (m.teamAScore + m.teamBScore);
});
const leagueAvgGoalsPerTeam = (totalLeagueGoals / (totalLeagueMatches * 2)); // roughly 1.5 - 1.8

let evaluatedMatches = 0;
let correctPredictions = 0;
let incorrectPredictions = 0;

endedMatches.forEach(m => {
    const home = m.participantAName;
    const away = m.participantBName;
    const homeScore = m.teamAScore;
    const awayScore = m.teamBScore;
    
    initPlayer(home);
    initPlayer(away);
    
    const sHome = playerStats[home];
    const sAway = playerStats[away];
    
    if (sHome.matches >= 5 && sAway.matches >= 5) {
        const homeAvgScored = sHome.goalsScored / sHome.matches;
        const homeAvgConceded = sHome.goalsConceded / sHome.matches;
        const awayAvgScored = sAway.goalsScored / sAway.matches;
        const awayAvgConceded = sAway.goalsConceded / sAway.matches;
        
        // Determine Playstyle based on historical stats up to this match
        const homeStyle = homeAvgScored > leagueAvgGoalsPerTeam ? 'Aggressive' : 'Defensive';
        const awayStyle = awayAvgScored > leagueAvgGoalsPerTeam ? 'Aggressive' : 'Defensive';
        
        let homeXG = (homeAvgScored + awayAvgConceded) / 2;
        let awayXG = (awayAvgScored + homeAvgConceded) / 2;
        
        const calcPoints = (form) => form.reduce((acc, val) => acc + (val === 'W' ? 3 : val === 'D' ? 1 : 0), 0);
        homeXG += calcPoints(sHome.streak.slice(-5)) * 0.05;
        awayXG += calcPoints(sAway.streak.slice(-5)) * 0.05;
        
        // Playstyle matchup logic: 
        // If Aggressive plays Defensive, give slight edge to Defensive structure? 
        // Let's just let xG handle the numbers, but we track the styles.
        
        const diff = homeXG - awayXG;
        let prediction = "";
        
        // Predict Draw if very close
        if (diff > 0.20) prediction = "HOME";
        else if (diff < -0.20) prediction = "AWAY";
        else prediction = "DRAW";
        
        let actual = "";
        if (homeScore > awayScore) actual = "HOME";
        else if (homeScore < awayScore) actual = "AWAY";
        else actual = "DRAW";
        
        // IGNORING ALL DRAWS (both actual draws and predicted draws)
        // This simulates a "Draw No Bet" market or just skipping those matches entirely
        if (actual !== "DRAW" && prediction !== "DRAW") {
            evaluatedMatches++;
            if (prediction === actual) {
                correctPredictions++;
            } else {
                incorrectPredictions++;
            }
        }
    }
    
    // Update stats
    sHome.matches++;
    sAway.matches++;
    sHome.goalsScored += homeScore;
    sHome.goalsConceded += awayScore;
    sAway.goalsScored += awayScore;
    sAway.goalsConceded += homeScore;
    
    if (homeScore > awayScore) {
        sHome.wins++;
        sAway.losses++;
        sHome.streak.push('W');
        sAway.streak.push('L');
    } else if (homeScore < awayScore) {
        sAway.wins++;
        sHome.losses++;
        sAway.streak.push('W');
        sHome.streak.push('L');
    } else {
        sHome.draws++;
        sAway.draws++;
        sHome.streak.push('D');
        sAway.streak.push('D');
    }
});

const accuracy = ((correctPredictions / evaluatedMatches) * 100).toFixed(2);
const betSize = 5;
const odds = 2; // Assuming we get 2x odds on standard win/loss matchups without draws
const wagered = evaluatedMatches * betSize;
const returned = correctPredictions * (betSize * odds);
const profit = returned - wagered;

console.log(`--- BACKTEST: WIN/LOSS MATCHES ONLY (IGNORING DRAWS) ---`);
console.log(`League Average Goals Per Team: ${leagueAvgGoalsPerTeam.toFixed(2)}`);
console.log(`Total Decisive Matches Evaluated: ${evaluatedMatches}`);
console.log(`Correct Predictions: ${correctPredictions}`);
console.log(`Incorrect Predictions: ${incorrectPredictions}`);
console.log(`Accuracy: ${accuracy}%\n`);

console.log(`--- FINANCIALS (@ 2.0x Odds) ---`);
console.log(`Total Wagered: $${wagered}`);
console.log(`Total Returned: $${returned}`);
console.log(`Profit/Loss: $${profit}`);
