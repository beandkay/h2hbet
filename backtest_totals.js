const fs = require('fs');

const matches = JSON.parse(fs.readFileSync('api_data_7days.json', 'utf8'));
const endedMatches = matches
    .filter(m => m.matchStatus === 'MATCH_ENDED' && !m.isCancelled)
    .sort((a, b) => new Date(a.startDate) - new Date(b.startDate));

const playerStats = {};
let totalMatches = 0;
let correctOU = 0;

function initPlayer(name) {
    if (!playerStats[name]) {
        playerStats[name] = { matches: 0, goalsScored: 0, goalsConceded: 0, streak: [] };
    }
}

endedMatches.forEach(m => {
    const home = m.participantAName;
    const away = m.participantBName;
    const homeScore = m.teamAScore;
    const awayScore = m.teamBScore;
    const actualTotal = homeScore + awayScore;
    
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
        
        const totalXG = homeXG + awayXG;
        let predOU = totalXG > 2.5 ? "OVER" : "UNDER";
        let actualOU = actualTotal > 2.5 ? "OVER" : "UNDER";
        
        totalMatches++;
        if (predOU === actualOU) correctOU++;
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

const accuracy = ((correctOU / totalMatches) * 100).toFixed(2);
const betSize = 5;
const wagered = totalMatches * betSize;

const returned15 = correctOU * (betSize * 1.5);
const profit15 = returned15 - wagered;

const returned14 = correctOU * (betSize * 1.4);
const profit14 = returned14 - wagered;

console.log(`--- FINANCIAL BACKTEST (OVER/UNDER 2.5) ---`);
console.log(`Total Matches Bet: ${totalMatches}`);
console.log(`Correct Predictions: ${correctOU}`);
console.log(`Accuracy: ${accuracy}%\n`);

console.log(`--- SCENARIO 1: ODDS @ 1.5x ---`);
console.log(`Total Wagered: $${wagered}`);
console.log(`Total Returned: $${returned15.toFixed(2)}`);
console.log(`Profit/Loss: $${profit15.toFixed(2)}\n`);

console.log(`--- SCENARIO 2: ODDS @ 1.4x ---`);
console.log(`Total Wagered: $${wagered}`);
console.log(`Total Returned: $${returned14.toFixed(2)}`);
console.log(`Profit/Loss: $${profit14.toFixed(2)}`);
