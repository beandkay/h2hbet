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

let totalFavMatches = 0;
let totalFavFailures = 0; // Failure = Draw or Loss

let failureByStreak = {};
let failureByHour = {};
let failureByMatchesPlayed = {};
let failureByRecentGoalDiff = {
    'Negative (<= -2)': 0,
    'Slightly Negative (-1)': 0,
    'Neutral (0)': 0,
    'Positive (1-2)': 0,
    'Very Positive (3+)': 0
};
let failureByRecentDraws = {
    '0 draws in last 3': 0,
    '1 draw in last 3': 0,
    '2+ draws in last 3': 0
};

Object.keys(blocks).sort().forEach(blockName => {
    const blockMatches = blocks[blockName];
    const playerStats = {};
    
    function initPlayer(name) {
        if (!playerStats[name]) {
            playerStats[name] = { matches: 0, wins: 0, losses: 0, draws: 0, streak: [], goals: [], conceded: [] };
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
        
        const analyzePlayer = (playerInfo, isHome) => {
            const stats = playerInfo.stats;
            if (stats.matches >= 3) {
                const winRate = stats.wins / stats.matches;
                if (winRate > 0.60) {
                    totalFavMatches++;
                    
                    const score = isHome ? homeScore : awayScore;
                    const oppScore = isHome ? awayScore : homeScore;
                    const failedToWin = score <= oppScore;
                    
                    if (failedToWin) {
                        totalFavFailures++;
                        
                        // Streak
                        const streakStr = stats.streak.slice(-3).join('');
                        failureByStreak[streakStr] = (failureByStreak[streakStr] || 0) + 1;
                        
                        // Hour
                        const aestDate = new Date(new Date(m.startDate).getTime() + 10 * 60 * 60 * 1000);
                        let hourOfRotation = aestDate.getUTCHours();
                        if (hourOfRotation >= 4 && hourOfRotation < 16) hourOfRotation = hourOfRotation - 3;
                        else if (hourOfRotation >= 16) hourOfRotation = hourOfRotation - 15;
                        else hourOfRotation = hourOfRotation + 9;
                        failureByHour[hourOfRotation] = (failureByHour[hourOfRotation] || 0) + 1;
                        
                        // Matches Played
                        failureByMatchesPlayed[stats.matches] = (failureByMatchesPlayed[stats.matches] || 0) + 1;
                        
                        // Recent Goal Diff (last 3 games)
                        let recentG = 0;
                        let recentC = 0;
                        stats.goals.slice(-3).forEach(g => recentG += g);
                        stats.conceded.slice(-3).forEach(c => recentC += c);
                        const gd = recentG - recentC;
                        
                        if (gd <= -2) failureByRecentGoalDiff['Negative (<= -2)']++;
                        else if (gd === -1) failureByRecentGoalDiff['Slightly Negative (-1)']++;
                        else if (gd === 0) failureByRecentGoalDiff['Neutral (0)']++;
                        else if (gd <= 2) failureByRecentGoalDiff['Positive (1-2)']++;
                        else failureByRecentGoalDiff['Very Positive (3+)']++;
                        
                        // Recent Draws
                        const recentDraws = stats.streak.slice(-3).filter(x => x === 'D').length;
                        if (recentDraws === 0) failureByRecentDraws['0 draws in last 3']++;
                        else if (recentDraws === 1) failureByRecentDraws['1 draw in last 3']++;
                        else failureByRecentDraws['2+ draws in last 3']++;
                    }
                }
            }
        };
        
        analyzePlayer({name: home, stats: sHome}, true);
        analyzePlayer({name: away, stats: sAway}, false);
        
        sHome.matches++;
        sAway.matches++;
        sHome.goals.push(homeScore);
        sHome.conceded.push(awayScore);
        sAway.goals.push(awayScore);
        sAway.conceded.push(homeScore);
        
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

console.log(`Total Matches Played by a Top Player (>60% WR): ${totalFavMatches}`);
console.log(`Total Matches where Top Player Failed to Win (Draw/Loss): ${totalFavFailures}`);
console.log(`Failure Rate: ${((totalFavFailures / totalFavMatches) * 100).toFixed(2)}%\n`);

console.log(`-- Failures by Streak Before Match --`);
Object.keys(failureByStreak).sort((a,b) => failureByStreak[b] - failureByStreak[a]).slice(0, 10).forEach(k => console.log(`${k}: ${failureByStreak[k]}`));

console.log(`\n-- Failures by Shift Hour (Fatigue) --`);
Object.keys(failureByHour).sort((a,b) => parseInt(a) - parseInt(b)).forEach(k => console.log(`Hour ${k}: ${failureByHour[k]}`));

console.log(`\n-- Failures by Recent Goal Difference (Last 3 Matches) --`);
Object.keys(failureByRecentGoalDiff).forEach(k => console.log(`${k}: ${failureByRecentGoalDiff[k]}`));

console.log(`\n-- Failures by Recent Draws --`);
Object.keys(failureByRecentDraws).forEach(k => console.log(`${k}: ${failureByRecentDraws[k]}`));
