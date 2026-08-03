/**
 * Portfolio Optimization Engine
 * Implements CFA Level I-III portfolio management theories:
 *   - Level I:  Portfolio expected return, variance, std dev, covariance/correlation
 *   - Level II: CAPM, factor models, multi-factor risk
 *   - Level III: Mean-Variance Optimization, Efficient Frontier, Black-Litterman,
 *                Risk Budgeting (MCTR/CCTR), Goals-Based Investing, Utility theory
 *
 * Author: Hermes Agent for Kathy Leung, CFA
 */

// ─────────────────────────────────────────────
//  MATRIX OPERATIONS (pure JS, no dependencies)
// ─────────────────────────────────────────────

const Mat = {
  /** Multiply two matrices  A(m×n) × B(n×p) → C(m×p) */
  mul(A, B) {
    const m = A.length, n = A[0].length, p = B[0].length;
    const C = Array.from({length: m}, () => new Array(p).fill(0));
    for (let i = 0; i < m; i++)
      for (let k = 0; k < n; k++) {
        const aik = A[i][k];
        for (let j = 0; j < p; j++) C[i][j] += aik * B[k][j];
      }
    return C;
  },

  /** Multiply matrix A by column vector v */
  vec(A, v) {
    return A.map(row => row.reduce((s, aij, j) => s + aij * v[j], 0));
  },

  /** Transpose */
  T(A) {
    return A[0].map((_, j) => A.map(row => row[j]));
  },

  /** Inverse via Gauss-Jordan elimination with partial pivoting */
  inv(A) {
    const n = A.length;
    // Augment [A | I]
    const M = A.map((row, i) => [...row, ...Array.from({length: n}, (_, j) => i === j ? 1 : 0)]);
    for (let col = 0; col < n; col++) {
      // Partial pivot
      let pivotRow = col;
      for (let r = col + 1; r < n; r++) {
        if (Math.abs(M[r][col]) > Math.abs(M[pivotRow][col])) pivotRow = r;
      }
      [M[col], M[pivotRow]] = [M[pivotRow], M[col]];
      if (Math.abs(M[col][col]) < 1e-14) throw new Error('Matrix is singular (check correlation matrix)');
      // Eliminate
      const pivot = M[col][col];
      for (let j = 0; j < 2 * n; j++) M[col][j] /= pivot;
      for (let r = 0; r < n; r++) {
        if (r === col) continue;
        const factor = M[r][col];
        for (let j = 0; j < 2 * n; j++) M[r][j] -= factor * M[col][j];
      }
    }
    return M.map(row => row.slice(n));
  },

  /** Dot product of two vectors */
  dot(a, b) { return a.reduce((s, ai, i) => s + ai * b[i], 0); },
};

// ─────────────────────────────────────────────
//  COVARIANCE MATRIX
// ─────────────────────────────────────────────

/**
 * Build covariance matrix from std deviations and correlation matrix.
 * Cov(i,j) = ρ(i,j) × σ_i × σ_j
 */
function buildCovMatrix(stdDevs, corr) {
  const n = stdDevs.length;
  const cov = Array.from({length: n}, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++)
      cov[i][j] = corr[i][j] * stdDevs[i] * stdDevs[j];
  return cov;
}

// ─────────────────────────────────────────────
//  PORTFOLIO METRICS  (CFA Level I)
// ─────────────────────────────────────────────

function portfolioReturn(w, mu) { return Mat.dot(w, mu); }

function portfolioVariance(w, cov) {
  return Mat.dot(w, Mat.vec(cov, w));
}

function portfolioStdDev(w, cov) { return Math.sqrt(portfolioVariance(w, cov)); }

function sharpeRatio(w, mu, cov, rf) {
  const sd = portfolioStdDev(w, cov);
  if (sd < 1e-10) return 0;
  return (portfolioReturn(w, mu) - rf) / sd;
}

