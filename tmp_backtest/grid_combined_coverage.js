// The live dashboard bets on TWO independent markets per match:
//   1. OU2.5 (Over/Under) -- src/predictor_ou.js, current live: OV=3.1/UN=2.6/strict/poor<40
//   2. Winner/DNB via the 3-phase H2H model -- src/predictor_h2h.js, current live:
//      Phase1 (h2h<3 matches):  form winRate >=55 vs <=40, needs 5+ matches each side
//      Phase2 (h2h 3-9):        h2h winRate >=70 AND form winRate >=35
//      Phase3 (h2h 10+):        h2h winRate >=60
//      Poor Model History: rotation-scoped h2hPredBets>=3 && acc<60 -> SKIP
// grid_7day_coverage.js only ever modeled OU2.5 coverage. This script models BOTH
// markets together: "coverage" = fraction of matches with a bet on AT LEAST ONE market
// (union, not sum) -- since a match can carry an OU bet, an H2H bet, both, or neither.
const fs = require('fs');
const { calculateStatistics } = require('../src/statistics');
const { calculateH2H } = require('../src/h2h_engine');
const { groupMatchesByRotation, genOUVariant, genH2HVariant } = require('./tune');

const STAKE = 5, PAYOUT = 1.6;
const COVERAGE_MIN = 0.50;
function pct(n, d) { return d > 0 ? (n / d * 100) : 0; }

function buildRotations(dataFile) {
    const allMatches = JSON.parse(fs.readFileSync(__dirname + '/' + dataFile, 'utf8'));
    const blocks = groupMatchesByRotation(allMatches);
    const keys = Object.keys(blocks).sort();
    const perRotation = {};
    const MIN_PAST = 50;
    keys.forEach((key, idx) => {
        const past = [];
        keys.slice(0, idx).forEach(k => past.push(...blocks[k]));
        if (past.length < MIN_PAST) return;
        const totalGoals = past.reduce((s, m) => s + m.teamAScore + m.teamBScore, 0);
        const leagueAvg = totalGoals / (past.length * 2);
        const { playerStats } = calculateStatistics(JSON.parse(JSON.stringify(past)), leagueAvg);
        const { h2hStats } = calculateH2H(JSON.parse(JSON.stringify(past)));
        perRotation[key] = { playerStats, h2hStats, matches: blocks[key] };
    });
    const evalKeys = Object.keys(perRotation).sort();
    return { perRotation, evalKeys, range: [keys[0], keys.at(-1)], totalBlocks: keys.length };
}

// Runs both markets together over the same walk, so coverage/profit reflect a bettor
// who applies both models to every match every rotation (mirrors the live dashboard).
function evalCombined(perRotation, evalKeys, ouCfg, h2hCfg) {
    const playerOU = {};
    const h2hHistory = {}; // OU pair tracker (unused unless ouCfg.pairMinBets set)
    const h2hDnbHistory = {}; // H2H pair tracker for poorHistAccThresh gate
    let totalMatches = 0;
    let ouBets = 0, ouWins = 0, ouLosses = 0;
    let h2hAttempted = 0, h2hSettled = 0, h2hWins = 0, h2hLosses = 0;
    let unionBets = 0; // matches with >=1 bet on either market (coverage numerator)
    const rotCoverage = [];

    evalKeys.forEach(key => {
        const { playerStats, h2hStats, matches } = perRotation[key];
        totalMatches += matches.length;

        const ouPredicted = genOUVariant(matches, playerStats, h2hStats, { playerOU, h2hHistory }, ouCfg);
        const h2hPredicted = genH2HVariant(matches, playerStats, h2hStats, h2hDnbHistory, h2hCfg);

        let rotMatches = matches.length, rotBets = 0;

        for (let i = 0; i < matches.length; i++) {
            const oP = ouPredicted[i], hP = h2hPredicted[i];
            const totalG = oP.hs + oP.as;
            let hasOUBet = false, hasH2HBet = false;

            if (!playerOU[oP.home]) playerOU[oP.home] = { bets: 0, correct: 0 };
            if (!playerOU[oP.away]) playerOU[oP.away] = { bets: 0, correct: 0 };
            if (!h2hHistory[oP.pairKey]) h2hHistory[oP.pairKey] = { ouBets: 0, ouCorrect: 0 };
            if (oP.pick) {
                hasOUBet = true;
                ouBets++;
                playerOU[oP.home].bets++; playerOU[oP.away].bets++;
                h2hHistory[oP.pairKey].ouBets++;
                const won = (oP.pick === 'OVER' && totalG > 2.5) || (oP.pick === 'UNDER' && totalG < 2.5);
                if (won) { ouWins++; playerOU[oP.home].correct++; playerOU[oP.away].correct++; h2hHistory[oP.pairKey].ouCorrect++; }
                else { ouLosses++; }
            }

            if (!h2hDnbHistory[hP.pairKey]) h2hDnbHistory[hP.pairKey] = { dnbBets: 0, dnbCorrect: 0 };
            if (hP.predictionType !== "SKIP" && hP.pick) {
                hasH2HBet = true;
                h2hAttempted++; // counted for coverage even if this match is a draw (push)
                if (hP.hs !== hP.as) {
                    h2hSettled++;
                    h2hDnbHistory[hP.pairKey].dnbBets++;
                    const won = (hP.pick === hP.home && hP.hs > hP.as) || (hP.pick === hP.away && hP.as > hP.hs);
                    if (won) { h2hWins++; h2hDnbHistory[hP.pairKey].dnbCorrect++; }
                    else { h2hLosses++; }
                }
            }

            if (hasOUBet || hasH2HBet) { unionBets++; rotBets++; }
        }
        rotCoverage.push(rotMatches > 0 ? rotBets / rotMatches : 0);
    });

    const ouWinRate = pct(ouWins, ouBets);
    const ouProfit = ouBets * STAKE * (ouWinRate / 100 * PAYOUT - 1);
    const h2hWinRate = pct(h2hWins, h2hSettled);
    const h2hProfit = h2hSettled * STAKE * (h2hWinRate / 100 * PAYOUT - 1);
    const combinedProfit = ouProfit + h2hProfit;
    const coverage = totalMatches > 0 ? unionBets / totalMatches : 0;
    const avgRotCoverage = rotCoverage.length > 0 ? rotCoverage.reduce((a, b) => a + b, 0) / rotCoverage.length : 0;

    return {
        totalMatches, ouBets, ouWinRate, ouProfit,
        h2hAttempted, h2hSettled, h2hWinRate, h2hProfit,
        unionBets, coverage, avgRotCoverage, combinedProfit
    };
}

