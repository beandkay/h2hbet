// Find configs that push coverage up toward ~20% for BOTH markets independently,
// on the full 30-day dataset, while reporting profit/WR at each coverage level so
// we can see the real cost of buying more volume.
const fs = require('fs');
const { calculateStatistics } = require('../src/statistics');
const { calculateH2H } = require('../src/h2h_engine');
const { groupMatchesByRotation, genH2HVariant } = require('./tune');

const DATA_FILE = process.argv[2] || 'recent_31day_fresh.json';
const allMatches = JSON.parse(fs.readFileSync(__dirname + '/' + DATA_FILE, 'utf8'));
const blocks = groupMatchesByRotation(allMatches);
const keys = Object.keys(blocks).sort();
console.log(`Range: ${keys[0]} .. ${keys.at(-1)} (${keys.length} blocks)`);

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
console.log(`Evaluating ${evalKeys.length} rotation blocks\n`);

const STAKE = 5, PAYOUT = 1.6;
function pct(n, d) { return d > 0 ? (n / d * 100) : 0; }

function hoursIntoRotation(startDate) {
    const aestDate = new Date(new Date(startDate).getTime() + 10 * 60 * 60 * 1000);
    const hour = aestDate.getUTCHours();
    const minute = aestDate.getUTCMinutes();
    if (hour >= 4 && hour < 16) return (hour - 4) + minute / 60;
    else if (hour >= 16) return (hour - 16) + minute / 60;
    else return (hour + 8) + minute / 60;
}

// ---- OU: mirrors shipped src/predictor_ou.js exactly (style-bucket split + rotation-warmup skip) ----
function genOU(matches, playerStats, h2hStats, historicalOUStats, cfg) {
    const results = [];
    matches.forEach(m => {
        const home = m.participantAName, away = m.participantBName;
        let sHome = playerStats[home] || { avgScored: 0, avgConceded: 0, matches: 0, streak: [], adjScoringAbility: 0, adjDefendingAbility: 0 };
        let sAway = playerStats[away] || { avgScored: 0, avgConceded: 0, matches: 0, streak: [], adjScoringAbility: 0, adjDefendingAbility: 0 };
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

        let bucket;
        if (hStyle === 'Aggressive' && aStyle === 'Aggressive') bucket = 'AggAgg';
        else if (hStyle === 'Defensive' && aStyle === 'Defensive') bucket = 'DefDef';
        else bucket = 'Mixed';

        const overThresh = cfg.overThresh[bucket];
        const underThresh = cfg.underThresh[bucket];

        let pick = null;
        if (overThresh != null && totalXG >= overThresh) pick = 'OVER';
        else if (underThresh != null && totalXG < underThresh) pick = 'UNDER';

        if (needsStats) pick = null;

        let totalOUBets = 0, combinedAcc = 0;
        if (historicalOUStats.playerOU) {
            const hOU = historicalOUStats.playerOU[home] || { bets: 0, correct: 0 };
            const aOU = historicalOUStats.playerOU[away] || { bets: 0, correct: 0 };
            totalOUBets = hOU.bets + aOU.bets;
            const totalOUCorrect = hOU.correct + aOU.correct;
            combinedAcc = totalOUBets > 0 ? (totalOUCorrect / totalOUBets) * 100 : 0;
        }
        if (pick && totalOUBets > 0 && combinedAcc < cfg.poorHistAccThresh) pick = null;
        if (pick && hoursIntoRotation(m.startDate) < 1) pick = null;

        results.push({ home, away, hs: m.teamAScore, as: m.teamBScore, pick });
    });
    return results;
}

