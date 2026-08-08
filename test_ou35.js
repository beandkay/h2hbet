const fs = require('fs');

function groupMatchesByRotation(matches) {
    const blocks = {};
    matches.forEach(m => {
        if (m.matchStatus !== 'MATCH_ENDED' || m.isCancelled) return;
        const aestDate = new Date(new Date(m.startDate).getTime() + 10 * 60 * 60 * 1000);
        const year = aestDate.getUTCFullYear();
        const month = String(aestDate.getUTCMonth() + 1).padStart(2, '0');
        let day = aestDate.getUTCDate();
        const hour = aestDate.getUTCHours();
        let blockName = "";
        if (hour >= 4 && hour < 16) {
            blockName = `${year}-${month}-${String(day).padStart(2, '0')}_AM`;
        } else if (hour >= 16) {
            blockName = `${year}-${month}-${String(day).padStart(2, '0')}_PM`;
        } else {
            const yesterday = new Date(aestDate);
            yesterday.setUTCDate(yesterday.getUTCDate() - 1);
            day = yesterday.getUTCDate();
            const yYear = yesterday.getUTCFullYear();
            const yMonth = String(yesterday.getUTCMonth() + 1).padStart(2, '0');
            blockName = `${yYear}-${yMonth}-${String(day).padStart(2, '0')}_PM`;
        }
        if (!blocks[blockName]) blocks[blockName] = [];
        blocks[blockName].push(m);
    });
    for (let key in blocks) {
        blocks[key].sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
    }
    return blocks;
}

const matches = JSON.parse(fs.readFileSync('historical_fifa.json', 'utf8'));
const blocks = groupMatchesByRotation(matches);

let totalEval = 0;
let actualOvers = 0;
let actualUnders = 0;

let modelCorrectOvers = 0;
let modelIncorrectOvers = 0;
let modelCorrectUnders = 0;
let modelIncorrectUnders = 0;

const betSize = 10;
let totalWagered = 0;
let totalReturned = 0;

Object.keys(blocks).sort().forEach(blockName => {
    const blockMatches = blocks[blockName];
    const playerStats = {};
    
    function initPlayer(name) {
        if (!playerStats[name]) {
            playerStats[name] = { matches: 0, scored: 0, conceded: 0, streak: [] };
        }
    }
    
    blockMatches.forEach(m => {
        const home = m.participantAName;
        const away = m.participantBName;
        const homeScore = m.teamAScore;
        const awayScore = m.teamBScore;
        
        initPlayer(home);
        initPlayer(away);
        
        const sHome = playerStats[home];
        const sAway = playerStats[away];
        
        if (sHome.matches >= 3 && sAway.matches >= 3) {
            const homeRaw = (sHome.scored/sHome.matches + sAway.conceded/sAway.matches)/2;
            const awayRaw = (sAway.scored/sAway.matches + sHome.conceded/sHome.matches)/2;
            
            const calcPoints = (form) => form.reduce((acc, val) => acc + (val === 'W' ? 3 : val === 'D' ? 1 : 0), 0);
            const homeXG = homeRaw + calcPoints(sHome.streak.slice(-5)) * 0.05;
            const awayXG = awayRaw + calcPoints(sAway.streak.slice(-5)) * 0.05;
            
            const totalXG = homeXG + awayXG;
            
            // Model prediction based on 3.5
            // If expected goals > 3.5, bet OVER. If < 3.5, bet UNDER.
            const predOU = totalXG > 3.5 ? "OVER" : "UNDER";
            
            const actualTotal = homeScore + awayScore;
            const actualOU = actualTotal > 3.5 ? "OVER" : "UNDER";
            
            if (actualOU === "OVER") actualOvers++;
            if (actualOU === "UNDER") actualUnders++;
            
            totalEval++;
            totalWagered += betSize;
            
            if (predOU === "OVER") {
                if (actualOU === "OVER") {
                    modelCorrectOvers++;
                    totalReturned += (betSize * 2.5); // OVER pays 2.5
                } else {
                    modelIncorrectOvers++;
                }
            } else {
                if (actualOU === "UNDER") {
                    modelCorrectUnders++;
                    totalReturned += (betSize * 1.5); // UNDER pays 1.5
                } else {
                    modelIncorrectUnders++;
                }
            }
        }
        
        sHome.matches++;
        sAway.matches++;
        sHome.scored += homeScore;
        sHome.conceded += awayScore;
        sAway.scored += awayScore;
        sAway.conceded += homeScore;
        
        if (homeScore > awayScore) {
            sHome.streak.push('W');
            sAway.streak.push('L');
        } else if (homeScore < awayScore) {
            sAway.streak.push('W');
            sHome.streak.push('L');
        } else {
            sHome.streak.push('D');
            sAway.streak.push('D');
        }
    });
});

console.log(`Total Decisive Matches Evaluated: ${totalEval}`);
console.log(`Actual Matches that went OVER 3.5: ${actualOvers} (${((actualOvers/totalEval)*100).toFixed(2)}%)`);
console.log(`Actual Matches that went UNDER 3.5: ${actualUnders} (${((actualUnders/totalEval)*100).toFixed(2)}%)`);
console.log(`\n-- Model Performance (OVER 3.5 @ 2.50 Odds) --`);
console.log(`Model Predicted OVER: ${modelCorrectOvers + modelIncorrectOvers} times`);
console.log(`Correct: ${modelCorrectOvers} | Incorrect: ${modelIncorrectOvers}`);
console.log(`\n-- Model Performance (UNDER 3.5 @ 1.50 Odds) --`);
console.log(`Model Predicted UNDER: ${modelCorrectUnders + modelIncorrectUnders} times`);
console.log(`Correct: ${modelCorrectUnders} | Incorrect: ${modelIncorrectUnders}`);
console.log(`\n-- Financials --`);
console.log(`Total Wagered: $${totalWagered}`);
console.log(`Total Returned: $${totalReturned}`);
console.log(`Profit/Loss: $${(totalReturned - totalWagered).toFixed(2)}`);
