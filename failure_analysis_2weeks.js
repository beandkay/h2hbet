const fs = require('fs');
const path = require('path');

// Load all 14 days of historical data
const histDir = path.join(__dirname, 'hist_data');
const allFiles = fs.readdirSync(histDir).filter(f => f.startsWith('fifa_') && f.endsWith('.json')).sort();

console.log(`Loading ${allFiles.length} days of data...`);

// Process each day as its own independent "rotation" to simulate real betting
// Each day has ~2 rotations (4AM-4PM and 4PM-4AM AEST)
let grandTotals = {
    totalMatches: 0,
    totalRotations: 0,
    winner: { total: 0, correct: 0, failedToDraws: 0, failedToUpsets: 0,
        byXGDiff: { tiny: { c: 0, f: 0 }, small: { c: 0, f: 0 }, medium: { c: 0, f: 0 }, large: { c: 0, f: 0 } },
        byHour: {},
        byDrawRate: { low: { c: 0, f: 0 }, mid: { c: 0, f: 0 }, high: { c: 0, f: 0 } },
        byWinRateDiff: { tiny: { c: 0, f: 0 }, small: { c: 0, f: 0 }, medium: { c: 0, f: 0 }, large: { c: 0, f: 0 } },
        byMatchesPlayed: { early: { c: 0, f: 0 }, mid: { c: 0, f: 0 }, late: { c: 0, f: 0 } },
        byStreak: {},
        byStyle: {},
        byBetType: { WIN: { c: 0, f: 0 }, DNB: { c: 0, f: 0, push: 0 } }
    },
    ou15: { total: 0, correct: 0, byStyle: {}, byDirection: { over: { c: 0, f: 0 }, under: { c: 0, f: 0 } } },
    ou25: { total: 0, correct: 0, byStyle: {},
        byDirection: { over: { c: 0, f: 0 }, under: { c: 0, f: 0 } },
        byXGTotal: {},
        byActualTotal: {}
    },
    ou35: { total: 0, correct: 0, byStyle: {}, byDirection: { over: { c: 0, f: 0 }, under: { c: 0, f: 0 } } }
};

let allFailures = { winner: [], ou25: [], ou15: [] };

