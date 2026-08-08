const fs = require('fs');
const path = require('path');
process.chdir(__dirname); // Ensure script always runs in its own directory


let matchesYesterday = [];
try { matchesYesterday = JSON.parse(fs.readFileSync('api_data_yesterday.json', 'utf8')); } catch (e) {}
const matchesToday = JSON.parse(fs.readFileSync('api_data_latest.json', 'utf8'));
let matchesTomorrow = [];
try { matchesTomorrow = JSON.parse(fs.readFileSync('api_data_tomorrow.json', 'utf8')); } catch (e) {}

const allMatches = matchesYesterday.concat(matchesToday).concat(matchesTomorrow);

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

const currentRotationMatches = allMatches.filter(m => {
    const matchTime = new Date(m.startDate);
    return matchTime >= rotStart && matchTime < rotEnd;
});

const endedMatches = currentRotationMatches.filter(m => m.matchStatus === 'MATCH_ENDED' && !m.isCancelled);

let totalLeagueMatches = 0;
let totalLeagueGoals = 0;
endedMatches.forEach(m => {
    totalLeagueMatches++;
    totalLeagueGoals += (m.teamAScore + m.teamBScore);
});
const leagueAvgGoalsPerTeam = totalLeagueMatches > 0 ? (totalLeagueGoals / (totalLeagueMatches * 2)) : 1.5;

const playerStats = {};
const h2hStats = {};

function initPlayer(name) {
    if (!playerStats[name]) {
        playerStats[name] = { matches: 0, wins: 0, draws: 0, losses: 0, goalsScored: 0, goalsConceded: 0, streak: [], goalsList: [], concededList: [] };
    }
}

endedMatches.sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
endedMatches.forEach(m => {
    const home = m.participantAName;
    const away = m.participantBName;
    const homeScore = m.teamAScore;
    const awayScore = m.teamBScore;
    
    initPlayer(home);
    initPlayer(away);
    
    playerStats[home].matches++;
    playerStats[away].matches++;
    playerStats[home].goalsScored += homeScore;
    playerStats[home].goalsConceded += awayScore;
    playerStats[away].goalsScored += awayScore;
    playerStats[away].goalsConceded += homeScore;
    playerStats[home].goalsList.push(homeScore);
    playerStats[home].concededList.push(awayScore);
    playerStats[away].goalsList.push(awayScore);
    playerStats[away].concededList.push(homeScore);
    
    if (homeScore > awayScore) {
        playerStats[home].wins++;
        playerStats[away].losses++;
        playerStats[home].streak.push('W');
        playerStats[away].streak.push('L');
    } else if (homeScore < awayScore) {
        playerStats[away].wins++;
        playerStats[home].losses++;
        playerStats[away].streak.push('W');
        playerStats[home].streak.push('L');
    } else {
        playerStats[home].draws++;
        playerStats[away].draws++;
        playerStats[home].streak.push('D');
        playerStats[away].streak.push('D');
    }
    
    const players = [home, away].sort();
    const pairKey = `${players[0]} vs ${players[1]}`;
    if (!h2hStats[pairKey]) {
        h2hStats[pairKey] = { matches: 0, [players[0]]: 0, [players[1]]: 0, draws: 0 };
    }
    h2hStats[pairKey].matches++;
    if (homeScore > awayScore) {
        h2hStats[pairKey][home]++;
    } else if (homeScore < awayScore) {
        h2hStats[pairKey][away]++;
    } else {
        h2hStats[pairKey].draws++;
    }
});

