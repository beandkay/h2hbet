const fs = require('fs');

let matchesYesterday = [];
try { matchesYesterday = JSON.parse(fs.readFileSync('nba_api_yesterday.json', 'utf8')); } catch (e) {}
const matchesToday = JSON.parse(fs.readFileSync('nba_api_latest.json', 'utf8'));
let matchesTomorrow = [];
try { matchesTomorrow = JSON.parse(fs.readFileSync('nba_api_tomorrow.json', 'utf8')); } catch (e) {}

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
let totalLeaguePoints = 0;
endedMatches.forEach(m => {
    totalLeagueMatches++;
    totalLeaguePoints += (m.teamAScore + m.teamBScore);
});
const leagueAvgPointsPerTeam = totalLeagueMatches > 0 ? (totalLeaguePoints / (totalLeagueMatches * 2)) : 52.0;

const playerStats = {};
const h2hStats = {};

function initPlayer(name) {
    if (!playerStats[name]) {
        playerStats[name] = { matches: 0, wins: 0, draws: 0, losses: 0, pointsScored: 0, pointsConceded: 0, streak: [], pointsList: [], concededList: [] };
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
    playerStats[home].pointsScored += homeScore;
    playerStats[home].pointsConceded += awayScore;
    playerStats[away].pointsScored += awayScore;
    playerStats[away].pointsConceded += homeScore;
    playerStats[home].pointsList.push(homeScore);
    playerStats[home].concededList.push(awayScore);
    playerStats[away].pointsList.push(awayScore);
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

for (let player in playerStats) {
    const stats = playerStats[player];
    stats.avgScored = stats.matches > 0 ? (stats.pointsScored / stats.matches).toFixed(2) : 0;
    stats.avgConceded = stats.matches > 0 ? (stats.pointsConceded / stats.matches).toFixed(2) : 0;
    stats.winRate = stats.matches > 0 ? ((stats.wins / stats.matches) * 100).toFixed(1) : 0;
    stats.recentForm = stats.streak.slice(-5).join('-');
    stats.style = parseFloat(stats.avgScored) > leagueAvgPointsPerTeam ? 'Aggressive' : 'Defensive';
}

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

let report = "# eBasketball Final Model Predictions\n\n";
report += `**League Average Points Per Match (Per Team):** ${leagueAvgPointsPerTeam.toFixed(2)}\n\n`;
report += "## Player Pattern Analysis (Latest Data)\n\n";
report += "| Player | Style | Matches | Win% | Avg Scored (Pts) | Avg Conceded (Pts) | Last 5 Form |\n";
report += "|---|---|---|---|---|---|---|\n";

const sortedPlayers = Object.keys(playerStats).sort((a, b) => parseFloat(playerStats[b].winRate) - parseFloat(playerStats[a].winRate));
sortedPlayers.forEach(p => {
    const s = playerStats[p];
    if (s.matches >= 3 && activePlayers.has(p)) {
        report += `| **${p}** | ${s.style} | ${s.matches} | ${s.winRate}% | ${s.avgScored} | ${s.avgConceded} | ${s.recentForm} |\n`;
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

report += "\n## Top 50 Upcoming Matches (Moneyline & Totals)\n\n";
report += "> [!NOTE]\n> The model uses a Moneyline strategy: it predicts a Massive Edge for >10.0 diff, and a Slight Edge for >3.0 diff. It ignores close matchups.\n\n";

const upcoming = currentRotationMatches
    .filter(m => m.matchStatus !== 'MATCH_ENDED' && !m.isCancelled && m.matchStatus !== 'PERMANENT_BET_SUSPEND' && new Date(m.startDate) > oneHourAgo)
    .sort((a, b) => new Date(a.startDate) - new Date(b.startDate))
    .slice(0, 50);

upcoming.forEach((m, idx) => {
    const home = m.participantAName;
    const away = m.participantBName;
    
    const excludedPlayers = ["ODYSSEY", "NAVY", "RESISTANCE"];
    if (excludedPlayers.includes(home) || excludedPlayers.includes(away)) return;
    
    const sHome = playerStats[home];
    const sAway = playerStats[away];
    
    let prediction = "";
    let totalXG = 0;
    let homeXG = 0;
    let awayXG = 0;
    let ouPrediction = "";
    
    if (!sHome || !sAway || sHome.matches < 3 || sAway.matches < 3) {
        prediction = `*SKIP (Building Stats - Needs 3+ matches)*`;
        ouPrediction = `*SKIP*`;
    } else {
        homeXG = ((parseFloat(sHome.avgScored) + parseFloat(sAway.avgConceded)) / 2);
        awayXG = ((parseFloat(sAway.avgScored) + parseFloat(sHome.avgConceded)) / 2);
        
        const calcPoints = (form) => form.reduce((acc, val) => acc + (val === 'W' ? 3 : val === 'D' ? 1 : 0), 0);
        homeXG += calcPoints(sHome.streak.slice(-5)) * 1.5;
        awayXG += calcPoints(sAway.streak.slice(-5)) * 1.5;
        
        // Apply a 15-point penalty per player to account for clock-chewing / playing with a lead
        homeXG -= 15;
        awayXG -= 15;
        
        const diff = homeXG - awayXG;
        
        // --- Upset Alert Logic ---
        const homeWinRate = sHome.wins / sHome.matches;
        const awayWinRate = sAway.wins / sAway.matches;
        
        const aestDate = new Date(new Date(m.startDate).getTime() + 10 * 60 * 60 * 1000);
        let hourOfRotation = aestDate.getUTCHours();
        if (hourOfRotation >= 4 && hourOfRotation < 16) hourOfRotation = hourOfRotation - 3;
        else if (hourOfRotation >= 16) hourOfRotation = hourOfRotation - 15;
        else hourOfRotation = hourOfRotation + 9;
        
        let isHomeFav = diff > 10.0 || (homeWinRate > 0.60 && awayWinRate < 0.40 && (homeWinRate - awayWinRate) >= 0.30);
        let isAwayFav = diff < -10.0 || (awayWinRate > 0.60 && homeWinRate < 0.40 && (awayWinRate - homeWinRate) >= 0.30);
        
        // Check for WWW streak or End of shift (Hour >= 11) for Upset Alert
        let isHomeUpsetRisk = isHomeFav && (sHome.streak.slice(-3).join('') === 'WWW' || hourOfRotation >= 11);
        let isAwayUpsetRisk = isAwayFav && (sAway.streak.slice(-3).join('') === 'WWW' || hourOfRotation >= 11);
        
        // --- Uncertainty Score Calculation ---
        const calcUncertainty = (stats) => {
            let score = 0;
            // 1. Complacency (Win streak of 4 or 5)
            const recentStreak = stats.streak.slice(-5).join('');
            if (recentStreak.endsWith('WWWW') || recentStreak.endsWith('WWWWW')) score += 40;
            // 2. Regression to mean (Point diff in last 3 matches >= 30)
            let recentG = 0, recentC = 0;
            stats.pointsList.slice(-3).forEach(g => recentG += g);
            stats.concededList.slice(-3).forEach(c => recentC += c);
            if ((recentG - recentC) >= 30) score += 40; // Weighted higher because no draws
            // 3. Early shift volatility (Hour <= 4)
            if (hourOfRotation <= 4) score += 20;
            return Math.min(score, 100);
        };
        
        const homeUnc = calcUncertainty(sHome);
        const awayUnc = calcUncertainty(sAway);
        
        const formatFav = (name, type, unc) => {
            const riskStr = unc > 60 ? `[Uncertainty: ${unc}/100 - HIGH RISK]` : `[Uncertainty: ${unc}/100]`;
            return `**${name} wins (${type})** ${riskStr}`;
        };
        
        if (isHomeUpsetRisk) {
            prediction = `🚨 UPSET ALERT 🚨 **${away} wins (Bet Underdog - Massive Edge)**`;
        } else if (isAwayUpsetRisk) {
            prediction = `🚨 UPSET ALERT 🚨 **${home} wins (Bet Underdog - Massive Edge)**`;
        } else if (diff > 10.0) {
            prediction = formatFav(home, 'Moneyline - Massive Edge', homeUnc);
        } else if (diff < -10.0) {
            prediction = formatFav(away, 'Moneyline - Massive Edge', awayUnc);
        } else if (diff > 3.0) {
            prediction = formatFav(home, 'Moneyline - Slight Edge', homeUnc);
        } else if (diff < -3.0) {
            prediction = formatFav(away, 'Moneyline - Slight Edge', awayUnc);
        } else {
            prediction = `*SKIP (Too Close to Call / Likely Draw)*`;
        }
        
        m.computedPrediction = prediction;
        m.computedHome = home;
        m.computedAway = away;
        m.computedHomeUnc = homeUnc;
        m.computedAwayUnc = awayUnc;
        
        totalXG = homeXG + awayXG;
        ouPrediction = `**Projected Total: ${totalXG.toFixed(1)} Points** (Compare to your bookmaker's line)`;
    }
    
    const hStyle = sHome ? sHome.style : 'Unknown';
    const aStyle = sAway ? sAway.style : 'Unknown';
    const matchTime = new Date(m.startDate).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'Australia/Sydney', month: 'short', day: 'numeric' }) + ' AEST';
    
    report += `### ${idx + 1}. ${home} (${hStyle}) vs ${away} (${aStyle}) [${matchTime}]\n`;
    if (!sHome || !sAway || sHome.matches < 3 || sAway.matches < 3) {
        report += `- **Analysis**: Insufficient data today to calculate expected goals.\n`;
    } else {
        report += `- **Analysis**: Total Expected Goals: ${totalXG.toFixed(2)} (${homeXG.toFixed(2)} to ${awayXG.toFixed(2)}).\n`;
    }
    report += `- **Prediction**: ${prediction}\n`;
    report += `- **Totals Prediction**: ${ouPrediction}\n\n`;
});

// --- AI Parlay Recommendations ---
report += "\n## 💡 AI Parlay Recommendations\n\n";

// Winner Parlay
const winnerParlay = upcoming.filter(m => {
    if (!m.computedPrediction || !m.computedPrediction.includes('Moneyline') || m.computedPrediction.includes('UPSET ALERT')) return false;
    const fav = m.computedPrediction.includes(m.computedHome) ? m.computedHome : m.computedAway;
    const unc = fav === m.computedHome ? m.computedHomeUnc : m.computedAwayUnc;
    return unc === 0;
}).slice(0, 3);

if (winnerParlay.length > 0) {
    report += `### 🏆 Winner Parlay (${winnerParlay.length} Legs)\n`;
    report += `> **Model Logic:** Strictly favorites playing on a Moneyline with a flawless 0/100 Uncertainty Score.\n\n`;
    winnerParlay.forEach((m, idx) => {
        const fav = m.computedPrediction.includes(m.computedHome) ? m.computedHome : m.computedAway;
        const unc = fav === m.computedHome ? m.computedHomeUnc : m.computedAwayUnc;
        report += `${idx + 1}. **${fav}** to beat ${fav === m.computedHome ? m.computedAway : m.computedHome} -> **Play: Moneyline** *[Uncertainty: ${unc}/100]*\n`;
    });
} else {
    report += `### 🏆 Winner Parlay\n*No extremely safe Moneyline favorites (Uncertainty 0/100) found in this rotation.*\n`;
}

fs.writeFileSync('ebasketball_analysis.md', report);
console.log("Analysis written to artifact");

const { execSync } = require('child_process');
try {
    const backtestOutput = execSync('node backtest_today_nba.js', { encoding: 'utf8' });
    console.log(backtestOutput);
    fs.appendFileSync('ebasketball_analysis.md', '\n## Backtest Results\n\n```text\n' + backtestOutput + '\n```\n');
} catch (error) {
    console.error("Error running backtest_today_nba.js:", error.message);
}