// Process each day independently (reset player stats per day to simulate real conditions)
allFiles.forEach(file => {
    const dayData = JSON.parse(fs.readFileSync(path.join(histDir, file), 'utf8'));
    const dateStr = file.replace('fifa_', '').replace('.json', '');
    
    const endedMatches = dayData
        .filter(m => m.matchStatus === 'MATCH_ENDED' && !m.isCancelled)
        .sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
    
    if (endedMatches.length === 0) return;
    
    grandTotals.totalMatches += endedMatches.length;
    grandTotals.totalRotations++;
    
    // Fresh player stats for each day
    const playerStats = {};
    function initPlayer(name) {
        if (!playerStats[name]) {
            playerStats[name] = {
                matches: 0, wins: 0, draws: 0, losses: 0,
                goalsScored: 0, goalsConceded: 0, streak: [],
                lastGoals: []
            };
        }
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
        
        if (sHome.matches >= 3 && sAway.matches >= 3) {
            const homeAvgScored = sHome.goalsScored / sHome.matches;
            const homeAvgConceded = sHome.goalsConceded / sHome.matches;
            const awayAvgScored = sAway.goalsScored / sAway.matches;
            const awayAvgConceded = sAway.goalsConceded / sAway.matches;
            
            let homeXG = (homeAvgScored + awayAvgConceded) / 2;
            let awayXG = (awayAvgScored + homeAvgConceded) / 2;
            
            const calcPoints = (form) => form.reduce((acc, val) => acc + (val === 'W' ? 3 : val === 'D' ? 1 : 0), 0);
            homeXG += calcPoints(sHome.streak.slice(-5)) * 0.05;
            awayXG += calcPoints(sAway.streak.slice(-5)) * 0.05;
            
            const diff = homeXG - awayXG;
            const homeWinRate = sHome.wins / sHome.matches;
            const awayWinRate = sAway.wins / sAway.matches;
            const homeDrawRate = sHome.draws / sHome.matches;
            const awayDrawRate = sAway.draws / sAway.matches;
            const avgDrawRate = (homeDrawRate + awayDrawRate) / 2;
            
            const aestDate = new Date(new Date(m.startDate).getTime() + 10 * 60 * 60 * 1000);
            let hourOfRotation = aestDate.getUTCHours();
            if (hourOfRotation >= 4 && hourOfRotation < 16) hourOfRotation = hourOfRotation - 3;
            else if (hourOfRotation >= 16) hourOfRotation = hourOfRotation - 15;
            else hourOfRotation = hourOfRotation + 9;
            
            const hStyle = (homeAvgScored + homeAvgConceded) > (2 * 1.5) ? 'Aggressive' : 'Defensive';
            const aStyle = (awayAvgScored + awayAvgConceded) > (2 * 1.5) ? 'Aggressive' : 'Defensive';
            const matchStyle = `${hStyle} vs ${aStyle}`;
            
            // Winner prediction
            let prediction = "";
            let betType = "";
            if (diff > 1.00) { prediction = "HOME"; betType = "WIN"; }
            else if (diff < -1.00) { prediction = "AWAY"; betType = "WIN"; }
            else if (diff > 0.20) { prediction = "HOME"; betType = "DNB"; }
            else if (diff < -0.20) { prediction = "AWAY"; betType = "DNB"; }
            else { prediction = "DRAW"; betType = "SKIP"; }
            
            let actual = "";
            if (homeScore > awayScore) actual = "HOME";
            else if (homeScore < awayScore) actual = "AWAY";
            else actual = "DRAW";
            
            const favPlayerMatches = prediction === "HOME" ? sHome.matches : sAway.matches;
            
            if (betType !== "SKIP") {
                grandTotals.winner.total++;
                
                const absDiff = Math.abs(diff);
                let xgBucket = absDiff > 1.0 ? 'large' : absDiff > 0.5 ? 'medium' : absDiff > 0.2 ? 'small' : 'tiny';
                const winRateDiff = Math.abs(homeWinRate - awayWinRate);
                let wrBucket = winRateDiff > 0.3 ? 'large' : winRateDiff > 0.15 ? 'medium' : winRateDiff > 0.05 ? 'small' : 'tiny';
                let drBucket = avgDrawRate > 0.25 ? 'high' : avgDrawRate > 0.12 ? 'mid' : 'low';
                let mpBucket = favPlayerMatches <= 5 ? 'early' : favPlayerMatches <= 9 ? 'mid' : 'late';
                const hourKey = `H${hourOfRotation}`;
                if (!grandTotals.winner.byHour[hourKey]) grandTotals.winner.byHour[hourKey] = { c: 0, f: 0 };
                const favStreak = prediction === "HOME" ? sHome.streak.slice(-3).join('') : sAway.streak.slice(-3).join('');
                if (!grandTotals.winner.byStreak[favStreak]) grandTotals.winner.byStreak[favStreak] = { c: 0, f: 0 };
                if (!grandTotals.winner.byStyle[matchStyle]) grandTotals.winner.byStyle[matchStyle] = { c: 0, f: 0 };
                
                const isCorrect = (prediction === actual) || (betType === "DNB" && actual === "DRAW");
                
                if (isCorrect) {
                    grandTotals.winner.correct++;
                    grandTotals.winner.byXGDiff[xgBucket].c++;
                    grandTotals.winner.byHour[hourKey].c++;
                    grandTotals.winner.byDrawRate[drBucket].c++;
                    grandTotals.winner.byStreak[favStreak].c++;
                    grandTotals.winner.byWinRateDiff[wrBucket].c++;
                    grandTotals.winner.byMatchesPlayed[mpBucket].c++;
                    grandTotals.winner.byStyle[matchStyle].c++;
                    grandTotals.winner.byBetType[betType].c++;
                } else {
                    grandTotals.winner.byXGDiff[xgBucket].f++;
                    grandTotals.winner.byHour[hourKey].f++;
                    grandTotals.winner.byDrawRate[drBucket].f++;
                    grandTotals.winner.byStreak[favStreak].f++;
                    grandTotals.winner.byWinRateDiff[wrBucket].f++;
                    grandTotals.winner.byMatchesPlayed[mpBucket].f++;
                    grandTotals.winner.byStyle[matchStyle].f++;
                    if (betType === "DNB" && actual !== "DRAW") grandTotals.winner.byBetType[betType].f++;
                    else if (betType === "WIN") grandTotals.winner.byBetType[betType].f++;
                    
                    if (actual === "DRAW") grandTotals.winner.failedToDraws++;
                    else grandTotals.winner.failedToUpsets++;
                    
                    allFailures.winner.push({
                        date: dateStr, home, away, homeScore, awayScore,
                        prediction, actual, betType,
                        diff: diff.toFixed(2), absDiff: absDiff.toFixed(2),
                        homeWR: (homeWinRate * 100).toFixed(0) + '%',
                        awayWR: (awayWinRate * 100).toFixed(0) + '%',
                        avgDR: (avgDrawRate * 100).toFixed(0) + '%',
                        hour: hourOfRotation, matchStyle, favStreak, favMatches: favPlayerMatches
                    });
                }
            }
            
            // O/U analysis
            const totalXG = homeXG + awayXG;
            const actualTotal = homeScore + awayScore;
            
            // O/U 1.5
            const predOU15 = totalXG > 1.5 ? "OVER" : "UNDER";
            const actualOU15 = actualTotal > 1.5 ? "OVER" : "UNDER";
            grandTotals.ou15.total++;
            if (!grandTotals.ou15.byStyle[matchStyle]) grandTotals.ou15.byStyle[matchStyle] = { c: 0, f: 0 };
            if (predOU15 === actualOU15) {
                grandTotals.ou15.correct++;
                grandTotals.ou15.byDirection[predOU15.toLowerCase()].c++;
                grandTotals.ou15.byStyle[matchStyle].c++;
            } else {
                grandTotals.ou15.byDirection[predOU15.toLowerCase()].f++;
                grandTotals.ou15.byStyle[matchStyle].f++;
            }
            
            // O/U 2.5
            const predOU = totalXG > 3.1 ? "OVER" : "UNDER";
            const actualOU = actualTotal > 2.5 ? "OVER" : "UNDER";
            grandTotals.ou25.total++;
            if (!grandTotals.ou25.byStyle[matchStyle]) grandTotals.ou25.byStyle[matchStyle] = { c: 0, f: 0 };
            const xgTotalKey = totalXG < 2.5 ? '<2.5' : totalXG < 3.0 ? '2.5-3.0' : totalXG < 3.5 ? '3.0-3.5' : totalXG < 4.0 ? '3.5-4.0' : '4.0+';
            if (!grandTotals.ou25.byXGTotal[xgTotalKey]) grandTotals.ou25.byXGTotal[xgTotalKey] = { c: 0, f: 0 };
            const actKey = `${actualTotal}`;
            if (!grandTotals.ou25.byActualTotal[actKey]) grandTotals.ou25.byActualTotal[actKey] = 0;
            grandTotals.ou25.byActualTotal[actKey]++;
            if (predOU === actualOU) {
                grandTotals.ou25.correct++;
                grandTotals.ou25.byDirection[predOU.toLowerCase()].c++;
                grandTotals.ou25.byStyle[matchStyle].c++;
                grandTotals.ou25.byXGTotal[xgTotalKey].c++;
            } else {
                grandTotals.ou25.byDirection[predOU.toLowerCase()].f++;
                grandTotals.ou25.byStyle[matchStyle].f++;
                grandTotals.ou25.byXGTotal[xgTotalKey].f++;
            }
            
            // O/U 3.5
            const predOU35 = totalXG > 3.5 ? "OVER" : "UNDER";
            const actualOU35 = actualTotal > 3.5 ? "OVER" : "UNDER";
            grandTotals.ou35.total++;
            if (!grandTotals.ou35.byStyle[matchStyle]) grandTotals.ou35.byStyle[matchStyle] = { c: 0, f: 0 };
            if (!grandTotals.ou35.byDirection[predOU35.toLowerCase()]) grandTotals.ou35.byDirection[predOU35.toLowerCase()] = { c: 0, f: 0 };
            if (predOU35 === actualOU35) {
                grandTotals.ou35.correct++;
                grandTotals.ou35.byDirection[predOU35.toLowerCase()].c++;
                grandTotals.ou35.byStyle[matchStyle].c++;
            } else {
                grandTotals.ou35.byDirection[predOU35.toLowerCase()].f++;
                grandTotals.ou35.byStyle[matchStyle].f++;
            }
        }
        
        // Update stats
        sHome.matches++; sAway.matches++;
        sHome.goalsScored += homeScore; sHome.goalsConceded += awayScore;
        sAway.goalsScored += awayScore; sAway.goalsConceded += homeScore;
        if (homeScore > awayScore) {
            sHome.wins++; sAway.losses++; sHome.streak.push('W'); sAway.streak.push('L');
        } else if (homeScore < awayScore) {
            sAway.wins++; sHome.losses++; sAway.streak.push('W'); sHome.streak.push('L');
        } else {
            sHome.draws++; sAway.draws++; sHome.streak.push('D'); sAway.streak.push('D');
        }
    });
});