const sortedPlayers = [];
for (let p in playerStats) {
    const s = playerStats[p];
    // Show all players in the table, even if they have 0 completed matches
    const winRate = s.matches > 0 ? ((s.wins / s.matches) * 100).toFixed(1) : "0.0";
    const avgScored = s.matches > 0 ? (s.goalsScored / s.matches).toFixed(2) : "0.00";
    const avgConceded = s.matches > 0 ? (s.goalsConceded / s.matches).toFixed(2) : "0.00";
    const totalAvg = parseFloat(avgScored) + parseFloat(avgConceded);
    const style = s.matches > 0 ? (totalAvg > 3.0 ? 'Aggressive' : 'Defensive') : 'Unknown';
    const recentForm = s.matches > 0 ? s.streak.join('-') : 'None';
    
    s.winRate = winRate;
    s.avgScored = avgScored;
    s.avgConceded = avgConceded;
    s.style = style;
    s.recentForm = recentForm;
    
    sortedPlayers.push({ p, ...s });
}
sortedPlayers.sort((a, b) => parseFloat(b.winRate) - parseFloat(a.winRate));

const activePlayers = new Set();
const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
currentRotationMatches
    .filter(m => m.matchStatus !== 'MATCH_ENDED' && !m.isCancelled && m.matchStatus !== 'PERMANENT_BET_SUSPEND' && new Date(m.startDate) > oneHourAgo)
    .sort((a, b) => new Date(a.startDate) - new Date(b.startDate))
    .slice(0, 150)
    .forEach(m => {
        activePlayers.add(m.participantAName);
        activePlayers.add(m.participantBName);
    });

let report = "# eSoccer Final Model Predictions\n\n";
report += `**League Average Goals Per Match (Per Team):** ${leagueAvgGoalsPerTeam.toFixed(2)}\n\n`;
report += "## Player Pattern Analysis (Latest Data)\n\n";
report += "| Player | Style | Matches | Win% | Avg Scored | Avg Conceded | Form (All Matches) |\n";
report += "|---|---|---|---|---|---|---|\n";

sortedPlayers.forEach(pData => {
    const p = pData.p;
    if (activePlayers.has(p)) {
        report += `| **${p}** | ${pData.style} | ${pData.matches} | ${pData.winRate}% | ${pData.avgScored} | ${pData.avgConceded} | ${pData.recentForm} |\n`;
    }
});

const h2hArr = [];
for (let key in h2hStats) {
    const stat = h2hStats[key];
    if (stat.matches >= 3) {
        const players = key.split(' vs ');
        const p1Wins = stat[players[0]];
        const p2Wins = stat[players[1]];
        let dominantPlayer = "None";
        let maxWins = 0;
        let winRate = 0;
        
        if (p1Wins > p2Wins) {
            dominantPlayer = players[0];
            maxWins = p1Wins;
        } else if (p2Wins > p1Wins) {
            dominantPlayer = players[1];
            maxWins = p2Wins;
        }
        
        if (dominantPlayer !== "None") {
            winRate = (maxWins / stat.matches) * 100;
            h2hArr.push({
                matchup: key,
                matches: stat.matches,
                dominantPlayer,
                winRate,
                breakdown: `${players[0]}: ${p1Wins}W | ${players[1]}: ${p2Wins}W | Draws: ${stat.draws}`
            });
        }
    }
}
h2hArr.sort((a, b) => b.winRate - a.winRate || b.matches - a.matches);

if (h2hArr.length > 0) {
    report += "\n## Most Dominant H2H Pairs (Current Rotation)\n\n";
    report += "| Matchup | Matches | Dominant Player | Win Rate | Breakdown |\n";
    report += "|---|---|---|---|---|\n";
    h2hArr.slice(0, 10).forEach(h => {
        report += `| **${h.matchup}** | ${h.matches} | ${h.dominantPlayer} | ${h.winRate.toFixed(1)}% | ${h.breakdown} |\n`;
    });
}

report += "\n## Top 50 Upcoming Matches (Max Profit Strategy)\n\n";
report += "> [!NOTE]\n> The model uses an optimized max-profit strategy: All predicted winners are played as **Draw No Bet**, with bet sizing tiered by confidence. It also selectively bets **OVER 2.5** only in aggressive, high-scoring matchups.\n\n";

