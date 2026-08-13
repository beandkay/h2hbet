function generatePredictions(matches, playerStats, h2hStats) {
    const kryptoniteSet = new Set([
        "DEZZY vs FRANCHISE", "ALIBI vs VAPOR", "MAGICIAN vs VIRUS",
        "RIFT vs RIVAL", "ATLAS vs RIFT", "LAVA vs SPARTAN",
        "DECIMATOR vs RIVAL", "BULLFROG vs DART", "FRANCHISE vs LAVA", "MYSTERY vs VENUS"
    ]);

    const activePlayers = new Set();
    matches.forEach(m => {
        activePlayers.add(m.participantAName);
        activePlayers.add(m.participantBName);
    });

    matches.forEach(m => {
        const home = m.participantAName;
        const away = m.participantBName;
        
        const sHome = playerStats[home];
        const sAway = playerStats[away];
        
        let prediction = "";
        let totalXG = 0;
        let homeXG = 0;
        let awayXG = 0;
        let ouPrediction = "";
        
        if (!sHome || !sAway || sHome.matches < 5 || sAway.matches < 5) {
            prediction = `*SKIP (Building Stats - Needs 5+ matches)*`;
            ouPrediction = `*SKIP*`;
            m.computedPrediction = prediction;
            m.ouPrediction = ouPrediction;
            m.isOUPick = false;
            return;
        }

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
        
        const pairKey = [home, away].sort().join(' vs ');
        const isKryptonite = kryptoniteSet.has(pairKey);
        
        const hStyle = (parseFloat(sHome.avgScored) + parseFloat(sHome.avgConceded)) > 3.0 ? 'Aggressive' : 'Defensive';
        const aStyle = (parseFloat(sAway.avgScored) + parseFloat(sAway.avgConceded)) > 3.0 ? 'Aggressive' : 'Defensive';
        
        const isAggVsAgg = hStyle === 'Aggressive' && aStyle === 'Aggressive';
        const isBottomTier = parseFloat(sHome.winRate) <= 10 && parseFloat(sAway.winRate) <= 10 && sHome.matches >= 5 && sAway.matches >= 5;

        if (isAggVsAgg || isBottomTier) {
            ouPrediction = `**OVER 2.5 Goals**`;
            if (isAggVsAgg) ouPrediction += ' *(Aggressive Matchup)*';
            if (isBottomTier) ouPrediction += ' *(Bottom-Tier Shootout)*';
        } else if ((homeXG + awayXG) < 2.5 && hStyle === 'Defensive' && aStyle === 'Defensive') {
            ouPrediction = `**UNDER 2.5 Goals**`;
        } else {
            ouPrediction = `*SKIP (Neutral XG)*`;
        }

        // --- Uncertainty Score Calculation ---
        const calcUncertainty = (stats) => {
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
            return Math.min(score, 100);
        };
        
        const homeUnc = calcUncertainty(sHome);
        const awayUnc = calcUncertainty(sAway);
        
        const bothAggressive = hStyle === 'Aggressive' && aStyle === 'Aggressive';
        const wrDiff = Math.abs(homeWinRate - awayWinRate);
        let isValidDnb = wrDiff > (bothAggressive ? 0.50 : 0.20);
        
        let pick = null;
        let h2hPreferred = false;
        
        // Check H2H Dominance (Requires > 60% win rate)
        let h2hDominantPlayer = null;
        if (h2hStats[pairKey] && h2hStats[pairKey].matches >= 3) {
            const stat = h2hStats[pairKey];
            const p1Wins = stat[home] || 0;
            const p2Wins = stat[away] || 0;
            const maxWins = Math.max(p1Wins, p2Wins);
            const winRate = (maxWins / stat.matches) * 100;
            
            if (winRate > 60) {
                if (p1Wins > p2Wins) h2hDominantPlayer = home;
                if (p2Wins > p1Wins) h2hDominantPlayer = away;
            }
        }

        if (h2hDominantPlayer) {
            pick = h2hDominantPlayer;
            h2hPreferred = true;
            isValidDnb = true; // Override to force prediction
        } else if (isValidDnb) {
            pick = homeWinRate > awayWinRate ? home : away;
        }
        
        const formatFav = (name, type, unc) => {
            const riskStr = unc > 60 ? `[Uncertainty: ${unc}/100 - HIGH RISK]` : `[Uncertainty: ${unc}/100]`;
            return `**${name} wins (${type})** ${riskStr}`;
        };

        if (isValidDnb && pick) {
            const unc = pick === home ? homeUnc : awayUnc;
            prediction = formatFav(pick, h2hPreferred ? 'Draw No Bet (H2H Edge)' : 'Draw No Bet (Value Edge)', unc);
            if (h2hPreferred) {
                prediction += " 🌟 **[H2H PREFERRED]**";
            }
        } else {
            prediction = `*SKIP (Not a Value Edge)*`;
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
        m.isOUPick = ouPrediction.includes('OVER') || ouPrediction.includes('UNDER');
        m.h2hPreferred = h2hPreferred;
        m.computedXgDiff = Math.abs(diff);
    });

    return { matches, activePlayers };
}

module.exports = {
    generatePredictions
};
