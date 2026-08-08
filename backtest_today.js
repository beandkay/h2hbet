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
        start: new Date(startAEST.getTime() - 10 * 60 * 60 * 1000),
        end: new Date(endAEST.getTime() - 10 * 60 * 60 * 1000)
    };
}

const { start: rotStart, end: rotEnd } = getRotationBounds();

const endedMatches = matches
    .filter(m => m.matchStatus === 'MATCH_ENDED' && !m.isCancelled)
    .filter(m => {
        const matchTime = new Date(m.startDate);
        return matchTime >= rotStart && matchTime < rotEnd;
    })
    .sort((a, b) => new Date(a.startDate) - new Date(b.startDate));

const playerStats = {};

let totalLeagueMatches = 0;
let totalLeagueGoals = 0;

function initPlayer(name) {
    if (!playerStats[name]) {
        playerStats[name] = {
            matches: 0, wins: 0, draws: 0, losses: 0, goalsScored: 0, goalsConceded: 0, streak: []
        };
    }
}

endedMatches.forEach(m => {
    totalLeagueMatches++;
    totalLeagueGoals += (m.teamAScore + m.teamBScore);
});
const leagueAvgGoalsPerTeam = totalLeagueMatches > 0 ? (totalLeagueGoals / (totalLeagueMatches * 2)) : 1.5;

let evaluatedMatches = 0;
let correctDnb = 0;
let incorrectDnb = 0;
let pushDnb = 0;
let totalOU = 0;
let correctOU = 0;

const dnbBaseBetSize = 10;
const ouBetSize = 10;
let dnbWagered = 0;
let dnbReturned = 0;
let ouWagered = 0;
let ouReturned = 0;

function getDynamicDNBOdds(absDiff) {
    if (absDiff > 1.5) return 1.35;
    if (absDiff > 1.0) return 1.40;
    if (absDiff > 0.75) return 1.45;
    if (absDiff > 0.5) return 1.60;
    if (absDiff > 0.3) return 1.75;
    return 1.85;
}

function getDynamicOUOdds(totalXG) {
    if (totalXG > 4.5) return 1.35;
    if (totalXG > 4.0) return 1.45;
    if (totalXG > 3.5) return 1.60;
    if (totalXG > 3.0) return 1.75;
    return 1.85;
}

