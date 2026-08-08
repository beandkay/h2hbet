const fs = require('fs');

const matches = JSON.parse(fs.readFileSync('api_data_7days.json', 'utf8'));
const endedMatches = matches
    .filter(m => m.matchStatus === 'MATCH_ENDED' && !m.isCancelled)
    .sort((a, b) => new Date(a.startDate) - new Date(b.startDate));

const playerStats = {};
// H2H tracking: h2h[playerA][playerB] = net wins for A
const h2hStats = {}; 

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
        h2hStats[name] = {};
    }
}

endedMatches.forEach(m => {
    const home = m.participantAName;
    const away = m.participantBName;
    const homeScore = m.teamAScore;
    const awayScore = m.teamBScore;
    
    initPlayer(home);
    initPlayer(away);
    
    if (h2hStats[home][away] === undefined) h2hStats[home][away] = 0;
    if (h2hStats[away][home] === undefined) h2hStats[away][home] = 0;
    
    const sHome = playerStats[home];
    const sAway = playerStats[away];
    
    if (sHome.matches >= 5 && sAway.matches >= 5) {
        const homeAvgScored = sHome.goalsScored / sHome.matches;
        const homeAvgConceded = sHome.goalsConceded / sHome.matches;
        const homeWinRate = sHome.wins / sHome.matches;
        
        const awayAvgScored = sAway.goalsScored / sAway.matches;
        const awayAvgConceded = sAway.goalsConceded / sAway.matches;
        const awayWinRate = sAway.wins / sAway.matches;
        
        let homeXG = (homeAvgScored + awayAvgConceded) / 2;
        let awayXG = (awayAvgScored + homeAvgConceded) / 2;
        
        // --- THE "ANTI-STREAK" LOGIC (2 MATCHES) ---
        const homeRecent = sHome.streak.slice(-2);
        let homeMod = 0;
        if (homeRecent.length === 2 && homeRecent[0] === 'W' && homeRecent[1] === 'W') {
            // They won 2 in a row. Expect the "dump". Heavy penalty.
            homeMod = -1.0; 
        } else if (homeRecent.length === 2 && homeRecent[0] === 'L' && homeRecent[1] === 'L') {
            // Lost 2 in a row. Expect the "bounce back". Boost.
            homeMod = 0.5;
        } else {
            // Normal momentum
            homeMod = homeRecent.filter(x => x === 'W').length * 0.1;
        }
        
        const awayRecent = sAway.streak.slice(-2);
        let awayMod = 0;
        if (awayRecent.length === 2 && awayRecent[0] === 'W' && awayRecent[1] === 'W') {
            awayMod = -1.0;
        } else if (awayRecent.length === 2 && awayRecent[0] === 'L' && awayRecent[1] === 'L') {
            awayMod = 0.5;
        } else {
            awayMod = awayRecent.filter(x => x === 'W').length * 0.1;
        }
        
        homeXG += homeMod;
        awayXG += awayMod;
        
        // --- H2H LOGIC ---
        // If one player dominates the other historically, give them a boost
        const netH2H = h2hStats[home][away];
        if (netH2H > 2) homeXG += 0.3;
        else if (netH2H < -2) awayXG += 0.3;
        
        const diff = homeXG - awayXG;
        let prediction = "";
        
        if (diff > 0.1) prediction = "HOME";
        else if (diff < -0.1) prediction = "AWAY";
        else {
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
    
    // Update Stats
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
        h2hStats[home][away]++;
        h2hStats[away][home]--;
    } else if (homeScore < awayScore) {
        sAway.wins++;
        sHome.losses++;
        sAway.streak.push('W');
        sHome.streak.push('L');
        h2hStats[away][home]++;
        h2hStats[home][away]--;
    } else {
        sHome.draws++;
        sAway.draws++;
        sHome.streak.push('D');
        sAway.streak.push('D');
    }
});

const accuracy = ((correctPredictions / totalPredictions) * 100).toFixed(2);
console.log(`--- ANTI-STREAK (2-GAME) & H2H BACKTEST RESULTS ---`);
console.log(`Total Eligible Matches Evaluated: ${totalPredictions}`);
console.log(`Correct Predictions: ${correctPredictions}`);
console.log(`Accuracy: ${accuracy}%`);
