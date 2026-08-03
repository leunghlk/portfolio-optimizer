## Portfolio Optimization Dashboard

CFA Level I-III Portfolio Optimization Dashboard built with vanilla JavaScript.

### Features
- **Mean-Variance Optimization** (Markowitz) — 4 optimization methods
- **Efficient Frontier** chart with CAL, tangency & min-variance points
- **Black-Litterman Model** — combine market equilibrium with investor views
- **Risk Budgeting** — MCTR / CCTR analysis
- **Goals-Based Investing** — required return calculator
- **Interactive allocation sliders** — drag to see real-time impact
- **Detailed returns table** — yield, income, FV, VaR, Sharpe, diversification ratio
- **Multi-currency support** — HKD, USD, CNY, EUR, GBP, SGD, JPY
- **Export** configuration as JSON

### CFA Theory Coverage
| Level | Theory |
|-------|--------|
| I | Portfolio return, variance, covariance, correlation |
| I | Sharpe Ratio, CAPM |
| II | Multi-factor risk decomposition |
| III | Mean-Variance Optimization, Efficient Frontier |
| III | Black-Litterman Model |
| III | Risk Budgeting (MCTR / CCTR) |
| III | Goals-Based Investing |
| III | Investor Utility Function |
| III | Rebalancing Corridors |

### Usage
Open `index.html` in any modern browser, or serve locally:
```bash
python3 -m http.server 8765
# Visit http://localhost:8765
```

No dependencies. No build step. Pure HTML/CSS/JS.
