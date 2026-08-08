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

let drawBets = 0;
let drawHits = 0;

endedMatches.forEach(m => {
    const home = m.participantAName;
    const away = m.participantBName;
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
        
        const calcPoints = (form) => form.reduce((acc, val) => acc + (val === 'W' ? 3 : val === 'D' ? 1 : 0), 0);
        homeXG += calcPoints(sHome.streak.slice(-5)) * 0.05;
        awayXG += calcPoints(sAway.streak.slice(-5)) * 0.05;
        
        const diff = homeXG - awayXG;
        
        // SCENARIO 1: Force a Winner Prediction (No Skips)
        const prediction = diff > 0 ? "HOME" : "AWAY";
        
        let actual = "";
        if (homeScore > awayScore) actual = "HOME";
        else if (homeScore < awayScore) actual = "AWAY";
        else actual = "DRAW"; // Draws will count as a loss here since we forced a winner
        
        evaluatedMatches++;
        if (prediction === actual) correctPredictions++;
        else incorrectPredictions++;
        
        // SCENARIO 2: Betting on the Draw instead of skipping
        if (Math.abs(diff) <= 0.20) {
            drawBets++;
            if (actual === "DRAW") {
                drawHits++;
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

const betSize = 10;
const odds = 2; 

const wagered = evaluatedMatches * betSize;
const returned = correctPredictions * (betSize * odds);
const profit = returned - wagered;
const accuracy = ((correctPredictions / evaluatedMatches) * 100).toFixed(2);

console.log(`--- SCENARIO 1: FORCING A WINNER (NO SKIPS) ---`);
console.log(`Matches Evaluated: ${evaluatedMatches}`);
console.log(`Correct Predictions: ${correctPredictions}`);
console.log(`Incorrect Predictions: ${incorrectPredictions}`);
console.log(`Accuracy: ${accuracy}%`);
console.log(`Total Wagered: $${wagered}`);
console.log(`Total Returned: $${returned}`);
console.log(`Profit/Loss: $${profit}`);

const drawWagered = drawBets * betSize;
const drawReturned = drawHits * (betSize * 3.5); // Assuming ~3.5x odds for a Draw
const drawProfit = drawReturned - drawWagered;
const drawAccuracy = drawBets > 0 ? ((drawHits / drawBets) * 100).toFixed(2) : 0;

console.log(`\n--- SCENARIO 2: BETTING THE 'TOSS-UP' MATCHES AS DRAWS ---`);
console.log(`Total Draw Bets Placed: ${drawBets}`);
console.log(`Draws Hit: ${drawHits}`);
console.log(`Draw Hit Rate: ${drawAccuracy}%`);
console.log(`Total Wagered: $${drawWagered}`);
console.log(`Total Returned (@ 3.5x odds): $${drawReturned}`);
console.log(`Profit/Loss on Draws: $${drawProfit}`);
