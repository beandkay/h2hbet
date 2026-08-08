const premiumPlaysContainer = document.getElementById('premium-plays');
const winnerParlayContainer = document.getElementById('winner-parlay');
const backtestOutput = document.getElementById('backtest-output');
const leagueAvg = document.getElementById('league-avg');
const lastUpdated = document.getElementById('last-updated');

let firstLoad = true;

async function fetchDashboardData() {
    try {
        const response = await fetch('./dashboard_data.json');
        if (!response.ok) throw new Error('Network response was not ok');
        const data = await response.json();
        
        renderDashboard(data);
    } catch (error) {
        console.error('Error fetching dashboard data:', error);
        lastUpdated.textContent = 'Error connecting to local server';
        lastUpdated.style.color = 'var(--accent-red)';
    }
}

function renderDashboard(data) {
    // Update basic stats
    const date = new Date(data.updatedAt);
    lastUpdated.textContent = `Updated: ${date.toLocaleTimeString()}`;
    lastUpdated.style.color = 'var(--text-muted)';
    
    leagueAvg.textContent = data.leagueAvgScored.toFixed(2);
    
    // Update Backtest Output
    backtestOutput.textContent = data.backtestOutput || 'No backtest data available.';
    
    // Render Winner Parlay
    if (data.winnerParlay && data.winnerParlay.length > 0) {
        let html = '<ul class="parlay-list">';
        data.winnerParlay.forEach((m, idx) => {
            const fav = m.computedPrediction.includes(m.computedHome) ? m.computedHome : m.computedAway;
            const unc = fav === m.computedHome ? m.computedHomeUnc : m.computedAwayUnc;
            html += `<li>${idx + 1}. <strong>${fav}</strong> to beat ${fav === m.computedHome ? m.computedAway : m.computedHome} <br><span style="font-size:0.8rem;color:var(--text-muted)">Uncertainty: ${unc}/100</span></li>`;
        });
        html += '</ul>';
        winnerParlayContainer.innerHTML = html;
    } else {
        winnerParlayContainer.innerHTML = '<p class="loading-text">No extremely safe Draw No Bet favorites (Uncertainty <= 10) found in this rotation.</p>';
    }

    // Render Premium Plays (Upcoming Matches)
    if (data.upcoming && data.upcoming.length > 0) {
        if (firstLoad) premiumPlaysContainer.innerHTML = '';
        // Find lowest uncertainty to highlight Best Bet
        let minUnc = 999;
        data.upcoming.forEach(m => {
            if (m.computedPrediction && !m.computedPrediction.includes('SKIP')) {
                const fav = m.computedPrediction.includes(m.computedHome) ? m.computedHome : m.computedAway;
                const unc = fav === m.computedHome ? (m.computedHomeUnc || 0) : (m.computedAwayUnc || 0);
                if (unc < minUnc) minUnc = unc;
            }
        });

        let html = '';
        if (data.upcoming.length === 0) {
            html = `
                <div class="match-card">
                    <p style="color:var(--text-muted); text-align:center;">No matches found in the upcoming rotation.</p>
                </div>
            `;
        } else {
            data.upcoming.forEach(m => {
                const date = new Date(m.startDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                const isSkipped = m.computedPrediction && m.computedPrediction.includes('SKIP') && !m.isOUPick;
                
                let predHtml = '';
                if (m.computedPrediction && !m.computedPrediction.includes('SKIP')) {
                    const fav = m.computedPrediction.includes(m.computedHome) ? m.computedHome : m.computedAway;
                    const unc = fav === m.computedHome ? (m.computedHomeUnc || 0) : (m.computedAwayUnc || 0);
                    const isMostConfident = (unc === minUnc);
                    
                    let confidenceBadge = isMostConfident ? 
                        `<div style="margin-top: 8px; display: inline-block; background: var(--accent-yellow); color: #000; padding: 2px 8px; border-radius: 4px; font-size: 0.7rem; font-weight: bold; box-shadow: 0 0 8px rgba(255, 184, 0, 0.4);">⭐ BEST BET</div>` : '';
                    
                    let uncColor = unc < 20 ? 'var(--accent-green)' : (unc > 40 ? 'var(--accent-red)' : 'var(--accent-yellow)');

                    predHtml += `
                        <div class="match-prediction ${isMostConfident ? 'highlight-prediction' : ''}">
                            <div class="pred-title">Winner Prediction</div>
                            <div class="pred-value">${m.computedPrediction.split(' (')[0]} <span style="font-size:0.7rem;">(DNB)</span></div>
                            <div style="font-size:0.8rem; color:var(--text-muted); margin-top:4px;">Risk / Uncertainty: <strong style="color: ${uncColor}">${unc}/100</strong></div>
                            ${confidenceBadge}
                        </div>
                    `;
                } else {
                    predHtml += `
                        <div class="match-prediction" style="opacity: 0.5;">
                            <div class="pred-title">Winner Prediction</div>
                            <div class="pred-value skip" style="color:var(--text-muted)">SKIP (No Edge)</div>
                        </div>
                    `;
                }

                if (m.isOUPick) {
                    const isUnder = m.ouPrediction.includes('UNDER');
                    const colorClass = isUnder ? 'under' : 'over';
                    predHtml += `
                        <div class="match-prediction">
                            <div class="pred-title">Totals Prediction</div>
                            <div class="pred-value ${colorClass}">${m.ouPrediction.replace(/\*\*/g, '')}</div>
                        </div>
                    `;
                }

                const pairKey = [m.participantAName, m.participantBName].sort().join(' vs ');
                const h2hInsight = (data.h2hData || []).find(h => h.matchup === pairKey);
                
                let insightHtml = '';
                if (h2hInsight) {
                    insightHtml = `
                        <div style="margin-top: 12px; padding: 8px 12px; background: rgba(255, 255, 255, 0.03); border-left: 3px solid var(--accent-green); border-radius: 4px; font-size: 0.8rem; line-height: 1.4;">
                            <strong style="color:var(--text-main);">💡 H2H Dominance:</strong> 
                            <span style="color:var(--text-muted);">${h2hInsight.dominantPlayer} wins <strong>${h2hInsight.winRate.toFixed(1)}%</strong> of the time (${h2hInsight.breakdown}).</span>
                        </div>
                    `;
                }

                html += `
                    <div class="match-card ${isSkipped ? 'skipped' : ''}">
                        <div class="match-header">
                            <span>League Match</span>
                            <span>${date}</span>
                        </div>
                        <div class="match-teams">
                            <span>${m.participantAName}</span>
                            <span class="vs">vs</span>
                            <span>${m.participantBName}</span>
                        </div>
                        <div style="display:flex; gap:10px;">
                            ${predHtml}
                        </div>
                        ${insightHtml}
                    </div>
                `;
            });
        }
        
        // Replace content
        premiumPlaysContainer.innerHTML = html;
    }
    
    // Render Player Table
    if (data.playerStats) {
        const tbody = document.querySelector('#player-table tbody');
        // Convert to array and sort by win rate descending
        const playerArr = [];
        for (const p in data.playerStats) {
            const s = data.playerStats[p];
            if (s.matches > 0) {
                const winRateNum = (s.wins / s.matches) * 100;
                playerArr.push({ name: p, ...s, winRateNum });
            }
        }
        
        playerArr.sort((a, b) => b.winRateNum - a.winRateNum || b.matches - a.matches);

        let html = '';
        playerArr.forEach(s => {
            const winRate = s.winRateNum.toFixed(1) + '%';
            const avgScored = (s.goalsScored / s.matches).toFixed(2);
            const avgConceded = (s.goalsConceded / s.matches).toFixed(2);
            const totalAvg = parseFloat(avgScored) + parseFloat(avgConceded);
            const style = totalAvg > 3.0 ? '<span style="color:var(--accent-red)">Aggressive</span>' : '<span style="color:var(--accent-blue)">Defensive</span>';
            const streak = s.streak.slice(-10);
            const olderMatches = streak.slice(0, Math.max(0, streak.length - 3)).join('-');
            const recentMatchesArr = streak.slice(Math.max(0, streak.length - 3));
            
            let recentHtml = recentMatchesArr.map(result => {
                let color = 'var(--text-muted)';
                if (result === 'W') color = 'var(--accent-green)';
                if (result === 'L') color = 'var(--accent-red)';
                return `<span style="color:${color}; font-weight:bold; margin-left: 2px;">${result}</span>`;
            }).join('-');
            
            let form = olderMatches;
            if (olderMatches.length > 0 && recentHtml.length > 0) form += '-';
            form += recentHtml;
            
            html += `
                <tr>
                    <td><strong>${s.name}</strong></td>
                    <td>${style}</td>
                    <td>${s.matches}</td>
                    <td>${winRate}</td>
                    <td>${avgScored}</td>
                    <td>${avgConceded}</td>
                    <td style="font-family:monospace; font-size: 1.1rem;">${form}</td>
                </tr>
            `;
        });
        if (html) tbody.innerHTML = html;
    }

    // Render H2H Table
    if (data.h2hData && data.h2hData.length > 0) {
        const tbody = document.querySelector('#h2h-table tbody');
        let html = '';
        data.h2hData.forEach(h => {
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
        tbody.innerHTML = html;
    }

    firstLoad = false;
}

// Initial fetch
fetchDashboardData();

// Poll every 30 seconds
setInterval(fetchDashboardData, 30000);
