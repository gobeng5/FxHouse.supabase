const fs = require('fs');

const data = JSON.parse(fs.readFileSync('./backtest/forwardtest-2.1-results.json', 'utf8'));

function printSection(title, key) {
  console.log(`\n=== ${title} ===`);
  data.strategies.forEach(s => {
    const st = s[key];
    const pWin = (st.winRate ?? 0) / 100;
    const pLoss = 1 - pWin;
    const avgWin = st.avgWinR ?? 0;
    const avgLoss = pLoss > 0 ? (pWin * avgWin - (st.avgR ?? 0)) / pLoss : 0;
    const payoff = avgLoss > 0 ? avgWin / avgLoss : 0;
    const expR = st.avgR ?? 0;
    const expPct = expR * 1.0;
    const pf = st.profitFactor == null ? 0 : st.profitFactor === Infinity ? 99.99 : st.profitFactor;
    const maxDD = st.maxDrawdownR ?? 0;
    const totalR = st.totalR ?? 0;

    console.log(`${s.instrument.padEnd(10)} ${s.type.padEnd(5)} | N=${String(st.n).padStart(4)} | Win%=${(pWin*100).toFixed(1)}% | AvgWin=${avgWin.toFixed(2)}R | AvgLoss=${avgLoss.toFixed(2)}R | Payoff=${payoff.toFixed(2)} | Exp/Trade=${expR >= 0 ? '+' : ''}${expR.toFixed(3)}R (${expPct >= 0 ? '+' : ''}${expPct.toFixed(2)}%) | TotalR=${totalR >= 0 ? '+' : ''}${totalR.toFixed(1)}R | PF=${pf.toFixed(2)} | MaxDD=${maxDD.toFixed(1)}R`);
  });
}

printSection('FORWARD TEST EXPECTANCY (May 1, 2026 - Oct 2026)', 'forward');
printSection('IN-SAMPLE BACKTEST EXPECTANCY (Oct 2025 - Apr 30, 2026)', 'train');
printSection('FULL YEAR EXPECTANCY (All 12 Months)', 'all');

