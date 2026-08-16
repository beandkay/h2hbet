const premiumPlaysContainer = document.getElementById('premium-plays');
const winnerParlayContainer = document.getElementById('winner-parlay');
const totalsParlayContainer = document.getElementById('totals-parlay');
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
    return recent.slice(-5).map(r => {
        let text = (typeof r === 'object' && r !== null) ? r.result : r;
        let c = text === 'P' ? 'D' : text; // map P to D for color
        let title = (typeof r === 'object' && r !== null) ? ` title="${r.scored}-${r.conceded} vs ${r.opponent}"` : '';
        return `<span class="history-tag ${c}"${title}>${text}</span>`;
    }).join('');
}

// Actual (not prediction) H2H match winners for this pair — "W" tagged red when
// homePlayer won, blue when away won, "D" for a draw.
function renderH2HActualTags(historyArr, homePlayer) {
    if (!historyArr || historyArr.length === 0) return '<span style="color:var(--text-muted)">No Data</span>';
    const tags = historyArr.slice(-5).map(h => {
        const winner = (typeof h === 'string') ? h : (h ? h.matchWinner : null);
        if (!winner) return '';
        if (winner === 'DRAW') return `<span class="history-tag D">D</span>`;
        const cls = winner === homePlayer ? 'h2h-home' : 'h2h-away';
        return `<span class="history-tag ${cls}" title="${winner} won">W</span>`;
    }).filter(t => t !== '');
    return tags.length > 0 ? tags.join('') : '<span style="color:var(--text-muted)">No Data</span>';
}

// Actual (not prediction) OU2.5 results for this pair — "O" for over, "U" for under.
function renderOUActualTags(historyArr) {
    if (!historyArr || historyArr.length === 0) return '<span style="color:var(--text-muted)">No Data</span>';
    const tags = historyArr.slice(-5).map(h => {
        const val = (typeof h === 'string') ? h : (h ? h.matchOU : null);
        if (!val) return '';
        const isOver = val === 'OVER';
        return `<span class="history-tag ${isOver ? 'ou-o' : 'ou-u'}">${isOver ? 'O' : 'U'}</span>`;
    }).filter(t => t !== '');
    return tags.length > 0 ? tags.join('') : '<span style="color:var(--text-muted)">No Data</span>';
}

function setProfitEl(id, val) {
    const el = document.getElementById(id);
    if (!el) return;
    const num = typeof val === 'number' ? val : 0;
    const str = (num < 0 ? "-$" : "$") + Math.abs(num).toFixed(2);
    el.textContent = str;
    if (num < 0) el.style.color = 'var(--accent-red)';
    else if (num > 0) el.style.color = 'var(--accent-green)';
    else el.style.color = '';
}

