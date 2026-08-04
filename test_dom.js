/**
 * Real-DOM smoke test for portfolio-optimizer with the new one-off Fee column.
 * Loads the ACTUAL index.html + optimizer.js and drives the real UI functions.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('/tmp/domtest/node_modules/jsdom');

const DIR = '/Users/leungkathy/portfolio-optimizer';
const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');

let pass = 0, fail = 0;
const jsErrors = [];
function chk(name, cond, extra='') {
  cond ? pass++ : fail++;
  console.log(`${cond?'PASS':'FAIL'}  ${name}${extra?'  → '+extra:''}`);
}

const vc = new VirtualConsole();
vc.on('jsdomError', e => {
  const m = e && e.message ? e.message : String(e);
  // Ignore jsdom environment limitations that are NOT app bugs:
  if (/Not implemented:\s*Window's?\s*open\(\)/.test(m)) return; // new-tab preview uses window.open (browser-only)
  if (/Not implemented: navigation/.test(m)) return;
  jsErrors.push(m);
});
vc.on('error', (...a) => jsErrors.push('console.error: ' + a.join(' ')));

// Inline optimizer.js directly into the HTML so no network fetch is needed
const engineSrc = fs.readFileSync(path.join(DIR, 'optimizer.js'), 'utf8');
const htmlInlined = html.replace(
  /<script src="optimizer\.js[^"]*"><\/script>/,
  '<script>' + engineSrc + '</script>'
);
if (htmlInlined === html) { console.log('WARN: optimizer.js script tag not matched'); }

const dom = new JSDOM(htmlInlined, {
  runScripts: 'dangerously',
  virtualConsole: vc,
  url: 'http://localhost:8765/index.html',
  beforeParse(window) {
    window.HTMLCanvasElement.prototype.getContext = function () {
      const noop = () => {};
      return new Proxy({}, {
        get: (t, p) => {
          if (p === 'canvas') return { width: 780, height: 420 };
          if (p === 'measureText') return () => ({ width: 10 });
          return noop;
        },
        set: () => true,
      });
    };
    window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,STUB';
  },
});

const { window } = dom;

(async () => {
await new Promise(res => {
  if (window.document.readyState === 'complete') return res();
  window.addEventListener('load', res);
  setTimeout(res, 5000);
});
await new Promise(r => setTimeout(r, 400));

// `state` and helpers are inside an IIFE/const scope — reach them via page eval
const ev = expr => window.eval(expr);
const getState = () => ev('JSON.parse(JSON.stringify({weights:state.weights, assets:state.assets, corr:state.corr, method:state.method}))');

const doc = window.document;
const $ = sel => doc.querySelector(sel);
const $$ = sel => Array.from(doc.querySelectorAll(sel));
const txt = sel => ($(sel)?.textContent || '').trim();

console.log('══════ 1. PAGE BOOT ══════');
chk('engine loaded (buildCovMatrix)', typeof window.buildCovMatrix === 'function');
chk('new fn netExpectedReturns exported', typeof window.netExpectedReturns === 'function');
chk('new fn netYields exported', typeof window.netYields === 'function');
chk('getFees() helper defined', typeof window.getFees === 'function');
chk('no JS errors on boot', jsErrors.length === 0, jsErrors.join(' | ') || 'clean');

console.log('\n══════ 2. FEE COLUMN RENDERS ══════');
const feeTh = $('th.col-fee');
chk('Fee% header exists in asset table', !!feeTh, feeTh ? `"${feeTh.textContent}"` : 'MISSING');
const feeInputs = $$('#assetTableBody .col-fee input');
chk('one fee input per asset row (4)', feeInputs.length === 4, `found ${feeInputs.length}`);
chk('fee inputs default to 0', feeInputs.every(i => i.value === '0'), feeInputs.map(i=>i.value).join(','));
chk('fee input has min=0 max=100', feeInputs.every(i => i.min === '0' && i.max === '100'));
const headerCells = $$('.asset-table thead th').map(h => h.textContent.trim());
chk('header order Name/ER/σ/Yld/Fee/Fix/W', headerCells.join('|').includes('Fee%'), headerCells.join(' | '));

console.log('\n══════ 3. BASELINE (fee = 0) — no fee UI shown ══════');
const kpis0 = $$('.kpi-card');
chk('KPI cards rendered', kpis0.length >= 6, `${kpis0.length} cards`);
const kpiText0 = kpis0.map(c => c.textContent).join(' ');
chk('NO fee KPI card when all fees = 0', !/One-off Fee|一次性費用/.test(kpiText0));
chk('metrics table has no Fee column', !/Fee \$|費用金額/.test($('#metricsTable').textContent));
const er0 = txt('.kpi-card .kpi-value');
console.log(`      Expected Return KPI = ${er0}`);
const w0 = getState().weights.slice();
console.log(`      weights = ${w0.map(x=>(x*100).toFixed(1)+'%').join(' ')}`);
chk('weights sum to 100%', Math.abs(w0.reduce((a,b)=>a+b,0) - 1) < 1e-6);

console.log('\n══════ 4. ENTER FEES → UI UPDATES ══════');
// Equities 3%, Bonds 1%, Gold 0.5%, Cash 0%
const feeSet = [3, 1, 0.5, 0];
feeSet.forEach((f, i) => ev(`updateAsset(${i},'fee',${f})`));
const fees = ev('getFees()');
chk('getFees() returns decimals', JSON.stringify(fees) === JSON.stringify([0.03,0.01,0.005,0]), JSON.stringify(fees));

const kpis1 = $$('.kpi-card');
const kpiText1 = kpis1.map(c => c.textContent).join(' ');
chk('One-off Fee KPI card now appears', /One-off Fee/.test(kpiText1));
const feeCard = kpis1.find(c => /One-off Fee/.test(c.textContent));
console.log(`      Fee card: ${feeCard ? feeCard.textContent.replace(/\s+/g,' ').trim() : 'NONE'}`);
chk('fee card shows Net invested', /Net invested/i.test(feeCard?.textContent || ''));
chk('fee card is red', (feeCard?.querySelector('.kpi-value')?.className || '').includes('red'));

const erCard = kpis1[0].textContent.replace(/\s+/g,' ');
console.log(`      E(R) card: ${erCard}`);
chk('E(R) card discloses gross', /gross/i.test(erCard));

console.log('\n══════ 5. METRICS TABLE FEE COLUMNS ══════');
const mt = $('#metricsTable');
const mtHeaders = Array.from(mt.querySelectorAll('thead th')).map(h=>h.textContent.replace(/\s+/g,' ').trim());
console.log(`      headers: ${mtHeaders.join(' | ')}`);
chk('Fee% column present', mtHeaders.some(h=>/Fee%/.test(h)));
chk('Fee $ column present', mtHeaders.some(h=>/Fee \$/.test(h)));
chk('Net Invested column present', mtHeaders.some(h=>/Net Invested/.test(h)));
const bodyRows = Array.from(mt.querySelectorAll('tbody tr'));
chk('4 asset rows + 1 total row', bodyRows.length === 5, `${bodyRows.length} rows`);
const totalRow = mt.querySelector('tr.total-row');
console.log(`      TOTAL row: ${totalRow.textContent.replace(/\s+/g,' ').trim()}`);
chk('footer shows One-off Fee total', /One-off Fee \(total\)/.test(mt.textContent));
chk('footer shows Fee Drag', /Fee Drag on Return/.test(mt.textContent));

console.log('\n══════ 6. NUMBERS MATCH THE ENGINE ══════');
const amount = ev('getAmount()'), tenor = ev('getTenor()'), rf = ev('getRf()');
const stt = getState();
const mu = stt.assets.map(a=>a.er/100);
const cov = window.buildCovMatrix(stt.assets.map(a=>a.sd/100), stt.corr);
const w = stt.weights;
const d = window.portfolioDetail(w, mu, cov, stt.assets.map(a=>a.yield/100), amount, tenor, rf, fees);
console.log(`      engine: gross=${(d.grossAnnualReturn*100).toFixed(4)}%  net=${(d.annualReturn*100).toFixed(4)}%  fee$=${d.feeAmount.toFixed(0)}  net$=${d.netAmount.toFixed(0)}`);
// KPI displayed E(R) must equal engine net return
const erShown = parseFloat(kpis1[0].querySelector('.kpi-value').textContent);
chk('KPI E(R) == engine net return', Math.abs(erShown - d.annualReturn*100) < 0.005, `UI ${erShown}% vs engine ${(d.annualReturn*100).toFixed(2)}%`);
// Fee card amount must equal engine feeAmount
const feeShown = parseFloat((feeCard.querySelector('.kpi-value').textContent||'').replace(/[^0-9.]/g,''));
chk('KPI fee$ == engine feeAmount', Math.abs(feeShown - d.feeAmount) < 1, `UI ${feeShown} vs engine ${d.feeAmount.toFixed(0)}`);

// CRITICAL: per-row FV must sum to the total row FV
function parseMoney(s){ return parseFloat(String(s).replace(/[^0-9.\-]/g,'')) || 0; }
let sumRowFV = 0, sumRowFee = 0, sumRowNet = 0, sumRowInc = 0;
bodyRows.slice(0,4).forEach(r=>{
  const tds = Array.from(r.querySelectorAll('td')).map(td=>td.textContent);
  // cols: name,W,ER,Yld,CapG,σ,Amount,Fee%,Fee$,NetInv,Income,FV
  sumRowFee += parseMoney(tds[8]);
  sumRowNet += parseMoney(tds[9]);
  sumRowInc += parseMoney(tds[10]);
  sumRowFV  += parseMoney(tds[11]);
});
const totTds = Array.from(totalRow.querySelectorAll('td')).map(td=>td.textContent);
const totFV = parseMoney(totTds[11]), totFee = parseMoney(totTds[8]), totNet = parseMoney(totTds[9]), totInc = parseMoney(totTds[10]);
console.log(`      Σ rows: fee=${sumRowFee.toFixed(0)} net=${sumRowNet.toFixed(0)} inc=${sumRowInc.toFixed(0)} FV=${sumRowFV.toFixed(0)}`);
console.log(`      total : fee=${totFee.toFixed(0)} net=${totNet.toFixed(0)} inc=${totInc.toFixed(0)} FV=${totFV.toFixed(0)}`);
chk('Σ row Fee$ == total Fee$', Math.abs(sumRowFee - totFee) <= 2, `${sumRowFee} vs ${totFee}`);
chk('Σ row NetInv == total NetInv', Math.abs(sumRowNet - totNet) <= 2, `${sumRowNet} vs ${totNet}`);
chk('Σ row Income == total Income', Math.abs(sumRowInc - totInc) <= 2, `${sumRowInc} vs ${totInc}`);
chk('Σ row FV == total FV (KEY)', Math.abs(sumRowFV - totFV) <= 2, `${sumRowFV} vs ${totFV}`);
chk('total FV == engine fv', Math.abs(totFV - d.fv) <= 2, `${totFV} vs ${d.fv.toFixed(0)}`);
chk('total Fee$ == amount × feeRate', Math.abs(totFee - amount*d.feeRate) <= 2);
chk('net invested == amount − fee', Math.abs(totNet - (amount - totFee)) <= 2);

console.log('\n══════ 7. OPTIMIZER IS FEE-AWARE (UI level) ══════');
const wBefore = getState().weights.slice();
ev("updateAsset(0,'fee',15)");        // punitive 15% load on Equities
const wAfter = getState().weights.slice();
console.log(`      before 15% load: ${wBefore.map(x=>(x*100).toFixed(1)+'%').join(' ')}`);
console.log(`      after  15% load: ${wAfter.map(x=>(x*100).toFixed(1)+'%').join(' ')}`);
chk('Equities weight drops after big load', wAfter[0] < wBefore[0], `${(wBefore[0]*100).toFixed(1)}% → ${(wAfter[0]*100).toFixed(1)}%`);
chk('weights still sum 100%', Math.abs(wAfter.reduce((a,b)=>a+b,0)-1) < 1e-6);
ev("updateAsset(0,'fee',3)");         // restore

console.log('\n══════ 8. NO NaN ANYWHERE IN THE UI ══════');
function scanNaN(label, el) {
  const t = el.textContent;
  const bad = /NaN|Infinity|undefined|\$-|null/.test(t);
  chk(`${label} clean`, !bad, bad ? t.replace(/\s+/g,' ').substring(0,140) : 'ok');
}
scanNaN('KPI row', $('#kpiRow'));
scanNaN('Metrics table', $('#metricsTable'));
scanNaN('Risk budget', $('#riskBudgetDiv'));
scanNaN('Goals', $('#goalsResults'));
scanNaN('BL results', $('#blResults'));
scanNaN('Alloc sliders', $('#allocSliders'));

console.log('\n══════ 9. EDGE CASES VIA UI ══════');
ev("updateAsset(0,'fee',100)"); ev("updateAsset(1,'fee',100)"); ev("updateAsset(2,'fee',100)"); ev("updateAsset(3,'fee',100)");
scanNaN('100% fee everywhere: KPI', $('#kpiRow'));
scanNaN('100% fee everywhere: metrics', $('#metricsTable'));
ev("updateAsset(0,'fee',-5)");
scanNaN('negative fee: KPI', $('#kpiRow'));
chk('negative fee clamped to 0', ev('getFees()')[0] === 0, String(ev('getFees()')[0]));
[0,1,2,3].forEach(i=>ev(`updateAsset(${i},'fee',0)`));
const kpiTextBack = $$('.kpi-card').map(c=>c.textContent).join(' ');
chk('fee card disappears when back to 0', !/One-off Fee/.test(kpiTextBack));
chk('metrics Fee column disappears', !/Fee \$/.test($('#metricsTable').textContent));

console.log('\n══════ 10. CD σ=0 + FEE (singular matrix guard) ══════');
ev("updateAsset(0,'sd',0)"); ev("updateAsset(0,'er',3.5)"); ev("updateAsset(0,'yield',3.5)"); ev("updateAsset(0,'fee',1)");
scanNaN('CD σ=0 with fee: KPI', $('#kpiRow'));
scanNaN('CD σ=0 with fee: metrics', $('#metricsTable'));
chk('no new JS errors after CD case', jsErrors.length === 0, jsErrors.join(' | ') || 'clean');
// restore
ev("updateAsset(0,'sd',15)"); ev("updateAsset(0,'er',8.5)"); ev("updateAsset(0,'yield',2)"); ev("updateAsset(0,'fee',0)");

console.log('\n══════ 11. LANGUAGE TOGGLE (繁中) ══════');
[0,1,2,3].forEach((i,k)=>ev(`updateAsset(${i},'fee',${[3,1,0.5,0][k]})`));
ev("setLang('zh')");
const zhHeaders = $$('.asset-table thead th').map(h=>h.textContent.trim());
chk('ZH fee header = 費用%', zhHeaders.includes('費用%'), zhHeaders.join(' | '));
const zhKpi = $$('.kpi-card').map(c=>c.textContent).join(' ');
chk('ZH fee KPI = 一次性費用', /一次性費用/.test(zhKpi));
chk('ZH shows 淨投資額', /淨投資額/.test(zhKpi));
const zhMetrics = $('#metricsTable').textContent;
chk('ZH metrics 費用金額', /費用金額/.test(zhMetrics));
chk('ZH metrics 一次性費用（總額）', /一次性費用（總額）/.test(zhMetrics));
scanNaN('ZH mode: KPI', $('#kpiRow'));
scanNaN('ZH mode: metrics', $('#metricsTable'));
ev("setLang('en')");

console.log('\n══════ 12. PDF EXPORT WITH FEES ══════');
[0,1,2,3].forEach((i,k)=>ev(`updateAsset(${i},'fee',${[3,1,0.5,0][k]})`));
doc.getElementById('clientName').value = 'Mr. Chan Tai Man';
ev('openPdfModal()');
chk('modal opens', $('#pdfModal').classList.contains('show'));
ev('generatePdf()');
const pv = doc.getElementById('pdfPreview');
const printBtn = doc.getElementById('pdfPrintBtn');
chk('iframe preview displayed', pv.style.display === 'block', `display=${pv.style.display}`);
chk('Print button displayed', printBtn.style.display === 'inline-block', `display=${printBtn.style.display}`);
const pdfHtml = pv.getAttribute('srcdoc') || '';
chk('srcdoc non-empty', pdfHtml.length > 3000, `${pdfHtml.length} chars`);
chk('PDF has client name', pdfHtml.includes('Mr. Chan Tai Man'));
chk('PDF Client Profile has fee row', /deducted upfront/.test(pdfHtml));
// --- auto-scan + fix: each portfolio's asset weights must sum to exactly 100% ---
(() => {
  const pdoc = doc.implementation.createHTMLDocument('p');
  pdoc.documentElement.innerHTML = pdfHtml;
  const cards = pdoc.querySelectorAll('.two-col .col');
  const sums = [...cards].map(c => {
    const pcts = [...c.querySelectorAll('.alloc-bar .pct')].map(b => parseFloat(b.textContent));
    return Math.round(pcts.reduce((a,b)=>a+b,0)*10)/10;
  });
  chk('PDF each target portfolio weight sums to 100%', sums.length>0 && sums.every(s => Math.abs(s-100) < 0.5), JSON.stringify(sums));
})();
chk('PDF Return&Income has Fee column', /<th>Fee<\/th>/.test(pdfHtml));
chk('PDF Return&Income has Net Inv. column', /Net Inv\./.test(pdfHtml));
// --- Kathy 2026-08-04: currency stated once at top, NOT repeated in the table ---
(() => {
  const pdoc = doc.implementation.createHTMLDocument('p');
  pdoc.documentElement.innerHTML = pdfHtml;
  const ri = pdoc.querySelector('.ri-table');
  const cells = ri ? [...ri.querySelectorAll('td')].map(td => td.textContent) : [];
  const anyDollar = cells.some(t => t.includes('\$'));
  chk('PDF Return&Income table cells have NO currency symbol', !anyDollar, anyDollar ? cells.filter(t=>t.includes('\$')).slice(0,3).join(' | ') : 'clean');
})();
// --- Kathy 2026-08-04 removals ---
chk('PDF has NO Left:/Right: prefix', !/Left:|Right:|左：|右：/.test(pdfHtml));
chk('PDF KPI card has NO One-off Fee row', !/One-off Fee<\/div>|一次性費用<\/div>/.test(pdfHtml));
chk('PDF KPI card has NO Net Invested box', !/>Net Invested</.test(pdfHtml));
chk('PDF has NO Fee Drag anywhere', !/Fee Drag|費用年化拖累/.test(pdfHtml));
chk('PDF risk table has NO 95% VaR', !/95% VaR/.test(pdfHtml));
chk('PDF risk table has NO 99% VaR', !/99% VaR/.test(pdfHtml));            // removed per latest request
chk('PDF risk table HAS One-off Fee row', /One-off Fee \(deducted upfront\)|一次性費用（開倉扣除）/.test(pdfHtml));
// Client Profile section is the FIRST <div class=section>... parse it out and assert no fee row
(() => {
  const sec = pdfHtml.split('class="section"')[1] || pdfHtml.split('1. Client Profile')[1] || '';
  const end = sec.indexOf('2. Target') >= 0 ? sec.indexOf('2. Target') : sec.indexOf('2. 目標');
  const cp = end >= 0 ? sec.slice(0, end) : sec;
  chk('PDF Client Profile has NO fee row', !/deducted upfront|一次性費用（開倉扣除）/.test(cp));
})();
chk('PDF KPI boxes = 6 per card', (pdfHtml.match(/class="kpi-box"/g)||[]).length === 12, String((pdfHtml.match(/class="kpi-box"/g)||[]).length));
// --- auto-scaled unit (50M -> $M) ---
chk('PDF uses M-scaled money ($X.XM)', /\$[0-9,]*\.[0-9]+M/.test(pdfHtml));
chk('PDF amount header shows unit suffix', /Amount \([^)]*M\)|金額 \([^)]*M\)/.test(pdfHtml));
// --- nowrap on figures ---
chk('PDF td has white-space nowrap', /td \{[^}]*white-space:\s*nowrap/.test(pdfHtml));
chk('PDF Return&Income uses ri-table', /class="ri-table"/.test(pdfHtml));
chk('PDF ri-table has colgroup', /<colgroup>/.test(pdfHtml));
chk('PDF has Max-Sharpe column', /Max-Sharpe/.test(pdfHtml));
chk('PDF has Min-Risk column', /Minimum-Risk/.test(pdfHtml));
chk('PDF has HSBC green #007A3D', pdfHtml.includes('#007A3D'));
chk('PDF has disclaimer', /Disclaimer/.test(pdfHtml));
chk('PDF no NaN', !/NaN|Infinity|undefined/.test(pdfHtml), (pdfHtml.match(/NaN|Infinity|undefined/g)||[]).slice(0,3).join(','));
chk('PDF no purple', !/#4f46e5|#7c3aed/i.test(pdfHtml));
chk('no literal <script> in srcdoc', !/<script/i.test(pdfHtml));
ev('closePdfModal()');
chk('modal closes', !$('#pdfModal').classList.contains('show'));
chk('iframe cleared on close', (pv.getAttribute('srcdoc')||'') === '');
const fin = getState(); chk('assets preserved after close', fin.assets.length === 4 && fin.assets[0].fee === 3);

console.log('\n══════ 13. FINAL ERROR SWEEP ══════');
chk('zero JS errors for whole run', jsErrors.length === 0, jsErrors.slice(0,3).join(' | ') || 'clean');

console.log(`\n════════════  ${pass} passed, ${fail} failed  ════════════`);
process.exit(fail ? 1 : 0);
})();
