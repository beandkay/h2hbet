const fs = require('fs');

const matches = JSON.parse(fs.readFileSync('api_data_7days.json', 'utf8'));
const endedMatches = matches
    .filter(m => m.matchStatus === 'MATCH_ENDED' && !m.isCancelled)
    .sort((a, b) => new Date(a.startDate) - new Date(b.startDate));

const playerStats = {};

function initPlayer(name) {
    if (!playerStats[name]) {
        playerStats[name] = { matches: 0, goalsScored: 0, goalsConceded: 0, streak: [] };
    }
}

let totalMatches = 0;
let actualOvers = 0;
let actualUnders = 0;
const results = [];

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
        
        const isOver = actualTotal > 2.5;
        if (isOver) actualOvers++;
        else actualUnders++;
        
        totalMatches++;
        
        results.push({
            totalXG: totalXG,
            actualTotal: actualTotal,
            isOver: isOver
        });
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

console.log(`Total Eligible Matches: ${totalMatches}`);
console.log(`Actual Overs (>2.5): ${actualOvers} (${((actualOvers/totalMatches)*100).toFixed(1)}%)`);
console.log(`Actual Unders (<2.5): ${actualUnders} (${((actualUnders/totalMatches)*100).toFixed(1)}%)\n`);

// Test different prediction thresholds for totalXG to predict an OVER
const thresholdsToTest = [2.5, 2.7, 2.9, 3.1, 3.3, 3.5];

thresholdsToTest.forEach(threshold => {
    let correct = 0;
    let predictedOvers = 0;
    let predictedUnders = 0;
    let correctPredictedUnders = 0;
    let correctPredictedOvers = 0;
    
    results.forEach(r => {
        const predOver = r.totalXG > threshold;
        if (predOver) predictedOvers++;
        else predictedUnders++;
        
        if (predOver === r.isOver) {
            correct++;
            if (predOver) correctPredictedOvers++;
            else correctPredictedUnders++;
        }
    });
    
    const accuracy = ((correct / totalMatches) * 100).toFixed(2);
    const underHitRate = predictedUnders > 0 ? ((correctPredictedUnders / predictedUnders) * 100).toFixed(1) : 0;
    const overHitRate = predictedOvers > 0 ? ((correctPredictedOvers / predictedOvers) * 100).toFixed(1) : 0;
    
    console.log(`--- Threshold: Predict OVER if totalXG > ${threshold} ---`);
    console.log(`Total Accuracy: ${accuracy}%`);
    console.log(`Predicted Overs: ${predictedOvers} | Over Hit Rate: ${overHitRate}%`);
    console.log(`Predicted Unders: ${predictedUnders} | Under Hit Rate: ${underHitRate}%\n`);
});
