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

let skipMatches = 0;
let forcedCorrect = 0;
let forcedIncorrect = 0;
let actualDraws = 0;

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
        
        // Is this a SKIP match? (xG diff <= 0.20)
        if (Math.abs(diff) <= 0.20) {
            skipMatches++;
            
            // Force a winner prediction
            const prediction = diff > 0 ? "HOME" : "AWAY";
            
            let actual = "";
            if (homeScore > awayScore) actual = "HOME";
            else if (homeScore < awayScore) actual = "AWAY";
            else {
                actual = "DRAW";
                actualDraws++;
            }
            
            // If the match was a draw, forcing a winner results in a loss
            if (prediction === actual) {
                forcedCorrect++;
            } else {
                forcedIncorrect++;
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

console.log(`Total "SKIP" Matches Evaluated: ${skipMatches}`);
console.log(`Number of those that ended in a DRAW: ${actualDraws}`);
console.log(`\nIf we FORCED a Match Winner bet on these ${skipMatches} skips based on the tiny xG edge:`);
console.log(`Wins (Guessed right): ${forcedCorrect}`);
console.log(`Losses (Guessed wrong, or it was a draw): ${forcedIncorrect}`);
console.log(`Accuracy: ${((forcedCorrect/skipMatches)*100).toFixed(2)}%`);
