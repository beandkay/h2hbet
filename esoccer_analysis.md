# eSoccer Final Model Predictions

**League Average Goals Per Match (Per Team):** 1.38

## Player Pattern Analysis (Latest Data)

| Player | Style | Matches | Win% | Avg Scored | Avg Conceded | Form (All Matches) |
|---|---|---|---|---|---|---|
| **GHOST** | Defensive | 23 | 34.8% | 1.17 | 0.96 | W-W-W-L-D-L-L-L-W-L-W-W-D-D-D-D-D-W-W-L-D-D-D |
| **TROOPER** | Defensive | 23 | 13.0% | 0.78 | 1.35 | D-L-L-D-W-W-D-L-L-D-D-L-L-L-D-D-D-L-W-D-D-L-L |

## Most Dominant H2H Pairs (Current Rotation)

| Matchup | Matches | Dominant Player | Win Rate | Breakdown |
|---|---|---|---|---|
| **CHASER vs EDEN** | 8 | CHASER | 75.0% | CHASER: 6W | EDEN: 2W | Draws: 0 |
| **DECIMATOR vs ENT** | 8 | DECIMATOR | 62.5% | DECIMATOR: 5W | ENT: 2W | Draws: 1 |
| **CHASER vs ENT** | 8 | ENT | 62.5% | CHASER: 2W | ENT: 5W | Draws: 1 |
| **DECIMATOR vs EDEN** | 8 | DECIMATOR | 62.5% | DECIMATOR: 5W | EDEN: 1W | Draws: 2 |
| **GHOST vs TROOPER** | 7 | GHOST | 57.1% | GHOST: 4W | TROOPER: 1W | Draws: 2 |
| **AGENT vs TEMPEST** | 7 | AGENT | 57.1% | AGENT: 4W | TEMPEST: 1W | Draws: 2 |
| **EXECUTIONER vs GLORY** | 13 | EXECUTIONER | 53.8% | EXECUTIONER: 7W | GLORY: 4W | Draws: 2 |
| **DUSK vs EMPEROR** | 8 | EMPEROR | 50.0% | DUSK: 3W | EMPEROR: 4W | Draws: 1 |
| **STORM vs TROOPER** | 8 | STORM | 50.0% | STORM: 4W | TROOPER: 1W | Draws: 3 |
| **EMPEROR vs TEMPEST** | 8 | TEMPEST | 50.0% | EMPEROR: 2W | TEMPEST: 4W | Draws: 2 |

## Top 50 Upcoming Matches (Max Profit Strategy)

> [!NOTE]
> The model uses an optimized max-profit strategy: All predicted winners are played as **Draw No Bet**, with bet sizing tiered by confidence. It also selectively bets **OVER 2.5** only in aggressive, high-scoring matchups.

### 1. TROOPER (Defensive) vs GHOST (Defensive) [Aug 11, 03:50 PM AEST]
- **Analysis**: Total Expected Goals: 2.70 (1.08 to 1.62).
- **Prediction**: **GHOST wins (Draw No Bet (Value Edge))** [Uncertainty: 0/100]
- **Totals**: **UNDER 2.5 Goals**

### 2. DEMOLISHOR (Unknown) vs FRANCHISE (Unknown) [Aug 11, 03:53 PM AEST]
- **Analysis**: Insufficient data today to calculate expected goals.
- **Prediction**: *SKIP (Building Stats - Needs 5+ matches)*
- **Totals**: *SKIP*

### 3. INSTINCT (Unknown) vs RADICAL (Unknown) [Aug 11, 03:57 PM AEST]
- **Analysis**: Insufficient data today to calculate expected goals.
- **Prediction**: *SKIP (Building Stats - Needs 5+ matches)*
- **Totals**: *SKIP*


## 💡 AI Parlay Recommendations

### ⚽ Over 2.5 Goals Parlay
*No highly confident Over 2.5 matches (Aggressive vs Aggressive > 4.00 XG) found in this rotation.*

### 🏆 Winner Parlay (1 Legs)
> **Model Logic:** Strictly favorites playing on a "Draw No Bet" line to protect against ties, with Uncertainty Score <= 10, and no overlapping players.

1. **GHOST** to beat TROOPER -> **Play: Draw No Bet** *[Uncertainty: 0/100]*

## Backtest Results

```text
--- BACKTEST: TODAY'S RESULTS (Max Profit Strategy) ---
Total Matches Played Today: 183
Decisive Matches Evaluated: 98

-- Draw No Bet (Tiered Sizing) --
Correct: 32 | Incorrect: 32 | Pushed: 34 | Accuracy: 50.00% (Excl. Pushes)
Wagered: $1290 | Returned: $1135.75 | Profit: $-154.25

-- Over 2.5 Goals (Selective) --
Correct: 22 | Incorrect: 20 | Accuracy: 52.38%
Wagered: $420 | Returned: $364 | Profit: $-56.00

-- Overall Totals --
Total Wagered: $1710
Total Returned: $1499.75
Profit/Loss: $-210.25

```
