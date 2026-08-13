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
    const date = new Date(data.generatedAt || Date.now());
    lastUpdated.textContent = `Updated: ${date.toLocaleTimeString()}`;
    lastUpdated.style.color = 'var(--text-muted)';
    
    if (data.leagueAvgGoalsPerTeam) leagueAvg.textContent = data.leagueAvgGoalsPerTeam.toFixed(2);
    
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

    renderUpcomingMatches(data.upcoming || [], data.h2hData || []);
    renderPlayerTables(data.playerStats || {}, data.standings || []);
    renderH2HTables(data.h2hData || [], data.otherH2hData || []);

    firstLoad = false;
}

function renderUpcomingMatches(upcoming, h2hData) {
    if (!upcoming || upcoming.length === 0) {
        premiumPlaysContainer.innerHTML = `
            <div class="match-card">
                <p style="color:var(--text-muted); text-align:center;">No matches found in the upcoming rotation.</p>
            </div>
        `;
        return;
    }
    
    if (firstLoad) premiumPlaysContainer.innerHTML = '';
    
    let html = '';
    upcoming.forEach(m => {
        const date = new Date(m.startDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const isSkipped = m.computedPrediction && m.computedPrediction.includes('SKIP') && !m.isOUPick;
        
        let predHtml = '';
        if (m.computedPrediction && !m.computedPrediction.includes('SKIP')) {
            const fav = m.computedPrediction.includes(m.computedHome) ? m.computedHome : m.computedAway;
            const unc = fav === m.computedHome ? (m.computedHomeUnc || 0) : (m.computedAwayUnc || 0);
            
            let confidenceBadge = m.h2hPreferred ? 
                `<div style="margin-top: 8px; display: inline-block; background: var(--accent-yellow); color: #000; padding: 2px 8px; border-radius: 4px; font-size: 0.7rem; font-weight: bold; box-shadow: 0 0 8px rgba(255, 184, 0, 0.4);">⭐ BEST BET (H2H DOMINANT)</div>` : '';
            
            let uncColor = unc < 20 ? 'var(--accent-green)' : (unc > 40 ? 'var(--accent-red)' : 'var(--accent-yellow)');

            predHtml += `
                <div class="match-prediction ${m.h2hPreferred ? 'highlight-prediction' : ''}">
                    <div class="pred-title">Winner Prediction</div>
                    <div class="pred-value">${m.computedPrediction.replace(/\*\*/g, '').split(' (')[0]} <span style="font-size:0.7rem;">(DNB)</span></div>
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
        const h2hInsight = h2hData.find(h => h.matchup === pairKey);
        
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
    
    premiumPlaysContainer.innerHTML = html;
}

function renderPlayerTables(playerStats, standingsArr) {
    const tbody = document.querySelector('#player-table tbody');
    const standingsTbody = document.querySelector('#standings-table tbody');
    
    // Sort players by win rate purely for the "Player Pattern Analysis" table
    const playerArr = Object.values(playerStats).sort((a, b) => parseFloat(b.winRate) - parseFloat(a.winRate));
    
    if (tbody) {
        let html = '';
        playerArr.forEach(s => {
            const winRate = s.winRate + '%';
            const style = s.style === 'Aggressive' ? '<span style="color:var(--accent-red)">Aggressive</span>' : '<span style="color:var(--accent-blue)">Defensive</span>';
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
                    <td><strong>${s.p}</strong></td>
                    <td>${style}</td>
                    <td>${s.matches}</td>
                    <td>${winRate}</td>
                    <td>${s.avgScored}</td>
                    <td>${s.avgConceded}</td>
                    <td style="font-family:monospace; font-size: 1.1rem;">${form}</td>
                </tr>
            `;
        });
        tbody.innerHTML = html;
    }
    
    if (standingsTbody) {
        let standingsHtml = '';
        standingsArr.forEach((s, idx) => {
            standingsHtml += `
                <tr>
                    <td>${idx + 1}</td>
                    <td><strong>${s.p}</strong></td>
                    <td>${s.matches}</td>
                    <td style="color:var(--accent-green)">${s.wins}</td>
                    <td style="color:var(--accent-yellow)">${s.draws}</td>
                    <td style="color:var(--accent-red)">${s.losses}</td>
                    <td>${s.gd > 0 ? '+'+s.gd : s.gd}</td>
                    <td><strong style="color:var(--accent-blue); font-size: 1.2rem;">${s.points}</strong></td>
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
            topTbody.innerHTML = '<tr><td colspan="5" class="loading-text" style="text-align: center;">No high-domination pairs found.</td></tr>';
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
            otherTbody.innerHTML = '<tr><td colspan="5" class="loading-text" style="text-align: center;">No other pairs found.</td></tr>';
        }
    }
}

// Initial fetch
fetchDashboardData();

// Poll every 30 seconds
setInterval(fetchDashboardData, 30000);
