const fs = require('fs');
const path = require('path');
process.chdir(__dirname);

const { getParsedData } = require('./src/data_parser');
const { calculateStatistics } = require('./src/statistics');
const { calculateH2H } = require('./src/h2h_engine');
const { generatePredictions } = require('./src/predictor');

// 1. Parse data
const { 
    currentRotationMatches, 
    endedMatches, 
    upcomingMatches,
    leagueAvgGoalsPerTeam 
} = getParsedData();

// 2. Build stats
const { playerStats, sortedPlayers, standings } = calculateStatistics(endedMatches);

// 3. Build H2H
const { h2hStats, h2hArr } = calculateH2H(endedMatches);

// 4. Generate Predictions
const { matches: upcoming, activePlayers } = generatePredictions(upcomingMatches, playerStats, h2hStats);

// 5. Generate Markdown Report
let report = "# eSoccer Final Model Predictions\n\n";
report += `**League Average Goals Per Match (Per Team): M** ${leagueAvgGoalsPerTeam.toFixed(2)}\n\n`;
report += "## Player Pattern Analysis (Latest Data)\n\n";
report += "| Player | Style | Matches | Win% | Avg Scored | Avg Conceded | Form (All Matches) |\n";
report += "|---|---|---|---|---|---|---|\n";

sortedPlayers.forEach(player => {
    if (activePlayers.has(player.p)) {
        report += `| **${player.p}** | ${player.style} | ${player.matches} | ${player.winRate}% | ${player.avgScored} | ${player.avgConceded} | ${player.recentForm} |\n`;
    }
});

report += "\n## Player Standings (Current Rotation)\n\n";
report += "| Rank | Player | Matches | W | D | L | GF | GA | GD | Points |\n";
report += "|---|---|---|---|---|---|---|---|---|---|\n";
standings.forEach((player, idx) => {
    if (activePlayers.has(player.p)) {
        report += `| ${idx + 1} | **${player.p}** | ${player.matches} | ${player.wins} | ${player.draws} | ${player.losses} | ${player.goalsScored} | ${player.goalsConceded} | ${player.gd > 0 ? '+'+player.gd : player.gd} | **${player.points}** |\n`;
    }
});

if (h2hArr.length > 0) {
    report += `\n## Top Dominant H2H Pairs (>60% Win Rate)\n\n`;
    report += `| Matchup | Matches | Dominant Player | Win Rate | Breakdown |\n`;
    report += `|---------|---------|-----------------|----------|-----------|\n`;
    h2hArr.filter(h => h.winRate > 60).forEach(h => {
        report += `| ${h.matchup} | ${h.matches} | **${h.dominantPlayer}** | ${h.winRate.toFixed(1)}% | ${h.breakdown} |\n`;
    });

    report += `\n## Other H2H Pairs (<= 60% Win Rate)\n\n`;
    report += `| Matchup | Matches | Leading Player | Win Rate | Breakdown |\n`;
    report += `|---------|---------|----------------|----------|-----------|\n`;
    h2hArr.filter(h => h.winRate <= 60).forEach(h => {
        report += `| ${h.matchup} | ${h.matches} | ${h.dominantPlayer} | ${h.winRate.toFixed(1)}% | ${h.breakdown} |\n`;
    });
}

report += "\n## Top 50 Upcoming Matches (Max Profit Strategy)\n\n";
report += "> [!NOTE]\n> The model uses an optimized max-profit strategy: All predicted winners are played as **Draw No Bet**, with bet sizing tiered by confidence. It also selectively bets **OVER 2.5** only in aggressive, high-scoring matchups.\n\n";

const topUpcoming = upcoming
    .sort((a, b) => new Date(a.startDate) - new Date(b.startDate))
    .slice(0, 50);

topUpcoming.forEach((m, idx) => {
    const matchTime = new Date(m.startDate).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'Australia/Sydney', month: 'short', day: 'numeric' }) + ' AEST';
    report += `### ${idx + 1}. ${m.participantAName} vs ${m.participantBName}\n`;
    report += `- **Time:** ${matchTime}\n`;
    report += `- **Styles:** ${m.computedHomeStyle} vs ${m.computedAwayStyle}\n`;
    report += `- **Prediction:** ${m.computedPrediction}\n`;
    report += `- **Over/Under:** ${m.ouPrediction}\n\n`;
});

fs.writeFileSync('esoccer_analysis.md', report);
console.log('Analysis written to artifact');

// 6. Generate JSON Dashboard Data
const dashboardData = {
    generatedAt: new Date().toISOString(),
    leagueAvgGoalsPerTeam: leagueAvgGoalsPerTeam,
    upcoming: topUpcoming,
    standings: standings.filter(p => activePlayers.has(p.p)),
    playerStats: {},
    h2hData: h2hArr.filter(h => h.winRate > 60),
    otherH2hData: h2hArr.filter(h => h.winRate <= 60),
    winnerParlay: topUpcoming.filter(m => m.computedPrediction && !m.computedPrediction.includes('SKIP')).slice(0, 3)
};

sortedPlayers.forEach(p => {
    if (activePlayers.has(p.p)) dashboardData.playerStats[p.p] = p;
});

fs.writeFileSync('dashboard_data.json', JSON.stringify(dashboardData, null, 2));
console.log('Dashboard JSON written to dashboard_data.json');
