const fs = require('fs');
const path = require('path');
const { calculateStatistics } = require('./src/statistics');
const { calculateH2H } = require('./src/h2h_engine');
const { generatePredictions } = require('./src/predictor');

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

let totalLeagueMatches = endedMatches.length;

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

endedMatches.forEach((m, idx) => {
    // Reconstruct the state of the league exactly BEFORE this match kicked off
    const historicalMatches = endedMatches.slice(0, idx);
    const { playerStats } = calculateStatistics(historicalMatches);
    const { h2hStats } = calculateH2H(historicalMatches);

    // Deep clone the match object so prediction properties don't bleed out
    const matchData = JSON.parse(JSON.stringify(m));

    // Inject predictions into this single match using the current player stats and H2H state
    const { matches: predicted } = generatePredictions([matchData], playerStats, h2hStats);
    const pMatch = predicted[0];

    const home = pMatch.participantAName;
    const away = pMatch.participantBName;
    const homeScore = pMatch.teamAScore;
    const awayScore = pMatch.teamBScore;

    // --- Winner Prediction Evaluation ---
    const computedPrediction = pMatch.computedPrediction || "";
    let actualWinner = "";
    if (homeScore > awayScore) actualWinner = home;
    else if (homeScore < awayScore) actualWinner = away;
    else actualWinner = "DRAW";

    if (computedPrediction && !computedPrediction.includes('SKIP')) {
        evaluatedMatches++;
        
        // Use regex to extract the name, e.g., "**ALIBI wins (Draw No Bet)** [Uncertainty: 20/100]"
        const predictedWinnerMatch = computedPrediction.match(/\*\*(.+?) wins/);
        const predictedWinner = predictedWinnerMatch ? predictedWinnerMatch[1] : (computedPrediction.includes(home) ? home : away);
        
        const absDiff = pMatch.computedXgDiff || 0;
        
        let actualBetSize = dnbBaseBetSize;
        if (absDiff > 1.0) actualBetSize = dnbBaseBetSize * 2;
        else if (absDiff > 0.5) actualBetSize = dnbBaseBetSize * 1.5;

        const dynamicOdds = getDynamicDNBOdds(absDiff);

        dnbWagered += actualBetSize;
        if (predictedWinner === actualWinner) {
            correctDnb++;
            dnbReturned += (actualBetSize * dynamicOdds);
        } else if (actualWinner === "DRAW") {
            pushDnb++;
            dnbReturned += actualBetSize;
        } else {
            incorrectDnb++;
        }
    }

    // --- O/U Prediction Evaluation ---
    const ouPrediction = pMatch.ouPrediction || "";
    if (ouPrediction && !ouPrediction.includes('SKIP')) {
        totalOU++;
        const actualTotal = homeScore + awayScore;
        const actualOU = actualTotal > 2.5 ? "OVER" : "UNDER";
        const playOU = ouPrediction.includes('OVER') ? "OVER" : "UNDER";
        
        ouWagered += ouBetSize;
        if (actualOU === playOU) {
            correctOU++;
            const totalXG = pMatch.computedTotalXG || 0;
            const dynamicOUOdds = playOU === "UNDER" ? 1.50 : getDynamicOUOdds(totalXG);
            ouReturned += (ouBetSize * dynamicOUOdds);
        }
    }
});

const dnbAccuracy = (correctDnb + incorrectDnb) > 0 ? ((correctDnb / (correctDnb + incorrectDnb)) * 100).toFixed(2) : 0;
const ouAccuracy = totalOU > 0 ? ((correctOU / totalOU) * 100).toFixed(2) : 0;

const totalWagered = dnbWagered + ouWagered;
const totalReturned = dnbReturned + ouReturned;
const profit = totalReturned - totalWagered;

const output = `--- BACKTEST: TODAY'S RESULTS (Max Profit Strategy) ---
Total Matches Played Today: ${totalLeagueMatches}
Decisive Matches Evaluated: ${evaluatedMatches}

-- Draw No Bet (Tiered Sizing) --
Correct: ${correctDnb} | Incorrect: ${incorrectDnb} | Pushed: ${pushDnb} | Accuracy: ${dnbAccuracy}% (Excl. Pushes)
Wagered: $${dnbWagered} | Returned: $${dnbReturned} | Profit: $${(dnbReturned - dnbWagered).toFixed(2)}

-- Totals (Over/Under 2.5) --
Correct: ${correctOU} | Incorrect: ${totalOU - correctOU} | Accuracy: ${ouAccuracy}%
Wagered: $${ouWagered} | Returned: $${ouReturned} | Profit: $${(ouReturned - ouWagered).toFixed(2)}

-- Overall Totals --
Total Wagered: $${totalWagered}
Total Returned: $${totalReturned}
Profit/Loss: $${profit.toFixed(2)}`;

console.log(output);

try {
    const dashboardFile = path.join(__dirname, 'dashboard_data.json');
    if (fs.existsSync(dashboardFile)) {
        const dashboard = JSON.parse(fs.readFileSync(dashboardFile, 'utf8'));
        dashboard.backtestOutput = output;
        fs.writeFileSync(dashboardFile, JSON.stringify(dashboard, null, 2));
    }
} catch (e) {
    console.error("Could not write backtest output to dashboard_data.json:", e.message);
}
