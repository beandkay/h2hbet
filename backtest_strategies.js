const fs = require('fs');
const path = require('path');

const histDir = path.join(__dirname, 'hist_data');
const allFiles = fs.readdirSync(histDir).filter(f => f.startsWith('fifa_') && f.endsWith('.json')).sort();

console.log(`Loading ${allFiles.length} days of data...\n`);

function runStrategy(config) {
    let stats = {
        dnb: { wagered: 0, returned: 0, correct: 0, incorrect: 0, push: 0 },
        ou25: { wagered: 0, returned: 0, correct: 0, incorrect: 0 }
    };

    allFiles.forEach(file => {
        const dayData = JSON.parse(fs.readFileSync(path.join(histDir, file), 'utf8'));
        const endedMatches = dayData
            .filter(m => m.matchStatus === 'MATCH_ENDED' && !m.isCancelled)
            .sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
        if (endedMatches.length === 0) return;

        const playerStats = {};
        function initPlayer(name) {
            if (!playerStats[name]) {
                playerStats[name] = {
                    matches: 0, wins: 0, draws: 0, losses: 0,
                    goalsScored: 0, goalsConceded: 0, streak: []
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

            if (sHome.matches >= config.minMatches && sAway.matches >= config.minMatches) {
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
                const absDiff = Math.abs(diff);
                const totalXG = homeXG + awayXG;

                const hStyle = (homeAvgScored + homeAvgConceded) > 3.0 ? 'Aggressive' : 'Defensive';
                const aStyle = (awayAvgScored + awayAvgConceded) > 3.0 ? 'Aggressive' : 'Defensive';
                const bothAggressive = hStyle === 'Aggressive' && aStyle === 'Aggressive';
                const bothDefensive = hStyle === 'Defensive' && aStyle === 'Defensive';
                const atLeastOneAgg = hStyle === 'Aggressive' || aStyle === 'Aggressive';

                let actual = "";
                if (homeScore > awayScore) actual = "HOME";
                else if (homeScore < awayScore) actual = "AWAY";
                else actual = "DRAW";

                // --- DNB ---
                let minDiff = config.minDiff;
                if (config.aggVsAggMinDiff && bothAggressive) minDiff = config.aggVsAggMinDiff;

                let prediction = "";
                if (diff > minDiff) prediction = "HOME";
                else if (diff < -minDiff) prediction = "AWAY";

                if (prediction) {
                    let betSize = config.dnbBetSize;
                    if (config.tieredBetting) {
                        if (absDiff > 0.5) betSize *= 1.5;
                    }
                    
                    let dnbActualOdds = 1.85;
                    if (absDiff > 1.5) dnbActualOdds = 1.35;
                    else if (absDiff > 1.0) dnbActualOdds = 1.40;
                    else if (absDiff > 0.75) dnbActualOdds = 1.45;
                    else if (absDiff > 0.5) dnbActualOdds = 1.60;
                    else if (absDiff > 0.3) dnbActualOdds = 1.75;
                    
                    stats.dnb.wagered += betSize;
                    if (prediction === actual) {
                        stats.dnb.correct++;
                        stats.dnb.returned += (betSize * dnbActualOdds);
                    } else if (actual === "DRAW") {
                        stats.dnb.push++;
                        stats.dnb.returned += betSize;
                    } else {
                        stats.dnb.incorrect++;
                    }
                }

                // --- O/U 2.5 (Robust Combo) ---
                if (config.ou25Mode === 'robust_combo') {
                    const homeAvgTotal = (sHome.goalsScored / sHome.matches) + (sHome.goalsConceded / sHome.matches);
                    const awayAvgTotal = (sAway.goalsScored / sAway.matches) + (sAway.goalsConceded / sAway.matches);
                    
                    const hAgg = homeAvgTotal > 3.0;
                    const aAgg = awayAvgTotal > 3.0;
                    
                    const isAggVsAgg = hAgg && aAgg;
                    const isBottomTier = sHome.matches >= 3 && sAway.matches >= 3 && (sHome.wins / sHome.matches) <= 0.35 && (sAway.wins / sAway.matches) <= 0.35;
                    
                    if (isAggVsAgg || isBottomTier) {
                        let actualOU = "";
                        if (homeScore + awayScore > 2.5) actualOU = "OVER";
                        else actualOU = "UNDER";

                        let ouActualOdds = 1.85;
                        if (totalXG > 4.5) ouActualOdds = 1.35;
                        else if (totalXG > 4.0) ouActualOdds = 1.45;
                        else if (totalXG > 3.5) ouActualOdds = 1.60;
                        else if (totalXG > 3.0) ouActualOdds = 1.75;

                            stats.ou25.wagered += config.ouBetSize;
                            if (actualOU === "OVER") {
                                stats.ou25.correct++;
                                stats.ou25.returned += (config.ouBetSize * ouActualOdds);
                            } else {
                                stats.ou25.incorrect++;
                            }
                        }
                }
            }

            sHome.matches++; sAway.matches++;
            sHome.goalsScored += homeScore; sHome.goalsConceded += awayScore;
            sAway.goalsScored += awayScore; sAway.goalsConceded += homeScore;
            if (homeScore > awayScore) { sHome.wins++; sAway.losses++; sHome.streak.push('W'); sAway.streak.push('L'); }
            else if (homeScore < awayScore) { sAway.wins++; sHome.losses++; sAway.streak.push('W'); sHome.streak.push('L'); }
            else { sHome.draws++; sAway.draws++; sHome.streak.push('D'); sAway.streak.push('D'); }
        });
    });
    return stats;
}

function printResult(name, s) {
    const dnbTotal = s.dnb.correct + s.dnb.incorrect + s.dnb.push;
    const dnbAcc = s.dnb.correct + s.dnb.incorrect > 0 ? ((s.dnb.correct / (s.dnb.correct + s.dnb.incorrect)) * 100).toFixed(1) : '0';
    const ouTotal = s.ou25.correct + s.ou25.incorrect;
    const ouAcc = ouTotal > 0 ? ((s.ou25.correct / ouTotal) * 100).toFixed(1) : '0';
    const dnbProfit = s.dnb.returned - s.dnb.wagered;
    const ouProfit = s.ou25.returned - s.ou25.wagered;
    const total = dnbProfit + ouProfit;
    const totalW = s.dnb.wagered + s.ou25.wagered;
    const roi = totalW > 0 ? ((total / totalW) * 100).toFixed(2) : '0';
    console.log(`| ${name} | ${dnbTotal} | ${dnbAcc}% | $${dnbProfit.toFixed(0)} | ${ouTotal} | ${ouAcc}% | $${ouProfit.toFixed(0)} | **$${total.toFixed(0)}** | **${roi}%** |`);
}

console.log(`| Strategy | DNB Bets | DNB Acc | DNB P/L | OU Bets | OU Acc | OU P/L | **Total P/L** | **ROI** |`);
console.log(`|---|---|---|---|---|---|---|---|---|`);

// Current Model (Old Logic)
printResult(`OLD LOGIC`, runStrategy({
    minMatches: 3, minDiff: 0.20, dnbBetSize: 10, ouBetSize: 10,
    ou25Mode: 'none', tieredBetting: false
}));

console.log(`|---|---|---|---|---|---|---|---|---|`);

// New Robust Combo
printResult(`ROBUST COMBO`, runStrategy({
    minMatches: 5, minDiff: 0.20, aggVsAggMinDiff: 0.50, dnbBetSize: 10, ouBetSize: 10,
    ou25Mode: 'robust_combo', tieredBetting: true
}));

console.log(`|---|---|---|---|---|---|---|---|---|`);

// DNB ONLY
printResult(`DNB ONLY (tiered)`, runStrategy({
    minMatches: 5, minDiff: 0.20, aggVsAggMinDiff: 0.50, dnbBetSize: 10, ouBetSize: 10,
    ou25Mode: 'none', tieredBetting: true
}));
