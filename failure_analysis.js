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

function initPlayer(name) {
    if (!playerStats[name]) {
        playerStats[name] = {
            matches: 0, wins: 0, draws: 0, losses: 0,
            goalsScored: 0, goalsConceded: 0, streak: [],
            lastGoals: []  // track goal totals per match
        };
    }
}

// --- Failure tracking ---
const failures = {
    winner: [],    // Wrong WIN/DNB predictions
    ou15: [],      // Wrong O/U 1.5
    ou25: [],      // Wrong O/U 2.5
    ou35: []       // Wrong O/U 3.5
};

// Pattern counters
const patternCounters = {
    winner: {
        total: 0, correct: 0,
        // Breakdown by category
        byXGDiff: { tiny: { c: 0, f: 0 }, small: { c: 0, f: 0 }, medium: { c: 0, f: 0 }, large: { c: 0, f: 0 } },
        byHour: {},
        byDrawRate: { low: { c: 0, f: 0 }, mid: { c: 0, f: 0 }, high: { c: 0, f: 0 } },
        byStreak: {},
        byWinRateDiff: { tiny: { c: 0, f: 0 }, small: { c: 0, f: 0 }, medium: { c: 0, f: 0 }, large: { c: 0, f: 0 } },
        byMatchesPlayed: { early: { c: 0, f: 0 }, mid: { c: 0, f: 0 }, late: { c: 0, f: 0 } },
        failedToDraws: 0,
        failedToUpsets: 0,
        byStyle: {}
    },
    ou25: {
        total: 0, correct: 0,
        byPredDirection: { over: { c: 0, f: 0 }, under: { c: 0, f: 0 } },
        byXGTotal: {},
        byStyle: {},
        byActualTotal: {}
    }
};

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

        // Determine player styles
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
            patternCounters.winner.total++;

            // Categorize XG diff
            const absDiff = Math.abs(diff);
            let xgBucket = absDiff > 1.0 ? 'large' : absDiff > 0.5 ? 'medium' : absDiff > 0.2 ? 'small' : 'tiny';

            // Win rate diff bucket
            const winRateDiff = Math.abs(homeWinRate - awayWinRate);
            let wrBucket = winRateDiff > 0.3 ? 'large' : winRateDiff > 0.15 ? 'medium' : winRateDiff > 0.05 ? 'small' : 'tiny';

            // Draw rate bucket
            let drBucket = avgDrawRate > 0.25 ? 'high' : avgDrawRate > 0.12 ? 'mid' : 'low';

            // Matches played bucket
            let mpBucket = favPlayerMatches <= 5 ? 'early' : favPlayerMatches <= 9 ? 'mid' : 'late';

            // Hour bucket
            const hourKey = `H${hourOfRotation}`;
            if (!patternCounters.winner.byHour[hourKey]) patternCounters.winner.byHour[hourKey] = { c: 0, f: 0 };

            // Streak bucket
            const favStreak = prediction === "HOME" ? sHome.streak.slice(-3).join('') : sAway.streak.slice(-3).join('');
            if (!patternCounters.winner.byStreak[favStreak]) patternCounters.winner.byStreak[favStreak] = { c: 0, f: 0 };

            // Style bucket
            if (!patternCounters.winner.byStyle[matchStyle]) patternCounters.winner.byStyle[matchStyle] = { c: 0, f: 0 };

            const isCorrect = (prediction === actual) || (betType === "DNB" && actual === "DRAW");

            if (isCorrect) {
                patternCounters.winner.correct++;
                patternCounters.winner.byXGDiff[xgBucket].c++;
                patternCounters.winner.byHour[hourKey].c++;
                patternCounters.winner.byDrawRate[drBucket].c++;
                patternCounters.winner.byStreak[favStreak].c++;
                patternCounters.winner.byWinRateDiff[wrBucket].c++;
                patternCounters.winner.byMatchesPlayed[mpBucket].c++;
                patternCounters.winner.byStyle[matchStyle].c++;
            } else {
                patternCounters.winner.byXGDiff[xgBucket].f++;
                patternCounters.winner.byHour[hourKey].f++;
                patternCounters.winner.byDrawRate[drBucket].f++;
                patternCounters.winner.byStreak[favStreak].f++;
                patternCounters.winner.byWinRateDiff[wrBucket].f++;
                patternCounters.winner.byMatchesPlayed[mpBucket].f++;
                patternCounters.winner.byStyle[matchStyle].f++;

                if (actual === "DRAW") patternCounters.winner.failedToDraws++;
                else patternCounters.winner.failedToUpsets++;

                failures.winner.push({
                    home, away, homeScore, awayScore,
                    prediction, actual, betType,
                    diff: diff.toFixed(2), absDiff: absDiff.toFixed(2),
                    homeXG: homeXG.toFixed(2), awayXG: awayXG.toFixed(2),
                    homeWinRate: (homeWinRate * 100).toFixed(0) + '%',
                    awayWinRate: (awayWinRate * 100).toFixed(0) + '%',
                    avgDrawRate: (avgDrawRate * 100).toFixed(0) + '%',
                    hourOfRotation, matchStyle,
                    favStreak,
                    favMatches: favPlayerMatches,
                    homeStreak: sHome.streak.slice(-5).join(''),
                    awayStreak: sAway.streak.slice(-5).join(''),
                });
            }
        }

        // O/U 2.5 analysis
        const totalXG = homeXG + awayXG;
        const predOU = totalXG > 3.1 ? "OVER" : "UNDER";
        const actualTotal = homeScore + awayScore;
        const actualOU = actualTotal > 2.5 ? "OVER" : "UNDER";

        patternCounters.ou25.total++;
        const xgTotalKey = totalXG < 3.0 ? '<3.0' : totalXG < 3.5 ? '3.0-3.5' : totalXG < 4.0 ? '3.5-4.0' : '4.0+';
        if (!patternCounters.ou25.byXGTotal[xgTotalKey]) patternCounters.ou25.byXGTotal[xgTotalKey] = { c: 0, f: 0 };
        if (!patternCounters.ou25.byStyle[matchStyle]) patternCounters.ou25.byStyle[matchStyle] = { c: 0, f: 0 };
        const actualTotalKey = `goals_${actualTotal}`;
        if (!patternCounters.ou25.byActualTotal[actualTotalKey]) patternCounters.ou25.byActualTotal[actualTotalKey] = 0;
        patternCounters.ou25.byActualTotal[actualTotalKey]++;

        if (predOU === actualOU) {
            patternCounters.ou25.correct++;
            patternCounters.ou25.byPredDirection[predOU.toLowerCase()].c++;
            patternCounters.ou25.byXGTotal[xgTotalKey].c++;
            patternCounters.ou25.byStyle[matchStyle].c++;
        } else {
            patternCounters.ou25.byPredDirection[predOU.toLowerCase()].f++;
            patternCounters.ou25.byXGTotal[xgTotalKey].f++;
            patternCounters.ou25.byStyle[matchStyle].f++;
            failures.ou25.push({
                home, away, homeScore, awayScore, actualTotal,
                predOU, actualOU, totalXG: totalXG.toFixed(2),
                homeXG: homeXG.toFixed(2), awayXG: awayXG.toFixed(2),
                matchStyle, hourOfRotation
            });
        }

        // O/U 1.5 analysis
        const predOU15 = totalXG > 1.5 ? "OVER" : "UNDER";
        const actualOU15 = actualTotal > 1.5 ? "OVER" : "UNDER";
        if (predOU15 !== actualOU15) {
            failures.ou15.push({
                home, away, homeScore, awayScore, actualTotal,
                predOU15, actualOU15, totalXG: totalXG.toFixed(2),
                matchStyle, hourOfRotation
            });
        }
    }

    // Update stats
    sHome.matches++;
    sAway.matches++;
    sHome.goalsScored += homeScore;
    sHome.goalsConceded += awayScore;
    sAway.goalsScored += awayScore;
    sAway.goalsConceded += homeScore;
    sHome.lastGoals.push(homeScore + awayScore);
    sAway.lastGoals.push(homeScore + awayScore);

    if (homeScore > awayScore) {
        sHome.wins++; sAway.losses++;
        sHome.streak.push('W'); sAway.streak.push('L');
    } else if (homeScore < awayScore) {
        sAway.wins++; sHome.losses++;
        sAway.streak.push('W'); sHome.streak.push('L');
    } else {
        sHome.draws++; sAway.draws++;
        sHome.streak.push('D'); sAway.streak.push('D');
    }
});

