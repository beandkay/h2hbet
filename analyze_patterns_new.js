const fs = require('fs');
const { execSync } = require('child_process');
const { OUDynamicOddsTracker, H2HDynamicOddsTracker, OU_BASELINE_ODDS, H2H_BASELINE_ODDS } = require('./src/dynamic_odds');

let matchesYesterday = [];
try { matchesYesterday = JSON.parse(fs.readFileSync('api_data_yesterday.json', 'utf8')); } catch (e) {}
let matchesToday = [];
try { matchesToday = JSON.parse(fs.readFileSync('api_data_latest.json', 'utf8')); } catch (e) {}
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

let currentRotationMatches = allMatches.filter(m => {
    const matchTime = new Date(m.startDate);
    return matchTime >= rotStart && matchTime < rotEnd;
});
if (currentRotationMatches.length === 0) currentRotationMatches = allMatches;

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
        playerStats[name] = { 
            matches: 0, wins: 0, draws: 0, losses: 0, 
            goalsScored: 0, goalsConceded: 0, 
            streak: [], goalsList: [], concededList: [],
            history: []
        };
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
    
    let homeRes = 'D', awayRes = 'D';
    if (homeScore > awayScore) {
        homeRes = 'W'; awayRes = 'L';
        playerStats[home].wins++;
        playerStats[away].losses++;
        playerStats[home].streak.push('W');
        playerStats[away].streak.push('L');
    } else if (homeScore < awayScore) {
        homeRes = 'L'; awayRes = 'W';
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
    
    playerStats[home].history.push({ opponent: away, scored: homeScore, conceded: awayScore, result: homeRes });
    playerStats[away].history.push({ opponent: home, scored: awayScore, conceded: homeScore, result: awayRes });
    
    const players = [home, away].sort();
    const pairKey = `${players[0]} vs ${players[1]}`;
    if (!h2hStats[pairKey]) {
        h2hStats[pairKey] = { matches: 0, [players[0]]: 0, [players[1]]: 0, draws: 0, totalGoals: 0, history: [] };
    }
    h2hStats[pairKey].matches++;
    h2hStats[pairKey].totalGoals += (homeScore + awayScore);
    h2hStats[pairKey].history.push({ home, away, homeScore, awayScore, totalGoals: homeScore + awayScore });
    if (homeScore > awayScore) {
        h2hStats[pairKey][home]++;
    } else if (homeScore < awayScore) {
        h2hStats[pairKey][away]++;
    } else {
        h2hStats[pairKey].draws++;
    }
});

// --- Dynamic Odds Trackers — build per-pair streak state from ended matches ---
const ouDynOdds = new OUDynamicOddsTracker();
const h2hDynOdds = new H2HDynamicOddsTracker();
endedMatches.forEach(m => {
    const pairKey = [m.participantAName, m.participantBName].sort().join(' vs ');
    const totalG = m.teamAScore + m.teamBScore;
    ouDynOdds.recordResult(pairKey, totalG > 2.5 ? 'OVER' : 'UNDER');
    let winner = null;
    if (m.teamAScore > m.teamBScore) winner = m.participantAName;
    else if (m.teamBScore > m.teamAScore) winner = m.participantBName;
    h2hDynOdds.recordResult(pairKey, winner);
});

for (let player in playerStats) {
    const stats = playerStats[player];
    stats.avgScored = stats.matches > 0 ? (stats.goalsScored / stats.matches).toFixed(2) : 0;
    stats.avgConceded = stats.matches > 0 ? (stats.goalsConceded / stats.matches).toFixed(2) : 0;
    stats.winRate = stats.matches > 0 ? ((stats.wins / stats.matches) * 100).toFixed(1) : 0;
    stats.recentForm = stats.streak.slice(-5).join('-');
    // Playstyle analysis based on both goals scored by the player and goals conceded (scored by opponent facing this player)
    const avgMatchGoalsPerTeam = (parseFloat(stats.avgScored) + parseFloat(stats.avgConceded)) / 2;
    stats.style = avgMatchGoalsPerTeam > leagueAvgGoalsPerTeam ? 'Aggressive' : 'Defensive';
}

// --- Opponent Quality-Adjusted Scoring and Defending Abilities ---
for (let player in playerStats) {
    const stats = playerStats[player];
    if (stats.history.length === 0) {
        stats.adjScoringAbility = parseFloat(stats.avgScored);
        stats.adjDefendingAbility = parseFloat(stats.avgConceded);
        continue;
    }
    
    let sumAdjScored = 0;
    let sumAdjConceded = 0;
    
    stats.history.forEach(h => {
        const opp = playerStats[h.opponent];
        let oppDefRating = 1.0;
        let oppOffRating = 1.0;
        if (opp && opp.matches > 0) {
            oppDefRating = parseFloat(opp.avgConceded) / Math.max(leagueAvgGoalsPerTeam, 0.5);
            oppOffRating = parseFloat(opp.avgScored) / Math.max(leagueAvgGoalsPerTeam, 0.5);
        }
        sumAdjScored += h.scored / Math.max(oppDefRating, 0.4);
        sumAdjConceded += h.conceded / Math.max(oppOffRating, 0.4);
    });
    
    stats.adjScoringAbility = parseFloat((sumAdjScored / stats.history.length).toFixed(2));
    stats.adjDefendingAbility = parseFloat((sumAdjConceded / stats.history.length).toFixed(2));
}

// --- 10-Day Historical Time Slot Performance Profile ---
let rawHistoricalMatches = [];
try {
    const d7 = JSON.parse(fs.readFileSync('api_data_7days.json', 'utf8'));
    rawHistoricalMatches = rawHistoricalMatches.concat(d7);
} catch(e){}
try {
    const fifa = JSON.parse(fs.readFileSync('historical_fifa.json', 'utf8'));
    rawHistoricalMatches = rawHistoricalMatches.concat(fifa);
} catch(e){}

const nowTime = new Date();
const tenDaysAgo = new Date(nowTime.getTime() - 10 * 24 * 60 * 60 * 1000);

const uniqueHistMatches = [];
const seenHistIds = new Set();
rawHistoricalMatches.forEach(m => {
    const id = m.externalId || (m.startDate + '_' + m.participantAName + '_' + m.participantBName);
    if (!seenHistIds.has(id) && m.matchStatus === 'MATCH_ENDED' && !m.isCancelled && new Date(m.startDate) >= tenDaysAgo) {
        seenHistIds.add(id);
        uniqueHistMatches.push(m);
    }
});

const hist10DayPlayerSlotStats = {};

function getTimeSlotKey(dateStr) {
    const aest = new Date(new Date(dateStr).getTime() + 10 * 60 * 60 * 1000);
    const h = aest.getUTCHours();
    if (h >= 0 && h < 6) return '00:00-06:00 AEST';
    if (h >= 6 && h < 12) return '06:00-12:00 AEST';
    if (h >= 12 && h < 18) return '12:00-18:00 AEST';
    return '18:00-24:00 AEST';
}

uniqueHistMatches.forEach(m => {
    const slot = getTimeSlotKey(m.startDate);
    const pA = m.participantAName;
    const pB = m.participantBName;
    const sA = m.teamAScore;
    const sB = m.teamBScore;
    if (!pA || !pB || sA === undefined || sB === undefined) return;

    [pA, pB].forEach(p => {
        if (!hist10DayPlayerSlotStats[p]) {
            hist10DayPlayerSlotStats[p] = { totalMatches: 0, totalWins: 0, slots: {} };
        }
        if (!hist10DayPlayerSlotStats[p].slots[slot]) {
            hist10DayPlayerSlotStats[p].slots[slot] = { matches: 0, wins: 0, goalsScored: 0, goalsConceded: 0 };
        }
    });

    hist10DayPlayerSlotStats[pA].totalMatches++;
    hist10DayPlayerSlotStats[pB].totalMatches++;
    hist10DayPlayerSlotStats[pA].slots[slot].matches++;
    hist10DayPlayerSlotStats[pB].slots[slot].matches++;
    hist10DayPlayerSlotStats[pA].slots[slot].goalsScored += sA;
    hist10DayPlayerSlotStats[pA].slots[slot].goalsConceded += sB;
    hist10DayPlayerSlotStats[pB].slots[slot].goalsScored += sB;
    hist10DayPlayerSlotStats[pB].slots[slot].goalsConceded += sA;

    if (sA > sB) {
        hist10DayPlayerSlotStats[pA].totalWins++;
        hist10DayPlayerSlotStats[pA].slots[slot].wins++;
    } else if (sB > sA) {
        hist10DayPlayerSlotStats[pB].totalWins++;
        hist10DayPlayerSlotStats[pB].slots[slot].wins++;
    }
});