/**
 * Investor utility (CFA Level III):
 *   U = E(Rp) − 0.005 × λ × σ²_p
 * λ ranges 1 (risk-seeking) to ~10 (very risk-averse). Typ: 2-4 moderate.
 */
function utility(w, mu, cov, lambda) {
  const rp = portfolioReturn(w, mu);
  const varp = portfolioVariance(w, cov);
  return rp - 0.005 * lambda * varp;
}

// ─────────────────────────────────────────────
//  RISK BUDGETING  (CFA Level III)
// ─────────────────────────────────────────────

/**
 * Marginal Contribution to Total Risk:
 *   MCTR_i = (Σw)_i / σ_p
 * Measures how much portfolio risk increases per unit increase in weight_i.
 */
function marginalContributionToRisk(w, cov) {
  const sigmaP = portfolioStdDev(w, cov);
  if (sigmaP < 1e-10) return w.map(() => 0);
  return Mat.vec(cov, w).map(x => x / sigmaP);
}

/**
 * Component Contribution to Risk:
 *   CCTR_i = w_i × MCTR_i
 * These sum to total portfolio std dev.  Σ CCTR_i = σ_p
 */
function componentContributionToRisk(w, cov) {
  const mctr = marginalContributionToRisk(w, cov);
  return w.map((wi, i) => wi * mctr[i]);
}

// ─────────────────────────────────────────────
//  MEAN-VARIANCE OPTIMIZATION  (CFA Level III)
// ─────────────────────────────────────────────

/**
 * Analytical unconstrained solutions (no box constraints).
 * These are exact and fast — used when no min/max bounds are set.
 */

/** Global Minimum Variance Portfolio:  w = Σ⁻¹1 / (1'Σ⁻¹1) */
function minVarianceUnconstrained(cov) {
  const n = cov.length;
  const inv = Mat.inv(cov);
  const ones = new Array(n).fill(1);
  const raw = Mat.vec(inv, ones);
  const sum = raw.reduce((a, b) => a + b, 0);
  return raw.map(x => x / sum);
}

/** Tangency / Max Sharpe Portfolio:  w = Σ⁻¹(μ−rf·1) / [1'Σ⁻¹(μ−rf·1)] */
function maxSharpeUnconstrained(cov, mu, rf) {
  const n = cov.length;
  const inv = Mat.inv(cov);
  const excess = mu.map(m => m - rf);
  const raw = Mat.vec(inv, excess);
  const sum = raw.reduce((a, b) => a + b, 0);
  if (Math.abs(sum) < 1e-14) return minVarianceUnconstrained(cov);
  return raw.map(x => x / sum);
}

/**
 * Minimum-variance portfolio for a target return (two-fund separation):
 *   Uses Lagrangian:  w = λ₁Σ⁻¹1 + λ₂Σ⁻¹μ
 *   where λ₁, λ₂ solve the 2×2 system from constraints w'1=1, w'μ=target.
 */
function targetReturnUnconstrained(cov, mu, target) {
  const n = cov.length;
  const inv = Mat.inv(cov);
  const ones = new Array(n).fill(1);
  const invOne = Mat.vec(inv, ones);
  const invMu = Mat.vec(inv, mu);
  // Scalars
  const A = Mat.dot(ones, invOne);      // 1'Σ⁻¹1
  const B = Mat.dot(ones, invMu);        // 1'Σ⁻¹μ  (= μ'Σ⁻¹1)
  const C = Mat.dot(mu, invMu);          // μ'Σ⁻¹μ
  const D = A * C - B * B;
  if (Math.abs(D) < 1e-14) return minVarianceUnconstrained(cov);
  const lam1 = (C - B * target) / D;
  const lam2 = (A * target - B) / D;
  return invOne.map((v, i) => lam1 * v + lam2 * invMu[i]);
}

// ─────────────────────────────────────────────
//  CONSTRAINED OPTIMIZATION
//  (Monte Carlo + local refinement for box constraints)
// ─────────────────────────────────────────────

