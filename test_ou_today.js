const fs = require('fs');

let matchesYesterday = [];
try { matchesYesterday = JSON.parse(fs.readFileSync('api_data_yesterday.json', 'utf8')); } catch (e) {}
const matchesToday = JSON.parse(fs.readFileSync('api_data_latest.json', 'utf8'));
let matchesTomorrow = [];
try { matchesTomorrow = JSON.parse(fs.readFileSync('api_data_tomorrow.json', 'utf8')); } catch (e) {}
const matches = matchesYesterday.concat(matchesToday).concat(matchesTomorrow);

function getRotationBounds() {
    const now = new Date();
    const aest = new Date(now.getTime() + 10 * 60 * 60 * 1000);
    const hour = aest.getUTCHours();
    
    const startAEST = new Date(aest);
    const endAEST = new Date(aest);
    
    startAEST.setUTCMinutes(0, 0, 0);
    endAEST.setUTCMinutes(0, 0, 0);
    
    if (hour >= 4 && hour < 16) {
        startAEST.setUTCHours(4);
        endAEST.setUTCHours(16);
    } else if (hour >= 16) {
        startAEST.setUTCHours(16);
        endAEST.setUTCHours(4);
        endAEST.setUTCDate(endAEST.getUTCDate() + 1);
    } else {
        startAEST.setUTCHours(16);
        startAEST.setUTCDate(startAEST.getUTCDate() - 1);
        endAEST.setUTCHours(4);
    }
    
    return {
        startUTC: new Date(startAEST.getTime() - 10 * 60 * 60 * 1000),
        endUTC: new Date(endAEST.getTime() - 10 * 60 * 60 * 1000)
    };
}

const bounds = getRotationBounds();

const currentRotation = matches.filter(m => {
    const start = new Date(m.startDate);
    return start >= bounds.startUTC && start < bounds.endUTC && m.matchStatus === 'MATCH_ENDED' && !m.isCancelled;
}).sort((a, b) => new Date(a.startDate) - new Date(b.startDate));

const thresholds = [3.0, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 4.0];

console.log(`Evaluating ${currentRotation.length} matches from today's rotation...`);

