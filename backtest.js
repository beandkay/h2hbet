const fs = require('fs');

const matches = JSON.parse(fs.readFileSync('api_data_7days.json', 'utf8'));
const endedMatches = matches
    .filter(m => m.matchStatus === 'MATCH_ENDED' && !m.isCancelled)
    .sort((a, b) => new Date(a.startDate) - new Date(b.startDate));

const playerStats = {};
let totalPredictions = 0;
let correctPredictions = 0;

function initPlayer(name) {
    if (!playerStats[name]) {
        playerStats[name] = {
            matches: 0,
            wins: 0,
            draws: 0,
            losses: 0,
            goalsScored: 0,
            goalsConceded: 0,
            streak: []
        };
    }
}

endedMatches.forEach(m => {
    const home = m.participantAName;
    const away = m.participantBName;
    const homeScore = m.teamAScore;
    const awayScore = m.teamBScore;
    
    initPlayer(home);
    initPlayer(away);
    
    const sHome = playerStats[home];
    const sAway = playerStats[away];
    
    // Require 5 matches played in the rolling window to establish a baseline
    if (sHome.matches >= 5 && sAway.matches >= 5) {
        const homeAvgScored = sHome.goalsScored / sHome.matches;
        const homeAvgConceded = sHome.goalsConceded / sHome.matches;
        const homeWinRate = sHome.wins / sHome.matches;
        
        const awayAvgScored = sAway.goalsScored / sAway.matches;
        const awayAvgConceded = sAway.goalsConceded / sAway.matches;
        const awayWinRate = sAway.wins / sAway.matches;
        
        let homeXG = (homeAvgScored + awayAvgConceded) / 2;
        let awayXG = (awayAvgScored + homeAvgConceded) / 2;
        
        const calcPoints = (form) => form.reduce((acc, val) => acc + (val === 'W' ? 3 : val === 'D' ? 1 : 0), 0);
        const homeFormPts = calcPoints(sHome.streak.slice(-5));
        const awayFormPts = calcPoints(sAway.streak.slice(-5));
        
        homeXG += homeFormPts * 0.05;
        awayXG += awayFormPts * 0.05;
        
        const diff = homeXG - awayXG;
        let prediction = "";
        
        if (diff > 0.1) {
            prediction = "HOME";
        } else if (diff < -0.1) {
            prediction = "AWAY";
        } else {
            if (homeWinRate > awayWinRate) prediction = "HOME";
            else if (awayWinRate > homeWinRate) prediction = "AWAY";
            else prediction = "DRAW";
        }
        
        let actual = "";
        if (homeScore > awayScore) actual = "HOME";
        else if (homeScore < awayScore) actual = "AWAY";
        else actual = "DRAW";
        
        totalPredictions++;
        if (prediction === actual) correctPredictions++;
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

// Financial Calculations
const betSize = 5;
const odds = 2;

const incorrectPredictions = totalPredictions - correctPredictions;
const totalWagered = totalPredictions * betSize;
const totalReturned = correctPredictions * (betSize * odds);
const profitLoss = totalReturned - totalWagered;

console.log(`--- FINANCIAL BACKTEST (7 DAYS) ---`);
console.log(`Total Matches Bet: ${totalPredictions}`);
console.log(`Correct Predictions: ${correctPredictions}`);
console.log(`Incorrect Predictions: ${incorrectPredictions}`);
console.log(`Accuracy: ${((correctPredictions / totalPredictions) * 100).toFixed(2)}%`);
console.log(`\n--- BANKROLL ---`);
console.log(`Total Wagered: $${totalWagered}`);
console.log(`Total Returned: $${totalReturned}`);
console.log(`Profit/Loss: $${profitLoss}`);