/**
 * Generate a random weight vector within [minW, maxW] bounds summing to 1.
 * Uses the Dirichlet-like approach with clipping.
 */
function randomFeasibleWeights(minW, maxW, n) {
  // Identify fixed assets (minW === maxW)
  const fixedIdx = [], freeIdx = [];
  let sumFixed = 0;
  for (let i = 0; i < n; i++) {
    if (Math.abs(maxW[i] - minW[i]) < 1e-10) {
      fixedIdx.push(i);
      sumFixed += minW[i];
    } else {
      freeIdx.push(i);
    }
  }
  const budget = Math.max(0, 1 - sumFixed);
  const nFree = freeIdx.length;

  if (nFree === 0) {
    return minW.slice();
  }

  for (let attempt = 0; attempt < 100; attempt++) {
    // Generate random weights only for FREE assets
    const raw = Array.from({length: nFree}, () => Math.random() + 0.01);
    const sum = raw.reduce((a, b) => a + b, 0);
    let wFree = raw.map(r => (r / sum) * budget);

    // Build full weight vector
    const w = new Array(n).fill(0);
    for (const i of fixedIdx) w[i] = minW[i];
    freeIdx.forEach((idx, k) => { w[idx] = wFree[k]; });

    // Clip free assets to bounds, renormalize among free only
    for (let iter = 0; iter < 20; iter++) {
      let freeSum = 0;
      for (const idx of freeIdx) {
        w[idx] = Math.max(minW[idx], Math.min(maxW[idx], w[idx]));
        freeSum += w[idx];
      }
      if (freeSum > 0 && Math.abs(freeSum - budget) > 0.001) {
        for (const idx of freeIdx) w[idx] = w[idx] / freeSum * budget;
      } else break;
    }
    // Final clip
    for (const idx of freeIdx) w[idx] = Math.max(minW[idx], Math.min(maxW[idx], w[idx]));
    return w;
  }
  // Fallback
  const w = new Array(n).fill(0);
  const each = budget / nFree;
  for (const i of fixedIdx) w[i] = minW[i];
  for (const idx of freeIdx) w[idx] = Math.max(minW[idx], Math.min(maxW[idx], each));
  return w;
}

/**
 * Project weights onto feasible set (simplex with bounds).
 * Iteratively clips and renormalizes.
 */
function projectFeasible(w, minW, maxW) {
  const n = w.length;
  // Identify fixed assets
  const fixedIdx = [], freeIdx = [];
  let sumFixed = 0;
  for (let i = 0; i < n; i++) {
    if (Math.abs(maxW[i] - minW[i]) < 1e-10) { fixedIdx.push(i); sumFixed += minW[i]; }
    else freeIdx.push(i);
  }
  const budget = Math.max(0, 1 - sumFixed);

  let result = [...w];
  // Set fixed assets
  for (const i of fixedIdx) result[i] = minW[i];

  if (freeIdx.length === 0) return result;

  for (let iter = 0; iter < 50; iter++) {
    // Clip free assets
    for (const idx of freeIdx) result[idx] = Math.max(minW[idx], Math.min(maxW[idx], result[idx]));
    // Renormalize free assets to budget
    let freeSum = 0;
    for (const idx of freeIdx) freeSum += result[idx];
    if (freeSum > 0 && Math.abs(freeSum - budget) > 0.0001) {
      for (const idx of freeIdx) result[idx] = result[idx] / freeSum * budget;
    }
    // Check feasibility
    if (freeIdx.every(idx => result[idx] >= minW[idx] - 0.0001 && result[idx] <= maxW[idx] + 0.0001)) break;
  }
  for (const idx of freeIdx) result[idx] = Math.max(minW[idx], Math.min(maxW[idx], result[idx]));
  return result;
}

/**
 * Score function for each objective type.
 */