endedMatches.forEach(m => {
    const home = m.participantAName;
    const away = m.participantBName;
    const homeScore = m.teamAScore;
    const awayScore = m.teamBScore;
    
    initPlayer(home);
    initPlayer(away);
    
    const sHome = playerStats[home];
    const sAway = playerStats[away];
    
    // Evaluate only if both have played at least 5 matches today to establish base stats (Fix #5)
    if (sHome.matches >= 5 && sAway.matches >= 5) {
        const homeAvgScored = sHome.goalsScored / sHome.matches;
        const homeAvgConceded = sHome.goalsConceded / sHome.matches;
        const awayAvgScored = sAway.goalsScored / sAway.matches;
        const awayAvgConceded = sAway.goalsConceded / sAway.matches;
        
        let homeXG = (homeAvgScored + awayAvgConceded) / 2;
        let awayXG = (awayAvgScored + homeAvgConceded) / 2;
        
        const calcPPM = (stats) => {
            if (stats.matches === 0) return 0;
            return ((stats.wins * 3) + (stats.draws * 1)) / stats.matches;
        };
        homeXG += calcPPM(sHome) * 0.25;
        awayXG += calcPPM(sAway) * 0.25;
        
        const diff = homeXG - awayXG;
        const homeWinRate = sHome.wins / sHome.matches;
        const awayWinRate = sAway.wins / sAway.matches;
        
        const aestDate = new Date(new Date(m.startDate).getTime() + 10 * 60 * 60 * 1000);
        let hourOfRotation = aestDate.getUTCHours();
        if (hourOfRotation >= 4 && hourOfRotation < 16) hourOfRotation = hourOfRotation - 3;
        else if (hourOfRotation >= 16) hourOfRotation = hourOfRotation - 15;
        else hourOfRotation = hourOfRotation + 9;
        
        const kryptoniteSet = new Set([
            "DEZZY vs FRANCHISE", "ALIBI vs VAPOR", "MAGICIAN vs VIRUS",
            "RIFT vs RIVAL", "ATLAS vs RIFT", "LAVA vs SPARTAN",
            "DECIMATOR vs RIVAL", "BULLFROG vs DART", "FRANCHISE vs LAVA", "MYSTERY vs VENUS"
        ]);
        const pairKey = [home, away].sort().join(' vs ');
        const isKryptonite = kryptoniteSet.has(pairKey);
        
        const hStyle = (homeAvgScored + homeAvgConceded) > 3.0 ? 'Aggressive' : 'Defensive';
        const aStyle = (awayAvgScored + awayAvgConceded) > 3.0 ? 'Aggressive' : 'Defensive';
        const bothAggressive = hStyle === 'Aggressive' && aStyle === 'Aggressive';
        const bothDefensive = hStyle === 'Defensive' && aStyle === 'Defensive';
        const atLeastOneAgg = hStyle === 'Aggressive' || aStyle === 'Aggressive';

        // Winner prediction (DNB Only, Fix #1)
        let prediction = "";
        let absDiff = Math.abs(diff);
        let minDiff = 0.20;
        
        // Fix #2: Aggressive vs Aggressive requires a larger edge
        if (bothAggressive) {
            minDiff = 0.50;
        }

        if (diff > minDiff) prediction = "HOME";
        else if (diff < -minDiff) prediction = "AWAY";

        let actual = "";
        if (homeScore > awayScore) actual = "HOME";
        else if (homeScore < awayScore) actual = "AWAY";
        else actual = "DRAW";

        if (prediction !== "") {
            evaluatedMatches++;
            
            // Tiered Bet Sizing
            let actualBetSize = dnbBaseBetSize;
            if (absDiff > 1.0) actualBetSize = dnbBaseBetSize * 2;
            else if (absDiff > 0.5) actualBetSize = dnbBaseBetSize * 1.5;

            const dynamicOdds = getDynamicDNBOdds(absDiff);

            dnbWagered += actualBetSize;
            if (prediction === actual) {
                correctDnb++;
                dnbReturned += (actualBetSize * dynamicOdds);
            } else if (actual === "DRAW") {
                pushDnb++;
                dnbReturned += actualBetSize;
            } else {
                incorrectDnb++;
            }
        }
        
        // O/U 2.5 Prediction (Robust Combo)
        const totalXG = homeXG + awayXG;
        const homeAvgTotal = (sHome.goalsScored / sHome.matches) + (sHome.goalsConceded / sHome.matches);
        const awayAvgTotal = (sAway.goalsScored / sAway.matches) + (sAway.goalsConceded / sAway.matches);
        
        const hAgg = homeAvgTotal > 3.0;
        const aAgg = awayAvgTotal > 3.0;
        const isAggVsAgg = hAgg && aAgg;
        const isBottomTier = sHome.matches >= 3 && sAway.matches >= 3 && (sHome.wins / sHome.matches) <= 0.35 && (sAway.wins / sAway.matches) <= 0.35;
        const isDefVsDef = !hAgg && !aAgg;
        
        let playOU = null;
        if (isAggVsAgg || isBottomTier) {
            playOU = "OVER";
        } else if (isDefVsDef && totalXG < 2.5) {
            playOU = "UNDER";
        }

        if (playOU) {
            totalOU++;
            const actualTotal = homeScore + awayScore;
            const actualOU = actualTotal > 2.5 ? "OVER" : "UNDER";
            
            ouWagered += ouBetSize;
            if (actualOU === playOU) {
                correctOU++;
                const dynamicOUOdds = playOU === "UNDER" ? 1.50 : getDynamicOUOdds(totalXG);
                ouReturned += (ouBetSize * dynamicOUOdds);
            }
        }
    }
    
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

const dnbAccuracy = (correctDnb + incorrectDnb) > 0 ? ((correctDnb / (correctDnb + incorrectDnb)) * 100).toFixed(2) : 0;
const ouAccuracy = totalOU > 0 ? ((correctOU / totalOU) * 100).toFixed(2) : 0;

const totalWagered = dnbWagered + ouWagered;
const totalReturned = dnbReturned + ouReturned;
const profit = totalReturned - totalWagered;

console.log(`--- BACKTEST: TODAY'S RESULTS (Max Profit Strategy) ---`);
console.log(`Total Matches Played Today: ${totalLeagueMatches}`);
console.log(`Decisive Matches Evaluated: ${evaluatedMatches}`);

console.log(`\n-- Draw No Bet (Tiered Sizing) --`);
console.log(`Correct: ${correctDnb} | Incorrect: ${incorrectDnb} | Pushed: ${pushDnb} | Accuracy: ${dnbAccuracy}% (Excl. Pushes)`);
console.log(`Wagered: $${dnbWagered} | Returned: $${dnbReturned} | Profit: $${(dnbReturned - dnbWagered).toFixed(2)}`);

console.log(`\n-- Over 2.5 Goals (Selective) --`);
console.log(`Correct: ${correctOU} | Incorrect: ${totalOU - correctOU} | Accuracy: ${ouAccuracy}%`);
console.log(`Wagered: $${ouWagered} | Returned: $${ouReturned} | Profit: $${(ouReturned - ouWagered).toFixed(2)}`);

console.log(`\n-- Overall Totals --`);
console.log(`Total Wagered: $${totalWagered}`);
console.log(`Total Returned: $${totalReturned}`);
console.log(`Profit/Loss: $${profit.toFixed(2)}`);