// --- Generate Report ---
const pct = (c, t) => t > 0 ? ((c / t) * 100).toFixed(1) : '0.0';

let report = `# 🔬 2-Week Failure Pattern Analysis (${allFiles.length} Days)\n\n`;
report += `**Period:** ${allFiles[0]?.replace('fifa_','').replace('.json','')} to ${allFiles[allFiles.length-1]?.replace('fifa_','').replace('.json','')}\n`;
report += `**Total Matches Analyzed:** ${grandTotals.totalMatches}\n\n`;

// === WINNER ===
const w = grandTotals.winner;
const wFailed = w.total - w.correct;
report += `---\n\n## 🏆 Winner Prediction Analysis\n\n`;
report += `**Overall:** ${w.total} bets | ${w.correct} correct | ${wFailed} wrong | **Accuracy: ${pct(w.correct, w.total)}%**\n\n`;
report += `**Failure Breakdown:** ${w.failedToDraws} lost to DRAWS | ${w.failedToUpsets} lost to UPSETS\n\n`;

report += `### By Bet Type\n`;
report += `| Type | Correct | Failed | Accuracy |\n|---|---|---|---|\n`;
report += `| Strict Win | ${w.byBetType.WIN.c} | ${w.byBetType.WIN.f} | ${pct(w.byBetType.WIN.c, w.byBetType.WIN.c + w.byBetType.WIN.f)}% |\n`;
report += `| Draw No Bet | ${w.byBetType.DNB.c} | ${w.byBetType.DNB.f} | ${pct(w.byBetType.DNB.c, w.byBetType.DNB.c + w.byBetType.DNB.f)}% |\n`;