function scoreObjective(w, cov, mu, rf, objective, target, lambda) {
  const ret = portfolioReturn(w, mu);
  const sd = portfolioStdDev(w, cov);
  switch (objective) {
    case 'maxSharpe':   return sd > 1e-10 ? (ret - rf) / sd : -Infinity;
    case 'minVar':      return -sd;
    case 'targetReturn': return -sd - 50 * Math.abs(ret - target);
    case 'maxUtility':  return utility(w, mu, cov, lambda);
    default:            return (ret - rf) / (sd + 1e-10);
  }
}

/**
 * Constrained optimization via massive Monte Carlo + coordinate refinement.
 *
 * Strategy:
 *   1. Start from analytical solution (clipped to bounds if no real constraints)
 *   2. Generate massive MC samples for global exploration
 *   3. Coordinate descent refinement around best point
 *
 * @returns Optimal weights array
 */
function optimizeConstrained(cov, mu, rf, minW, maxW, objective, target, lambda) {
  const n = mu.length;
  const isDefaultBounds = minW.every(m => m === 0) && maxW.every(m => m >= 0.999);

  // Candidates pool — start with analytical solutions
  const candidates = [];

  // Analytical solutions (may violate long-only constraint)
  try {
    if (objective === 'minVar' || objective === 'maxUtility') {
      candidates.push(minVarianceUnconstrained(cov));
    }
    if (objective === 'maxSharpe' || objective === 'maxUtility') {
      candidates.push(maxSharpeUnconstrained(cov, mu, rf));
    }
    if (objective === 'targetReturn') {
      candidates.push(targetReturnUnconstrained(cov, mu, target));
    }
    // Always include min-var and max-Sharpe as starting points
    candidates.push(minVarianceUnconstrained(cov));
    candidates.push(maxSharpeUnconstrained(cov, mu, rf));
  } catch (e) { /* singular matrix, skip */ }

  // Project analytical candidates to feasible set
  const feasibleCandidates = candidates.map(w => projectFeasible(w, minW, maxW));

  // Score them
  let bestW = null;
  let bestScore = -Infinity;
  for (const w of feasibleCandidates) {
    const s = scoreObjective(w, cov, mu, rf, objective, target, lambda);
    if (s > bestScore) { bestScore = s; bestW = [...w]; }
  }

  // Phase 1: Massive Monte Carlo exploration
  const N_SAMPLES = 50000;
  for (let s = 0; s < N_SAMPLES; s++) {
    const w = randomFeasibleWeights(minW, maxW, n);
    const score = scoreObjective(w, cov, mu, rf, objective, target, lambda);
    if (score > bestScore) { bestScore = score; bestW = [...w]; }
  }

  // Phase 2: Coordinate descent refinement
  // Perturb each weight up/down while keeping sum=1, accept if score improves
  const stepSizes = [0.05, 0.02, 0.01, 0.005];
  for (const step of stepSizes) {
    let improved = true;
    let iterations = 0;
    while (improved && iterations < 200) {
      improved = false;
      iterations++;
      // Skip fixed assets (minW === maxW)
      const isFixed = idx => Math.abs(maxW[idx] - minW[idx]) < 1e-10;
      for (let i = 0; i < n; i++) {
        if (isFixed(i)) continue;
        for (let j = 0; j < n; j++) {
          if (i === j || isFixed(j)) continue;
          // Move weight from j to i
          const wTry = [...bestW];
          const delta = Math.min(step, bestW[j] - minW[j], maxW[i] - bestW[i]);
          if (delta <= 0) continue;
          wTry[i] += delta;
          wTry[j] -= delta;
          const score = scoreObjective(wTry, cov, mu, rf, objective, target, lambda);
          if (score > bestScore + 1e-10) {
            bestScore = score;
            bestW = wTry;
            improved = true;
          }
        }
      }
    }
  }

  // Final normalization
  const sum = bestW.reduce((a, b) => a + b, 0);
  if (sum > 0) bestW = bestW.map(w => w / sum);
  return bestW.map((w, i) => Math.max(minW[i], Math.min(maxW[i], w)));
}