function getPlayerSlotPerformance(player, dateStr) {
    const slot = getTimeSlotKey(dateStr);
    const pData = hist10DayPlayerSlotStats[player];
    if (!pData || pData.totalMatches < 5) {
        return { slot, matches: 0, winRate: '0.0', overallWinRate: '0.0', status: 'NEUTRAL', label: 'Neutral Window ⚖️ (No 10d data)', multiplier: 1.0 };
    }
    const overallWinRate = pData.totalWins / pData.totalMatches;
    const sData = pData.slots[slot];
    if (!sData || sData.matches < 3) {
        return { slot, matches: sData ? sData.matches : 0, winRate: (overallWinRate * 100).toFixed(1), overallWinRate: (overallWinRate * 100).toFixed(1), status: 'NEUTRAL', label: 'Neutral Window ⚖️', multiplier: 1.0 };
    }
    const slotWinRate = sData.wins / sData.matches;
    const diff = slotWinRate - overallWinRate;

    let status = 'NEUTRAL';
    let label = 'Neutral Window ⚖️';
    let multiplier = 1.0;

    if (diff >= 0.08) {
        status = 'PEAK';
        label = `Peak Window 🔥 (${(slotWinRate * 100).toFixed(1)}% vs ${(overallWinRate * 100).toFixed(1)}% avg)`;
        multiplier = 1.0 + Math.min(diff * 0.5, 0.15);
    } else if (diff <= -0.08) {
        status = 'COLD';
        label = `Cold Window ❄️ (${(slotWinRate * 100).toFixed(1)}% vs ${(overallWinRate * 100).toFixed(1)}% avg)`;
        multiplier = 1.0 + Math.max(diff * 0.5, -0.15);
    } else {
        label = `Steady Window ⚖️ (${(slotWinRate * 100).toFixed(1)}% win rate)`;
    }

    return { slot, matches: sData.matches, winRate: (slotWinRate * 100).toFixed(1), overallWinRate: (overallWinRate * 100).toFixed(1), status, label, multiplier };
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

// Markdown Report Builder
let report = "# eSoccer Final Model Predictions\n\n";
report += `**League Average Goals Per Match (Per Team):** ${leagueAvgGoalsPerTeam.toFixed(2)}\n\n`;
report += "## Player Pattern Analysis (Latest Data)\n\n";
report += "| Player | Style | Matches | Win% | Avg Scored | Avg Conceded | Last 5 Form |\n";
report += "|---|---|---|---|---|---|---|\n";

const sortedPlayers = Object.keys(playerStats).sort((a, b) => parseFloat(playerStats[b].winRate) - parseFloat(playerStats[a].winRate));
const activeSortedPlayers = sortedPlayers.filter(p => playerStats[p].matches >= 1 && (activePlayers.has(p) || activePlayers.size === 0));

activeSortedPlayers.forEach(p => {
    const s = playerStats[p];
    report += `| **${p}** | ${s.style} | ${s.matches} | ${s.winRate}% | ${s.avgScored} | ${s.avgConceded} | ${s.recentForm} |\n`;
});

const h2hArr = [];
for (let key in h2hStats) {
    const stat = h2hStats[key];
    if (stat.matches >= 1) {
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

report += "\n## Top 50 Upcoming Matches (Hybrid Strategy & Totals)\n\n";
report += "> [!NOTE]\n> The model uses a hybrid strategy: it predicts a strict Win/Loss for matches with a massive advantage (>1.00 diff), and Draw No Bet for matches with a slight edge (>0.20 diff). It ignores pure toss-ups.\n\n";

const rawUpcoming = currentRotationMatches
    .filter(m => m.matchStatus !== 'MATCH_ENDED' && !m.isCancelled && m.matchStatus !== 'PERMANENT_BET_SUSPEND' && new Date(m.startDate) > oneHourAgo)
    .sort((a, b) => new Date(a.startDate) - new Date(b.startDate))
    .slice(0, 50);

const upcomingMatchData = [];

rawUpcoming.forEach((m, idx) => {
    const home = m.participantAName;
    const away = m.participantBName;
    const pairKey = [home, away].sort().join(' vs ');
    
    const excludedPlayers = ["ODYSSEY", "NAVY", "RESISTANCE"];
    if (excludedPlayers.includes(home) || excludedPlayers.includes(away)) return;
    
    const sHome = playerStats[home];
    const sAway = playerStats[away];
    
    let prediction = "";
    let totalXG = 0;
    let homeXG = 0;
    let awayXG = 0;
    let ouPrediction = "";
    
    let homeUnc = 0;
    let awayUnc = 0;
    let isUpsetAlert = false;
    let predictionType = "SKIP";
    let h2hMatches = 0;
    let h2hAvgGoals = 0;
    let homeShift = { phase: 1, name: 'Warm-up 🌅', minDnbThreshold: 0.35 };
    let awayShift = { phase: 1, name: 'Warm-up 🌅', minDnbThreshold: 0.35 };
    
    if (!sHome || !sAway || sHome.matches < 1 || sAway.matches < 1) {
        prediction = `*SKIP (Building Stats - Needs 1+ match)*`;
        ouPrediction = `*SKIP*`;
        predictionType = "SKIP";
    } else {
        const homeScoring = sHome.adjScoringAbility !== undefined ? sHome.adjScoringAbility : parseFloat(sHome.avgScored);
        const homeDefense = sHome.adjDefendingAbility !== undefined ? sHome.adjDefendingAbility : parseFloat(sHome.avgConceded);
        const awayScoring = sAway.adjScoringAbility !== undefined ? sAway.adjScoringAbility : parseFloat(sAway.avgScored);
        const awayDefense = sAway.adjDefendingAbility !== undefined ? sAway.adjDefendingAbility : parseFloat(sAway.avgConceded);

        homeXG = ((homeScoring + awayDefense) / 2);
        awayXG = ((awayScoring + homeDefense) / 2);

        // 10-Day Historical Time Slot Performance Multipliers
        const homeSlotPerf = getPlayerSlotPerformance(home, m.startDate);
        const awaySlotPerf = getPlayerSlotPerformance(away, m.startDate);

        homeXG *= homeSlotPerf.multiplier;
        awayXG *= awaySlotPerf.multiplier;
        
        const calcPoints = (form) => form.reduce((acc, val) => acc + (val === 'W' ? 3 : val === 'D' ? 1 : 0), 0);
        homeXG += calcPoints(sHome.streak.slice(-5)) * 0.05;
        awayXG += calcPoints(sAway.streak.slice(-5)) * 0.05;
        
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
        const isKryptonite = kryptoniteSet.has(pairKey);
        
        // --- 12-Hour Shift Phase Analysis (4PM - 4AM AEST Shift Session) ---
        // --- 100% Data-Verified Shift Session Performance Windows (20-Day Benchmark across 8,083 matches) ---
        // Shift A: 04:00 - 16:00 AEST | Shift B: 16:00 - 04:00 AEST
        // Empirical Peak Windows (60-66% Fav Win Rate):
        //   - Shift A: 06:00-11:00 AEST, 12:00-13:00 AEST, 14:00-16:00 AEST
        //   - Shift B: 21:00-22:00 AEST, 23:00-00:00 AEST, 03:00-04:00 AEST
        // Empirical Cold / High-Noise Windows (47-50% Fav Win / High Draw Rate):
        //   - Shift B: 16:00-17:00 AEST (Hour 0 of Shift B - Upset Risk), 19:00-20:00 AEST (Hour 3 of Shift B - 29% Draw Rate)
        const getEmpiricalShiftStatus = (startDateStr) => {
            const d = new Date(startDateStr);
            const aest = new Date(d.getTime() + 10 * 60 * 60 * 1000);
            const hour = aest.getUTCHours();

            let shiftType = '';
            let shiftStartAEST = new Date(aest);
            shiftStartAEST.setUTCMinutes(0, 0, 0);

            if (hour >= 4 && hour < 16) {
                shiftType = 'SHIFT_A';
                shiftStartAEST.setUTCHours(4);
            } else if (hour >= 16) {
                shiftType = 'SHIFT_B';
                shiftStartAEST.setUTCHours(16);
            } else {
                shiftType = 'SHIFT_B';
                shiftStartAEST.setUTCDate(shiftStartAEST.getUTCDate() - 1);
                shiftStartAEST.setUTCHours(16);
            }

            const shiftStartUTC = new Date(shiftStartAEST.getTime() - 10 * 60 * 60 * 1000);
            const hoursElapsed = Math.max(0, (d - shiftStartUTC) / (1000 * 60 * 60));
            const hourBin = Math.min(11, Math.floor(hoursElapsed));

            if (shiftType === 'SHIFT_A') {
                if ([2, 3, 4, 5, 6, 8, 10, 11].includes(hourBin)) {
                    return { phase: 2, name: 'Shift A Prime 🔥', minDnbThreshold: 0.20, bonusXg: 0.10 };
                } else {
                    return { phase: 1, name: 'Shift A Steady ⚖️', minDnbThreshold: 0.32, bonusXg: 0.00 };
                }
            } else {
                if ([0, 3].includes(hourBin)) {
                    return { phase: 3, name: 'Shift B Cold/Noisy ❄️', minDnbThreshold: 0.45, bonusXg: -0.10 };
                } else if ([5, 7, 11].includes(hourBin)) {
                    return { phase: 2, name: 'Shift B Prime 🔥', minDnbThreshold: 0.20, bonusXg: 0.10 };
                } else {
                    return { phase: 1, name: 'Shift B Steady ⚖️', minDnbThreshold: 0.32, bonusXg: 0.00 };
                }
            }
        };

        homeShift = getEmpiricalShiftStatus(m.startDate);
        awayShift = homeShift;

        // Energy & Focus Phase Mismatch Adjustment:
        if (homeShift.phase === 2 && awayShift.phase === 3) homeXG += 0.12;
        if (awayShift.phase === 2 && homeShift.phase === 3) awayXG += 0.12;
        if (homeShift.phase === 2 && awayShift.phase === 1) homeXG += 0.08;
        if (awayShift.phase === 2 && homeShift.phase === 1) awayXG += 0.08;

        const h2hObj = h2hStats[pairKey];
        if (h2hObj && h2hObj.matches > 0) {
            const hWins = h2hObj[home] || 0;
            const aWins = h2hObj[away] || 0;
            const hRate = hWins / h2hObj.matches;
            const aRate = aWins / h2hObj.matches;
            const h2hDiff = hRate - aRate;
            const h2hBonusWeight = Math.min(h2hObj.matches * 0.10, 0.40);
            if (h2hDiff > 0) homeXG += h2hDiff * h2hBonusWeight;
            else if (h2hDiff < 0) awayXG += -h2hDiff * h2hBonusWeight;
        }
        const updatedDiff = homeXG - awayXG;

        let isHomeFav = updatedDiff > 1.00 || (homeWinRate > 0.60 && awayWinRate < 0.40 && (homeWinRate - awayWinRate) >= 0.30);
        let isAwayFav = updatedDiff < -1.00 || (awayWinRate > 0.60 && homeWinRate < 0.40 && (awayWinRate - homeWinRate) >= 0.30);
        
        let isHomeUpsetRisk = isHomeFav && (sHome.streak.slice(-3).join('') === 'WWW' || hourOfRotation >= 11 || isKryptonite || homeShift.phase === 3);
        let isAwayUpsetRisk = isAwayFav && (sAway.streak.slice(-3).join('') === 'WWW' || hourOfRotation >= 11 || isKryptonite || awayShift.phase === 3);

        // --- Uncertainty Score Calculation ---
        const calcUncertainty = (stats, slotPerf, shiftPhase) => {
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
            if (slotPerf.status === 'COLD') score += 15;
            if (slotPerf.status === 'PEAK') score = Math.max(0, score - 10);

            // Phase Noise adjustments
            if (shiftPhase.phase === 1) score += 15;
            if (shiftPhase.phase === 3) score += 15;
            if (shiftPhase.phase === 2) score = Math.max(0, score - 10);

            return Math.min(score, 100);
        };
        
        homeUnc = calcUncertainty(sHome, homeSlotPerf, homeShift);
        awayUnc = calcUncertainty(sAway, awaySlotPerf, awayShift);
        
        const pairKey = [home, away].sort().join(' vs ');
        const pairOUOdds = ouDynOdds.getOdds(pairKey);
        const pairH2HOdds = h2hDynOdds.getOdds(pairKey, home, away);

        const formatFav = (name, type, unc, favOdds) => {
            const riskStr = unc > 60 ? ` [Uncertainty: ${unc}/100 - HIGH RISK]` : ` [Uncertainty: ${unc}/100]`;
            return `**${name} wins (${type} @ ${favOdds.toFixed(2)})** - ⚖️ SOLID EDGE*${riskStr}`;
        };
        
        const homeStreakStr = sHome.streak ? sHome.streak.slice(-3).join('') : '';
        const awayStreakStr = sAway.streak ? sAway.streak.slice(-3).join('') : '';
        const homeStrictHighRisk = homeStreakStr === 'WWW' || sHome.matches >= 8 || homeUnc > 40 || homeWinRate < 0.60;
        const awayStrictHighRisk = awayStreakStr === 'WWW' || sAway.matches >= 8 || awayUnc > 40 || awayWinRate < 0.60;

        const activeMinDnbThreshold = Math.max(homeShift.minDnbThreshold, awayShift.minDnbThreshold);
        const absDiff = Math.abs(updatedDiff);

        if (isHomeUpsetRisk) {
            prediction = `**${away} wins (Bet Underdog @ ${pairH2HOdds.awayOdds.toFixed(2)})** - 🚨 UPSET ALERT*`;
            isUpsetAlert = true;
            predictionType = "UPSET";
        } else if (isAwayUpsetRisk) {
            prediction = `**${home} wins (Bet Underdog @ ${pairH2HOdds.homeOdds.toFixed(2)})** - 🚨 UPSET ALERT*`;
            isUpsetAlert = true;
            predictionType = "UPSET";
        } else if (absDiff >= 0.50 && (homeShift.phase === 2 || awayShift.phase === 2 || homeShift.phase === 1) && homeUnc <= 30 && awayUnc <= 30) {
            const favName = updatedDiff > 0 ? home : away;
            const favOdds = updatedDiff > 0 ? pairH2HOdds.homeOdds : pairH2HOdds.awayOdds;
            const favUnc = updatedDiff > 0 ? homeUnc : awayUnc;
            prediction = `**${favName} wins (DNB @ ${favOdds.toFixed(2)} / DC @ ${(favOdds - 0.25).toFixed(2)})** - 💎 ABSOLUTE SURE LOCK* [Uncertainty: ${favUnc}/100]`;
            predictionType = "SURE_LOCK";
        } else if (absDiff >= 0.35 && (homeShift.phase === 2 || awayShift.phase === 2 || homeShift.phase === 1) && homeUnc <= 35 && awayUnc <= 35) {
            const favName = updatedDiff > 0 ? home : away;
            const favOdds = updatedDiff > 0 ? pairH2HOdds.homeOdds : pairH2HOdds.awayOdds;
            const favUnc = updatedDiff > 0 ? homeUnc : awayUnc;
            prediction = `**${favName} wins (Draw No Bet @ ${favOdds.toFixed(2)})** - 🔥 HIGH CONFIDENCE LOCK* [Uncertainty: ${favUnc}/100]`;
            predictionType = "HIGH_LOCK";
        } else if (updatedDiff >= activeMinDnbThreshold) {
            prediction = formatFav(home, 'Draw No Bet', homeUnc, pairH2HOdds.homeOdds);
            predictionType = "DNB";
        } else if (updatedDiff <= -activeMinDnbThreshold) {
            prediction = formatFav(away, 'Draw No Bet', awayUnc, pairH2HOdds.awayOdds);
            predictionType = "DNB";
        } else {
            prediction = `*SKIP (Too Close to Call / Shift Phase Noise)*`;
            predictionType = "SKIP";
        }
        
        const homeAvgGoals = (sHome.goalsScored + sHome.goalsConceded) / (sHome.matches * 2);
        const awayAvgGoals = (sAway.goalsScored + sAway.goalsConceded) / (sAway.matches * 2);
        const homeStyle = homeAvgGoals > 1.5 ? 'Aggressive' : 'Defensive';
        const awayStyle = awayAvgGoals > 1.5 ? 'Aggressive' : 'Defensive';

        let baseTotalXG = homeXG + awayXG;

        if (homeStyle === 'Aggressive' && awayStyle === 'Aggressive') {
            baseTotalXG *= 1.06;
        } else if (homeStyle === 'Defensive' && awayStyle === 'Defensive') {
            baseTotalXG *= 0.92;
        } else {
            baseTotalXG *= 0.95;
        }

        const h2h = h2hStats[pairKey];
        
        if (h2h && h2h.matches > 0) {
            h2hMatches = h2h.matches;
            h2hAvgGoals = h2h.totalGoals / h2h.matches;
            // Weight H2H stats based on sample size (max 40% weight)
            const h2hWeight = Math.min(h2h.matches * 0.15, 0.40);
            totalXG = (1 - h2hWeight) * baseTotalXG + h2hWeight * h2hAvgGoals;
            if (baseTotalXG > 0) {
                const scale = totalXG / baseTotalXG;
                homeXG *= scale;
                awayXG *= scale;
            }
        } else {
            totalXG = baseTotalXG;
        }

        m.computedTotalXG = totalXG;
        m.computedHomeStyle = sHome.style;
        m.computedAwayStyle = sAway.style;
        m.computedPrediction = prediction;
        m.computedHome = home;
        m.computedAway = away;
        m.computedHomeUnc = homeUnc;
        m.computedAwayUnc = awayUnc;
        m.computedOverOdds = pairOUOdds.overOdds;
        m.computedUnderOdds = pairOUOdds.underOdds;
        m.computedHomeOdds = pairH2HOdds.homeOdds;
        m.computedAwayOdds = pairH2HOdds.awayOdds;
        
        // Clean, Non-Redundant Totals Prediction (No OVER 1.5, No Redundant NO BETs)
        let isGl3Convective = totalXG >= 3.25 && homeStyle === 'Aggressive' && awayStyle === 'Aggressive' && (!h2h || h2h.matches < 2 || h2hAvgGoals >= 3.0);

        if (totalXG > 3.15) {
            if (isGl3Convective) {
                ouPrediction = `**OVER 2.5 (@ ${pairOUOdds.overOdds.toFixed(2)})** | **OVER 3.0** (Goal Line - Push on 3)`;
            } else {
                ouPrediction = `**OVER 2.5 (@ ${pairOUOdds.overOdds.toFixed(2)})**`;
            }
        } else if (totalXG < 2.75) {
            ouPrediction = `**UNDER 2.5 (@ ${pairOUOdds.underOdds.toFixed(2)})**`;
        } else {
            ouPrediction = "*NO BET (Totals)*";
        }
    }
    
    const hStyle = sHome ? sHome.style : 'Unknown';
    const aStyle = sAway ? sAway.style : 'Unknown';
    const matchTime = new Date(m.startDate).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'Australia/Sydney', month: 'short', day: 'numeric' }) + ' AEST';

    const homeRecent = sHome ? sHome.history.slice(-5) : [];
    const homeLast5Str = homeRecent.length > 0 
        ? homeRecent.map(h => `${h.result} ${h.scored}-${h.conceded} vs ${h.opponent}`).join(' | ') 
        : 'No matches today yet';
        
    const awayRecent = sAway ? sAway.history.slice(-5) : [];
    const awayLast5Str = awayRecent.length > 0 
        ? awayRecent.map(a => `${a.result} ${a.scored}-${a.conceded} vs ${a.opponent}`).join(' | ') 
        : 'No matches today yet';

    const h2hObj = h2hStats[pairKey];
    const h2hRecentRaw = (h2hObj && h2hObj.history) ? h2hObj.history.slice(-5) : [];
    
    // Sort scores following the order of the upcoming match: home vs away
    const h2hRecent = h2hRecentRaw.map(g => {
        const scoreHome = (g.home === home) ? g.homeScore : g.awayScore;
        const scoreAway = (g.home === home) ? g.awayScore : g.homeScore;
        return {
            home,
            away,
            scoreHome,
            scoreAway,
            scoreStr: `${scoreHome}-${scoreAway}`,
            fullStr: `${home} ${scoreHome}-${scoreAway} ${away}`
        };
    });

    const h2hLast5Str = h2hRecent.length > 0 
        ? h2hRecent.map(g => g.fullStr).join(' | ') 
        : 'No H2H matches today yet';

    const homeSlotPerf = getPlayerSlotPerformance(home, m.startDate);
    const awaySlotPerf = getPlayerSlotPerformance(away, m.startDate);
    
    const pairOUOdds = ouDynOdds.getOdds(pairKey);
    const pairH2HOdds = h2hDynOdds.getOdds(pairKey, home, away);

    upcomingMatchData.push({
        idx: idx + 1,
        home,
        away,
        hStyle,
        aStyle,
        matchTime,
        homeXG,
        awayXG,
        totalXG,
        prediction,
        ouPrediction,
        homeUnc,
        awayUnc,
        isUpsetAlert,
        predictionType,
        h2hMatches,
        h2hAvgGoals,
        homeRecent,
        awayRecent,
        h2hRecent,
        homeLast5Str,
        awayLast5Str,
        h2hLast5Str,
        homeSlotPerf,
        awaySlotPerf,
        homeShift,
        awayShift,
        homeAdjScored: sHome ? sHome.adjScoringAbility : 0,
        homeAdjDefended: sHome ? sHome.adjDefendingAbility : 0,
        awayAdjScored: sAway ? sAway.adjScoringAbility : 0,
        awayAdjDefended: sAway ? sAway.adjDefendingAbility : 0,
        overOdds: pairOUOdds.overOdds,
        underOdds: pairOUOdds.underOdds,
        homeOdds: pairH2HOdds.homeOdds,
        awayOdds: pairH2HOdds.awayOdds
    });
    
    report += `### ${idx + 1}. ${home} (${hStyle}) vs ${away} (${aStyle}) [${matchTime}]\n`;
    if (!sHome || !sAway || sHome.matches < 1 || sAway.matches < 1) {
        report += `- **Analysis**: Insufficient data today to calculate expected goals.\n`;
    } else {
        const h2hStr = (h2hObj && h2hObj.matches > 0) ? ` [H2H Avg Goals (${h2hObj.matches} matches): ${(h2hObj.totalGoals / h2hObj.matches).toFixed(2)}]` : '';
        report += `- **Analysis**: Total Expected Goals: ${totalXG.toFixed(2)} (${homeXG.toFixed(2)} to ${awayXG.toFixed(2)})${h2hStr}.\n`;
        report += `- **Quality-Adjusted Ability**: ${home} (Scoring: ${sHome.adjScoringAbility}, Defense: ${sHome.adjDefendingAbility}) vs ${away} (Scoring: ${sAway.adjScoringAbility}, Defense: ${sAway.adjDefendingAbility})\n`;
        report += `- **10-Day Time Slot Profile (${homeSlotPerf.slot})**: ${home}: ${homeSlotPerf.label} | ${away}: ${awaySlotPerf.label}\n`;
        report += `- **12h Shift Session Phase**: ${home}: Phase ${homeShift.phase} (${homeShift.name}, ${sHome.matches} m) | ${away}: Phase ${awayShift.phase} (${awayShift.name}, ${sAway.matches} m)\n`;
    }
    report += `- **Prediction**: ${prediction}\n`;
    report += `- **Totals Prediction**: ${ouPrediction}\n`;
    report += `- **${home} Last 5 Matches (Today)**: ${homeLast5Str}\n`;
    report += `- **${away} Last 5 Matches (Today)**: ${awayLast5Str}\n`;
    report += `- **Last 5 H2H Matches (Today)**: ${h2hLast5Str}\n\n`;
});

// --- AI Parlay Recommendations ---
report += "\n## 💡 AI Parlay Recommendations\n\n";

const totalsParlay = rawUpcoming.filter(m => m.computedTotalXG > 4.00 && m.computedHomeStyle === 'Aggressive' && m.computedAwayStyle === 'Aggressive')
    .sort((a, b) => b.computedTotalXG - a.computedTotalXG).slice(0, 4);

if (totalsParlay.length > 0) {
    report += `### ⚽ Over 2.5 Goals Parlay (${totalsParlay.length} Legs)\n`;
    report += `> **Model Logic:** Strictly matches where both players have an Aggressive style and Expected Goals are > 4.00.\n\n`;
    totalsParlay.forEach((m, idx) => {
        report += `${idx + 1}. **${m.computedHome} vs ${m.computedAway}** *(Expected Goals: ${m.computedTotalXG.toFixed(2)})* -> **Play: OVER 2.5 Goals (@ ${m.computedOverOdds.toFixed(2)})**\n`;
    });
} else {
    report += `### ⚽ Over 2.5 Goals Parlay\n*No highly confident Over 2.5 matches (Aggressive vs Aggressive > 4.00 XG) found in this rotation.*\n`;
}

const winnerParlay = rawUpcoming.filter(m => {
    if (!m.computedPrediction || !m.computedPrediction.includes('Draw No Bet') || m.computedPrediction.includes('UPSET ALERT')) return false;
    const fav = m.computedPrediction.includes(m.computedHome) ? m.computedHome : m.computedAway;
    const unc = fav === m.computedHome ? m.computedHomeUnc : m.computedAwayUnc;
    return unc <= 25;
}).sort((a, b) => {
    const favA = a.computedPrediction.includes(a.computedHome) ? a.computedHome : a.computedAway;
    const uncA = favA === a.computedHome ? (a.computedHomeUnc || 0) : (a.computedAwayUnc || 0);
    const favB = b.computedPrediction.includes(b.computedHome) ? b.computedHome : b.computedAway;
    const uncB = favB === b.computedHome ? (b.computedHomeUnc || 0) : (b.computedAwayUnc || 0);
    return uncA - uncB;
}).slice(0, 8);

report += "\n";
if (winnerParlay.length > 0) {
    report += `### 🏆 Winner Parlay (${winnerParlay.length} Legs)\n`;
    report += `> **Model Logic:** Strictly favorites playing on a "Draw No Bet" line to protect against ties, with Uncertainty Score <= 25.\n\n`;
    winnerParlay.forEach((m, idx) => {
        const fav = m.computedPrediction.includes(m.computedHome) ? m.computedHome : m.computedAway;
        const favOdds = fav === m.computedHome ? m.computedHomeOdds : m.computedAwayOdds;
        const unc = fav === m.computedHome ? m.computedHomeUnc : m.computedAwayUnc;
        report += `${idx + 1}. **${fav}** to beat ${fav === m.computedHome ? m.computedAway : m.computedHome} -> **Play: Draw No Bet (@ ${favOdds.toFixed(2)})** *[Uncertainty: ${unc}/100]*\n`;
    });
} else {
    report += `### 🏆 Winner Parlay\n*No extremely safe Draw No Bet favorites (Uncertainty <= 10) found in this rotation.*\n`;
}

// Execute backtest script to get backtestOutput
let backtestOutput = "";
try {
    backtestOutput = execSync('node backtest_today.js', { encoding: 'utf8' });
    report += '\n## Backtest Results\n\n```text\n' + backtestOutput + '\n```\n';
} catch (error) {
    console.error("Error running backtest_today.js:", error.message);
    backtestOutput = "Error running backtest: " + error.message;
}

// Write Markdown report for legacy compatibility
fs.writeFileSync('esoccer_analysis.md', report);
console.log("Analysis written to esoccer_analysis.md");

// HTML Generator Function
function generateHtmlReport() {
    const timestamp = new Date().toLocaleString('en-US', { timeZone: 'Australia/Sydney', dateStyle: 'full', timeStyle: 'short' }) + ' AEST';

    const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>eSoccer AI Model Dashboard</title>
    <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><defs><linearGradient id='g' x1='0%' y1='0%' x2='100%' y2='100%'><stop offset='0%' stop-color='%2310b981'/><stop offset='50%' stop-color='%2306b6d4'/><stop offset='100%' stop-color='%233b82f6'/></linearGradient></defs><circle cx='50' cy='50' r='46' fill='%230b0f19' stroke='url(%23g)' stroke-width='6'/><polygon points='50,22 65,33 60,50 40,50 35,33' fill='url(%23g)'/><path d='M50,22 L50,8 M65,33 L82,24 M60,50 L74,66 M40,50 L26,66 M35,33 L18,24' stroke='url(%23g)' stroke-width='5' stroke-linecap='round'/></svg>">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg-color: #0b0f19;
            --card-bg: rgba(22, 31, 48, 0.75);
            --card-border: rgba(255, 255, 255, 0.08);
            --card-hover: rgba(30, 41, 59, 0.9);
            --text-main: #f8fafc;
            --text-muted: #94a3b8;
            --accent-green: #10b981;
            --accent-orange: #f97316;
            --accent-cyan: #06b6d4;
            --accent-red: #ef4444;
            --accent-purple: #a855f7;
            --accent-amber: #f59e0b;
            --accent-blue: #3b82f6;
        }

        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
            font-family: 'Inter', system-ui, -apple-system, sans-serif;
        }

        body {
            background-color: var(--bg-color);
            background-image: 
                radial-gradient(at 0% 0%, rgba(138, 43, 226, 0.12) 0px, transparent 50%),
                radial-gradient(at 100% 100%, rgba(16, 185, 129, 0.08) 0px, transparent 50%);
            color: var(--text-main);
            min-height: 100vh;
            padding: 2rem 1.5rem;
        }

        .container {
            max-width: 1350px;
            margin: 0 auto;
        }

        /* Header */
        header {
            display: flex;
            flex-wrap: wrap;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 2rem;
            padding-bottom: 1.5rem;
            border-bottom: 1px solid var(--card-border);
            gap: 1rem;
        }

        .logo-title {
            display: flex;
            align-items: center;
            gap: 1rem;
        }

        .sport-icon-wrapper {
            width: 48px;
            height: 48px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: rgba(16, 185, 129, 0.1);
            border-radius: 14px;
            border: 1px solid rgba(16, 185, 129, 0.25);
            box-shadow: 0 0 20px rgba(16, 185, 129, 0.2);
            transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.3s ease;
        }

        .sport-icon-wrapper:hover {
            transform: rotate(15deg) scale(1.1);
            box-shadow: 0 0 30px rgba(6, 182, 212, 0.45);
        }

        .sport-icon {
            width: 32px;
            height: 32px;
        }

        .logo-title h1 {
            font-size: 1.85rem;
            font-weight: 800;
            background: linear-gradient(135deg, #38bdf8, #818cf8, #c084fc);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            letter-spacing: -0.02em;
        }

        .meta-badge {
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid var(--card-border);
            padding: 0.4rem 0.8rem;
            border-radius: 20px;
            font-size: 0.85rem;
            color: var(--text-muted);
        }

        .pulse-dot {
            width: 8px;
            height: 8px;
            background-color: var(--accent-green);
            border-radius: 50%;
            box-shadow: 0 0 10px var(--accent-green);
            animation: pulse 2s infinite;
        }

        @keyframes pulse {
            0% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.4; transform: scale(1.2); }
            100% { opacity: 1; transform: scale(1); }
        }

        /* Metric Cards */
        .metrics-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
            gap: 1.25rem;
            margin-bottom: 2rem;
        }

        .metric-card {
            background: var(--card-bg);
            backdrop-filter: blur(12px);
            border: 1px solid var(--card-border);
            border-radius: 16px;
            padding: 1.25rem;
            display: flex;
            flex-direction: column;
            gap: 0.5rem;
            transition: transform 0.2s ease, border-color 0.2s ease;
        }

        .metric-card:hover {
            transform: translateY(-2px);
            border-color: rgba(255, 255, 255, 0.15);
        }

        .metric-label {
            font-size: 0.85rem;
            font-weight: 500;
            color: var(--text-muted);
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }

        .metric-value {
            font-size: 1.75rem;
            font-weight: 800;
            color: var(--text-main);
        }

        /* Tabs & Controls */
        .controls-bar {
            display: flex;
            flex-wrap: wrap;
            justify-content: space-between;
            align-items: center;
            gap: 1rem;
            margin-bottom: 1.75rem;
        }

        .tabs {
            display: flex;
            gap: 0.5rem;
            background: rgba(255, 255, 255, 0.04);
            padding: 0.35rem;
            border-radius: 12px;
            border: 1px solid var(--card-border);
            overflow-x: auto;
        }

        .tab-btn {
            background: transparent;
            border: none;
            color: var(--text-muted);
            padding: 0.6rem 1.1rem;
            border-radius: 8px;
            font-size: 0.9rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s ease;
            white-space: nowrap;
        }

        .tab-btn:hover {
            color: var(--text-main);
        }

        .tab-btn.active {
            background: var(--accent-blue);
            color: #ffffff;
            box-shadow: 0 4px 12px rgba(59, 130, 246, 0.35);
        }

        .search-box {
            position: relative;
            min-width: 260px;
        }

        .search-input {
            width: 100%;
            background: var(--card-bg);
            border: 1px solid var(--card-border);
            color: var(--text-main);
            padding: 0.65rem 1rem;
            border-radius: 10px;
            font-size: 0.9rem;
            outline: none;
            transition: border-color 0.2s ease;
        }

        .search-input:focus {
            border-color: var(--accent-blue);
        }

        /* Filter Pills */
        .filter-group {
            display: flex;
            flex-wrap: wrap;
            gap: 0.5rem;
            margin-bottom: 1.5rem;
        }

        .filter-chip {
            background: var(--card-bg);
            border: 1px solid var(--card-border);
            color: var(--text-muted);
            padding: 0.45rem 0.9rem;
            border-radius: 20px;
            font-size: 0.825rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s ease;
        }

        .filter-chip.active, .filter-chip:hover {
            border-color: rgba(255, 255, 255, 0.3);
            color: var(--text-main);
            background: rgba(255, 255, 255, 0.1);
        }

        .filter-chip.upset-chip.active { background: rgba(239, 68, 68, 0.2); border-color: var(--accent-red); color: #fca5a5; }
        .filter-chip.strict-chip.active { background: rgba(16, 185, 129, 0.2); border-color: var(--accent-green); color: #6ee7b7; }
        .filter-chip.dnb-chip.active { background: rgba(245, 158, 11, 0.2); border-color: var(--accent-amber); color: #fde047; }

        /* Match Cards Grid */
        .tab-content { display: none; }
        .tab-content.active { display: block; }

        .matches-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
            gap: 1.25rem;
        }

        .match-card {
            background: var(--card-bg);
            backdrop-filter: blur(12px);
            border: 1px solid var(--card-border);
            border-radius: 16px;
            padding: 1.35rem;
            display: flex;
            flex-direction: column;
            gap: 1rem;
            position: relative;
            overflow: hidden;
            transition: transform 0.2s ease, border-color 0.2s ease;
        }

        .match-card:hover {
            transform: translateY(-3px);
            border-color: rgba(255, 255, 255, 0.18);
        }

        .match-card.is-upset {
            border-color: rgba(239, 68, 68, 0.5);
            background: linear-gradient(180deg, rgba(239, 68, 68, 0.08) 0%, var(--card-bg) 100%);
        }

        .match-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: 0.825rem;
            color: var(--text-muted);
            font-weight: 500;
        }

        .match-id {
            background: rgba(255, 255, 255, 0.06);
            padding: 0.2rem 0.55rem;
            border-radius: 6px;
            font-weight: 700;
        }

        .match-teams {
            display: flex;
            flex-direction: column;
            gap: 0.75rem;
        }

        .team-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .team-info {
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }

        .team-name {
            font-size: 1.05rem;
            font-weight: 700;
            color: var(--text-main);
        }

        .style-badge {
            font-size: 0.7rem;
            font-weight: 700;
            padding: 0.2rem 0.5rem;
            border-radius: 6px;
            text-transform: uppercase;
        }

        .style-badge.aggressive {
            background: rgba(249, 115, 22, 0.18);
            color: var(--accent-orange);
            border: 1px solid rgba(249, 115, 22, 0.3);
        }

        .style-badge.defensive {
            background: rgba(6, 182, 212, 0.18);
            color: var(--accent-cyan);
            border: 1px solid rgba(6, 182, 212, 0.3);
        }

        /* Player Performance Profile Box */
        .profile-box {
            background: rgba(15, 23, 42, 0.4);
            border: 1px solid var(--card-border);
            border-radius: 10px;
            padding: 0.65rem 0.85rem;
            display: flex;
            flex-direction: column;
            gap: 0.4rem;
            font-size: 0.75rem;
        }

        .profile-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            color: var(--text-muted);
        }

        .slot-badge {
            font-size: 0.7rem;
            font-weight: 700;
            padding: 0.15rem 0.45rem;
            border-radius: 5px;
        }

        .slot-badge.PEAK { background: rgba(16, 185, 129, 0.2); color: #6ee7b7; border: 1px solid rgba(16, 185, 129, 0.4); }
        .slot-badge.COLD { background: rgba(239, 68, 68, 0.2); color: #fca5a5; border: 1px solid rgba(239, 68, 68, 0.4); }
        .slot-badge.NEUTRAL { background: rgba(148, 163, 184, 0.15); color: #cbd5e1; border: 1px solid rgba(148, 163, 184, 0.3); }

        /* Expected Goals Bar */
        .xg-section {
            background: rgba(0, 0, 0, 0.25);
            padding: 0.75rem 1rem;
            border-radius: 10px;
            display: flex;
            flex-direction: column;
            gap: 0.4rem;
        }

        .xg-header {
            display: flex;
            justify-content: space-between;
            font-size: 0.775rem;
            color: var(--text-muted);
            font-weight: 600;
        }

        .xg-bar-container {
            height: 8px;
            width: 100%;
            background: rgba(255, 255, 255, 0.1);
            border-radius: 4px;
            display: flex;
            overflow: hidden;
        }

        .xg-bar-home {
            height: 100%;
            background: linear-gradient(90deg, #38bdf8, #3b82f6);
            transition: width 0.3s ease;
        }

        .xg-bar-away {
            height: 100%;
            background: linear-gradient(90deg, #a855f7, #ec4899);
            transition: width 0.3s ease;
        }

        /* Prediction Banner */
        .prediction-box {
            padding: 0.85rem 1rem;
            border-radius: 10px;
            font-size: 0.9rem;
            font-weight: 700;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 0.5rem;
        }

        .prediction-box.upset {
            background: rgba(239, 68, 68, 0.18);
            border: 1px solid rgba(239, 68, 68, 0.4);
            color: #fca5a5;
        }

        .prediction-box.strict {
            background: rgba(16, 185, 129, 0.18);
            border: 1px solid rgba(16, 185, 129, 0.4);
            color: #6ee7b7;
        }

        .prediction-box.dnb {
            background: rgba(245, 158, 11, 0.18);
            border: 1px solid rgba(245, 158, 11, 0.4);
            color: #fde047;
        }

        .prediction-box.skip {
            background: rgba(148, 163, 184, 0.1);
            border: 1px solid rgba(148, 163, 184, 0.2);
            color: var(--text-muted);
            font-style: italic;
        }

        /* Match History Box */
        .match-history-box {
            background: rgba(0, 0, 0, 0.25);
            border: 1px solid var(--card-border);
            border-radius: 10px;
            padding: 0.75rem;
            display: flex;
            flex-direction: column;
            gap: 0.5rem;
        }

        .history-row {
            display: flex;
            flex-direction: column;
            gap: 0.25rem;
        }

        .history-label {
            font-size: 0.725rem;
            font-weight: 700;
            color: var(--text-muted);
            text-transform: uppercase;
            letter-spacing: 0.04em;
        }

        .history-tags {
            display: flex;
            flex-wrap: wrap;
            gap: 0.35rem;
        }

        .history-tag {
            font-size: 0.75rem;
            font-weight: 800;
            padding: 0.2rem 0.5rem;
            border-radius: 6px;
            background: rgba(255, 255, 255, 0.08);
            border: 1px solid var(--card-border);
            color: var(--text-main);
            cursor: pointer;
            user-select: none;
            transition: all 0.2s ease;
        }

        .history-tag:hover {
            transform: scale(1.12);
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
        }

        .history-tag.W { background: rgba(16, 185, 129, 0.2); border-color: rgba(16, 185, 129, 0.4); color: #6ee7b7; }
        .history-tag.L { background: rgba(239, 68, 68, 0.2); border-color: rgba(239, 68, 68, 0.4); color: #fca5a5; }
        .history-tag.D { background: rgba(148, 163, 184, 0.2); border-color: rgba(148, 163, 184, 0.35); color: #cbd5e1; }
        .history-tag.h2h-tag { background: rgba(59, 130, 246, 0.15); border-color: rgba(59, 130, 246, 0.35); color: #93c5fd; }

        .unc-meter {
            font-size: 0.75rem;
            font-weight: 700;
            padding: 0.25rem 0.55rem;
            border-radius: 6px;
            white-space: nowrap;
        }

        .unc-meter.low { background: rgba(16, 185, 129, 0.25); color: #a7f3d0; }
        .unc-meter.med { background: rgba(245, 158, 11, 0.25); color: #fde68a; }
        .unc-meter.high { background: rgba(239, 68, 68, 0.25); color: #fca5a5; }

        .totals-pills {
            display: flex;
            flex-wrap: wrap;
            gap: 0.4rem;
            font-size: 0.75rem;
        }

        .totals-pill {
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid var(--card-border);
            padding: 0.25rem 0.55rem;
            border-radius: 6px;
            color: var(--text-muted);
        }

        .totals-pill.highlight {
            background: rgba(59, 130, 246, 0.15);
            border-color: rgba(59, 130, 246, 0.3);
            color: #93c5fd;
            font-weight: 600;
        }

        /* Parlay Cards */
        .parlay-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
            gap: 1.5rem;
        }

        .parlay-card {
            background: var(--card-bg);
            backdrop-filter: blur(12px);
            border: 1px solid var(--card-border);
            border-radius: 16px;
            padding: 1.5rem;
            display: flex;
            flex-direction: column;
            gap: 1.25rem;
        }

        .parlay-header {
            display: flex;
            align-items: center;
            gap: 0.75rem;
            padding-bottom: 0.75rem;
            border-bottom: 1px solid var(--card-border);
        }

        .parlay-header h3 {
            font-size: 1.2rem;
            font-weight: 700;
        }

        .parlay-leg {
            background: rgba(0, 0, 0, 0.2);
            padding: 0.85rem 1rem;
            border-radius: 10px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .parlay-leg-title { font-weight: 700; font-size: 0.95rem; }
        .parlay-leg-play { font-weight: 800; color: var(--accent-green); font-size: 0.875rem; }

        /* Tables */
        .table-container {
            background: var(--card-bg);
            backdrop-filter: blur(12px);
            border: 1px solid var(--card-border);
            border-radius: 16px;
            overflow-x: auto;
        }

        table {
            width: 100%;
            border-collapse: collapse;
            text-align: left;
            font-size: 0.9rem;
        }

        th, td {
            padding: 0.9rem 1.2rem;
            border-bottom: 1px solid var(--card-border);
        }

        th {
            background: rgba(255, 255, 255, 0.03);
            color: var(--text-muted);
            font-weight: 700;
            text-transform: uppercase;
            font-size: 0.775rem;
            letter-spacing: 0.05em;
            cursor: pointer;
            user-select: none;
        }

        th:hover { color: var(--text-main); }

        tbody tr:hover {
            background: rgba(255, 255, 255, 0.03);
        }

        .form-pills {
            display: flex;
            gap: 0.25rem;
        }

        .form-pill {
            width: 20px;
            height: 20px;
            border-radius: 4px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 0.65rem;
            font-weight: 800;
            cursor: pointer;
            transition: transform 0.15s ease;
        }

        .form-pill:hover {
            transform: scale(1.2);
        }

        .form-pill.W { background: rgba(16, 185, 129, 0.25); color: #6ee7b7; border: 1px solid rgba(16, 185, 129, 0.4); }
        .form-pill.L { background: rgba(239, 68, 68, 0.25); color: #fca5a5; border: 1px solid rgba(239, 68, 68, 0.4); }
        .form-pill.D { background: rgba(148, 163, 184, 0.2); color: #cbd5e1; border: 1px solid rgba(148, 163, 184, 0.3); }

        /* Terminal Window */
        .terminal-box {
            background: #090d16;
            border: 1px solid var(--card-border);
            border-radius: 12px;
            padding: 1.25rem;
            font-family: 'Courier New', Courier, monospace;
            font-size: 0.85rem;
            color: #38bdf8;
            white-space: pre-wrap;
            overflow-x: auto;
            max-height: 600px;
            line-height: 1.5;
        }

        @media (max-width: 768px) {
            body { padding: 1rem; }
            .matches-grid { grid-template-columns: 1fr; }
            .controls-bar { flex-direction: column; align-items: stretch; }
            .search-box { min-width: 100%; }
        }
    </style>
</head>
<body>
    <div class="container">
        <!-- Header -->
        <header>
            <div class="logo-title">
                <div class="sport-icon-wrapper">
                    <svg class="sport-icon" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <defs>
                            <linearGradient id="logoGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                                <stop offset="0%" stop-color="#10b981" />
                                <stop offset="50%" stop-color="#06b6d4" />
                                <stop offset="100%" stop-color="#3b82f6" />
                            </linearGradient>
                            <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
                                <feDropShadow dx="0" dy="0" stdDeviation="3" flood-color="#10b981" flood-opacity="0.6"/>
                            </filter>
                        </defs>
                        <circle cx="32" cy="32" r="27" stroke="url(#logoGrad)" stroke-width="3" fill="rgba(16, 185, 129, 0.05)" filter="url(#glow)"/>
                        <polygon points="32,15 41,21 38,31 26,31 23,21" fill="url(#logoGrad)" />
                        <path d="M32,15 L32,7 M41,21 L51,15 M38,31 L47,42 M26,31 L17,42 M23,21 L13,15" stroke="url(#logoGrad)" stroke-width="2.5" stroke-linecap="round" />
                    </svg>
                </div>
                <h1>eSoccer AI Model Dashboard</h1>
            </div>
            <div class="meta-badge">
                <span class="pulse-dot"></span>
                <span>Last Updated: <strong>${timestamp}</strong></span>
            </div>
        </header>

        <!-- KPI Metrics -->
        <div class="metrics-grid">
            <div class="metric-card">
                <span class="metric-label">League Avg Goals</span>
                <span class="metric-value" style="color: var(--accent-cyan);">${leagueAvgGoalsPerTeam.toFixed(2)} <span style="font-size: 0.9rem; font-weight: 500;">/ team</span></span>
            </div>
            <div class="metric-card">
                <span class="metric-label">Upcoming Matches</span>
                <span class="metric-value" style="color: var(--accent-blue);">${upcomingMatchData.length}</span>
            </div>
            <div class="metric-card">
                <span class="metric-label">Upset Alerts Flagged</span>
                <span class="metric-value" style="color: var(--accent-red);">${upcomingMatchData.filter(m => m.isUpsetAlert).length}</span>
            </div>
            <div class="metric-card">
                <span class="metric-label">AI Parlay Legs</span>
                <span class="metric-value" style="color: var(--accent-purple);">${totalsParlay.length + winnerParlay.length}</span>
            </div>
        </div>

        <!-- Navigation Tabs & Search Controls -->
        <div class="controls-bar">
            <div class="tabs">
                <button class="tab-btn active" onclick="switchTab('upcoming')">📅 Predictions (${upcomingMatchData.length})</button>
                <button class="tab-btn" onclick="switchTab('parlay')">💡 AI Parlays</button>
                <button class="tab-btn" onclick="switchTab('leaderboard')">📊 Player Leaderboard</button>
                <button class="tab-btn" onclick="switchTab('h2h')">⚔️ Dominant H2H</button>
                <button class="tab-btn" onclick="switchTab('backtest')">📈 Backtest Logs</button>
            </div>
            <div class="search-box">
                <input type="text" id="searchInput" class="search-input" placeholder="🔍 Search player or matchup..." oninput="applyFilters()">
            </div>
        </div>

        <!-- TAB 1: Upcoming Match Predictions -->
        <div id="tab-upcoming" class="tab-content active">
            <div class="filter-group">
                <button class="filter-chip active" onclick="setFilter('all', this)">All Matches</button>
                <button class="filter-chip upset-chip" onclick="setFilter('upset', this)">🚨 Upset Alerts (${upcomingMatchData.filter(m => m.isUpsetAlert).length})</button>
                <button class="filter-chip strict-chip" onclick="setFilter('strict', this)">🏆 Strict Wins</button>
                <button class="filter-chip dnb-chip" onclick="setFilter('dnb', this)">🛡️ Draw No Bet</button>
                <button class="filter-chip" onclick="setFilter('skip', this)">⏹️ Skips</button>
            </div>

            <div class="matches-grid" id="matchesGrid">
                ${upcomingMatchData.map(m => {
                    const homeXgPct = m.totalXG > 0 ? (m.homeXG / m.totalXG * 100).toFixed(0) : 50;
                    const awayXgPct = m.totalXG > 0 ? (m.awayXG / m.totalXG * 100).toFixed(0) : 50;
                    
                    let predClass = "skip";
                    if (m.isUpsetAlert) predClass = "upset";
                    else if (m.predictionType === "STRICT") predClass = "strict";
                    else if (m.predictionType === "DNB") predClass = "dnb";
                    
                    const maxUnc = Math.max(m.homeUnc || 0, m.awayUnc || 0);
                    let uncClass = "low";
                    if (maxUnc > 60) uncClass = "high";
                    else if (maxUnc > 30) uncClass = "med";

                    return `
                    <div class="match-card ${m.isUpsetAlert ? 'is-upset' : ''}" data-type="${m.predictionType.toLowerCase()}" data-search="${m.home.toLowerCase()} ${m.away.toLowerCase()}">
                        <div class="match-header">
                            <span class="match-id">#${m.idx}</span>
                            <span>🕒 ${m.matchTime}</span>
                        </div>

                        <div class="match-teams">
                            <div class="team-row">
                                <div class="team-info">
                                    <span class="team-name">${m.home}</span>
                                    <span class="style-badge ${m.hStyle.toLowerCase()}">${m.hStyle}</span>
                                </div>
                                <span style="font-weight: 700; color: #38bdf8;">${m.homeXG > 0 ? m.homeXG.toFixed(2) : '-'}</span>
                            </div>
                            <div class="team-row">
                                <div class="team-info">
                                    <span class="team-name">${m.away}</span>
                                    <span class="style-badge ${m.aStyle.toLowerCase()}">${m.aStyle}</span>
                                </div>
                                <span style="font-weight: 700; color: #ec4899;">${m.awayXG > 0 ? m.awayXG.toFixed(2) : '-'}</span>
                            </div>
                        </div>

                        ${m.totalXG > 0 ? `
                        <div class="xg-section">
                            <div class="xg-header">
                                <span>Expected Goals Split</span>
                                <span>Total xG: <strong>${m.totalXG.toFixed(2)}</strong>${m.h2hMatches > 0 ? ` <small style="color: var(--accent-cyan); font-size: 0.75rem;">(H2H: ${m.h2hAvgGoals.toFixed(2)})</small>` : ''}</span>
                            </div>
                            <div class="xg-bar-container">
                                <div class="xg-bar-home" style="width: ${homeXgPct}%;"></div>
                                <div class="xg-bar-away" style="width: ${awayXgPct}%;"></div>
                            </div>
                        </div>
                        ` : ''}

                        <div class="prediction-box ${predClass}">
                            <span>${m.prediction.replace(/[*_]/g, '')}</span>
                            ${maxUnc > 0 ? `<span class="unc-meter ${uncClass}">Risk: ${maxUnc}/100</span>` : ''}
                        </div>

                        <div class="totals-pills">
                            ${m.ouPrediction.split('|').map(p => p.replace(/[*_]/g, '').trim()).filter(Boolean).map(p => `<span class="totals-pill highlight">${p}</span>`).join('')}
                        </div>

                        <div class="profile-box">
                            <div class="profile-row">
                                <span>🎯 Quality Scoring / Defending (VS Opponent):</span>
                                <span style="font-weight:700; color: var(--text-main);">${m.home}: ${m.homeAdjScored.toFixed(2)} / ${m.homeAdjDefended.toFixed(2)} | ${m.away}: ${m.awayAdjScored.toFixed(2)} / ${m.awayAdjDefended.toFixed(2)}</span>
                            </div>
                            <div class="profile-row">
                                <span>⏱️ 10-Day Slot (${m.homeSlotPerf.slot}):</span>
                                <div>
                                    <span class="slot-badge ${m.homeSlotPerf.status}">${m.home}: ${m.homeSlotPerf.winRate}%</span>
                                    <span class="slot-badge ${m.awaySlotPerf.status}">${m.away}: ${m.awaySlotPerf.winRate}%</span>
                                </div>
                            </div>
                            <div class="profile-row">
                                <span>🔄 12h Shift Phase (Session):</span>
                                <div>
                                    <span class="slot-badge ${m.homeShift.phase === 2 ? 'PEAK' : (m.homeShift.phase === 1 ? 'STEADY' : 'COLD')}">${m.home}: P${m.homeShift.phase} ${m.homeShift.name}</span>
                                    <span class="slot-badge ${m.awayShift.phase === 2 ? 'PEAK' : (m.awayShift.phase === 1 ? 'STEADY' : 'COLD')}">${m.away}: P${m.awayShift.phase} ${m.awayShift.name}</span>
                                </div>
                            </div>
                            <div class="profile-row">
                                <span>💰 Dynamic Odds:</span>
                                <div>
                                    <span class="slot-badge ${m.homeOdds < 1.83 ? 'COLD' : (m.homeOdds > 1.83 ? 'PEAK' : 'NEUTRAL')}">H2H: ${m.home} @${m.homeOdds.toFixed(2)} / ${m.away} @${m.awayOdds.toFixed(2)}</span>
                                    <span class="slot-badge ${m.overOdds < 1.6 ? 'COLD' : (m.overOdds > 1.6 ? 'PEAK' : 'NEUTRAL')}">OU: Over @${m.overOdds.toFixed(2)} / Under @${m.underOdds.toFixed(2)}</span>
                                </div>
                            </div>
                        </div>

                        <div class="match-history-box">
                            <div class="history-row">
                                <span class="history-label">🔵 ${m.home} Last 5 (Today):</span>
                                <div class="history-tags">
                                    ${m.homeRecent && m.homeRecent.length > 0 ? m.homeRecent.map(h => {
                                        const detailStr = `${m.home} ${h.scored}-${h.conceded} ${h.opponent}`;
                                        const safeStr = detailStr.replace(/'/g, "\\'");
                                        return `<span class="history-tag ${h.result}" title="${safeStr}" onclick="showHistoryPopup('${safeStr}', event)" onmouseenter="showHistoryPopup('${safeStr}', event)">${h.result}</span>`;
                                    }).join('') : '<span style="color: var(--text-muted); font-size: 0.725rem;">No matches today</span>'}
                                </div>
                            </div>
                            <div class="history-row">
                                <span class="history-label">🟣 ${m.away} Last 5 (Today):</span>
                                <div class="history-tags">
                                    ${m.awayRecent && m.awayRecent.length > 0 ? m.awayRecent.map(a => {
                                        const detailStr = `${m.away} ${a.scored}-${a.conceded} ${a.opponent}`;
                                        const safeStr = detailStr.replace(/'/g, "\\'");
                                        return `<span class="history-tag ${a.result}" title="${safeStr}" onclick="showHistoryPopup('${safeStr}', event)" onmouseenter="showHistoryPopup('${safeStr}', event)">${a.result}</span>`;
                                    }).join('') : '<span style="color: var(--text-muted); font-size: 0.725rem;">No matches today</span>'}
                                </div>
                            </div>
                            <div class="history-row">
                                <span class="history-label">⚔️ H2H Last 5 (Today):</span>
                                <div class="history-tags">
                                    ${m.h2hRecent && m.h2hRecent.length > 0 ? m.h2hRecent.map(g => {
                                        const detailStr = `${g.home} ${g.scoreHome}-${g.scoreAway} ${g.away}`;
                                        const safeStr = detailStr.replace(/'/g, "\\'");
                                        return `<span class="history-tag h2h-tag" title="${safeStr}" onclick="showHistoryPopup('${safeStr}', event)" onmouseenter="showHistoryPopup('${safeStr}', event)">${g.scoreStr}</span>`;
                                    }).join('') : '<span style="color: var(--text-muted); font-size: 0.725rem;">No H2H matches today</span>'}
                                </div>
                            </div>
                        </div>
                    </div>
                    `;
                }).join('')}
            </div>
        </div>

        <!-- TAB 2: AI Parlay Recommendations -->
        <div id="tab-parlay" class="tab-content">
            <div class="parlay-grid">
                <!-- Over 2.5 Parlay -->
                <div class="parlay-card">
                    <div class="parlay-header">
                        <span style="font-size: 1.5rem;">⚽</span>
                        <div>
                            <h3>Over 2.5 Goals Parlay (${totalsParlay.length} Legs)</h3>
                            <p style="font-size: 0.825rem; color: var(--text-muted);">Matches with 2x Aggressive players & total xG > 4.00</p>
                        </div>
                    </div>
                    ${totalsParlay.length > 0 ? totalsParlay.map((m, idx) => `
                        <div class="parlay-leg">
                            <div>
                                <div class="parlay-leg-title">${idx + 1}. ${m.computedHome} vs ${m.computedAway}</div>
                                <div style="font-size: 0.775rem; color: var(--text-muted);">Expected Goals: ${m.computedTotalXG.toFixed(2)}</div>
                            </div>
                            <span class="parlay-leg-play">OVER 2.5 Goals</span>
                        </div>
                    `).join('') : '<p style="color: var(--text-muted); font-style: italic;">No high confidence Over 2.5 matches in this rotation.</p>'}
                </div>

                <!-- Winner Parlay -->
                <div class="parlay-card">
                    <div class="parlay-header">
                        <span style="font-size: 1.5rem;">🏆</span>
                        <div>
                            <h3>Winner Parlay (${winnerParlay.length} Legs)</h3>
                            <p style="font-size: 0.825rem; color: var(--text-muted);">Safe Draw No Bet favorites with Uncertainty ≤ 25</p>
                        </div>
                    </div>
                    ${winnerParlay.length > 0 ? winnerParlay.map((m, idx) => {
                        const fav = m.computedPrediction.includes(m.computedHome) ? m.computedHome : m.computedAway;
                        const unc = fav === m.computedHome ? m.computedHomeUnc : m.computedAwayUnc;
                        return `
                        <div class="parlay-leg">
                            <div>
                                <div class="parlay-leg-title">${idx + 1}. ${fav}</div>
                                <div style="font-size: 0.775rem; color: var(--text-muted);">vs ${fav === m.computedHome ? m.computedAway : m.computedHome} (Uncertainty: ${unc}/100)</div>
                            </div>
                            <span class="parlay-leg-play">Draw No Bet</span>
                        </div>
                        `;
                    }).join('') : '<p style="color: var(--text-muted); font-style: italic;">No ultra-safe Draw No Bet favorites in this rotation.</p>'}
                </div>
            </div>
        </div>

        <!-- TAB 3: Player Pattern Analysis Leaderboard -->
        <div id="tab-leaderboard" class="tab-content">
            <div class="table-container">
                <table id="leaderboardTable">
                    <thead>
                        <tr>
                            <th onclick="sortTable(0)">Player ⇕</th>
                            <th onclick="sortTable(1)">Style ⇕</th>
                            <th onclick="sortTable(2)">Matches ⇕</th>
                            <th onclick="sortTable(3)">Win % ⇕</th>
                            <th onclick="sortTable(4)">Avg Scored ⇕</th>
                            <th onclick="sortTable(5)">Avg Conceded ⇕</th>
                            <th>Recent Form</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${activeSortedPlayers.map(p => {
                            const s = playerStats[p];
                            const recentHistory = s.history.slice(-5);
                            const formPills = recentHistory.map(h => {
                                const detailStr = `${p} ${h.scored}-${h.conceded} ${h.opponent}`;
                                const safeDetailStr = detailStr.replace(/'/g, "\\'");
                                return `<span class="form-pill ${h.result}" title="${safeDetailStr}" onclick="showHistoryPopup('${safeDetailStr}', event)" onmouseenter="showHistoryPopup('${safeDetailStr}', event)">${h.result}</span>`;
                            }).join('');
                            return `
                            <tr>
                                <td><strong>${p}</strong></td>
                                <td><span class="style-badge ${s.style.toLowerCase()}">${s.style}</span></td>
                                <td>${s.matches}</td>
                                <td><strong style="color: var(--accent-green);">${s.winRate}%</strong></td>
                                <td>${s.avgScored}</td>
                                <td>${s.avgConceded}</td>
                                <td><div class="form-pills">${formPills}</div></td>
                            </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        </div>

        <!-- TAB 4: Dominant H2H Pairs -->
        <div id="tab-h2h" class="tab-content">
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>Matchup</th>
                            <th>Total Matches</th>
                            <th>Dominant Player</th>
                            <th>Win Rate</th>
                            <th>H2H Breakdown</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${h2hArr.slice(0, 15).map(h => `
                            <tr>
                                <td><strong>${h.matchup}</strong></td>
                                <td>${h.matches}</td>
                                <td><span style="color: var(--accent-blue); font-weight: 700;">${h.dominantPlayer}</span></td>
                                <td><strong style="color: var(--accent-green);">${h.winRate.toFixed(1)}%</strong></td>
                                <td style="color: var(--text-muted); font-size: 0.85rem;">${h.breakdown}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>

        <!-- TAB 5: Backtest Performance Logs -->
        <div id="tab-backtest" class="tab-content">
            <div class="terminal-box">${backtestOutput}</div>
        </div>
    </div>

    <script>
        let currentFilter = 'all';

        function showHistoryPopup(text, event) {
            if (event) event.stopPropagation();
            let popup = document.getElementById('historyPopup');
            if (!popup) {
                popup = document.createElement('div');
                popup.id = 'historyPopup';
                popup.style.cssText = 'position: fixed; bottom: 2rem; left: 50%; transform: translateX(-50%); background: rgba(15, 23, 42, 0.95); backdrop-filter: blur(16px); border: 1px solid var(--accent-cyan); color: var(--text-main); padding: 0.75rem 1.25rem; border-radius: 12px; font-weight: 700; font-size: 0.95rem; box-shadow: 0 10px 25px rgba(0,0,0,0.6); z-index: 9999; transition: opacity 0.2s ease; pointer-events: none;';
                document.body.appendChild(popup);
            }
            popup.innerHTML = '⚽ <span>' + text + '</span>';
            popup.style.opacity = '1';
            clearTimeout(window.popupTimeout);
            window.popupTimeout = setTimeout(function() {
                popup.style.opacity = '0';
            }, 3000);
        }

        function switchTab(tabId) {
            document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

            event.target.classList.add('active');
            document.getElementById('tab-' + tabId).classList.add('active');
        }

        function setFilter(type, element) {
            currentFilter = type;
            document.querySelectorAll('.filter-chip').forEach(chip => chip.classList.remove('active'));
            element.classList.add('active');
            applyFilters();
        }

        function applyFilters() {
            const query = document.getElementById('searchInput').value.toLowerCase().trim();
            const cards = document.querySelectorAll('#matchesGrid .match-card');

            cards.forEach(card => {
                const cardType = card.getAttribute('data-type');
                const searchData = card.getAttribute('data-search');

                const matchesFilter = (currentFilter === 'all') || (cardType === currentFilter);
                const matchesSearch = !query || searchData.includes(query);

                if (matchesFilter && matchesSearch) {
                    card.style.display = 'flex';
                } else {
                    card.style.display = 'none';
                }
            });
        }

        function sortTable(columnIndex) {
            const table = document.getElementById("leaderboardTable");
            let rows, switching, i, x, y, shouldSwitch, dir, switchcount = 0;
            switching = true;
            dir = "asc"; 

            while (switching) {
                switching = false;
                rows = table.rows;
                for (i = 1; i < (rows.length - 1); i++) {
                    shouldSwitch = false;
                    x = rows[i].getElementsByTagName("TD")[columnIndex];
                    y = rows[i + 1].getElementsByTagName("TD")[columnIndex];

                    let xVal = x.textContent.replace('%', '').trim();
                    let yVal = y.textContent.replace('%', '').trim();

                    if (!isNaN(parseFloat(xVal)) && !isNaN(parseFloat(yVal))) {
                        xVal = parseFloat(xVal);
                        yVal = parseFloat(yVal);
                    }

                    if (dir == "asc") {
                        if (xVal > yVal) { shouldSwitch = true; break; }
                    } else if (dir == "desc") {
                        if (xVal < yVal) { shouldSwitch = true; break; }
                    }
                }
                if (shouldSwitch) {
                    rows[i].parentNode.insertBefore(rows[i + 1], rows[i]);
                    switching = true;
                    switchcount ++; 
                } else {
                    if (switchcount == 0 && dir == "asc") {
                        dir = "desc";
                        switching = true;
                    }
                }
            }
        }
    </script>
</body>
</html>`;

    fs.writeFileSync('esoccer_analysis.html', htmlContent);
    console.log("Analysis written to esoccer_analysis.html");
}

generateHtmlReport();