function evalOU(cfg) {
    let bets = 0, wins = 0, totalMatches = 0;
    const playerOU = {};
    evalKeys.forEach(key => {
        const { playerStats, h2hStats, matches } = perRotation[key];
        totalMatches += matches.length;
        const predicted = genOU(matches, playerStats, h2hStats, { playerOU }, cfg);
        predicted.forEach(p => {
            if (!playerOU[p.home]) playerOU[p.home] = { bets: 0, correct: 0 };
            if (!playerOU[p.away]) playerOU[p.away] = { bets: 0, correct: 0 };
            if (!p.pick) return;
            const totalG = p.hs + p.as;
            const won = (p.pick === 'OVER' && totalG > 2.5) || (p.pick === 'UNDER' && totalG < 2.5);
            bets++;
            playerOU[p.home].bets++; playerOU[p.away].bets++;
            if (won) { wins++; playerOU[p.home].correct++; playerOU[p.away].correct++; }
        });
    });
    const wr = pct(wins, bets);
    const profit = bets * STAKE * (wr / 100 * PAYOUT - 1);
    return { bets, cov: pct(bets, totalMatches), wr, profit };
}

function evalH2H(cfg) {
    let bets = 0, wins = 0, totalMatches = 0, attempted = 0;
    const h2hHistory = {};
    evalKeys.forEach(key => {
        const { playerStats, h2hStats, matches } = perRotation[key];
        totalMatches += matches.length;
        const predicted = genH2HVariant(matches, playerStats, h2hStats, h2hHistory, cfg);
        predicted.forEach(p => {
            if (!h2hHistory[p.pairKey]) h2hHistory[p.pairKey] = { dnbBets: 0, dnbCorrect: 0 };
            if (p.predictionType === 'SKIP' || !p.pick) return;
            attempted++;
            if (p.hs === p.as) return;
            bets++;
            h2hHistory[p.pairKey].dnbBets++;
            const won = (p.pick === p.home && p.hs > p.as) || (p.pick === p.away && p.as > p.hs);
            if (won) { wins++; h2hHistory[p.pairKey].dnbCorrect++; }
        });
    });
    const wr = pct(wins, bets);
    const profit = bets * STAKE * (wr / 100 * PAYOUT - 1);
    return { bets, attempted, cov: pct(attempted, totalMatches), wr, profit };
}

// ===================== OU sweep =====================
const SHIPPED_OU = { overThresh: { AggAgg: 3.1, DefDef: null, Mixed: 3.9 }, underThresh: { AggAgg: null, DefDef: 2.6, Mixed: null }, poorHistAccThresh: 40 };
const shippedOU = evalOU(SHIPPED_OU);
console.log(`SHIPPED OU (AggAgg-ov3.1, DefDef-un2.6, Mixed-ov3.9): bets=${shippedOU.bets} cov=${shippedOU.cov.toFixed(1)}% WR=${shippedOU.wr.toFixed(1)}% Profit=$${shippedOU.profit.toFixed(0)}`);

console.log('\n=== OU sweep: loosen AggAgg-over, DefDef-under, Mixed-over/under jointly ===');
const ouRows = [];
[2.7, 2.8, 2.9, 3.0, 3.1].forEach(aggOv => {
    [2.6, 2.7, 2.8, 2.9].forEach(defUn => {
        [3.4, 3.5, 3.6, 3.7, 3.8, 3.9].forEach(mixOv => {
            [null, 2.3, 2.4, 2.5].forEach(mixUn => {
                const cfg = { overThresh: { AggAgg: aggOv, DefDef: null, Mixed: mixOv }, underThresh: { AggAgg: null, DefDef: defUn, Mixed: mixUn }, poorHistAccThresh: 40 };
                const r = evalOU(cfg);
                if (r.bets < 5) return;
                ouRows.push({ aggOv, defUn, mixOv, mixUn, ...r });
            });
        });
    });
});
console.log(`Configs tested: ${ouRows.length}`);

console.log('\nBest-by-profit within each coverage bucket:');
[[15, 20], [18, 22], [20, 25], [25, 30]].forEach(([lo, hi]) => {
    const bucket = ouRows.filter(r => r.cov >= lo && r.cov < hi);
    if (!bucket.length) { console.log(`${lo}-${hi}%: none`); return; }
    const best = [...bucket].sort((a, b) => b.profit - a.profit)[0];
    console.log(`${lo}-${hi}%: bets=${best.bets} cov=${best.cov.toFixed(1)}% WR=${best.wr.toFixed(1)}% Profit=$${best.profit.toFixed(0)} | AggAgg-ov=${best.aggOv} DefDef-un=${best.defUn} Mixed-ov=${best.mixOv} Mixed-un=${best.mixUn}`);
});

