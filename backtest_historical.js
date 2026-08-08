const fs = require('fs');

function groupMatchesByRotation(matches) {
    const blocks = {};
    
    matches.forEach(m => {
        if (m.matchStatus !== 'MATCH_ENDED' || m.isCancelled) return;
        
        const utcDate = new Date(m.startDate);
        // AEST is UTC+10
        const aestDate = new Date(utcDate.getTime() + 10 * 60 * 60 * 1000);
        
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
            // Before 4am, belongs to yesterday's PM block
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

function runBacktest(matches, isBasketball) {
    const blocks = groupMatchesByRotation(matches);
    
    let totalMatches = 0;
    let totalGoals = 0;
    
    // First pass to get global average
    matches.forEach(m => {
        if (m.matchStatus === 'MATCH_ENDED' && !m.isCancelled) {
            totalMatches++;
            totalGoals += (m.teamAScore + m.teamBScore);
        }
    });
    
    const leagueAvgPerTeam = totalMatches > 0 ? (totalGoals / (totalMatches * 2)) : (isBasketball ? 52.0 : 1.5);
    const formWeight = isBasketball ? 1.5 : 0.05;
    const massiveEdge = isBasketball ? 10.0 : 1.00;
    const slightEdge = isBasketball ? 3.0 : 0.20;
    
    let overallEval = 0;
    let overallCorrectMassive = 0;
    let overallIncorrectMassive = 0;
    let overallCorrectSlight = 0;
    let overallIncorrectSlight = 0;
    let overallPushSlight = 0;
    let overallTotalOU = 0;
    let overallCorrectOU = 0;
    let overallTotalOU35 = 0;
    let overallCorrectOU35 = 0;
    let overallTotalOU15 = 0;
    let overallCorrectOU15 = 0;
    
    let massiveWagered = 0;
    let massiveReturned = 0;
    let slightWagered = 0;
    let slightReturned = 0;
    let ouWagered = 0;
    let ouReturned = 0;
    let ou35Wagered = 0;
    let ou35Returned = 0;
    let ou15Wagered = 0;
    let ou15Returned = 0;
    
    const massiveBetSize = 20;
    const slightBetSize = 10;
    const ouBetSize = 10;
    
    const winOdds = isBasketball ? 1.83 : 2.0; // Spread odds are 1.83
    const dnbOdds = isBasketball ? 1.83 : 1.85;
    const ouOdds = isBasketball ? 1.83 : 1.85;
    
    // Evaluate block by block
    Object.keys(blocks).sort().forEach(blockName => {
        const blockMatches = blocks[blockName];
        const playerStats = {};
        
        function initPlayer(name) {
            if (!playerStats[name]) {
                playerStats[name] = { matches: 0, wins: 0, draws: 0, losses: 0, scored: 0, conceded: 0, streak: [] };
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
                const homeAvgScored = sHome.scored / sHome.matches;
                const homeAvgConceded = sHome.conceded / sHome.matches;
                const awayAvgScored = sAway.scored / sAway.matches;
                const awayAvgConceded = sAway.conceded / sAway.matches;
                
                const homeRaw = (sHome.scored/sHome.matches + sAway.conceded/sAway.matches)/2;
                const awayRaw = (sAway.scored/sAway.matches + sHome.conceded/sHome.matches)/2;
                
                let homeXG = homeRaw;
                let awayXG = awayRaw;
                
                const calcPoints = (form) => form.reduce((acc, val) => acc + (val === 'W' ? 3 : val === 'D' ? 1 : 0), 0);
                homeXG += calcPoints(sHome.streak.slice(-5)) * formWeight;
                awayXG += calcPoints(sAway.streak.slice(-5)) * formWeight;
                
                const diff = homeXG - awayXG;
                let prediction = "";
                let betType = "";
                
                if (isBasketball) {
                    const dynamicSpread = homeRaw - awayRaw; // Simulate bookmaker spread
                    
                    if (diff > dynamicSpread + 3.0) { prediction = "HOME"; betType = "MASSIVE"; } // Bet Home to cover
                    else if (diff < dynamicSpread - 3.0) { prediction = "AWAY"; betType = "MASSIVE"; } // Bet Away to cover
                    else { prediction = "DRAW"; betType = "SKIP"; }
                } else {
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
                    
                    let isHomeFav = diff > 1.00 || (homeWinRate > 0.60 && awayWinRate < 0.40 && (homeWinRate - awayWinRate) >= 0.30);
                    let isAwayFav = diff < -1.00 || (awayWinRate > 0.60 && homeWinRate < 0.40 && (awayWinRate - homeWinRate) >= 0.30);
                    
                    let isHomeUpsetRisk = isHomeFav && (sHome.streak.slice(-3).join('') === 'WWW' || hourOfRotation >= 11 || isKryptonite);
                    let isAwayUpsetRisk = isAwayFav && (sAway.streak.slice(-3).join('') === 'WWW' || hourOfRotation >= 11 || isKryptonite);
                    
                    if (isHomeUpsetRisk) { prediction = "AWAY"; betType = "MASSIVE"; }
                    else if (isAwayUpsetRisk) { prediction = "HOME"; betType = "MASSIVE"; }
                    else if (diff > massiveEdge) { prediction = "HOME"; betType = "MASSIVE"; }
                    else if (diff < -massiveEdge) { prediction = "AWAY"; betType = "MASSIVE"; }
                    else if (diff > slightEdge) { prediction = "HOME"; betType = "SLIGHT"; }
                    else if (diff < -slightEdge) { prediction = "AWAY"; betType = "SLIGHT"; }
                    else { prediction = "DRAW"; betType = "SKIP"; }
                }
                
                let actual = "";
                if (isBasketball) {
                    const actualDiff = homeScore - awayScore;
                    const dynamicSpread = homeRaw - awayRaw;
                    if (actualDiff > dynamicSpread) actual = "HOME"; // Home covered
                    else if (actualDiff < dynamicSpread) actual = "AWAY"; // Away covered
                    else actual = "DRAW"; // Push
                } else {
                    if (homeScore > awayScore) actual = "HOME";
                    else if (homeScore < awayScore) actual = "AWAY";
                    else actual = "DRAW";
                }
                
                if (betType !== "SKIP") {
                    overallEval++;
                    if (betType === "MASSIVE") {
                        massiveWagered += massiveBetSize;
                        if (prediction === actual) {
                            overallCorrectMassive++;
                            massiveReturned += (massiveBetSize * winOdds);
                        } else {
                            overallIncorrectMassive++;
                        }
                    } else if (betType === "SLIGHT") {
                        slightWagered += slightBetSize;
                        if (prediction === actual) {
                            overallCorrectSlight++;
                            slightReturned += (slightBetSize * dnbOdds);
                        } else if (actual === "DRAW") {
                            overallPushSlight++;
                            slightReturned += slightBetSize;
                        } else {
                            overallIncorrectSlight++;
                        }
                    }
                }
                
                // dynamicBaseline acts as the simulated bookmaker line for this specific matchup
                const dynamicBaseline = isBasketball ? ((homeAvgScored + awayAvgConceded)/2 + (awayAvgScored + homeAvgConceded)/2) : (leagueAvgPerTeam * 2);
                const totalXG = homeXG + awayXG - (isBasketball ? 30 : 0); // 15 points per player penalty
                
                let predOU = "SKIP";
                
                if (isBasketball) {
                    if (totalXG > dynamicBaseline + 5) predOU = "OVER";
                    else if (totalXG < dynamicBaseline - 5) predOU = "UNDER";
                } else {
                    predOU = totalXG > 2.5 ? "OVER" : "UNDER";
                }
                
                const actualTotal = homeScore + awayScore;
                const actualOU = isBasketball ? (actualTotal > dynamicBaseline ? "OVER" : "UNDER") : (actualTotal > 2.5 ? "OVER" : "UNDER");
                
                if (predOU !== "SKIP") {
                    overallTotalOU++;
                    ouWagered += ouBetSize;
                    if (predOU === actualOU) {
                        overallCorrectOU++;
                        ouReturned += (ouBetSize * (actualOU === "OVER" ? 1.5 : 2.5));
                    }
                    
                    if (!isBasketball) {
                        const predOU35 = totalXG > 3.5 ? "OVER" : "UNDER";
                        const actualOU35 = actualTotal > 3.5 ? "OVER" : "UNDER";
                        overallTotalOU35++;
                        ou35Wagered += ouBetSize;
                        if (predOU35 === actualOU35) {
                            overallCorrectOU35++;
                            ou35Returned += (ouBetSize * (actualOU35 === "OVER" ? 2.5 : 1.5));
                        }
                        
                        const predOU15 = totalXG > 1.5 ? "OVER" : "UNDER";
                        const actualOU15 = actualTotal > 1.5 ? "OVER" : "UNDER";
                        overallTotalOU15++;
                        ou15Wagered += ouBetSize;
                        if (predOU15 === actualOU15) {
                            overallCorrectOU15++;
                            ou15Returned += (ouBetSize * (actualOU15 === "OVER" ? 1.25 : 3.5)); // est odds
                        }
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
    
    const accMassive = (overallCorrectMassive + overallIncorrectMassive) > 0 ? ((overallCorrectMassive / (overallCorrectMassive + overallIncorrectMassive)) * 100).toFixed(2) : 0;
    const accSlight = (overallCorrectSlight + overallIncorrectSlight) > 0 ? ((overallCorrectSlight / (overallCorrectSlight + overallIncorrectSlight)) * 100).toFixed(2) : 0;
    const accOU = overallTotalOU > 0 ? ((overallCorrectOU / overallTotalOU) * 100).toFixed(2) : 0;
    const accOU35 = overallTotalOU35 > 0 ? ((overallCorrectOU35 / overallTotalOU35) * 100).toFixed(2) : 0;
    const accOU15 = overallTotalOU15 > 0 ? ((overallCorrectOU15 / overallTotalOU15) * 100).toFixed(2) : 0;
    
    const totalWagered = massiveWagered + slightWagered + ouWagered + ou35Wagered + ou15Wagered;
    const totalReturned = massiveReturned + slightReturned + ouReturned + ou35Returned + ou15Returned;
    const profit = totalReturned - totalWagered;
    
    console.log(`\n--- 21-DAY HISTORICAL BACKTEST: ${isBasketball ? 'EBASKETBALL' : 'ESOCCER'} ---`);
    console.log(`Total Matches Evaluated: ${overallEval}`);
    
    console.log(`\n-- Massive Edge (Win/Loss) --`);
    console.log(`Correct: ${overallCorrectMassive} | Incorrect: ${overallIncorrectMassive} | Accuracy: ${accMassive}%`);
    console.log(`Wagered: $${massiveWagered} | Returned: $${massiveReturned} | Profit: $${(massiveReturned - massiveWagered).toFixed(2)}`);
    
    console.log(`\n-- Slight Edge (Draw No Bet / Moneyline) --`);
    console.log(`Correct: ${overallCorrectSlight} | Incorrect: ${overallIncorrectSlight} | Pushed: ${overallPushSlight} | Accuracy: ${accSlight}%`);
    console.log(`Wagered: $${slightWagered} | Returned: $${slightReturned} | Profit: $${(slightReturned - slightWagered).toFixed(2)}`);
    
    console.log(`\n-- Over/Under 1.5 Goals Bets --`);
    console.log(`Correct: ${overallCorrectOU15} | Incorrect: ${overallTotalOU15 - overallCorrectOU15} | Accuracy: ${accOU15}%`);
    console.log(`Wagered: $${ou15Wagered} | Returned: $${ou15Returned} | Profit: $${(ou15Returned - ou15Wagered).toFixed(2)}`);
    
    console.log(`\n-- Over/Under 2.5 Goals Bets --`);
    console.log(`Correct: ${overallCorrectOU} | Incorrect: ${overallTotalOU - overallCorrectOU} | Accuracy: ${accOU}%`);
    console.log(`Wagered: $${ouWagered} | Returned: $${ouReturned} | Profit: $${(ouReturned - ouWagered).toFixed(2)}`);
    
    console.log(`\n-- Over/Under 3.5 Goals Bets --`);
    console.log(`Correct: ${overallCorrectOU35} | Incorrect: ${overallTotalOU35 - overallCorrectOU35} | Accuracy: ${accOU35}%`);
    console.log(`Wagered: $${ou35Wagered} | Returned: $${ou35Returned} | Profit: $${(ou35Returned - ou35Wagered).toFixed(2)}`);
    
    console.log(`\n-- OVERALL 21-DAY TOTALS --`);
    console.log(`Total Wagered: $${totalWagered}`);
    console.log(`Total Returned: $${totalReturned}`);
    console.log(`PROFIT/LOSS: $${profit.toFixed(2)}`);
}

let fifaData = [];
let nbaData = [];

try {
    fifaData = JSON.parse(fs.readFileSync('historical_fifa.json', 'utf8'));
    nbaData = JSON.parse(fs.readFileSync('historical_nba.json', 'utf8'));
} catch (e) {
    console.error("Error reading historical JSON files. Make sure to run fetch_historical.js first.");
    process.exit(1);
}

runBacktest(fifaData, false);
runBacktest(nbaData, true);