const upcoming = currentRotationMatches
    .filter(m => m.matchStatus !== 'MATCH_ENDED' && !m.isCancelled && m.matchStatus !== 'PERMANENT_BET_SUSPEND' && new Date(m.startDate) > oneHourAgo)
    .sort((a, b) => new Date(a.startDate) - new Date(b.startDate))
    .slice(0, 50);

upcoming.forEach((m, idx) => {
    const home = m.participantAName;
    const away = m.participantBName;
    
    const sHome = playerStats[home];
    const sAway = playerStats[away];
    
    let prediction = "";
    let totalXG = 0;
    let homeXG = 0;
    let awayXG = 0;
    let ouPrediction = "";
    
    // Require at least 5 matches to establish solid form
    if (!sHome || !sAway || sHome.matches < 5 || sAway.matches < 5) {
        prediction = `*SKIP (Building Stats - Needs 5+ matches)*`;
        ouPrediction = `*SKIP*`;
    } else {
        homeXG = ((parseFloat(sHome.avgScored) + parseFloat(sAway.avgConceded)) / 2);
        awayXG = ((parseFloat(sAway.avgScored) + parseFloat(sHome.avgConceded)) / 2);
        
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
        
        // Selective Over 2.5 (Robust Combo Strategy)
        const hStyle = (parseFloat(sHome.avgScored) + parseFloat(sHome.avgConceded)) > 3.0 ? 'Aggressive' : 'Defensive';
        const aStyle = (parseFloat(sAway.avgScored) + parseFloat(sAway.avgConceded)) > 3.0 ? 'Aggressive' : 'Defensive';
        
        const isAggVsAgg = hStyle === 'Aggressive' && aStyle === 'Aggressive';
        const isBottomTier = parseFloat(sHome.winRate) <= 10 && parseFloat(sAway.winRate) <= 10 && sHome.matches >= 5 && sAway.matches >= 5;

        if (isAggVsAgg || isBottomTier) {
            ouPrediction = `**OVER 2.5 Goals**`;
            if (isAggVsAgg) ouPrediction += ' *(Aggressive Matchup)*';
            if (isBottomTier) ouPrediction += ' *(Bottom-Tier Shootout)*';
        } else if (totalXG < 2.5 && hStyle === 'Defensive' && aStyle === 'Defensive') {
            ouPrediction = `**UNDER 2.5 Goals**`;
        } else {
            ouPrediction = `*SKIP (Neutral XG)*`;
        }

        let minDiff = 0.20;
        if (isAggVsAgg) minDiff = 0.50;
        
        let isHomeUpsetRisk = diff > minDiff && (sHome.streak.slice(-3).join('') === 'WWW' || hourOfRotation >= 11 || isKryptonite);
        let isAwayUpsetRisk = diff < -minDiff && (sAway.streak.slice(-3).join('') === 'WWW' || hourOfRotation >= 11 || isKryptonite);
        
        // --- Uncertainty Score Calculation ---
        const calcUncertainty = (stats) => {
            let score = 0;
            // 1. Complacency (Win streak of 4 or 5)
            const recentStreak = stats.streak.slice(-5).join('');
            if (recentStreak.endsWith('WWWW') || recentStreak.endsWith('WWWWW')) score += 40;
            // 2. Regression to mean (Goal diff in last 3 matches >= 3)
            let recentG = 0, recentC = 0;
            stats.goalsList.slice(-3).forEach(g => recentG += g);
            stats.concededList.slice(-3).forEach(c => recentC += c);
            if ((recentG - recentC) >= 3) score += 30;
            // 3. Early shift volatility (Hour <= 4)
            if (hourOfRotation <= 4) score += 20;
            // 4. Draw Due (0 draws in last 3 matches)
            const recentDraws = stats.streak.slice(-3).filter(x => x === 'D').length;
            if (recentDraws === 0) score += 10;
            return Math.min(score, 100);
        };
        
        const homeUnc = calcUncertainty(sHome);
        const awayUnc = calcUncertainty(sAway);
        
        const formatFav = (name, type, unc) => {
            const riskStr = unc > 60 ? `[Uncertainty: ${unc}/100 - HIGH RISK]` : `[Uncertainty: ${unc}/100]`;
            return `**${name} wins (${type})** ${riskStr}`;
        };
        
        const bothAggressive = hStyle === 'Aggressive' && aStyle === 'Aggressive';
        const wrDiff = Math.abs(homeWinRate - awayWinRate);
        const isValidDnb = wrDiff > (bothAggressive ? 0.50 : 0.20);
        
        if (isValidDnb) {
            const pick = homeWinRate > awayWinRate ? home : away;
            const unc = pick === home ? homeUnc : awayUnc;
            prediction = formatFav(pick, 'Draw No Bet (Value Edge)', unc);
        } else {
            prediction = `*SKIP (Not a Value Edge)*`;
        }
        
        m.computedTotalXG = totalXG;
        m.computedHomeStyle = hStyle;
        m.computedAwayStyle = aStyle;
        m.computedPrediction = prediction;
        m.computedHome = home;
        m.computedAway = away;
        m.computedHomeUnc = homeUnc;
        m.computedAwayUnc = awayUnc;
        m.ouPrediction = ouPrediction;
        m.isOUPick = ouPrediction.includes('OVER') || ouPrediction.includes('UNDER');
        
        totalXG = homeXG + awayXG;
    }
    
    const hStyle = sHome ? ((parseFloat(sHome.avgScored) + parseFloat(sHome.avgConceded)) > 3.0 ? 'Aggressive' : 'Defensive') : 'Unknown';
    const aStyle = sAway ? ((parseFloat(sAway.avgScored) + parseFloat(sAway.avgConceded)) > 3.0 ? 'Aggressive' : 'Defensive') : 'Unknown';
    const matchTime = new Date(m.startDate).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'Australia/Sydney', month: 'short', day: 'numeric' }) + ' AEST';
    
    report += `### ${idx + 1}. ${home} (${hStyle}) vs ${away} (${aStyle}) [${matchTime}]\n`;
    if (!sHome || !sAway || sHome.matches < 3 || sAway.matches < 3) {
        report += `- **Analysis**: Insufficient data today to calculate expected goals.\n`;
    } else {
        report += `- **Analysis**: Total Expected Goals: ${totalXG.toFixed(2)} (${homeXG.toFixed(2)} to ${awayXG.toFixed(2)}).\n`;
    }
    report += `- **Prediction**: ${prediction}\n`;
    report += `- **Totals**: ${ouPrediction}\n\n`;
});