thresholds.forEach(aggThresh => {
    let ou25 = { wagered: 0, returned: 0, correct: 0, incorrect: 0 };
    
    const playerStats = {};
    function initPlayer(name) {
        if (!playerStats[name]) {
            playerStats[name] = { matches: 0, wins: 0, draws: 0, losses: 0, goalsScored: 0, goalsConceded: 0, streak: [] };
        }
    }
    
    currentRotation.forEach(m => {
        const home = m.participantAName;
        const away = m.participantBName;
        initPlayer(home);
        initPlayer(away);
        
        const sHome = playerStats[home];
        const sAway = playerStats[away];
        
        // Wait 5 matches
        if (sHome.matches >= 5 && sAway.matches >= 5) {
            const homeAvgScored = sHome.goalsScored / sHome.matches;
            const homeAvgConceded = sHome.goalsConceded / sHome.matches;
            const awayAvgScored = sAway.goalsScored / sAway.matches;
            const awayAvgConceded = sAway.goalsConceded / sAway.matches;
            
            const homeWinRate = sHome.wins / sHome.matches;
            const awayWinRate = sAway.wins / sAway.matches;
            
            const hStyle = (homeAvgScored + homeAvgConceded) > aggThresh ? 'Aggressive' : 'Defensive';
            const aStyle = (awayAvgScored + awayAvgConceded) > aggThresh ? 'Aggressive' : 'Defensive';
            
            const bothAggressive = hStyle === 'Aggressive' && aStyle === 'Aggressive';
            const bothBottom = homeWinRate <= 0.10 && awayWinRate <= 0.10;
            
            if (bothAggressive || bothBottom) {
                ou25.wagered += 10;
                const totalGoals = m.teamAScore + m.teamBScore;
                if (totalGoals > 2.5) {
                    ou25.correct++;
                    // Updated odds to 1.50 per user request
                    ou25.returned += (10 * 1.50);
                } else {
                    ou25.incorrect++;
                }
            }
        }
        
        // Update stats
        sHome.matches++; sAway.matches++;
        sHome.goalsScored += m.teamAScore; sHome.goalsConceded += m.teamBScore;
        sAway.goalsScored += m.teamBScore; sAway.goalsConceded += m.teamAScore;
        if (m.teamAScore > m.teamBScore) {
            sHome.wins++; sAway.losses++;
            sHome.streak.push('W'); sAway.streak.push('L');
        } else if (m.teamAScore < m.teamBScore) {
            sHome.losses++; sAway.wins++;
            sHome.streak.push('L'); sAway.streak.push('W');
        } else {
            sHome.draws++; sAway.draws++;
            sHome.streak.push('D'); sAway.streak.push('D');
        }
    });
    
    const profit = ou25.returned - ou25.wagered;
    console.log(`aggAvgGoals: ${aggThresh.toFixed(1)} => Profit: $${profit.toFixed(2)} (Hits: ${ou25.correct}, Misses: ${ou25.incorrect})`);
    if (aggThresh === 3.5) {
        let totalOver25 = 0;
        let skippedDueToStats = 0;
        let skippedDueToStatsOver = 0;
        let skippedDueToThreshold = 0;
        let skippedDueToThresholdOver = 0;
        
        const tempStats = {};
        function initTPlayer(name) { if (!tempStats[name]) tempStats[name] = { matches: 0 }; }
        
        currentRotation.forEach(m => {
            const h = m.participantAName;
            const a = m.participantBName;
            initTPlayer(h); initTPlayer(a);
            
            const isOver = (m.teamAScore + m.teamBScore) > 2.5;
            if (isOver) totalOver25++;
            
            if (tempStats[h].matches < 5 || tempStats[a].matches < 5) {
                skippedDueToStats++;
                if (isOver) skippedDueToStatsOver++;
            } else {
                // If it reached here but wasn't picked, it failed the threshold.
                // We know it only picked 4 matches.
                // Let's accurately re-simulate if it was picked.
                // Actually, rather than fully re-simulating, we can just say if it's not one of the ones we hit/missed...
                // But the loop is already counting correctly above!
            }
            tempStats[h].matches++; tempStats[a].matches++;
        });
        
        console.log(`\n--- ANALYSIS FOR THRESHOLD 3.5 ---`);
        console.log(`Total Matches in Rotation: ${currentRotation.length}`);
        console.log(`Total Matches Actually Over 2.5: ${totalOver25} (${((totalOver25/currentRotation.length)*100).toFixed(1)}%)`);
        console.log(`\nWhy did we only pick 4 matches?`);
        console.log(`1. Matches skipped because players hadn't played 5 games yet: ${skippedDueToStats}`);
        console.log(`   (Of those skipped, ${skippedDueToStatsOver} went over 2.5)`);
        console.log(`2. Matches evaluated (players had 5+ games): ${currentRotation.length - skippedDueToStats}`);
        
        // We know we evaluated (currentRotation.length - skippedDueToStats) matches.
        const evaluated = currentRotation.length - skippedDueToStats;
        const evaluatedOver = totalOver25 - skippedDueToStatsOver;
        const picked = ou25.correct + ou25.incorrect;
        console.log(`   (Of those evaluated, ${evaluatedOver} went over 2.5)`);
        console.log(`3. Matches that failed the strict >3.5 threshold: ${evaluated - picked}`);
        console.log(`   (Of those rejected, ${evaluatedOver - ou25.correct} went over 2.5)`);
        console.log(`4. Matches that PASSED the threshold and we bet on: ${picked}`);
        console.log(`   (Of those picked, ${ou25.correct} went over 2.5)`);
    }
});
