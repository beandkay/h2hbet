const fs = require('fs');
const { calculateStatistics } = require('./statistics');
const { calculateH2H } = require('./h2h_engine');
const { generatePredictions } = require('./predictor');
const { runAutoTuner } = require('./auto_tuner');

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

function runHistoricalBacktest(matches) {
    let histMatches = [];
    try {
        const dataRaw = fs.readFileSync('historical_fifa.json', 'utf8');
        const data = JSON.parse(dataRaw);
        histMatches = data.matches || data;
    } catch(e) {
        console.log("No historical_fifa.json found. Skipping historical backtest.");
        return {};
    }

    const blocks = groupMatchesByRotation(histMatches);
    const blockKeys = Object.keys(blocks).sort();
    
    let ouStats = {};
    let totalMatches = 0;
    let totalGoals = 0;

    blockKeys.forEach((key, index) => {
        const pastBlocks = blockKeys.slice(0, index);
        const pastMatches = [];
        pastBlocks.forEach(k => pastMatches.push(...blocks[k]));

        if (pastMatches.length < 50) return;

        const leagueAvgPerTeam = 1.5;
        const { playerStats } = calculateStatistics(pastMatches, leagueAvgPerTeam);
        const { h2hStats } = calculateH2H(pastMatches);
        
        const anchorHistory = pastMatches.slice(-200);
        const anchorStats = calculateStatistics(anchorHistory, leagueAvgPerTeam);
        const anchorH2h = calculateH2H(anchorHistory);
        const tunedOpts = runAutoTuner(anchorHistory, anchorStats.playerStats, anchorH2h.h2hStats);
        
        const currentRotationMatches = blocks[key];
        
        const { matches: predicted } = generatePredictions(
            JSON.parse(JSON.stringify(currentRotationMatches)), 
            playerStats, 
            h2hStats,
            { historicalOUStats: ouStats, ...tunedOpts }
        );

        predicted.forEach(pMatch => {
            const h = pMatch.participantAName;
            const a = pMatch.participantBName;
            const hs = pMatch.teamAScore;
            const as = pMatch.teamBScore;
            
            if (hs === undefined || as === undefined) return;
            
            if (pMatch.isOUPick && pMatch.ouPrediction) {
                let pickedOver = pMatch.ouPrediction.includes("OVER 2.5");
                let pickedUnder = pMatch.ouPrediction.includes("UNDER 2.5");
                
                if (!ouStats[h]) ouStats[h] = { bets: 0, correct: 0 };
                if (!ouStats[a]) ouStats[a] = { bets: 0, correct: 0 };

                if (pickedOver || pickedUnder) {
                    ouStats[h].bets++;
                    ouStats[a].bets++;

                    const totalGoals = hs + as;
                    let won = false;
                    
                    if (pickedOver && totalGoals > 2.5) won = true;
                    if (pickedUnder && totalGoals < 2.5) won = true;

                    if (won) {
                        ouStats[h].correct++;
                        ouStats[a].correct++;
                    }
                }
            }
        });
    });

    try {
        fs.writeFileSync('historical_ou_stats.json', JSON.stringify(ouStats, null, 2));
    } catch(e) {}
    
    return ouStats;
}