report += `\n### By XG Difference (Prediction Confidence)\n`;
report += `| XG Diff | Correct | Failed | Total | Accuracy | Notes |\n|---|---|---|---|---|---|\n`;
for (const [k, v] of Object.entries(w.byXGDiff)) {
    const total = v.c + v.f;
    if (total > 0) {
        const acc = pct(v.c, total);
        const label = k === 'tiny' ? '0.00-0.20' : k === 'small' ? '0.20-0.50' : k === 'medium' ? '0.50-1.00' : '1.00+';
        report += `| ${label} | ${v.c} | ${v.f} | ${total} | ${acc}% | ${parseFloat(acc) < 55 ? '⚠️ WEAK' : '✅'} |\n`;
    }
}

report += `\n### By Hour of Rotation\n`;
report += `| Hour | Correct | Failed | Total | Accuracy | Notes |\n|---|---|---|---|---|---|\n`;
const sortedHours = Object.entries(w.byHour).sort((a, b) => parseInt(a[0].slice(1)) - parseInt(b[0].slice(1)));
for (const [k, v] of sortedHours) {
    const total = v.c + v.f;
    if (total >= 3) {
        const acc = pct(v.c, total);
        report += `| ${k} | ${v.c} | ${v.f} | ${total} | ${acc}% | ${parseFloat(acc) < 55 ? '⚠️ WEAK' : '✅'} |\n`;
    }
}

