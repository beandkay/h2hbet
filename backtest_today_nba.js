const fs = require('fs');

let matchesYesterday = [];
try { matchesYesterday = JSON.parse(fs.readFileSync('nba_api_yesterday.json', 'utf8')); } catch (e) {}
const matchesToday = JSON.parse(fs.readFileSync('nba_api_latest.json', 'utf8'));
let matchesTomorrow = [];
try { matchesTomorrow = JSON.parse(fs.readFileSync('nba_api_tomorrow.json', 'utf8')); } catch (e) {}
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
let totalLeaguePoints = 0;

function initPlayer(name) {
    if (!playerStats[name]) {
        playerStats[name] = {
            matches: 0, wins: 0, draws: 0, losses: 0, pointsScored: 0, pointsConceded: 0, streak: []
        };
    }
}

endedMatches.forEach(m => {
    totalLeagueMatches++;
    totalLeaguePoints += (m.teamAScore + m.teamBScore);
});
const leagueAvgPointsPerTeam = totalLeagueMatches > 0 ? (totalLeaguePoints / (totalLeagueMatches * 2)) : 52.0;

let evaluatedMatches = 0;
let correctPredictions = 0;
let incorrectPredictions = 0;
let correctDnb = 0;
let incorrectDnb = 0;
let pushDnb = 0;
let totalOU = 0;
let correctOU = 0;

const winLossBetSize = 20;
const dnbBetSize = 10;
const ouBetSize = 10;
const winOdds = 1.5;
const dnbOdds = 1.5;
const ouOdds = 1.85;
let winLossWagered = 0;
let winLossReturned = 0;
let dnbWagered = 0;
let dnbReturned = 0;
let ouWagered = 0;
let ouReturned = 0;

endedMatches.forEach(m => {
    const home = m.participantAName;
    const away = m.participantBName;
    const homeScore = m.teamAScore;
    const awayScore = m.teamBScore;
    
    initPlayer(home);
    initPlayer(away);
    
    const sHome = playerStats[home];
    const sAway = playerStats[away];
    
    // Evaluate only if both have played at least 3 matches today to establish base stats
    if (sHome.matches >= 3 && sAway.matches >= 3) {
        const homeAvgScored = sHome.pointsScored / sHome.matches;
        const homeAvgConceded = sHome.pointsConceded / sHome.matches;
        const awayAvgScored = sAway.pointsScored / sAway.matches;
        const awayAvgConceded = sAway.pointsConceded / sAway.matches;
        
        let homeXG = (homeAvgScored + awayAvgConceded) / 2;
        let awayXG = (awayAvgScored + homeAvgConceded) / 2;
        
        const calcPoints = (form) => form.reduce((acc, val) => acc + (val === 'W' ? 3 : val === 'D' ? 1 : 0), 0);
        homeXG += calcPoints(sHome.streak.slice(-5)) * 1.5;
        awayXG += calcPoints(sAway.streak.slice(-5)) * 1.5;
        
        const diff = homeXG - awayXG;
        let prediction = "";
        let betType = "";
        
        if (diff > 10.0) { prediction = "HOME"; betType = "WIN"; }
        else if (diff < -10.0) { prediction = "AWAY"; betType = "WIN"; }
        else if (diff > 3.0) { prediction = "HOME"; betType = "DNB"; }
        else if (diff < -3.0) { prediction = "AWAY"; betType = "DNB"; }
        else { prediction = "DRAW"; betType = "SKIP"; }
        
        let actual = "";
        if (homeScore > awayScore) actual = "HOME";
        else if (homeScore < awayScore) actual = "AWAY";
        else actual = "DRAW";
        
        if (betType !== "SKIP") {
            evaluatedMatches++;
            if (betType === "WIN") {
                winLossWagered += winLossBetSize;
                if (prediction === actual) {
                    correctPredictions++;
                    winLossReturned += (winLossBetSize * winOdds);
                } else {
                    incorrectPredictions++;
                }
            } else if (betType === "DNB") {
                dnbWagered += dnbBetSize;
                if (prediction === actual) {
                    correctDnb++;
                    dnbReturned += (dnbBetSize * dnbOdds);
                } else if (actual === "DRAW") {
                    pushDnb++;
                    dnbReturned += dnbBetSize;
                } else {
                    incorrectDnb++;
                }
            }
        }
        
        const totalXG = homeXG + awayXG;
        const baseline = leagueAvgPointsPerTeam * 2;
        const predOU = totalXG > baseline + 5 ? "OVER" : totalXG < baseline - 5 ? "UNDER" : "SKIP";
        const actualTotal = homeScore + awayScore;
        const actualOU = actualTotal > baseline ? "OVER" : "UNDER";
        
        if (predOU !== "SKIP") {
            totalOU++;
            ouWagered += ouBetSize;
            if (predOU === actualOU) {
                correctOU++;
                ouReturned += (ouBetSize * ouOdds);
            }
        }
    }
    
    sHome.matches++;
    sAway.matches++;
    sHome.pointsScored += homeScore;
    sHome.pointsConceded += awayScore;
    sAway.pointsScored += awayScore;
    sAway.pointsConceded += homeScore;
    
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

const accuracy = (correctPredictions + incorrectPredictions) > 0 ? ((correctPredictions / (correctPredictions + incorrectPredictions)) * 100).toFixed(2) : 0;
const dnbAccuracy = (correctDnb + incorrectDnb) > 0 ? ((correctDnb / (correctDnb + incorrectDnb)) * 100).toFixed(2) : 0;
const ouAccuracy = totalOU > 0 ? ((correctOU / totalOU) * 100).toFixed(2) : 0;

const totalWagered = winLossWagered + dnbWagered + ouWagered;
const totalReturned = winLossReturned + dnbReturned + ouReturned;
const profit = totalReturned - totalWagered;

console.log(`--- BACKTEST: TODAY'S RESULTS (Moneyline Strategy) ---`);
console.log(`Total Matches Played Today: ${totalLeagueMatches}`);
console.log(`Decisive Matches Evaluated: ${evaluatedMatches}`);
console.log(`\n-- Moneyline (Massive Edge) --`);
console.log(`Correct: ${correctPredictions} | Incorrect: ${incorrectPredictions} | Accuracy: ${accuracy}%`);
console.log(`Wagered: $${winLossWagered} | Returned: $${winLossReturned}`);
console.log(`\n-- Moneyline (Slight Edge) --`);
console.log(`Correct: ${correctDnb} | Incorrect: ${incorrectDnb} | Pushed: ${pushDnb} | Accuracy: ${dnbAccuracy}% (Excl. Pushes)`);
console.log(`Wagered: $${dnbWagered} | Returned: $${dnbReturned}`);
console.log(`\n-- Over/Under Totals Bets --`);
console.log(`Correct: ${correctOU} | Incorrect: ${totalOU - correctOU} | Accuracy: ${ouAccuracy}%`);
console.log(`Wagered: $${ouWagered} | Returned: $${ouReturned}`);
console.log(`\n-- Overall Totals --`);
console.log(`Total Wagered: $${totalWagered}`);
console.log(`Total Returned: $${totalReturned}`);
console.log(`Profit/Loss: $${profit.toFixed(2)}`);
