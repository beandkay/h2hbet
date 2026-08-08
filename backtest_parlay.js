const fs = require('fs');

const matches = JSON.parse(fs.readFileSync('api_data_latest.json', 'utf8'));
const endedMatches = matches
    .filter(m => m.matchStatus === 'MATCH_ENDED' && !m.isCancelled)
    .sort((a, b) => new Date(a.startDate) - new Date(b.startDate));

const playerStats = {};
const dynamicOdds = {
    'INFERNO': 2.00,
    'DECIMATOR': 2.00
};

function initPlayer(name) {
    if (!playerStats[name]) {
        playerStats[name] = { matches: 0, goalsScored: 0, goalsConceded: 0, streak: [] };
    }
}

let evaluatedMatches = 0;
let correctPredictions = 0;
let incorrectPredictions = 0;
let parlayBets = 0;
let parlayWins = 0;

let totalWagered = 0;
let totalReturned = 0;

// Group matches into time batches (within 5 minutes of each other)
const batches = [];
let currentBatch = [];
let batchStartTime = null;

endedMatches.forEach(m => {
    const time = new Date(m.startDate).getTime();
    if (batchStartTime === null) {
        batchStartTime = time;
        currentBatch.push(m);
    } else if (time - batchStartTime <= 5 * 60 * 1000) {
        currentBatch.push(m);
    } else {
        batches.push(currentBatch);
        currentBatch = [m];
        batchStartTime = time;
    }
});
if (currentBatch.length > 0) batches.push(currentBatch);

const excludedPlayers = ["ODYSSEY", "NAVY", "RESISTANCE"];