function renderDashboard(data) {
    const date = new Date(data.generatedAt || Date.now());
    lastUpdated.innerHTML = `<strong>${date.toLocaleDateString('en-AU', {timeZone: 'Australia/Brisbane', weekday:'long', month:'short', day:'numeric', year:'numeric'})} at ${date.toLocaleTimeString('en-AU', {timeZone: 'Australia/Brisbane'})} AEST</strong>`;

    if (data.leagueAvgGoalsPerTeam) leagueAvg.textContent = data.leagueAvgGoalsPerTeam.toFixed(2);

    const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

    const kpiUpcoming = document.getElementById('kpi-upcoming');
    const upcomingList = data.upcoming || [];
    if (kpiUpcoming) kpiUpcoming.textContent = upcomingList.length;
    setText('kpi-upcoming-dnb', upcomingList.filter(m => m.h2hPoissonPick || m.h2hEloPick).length);
    setText('kpi-upcoming-totals', upcomingList.filter(m => m.ouPoissonPick || m.ouEloPick).length);
    setText('kpi-upcoming-skip', upcomingList.filter(m => !(m.h2hPoissonPick || m.h2hEloPick) && !(m.ouPoissonPick || m.ouEloPick)).length);

    setText('kpi-avg-total-goals', data.leagueAvgGoalsPerTeam ? (data.leagueAvgGoalsPerTeam * 2).toFixed(2) : '--');
    setText('kpi-player-count', (data.standings || []).length);

    backtestOutput.textContent = data.backtestOutput || 'No backtest data available.';

    const rotationPerf = data.extraModelPerformance && data.extraModelPerformance.rotation;

    setProfitEl('kpi-h2h-poisson-profit', rotationPerf && rotationPerf.h2hPoisson ? rotationPerf.h2hPoisson.profit : 0);
    setProfitEl('kpi-h2h-elo-profit', rotationPerf && rotationPerf.h2hElo ? rotationPerf.h2hElo.profit : 0);
    setProfitEl('kpi-ou-poisson-profit', rotationPerf && rotationPerf.ouPoisson ? rotationPerf.ouPoisson.profit : 0);
    setProfitEl('kpi-ou-elo-profit', rotationPerf && rotationPerf.ouElo ? rotationPerf.ouElo.profit : 0);

    const h2hPoissonProfit = rotationPerf && rotationPerf.h2hPoisson ? rotationPerf.h2hPoisson.profit : 0;
    const h2hEloProfit = rotationPerf && rotationPerf.h2hElo ? rotationPerf.h2hElo.profit : 0;
    const ouPoissonProfit = rotationPerf && rotationPerf.ouPoisson ? rotationPerf.ouPoisson.profit : 0;
    const ouEloProfit = rotationPerf && rotationPerf.ouElo ? rotationPerf.ouElo.profit : 0;
    setProfitEl('kpi-profit-poisson', h2hPoissonProfit + ouPoissonProfit);
    setProfitEl('kpi-profit-elo', h2hEloProfit + ouEloProfit);
    setProfitEl('kpi-profit-total', h2hPoissonProfit + h2hEloProfit + ouPoissonProfit + ouEloProfit);
    setProfitEl('kpi-h2h-total-profit', h2hPoissonProfit + h2hEloProfit);
    setProfitEl('kpi-ou-total-profit', ouPoissonProfit + ouEloProfit);

    const ouOverPoisson = rotationPerf && rotationPerf.ouPoisson && rotationPerf.ouPoisson.over ? rotationPerf.ouPoisson.over.profit : 0;
    const ouOverElo = rotationPerf && rotationPerf.ouElo && rotationPerf.ouElo.over ? rotationPerf.ouElo.over.profit : 0;
    setProfitEl('kpi-ou-over-poisson', ouOverPoisson);
    setProfitEl('kpi-ou-over-elo', ouOverElo);
    setProfitEl('kpi-ou-over-total', ouOverPoisson + ouOverElo);

    const ouUnderPoisson = rotationPerf && rotationPerf.ouPoisson && rotationPerf.ouPoisson.under ? rotationPerf.ouPoisson.under.profit : 0;
    const ouUnderElo = rotationPerf && rotationPerf.ouElo && rotationPerf.ouElo.under ? rotationPerf.ouElo.under.profit : 0;
    setProfitEl('kpi-ou-under-poisson', ouUnderPoisson);
    setProfitEl('kpi-ou-under-elo', ouUnderElo);
    setProfitEl('kpi-ou-under-total', ouUnderPoisson + ouUnderElo);

    if (data.winnerParlay && data.winnerParlay.length > 0) {
        let html = '';
        data.winnerParlay.forEach((m, idx) => {
            const opponent = m.h2hPoissonPick === m.participantAName ? m.participantBName : m.participantAName;
            const kickoff = new Date(m.startDate).toLocaleTimeString('en-AU', { timeZone: 'Australia/Brisbane', hour: '2-digit', minute: '2-digit' });
            html += `
                <div class="parlay-leg">
                    <div>
                        <span class="parlay-leg-title">${idx + 1}. ${m.h2hPoissonPick} to beat ${opponent}</span>
                        <div style="color:var(--text-muted); font-size:0.75rem; margin-top:2px;">🕒 ${kickoff} · H2H·Poisson</div>
                    </div>
                    <span class="parlay-leg-play">${m.h2hPoissonProb.toFixed(0)}%</span>
                </div>
            `;
        });
        winnerParlayContainer.innerHTML = html;
    } else {
        winnerParlayContainer.innerHTML = '<p style="color:var(--text-muted);">No H2H·Poisson picks found in this rotation.</p>';
    }

    if (totalsParlayContainer) {
        if (data.totalsParlay && data.totalsParlay.length > 0) {
            let html = '';
            data.totalsParlay.forEach((m, idx) => {
                const kickoff = new Date(m.startDate).toLocaleTimeString('en-AU', { timeZone: 'Australia/Brisbane', hour: '2-digit', minute: '2-digit' });
                html += `
                    <div class="parlay-leg">
                        <div>
                            <span class="parlay-leg-title">${idx + 1}. ${m.participantAName} vs ${m.participantBName} — ${m.ouEloPick} 2.5</span>
                            <div style="color:var(--text-muted); font-size:0.75rem; margin-top:2px;">🕒 ${kickoff} · OU·Elo</div>
                        </div>
                        <span class="parlay-leg-play">${m.ouEloProb.toFixed(0)}%</span>
                    </div>
                `;
            });
            totalsParlayContainer.innerHTML = html;
        } else {
            totalsParlayContainer.innerHTML = '<p style="color:var(--text-muted);">No OU·Elo picks found in this rotation.</p>';
        }
    }

    renderUpcomingMatches(data.upcoming || [], data.h2hData || [], data.playerStats || {}, data.extraModelPerformance || null);
    renderPlayerTables(data.playerStats || {}, data.standings || []);
    renderH2HTables(data.h2hData || [], data.otherH2hData || []);

    // The match-card DOM was fully rebuilt, so any filter chip / search query the user
    // had active is now visually stale. Re-apply it against the new cards.
    if (typeof reapplyFilterAndSearch === 'function') reapplyFilterAndSearch();

    firstLoad = false;
}