const OU_LIVE = { optimalOv: 3.1, optimalUn: 2.6, styleMode: 'strict', poorHistAccThresh: 40 };
const H2H_LIVE = { minMatchesForStats: 3, phase1MinMatches: 5, phase1HighWR: 55, phase1LowWR: 40, phase2H2HWR: 70, phase2FormWR: 35, phase3H2HWR: 60, poorHistMinBets: 3, poorHistAccThresh: 60 };

const P1_HIGH = [50, 55, 60, 65, 70];
const P1_LOW = [30, 35, 40, 45];
const P2_H2H = [55, 60, 65, 70, 75];
const P2_FORM = [30, 35, 40, 45];
const P3_H2H = [50, 55, 60, 65, 70];

['recent_7day_fresh.json', 'recent_21day_fresh.json'].forEach(dataFile => {
    const { perRotation, evalKeys, range, totalBlocks } = buildRotations(dataFile);
    console.log(`\n########## ${dataFile}  (${totalBlocks} blocks, ${range[0]}..${range[1]}, ${evalKeys.length} evaluable) ##########`);

    const liveBoth = evalCombined(perRotation, evalKeys, OU_LIVE, H2H_LIVE);
    console.log(`LIVE (OU 3.1/2.6/strict/<40 + H2H 55/40,70/35,60/<60):`);
    console.log(`  OU:  bets=${liveBoth.ouBets}/${liveBoth.totalMatches} WR=${liveBoth.ouWinRate.toFixed(1)}% Profit=$${liveBoth.ouProfit.toFixed(0)}`);
    console.log(`  H2H: bets=${liveBoth.h2hSettled} (attempted=${liveBoth.h2hAttempted}) WR=${liveBoth.h2hWinRate.toFixed(1)}% Profit=$${liveBoth.h2hProfit.toFixed(0)}`);
    console.log(`  COMBINED coverage (>=1 market)=${(liveBoth.coverage*100).toFixed(1)}% avgRotCov=${(liveBoth.avgRotCoverage*100).toFixed(1)}%  CombinedProfit=$${liveBoth.combinedProfit.toFixed(0)}`);

    // Sweep H2H phase thresholds with OU held at current live settings.
    const rows = [];
    P1_HIGH.forEach(p1h => P1_LOW.forEach(p1l => {
        if (p1l >= p1h - 5) return;
        P2_H2H.forEach(p2h => P2_FORM.forEach(p2f => P3_H2H.forEach(p3h => {
            const h2hCfg = { minMatchesForStats: 3, phase1MinMatches: 5, phase1HighWR: p1h, phase1LowWR: p1l, phase2H2HWR: p2h, phase2FormWR: p2f, phase3H2HWR: p3h, poorHistMinBets: 3, poorHistAccThresh: 60 };
            const r = evalCombined(perRotation, evalKeys, OU_LIVE, h2hCfg);
            rows.push({ h2hCfg, ...r });
        })));
    }));
    console.log(`Swept ${rows.length} H2H configs (OU fixed at live settings)`);

    const coverageOk = rows.filter(r => r.coverage > COVERAGE_MIN);
    console.log(`Configs clearing >${(COVERAGE_MIN*100).toFixed(0)}% combined coverage: ${coverageOk.length} / ${rows.length}`);

    const pool = coverageOk.length > 0 ? coverageOk : rows;
    pool.sort((a, b) => b.combinedProfit - a.combinedProfit);
    console.log(`\nTop 10 by combined profit${coverageOk.length > 0 ? ' (coverage > 50%)' : ' (NONE cleared 50% -- showing best available)'}:`);
    pool.slice(0, 10).forEach(r => {
        console.log(`cov=${(r.coverage*100).toFixed(1).padStart(5)}% avgRotCov=${(r.avgRotCoverage*100).toFixed(1).padStart(5)}% OU=$${r.ouProfit.toFixed(0).padStart(5)} H2H=$${r.h2hProfit.toFixed(0).padStart(5)}(${r.h2hSettled}b) Combined=$${r.combinedProfit.toFixed(0).padStart(5)} | P1:${r.h2hCfg.phase1HighWR}/${r.h2hCfg.phase1LowWR} P2:${r.h2hCfg.phase2H2HWR}/${r.h2hCfg.phase2FormWR} P3:${r.h2hCfg.phase3H2HWR}`);
    });
});