/**
 * Generate efficient frontier points using Monte Carlo sampling.
 * Returns array of {ret, sd, sharpe} sorted by return.
 */
function efficientFrontier(cov, mu, rf, minW, maxW, numPoints = 200) {
  const n = mu.length;
  const N_SAMPLES = 30000;
  const points = [];
  for (let s = 0; s < N_SAMPLES; s++) {
    const w = randomFeasibleWeights(minW, maxW, n);
    const ret = portfolioReturn(w, mu);
    const sd = portfolioStdDev(w, cov);
    points.push({ ret, sd, sharpe: sd > 1e-10 ? (ret - rf) / sd : 0 });
  }
  // Sort by return
  points.sort((a, b) => a.ret - b.ret);

  // Extract efficient frontier: for each return bucket, take min sd
  const minRet = points[0].ret;
  const maxRet = points[points.length - 1].ret;
  const step = (maxRet - minRet) / numPoints;
  const frontier = [];
  for (let i = 0; i <= numPoints; i++) {
    const target = minRet + step * i;
    const bucket = points.filter(p => Math.abs(p.ret - target) < step);
    if (bucket.length === 0) continue;
    const minSd = Math.min(...bucket.map(p => p.sd));
    frontier.push({ ret: target, sd: minSd });
  }
  // Deduplicate and ensure monotonic
  return frontier.filter((p, i, arr) => i === 0 || p.sd <= Math.max(...arr.slice(0, i).map(x => x.sd)) + 0.001);
}

// ─────────────────────────────────────────────
//  BLACK-LITTERMAN MODEL  (CFA Level III)
// ─────────────────────────────────────────────

/**
 * Black-Litterman: combine market equilibrium returns with investor views.
 *
 * Step 1: Implied equilibrium returns  Π = δ·Σ·w_mkt
 *   where δ = (E(R_mkt) − Rf) / σ²_mkt  (risk aversion coefficient)
 *
 * Step 2: Posterior returns (Bayesian combination):
 *   E[R] = [(τΣ)⁻¹ + P'Ω⁻¹P]⁻¹ · [(τΣ)⁻¹·Π + P'Ω⁻¹·Q]
 *
 * @param cov      Covariance matrix (annualized)
 * @param wMkt     Market cap weights
 * @param rf       Risk-free rate
 * @param retMkt   Expected market return
 * @param views    Array of {assets: [indices], weights: [w...], return: Q, confidence: 0-1}
 * @param tau      Scalar (~0.025 to 0.05)
 * @returns        {impliedReturns, blendedReturns, delta}
 */
function blackLitterman(cov, wMkt, rf, retMkt, views, tau = 0.025) {
  const n = cov.length;

  // Step 1: Risk aversion coefficient δ = (E(Rm) − Rf) / σ²m
  const varMkt = portfolioVariance(wMkt, cov);
  const delta = (retMkt - rf) / varMkt;

  // Implied equilibrium returns Π = δΣw
  const Pi = Mat.vec(cov, wMkt).map(x => delta * x);

  if (!views || views.length === 0) {
    return { impliedReturns: Pi, blendedReturns: Pi, delta };
  }

  // Step 2: Build P (views matrix) and Q (views returns vector)
  const k = views.length;
  const P = Array.from({length: k}, () => new Array(n).fill(0));
  const Q = new Array(k);
  const Omega = Array.from({length: k}, () => new Array(k).fill(0));

  views.forEach((view, vi) => {
    view.assets.forEach((ai, aj) => { P[vi][ai] = view.weights[aj]; });
    Q[vi] = view.return;
    // Ω = diag(τ · p_k · Σ · p_k')
    const pSigmaP = Mat.dot(P[vi], Mat.vec(cov, P[vi]));
    Omega[vi][vi] = tau * pSigmaP * view.confidence; // scaled by confidence
  });

  // Step 3: E[R] = [(τΣ)⁻¹ + P'Ω⁻¹P]⁻¹ [(τΣ)⁻¹Π + P'Ω⁻¹Q]
  const tauSigma = cov.map(row => row.map(x => tau * x));
  const tauSigmaInv = Mat.inv(tauSigma);
  const omegaInv = Mat.inv(Omega);
  const PT = Mat.T(P);

  // A = (τΣ)⁻¹ + P'Ω⁻¹P
  const POmegaInvP = Mat.mul(Mat.mul(PT, omegaInv), P);
  const A = tauSigmaInv.map((row, i) => row.map((v, j) => v + POmegaInvP[i][j]));

  // b = (τΣ)⁻¹Π + P'Ω⁻¹Q
  const term1 = Mat.vec(tauSigmaInv, Pi);
  const term2 = Mat.vec(Mat.mul(PT, omegaInv), Q);
  const b = term1.map((v, i) => v + term2[i]);

  const ER = Mat.vec(Mat.inv(A), b);

  return { impliedReturns: Pi, blendedReturns: ER, delta };
}