// --- Generate Report ---
let report = `# 🔬 Failure Pattern Analysis Report\n\n`;
report += `**Rotation:** ${rotStart.toISOString()} to ${rotEnd.toISOString()}\n`;
report += `**Total Ended Matches:** ${endedMatches.length}\n\n`;

// === WINNER FAILURES ===
const wc = patternCounters.winner;
report += `## 🏆 Winner Prediction Failures\n\n`;
report += `**Overall:** ${wc.total} bets | ${wc.correct} correct | ${wc.total - wc.correct} wrong | **Accuracy: ${((wc.correct / wc.total) * 100).toFixed(1)}%**\n\n`;
report += `**Failure Breakdown:** ${wc.failedToDraws} lost to DRAWS | ${wc.failedToUpsets} lost to UPSETS\n\n`;

report += `### By XG Difference (Prediction Confidence)\n`;
report += `| XG Diff | Correct | Failed | Accuracy | Notes |\n|---|---|---|---|---|\n`;
for (const [k, v] of Object.entries(wc.byXGDiff)) {
    const total = v.c + v.f;
    if (total > 0) {
        const acc = ((v.c / total) * 100).toFixed(1);
        const label = k === 'tiny' ? '0.00-0.20' : k === 'small' ? '0.20-0.50' : k === 'medium' ? '0.50-1.00' : '1.00+';
        report += `| ${label} | ${v.c} | ${v.f} | ${acc}% | ${parseFloat(acc) < 55 ? '⚠️ WEAK' : '✅'} |\n`;
    }
}

