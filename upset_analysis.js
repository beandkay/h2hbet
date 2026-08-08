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

let totalUpsets = 0;
let streakCounts = {};
let rotationHourCounts = {};
let matchesPlayedCounts = {};
let h2hUpsets = {};
let totalExpectedWins = 0;

Object.keys(blocks).sort().forEach(blockName => {
    const blockMatches = blocks[blockName];
    const playerStats = {};
    
    function initPlayer(name) {
        if (!playerStats[name]) {
            playerStats[name] = { matches: 0, wins: 0, losses: 0, draws: 0, streak: [] };
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
            const homeWinRate = sHome.wins / sHome.matches;
            const awayWinRate = sAway.wins / sAway.matches;
            
            let favorite = null;
            let underdog = null;
            let favoriteWon = false;
            let underdogWon = false;
            
            // Define a significant mismatch
            if (homeWinRate > 0.60 && awayWinRate < 0.40 && (homeWinRate - awayWinRate) >= 0.30) {
                favorite = { name: home, stats: sHome, isHome: true };
                underdog = { name: away, stats: sAway, isHome: false };
                totalExpectedWins++;
                if (homeScore > awayScore) favoriteWon = true;
                if (homeScore < awayScore) underdogWon = true;
            } else if (awayWinRate > 0.60 && homeWinRate < 0.40 && (awayWinRate - homeWinRate) >= 0.30) {
                favorite = { name: away, stats: sAway, isHome: false };
                underdog = { name: home, stats: sHome, isHome: true };
                totalExpectedWins++;
                if (awayScore > homeScore) favoriteWon = true;
                if (awayScore < homeScore) underdogWon = true;
            }
            
            if (favorite && underdogWon) {
                totalUpsets++;
                
                // Track Streak of favorite before losing
                const favStreakStr = favorite.stats.streak.slice(-3).join('');
                streakCounts[favStreakStr] = (streakCounts[favStreakStr] || 0) + 1;
                
                // Track matches played in rotation by favorite
                const mPlayed = favorite.stats.matches;
                matchesPlayedCounts[mPlayed] = (matchesPlayedCounts[mPlayed] || 0) + 1;
                
                // Track rotation hour (1 to 12)
                const aestDate = new Date(new Date(m.startDate).getTime() + 10 * 60 * 60 * 1000);
                let hourOfRotation = aestDate.getUTCHours();
                if (hourOfRotation >= 4 && hourOfRotation < 16) hourOfRotation = hourOfRotation - 3; // 4am = hour 1
                else if (hourOfRotation >= 16) hourOfRotation = hourOfRotation - 15; // 4pm = hour 1
                else hourOfRotation = hourOfRotation + 9; // past midnight
                
                rotationHourCounts[hourOfRotation] = (rotationHourCounts[hourOfRotation] || 0) + 1;
                
                // Track H2H kryptonite
                const pairKey = [favorite.name, underdog.name].sort().join(' vs ');
                h2hUpsets[pairKey] = (h2hUpsets[pairKey] || 0) + 1;
            }
        }
        
        sHome.matches++;
        sAway.matches++;
        
        if (homeScore > awayScore) {
            sHome.wins++;
            sAway.losses++;
            sHome.streak.push('W');
            sAway.streak.push('L');
        } else if (homeScore < awayScore) {
            sAway.wins++;
            sHome.losses++;
            sAway.streak.push('W');
            sHome.streak.push('L');
        } else {
            sHome.draws++;
            sAway.draws++;
            sHome.streak.push('D');
            sAway.streak.push('D');
        }
    });
});

console.log(`Total Matches with a Heavy Favorite (>60% WR vs <40% WR, diff >30%): ${totalExpectedWins}`);
console.log(`Total Upsets (Heavy Favorite Lost): ${totalUpsets}`);
console.log(`Upset Rate: ${((totalUpsets / totalExpectedWins) * 100).toFixed(2)}%`);

console.log(`\n-- Favorite's Streak Before Getting Upset (Last 3) --`);
Object.keys(streakCounts).sort((a,b) => streakCounts[b] - streakCounts[a]).slice(0, 10).forEach(k => console.log(`${k}: ${streakCounts[k]} times`));

console.log(`\n-- Matches Played by Favorite Before Getting Upset --`);
Object.keys(matchesPlayedCounts).sort((a,b) => parseInt(a) - parseInt(b)).forEach(k => console.log(`${k} matches played: ${matchesPlayedCounts[k]} times`));

console.log(`\n-- Hour of Rotation (1-12) --`);
Object.keys(rotationHourCounts).sort((a,b) => parseInt(a) - parseInt(b)).forEach(k => console.log(`Hour ${k}: ${rotationHourCounts[k]} upsets`));

console.log(`\n-- Top 10 Kryptonite Matchups (Underdog frequently beating Favorite) --`);
Object.keys(h2hUpsets).sort((a,b) => h2hUpsets[b] - h2hUpsets[a]).slice(0, 10).forEach(k => console.log(`${k}: ${h2hUpsets[k]} upsets`));
