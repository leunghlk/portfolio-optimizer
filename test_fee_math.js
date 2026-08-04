const O = require('/Users/leungkathy/portfolio-optimizer/optimizer.js');
const { buildCovMatrix, portfolioDetail, netExpectedReturns, netYields, optimizeConstrained, Mat } = O;

let pass = 0, fail = 0;
function chk(name, got, want, tol=1e-9) {
  const ok = Math.abs(got - want) <= tol;
  console.log(`${ok?'PASS':'FAIL'}  ${name}   got=${typeof got==='number'?got.toPrecision(12):got} want=${typeof want==='number'?want.toPrecision(12):want}`);
  ok ? pass++ : fail++;
}

const assets = [
  { name:'Equities', er:8.5, sd:15,  yield:2.0, fee:3.0 },
  { name:'Bonds',    er:4.5, sd:5,   yield:4.2, fee:1.0 },
  { name:'Gold',     er:5.0, sd:16,  yield:0,   fee:0.5 },
  { name:'Cash',     er:4.0, sd:0.5, yield:4.0, fee:0.0 },
];
const corr = [[1,.1,-.1,0],[.1,1,.2,.1],[-.1,.2,1,-.05],[0,.1,-.05,1]];
const mu   = assets.map(a=>a.er/100);
const sig  = assets.map(a=>a.sd/100);
const yld  = assets.map(a=>a.yield/100);
const fees = assets.map(a=>a.fee/100);
const cov  = buildCovMatrix(sig, corr);
const amount = 10000000, T = 5, rf = 0.04;
const w = [0.4, 0.3, 0.1, 0.2];
const zero = [0,0,0,0];

console.log('══ A. ZERO-FEE REGRESSION (must equal pre-change behaviour) ══');
const d0 = portfolioDetail(w, mu, cov, yld, amount, T, rf, zero);
const dU = portfolioDetail(w, mu, cov, yld, amount, T, rf);   // arg omitted
const grossRet = Mat.dot(w, mu);
chk('annualReturn == Σwμ', d0.annualReturn, grossRet, 1e-15);
chk('feeDrag == 0 exactly', d0.feeDrag, 0, 0);
chk('feeAmount == 0', d0.feeAmount, 0, 0);
chk('netAmount == amount', d0.netAmount, amount, 0);
chk('income == Σwy·amt', d0.annualIncome, Mat.dot(w,yld)*amount, 1e-9);
chk('VaR95 == old formula', d0.var95Amount, Math.max(0,(1.645*d0.stdDev-grossRet)*amount), 1e-9);
chk('VaR99 == old formula', d0.var99Amount, Math.max(0,(2.326*d0.stdDev-grossRet)*amount), 1e-9);
chk('omitted arg identical', dU.fv, d0.fv, 0);
chk('sharpe == (r−rf)/σ', d0.sharpe, (grossRet-rf)/d0.stdDev, 1e-15);

console.log('\n══ B. FV = Σ per-sleeve  (table rows MUST sum to total row) ══');
function tableRowsFV(w, fees) {   // replicate EXACTLY what renderMetricsTable prints
  let s = 0;
  assets.forEach((a,i)=>{ const amt=amount*w[i], net=amt-amt*fees[i]; s += net*Math.pow(1+a.er/100,T); });
  return s;
}
function tableRowsInc(w, fees) {
  let s = 0;
  assets.forEach((a,i)=>{ const amt=amount*w[i], net=amt-amt*fees[i]; s += net*(a.yield/100); });
  return s;
}
const d = portfolioDetail(w, mu, cov, yld, amount, T, rf, fees);
chk('WITH fee: Σ row FV == total FV', tableRowsFV(w,fees), d.fv, 1e-6);
chk('WITH fee: Σ row income == total income', tableRowsInc(w,fees), d.annualIncome, 1e-6);
chk('NO fee: Σ row FV == total FV', tableRowsFV(w,zero), d0.fv, 1e-6);
chk('NO fee: Σ row income == total income', tableRowsInc(w,zero), d0.annualIncome, 1e-6);

console.log('\n══ C. Fee arithmetic hand-check ══');
// weighted fee = .4(3%)+.3(1%)+.1(.5%)+.2(0) = 1.2+0.3+0.05 = 1.55%
chk('feeRate 1.55%', d.feeRate, 0.0155, 1e-15);
chk('fee$ = 155,000', d.feeAmount, 155000, 1e-6);
chk('net invested 9,845,000', d.netAmount, 9845000, 1e-6);
console.log(`      gross E(R)=${(d.grossAnnualReturn*100).toFixed(4)}%  net E(R)=${(d.annualReturn*100).toFixed(4)}%  drag=${(d.feeDrag*100).toFixed(4)}%`);
console.log(`      FV=${d.fv.toFixed(0)}   FV(no fee)=${d0.fv.toFixed(0)}   diff=${(d0.fv-d.fv).toFixed(0)}`);
// FV difference must equal the fee compounded at each sleeve's own rate
let feeCompounded = 0;
assets.forEach((a,i)=>{ feeCompounded += amount*w[i]*fees[i]*Math.pow(1+a.er/100,T); });
chk('FV give-up == fee compounded per sleeve', d0.fv - d.fv, feeCompounded, 1e-6);