// ─────────────────────────────────────────────
//  GOALS-BASED INVESTING  (CFA Level III)
// ─────────────────────────────────────────────

/**
 * Goals-based: Given a goal (target amount, current savings, monthly contribution,
 * time horizon, required probability of success), compute the required annualized
 * return and suggest an allocation.
 *
 * Uses future value of annuity formula:
 *   FV = PV(1+r)^n + PMT × [(1+r)^n − 1] / r
 *
 * Solve for r that makes FV = goalAmount.
 *
 * @returns { requiredReturn, achievable, suggestedAllocation }
 */
function goalsBasedAnalysis(pv, pmt, goalAmount, years, mu, cov, minW, maxW) {
  // Binary search for required return
  let lo = -0.10, hi = 0.50, requiredReturn = 0;
  for (let iter = 0; iter < 200; iter++) {
    const r = (lo + hi) / 2;
    const fvFactor = Math.pow(1 + r, years);
    let fv;
    if (Math.abs(r) < 1e-10) {
      fv = pv + pmt * years * 12;
    } else {
      const monthlyR = r / 12;
      const nMonths = years * 12;
      fv = pv * fvFactor + pmt * (Math.pow(1 + monthlyR, nMonths) - 1) / monthlyR * (1 + monthlyR);
    }
    if (fv < goalAmount) lo = r; else hi = r;
    requiredReturn = (lo + hi) / 2;
  }

  // Check if achievable with available assets
  const maxRet = Math.max(...mu);
  const minRet = Math.min(...mu);
  const achievable = requiredReturn <= maxRet + 0.001;

  return {
    requiredReturn,
    achievable,
    maxAvailableReturn: maxRet,
    minAvailableReturn: minRet,
  };
}

// ─────────────────────────────────────────────
//  INCOME & TOTAL RETURN CALCULATIONS
// ─────────────────────────────────────────────

/**
 * Compute detailed portfolio metrics for the results table.
 * @param w        Weights
 * @param mu       Expected returns (annual, decimal)
 * @param yields   Current yields per asset (annual, decimal) — income component
 * @param amount   Investment amount
 * @param years    Tenor
 * @param currency Currency code
 */