report += `\n### By Hour of Rotation\n`;
report += `| Hour | Correct | Failed | Accuracy |\n|---|---|---|---|\n`;
const sortedHours = Object.entries(wc.byHour).sort((a, b) => parseInt(a[0].slice(1)) - parseInt(b[0].slice(1)));
for (const [k, v] of sortedHours) {
    const total = v.c + v.f;
    if (total > 0) {
        report += `| ${k} | ${v.c} | ${v.f} | ${((v.c / total) * 100).toFixed(1)}% |\n`;
    }
}

report += `\n### By Favorite's Draw Rate\n`;
report += `| Draw Rate | Correct | Failed | Accuracy | Notes |\n|---|---|---|---|---|\n`;
for (const [k, v] of Object.entries(wc.byDrawRate)) {
    const total = v.c + v.f;
    if (total > 0) {
        const acc = ((v.c / total) * 100).toFixed(1);
        const label = k === 'low' ? '<12%' : k === 'mid' ? '12-25%' : '>25%';
        report += `| ${label} | ${v.c} | ${v.f} | ${acc}% | ${parseFloat(acc) < 55 ? '⚠️ HIGH DRAW ZONE' : '✅'} |\n`;
    }
}

report += `\n### By Win Rate Differential\n`;
report += `| WR Diff | Correct | Failed | Accuracy | Notes |\n|---|---|---|---|---|\n`;
for (const [k, v] of Object.entries(wc.byWinRateDiff)) {
    const total = v.c + v.f;
    if (total > 0) {
        const acc = ((v.c / total) * 100).toFixed(1);
        const label = k === 'tiny' ? '<5%' : k === 'small' ? '5-15%' : k === 'medium' ? '15-30%' : '30%+';
        report += `| ${label} | ${v.c} | ${v.f} | ${acc}% | ${parseFloat(acc) < 55 ? '⚠️ WEAK' : '✅'} |\n`;
    }
}

report += `\n### By Matches Played (Sample Size)\n`;
report += `| Matches | Correct | Failed | Accuracy | Notes |\n|---|---|---|---|---|\n`;
for (const [k, v] of Object.entries(wc.byMatchesPlayed)) {
    const total = v.c + v.f;
    if (total > 0) {
        const acc = ((v.c / total) * 100).toFixed(1);
        const label = k === 'early' ? '3-5 matches' : k === 'mid' ? '6-9 matches' : '10+ matches';
        report += `| ${label} | ${v.c} | ${v.f} | ${acc}% | ${parseFloat(acc) < 55 ? '⚠️ UNRELIABLE' : '✅'} |\n`;
    }
}

report += `\n### By Favorite's Last 3 Streak\n`;
report += `| Streak | Correct | Failed | Accuracy |\n|---|---|---|---|\n`;
const sortedStreaks = Object.entries(wc.byStreak).sort((a, b) => {
    const aTotal = a[1].c + a[1].f;
    const bTotal = b[1].c + b[1].f;
    return bTotal - aTotal;
});
for (const [k, v] of sortedStreaks) {
    const total = v.c + v.f;
    if (total >= 2) {
        report += `| ${k || '(empty)'} | ${v.c} | ${v.f} | ${((v.c / total) * 100).toFixed(1)}% |\n`;
    }
}

report += `\n### By Match Style\n`;
report += `| Style | Correct | Failed | Accuracy |\n|---|---|---|---|\n`;
for (const [k, v] of Object.entries(wc.byStyle)) {
    const total = v.c + v.f;
    if (total > 0) {
        report += `| ${k} | ${v.c} | ${v.f} | ${((v.c / total) * 100).toFixed(1)}% |\n`;
    }
}

