const fs = require('fs');

const matches = JSON.parse(fs.readFileSync('api_data_latest.json', 'utf8'));
const endedMatches = matches
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
let incorrectPredictions = 0;

let totalWagered = 0;
let totalReturned = 0;

endedMatches.forEach(m => {
    const home = m.participantAName;
    const away = m.participantBName;
    const homeScore = m.teamAScore;
    const awayScore = m.teamBScore;
    
    initPlayer(home);
    initPlayer(away);
    
    const sHome = playerStats[home];
    const sAway = playerStats[away];
    
    // Evaluate only if both have played at least 3 matches today to establish base stats
    if (sHome.matches >= 3 && sAway.matches >= 3) {
        const homeAvgScored = sHome.goalsScored / sHome.matches;
        const homeAvgConceded = sHome.goalsConceded / sHome.matches;
        const awayAvgScored = sAway.goalsScored / sAway.matches;
        const awayAvgConceded = sAway.goalsConceded / sAway.matches;
        
        let homeXG = (homeAvgScored + awayAvgConceded) / 2;
        let awayXG = (awayAvgScored + homeAvgConceded) / 2;
        
        const calcPoints = (form) => form.reduce((acc, val) => acc + (val === 'W' ? 3 : val === 'D' ? 1 : 0), 0);
        homeXG += calcPoints(sHome.streak.slice(-5)) * 0.05;
        awayXG += calcPoints(sAway.streak.slice(-5)) * 0.05;
        
        const diff = homeXG - awayXG;
        let prediction = "";
        
        if (diff > 0.20) prediction = "HOME";
        else if (diff < -0.20) prediction = "AWAY";
        else prediction = "DRAW";
        
        let actual = "";
        if (homeScore > awayScore) actual = "HOME";
        else if (homeScore < awayScore) actual = "AWAY";
        else actual = "DRAW";
        
        const excludedPlayers = ["ODYSSEY", "NAVY", "RESISTANCE"];
        const isExcluded = excludedPlayers.includes(home) || excludedPlayers.includes(away);
        
        // Draw No Bet logic
        if (actual !== "DRAW" && prediction !== "DRAW" && !isExcluded) {
            evaluatedMatches++;
            
            // Determine Bet Size
            let betSize = 10; // Default bet
            if (prediction === "HOME" && (home === "DECIMATOR" || home === "INFERNO")) betSize = 20;
            if (prediction === "AWAY" && (away === "DECIMATOR" || away === "INFERNO")) betSize = 20;
            
            totalWagered += betSize;
            
            if (prediction === actual) {
                correctPredictions++;
                totalReturned += (betSize * 2); // 2.0x Odds
            } else {
                incorrectPredictions++;
            }
        }
    }
    
    sHome.matches++;
    sAway.matches++;
    sHome.goalsScored += homeScore;
    sHome.goalsConceded += awayScore;
    sAway.goalsScored += awayScore;
    sAway.goalsConceded += homeScore;
    
    sHome.streak.push(homeScore > awayScore ? 'W' : homeScore < awayScore ? 'L' : 'D');
    sAway.streak.push(awayScore > homeScore ? 'W' : awayScore < homeScore ? 'L' : 'D');
});

const profit = totalReturned - totalWagered;
const accuracy = ((correctPredictions / evaluatedMatches) * 100).toFixed(2);

console.log(`--- HYBRID STAKING BACKTEST (TODAY) ---`);
console.log(`Base Unit: $10 | DECIMATOR Unit: $20`);
console.log(`Decisive Matches Evaluated: ${evaluatedMatches}`);
console.log(`Correct Predictions: ${correctPredictions}`);
console.log(`Incorrect Predictions: ${incorrectPredictions}`);
console.log(`Model Accuracy: ${accuracy}%\n`);
console.log(`--- FINANCIALS ---`);
console.log(`Total Wagered: $${totalWagered}`);
console.log(`Total Returned: $${totalReturned}`);
console.log(`Total Net Profit: $${profit}`);