report += `\n### By Average Draw Rate\n`;
report += `| Draw Rate | Correct | Failed | Total | Accuracy | Notes |\n|---|---|---|---|---|---|\n`;
for (const [k, v] of Object.entries(w.byDrawRate)) {
    const total = v.c + v.f;
    if (total > 0) {
        const acc = pct(v.c, total);
        const label = k === 'low' ? '<12%' : k === 'mid' ? '12-25%' : '>25%';
        report += `| ${label} | ${v.c} | ${v.f} | ${total} | ${acc}% | ${parseFloat(acc) < 55 ? '⚠️ WEAK' : '✅'} |\n`;
    }
}

report += `\n### By Win Rate Differential\n`;
report += `| WR Diff | Correct | Failed | Total | Accuracy | Notes |\n|---|---|---|---|---|---|\n`;
for (const [k, v] of Object.entries(w.byWinRateDiff)) {
    const total = v.c + v.f;
    if (total > 0) {
        const acc = pct(v.c, total);
        const label = k === 'tiny' ? '<5%' : k === 'small' ? '5-15%' : k === 'medium' ? '15-30%' : '30%+';
        report += `| ${label} | ${v.c} | ${v.f} | ${total} | ${acc}% | ${parseFloat(acc) < 55 ? '⚠️ WEAK' : '✅'} |\n`;
    }
}

report += `\n### By Matches Played (Sample Size)\n`;
report += `| Matches | Correct | Failed | Total | Accuracy | Notes |\n|---|---|---|---|---|---|\n`;
for (const [k, v] of Object.entries(w.byMatchesPlayed)) {
    const total = v.c + v.f;
    if (total > 0) {
        const acc = pct(v.c, total);
        const label = k === 'early' ? '3-5 games' : k === 'mid' ? '6-9 games' : '10+ games';
        report += `| ${label} | ${v.c} | ${v.f} | ${total} | ${acc}% | ${parseFloat(acc) < 55 ? '⚠️ UNRELIABLE' : '✅'} |\n`;
    }
}

report += `\n### By Match Style (CRITICAL)\n`;
report += `| Style | Correct | Failed | Total | Accuracy | Notes |\n|---|---|---|---|---|---|\n`;
const sortedStyles = Object.entries(w.byStyle).sort((a, b) => (b[1].c + b[1].f) - (a[1].c + a[1].f));
for (const [k, v] of sortedStyles) {
    const total = v.c + v.f;
    if (total > 0) {
        const acc = pct(v.c, total);
        report += `| ${k} | ${v.c} | ${v.f} | ${total} | ${acc}% | ${parseFloat(acc) < 55 ? '❌ SKIP' : parseFloat(acc) < 65 ? '⚠️ WEAK' : '✅'} |\n`;
    }
}

report += `\n### By Favorite's Last 3 Streak\n`;
report += `| Streak | Correct | Failed | Total | Accuracy |\n|---|---|---|---|---|\n`;
const sortedStreaks = Object.entries(w.byStreak).sort((a, b) => (b[1].c + b[1].f) - (a[1].c + a[1].f));
for (const [k, v] of sortedStreaks) {
    const total = v.c + v.f;
    if (total >= 5) {
        report += `| ${k || '(empty)'} | ${v.c} | ${v.f} | ${total} | ${pct(v.c, total)}% |\n`;
    }
}

// === O/U 1.5 ===
const o1 = grandTotals.ou15;
report += `\n---\n\n## 📊 Over/Under 1.5 Goals Analysis\n\n`;
report += `**Overall:** ${o1.total} bets | ${o1.correct} correct | ${o1.total - o1.correct} wrong | **Accuracy: ${pct(o1.correct, o1.total)}%**\n\n`;
report += `### By Direction\n`;
report += `| Direction | Correct | Failed | Total | Accuracy |\n|---|---|---|---|---|\n`;
for (const [k, v] of Object.entries(o1.byDirection)) {
    const total = v.c + v.f;
    if (total > 0) report += `| ${k.toUpperCase()} 1.5 | ${v.c} | ${v.f} | ${total} | ${pct(v.c, total)}% |\n`;
}
report += `\n### By Style\n`;
report += `| Style | Correct | Failed | Total | Accuracy |\n|---|---|---|---|---|\n`;
for (const [k, v] of Object.entries(o1.byStyle)) {
    const total = v.c + v.f;
    if (total > 0) report += `| ${k} | ${v.c} | ${v.f} | ${total} | ${pct(v.c, total)}% |\n`;
}

