const premiumPlaysContainer = document.getElementById('premium-plays');
const winnerParlayContainer = document.getElementById('winner-parlay');
const backtestOutput = document.getElementById('backtest-output');
const leagueAvg = document.getElementById('league-avg');
const lastUpdated = document.getElementById('last-updated');

let firstLoad = true;

function fetchDashboardData() {
    try {
        if (typeof dashboardData !== 'undefined') {
            renderDashboard(dashboardData);
        } else {
            throw new Error('Dashboard data not found');
        }
    } catch (error) {
        console.error('Error loading dashboard data:', error);
        lastUpdated.textContent = 'Error loading local data. Make sure to run analyze_patterns.js';
        lastUpdated.style.color = 'var(--accent-red)';
    }
}

function renderHistoryTags(recent) {
    if (!recent || recent.length === 0) return '<span style="color:var(--text-muted)">No data</span>';
    return recent.slice(-5).map(r => `<span class="history-tag ${r}">${r}</span>`).join('');
}

function renderDashboard(data) {
    const date = new Date(data.generatedAt || Date.now());
    lastUpdated.innerHTML = `<strong>${date.toLocaleDateString('en-AU', {timeZone: 'Australia/Brisbane', weekday:'long', month:'short', day:'numeric', year:'numeric'})} at ${date.toLocaleTimeString('en-AU', {timeZone: 'Australia/Brisbane'})} AEST</strong>`;
    
    if (data.leagueAvgGoalsPerTeam) leagueAvg.textContent = data.leagueAvgGoalsPerTeam.toFixed(2);
    
    const kpiUpcoming = document.getElementById('kpi-upcoming');
    const kpiBets = document.getElementById('kpi-bets');
    const kpiParlay = document.getElementById('kpi-parlay');
    if (kpiUpcoming && data.upcoming) kpiUpcoming.textContent = data.upcoming.length;
    if (kpiBets && data.upcoming) kpiBets.textContent = data.upcoming.filter(m => m.computedPrediction && !m.computedPrediction.includes('SKIP')).length;
    if (kpiParlay && data.winnerParlay) kpiParlay.textContent = data.winnerParlay.length;
    
    backtestOutput.textContent = data.backtestOutput || 'No backtest data available.';
    
    let profitStr = "$0.00";
    if (data.backtestOutput) {
        const lines = data.backtestOutput.split('\n');
        const plLine = lines.find(l => l.includes('Profit/Loss:'));
        if (plLine) {
            profitStr = plLine.split('Profit/Loss:')[1].trim();
        }
    }
    const kpiProfit = document.getElementById('kpi-profit');
    if (kpiProfit) {
        kpiProfit.textContent = profitStr;
        if (profitStr.includes('-')) kpiProfit.style.color = 'var(--accent-red)';
        else if (profitStr !== '$0.00' && profitStr !== '$0') kpiProfit.style.color = 'var(--accent-green)';
    }
    
    if (data.winnerParlay && data.winnerParlay.length > 0) {
        let html = '';
        data.winnerParlay.forEach((m, idx) => {
            let fav = "DRAW";
            let unc = 0;
            if (!m.computedPrediction.includes("**DRAW**")) {
                fav = m.computedPrediction.includes(m.computedHome) ? m.computedHome : m.computedAway;
                unc = fav === m.computedHome ? m.computedHomeUnc : m.computedAwayUnc;
            } else {
                unc = Math.max(m.computedHomeUnc, m.computedAwayUnc);
            }
            html += `
                <div class="parlay-leg">
                    <span class="parlay-leg-title">${idx + 1}. ${fav === "DRAW" ? "DRAW" : `${fav} to beat ${fav === m.computedHome ? m.computedAway : m.computedHome}`}</span>
                    <span class="parlay-leg-play">Risk: ${unc}/100</span>
                </div>
            `;
        });
        winnerParlayContainer.innerHTML = html;
    } else {
        winnerParlayContainer.innerHTML = '<p style="color:var(--text-muted);">No extremely safe Draw No Bet favorites found in this rotation.</p>';
    }

    renderUpcomingMatches(data.upcoming || [], data.h2hData || [], data.playerStats || {});
    renderPlayerTables(data.playerStats || {}, data.standings || []);
    renderH2HTables(data.h2hData || [], data.otherH2hData || []);

    firstLoad = false;
}