// --- AI Parlay Recommendations ---
report += "\n## 💡 AI Parlay Recommendations\n\n";

// Totals Parlay
const totalsParlay = [];
const usedPlayersTotals = new Set();
const potentialTotals = upcoming.filter(m => m.computedTotalXG >= 3.5 && (m.computedHomeStyle === 'Aggressive' || m.computedAwayStyle === 'Aggressive'))
    .sort((a, b) => b.computedTotalXG - a.computedTotalXG);

for (const m of potentialTotals) {
    if (!usedPlayersTotals.has(m.computedHome) && !usedPlayersTotals.has(m.computedAway)) {
        totalsParlay.push(m);
        usedPlayersTotals.add(m.computedHome);
        usedPlayersTotals.add(m.computedAway);
        if (totalsParlay.length >= 4) break;
    }
}

if (totalsParlay.length > 0) {
    report += `### ⚽ Over 2.5 Goals Parlay (${totalsParlay.length} Legs)\n`;
    report += `> **Model Logic:** Strictly matches where at least one player is Aggressive, Expected Goals >= 3.5, and no overlapping players.\n\n`;
    totalsParlay.forEach((m, idx) => {
        report += `${idx + 1}. **${m.computedHome} vs ${m.computedAway}** *(Expected Goals: ${m.computedTotalXG.toFixed(2)})* -> **Play: OVER 2.5 Goals**\n`;
    });
} else {
    report += `### ⚽ Over 2.5 Goals Parlay\n*No highly confident Over 2.5 matches (Aggressive vs Aggressive > 4.00 XG) found in this rotation.*\n`;
}