// === O/U 2.5 ===
const o2 = grandTotals.ou25;
report += `\n---\n\n## 📊 Over/Under 2.5 Goals Analysis\n\n`;
report += `**Overall:** ${o2.total} bets | ${o2.correct} correct | ${o2.total - o2.correct} wrong | **Accuracy: ${pct(o2.correct, o2.total)}%**\n\n`;
report += `### By Direction\n`;
report += `| Direction | Correct | Failed | Total | Accuracy | Notes |\n|---|---|---|---|---|---|\n`;
for (const [k, v] of Object.entries(o2.byDirection)) {
    const total = v.c + v.f;
    if (total > 0) {
        const acc = pct(v.c, total);
        report += `| ${k.toUpperCase()} 2.5 | ${v.c} | ${v.f} | ${total} | ${acc}% | ${parseFloat(acc) < 55 ? '❌ BAD' : '✅'} |\n`;
    }
}
report += `\n### By XG Total Predicted\n`;
report += `| XG Total | Correct | Failed | Total | Accuracy | Notes |\n|---|---|---|---|---|---|\n`;
const sortedXG = Object.entries(o2.byXGTotal).sort((a, b) => {
    const getNum = s => parseFloat(s.replace('<','').replace('+','').split('-')[0]);
    return getNum(a[0]) - getNum(b[0]);
});
for (const [k, v] of sortedXG) {
    const total = v.c + v.f;
    if (total > 0) {
        const acc = pct(v.c, total);
        report += `| ${k} | ${v.c} | ${v.f} | ${total} | ${acc}% | ${parseFloat(acc) < 55 ? '❌ SKIP' : '✅'} |\n`;
    }
}
report += `\n### By Style\n`;
report += `| Style | Correct | Failed | Total | Accuracy | Notes |\n|---|---|---|---|---|---|\n`;
for (const [k, v] of Object.entries(o2.byStyle)) {
    const total = v.c + v.f;
    if (total > 0) {
        const acc = pct(v.c, total);
        report += `| ${k} | ${v.c} | ${v.f} | ${total} | ${acc}% | ${parseFloat(acc) < 55 ? '❌ SKIP' : '✅'} |\n`;
    }
}

report += `\n### Actual Goal Distribution (2 weeks)\n`;
report += `| Goals | Count | % | Cumulative |\n|---|---|---|---|\n`;
const totalGoalMatches = Object.values(o2.byActualTotal).reduce((a, b) => a + b, 0);
const sortedGoals = Object.entries(o2.byActualTotal).sort((a, b) => parseInt(a[0]) - parseInt(b[0]));
let cumulative = 0;
for (const [k, count] of sortedGoals) {
    cumulative += count;
    report += `| ${k} goals | ${count} | ${pct(count, totalGoalMatches)}% | ${pct(cumulative, totalGoalMatches)}% |\n`;
}

// === O/U 3.5 ===
const o3 = grandTotals.ou35;
report += `\n---\n\n## 📊 Over/Under 3.5 Goals Analysis\n\n`;
report += `**Overall:** ${o3.total} bets | ${o3.correct} correct | ${o3.total - o3.correct} wrong | **Accuracy: ${pct(o3.correct, o3.total)}%**\n\n`;
report += `### By Direction\n`;
report += `| Direction | Correct | Failed | Total | Accuracy |\n|---|---|---|---|---|\n`;
for (const [k, v] of Object.entries(o3.byDirection)) {
    const total = v.c + v.f;
    if (total > 0) report += `| ${k.toUpperCase()} 3.5 | ${v.c} | ${v.f} | ${total} | ${pct(v.c, total)}% |\n`;
}
report += `\n### By Style\n`;
report += `| Style | Correct | Failed | Total | Accuracy |\n|---|---|---|---|---|\n`;
for (const [k, v] of Object.entries(o3.byStyle)) {
    const total = v.c + v.f;
    if (total > 0) report += `| ${k} | ${v.c} | ${v.f} | ${total} | ${pct(v.c, total)}% |\n`;
}

fs.writeFileSync('failure_analysis_2weeks.md', report);
console.log(report);