function runTodayBacktest(allMatches, historicalOUStats, engineOpts = {}) {
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
    
    const rotStart = new Date(startAEST.getTime() - 10 * 60 * 60 * 1000);
    const rotEnd = new Date(endAEST.getTime() - 10 * 60 * 60 * 1000);

    const currentRotationMatches = allMatches
        .filter(m => {
            const matchTime = new Date(m.startDate);
            return matchTime >= rotStart && matchTime < rotEnd;
        })
        .sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
        
    const endedMatches = currentRotationMatches.filter(m => m.matchStatus === 'MATCH_ENDED' && !m.isCancelled);

    let totalMatches = endedMatches.length;
    let dnbCorrect = 0, dnbIncorrect = 0, dnbPushed = 0;
    let totalOU = 0, correctOU = 0;
    let totalWagered = 0, totalReturned = 0;
    let ouWagered = 0, ouReturned = 0;

    let evalCount = 0;
    
    // Create an isolated tracker for today's rotation ONLY
    let currentRotationOUStats = {};

    // Simulate match by match in today's rotation
    endedMatches.forEach((m, idx) => {
        const baseMatches = allMatches.filter(x => new Date(x.startDate) < new Date(m.startDate) && x.matchStatus === 'MATCH_ENDED' && !x.isCancelled);
        
        const totalGoals = baseMatches.reduce((sum, m) => sum + m.teamAScore + m.teamBScore, 0);
        const leagueAvgGoalsPerTeam = baseMatches.length > 0 ? (totalGoals / (baseMatches.length * 2)) : 1.5;

        const { playerStats } = calculateStatistics(baseMatches, leagueAvgGoalsPerTeam);
        const { h2hStats } = calculateH2H(baseMatches);
        
        const todaySoFar = endedMatches.slice(0, idx);
        let dynamicOpts = { ...engineOpts };
        if (todaySoFar.length > 0) {
            const thresholds = runAutoTuner(todaySoFar, playerStats, h2hStats);
            dynamicOpts = { ...dynamicOpts, ...thresholds };
        }
        
        const { matches: predicted } = generatePredictions(
            [JSON.parse(JSON.stringify(m))], 
            playerStats, 
            h2hStats,
            { historicalOUStats: currentRotationOUStats, ...dynamicOpts }
        );

        const pMatch = predicted[0];
        const h = pMatch.participantAName;
        const a = pMatch.participantBName;
        const hs = pMatch.teamAScore;
        const as = pMatch.teamBScore;

        if (pMatch.computedPrediction && !pMatch.computedPrediction.includes("SKIP")) {
            evalCount++;
            let pick = null;
            if (pMatch.computedPrediction.includes("**DRAW**")) pick = "DRAW";
            else {
                const matchPick = pMatch.computedPrediction.match(/\*\*(.+?) wins/);
                if (matchPick) pick = matchPick[1];
            }
            
            if (pick) {
                let stake = 5;
                totalWagered += stake;
                
                if (pick === "DRAW") {
                    if (hs === as) {
                        dnbCorrect++;
                        totalReturned += (stake * 3.0);
                    } else dnbIncorrect++;
                } else {
                    if (hs === as) {
                        dnbPushed++;
                        totalReturned += stake;
                    } else if ((pick === h && hs > as) || (pick === a && as > hs)) {
                        dnbCorrect++;
                        totalReturned += (stake * 1.83);
                    } else dnbIncorrect++;
                }
            }
        }

        if (pMatch.isOUPick && pMatch.ouPrediction) {
            let pickedOver = pMatch.ouPrediction.includes("OVER 2.5");
            let pickedUnder = pMatch.ouPrediction.includes("UNDER 2.5");
            
            if (pickedOver || pickedUnder) {
                totalOU++;
                let stake = 5;
                ouWagered += stake;
                
                if (!currentRotationOUStats[h]) currentRotationOUStats[h] = { bets: 0, correct: 0 };
                if (!currentRotationOUStats[a]) currentRotationOUStats[a] = { bets: 0, correct: 0 };
                
                currentRotationOUStats[h].bets++;
                currentRotationOUStats[a].bets++;

                const tGoals = hs + as;
                let won = false;
                
                if (pickedOver && tGoals > 2.5) won = true;
                if (pickedUnder && tGoals < 2.5) won = true;

                if (won) {
                    correctOU++;
                    ouReturned += (stake * 1.83);
                    currentRotationOUStats[h].correct++;
                    currentRotationOUStats[a].correct++;
                }
            }
        }
    });

    let report = `--- BACKTEST: TODAY'S RESULTS (Max Profit Strategy) ---\n`;
    report += `Total Matches Played Today: ${totalMatches}\n`;
    report += `Decisive Matches Evaluated: ${evalCount}\n\n`;
    
    report += `-- Draw No Bet (Tiered Sizing) --\n`;
    report += `Correct: ${dnbCorrect} | Incorrect: ${dnbIncorrect} | Pushed: ${dnbPushed} | Accuracy: ${((dnbCorrect/(dnbCorrect+dnbIncorrect)) * 100 || 0).toFixed(2)}% (Excl. Pushes)\n`;
    report += `Wagered: $${totalWagered.toFixed(2)} | Returned: $${totalReturned.toFixed(2)} | Profit: $${(totalReturned - totalWagered).toFixed(2)}\n\n`;

    report += `-- Totals (Over/Under 2.5) --\n`;
    report += `Correct: ${correctOU} | Incorrect: ${totalOU - correctOU} | Accuracy: ${((correctOU/totalOU) * 100 || 0).toFixed(2)}%\n`;
    report += `Wagered: $${ouWagered.toFixed(2)} | Returned: $${ouReturned.toFixed(2)} | Profit: $${(ouReturned - ouWagered).toFixed(2)}\n\n`;

    report += `-- Overall Totals --\n`;
    report += `Total Wagered: $${(totalWagered + ouWagered).toFixed(2)}\n`;
    report += `Total Returned: $${(totalReturned + ouReturned).toFixed(2)}\n`;
    report += `Profit/Loss: $${(totalReturned - totalWagered + ouReturned - ouWagered).toFixed(2)}\n`;

    return { report, currentRotationOUStats };
}

module.exports = { runHistoricalBacktest, runTodayBacktest };