console.log('\n══ D. Net-return identity: (1+μnet)^T == (1−f)(1+μ)^T ══');
const muNet = netExpectedReturns(mu, fees, T);
mu.forEach((m,i)=> chk(`  asset ${i}`, Math.pow(1+muNet[i],T), (1-fees[i])*Math.pow(1+m,T), 1e-12));
chk('portfolio net E(R) == Σw·μnet', d.annualReturn, Mat.dot(w,muNet), 1e-15);

console.log('\n══ E. Tenor sensitivity (one-off fee amortizes away) ══');
[1,3,5,10,20].forEach(yr=>{
  const dd = portfolioDetail(w, mu, cov, yld, amount, yr, rf, fees);
  console.log(`      T=${String(yr).padStart(2)}  drag=${(dd.feeDrag*100).toFixed(4)}%/yr  net=${(dd.annualReturn*100).toFixed(4)}%  FV=${dd.fv.toFixed(0)}`);
});
const dT1=portfolioDetail(w,mu,cov,yld,amount,1,rf,fees), dT20=portfolioDetail(w,mu,cov,yld,amount,20,rf,fees);
chk('drag monotonically ↓ with tenor', dT1.feeDrag > dT20.feeDrag ? 1:0, 1, 0);
chk('T=1 drag == Σwᵢfᵢ(1+μᵢ)', dT1.feeDrag, w.reduce((s,wi,i)=>s+wi*fees[i]*(1+mu[i]),0), 1e-15);

console.log('\n══ F. VaR / risk on net invested capital ══');
chk('VaR95 uses gross μ & net capital', d.var95Amount, Math.max(0,(1.645*d.stdDev-d.grossAnnualReturn)*d.netAmount), 1e-9);
chk('VaR95 < no-fee VaR95', d.var95Amount < d0.var95Amount ?1:0, 1, 0);
chk('σ unchanged by fee', d.stdDev, d0.stdDev, 1e-15);
chk('divRatio unchanged by fee', d.diversificationRatio, d0.diversificationRatio, 1e-15);
chk('MaxDD unchanged by fee', d.estMaxDD, d0.estMaxDD, 1e-15);

console.log('\n══ G. Edge cases (no NaN anywhere) ══');
const cases = {
  '100% fee all':      [1,1,1,1],
  'negative fee':      [-0.5,0,0,0],
  'NaN/undefined':     [NaN,undefined,null,0.02],
  'fee > 1':           [3,0,0,0],
  'empty array':       [],
};
for (const [nm,ff] of Object.entries(cases)) {
  const x = portfolioDetail(w, mu, cov, yld, amount, T, rf, ff);
  const vals=[x.annualReturn,x.fv,x.annualIncome,x.sharpe,x.var95Amount,x.feeAmount,x.netAmount,x.feeDrag];
  chk(`  ${nm}: all finite`, vals.every(isFinite)?1:0, 1, 0);
}
const dFull = portfolioDetail(w, mu, cov, yld, amount, T, rf, [1,1,1,1]);
chk('100% fee: FV=0', dFull.fv, 0, 1e-9);
chk('100% fee: net=0', dFull.netAmount, 0, 1e-9);
chk('100% fee: ret=−100%', dFull.annualReturn, -1, 1e-12);
const dZeroAmt = portfolioDetail(w, mu, cov, yld, 0, T, rf, fees);
chk('amount=0: finite', [dZeroAmt.fv,dZeroAmt.annualReturn,dZeroAmt.feeAmount].every(isFinite)?1:0, 1, 0);
const dCD = portfolioDetail([0,0,0,1], [0.035,0,0,0.035], buildCovMatrix([0,0,0,0],corr), [0.035,0,0,0.035], amount, T, rf, [0.01,0,0,0.01]);
chk('CD σ=0 with fee: finite', [dCD.fv,dCD.annualReturn,dCD.sharpe,dCD.var95Amount].every(isFinite)?1:0, 1, 0);

console.log('\n══ H. Optimizer fee-awareness ══');
const minW=[0,0,0,0], maxW=[.6,.6,.6,.6];
const wG = optimizeConstrained(cov, mu, rf, minW, maxW, 'maxSharpe', null, 4);
const wN = optimizeConstrained(cov, netExpectedReturns(mu,[0.10,0,0,0],T), rf, minW, maxW, 'maxSharpe', null, 4);
console.log(`      no-fee opt : ${wG.map(x=>(x*100).toFixed(1)+'%').join('  ')}`);
console.log(`      10% load on Equities: ${wN.map(x=>(x*100).toFixed(1)+'%').join('  ')}`);
chk('high-load asset down-weighted', wN[0] < wG[0] ?1:0, 1, 0);
chk('weights sum 1 (fee case)', wN.reduce((a,b)=>a+b,0), 1, 1e-6);
chk('respects max 60%', wN.every(x=>x<=0.6001)?1:0, 1, 0);
// zero fee must reproduce the same optimum as no fee at all
const wZ = optimizeConstrained(cov, netExpectedReturns(mu,zero,T), rf, minW, maxW, 'maxSharpe', null, 4);
const shG = (Mat.dot(wG,mu)-rf)/Math.sqrt(Mat.dot(wG,Mat.vec(cov,wG)));
const shZ = (Mat.dot(wZ,mu)-rf)/Math.sqrt(Mat.dot(wZ,Mat.vec(cov,wZ)));
chk('zero-fee Sharpe == no-fee Sharpe', shZ, shG, 5e-4);

console.log(`\n────────────  ${pass} passed, ${fail} failed  ────────────`);
process.exit(fail?1:0);
