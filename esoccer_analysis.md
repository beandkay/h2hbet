# eSoccer Final Model Predictions

**League Average Goals Per Match (Per Team):** 1.35

## Player Pattern Analysis (Latest Data)

| Player | Style | Matches | Win% | Avg Scored | Avg Conceded | Form (All Matches) |
|---|---|---|---|---|---|---|
| **CHAOS** | Defensive | 28 | 57.1% | 1.36 | 0.86 | L-D-W-W-L-D-D-W-D-W-W-D-W-W-W-W-W-W-W-W-L-W-D-W-W-L-D-L |
| **AMBASSADOR** | Defensive | 23 | 47.8% | 1.74 | 1.26 | D-L-W-W-L-D-L-L-L-L-D-W-D-W-W-L-W-W-W-W-L-W-W |
| **DEMOLISHOR** | Aggressive | 23 | 39.1% | 1.57 | 1.48 | W-D-W-L-L-D-D-W-D-W-L-W-W-L-W-L-D-W-D-D-L-D-W |
| **LAVA** | Aggressive | 22 | 36.4% | 1.68 | 1.64 | W-L-L-D-D-L-W-D-W-W-L-D-D-L-D-L-L-D-W-W-W-W |
| **DART** | Defensive | 26 | 30.8% | 1.00 | 1.04 | W-L-W-D-D-D-D-D-W-D-D-W-W-L-L-L-L-D-D-W-W-D-W-D-L-D |
| **SMHAMILA** | Defensive | 27 | 22.2% | 0.81 | 1.11 | D-L-L-L-L-D-D-D-L-L-L-D-W-L-W-W-W-W-W-D-L-L-L-D-D-L-D |
| **PROPHET** | Aggressive | 23 | 21.7% | 1.17 | 2.00 | L-L-L-L-L-D-D-D-W-W-L-L-W-L-L-D-L-L-D-L-W-L-W |
| **CRUSADER** | Defensive | 7 | 14.3% | 1.00 | 1.43 | L-L-D-L-L-W-D |

## Most Dominant H2H Pairs (Current Rotation)

| Matchup | Matches | Dominant Player | Win Rate | Breakdown |
|---|---|---|---|---|
| **EXILE vs PROPHET** | 8 | EXILE | 75.0% | EXILE: 6W | PROPHET: 1W | Draws: 1 |
| **MAGICIAN vs SPARTAN** | 10 | SPARTAN | 70.0% | MAGICIAN: 0W | SPARTAN: 7W | Draws: 3 |
| **CHAOS vs MAGICIAN** | 10 | CHAOS | 70.0% | CHAOS: 7W | MAGICIAN: 0W | Draws: 3 |
| **CHAOS vs CRUSADER** | 3 | CHAOS | 66.7% | CHAOS: 2W | CRUSADER: 0W | Draws: 1 |
| **FRANCHISE vs LAVA** | 8 | LAVA | 62.5% | FRANCHISE: 1W | LAVA: 5W | Draws: 2 |
| **FRANCHISE vs GUARDIAN** | 8 | GUARDIAN | 62.5% | FRANCHISE: 1W | GUARDIAN: 5W | Draws: 2 |
| **ALIBI vs EXILE** | 7 | EXILE | 57.1% | ALIBI: 2W | EXILE: 4W | Draws: 1 |
| **DEMOLISHOR vs LAVA** | 7 | DEMOLISHOR | 57.1% | DEMOLISHOR: 4W | LAVA: 1W | Draws: 2 |
| **AMBASSADOR vs PROPHET** | 7 | AMBASSADOR | 57.1% | AMBASSADOR: 4W | PROPHET: 2W | Draws: 1 |
| **ALIBI vs AMBASSADOR** | 8 | AMBASSADOR | 50.0% | ALIBI: 3W | AMBASSADOR: 4W | Draws: 1 |

## Top 50 Upcoming Matches (Max Profit Strategy)

> [!NOTE]
> The model uses an optimized max-profit strategy: All predicted winners are played as **Draw No Bet**, with bet sizing tiered by confidence. It also selectively bets **OVER 2.5** only in aggressive, high-scoring matchups.

### 1. LAVA (Aggressive) vs DEMOLISHOR (Aggressive) [Aug 13, 03:38 AM AEST]
- **Analysis**: Total Expected Goals: 3.92 (1.93 to 1.99).
- **Prediction**: *SKIP (Not a Value Edge)*
- **Totals**: **OVER 2.5 Goals** *(Aggressive Matchup)*

### 2. DART (Defensive) vs SMHAMILA (Defensive) [Aug 13, 03:42 AM AEST]
- **Analysis**: Total Expected Goals: 2.58 (1.40 to 1.18).
- **Prediction**: *SKIP (Not a Value Edge)*
- **Totals**: **UNDER 2.5 Goals**

### 3. CHAOS (Defensive) vs CRUSADER (Defensive) [Aug 13, 03:46 AM AEST]
- **Analysis**: Total Expected Goals: 2.99 (1.89 to 1.11).
- **Prediction**: **CHAOS wins (Draw No Bet (Value Edge))** [Uncertainty: 0/100]
- **Totals**: **UNDER 2.5 Goals**

### 4. AMBASSADOR (Defensive) vs PROPHET (Aggressive) [Aug 13, 03:50 AM AEST]
- **Analysis**: Total Expected Goals: 3.70 (2.27 to 1.43).
- **Prediction**: **AMBASSADOR wins (Draw No Bet (Value Edge))** [Uncertainty: 10/100]
- **Totals**: *SKIP (Neutral XG)*

### 5. FORCE (Unknown) vs DOMINATOR (Unknown) [Aug 13, 03:53 AM AEST]
- **Analysis**: Insufficient data today to calculate expected goals.
- **Prediction**: *SKIP (Building Stats - Needs 5+ matches)*
- **Totals**: *SKIP*

### 6. HOLLYWOOD (Unknown) vs ENT (Unknown) [Aug 13, 03:57 AM AEST]
- **Analysis**: Insufficient data today to calculate expected goals.
- **Prediction**: *SKIP (Building Stats - Needs 5+ matches)*
- **Totals**: *SKIP*


## 💡 AI Parlay Recommendations

### ⚽ Over 2.5 Goals Parlay
*No highly confident Over 2.5 matches (Aggressive vs Aggressive > 4.00 XG) found in this rotation.*

### 🏆 Winner Parlay (2 Legs)
> **Model Logic:** Strictly favorites playing on a "Draw No Bet" line to protect against ties, with Uncertainty Score <= 10, and no overlapping players.

1. **CHAOS** to beat CRUSADER -> **Play: Draw No Bet** *[Uncertainty: 0/100]*
2. **AMBASSADOR** to beat PROPHET -> **Play: Draw No Bet** *[Uncertainty: 10/100]*

## Backtest Results

```text
--- BACKTEST: TODAY'S RESULTS (Max Profit Strategy) ---
Total Matches Played Today: 175
Decisive Matches Evaluated: 109

-- Draw No Bet (Tiered Sizing) --
Correct: 44 | Incorrect: 26 | Pushed: 39 | Accuracy: 62.86% (Excl. Pushes)
Wagered: $1615 | Returned: $1599 | Profit: $-16.00

-- Over 2.5 Goals (Selective) --
Correct: 28 | Incorrect: 21 | Accuracy: 57.14%
Wagered: $490 | Returned: $439.5 | Profit: $-50.50

-- Overall Totals --
Total Wagered: $2105
Total Returned: $2038.5
Profit/Loss: $-66.50

```
