function runAutoTuner(endedMatches, playerStats, h2hStats) {
    let bestP1 = 70;
    let bestP1Diff = 15;
    let bestP3 = 55;
    let maxDnbProfit = -9999;
    
    const p1Range = [65, 70, 75];
    const p1DiffRange = [10, 15, 20];
    const p3Range = [50, 55, 60, 65];

    p1Range.forEach(p1 => {
        p1DiffRange.forEach(p1Diff => {
            p3Range.forEach(p3 => {
                let profit = 0;
                endedMatches.forEach(m => {
                    const home = m.participantAName;
                    const away = m.participantBName;
                    
                    const hStats = playerStats[home];
                    const aStats = playerStats[away];
                    if (!hStats || !aStats || hStats.matches < 3 || aStats.matches < 3) return;
                    
                    const hWinRate = (hStats.wins / hStats.matches) * 100;
                    const aWinRate = (aStats.wins / aStats.matches) * 100;
                    
                    const pairKey = [home, away].sort().join(' vs ');
                    const h2h = h2hStats[pairKey];
                    
                    let pick = null;
                    if (!h2h || h2h.matches === 0) {
                        const winDiff = hWinRate - aWinRate;
                        if (hWinRate >= p1 && winDiff >= p1Diff) pick = home;
                        else if (aWinRate >= p1 && winDiff <= -p1Diff) pick = away;
                    } else if (h2h && h2h.matches >= 3) {
                        const h2hHomeWinRate = ((h2h[home] || 0) / h2h.matches) * 100;
                        const h2hAwayWinRate = ((h2h[away] || 0) / h2h.matches) * 100;
                        const combinedHome = (hWinRate + h2hHomeWinRate) / 2;
                        const combinedAway = (aWinRate + h2hAwayWinRate) / 2;
                        if (combinedHome >= p3) pick = home;
                        else if (combinedAway >= p3) pick = away;
                    }
                    
                    if (pick === home) {
                        if (m.teamAScore > m.teamBScore) profit += 0.85 * 5;
                        else if (m.teamAScore < m.teamBScore) profit -= 5;
                    } else if (pick === away) {
                        if (m.teamBScore > m.teamAScore) profit += 0.85 * 5;
                        else if (m.teamBScore < m.teamAScore) profit -= 5;
                    }
                });
                
                if (profit > maxDnbProfit) {
                    maxDnbProfit = profit;
                    bestP1 = p1;
                    bestP1Diff = p1Diff;
                    bestP3 = p3;
                }
            });
        });
    });

    let bestOv = 3.1;
    let bestUn = 2.0;
    let maxOuProfit = -9999;

    const ovRange = [2.9, 3.0, 3.1, 3.2, 3.3];
    const unRange = [1.8, 1.9, 2.0, 2.1, 2.2];

    ovRange.forEach(ov => {
        unRange.forEach(un => {
            let profit = 0;
            endedMatches.forEach(m => {
                const home = m.participantAName;
                const away = m.participantBName;
                
                const hStats = playerStats[home];
                const aStats = playerStats[away];
                if (!hStats || !aStats || hStats.matches < 3 || aStats.matches < 3) return;
                
                let homeXG = ((parseFloat(hStats.adjScoringAbility || hStats.avgScored) + parseFloat(aStats.adjDefendingAbility || aStats.avgConceded)) / 2);
                let awayXG = ((parseFloat(aStats.adjScoringAbility || aStats.avgScored) + parseFloat(hStats.adjDefendingAbility || hStats.avgConceded)) / 2);
                
                const calcPPM = (stats) => {
                    if (stats.matches === 0) return 0;
                    return ((stats.wins * 3) + (stats.draws * 1)) / stats.matches;
                };
                homeXG += calcPPM(hStats) * 0.25;
                awayXG += calcPPM(aStats) * 0.25;
                
                const pairKey = [home, away].sort().join(' vs ');
                const h2h = h2hStats[pairKey] || { matches: 0 };
                const baseTotalXG = homeXG + awayXG;
                let totalXG = baseTotalXG;
                
                if (h2h.matches > 0 && h2h.totalGoals !== undefined) {
                    const h2hAvgGoals = h2h.totalGoals / h2h.matches;
                    const h2hWeight = Math.min(h2h.matches * 0.15, 0.40);
                    totalXG = (1 - h2hWeight) * baseTotalXG + h2hWeight * h2hAvgGoals;
                }
                
                let ouPick = null;
                if (totalXG >= ov) ouPick = 'O';
                else if (totalXG < un) ouPick = 'U';
                
                const totalGoals = m.teamAScore + m.teamBScore;
                if (ouPick === 'O') {
                    if (totalGoals > 2.5) profit += 0.85 * 5;
                    else profit -= 5;
                } else if (ouPick === 'U') {
                    if (totalGoals < 2.5) profit += 0.85 * 5;
                    else profit -= 5;
                }
            });
            
            if (profit > maxOuProfit) {
                maxOuProfit = profit;
                bestOv = ov;
                bestUn = un;
            }
        });
    });

    return {
        optimalP1: bestP1,
        optimalP1Diff: bestP1Diff,
        optimalP3: bestP3,
        optimalOv: bestOv,
        optimalUn: bestUn
    };
}

module.exports = { runAutoTuner };