// === O/U 2.5 FAILURES ===
const oc = patternCounters.ou25;
report += `\n## 📊 Over/Under 2.5 Goals Failures\n\n`;
report += `**Overall:** ${oc.total} bets | ${oc.correct} correct | ${oc.total - oc.correct} wrong | **Accuracy: ${((oc.correct / oc.total) * 100).toFixed(1)}%**\n\n`;

report += `### By Prediction Direction\n`;
report += `| Direction | Correct | Failed | Accuracy |\n|---|---|---|---|\n`;
for (const [k, v] of Object.entries(oc.byPredDirection)) {
    const total = v.c + v.f;
    if (total > 0) report += `| ${k.toUpperCase()} 2.5 | ${v.c} | ${v.f} | ${((v.c / total) * 100).toFixed(1)}% |\n`;
}

report += `\n### By Total XG Predicted\n`;
report += `| XG Total | Correct | Failed | Accuracy |\n|---|---|---|---|\n`;
for (const [k, v] of Object.entries(oc.byXGTotal)) {
    const total = v.c + v.f;
    if (total > 0) report += `| ${k} | ${v.c} | ${v.f} | ${((v.c / total) * 100).toFixed(1)}% |\n`;
}

report += `\n### By Match Style\n`;
report += `| Style | Correct | Failed | Accuracy |\n|---|---|---|---|\n`;
for (const [k, v] of Object.entries(oc.byStyle)) {
    const total = v.c + v.f;
    if (total > 0) report += `| ${k} | ${v.c} | ${v.f} | ${((v.c / total) * 100).toFixed(1)}% |\n`;
}

report += `\n### Actual Goal Distribution\n`;
report += `| Goals | Count | % |\n|---|---|---|\n`;
const totalGoalMatches = Object.values(oc.byActualTotal).reduce((a, b) => a + b, 0);
const sortedGoals = Object.entries(oc.byActualTotal).sort((a, b) => parseInt(a[0].split('_')[1]) - parseInt(b[0].split('_')[1]));
for (const [k, count] of sortedGoals) {
    const goals = k.split('_')[1];
    report += `| ${goals} goals | ${count} | ${((count / totalGoalMatches) * 100).toFixed(1)}% |\n`;
}

// === INDIVIDUAL FAILURE LOG ===
report += `\n## 📋 Individual Winner Failures (${failures.winner.length} total)\n\n`;
report += `| # | Match | Score | Predicted | Actual | XG Diff | WR Gap | Draw% | Hour | Style | Fav Streak | Fav Games |\n`;
report += `|---|---|---|---|---|---|---|---|---|---|---|---|\n`;
failures.winner.forEach((f, idx) => {
    report += `| ${idx + 1} | ${f.home} vs ${f.away} | ${f.homeScore}-${f.awayScore} | ${f.prediction} (${f.betType}) | ${f.actual} | ${f.absDiff} | ${f.homeWinRate}/${f.awayWinRate} | ${f.avgDrawRate} | H${f.hourOfRotation} | ${f.matchStyle} | ${f.favStreak} | ${f.favMatches} |\n`;
});

report += `\n## 📋 Individual O/U 2.5 Failures (${failures.ou25.length} total)\n\n`;
report += `| # | Match | Score | Total | Pred | Actual | XG | Style | Hour |\n`;
report += `|---|---|---|---|---|---|---|---|---|\n`;
failures.ou25.forEach((f, idx) => {
    report += `| ${idx + 1} | ${f.home} vs ${f.away} | ${f.homeScore}-${f.awayScore} | ${f.actualTotal} | ${f.predOU} | ${f.actualOU} | ${f.totalXG} | ${f.matchStyle} | H${f.hourOfRotation} |\n`;
});

report += `\n## 📋 O/U 1.5 Failures (${failures.ou15.length} total)\n\n`;
report += `| # | Match | Score | Total | Pred | Actual | XG | Style | Hour |\n`;
report += `|---|---|---|---|---|---|---|---|---|\n`;
failures.ou15.forEach((f, idx) => {
    report += `| ${idx + 1} | ${f.home} vs ${f.away} | ${f.homeScore}-${f.awayScore} | ${f.actualTotal} | ${f.predOU15} | ${f.actualOU15} | ${f.totalXG} | ${f.matchStyle} | H${f.hourOfRotation} |\n`;
});

fs.writeFileSync('failure_analysis.md', report);
console.log(report);
