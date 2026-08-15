const fs = require('fs');
const path = require('path');
const { calculateStatistics } = require('../src/statistics');
const { calculateH2H } = require('../src/h2h_engine');

function groupMatchesByRotation(matches) {
    const blocks = {};
    matches.forEach(m => {
        if (m.matchStatus !== 'MATCH_ENDED' || m.isCancelled) return;
        const aestDate = new Date(new Date(m.startDate).getTime() + 10 * 60 * 60 * 1000);
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
    for (let key in blocks) blocks[key].sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
    return blocks;
}

// ---- Parameterized H2H winner predictor (mirrors src/predictor_h2h.js decision logic) ----
function genH2HVariant(matches, playerStats, h2hStats, historicalH2HStats, cfg) {
    const results = [];
    matches.forEach(m => {
        const home = m.participantAName;
        const away = m.participantBName;
        let sHome = playerStats[home] || { matches: 0, wins: 0, streak: [] };
        let sAway = playerStats[away] || { matches: 0, wins: 0, streak: [] };

        const needsStats = (sHome.matches < cfg.minMatchesForStats || sAway.matches < cfg.minMatchesForStats);

        const homeWinRate = sHome.matches > 0 ? (sHome.wins / sHome.matches) * 100 : 0;
        const awayWinRate = sAway.matches > 0 ? (sAway.wins / sAway.matches) * 100 : 0;

        const pairKey = [home, away].sort().join(' vs ');
        const h2h = h2hStats[pairKey] || { matches: 0 };
        let h2hMatches = h2h.matches || 0;
        let h2hHomeWins = h2h[home] || 0;
        let h2hAwayWins = h2h[away] || 0;

        let predictionType = "SKIP";
        let pick = null;

        if (h2hMatches < 3) {
            if (sHome.matches >= cfg.phase1MinMatches && sAway.matches >= cfg.phase1MinMatches) {
                if (homeWinRate >= cfg.phase1HighWR && awayWinRate <= cfg.phase1LowWR) {
                    pick = home; predictionType = "PHASE1";
                } else if (awayWinRate >= cfg.phase1HighWR && homeWinRate <= cfg.phase1LowWR) {
                    pick = away; predictionType = "PHASE1";
                }
            }
        } else if (h2hMatches >= 3 && h2hMatches <= 9) {
            const h2hHomeWR = (h2hHomeWins / h2hMatches) * 100;
            const h2hAwayWR = (h2hAwayWins / h2hMatches) * 100;
            if (h2hHomeWR >= cfg.phase2H2HWR && homeWinRate >= cfg.phase2FormWR) {
                pick = home; predictionType = "PHASE2";
            } else if (h2hAwayWR >= cfg.phase2H2HWR && awayWinRate >= cfg.phase2FormWR) {
                pick = away; predictionType = "PHASE2";
            }
        } else {
            const h2hHomeWR = (h2hHomeWins / h2hMatches) * 100;
            const h2hAwayWR = (h2hAwayWins / h2hMatches) * 100;
            if (h2hHomeWR >= cfg.phase3H2HWR) { pick = home; predictionType = "PHASE3"; }
            else if (h2hAwayWR >= cfg.phase3H2HWR) { pick = away; predictionType = "PHASE3"; }
        }

        if (needsStats) { predictionType = "SKIP"; pick = null; }

        // Poor model history downgrade
        let h2hPredAcc = null, h2hPredBets = 0;
        if (historicalH2HStats[pairKey] && historicalH2HStats[pairKey].dnbBets > 0) {
            h2hPredBets = historicalH2HStats[pairKey].dnbBets;
            h2hPredAcc = (historicalH2HStats[pairKey].dnbCorrect / h2hPredBets) * 100;
        }
        if (predictionType !== "SKIP" && h2hPredBets >= cfg.poorHistMinBets && h2hPredAcc < cfg.poorHistAccThresh) {
            predictionType = "SKIP"; pick = null;
        }

        results.push({ home, away, hs: m.teamAScore, as: m.teamBScore, pick, predictionType, pairKey });
    });
    return results;
}

// ---- Parameterized OU predictor (mirrors src/predictor_ou.js decision logic) ----
function genOUVariant(matches, playerStats, h2hStats, historicalOUStats, cfg) {
    const results = [];
    matches.forEach(m => {
        const home = m.participantAName;
        const away = m.participantBName;
        let sHome = playerStats[home] || { avgScored: 0, avgConceded: 0, wins: 0, matches: 0, streak: [], adjScoringAbility: 0, adjDefendingAbility: 0 };
        let sAway = playerStats[away] || { avgScored: 0, avgConceded: 0, wins: 0, matches: 0, streak: [], adjScoringAbility: 0, adjDefendingAbility: 0 };

        const needsStats = (sHome.matches < 3 || sAway.matches < 3);

        let homeXG = ((parseFloat(sHome.adjScoringAbility) + parseFloat(sAway.adjDefendingAbility)) / 2);
        let awayXG = ((parseFloat(sAway.adjScoringAbility) + parseFloat(sHome.adjDefendingAbility)) / 2);

        const calcPoints = (form) => form.reduce((acc, val) => acc + (val === 'W' ? 3 : val === 'D' ? 1 : 0), 0);
        homeXG += calcPoints((sHome.streak || []).slice(-5)) * 0.05;
        awayXG += calcPoints((sAway.streak || []).slice(-5)) * 0.05;

        const pairKey = [home, away].sort().join(' vs ');
        const hStyle = (parseFloat(sHome.avgScored) + parseFloat(sHome.avgConceded)) > 3.0 ? 'Aggressive' : 'Defensive';
        const aStyle = (parseFloat(sAway.avgScored) + parseFloat(sAway.avgConceded)) > 3.0 ? 'Aggressive' : 'Defensive';

        const h2h = h2hStats[pairKey] || { matches: 0 };
        const baseTotalXG = homeXG + awayXG;
        let totalXG = baseTotalXG;
        if (h2h.matches > 0 && h2h.totalGoals !== undefined) {
            const h2hAvgGoals = h2h.totalGoals / h2h.matches;
            const h2hWeight = Math.min(h2h.matches * 0.15, 0.40);
            totalXG = (1 - h2hWeight) * baseTotalXG + h2hWeight * h2hAvgGoals;
        }

        const isAggVsAgg = hStyle === 'Aggressive' && aStyle === 'Aggressive';
        const isDefVsDef = hStyle === 'Defensive' && aStyle === 'Defensive';
        const isAnyAgg = hStyle === 'Aggressive' || aStyle === 'Aggressive';
        const isAnyDef = hStyle === 'Defensive' || aStyle === 'Defensive';

        let overGate, underGate;
        if (cfg.styleMode === 'strict') { overGate = isAggVsAgg; underGate = isDefVsDef; }
        else if (cfg.styleMode === 'loose') { overGate = isAnyAgg; underGate = isAnyDef; }
        // 'mixed' mirrors the current production gate in src/predictor_ou.js:
        // Over fires if EITHER side is Aggressive, Under still requires BOTH Defensive.
        else if (cfg.styleMode === 'mixed') { overGate = isAnyAgg; underGate = isDefVsDef; }
        else { overGate = true; underGate = true; }

        let pick = null; // 'OVER' | 'UNDER' | null
        if (totalXG >= cfg.optimalOv && overGate) pick = 'OVER';
        else if (totalXG < cfg.optimalUn && underGate) pick = 'UNDER';

        if (needsStats) pick = null;

        // Poor history downgrade (combined player OU accuracy)
        let totalOUBets = 0, combinedAcc = 0;
        if (historicalOUStats.playerOU) {
            const hOU = historicalOUStats.playerOU[home] || { bets: 0, correct: 0 };
            const aOU = historicalOUStats.playerOU[away] || { bets: 0, correct: 0 };
            totalOUBets = hOU.bets + aOU.bets;
            const totalOUCorrect = hOU.correct + aOU.correct;
            combinedAcc = totalOUBets > 0 ? (totalOUCorrect / totalOUBets) * 100 : 0;
        }
        if (pick && totalOUBets > 0 && combinedAcc < cfg.poorHistAccThresh) pick = null;

        // Pair-specific H2H OU accuracy gate (mirrors opts.historicalOUStats.h2hHistory[pairKey]
        // in src/predictor_ou.js) — requires this exact matchup's own all-time OU pick record to
        // be "good", not just each player's individually. Disabled unless cfg.pairMinBets is set.
        if (pick && cfg.pairMinBets) {
            const ph = historicalOUStats.h2hHistory && historicalOUStats.h2hHistory[pairKey];
            const pairBets = ph ? ph.ouBets : 0;
            const pairAcc = pairBets > 0 ? (ph.ouCorrect / pairBets) * 100 : 0;
            if (pairBets >= cfg.pairMinBets && pairAcc < cfg.pairAccThresh) pick = null;
        }

        results.push({ home, away, hs: m.teamAScore, as: m.teamBScore, pick, totalXG, pairKey });
    });
    return results;
}

function pct(n, d) { return d > 0 ? (n / d * 100) : 0; }

function runWalkForward(allMatches, h2hConfigs, ouConfigs, minPast) {
    const blocks = groupMatchesByRotation(allMatches);
    const keys = Object.keys(blocks).sort();

    const h2hStates = h2hConfigs.map(cfg => ({ cfg, h2hHistory: {}, bets: 0, wins: 0, losses: 0, pushes: 0, byRotation: {} }));
    const ouStates = ouConfigs.map(cfg => ({ cfg, playerOU: {}, bets: 0, wins: 0, losses: 0, byRotation: {} }));

    let rotationsEvaluated = 0;

    keys.forEach((key, idx) => {
        const past = [];
        keys.slice(0, idx).forEach(k => past.push(...blocks[k]));
        if (past.length < minPast) return;
        rotationsEvaluated++;

        const totalGoals = past.reduce((s, m) => s + m.teamAScore + m.teamBScore, 0);
        const leagueAvg = totalGoals / (past.length * 2);
        const { playerStats } = calculateStatistics(JSON.parse(JSON.stringify(past)), leagueAvg);
        const { h2hStats } = calculateH2H(JSON.parse(JSON.stringify(past)));
        const current = blocks[key];

        h2hStates.forEach(state => {
            const rot = { bets: 0, wins: 0, losses: 0 };
            const predicted = genH2HVariant(current, playerStats, h2hStats, state.h2hHistory, state.cfg);
            predicted.forEach(p => {
                if (!state.h2hHistory[p.pairKey]) state.h2hHistory[p.pairKey] = { dnbBets: 0, dnbCorrect: 0 };
                if (p.predictionType === "SKIP" || !p.pick) return;
                if (p.hs === p.as) return; // draw -> push, DNB refund, ignore for win-rate purposes
                state.bets++; rot.bets++;
                state.h2hHistory[p.pairKey].dnbBets++;
                const won = (p.pick === p.home && p.hs > p.as) || (p.pick === p.away && p.as > p.hs);
                if (won) { state.wins++; rot.wins++; state.h2hHistory[p.pairKey].dnbCorrect++; }
                else { state.losses++; rot.losses++; }
            });
            state.byRotation[key] = rot;
        });

        ouStates.forEach(state => {
            const rot = { bets: 0, wins: 0, losses: 0 };
            const predicted = genOUVariant(current, playerStats, h2hStats, { playerOU: state.playerOU }, state.cfg);
            predicted.forEach(p => {
                if (!state.playerOU[p.home]) state.playerOU[p.home] = { bets: 0, correct: 0 };
                if (!state.playerOU[p.away]) state.playerOU[p.away] = { bets: 0, correct: 0 };
                if (!p.pick) return;
                const totalG = p.hs + p.as;
                state.bets++; rot.bets++;
                state.playerOU[p.home].bets++; state.playerOU[p.away].bets++;
                const won = (p.pick === 'OVER' && totalG > 2.5) || (p.pick === 'UNDER' && totalG < 2.5);
                if (won) { state.wins++; rot.wins++; state.playerOU[p.home].correct++; state.playerOU[p.away].correct++; }
                else { state.losses++; rot.losses++; }
            });
            state.byRotation[key] = rot;
        });
    });

    const h2hResults = h2hStates.map(s => ({
        cfg: s.cfg, bets: s.bets, wins: s.wins, losses: s.losses,
        winRate: pct(s.wins, s.bets), roi: (pct(s.wins, s.bets) / 100 * 1.6 - 1) * 100,
        byRotation: s.byRotation
    }));
    const ouResults = ouStates.map(s => ({
        cfg: s.cfg, bets: s.bets, wins: s.wins, losses: s.losses,
        winRate: pct(s.wins, s.bets), roi: (pct(s.wins, s.bets) / 100 * 1.6 - 1) * 100,
        byRotation: s.byRotation
    }));

    return { h2hResults, ouResults, rotationsEvaluated, totalRotations: keys.length };
}

module.exports = { runWalkForward, groupMatchesByRotation, genH2HVariant, genOUVariant };