function renderUpcomingMatches(upcoming, h2hData, playerStats) {
    if (!upcoming || upcoming.length === 0) {
        premiumPlaysContainer.innerHTML = `
            <div class="match-card">
                <p style="color:var(--text-muted); text-align:center;">No matches found in the upcoming rotation.</p>
            </div>
        `;
        return;
    }
    
    let html = '';
    upcoming.forEach((m, idx) => {
        const date = new Date(m.startDate).toLocaleTimeString('en-AU', { timeZone: 'Australia/Brisbane', hour: '2-digit', minute: '2-digit' });
        const isSkipped = m.computedPrediction && m.computedPrediction.includes('SKIP') && !m.isOUPick;
        
        let predType = "skip";
        if (!isSkipped) predType = "dnb";
        else if (m.isOUPick) predType = "totals";

        const homeRank = playerStats && playerStats[m.participantAName] && playerStats[m.participantAName].rank ? `<span style="color:var(--text-muted); font-size: 0.9em;">#${playerStats[m.participantAName].rank}</span> ` : '';
        const awayRank = playerStats && playerStats[m.participantBName] && playerStats[m.participantBName].rank ? `<span style="color:var(--text-muted); font-size: 0.9em;">#${playerStats[m.participantBName].rank}</span> ` : '';

        const totalXG = m.computedTotalXG || 0;
        const xgDiff = m.computedXgDiff || 0;
        const hXG = (totalXG / 2) + (xgDiff / 2);
        const aXG = (totalXG / 2) - (xgDiff / 2);
        let totalVal = totalXG > 0 ? totalXG : 1;
        const hXgPct = Math.max(10, Math.min(90, (hXG / totalVal) * 100));
        const aXgPct = 100 - hXgPct;

        let xgHtml = `
            <div class="xg-section">
                <div class="xg-header">
                    <span>Expected Goals Split</span>
                    <span>Total xG: <strong>${totalXG.toFixed(2)}</strong> <small style="color: var(--accent-cyan); font-size: 0.75rem;">(H2H edge: ${Math.abs(xgDiff).toFixed(2)})</small></span>
                </div>
                <div class="xg-bar-container">
                    <div class="xg-bar-home" style="width: ${hXgPct}%;"></div>
                    <div class="xg-bar-away" style="width: ${aXgPct}%;"></div>
                </div>
            </div>
        `;

        let predHtml = '';
        if (m.computedPrediction && !m.computedPrediction.includes('SKIP')) {
            const isDraw = m.computedPrediction.includes('DRAW');
            const fav = isDraw ? 'DRAW' : (m.computedPrediction.includes(m.computedHome) ? m.computedHome : m.computedAway);
            let unc = 0;
            if (isDraw) unc = Math.max(m.computedHomeUnc || 0, m.computedAwayUnc || 0);
            else unc = fav === m.computedHome ? (m.computedHomeUnc || 0) : (m.computedAwayUnc || 0);
            
            let phaseMatch = m.computedPrediction.match(/\((Phase (\d)[^)]+)\)/);
            let phaseBadge = '';
            if (phaseMatch && phaseMatch[1]) {
                const phaseNum = phaseMatch[2];
                phaseBadge = `<span class="phase-${phaseNum}">[PHASE ${phaseNum}]</span> `;
            } else if (m.h2hPreferred) {
                phaseBadge = `<span class="phase-3">[⭐ H2H DOMINANT]</span> `;
            }
            
            let uncClass = unc < 20 ? 'low' : (unc > 40 ? 'high' : 'med');

            predHtml = `
                <div class="prediction-box ${isDraw ? 'strict' : 'dnb'}">
                    <span>${phaseBadge}${m.computedPrediction.replace(/\*\*/g, '').split(' (')[0]} <span style="font-size:0.8rem">(${isDraw ? 'STRAIGHT' : 'DNB'})</span></span>
                    <span class="unc-meter ${uncClass}">Risk: ${unc}/100</span>
                </div>
            `;
        } else {
            predHtml = `
                <div class="prediction-box skip">
                    <span>SKIP (No Mathematical Edge)</span>
                </div>
            `;
        }

        let ouHtml = '';
        if (m.isOUPick && m.ouPrediction) {
            const parts = m.ouPrediction.split('|').map(p => p.replace(/[*_]/g, '').trim());
            ouHtml = `
                <div class="totals-pills">
                    ${parts[0] ? `<span class="totals-pill highlight">${parts[0]}</span>` : ''}
                    ${parts[1] ? `<span class="totals-pill highlight">${parts[1]}</span>` : ''}
                    ${parts[2] ? `<span class="totals-pill">${parts[2]}</span>` : ''}
                </div>
            `;
        }

        // Match History Tags

        const pairKey = [m.participantAName, m.participantBName].sort().join(' vs ');
        const h2hInsight = h2hData.find(h => h.matchup === pairKey);
        let h2hTags = '';
        if (playerStats && playerStats[m.participantAName] && playerStats[m.participantAName].h2hBacktest) {
            h2hTags = playerStats[m.participantAName].h2hBacktest.streak.slice(-5).map(r => `<span class="history-tag h2h-tag">${r}</span>`).join('');
        }
        if (!h2hTags && h2hInsight) h2hTags = '<span style="color:var(--text-muted)">Dominant: ' + h2hInsight.dominantPlayer + '</span>';

        const hStyleClass = m.computedHomeStyle ? m.computedHomeStyle.toLowerCase() : 'neutral';
        const aStyleClass = m.computedAwayStyle ? m.computedAwayStyle.toLowerCase() : 'neutral';

        // Profile Box
        let pHomeQual = playerStats && playerStats[m.participantAName] ? (playerStats[m.participantAName].adjScoringAbility || 1.0) : 1.0;
        let pHomeDef = playerStats && playerStats[m.participantAName] ? (playerStats[m.participantAName].adjDefendingAbility || 1.0) : 1.0;
        let pAwayQual = playerStats && playerStats[m.participantBName] ? (playerStats[m.participantBName].adjScoringAbility || 1.0) : 1.0;
        let pAwayDef = playerStats && playerStats[m.participantBName] ? (playerStats[m.participantBName].adjDefendingAbility || 1.0) : 1.0;

        let slotHtml = '';
        if (m.homeSlotPerf && m.awaySlotPerf) {
            let hBadge = m.homeSlotPerf.status;
            let aBadge = m.awaySlotPerf.status;
            slotHtml = `
                <div class="profile-row">
                    <span>⏱️ Time Slot (${m.homeSlotPerf.slot}):</span>
                    <div>
                        <span class="slot-badge ${hBadge}">${m.participantAName}: ${m.homeSlotPerf.winRate}%</span>
                        <span class="slot-badge ${aBadge}">${m.participantBName}: ${m.awaySlotPerf.winRate}%</span>
                    </div>
                </div>
            `;
        }

        html += `
            <div class="match-card ${m.h2hPreferred ? 'highlight-prediction' : ''}" data-type="${predType}" data-search="${m.participantAName.toLowerCase()} ${m.participantBName.toLowerCase()}">
                <div class="match-header">
                    <span class="match-id">#${idx + 1}</span>
                    <span>🕒 ${date}</span>
                </div>

                <div class="match-teams">
                    <div class="team-row">
                        <div class="team-info">
                            <span class="team-name">${homeRank}${m.participantAName}</span>
                            <span class="style-badge ${hStyleClass}">${m.computedHomeStyle || 'UNKNOWN'}</span>
                        </div>
                        <span style="font-weight: 700; color: #38bdf8;">${hXG.toFixed(2)}</span>
                    </div>
                    <div class="team-row">
                        <div class="team-info">
                            <span class="team-name">${awayRank}${m.participantBName}</span>
                            <span class="style-badge ${aStyleClass}">${m.computedAwayStyle || 'UNKNOWN'}</span>
                        </div>
                        <span style="font-weight: 700; color: #ec4899;">${aXG.toFixed(2)}</span>
                    </div>
                </div>

                ${xgHtml}
                
                ${predHtml}
                
                ${ouHtml}

                <div class="insight-box" style="background: rgba(255,255,255,0.03); border-radius: 8px; padding: 10px; margin-bottom: 12px; font-size: 0.85rem;">
                    <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
                        <span style="color: var(--text-muted);">Historical H2H Leader:</span>
                        <strong style="color: var(--text-main);">${m.h2hFavored && m.h2hFavored !== 'N/A' ? `${m.h2hFavored} (${(m.h2hWinrate || 0).toFixed(1)}%)` : 'No Dominance / N/A'}</strong>
                    </div>
                    <div style="display: flex; justify-content: space-between;">
                        <span style="color: var(--text-muted);">OU Model Historical Accuracy:</span>
                        <strong style="color: ${m.ouCombinedWinrate && m.ouCombinedWinrate >= 50 ? 'var(--accent-cyan)' : 'var(--accent-red)'};">${(m.ouCombinedWinrate || 0).toFixed(1)}%</strong>
                    </div>
                </div>

                <div class="profile-box">
                    <div class="profile-row">
                        <span>🎯 Scoring / Defending Quality:</span>
                        <span style="font-weight:700; color: var(--text-main);">${pHomeQual.toFixed(2)}/${pHomeDef.toFixed(2)} | ${pAwayQual.toFixed(2)}/${pAwayDef.toFixed(2)}</span>
                    </div>
                    ${slotHtml}
                </div>

                <div class="match-history-box">
                    <div class="history-row">
                        <span class="history-label">🔵 ${m.participantAName} Last 5:</span>
                        <div class="history-tags">${renderHistoryTags(m.homeRecent)}</div>
                    </div>
                    <div class="history-row">
                        <span class="history-label">🟣 ${m.participantBName} Last 5:</span>
                        <div class="history-tags">${renderHistoryTags(m.awayRecent)}</div>
                    </div>
                    <div class="history-row">
                        <span class="history-label">⚔️ H2H Backtest (Last 5):</span>
                        <div class="history-tags">${h2hTags}</div>
                    </div>
                </div>
            </div>
        `;
    });
    
    premiumPlaysContainer.innerHTML = html;
}