// Winner Parlay
const winnerParlay = [];
const usedPlayersWinners = new Set();
const potentialWinners = upcoming.filter(m => {
    if (!m.computedPrediction || !m.computedPrediction.includes('Draw No Bet') || m.computedPrediction.includes('UPSET ALERT')) return false;
    const fav = m.computedPrediction.includes(m.computedHome) ? m.computedHome : m.computedAway;
    const unc = fav === m.computedHome ? m.computedHomeUnc : m.computedAwayUnc;
    return unc <= 10;
}).sort((a, b) => {
    const favA = a.computedPrediction.includes(a.computedHome) ? a.computedHome : a.computedAway;
    const uncA = favA === a.computedHome ? (a.computedHomeUnc || 0) : (a.computedAwayUnc || 0);
    const favB = b.computedPrediction.includes(b.computedHome) ? b.computedHome : b.computedAway;
    const uncB = favB === b.computedHome ? (b.computedHomeUnc || 0) : (b.computedAwayUnc || 0);
    return uncA - uncB;
});

for (const m of potentialWinners) {
    if (!usedPlayersWinners.has(m.computedHome) && !usedPlayersWinners.has(m.computedAway)) {
        winnerParlay.push(m);
        usedPlayersWinners.add(m.computedHome);
        usedPlayersWinners.add(m.computedAway);
        if (winnerParlay.length >= 3) break;
    }
}

report += "\n";
if (winnerParlay.length > 0) {
    report += `### 🏆 Winner Parlay (${winnerParlay.length} Legs)\n`;
    report += `> **Model Logic:** Strictly favorites playing on a "Draw No Bet" line to protect against ties, with Uncertainty Score <= 10, and no overlapping players.\n\n`;
    winnerParlay.forEach((m, idx) => {
        const fav = m.computedPrediction.includes(m.computedHome) ? m.computedHome : m.computedAway;
        const unc = fav === m.computedHome ? m.computedHomeUnc : m.computedAwayUnc;
        report += `${idx + 1}. **${fav}** to beat ${fav === m.computedHome ? m.computedAway : m.computedHome} -> **Play: Draw No Bet** *[Uncertainty: ${unc}/100]*\n`;
    });
} else {
    report += `### 🏆 Winner Parlay\n*No extremely safe Draw No Bet favorites (Uncertainty <= 10) found in this rotation.*\n`;
}

fs.writeFileSync('esoccer_analysis.md', report);
console.log("Analysis written to artifact");

const { execSync } = require('child_process');
let backtestOutputStr = "";
try {
    backtestOutputStr = execSync('node backtest_today.js', { encoding: 'utf8' });
    console.log(backtestOutputStr);
    fs.appendFileSync('esoccer_analysis.md', '\n## Backtest Results\n\n```text\n' + backtestOutputStr + '\n```\n');
} catch (error) {
    console.error("Error running backtest_today.js:", error.message);
}

try {
    const dashboardData = {
        updatedAt: new Date().toISOString(),
        leagueAvgScored: leagueAvgGoalsPerTeam,
        upcoming: upcoming,
        winnerParlay: winnerParlay,
        backtestOutput: backtestOutputStr,
        playerStats: playerStats,
        h2hData: h2hArr.slice(0, 10)
    };
    const outputPath = path.join(__dirname, 'public', 'dashboard_data.json');
    fs.writeFileSync(outputPath, JSON.stringify(dashboardData, null, 2));
    console.log("Dashboard JSON written to public/dashboard_data.json");
} catch(e) {
    console.error("Failed to write dashboard_data.json:", e);
}