console.log('\nTop 10 OU configs with coverage >= 19% by profit:');
[...ouRows].filter(r => r.cov >= 19).sort((a, b) => b.profit - a.profit).slice(0, 10).forEach(r => {
    console.log(`bets=${String(r.bets).padStart(4)} cov=${r.cov.toFixed(1).padStart(5)}% WR=${r.wr.toFixed(1).padStart(5)}% Profit=$${r.profit.toFixed(0).padStart(5)} | AggAgg-ov=${r.aggOv} DefDef-un=${r.defUn} Mixed-ov=${r.mixOv} Mixed-un=${r.mixUn}`);
});

// ===================== H2H sweep =====================
const SHIPPED_H2H = { minMatchesForStats: 3, phase1MinMatches: 5, phase1HighWR: 55, phase1LowWR: 45, phase2H2HWR: 70, phase2FormWR: 30, phase3H2HWR: 55, poorHistMinBets: 3, poorHistAccThresh: 50 };
const shippedH2H = evalH2H(SHIPPED_H2H);
console.log(`\n\nSHIPPED H2H (P1:55/45 P2:70/30 P3:55 poor<50): bets=${shippedH2H.bets} attempted=${shippedH2H.attempted} cov=${shippedH2H.cov.toFixed(1)}% WR=${shippedH2H.wr.toFixed(1)}% Profit=$${shippedH2H.profit.toFixed(0)}`);

console.log('\n=== H2H sweep: loosen phase thresholds ===');
const h2hRows = [];
[45, 50, 55, 60].forEach(p1h => {
    [40, 45, 50].forEach(p1l => {
        if (p1l >= p1h) return;
        [55, 60, 65, 70].forEach(p2h => {
            [25, 30, 35].forEach(p2f => {
                [50, 55, 60].forEach(p3h => {
                    [40, 45, 50].forEach(poor => {
                        const cfg = { minMatchesForStats: 3, phase1MinMatches: 5, phase1HighWR: p1h, phase1LowWR: p1l, phase2H2HWR: p2h, phase2FormWR: p2f, phase3H2HWR: p3h, poorHistMinBets: 3, poorHistAccThresh: poor };
                        const r = evalH2H(cfg);
                        if (r.bets < 5) return;
                        h2hRows.push({ p1h, p1l, p2h, p2f, p3h, poor, ...r });
                    });
                });
            });
        });
    });
});
console.log(`Configs tested: ${h2hRows.length}`);

console.log('\nBest-by-profit within each coverage bucket:');
[[15, 20], [18, 22], [20, 25], [25, 30]].forEach(([lo, hi]) => {
    const bucket = h2hRows.filter(r => r.cov >= lo && r.cov < hi);
    if (!bucket.length) { console.log(`${lo}-${hi}%: none`); return; }
    const best = [...bucket].sort((a, b) => b.profit - a.profit)[0];
    console.log(`${lo}-${hi}%: bets=${best.bets} cov=${best.cov.toFixed(1)}% WR=${best.wr.toFixed(1)}% Profit=$${best.profit.toFixed(0)} | P1:${best.p1h}/${best.p1l} P2:${best.p2h}/${best.p2f} P3:${best.p3h} poor<${best.poor}`);
});

console.log('\nTop 10 H2H configs with coverage >= 19% by profit:');
[...h2hRows].filter(r => r.cov >= 19).sort((a, b) => b.profit - a.profit).slice(0, 10).forEach(r => {
    console.log(`bets=${String(r.bets).padStart(4)} cov=${r.cov.toFixed(1).padStart(5)}% WR=${r.wr.toFixed(1).padStart(5)}% Profit=$${r.profit.toFixed(0).padStart(5)} | P1:${r.p1h}/${r.p1l} P2:${r.p2h}/${r.p2f} P3:${r.p3h} poor<${r.poor}`);
});