function renderPlayerTables(playerStats, standings) {
    const standingsTbody = document.querySelector('#standings-table tbody');
    if (standingsTbody) {
        let standingsHtml = '';
        standings.forEach(p => {
            standingsHtml += `
                <tr>
                    <td><strong>${p.rank}</strong></td>
                    <td><strong>${p.p}</strong></td>
                    <td>${p.matches}</td>
                    <td><div class="history-tags">${renderHistoryTags(p.streak)}</div></td>
                    <td>${p.goalsScored} : ${p.goalsConceded}</td>
                    <td style="color:${p.gd > 0 ? 'var(--accent-green)' : (p.gd < 0 ? 'var(--accent-red)' : 'var(--text-main)')}">${p.gd > 0 ? '+'+p.gd : p.gd}</td>
                    <td><strong style="color:var(--accent-cyan)">${p.points}</strong></td>
                </tr>
            `;
        });
        standingsTbody.innerHTML = standingsHtml;
    }
}

function renderH2HTables(h2hData, otherH2hData) {
    const topTbody = document.querySelector('#h2h-table tbody');
    if (topTbody) {
        if (h2hData && h2hData.length > 0) {
            let html = '';
            h2hData.forEach(h => {
                const wr = h.winRate.toFixed(1) + '%';
                html += `
                    <tr>
                        <td><strong>${h.matchup}</strong></td>
                        <td>${h.matches}</td>
                        <td><strong style="color:var(--accent-green)">${h.dominantPlayer}</strong></td>
                        <td>${wr}</td>
                        <td style="color:var(--text-muted)">${h.breakdown}</td>
                    </tr>
                `;
            });
            topTbody.innerHTML = html;
        } else {
            topTbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color:var(--text-muted);">No high-domination pairs found.</td></tr>';
        }
    }

    const otherTbody = document.querySelector('#other-h2h-table tbody');
    if (otherTbody) {
        if (otherH2hData && otherH2hData.length > 0) {
            let html = '';
            otherH2hData.forEach(h => {
                const wr = h.winRate.toFixed(1) + '%';
                html += `
                    <tr>
                        <td><strong>${h.matchup}</strong></td>
                        <td>${h.matches}</td>
                        <td><strong style="color:var(--accent-green)">${h.dominantPlayer}</strong></td>
                        <td>${wr}</td>
                        <td style="color:var(--text-muted)">${h.breakdown}</td>
                    </tr>
                `;
            });
            otherTbody.innerHTML = html;
        } else {
            otherTbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color:var(--text-muted);">No other pairs found.</td></tr>';
        }
    }
}

window.onload = () => {
    fetchDashboardData();
    setInterval(fetchDashboardData, 60000); // refresh every minute
};