function renderUpcomingMatches(upcoming, h2hData, playerStats, extraModelPerformance) {
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

        const homeRank = playerStats && playerStats[m.participantAName] && playerStats[m.participantAName].rank ? `<span style="color:var(--text-muted); font-size: 0.9em;">#${playerStats[m.participantAName].rank}</span> ` : '';
        const awayRank = playerStats && playerStats[m.participantBName] && playerStats[m.participantBName].rank ? `<span style="color:var(--text-muted); font-size: 0.9em;">#${playerStats[m.participantBName].rank}</span> ` : '';

        const hasH2HPick = !!(m.h2hPoissonPick || m.h2hEloPick);
        const hasOUPick = !!(m.ouPoissonPick || m.ouEloPick);
        let predTypes = [];
        if (hasH2HPick) predTypes.push('dnb');
        if (hasOUPick) predTypes.push('totals');
        if (!hasH2HPick && !hasOUPick) predTypes.push('skip');
        const predTypeStr = predTypes.join(' ');

        m.h2hPreferred = (m.h2hPoissonPairAcc >= 60 && m.h2hPoissonPairBets >= 3) || (m.h2hEloPairAcc >= 60 && m.h2hEloPairBets >= 3);

        const hStyleClass = m.homeStyle ? m.homeStyle.toLowerCase() : 'neutral';
        const aStyleClass = m.awayStyle ? m.awayStyle.toLowerCase() : 'neutral';

        let pHomeQual = playerStats && playerStats[m.participantAName] ? (playerStats[m.participantAName].adjScoringAbility || 1.0) : 1.0;
        let pHomeDef = playerStats && playerStats[m.participantAName] ? (playerStats[m.participantAName].adjDefendingAbility || 1.0) : 1.0;
        let pAwayQual = playerStats && playerStats[m.participantBName] ? (playerStats[m.participantBName].adjScoringAbility || 1.0) : 1.0;
        let pAwayDef = playerStats && playerStats[m.participantBName] ? (playerStats[m.participantBName].adjDefendingAbility || 1.0) : 1.0;

        // Signal grid: rows = Winner (H2H) / Totals (OU), cols = Poisson / Elo.
        // Each cell folds in the model's pick+prob and its per-pair rotation
        // accuracy (previously two separate stacked rows) as a subscript.
        const signalCell = (pick, prob, cls, pairAcc, pairBets, pairCorrect) => {
            if (!pick) return `<div class="signal-cell empty"><span class="no-signal">No signal</span></div>`;
            const sub = pairBets > 0 ? `<small>${pairAcc.toFixed(0)}% · ${pairCorrect}/${pairBets}</small>` : '';
            return `<div class="signal-cell ${cls}"><strong>${pick}</strong> ${prob.toFixed(0)}%${sub}</div>`;
        };

        const signalGridHtml = `
            <div class="signal-grid">
                <div class="signal-row signal-header">
                    <span class="signal-label"></span>
                    <span class="signal-col-label poisson">Poisson</span>
                    <span class="signal-col-label elo">Elo</span>
                </div>
                <div class="signal-row">
                    <span class="signal-label">Winner</span>
                    ${signalCell(m.h2hPoissonPick, m.h2hPoissonProb || 0, 'poisson', m.h2hPoissonPairAcc || 0, m.h2hPoissonPairBets || 0, m.h2hPoissonPairCorrect || 0)}
                    ${signalCell(m.h2hEloPick, m.h2hEloProb || 0, 'elo', m.h2hEloPairAcc || 0, m.h2hEloPairBets || 0, m.h2hEloPairCorrect || 0)}
                </div>
                <div class="signal-row">
                    <span class="signal-label">Totals</span>
                    ${signalCell(m.ouPoissonPick, m.ouPoissonProb || 0, `poisson ${(m.ouPoissonPick || '').toLowerCase()}`, m.ouPoissonPairAcc || 0, m.ouPoissonPairBets || 0, m.ouPoissonPairCorrect || 0)}
                    ${signalCell(m.ouEloPick, m.ouEloProb || 0, `elo ${(m.ouEloPick || '').toLowerCase()}`, m.ouEloPairAcc || 0, m.ouEloPairBets || 0, m.ouEloPairCorrect || 0)}
                </div>
            </div>
        `;

        // Quick facts strip: H2H leader + scoring/defending quality + time-slot
        // form, previously three separate boxed sections, now one chip row.
        let slotChip = '';
        if (m.homeSlotPerf && m.awaySlotPerf) {
            slotChip = `<span class="fact-chip">⏱️ <span class="slot-badge ${m.homeSlotPerf.status}">${m.participantAName} ${m.homeSlotPerf.winRate}%</span> <span class="slot-badge ${m.awaySlotPerf.status}">${m.participantBName} ${m.awaySlotPerf.winRate}%</span></span>`;
        }
        const quickFactsHtml = `
            <div class="quick-facts">
                <span class="fact-chip">🏆 ${m.h2hFavored && m.h2hFavored !== 'N/A' ? `${m.h2hFavored} ${(m.h2hWinrate || 0).toFixed(0)}%` : 'No H2H edge'}</span>
                <span class="fact-chip">🎯 ${pHomeQual.toFixed(2)}/${pHomeDef.toFixed(2)} vs ${pAwayQual.toFixed(2)}/${pAwayDef.toFixed(2)}</span>
                ${slotChip}
                <span class="fact-chip">💰 @1.7x odds</span>
            </div>
        `;

        html += `
            <div class="match-card ${m.h2hPreferred ? 'highlight-prediction' : ''}" data-type="${predTypeStr}" data-search="${m.participantAName.toLowerCase()} ${m.participantBName.toLowerCase()}">
                <div class="match-header">
                    <span class="match-id">#${idx + 1}</span>
                    <span>🕒 ${date}</span>
                </div>

                <div class="match-teams">
                    <div class="team-row">
                        <div class="team-info">
                            <span class="team-name">${homeRank}${m.participantAName}</span>
                            <span class="style-badge ${hStyleClass}">${m.homeStyle || 'UNKNOWN'}</span>
                        </div>
                    </div>
                    <div class="team-row">
                        <div class="team-info">
                            <span class="team-name">${awayRank}${m.participantBName}</span>
                            <span class="style-badge ${aStyleClass}">${m.awayStyle || 'UNKNOWN'}</span>
                        </div>
                    </div>
                </div>

                ${signalGridHtml}
                ${quickFactsHtml}

                <details class="history-details" open>
                    <summary>History</summary>
                    <div class="match-history-box">
                        <div class="history-row">
                            <span class="history-label">🔵 ${m.participantAName} Last 5:</span>
                            <div class="history-tags">${m.homeRecent ? renderHistoryTags(m.homeRecent) : ''}</div>
                        </div>
                        <div class="history-row">
                            <span class="history-label">🟣 ${m.participantBName} Last 5:</span>
                            <div class="history-tags">${m.awayRecent ? renderHistoryTags(m.awayRecent) : ''}</div>
                        </div>
                        <div class="history-row" style="margin-top: 6px; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 6px;">
                            <span class="history-label">🆚 H2H Last 5:</span>
                            <div class="history-tags">${m.h2hHistory && m.h2hHistory.length > 0 ? renderH2HActualTags(m.h2hHistory, m.participantAName) : '<span style="color:var(--text-muted)">No Data</span>'}</div>
                        </div>
                        <div class="history-row">
                            <span class="history-label">🥅 H2H OU2.5 Last 5:</span>
                            <div class="history-tags">${m.h2hHistoryOU && m.h2hHistoryOU.length > 0 ? renderOUActualTags(m.h2hHistoryOU) : '<span style="color:var(--text-muted)">No Data</span>'}</div>
                        </div>
                    </div>
                </details>
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
            const styleClass = p.style ? p.style.toLowerCase() : 'neutral';
            standingsHtml += `
                <tr>
                    <td><strong>${p.rank}</strong></td>
                    <td><strong>${p.p}</strong></td>
                    <td>${p.matches}</td>
                    <td><strong style="color:var(--accent-purple)">${p.winRate}%</strong></td>
                    <td><div class="history-tags">${renderHistoryTags(p.streak)}</div></td>
                    <td>${p.goalsScored} : ${p.goalsConceded}</td>
                    <td style="color:var(--text-muted)">${p.avgScored} : ${p.avgConceded}</td>
                    <td style="color:${p.gd > 0 ? 'var(--accent-green)' : (p.gd < 0 ? 'var(--accent-red)' : 'var(--text-main)')}">${p.gd > 0 ? '+'+p.gd : p.gd}</td>
                    <td><span class="style-badge ${styleClass}">${p.style || 'UNKNOWN'}</span></td>
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
                        <td style="color:var(--text-muted)">${(h.avgGoals || 0).toFixed(2)}</td>
                        <td><div class="history-tags">${renderH2HActualTags(h.recentForm, h.dominantPlayer)}</div></td>
                        <td style="color:var(--text-muted)">${h.breakdown}</td>
                    </tr>
                `;
            });
            topTbody.innerHTML = html;
        } else {
            topTbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color:var(--text-muted);">No high-domination pairs found.</td></tr>';
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
                        <td style="color:var(--text-muted)">${(h.avgGoals || 0).toFixed(2)}</td>
                        <td><div class="history-tags">${renderH2HActualTags(h.recentForm, h.dominantPlayer)}</div></td>
                        <td style="color:var(--text-muted)">${h.breakdown}</td>
                    </tr>
                `;
            });
            otherTbody.innerHTML = html;
        } else {
            otherTbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color:var(--text-muted);">No other pairs found.</td></tr>';
        }
    }
}

window.onload = () => {
    fetchDashboardData();

};
