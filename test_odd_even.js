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
let correctPred = 0;
let incorrectPred = 0;

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
            
            const predOddEven = Math.round(totalXG) % 2 === 0 ? "EVEN" : "ODD";
            
            const actualTotal = homeScore + awayScore;
            const actualOddEven = actualTotal % 2 === 0 ? "EVEN" : "ODD";
            
            totalEval++;
            
            if (predOddEven === actualOddEven) {
                correctPred++;
            } else {
                incorrectPred++;
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

console.log(`--- ODD/EVEN BACKTEST ---`);
console.log(`Matches Evaluated: ${totalEval}`);
console.log(`Correct: ${correctPred} | Incorrect: ${incorrectPred}`);
console.log(`Accuracy: ${((correctPred / totalEval) * 100).toFixed(2)}%`);
