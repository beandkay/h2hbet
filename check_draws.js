const fs = require('fs');

const matches = JSON.parse(fs.readFileSync('api_data_latest.json', 'utf8'));
const endedMatches = matches.filter(m => m.matchStatus === 'MATCH_ENDED' && !m.isCancelled);

const newRotationPlayers = [
    "HAVOC", "MAGICIAN", "SPARTAN", "BUTCHER", "INSTINCT", "ZT", 
    "COSMOS", "PROPHET", "EXILE", "PLUTO", "AMBASSADOR", "ARCTIC", "BULLFROG", "DEZZY"
];

let totalNewMatches = 0;
let drawMatches = 0;
let homeWins = 0;
let awayWins = 0;

// To avoid double counting, we track evaluated match IDs
const evaluatedIds = new Set();

endedMatches.forEach(m => {
    const home = m.participantAName;
    const away = m.participantBName;
    
    if (newRotationPlayers.includes(home) || newRotationPlayers.includes(away)) {
        if (!evaluatedIds.has(m.id)) {
            evaluatedIds.add(m.id);
            totalNewMatches++;
            
            if (m.teamAScore === m.teamBScore) {
                drawMatches++;
            } else if (m.teamAScore > m.teamBScore) {
                homeWins++;
            } else {
                awayWins++;
            }
        }
    }
});

console.log(`--- NEW ROTATION STATS ---`);
console.log(`Total Matches Played (by new players): ${totalNewMatches}`);
console.log(`Draws: ${drawMatches} (${((drawMatches/totalNewMatches)*100).toFixed(1)}%)`);
console.log(`Home Wins: ${homeWins}`);
console.log(`Away Wins: ${awayWins}`);
