const fs = require('fs');

const matches = JSON.parse(fs.readFileSync('api_data.json', 'utf8'));

const now = new Date('2026-07-29T23:16:10+10:00'); 

// Sort matches by date ascending
matches.sort((a, b) => new Date(a.startDate) - new Date(b.startDate));

// Get the top 20 upcoming matches that haven't ended
const upcoming = matches.filter(m => m.matchStatus !== 'MATCH_ENDED' && !m.isCancelled).slice(0, 20);

// Helper to get form for a player
function getForm(playerName, limit = 5) {
    const playerMatches = matches
        .filter(m => m.matchStatus === 'MATCH_ENDED' && !m.isCancelled && (m.participantAName === playerName || m.participantBName === playerName))
        .sort((a, b) => new Date(b.startDate) - new Date(a.startDate)); // descending
        
    const form = [];
    for (let i = 0; i < Math.min(limit, playerMatches.length); i++) {
        const m = playerMatches[i];
        if (m.participantAName === playerName) {
            if (m.teamAScore > m.teamBScore) form.push('W');
            else if (m.teamAScore < m.teamBScore) form.push('L');
            else form.push('D');
        } else {
            if (m.teamBScore > m.teamAScore) form.push('W');
            else if (m.teamBScore < m.teamAScore) form.push('L');
            else form.push('D');
        }
    }
    return form;
}

console.log("--- TOP 20 UPCOMING MATCHES & FORM ---");
upcoming.forEach((m, idx) => {
    const homeForm = getForm(m.participantAName);
    const awayForm = getForm(m.participantBName);
    
    // Convert UTC startDate to something more readable
    const matchTime = new Date(m.startDate).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';

    console.log(`\n${idx + 1}. Time: ${matchTime} | ${m.streamName}`);
    console.log(`${m.participantAName} (${m.teamAName}) [Form: ${homeForm.join('-')}] vs ${m.participantBName} (${m.teamBName}) [Form: ${awayForm.join('-')}]`);
    
    const calcPoints = (form) => form.reduce((acc, val) => acc + (val === 'W' ? 3 : val === 'D' ? 1 : 0), 0);
    const homePts = calcPoints(homeForm);
    const awayPts = calcPoints(awayForm);
    
    if (homePts > awayPts) {
        console.log(`Prediction: ${m.participantAName} wins (Form: ${homePts} pts vs ${awayPts} pts)`);
    } else if (awayPts > homePts) {
        console.log(`Prediction: ${m.participantBName} wins (Form: ${awayPts} pts vs ${homePts} pts)`);
    } else {
        console.log(`Prediction: Draw / Toss-up (Equal Form: ${homePts} pts vs ${awayPts} pts)`);
    }
});