function portfolioDetail(w, mu, cov, yields, amount, years, rf) {
  const annualReturn = portfolioReturn(w, mu);
  const annualIncomeYield = Mat.dot(w, yields);
  const capitalGrowthReturn = annualReturn - annualIncomeYield;
  const stdDev = portfolioStdDev(w, cov);
  const sharpe = stdDev > 1e-10 ? (annualReturn - rf) / stdDev : 0;

  // Future value
  const fv = amount * Math.pow(1 + annualReturn, years);
  const totalGain = fv - amount;
  const totalReturnPct = (fv / amount - 1);

  // Annual income in currency
  const annualIncome = amount * annualIncomeYield;
  const totalIncome = annualIncome * years;

  // Downside risk metrics (CFA Level III)
  // 95% VaR (parametric, 1-year):
  //   Worst-case loss at 95% confidence = (1.645σ_p − μ_p) × Amount
  //   i.e. "There is a 5% chance the portfolio loses at least this much in 1 year."
  //   If the expression is negative, the portfolio is very unlikely to lose money → VaR = 0
  const var95Raw = (1.645 * stdDev - annualReturn);
  const var95Amount = Math.max(0, var95Raw * amount);
  // 99% VaR: 2.326σ
  const var99Raw = (2.326 * stdDev - annualReturn);
  const var99Amount = Math.max(0, var99Raw * amount);

  // Max drawdown estimate (throughout the tenor, not just 1Y)
  // Approximation: peak-to-trough decline over the investment horizon.
  // Uses the formula: MaxDD ≈ σ_p × √(T) × 2.0 (empirical factor for diversified portfolios)
  // This is a rough estimate — actual max DD depends on path (sequence of returns).
  const estMaxDD = -2.0 * stdDev * Math.sqrt(years);
  const estMaxDD1Y = -2.0 * stdDev;

  // Diversification ratio: weighted avg σ / portfolio σ
  const weightedAvgSigma = Mat.dot(w, cov.diagonal ? cov.diagonal() : cov.map((row, i) => row[i]).map(Math.sqrt));
  const diversificationRatio = stdDev > 1e-10 ? weightedAvgSigma / stdDev : 1;

  return {
    annualReturn,          // E(Rp) expected annual return
    annualIncomeYield,     // portfolio yield (dividend + coupon income)
    capitalGrowthReturn,   // price appreciation component
    stdDev,                // portfolio std dev
    sharpe,                // Sharpe ratio
    fv,                    // future value at horizon
    totalGain,             // absolute gain
    totalReturnPct,        // cumulative return over horizon
    annualIncome,          // yearly income in currency
    totalIncome,           // total income over horizon
    var95Amount,           // 1-year 95% VaR
    var99Amount,           // 1-year 99% VaR
    estMaxDD,              // estimated max drawdown over full tenor
    estMaxDD1Y,            // estimated max drawdown (1-year)
    diversificationRatio,  // diversification benefit
  };
}

// ─────────────────────────────────────────────
//  REBALANCING CORRIDOR  (CFA Level III)
// ─────────────────────────────────────────────

/**
 * Suggest rebalancing corridor for each asset class.
 * Factors: transaction cost (wider), volatility (narrower), correlation (wider).
 * Simplified heuristic based on CFA curriculum.
 */
function rebalancingCorridors(w, cov, baseBand = 0.10) {
  const sd = portfolioStdDev(w, cov);
  const mctr = marginalContributionToRisk(w, cov);
  return w.map((wi, i) => {
    const assetVol = Math.sqrt(cov[i][i]);
    // Higher vol → tighter corridor; higher weight → wider absolute corridor
    const volAdj = Math.max(0.5, Math.min(2.0, sd / (assetVol + 1e-10)));
    return {
      target: wi,
      lower: Math.max(0, wi - baseBand * volAdj * wi),
      upper: Math.min(1, wi + baseBand * volAdj * wi),
    };
  });
}

// ─────────────────────────────────────────────
//  EXPORT FOR USE
// ─────────────────────────────────────────────

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    Mat, buildCovMatrix,
    portfolioReturn, portfolioVariance, portfolioStdDev, sharpeRatio, utility,
    marginalContributionToRisk, componentContributionToRisk,
    minVarianceUnconstrained, maxSharpeUnconstrained, targetReturnUnconstrained,
    optimizeConstrained, efficientFrontier,
    blackLitterman, goalsBasedAnalysis, portfolioDetail, rebalancingCorridors,
  };
}
