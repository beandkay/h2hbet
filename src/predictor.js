function generatePredictions(matches, playerStats, h2hStats, opts = {}) {
    const kryptoniteSet = new Set([
        "DEZZY vs FRANCHISE", "ALIBI vs VAPOR", "MAGICIAN vs VIRUS",
        "RIFT vs RIVAL", "ATLAS vs RIFT", "LAVA vs SPARTAN",
        "DECIMATOR vs RIVAL", "BULLFROG vs DART", "FRANCHISE vs LAVA", "MYSTERY vs VENUS"
    ]);

    // Optional: 10-day slot performance function passed from analyze_patterns.js
    const getSlotPerf = opts.getSlotPerformance || null;

    const activePlayers = new Set();
    matches.forEach(m => {
        activePlayers.add(m.participantAName);
        activePlayers.add(m.participantBName);
    });

    matches.forEach(m => {
        const home = m.participantAName;
        const away = m.participantBName;
        
        let sHome = playerStats[home] || { avgScored: 0, avgConceded: 0, wins: 0, draws: 0, losses: 0, matches: 0, streak: [], goalsList: [], concededList: [], winRate: 0, adjScoringAbility: 0, adjDefendingAbility: 0 };
        let sAway = playerStats[away] || { avgScored: 0, avgConceded: 0, wins: 0, draws: 0, losses: 0, matches: 0, streak: [], goalsList: [], concededList: [], winRate: 0, adjScoringAbility: 0, adjDefendingAbility: 0 };
        
        let prediction = "";
        let ouPrediction = "";
        
        const needsStats = (!sHome || !sAway || sHome.matches < 3 || sAway.matches < 3);

        // --- Opponent-Adjusted xG ---
        let homeXG = ((parseFloat(sHome.adjScoringAbility) + parseFloat(sAway.adjDefendingAbility)) / 2);
        let awayXG = ((parseFloat(sAway.adjScoringAbility) + parseFloat(sHome.adjDefendingAbility)) / 2);
        
        const calcPPM = (stats) => {
            if (stats.matches === 0) return 0;
            return ((stats.wins * 3) + (stats.draws * 1)) / stats.matches;
        };
        homeXG += calcPPM(sHome) * 0.25;
        awayXG += calcPPM(sAway) * 0.25;
        
        const homeWinRate = sHome.matches > 0 ? (sHome.wins / sHome.matches) * 100 : 0;
        const awayWinRate = sAway.matches > 0 ? (sAway.wins / sAway.matches) * 100 : 0;
        
        const aestDate = new Date(new Date(m.startDate).getTime() + 10 * 60 * 60 * 1000);
        let hourOfRotation = aestDate.getUTCHours();
        if (hourOfRotation >= 4 && hourOfRotation < 16) hourOfRotation = hourOfRotation - 3;
        else if (hourOfRotation >= 16) hourOfRotation = hourOfRotation - 15;
        else hourOfRotation = hourOfRotation + 9;
        
        const pairKey = [home, away].sort().join(' vs ');
        const isKryptonite = kryptoniteSet.has(pairKey);
        
        const hStyle = (parseFloat(sHome.avgScored) + parseFloat(sHome.avgConceded)) > 3.0 ? 'Aggressive' : 'Defensive';
        const aStyle = (parseFloat(sAway.avgScored) + parseFloat(sAway.avgConceded)) > 3.0 ? 'Aggressive' : 'Defensive';
        
        // --- H2H-Weighted xG Blending ---
        const h2h = h2hStats[pairKey] || { matches: 0 };
        const baseTotalXG = homeXG + awayXG;
        let totalXG = baseTotalXG;
        
        if (h2h.matches > 0 && h2h.totalGoals !== undefined) {
            const h2hAvgGoals = h2h.totalGoals / h2h.matches;
            const h2hWeight = Math.min(h2h.matches * 0.15, 0.40);
            totalXG = (1 - h2hWeight) * baseTotalXG + h2hWeight * h2hAvgGoals;
            if (baseTotalXG > 0) {
                const scale = totalXG / baseTotalXG;
                homeXG *= scale;
                awayXG *= scale;
            }
        }

        // --- Optimal Historical 31-Day Logic ---
        let pick = null;
        let pPick = pick;
        let dnbPick = "N/A";
        let phase = "Phase 2 (Skipped)";

        // Strict Phase Separation
        if (h2h.matches === 0) {
            const optimalP1 = opts.optimalP1 || 70;
            const optimalP1Diff = opts.optimalP1Diff || 15;
            const winDiff = homeWinRate - awayWinRate;
            
            if (homeWinRate >= optimalP1 && winDiff >= optimalP1Diff) {
                pPick = home;
                pick = home;
                dnbPick = `${home} DNB`;
                phase = "Phase 1: Form Dominance";
            } else if (awayWinRate >= optimalP1 && winDiff <= -optimalP1Diff) {
                pPick = away;
                pick = away;
                dnbPick = `${away} DNB`;
                phase = "Phase 1: Form Dominance";
            }
        } else if (h2h.matches >= 3) {
            const h2hHomeWinRate = ((h2h[home] || 0) / h2h.matches) * 100;
            const h2hAwayWinRate = ((h2h[away] || 0) / h2h.matches) * 100;
            const combinedHome = (homeWinRate + h2hHomeWinRate) / 2;
            const combinedAway = (awayWinRate + h2hAwayWinRate) / 2;
            const optimalP3 = opts.optimalP3 || 55;
            
            if (combinedHome >= optimalP3) {
                pPick = home;
                pick = home;
                dnbPick = `${home} DNB`;
                phase = "Phase 3: H2H Dominance";
            } else if (combinedAway >= optimalP3) {
                pPick = away;
                pick = away;
                dnbPick = `${away} DNB`;
                phase = "Phase 3: H2H Dominance";
            }
        }

        // Slot Performance
        const homeSlotPerf = getSlotPerf ? getSlotPerf(home, m.startDate) : null;
        const awaySlotPerf = getSlotPerf ? getSlotPerf(away, m.startDate) : null;

        // --- Uncertainty Score Calculation ---
        const calcUncertainty = (stats, slotPerf) => {
            let score = 0;
            const recentStreak = stats.streak.slice(-5).join('');
            if (recentStreak.endsWith('WWWW') || recentStreak.endsWith('WWWWW')) score += 40;
            
            let recentG = 0, recentC = 0;
            stats.goalsList.slice(-3).forEach(g => recentG += g);
            stats.concededList.slice(-3).forEach(c => recentC += c);
            if ((recentG - recentC) >= 3) score += 30;
            
            if (hourOfRotation <= 4) score += 20;
            
            const recentDraws = stats.streak.slice(-3).filter(x => x === 'D').length;
            if (recentDraws === 0) score += 10;
            
            if (slotPerf && slotPerf.status === 'COLD') score += 15;
            if (slotPerf && slotPerf.status === 'PEAK') score = Math.max(0, score - 10);
            
            return Math.min(score, 100);
        };
        
        const homeUnc = calcUncertainty(sHome, homeSlotPerf);
        const awayUnc = calcUncertainty(sAway, awaySlotPerf);

        if (pPick) {
            const unc = pPick === home ? homeUnc : awayUnc;
            if (pPick === "DRAW") {
                prediction = `**DRAW** (${phase}) [Uncertainty: ${Math.max(homeUnc, awayUnc)}/100]`;
            } else {
                prediction = `**${pPick} wins (${phase})** [Uncertainty: ${unc}/100]`;
                if (isKryptonite) prediction += " ⚠️ **[KRYPTONITE ALERT]**";
            }
        } else {
            prediction = `*SKIP (No Edge)*`;
        }

        // --- O/U Prediction ---
        const isAggVsAgg = hStyle === 'Aggressive' && aStyle === 'Aggressive';
        const isDefVsDef = hStyle === 'Defensive' && aStyle === 'Defensive';
        const isBottomTier = homeWinRate < 40 && awayWinRate < 40;

        let ou25Pick = "*SKIP*";
        const optimalOv = opts.optimalOv || 3.1;
        const optimalUn = opts.optimalUn || 2.0;
        
        if (totalXG >= optimalOv) {
            ou25Pick = "**OVER 2.5**";
        } else if (totalXG < optimalUn) {
            ou25Pick = "**UNDER 2.5**";
        }
        
        let combinedAcc = 0;
        // --- FEATURE: Historical OU 50% Filter ---
        if (opts.historicalOUStats) {
            const hOU = opts.historicalOUStats[home] || { bets: 0, correct: 0 };
            const aOU = opts.historicalOUStats[away] || { bets: 0, correct: 0 };
            const totalOUBets = hOU.bets + aOU.bets;
            const totalOUCorrect = hOU.correct + aOU.correct;
            combinedAcc = totalOUBets > 0 ? (totalOUCorrect / totalOUBets) * 100 : 0;
            
            if (ou25Pick !== "*SKIP*" && totalOUBets >= 10 && combinedAcc < 50) {
                ou25Pick = "*SKIP* (Poor OU History)";
            }
        }

        ouPrediction = (totalXG > 1.5 ? `**OVER 1.5**` : `**UNDER 1.5**`) + ` | ` + ou25Pick + ` | ` + (totalXG > 3.0 ? `**OVER 3.0** (Goal Line - Push on 3)` : `*NO BET (GL 3.0)*`);

        if (needsStats) {
            prediction = `*SKIP (Building Stats - Needs 3+ matches)*`;
            ouPrediction = `*SKIP*`;
            ou25Pick = "*SKIP*";
        }

        m.computedTotalXG = homeXG + awayXG;
        m.computedHomeStyle = hStyle;
        m.computedAwayStyle = aStyle;
        m.computedPrediction = prediction;
        m.computedHome = home;
        m.computedAway = away;
        m.computedHomeUnc = homeUnc;
        m.computedAwayUnc = awayUnc;
        m.ouPrediction = ouPrediction;
        m.ou25Pick = ou25Pick;
        m.ouCombinedWinrate = combinedAcc;
        m.isOUPick = ouPrediction.includes('OVER') || ouPrediction.includes('UNDER');
        m.h2hPreferred = phase === "Phase 3: H2H Dominance";
        
        let h2hWinrate = 0;
        let h2hFavored = "N/A";
        if (h2h.matches > 0) {
            let hWins = h2h[home] || 0;
            let aWins = h2h[away] || 0;
            if (hWins > aWins) {
                h2hFavored = home;
                h2hWinrate = (hWins / h2h.matches) * 100;
            } else if (aWins > hWins) {
                h2hFavored = away;
                h2hWinrate = (aWins / h2h.matches) * 100;
            } else {
                h2hFavored = "DRAW";
            }
        }
        m.h2hFavored = h2hFavored;
        m.h2hWinrate = h2hWinrate;

        m.computedXgDiff = Math.abs(homeXG - awayXG);
        m.homeAdjScored = sHome.adjScoringAbility || sHome.avgScored;
        m.homeAdjDefended = sHome.adjDefendingAbility || sHome.avgConceded;
        m.awayAdjScored = sAway.adjScoringAbility || sAway.avgScored;
        m.awayAdjDefended = sAway.adjDefendingAbility || sAway.avgConceded;
        m.homeRecent = sHome.streak || [];
        m.awayRecent = sAway.streak || [];
    });

    return { matches, activePlayers };
}

module.exports = {
    generatePredictions
};
