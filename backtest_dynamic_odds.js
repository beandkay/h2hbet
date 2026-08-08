const fs = require('fs');

const matches = JSON.parse(fs.readFileSync('api_data_latest.json', 'utf8'));
const endedMatches = matches
    .filter(m => m.matchStatus === 'MATCH_ENDED' && !m.isCancelled)
    .sort((a, b) => new Date(a.startDate) - new Date(b.startDate));

const playerStats = {};
const dynamicOdds = {
    'INFERNO': 2.00,
    'DECIMATOR': 2.00 // Assuming Decimator's odds also drop since he wins even more!
};

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
    
    // Evaluate only if both have played at least 3 matches today
    if (sHome = playerStats[home], sAway = playerStats[away], sHome.matches >= 3 && sAway.matches >= 3) {
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
        else prediction = "DRAW"; // Usually implies SKIP
        
        let actual = "";
        if (homeScore > awayScore) actual = "HOME";
        else if (homeScore < awayScore) actual = "AWAY";
        else actual = "DRAW";
        
        const excludedPlayers = ["ODYSSEY", "NAVY", "RESISTANCE"];
        const isExcluded = excludedPlayers.includes(home) || excludedPlayers.includes(away);
        const isSuperstar = (home === "DECIMATOR" || home === "INFERNO" || away === "DECIMATOR" || away === "INFERNO");
        
        // Draw No Bet logic
        if (actual !== "DRAW" && !isExcluded) {
            
            // Force bet on superstars
            if (isSuperstar) {
                if (home === "DECIMATOR" || home === "INFERNO") prediction = "HOME";
                if (away === "DECIMATOR" || away === "INFERNO") prediction = "AWAY";
                if ((home === "DECIMATOR" || home === "INFERNO") && (away === "DECIMATOR" || away === "INFERNO")) {
                    prediction = diff > 0 ? "HOME" : "AWAY";
                }
            }
            
            if (isSuperstar || prediction !== "DRAW") {
                evaluatedMatches++;
                
                let betSize = isSuperstar ? 20 : 10;
                totalWagered += betSize;
                
                if (prediction === actual) {
                    correctPredictions++;
                    
                    // Get the odds for this specific payout
                    let payoutOdds = 2.0; 
                    if (prediction === "HOME" && dynamicOdds[home]) payoutOdds = dynamicOdds[home];
                    if (prediction === "AWAY" && dynamicOdds[away]) payoutOdds = dynamicOdds[away];
                    
                    totalReturned += (betSize * payoutOdds);
                } else {
                    incorrectPredictions++;
                }
            }
        }
    }
    
    // Update player records
    sHome.matches++;
    sAway.matches++;
    sHome.goalsScored += homeScore;
    sHome.goalsConceded += awayScore;
    sAway.goalsScored += awayScore;
    sAway.goalsConceded += homeScore;
    
    sHome.streak.push(homeScore > awayScore ? 'W' : homeScore < awayScore ? 'L' : 'D');
    sAway.streak.push(awayScore > homeScore ? 'W' : awayScore < homeScore ? 'L' : 'D');
    
    // Update dynamic odds AFTER the match ends (market adjustment)
    if (homeScore > awayScore) {
        if (dynamicOdds[home]) dynamicOdds[home] = Math.max(1.50, dynamicOdds[home] - 0.075);
        if (dynamicOdds[away]) dynamicOdds[away] += 0.075;
    } else if (awayScore > homeScore) {
        if (dynamicOdds[away]) dynamicOdds[away] = Math.max(1.50, dynamicOdds[away] - 0.075);
        if (dynamicOdds[home]) dynamicOdds[home] += 0.075;
    }
});

const profit = totalReturned - totalWagered;
const accuracy = ((correctPredictions / evaluatedMatches) * 100).toFixed(2);

console.log(`--- DYNAMIC ODDS BACKTEST (MARKET ADJUSTMENT) ---`);
console.log(`Final DECIMATOR Odds: ${dynamicOdds['DECIMATOR'].toFixed(2)}x`);
console.log(`Final INFERNO Odds: ${dynamicOdds['INFERNO'].toFixed(2)}x`);
console.log(`Decisive Matches Evaluated: ${evaluatedMatches}`);
console.log(`Correct Predictions: ${correctPredictions}`);
console.log(`Incorrect Predictions: ${incorrectPredictions}`);
console.log(`Model Accuracy: ${accuracy}%\n`);
console.log(`--- FINANCIALS ---`);
console.log(`Total Wagered: $${totalWagered}`);
console.log(`Total Returned: $${totalReturned.toFixed(2)}`);
console.log(`Total Net Profit: $${profit.toFixed(2)}`);