batches.forEach(batch => {
    
    // First, update basic stats for all matches in the batch so we have their baseline
    batch.forEach(m => {
        initPlayer(m.participantAName);
        initPlayer(m.participantBName);
    });

    let decimatorMatch = null;
    let infernoMatch = null;

    // Identify if both superstars are playing in this batch (and they are not playing each other)
    batch.forEach(m => {
        const h = m.participantAName;
        const a = m.participantBName;
        
        if (h === "DECIMATOR" || a === "DECIMATOR") {
            if (h !== "INFERNO" && a !== "INFERNO") decimatorMatch = m;
        }
        if (h === "INFERNO" || a === "INFERNO") {
            if (h !== "DECIMATOR" && a !== "DECIMATOR") infernoMatch = m;
        }
    });

    const isParlayActive = (decimatorMatch && infernoMatch && 
                           playerStats["DECIMATOR"].matches >= 3 && 
                           playerStats["INFERNO"].matches >= 3);

    let decimatorResult = ""; // "WIN", "LOSS", "DRAW"
    let infernoResult = "";

    // Process all matches in the batch
    batch.forEach(m => {
        const home = m.participantAName;
        const away = m.participantBName;
        const homeScore = m.teamAScore;
        const awayScore = m.teamBScore;
        const sHome = playerStats[home];
        const sAway = playerStats[away];
        
        let isDecimatorMatch = (m === decimatorMatch);
        let isInfernoMatch = (m === infernoMatch);
        
        if (sHome.matches >= 3 && sAway.matches >= 3) {
            
            let actual = "";
            if (homeScore > awayScore) actual = "HOME";
            else if (homeScore < awayScore) actual = "AWAY";
            else actual = "DRAW";
            
            const isExcluded = excludedPlayers.includes(home) || excludedPlayers.includes(away);
            const isSuperstar = (home === "DECIMATOR" || home === "INFERNO" || away === "DECIMATOR" || away === "INFERNO");
            
            let homeSuperstar = (home === "DECIMATOR" || home === "INFERNO");
            let awaySuperstar = (away === "DECIMATOR" || away === "INFERNO");
            
            let matchWinResult = "";
            if (homeSuperstar) {
                matchWinResult = (actual === "HOME") ? "WIN" : (actual === "DRAW") ? "DRAW" : "LOSS";
            } else if (awaySuperstar) {
                matchWinResult = (actual === "AWAY") ? "WIN" : (actual === "DRAW") ? "DRAW" : "LOSS";
            }

            if (isParlayActive && isDecimatorMatch) decimatorResult = matchWinResult;
            if (isParlayActive && isInfernoMatch) infernoResult = matchWinResult;

            // If it's a parlay match, we don't evaluate it as a single bet
            if (!(isParlayActive && (isDecimatorMatch || isInfernoMatch))) {
                
                // Normal Single Bet Logic
                if (actual !== "DRAW" && !isExcluded) {
                    
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
                    
                    if (isSuperstar) {
                        if (homeSuperstar) prediction = "HOME";
                        if (awaySuperstar) prediction = "AWAY";
                        if (homeSuperstar && awaySuperstar) prediction = diff > 0 ? "HOME" : "AWAY";
                    }
                    
                    if (isSuperstar || prediction !== "DRAW") {
                        evaluatedMatches++;
                        let betSize = isSuperstar ? 20 : 10;
                        totalWagered += betSize;
                        
                        if (prediction === actual) {
                            correctPredictions++;
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
        }
        
        // Update player stats for next batch
        sHome.matches++;
        sAway.matches++;
        sHome.goalsScored += homeScore;
        sHome.goalsConceded += awayScore;
        sAway.goalsScored += awayScore;
        sAway.goalsConceded += homeScore;
        sHome.streak.push(homeScore > awayScore ? 'W' : homeScore < awayScore ? 'L' : 'D');
        sAway.streak.push(awayScore > homeScore ? 'W' : awayScore < homeScore ? 'L' : 'D');
        
        // Adjust odds based on match result
        if (homeScore > awayScore) {
            if (dynamicOdds[home]) dynamicOdds[home] = Math.max(1.50, dynamicOdds[home] - 0.075);
            if (dynamicOdds[away]) dynamicOdds[away] += 0.075;
        } else if (awayScore > homeScore) {
            if (dynamicOdds[away]) dynamicOdds[away] = Math.max(1.50, dynamicOdds[away] - 0.075);
            if (dynamicOdds[home]) dynamicOdds[home] += 0.075;
        }
    });

    // Evaluate Parlay if active
    if (isParlayActive && decimatorResult !== "" && infernoResult !== "") {
        parlayBets++;
        const betSize = 20;
        totalWagered += betSize;
        evaluatedMatches++; // Count the parlay as 1 evaluated event
        
        if (decimatorResult === "WIN" && infernoResult === "WIN") {
            parlayWins++;
            correctPredictions++;
            totalReturned += (betSize * 3.0); // 3x odds for the double
        } else if (decimatorResult === "DRAW" && infernoResult === "DRAW") {
            totalReturned += betSize; // Full refund on double push
        } else if (decimatorResult === "WIN" && infernoResult === "DRAW") {
            // Reverts to single bet on Decimator
            correctPredictions++;
            totalReturned += (betSize * dynamicOdds["DECIMATOR"]);
        } else if (infernoResult === "WIN" && decimatorResult === "DRAW") {
            // Reverts to single bet on Inferno
            correctPredictions++;
            totalReturned += (betSize * dynamicOdds["INFERNO"]);
        } else {
            // If either lost, the parlay loses
            incorrectPredictions++;
        }
    }
});

const profit = totalReturned - totalWagered;
const accuracy = ((correctPredictions / evaluatedMatches) * 100).toFixed(2);

console.log(`--- PARLAY + DYNAMIC ODDS BACKTEST ---`);
console.log(`Total Double Bets (Parlays) Placed: ${parlayBets}`);
console.log(`Parlays Hit (Both Won): ${parlayWins}`);
console.log(`Final DECIMATOR Odds: ${dynamicOdds['DECIMATOR'].toFixed(2)}x`);
console.log(`Final INFERNO Odds: ${dynamicOdds['INFERNO'].toFixed(2)}x`);
console.log(`\nTotal Betting Events Evaluated: ${evaluatedMatches}`);
console.log(`Winning Bets: ${correctPredictions}`);
console.log(`Losing Bets: ${incorrectPredictions}`);
console.log(`Overall Accuracy: ${accuracy}%\n`);
console.log(`--- FINANCIALS ---`);
console.log(`Total Wagered: $${totalWagered}`);
console.log(`Total Returned: $${totalReturned.toFixed(2)}`);
console.log(`Total Net Profit: $${profit.toFixed(2)}`);
