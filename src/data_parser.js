const fs = require('fs');
const path = require('path');

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

function getParsedData() {
    const rootDir = path.resolve(__dirname, '..');
    
    let matchesYesterday = [];
    try { matchesYesterday = JSON.parse(fs.readFileSync(path.join(rootDir, 'api_data_yesterday.json'), 'utf8')); } catch (e) {}
    
    let matchesToday = [];
    try { matchesToday = JSON.parse(fs.readFileSync(path.join(rootDir, 'api_data_latest.json'), 'utf8')); } catch (e) {}
    
    let matchesTomorrow = [];
    try { matchesTomorrow = JSON.parse(fs.readFileSync(path.join(rootDir, 'api_data_tomorrow.json'), 'utf8')); } catch (e) {}

    const allMatches = matchesYesterday.concat(matchesToday).concat(matchesTomorrow);
    const { start: rotStart, end: rotEnd } = getRotationBounds();

    const currentRotationMatches = allMatches.filter(m => {
        const matchTime = new Date(m.startDate);
        return matchTime >= rotStart && matchTime < rotEnd;
    });

    const endedMatches = currentRotationMatches.filter(m => m.matchStatus === 'MATCH_ENDED' && !m.isCancelled);
    const nowTime = new Date();
    const upcomingMatches = currentRotationMatches.filter(m => {
        return m.matchStatus !== 'MATCH_ENDED' 
            && !m.isCancelled 
            && m.matchStatus !== 'PERMANENT_BET_SUSPEND'
            && new Date(m.startDate) > nowTime;
    });

    let totalLeagueMatches = 0;
    let totalLeagueGoals = 0;
    endedMatches.forEach(m => {
        totalLeagueMatches++;
        totalLeagueGoals += (m.teamAScore + m.teamBScore);
    });
    const leagueAvgGoalsPerTeam = totalLeagueMatches > 0 ? (totalLeagueGoals / (totalLeagueMatches * 2)) : 1.5;

    return {
        allMatches,
        currentRotationMatches,
        endedMatches,
        upcomingMatches,
        leagueAvgGoalsPerTeam
    };
}

module.exports = {
    getParsedData,
    getRotationBounds
};
