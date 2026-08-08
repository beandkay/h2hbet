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

const decimatorQueue = [];
const infernoQueue = [];

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
        
        if (actual !== "DRAW" && !isExcluded) {
            
            let isDecimatorMatch = (home === "DECIMATOR" || away === "DECIMATOR");
            let isInfernoMatch = (home === "INFERNO" || away === "INFERNO");
            
            // Resolve actual match result for superstars
            let matchWinResult = "";
            if (isSuperstar) {
                if (home === "DECIMATOR" || home === "INFERNO") {
                    matchWinResult = (actual === "HOME") ? "WIN" : (actual === "DRAW") ? "DRAW" : "LOSS";
                } else {
                    matchWinResult = (actual === "AWAY") ? "WIN" : (actual === "DRAW") ? "DRAW" : "LOSS";
                }
                
                // Add to respective queues
                if (isDecimatorMatch) decimatorQueue.push({ result: matchWinResult, odds: dynamicOdds["DECIMATOR"] });
                if (isInfernoMatch) infernoQueue.push({ result: matchWinResult, odds: dynamicOdds["INFERNO"] });
            }
            
            // If we have at least one in both queues, we pair them up into a parlay!
            if (decimatorQueue.length > 0 && infernoQueue.length > 0) {
                const dec = decimatorQueue.shift();
                const inf = infernoQueue.shift();
                
                parlayBets++;
                const betSize = 20;
                totalWagered += betSize;
                
                if (dec.result === "WIN" && inf.result === "WIN") {
                    parlayWins++;
                    correctPredictions++; // counting the parlay as a single correct prediction block
                    totalReturned += (betSize * 3.0); // 3x fixed payout for the double
                } else if (dec.result === "DRAW" && inf.result === "DRAW") {
                    totalReturned += betSize; // Refund
                } else if (dec.result === "WIN" && inf.result === "DRAW") {
                    correctPredictions++;
                    totalReturned += (betSize * dec.odds);
                } else if (inf.result === "WIN" && dec.result === "DRAW") {
                    correctPredictions++;
                    totalReturned += (betSize * inf.odds);
                } else {
                    incorrectPredictions++;
                }
            }
            
            // Evaluate ALL valid matches as singles (Superstars $20, Normal $10)
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
    
    // Update player records
    sHome.matches++;
    sAway.matches++;
    sHome.goalsScored += homeScore;
    sHome.goalsConceded += awayScore;
    sAway.goalsScored += awayScore;
    sAway.goalsConceded += homeScore;
    sHome.streak.push(homeScore > awayScore ? 'W' : homeScore < awayScore ? 'L' : 'D');
    sAway.streak.push(awayScore > homeScore ? 'W' : awayScore < homeScore ? 'L' : 'D');
    
    // Market odds adjustment (Decrease on win, bounce on loss)
    if (homeScore > awayScore) {
        if (dynamicOdds[home]) dynamicOdds[home] = Math.max(1.50, dynamicOdds[home] - 0.075);
        if (dynamicOdds[away]) dynamicOdds[away] += 0.075;
    } else if (awayScore > homeScore) {
        if (dynamicOdds[away]) dynamicOdds[away] = Math.max(1.50, dynamicOdds[away] - 0.075);
        if (dynamicOdds[home]) dynamicOdds[home] += 0.075;
    }
});

const profit = totalReturned - totalWagered;
const accuracy = ((correctPredictions / (evaluatedMatches + parlayBets)) * 100).toFixed(2);

console.log(`--- ROLLING PARLAY BACKTEST ---`);
console.log(`Total Parlays Formed: ${parlayBets}`);
console.log(`Parlays Hit (Both Won): ${parlayWins}`);
console.log(`\nSingle Decisive Matches Evaluated: ${evaluatedMatches}`);
console.log(`Total Evaluated Betting Events (Singles + Parlays): ${evaluatedMatches + parlayBets}`);
console.log(`Overall System Accuracy: ${accuracy}%\n`);
console.log(`--- FINANCIALS ---`);
console.log(`Total Wagered: $${totalWagered}`);
console.log(`Total Returned: $${totalReturned.toFixed(2)}`);
console.log(`Total Net Profit: $${profit.toFixed(2)}`);
