import { createServer } from "node:http";
import { exec } from "node:child_process";
import { platform } from "node:os";
import chalk from "chalk";
import { getAnalyticsSummary } from "../../core/analytics.js";
import { getAgentCosts, checkBudgets } from "../../core/cost-tracker.js";

function openBrowser(url: string): void {
  const cmd =
    platform() === "darwin"
      ? "open"
      : platform() === "win32"
        ? "start"
        : "xdg-open";
  exec(`${cmd} ${url}`);
}

function buildHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AgentMX Dashboard</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<style>
  :root {
    --bg: #0d1117;
    --surface: #161b22;
    --border: #30363d;
    --text: #e6edf3;
    --text-dim: #8b949e;
    --accent: #58a6ff;
    --green: #3fb950;
    --red: #f85149;
    --yellow: #d29922;
    --purple: #bc8cff;
    --orange: #f0883e;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    background: var(--bg);
    color: var(--text);
    min-height: 100vh;
  }
  header {
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    padding: 16px 24px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  header h1 {
    font-size: 20px;
    font-weight: 600;
  }
  header h1 span { color: var(--accent); }
  .header-meta { color: var(--text-dim); font-size: 13px; }
  .container { max-width: 1280px; margin: 0 auto; padding: 24px; }

  /* Summary cards */
  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 16px;
    margin-bottom: 24px;
  }
  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 20px;
  }
  .card-label { font-size: 12px; color: var(--text-dim); text-transform: uppercase; letter-spacing: .5px; }
  .card-value { font-size: 28px; font-weight: 700; margin-top: 4px; }
  .card-value.green { color: var(--green); }
  .card-value.accent { color: var(--accent); }
  .card-value.yellow { color: var(--yellow); }

  /* Charts */
  .charts-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    margin-bottom: 24px;
  }
  .chart-box {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 20px;
  }
  .chart-box h3 {
    font-size: 14px;
    font-weight: 600;
    margin-bottom: 16px;
    color: var(--text-dim);
  }
  .chart-box canvas { width: 100% !important; }
  .chart-box.full { grid-column: 1 / -1; }

  /* Table */
  .table-box {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 20px;
    margin-bottom: 24px;
  }
  .table-box h3 {
    font-size: 14px;
    font-weight: 600;
    margin-bottom: 16px;
    color: var(--text-dim);
  }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .5px; color: var(--text-dim); padding: 8px 12px; border-bottom: 1px solid var(--border); }
  td { padding: 10px 12px; border-bottom: 1px solid var(--border); font-size: 14px; }
  tr:last-child td { border-bottom: none; }
  .badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 12px;
    font-size: 12px;
    font-weight: 500;
  }
  .badge-green { background: rgba(63,185,80,.15); color: var(--green); }
  .badge-red { background: rgba(248,81,73,.15); color: var(--red); }
  .badge-yellow { background: rgba(210,153,34,.15); color: var(--yellow); }

  /* Alerts */
  .alerts { margin-bottom: 24px; }
  .alert {
    padding: 12px 16px;
    border-radius: 8px;
    margin-bottom: 8px;
    font-size: 14px;
  }
  .alert-warning { background: rgba(210,153,34,.12); border: 1px solid rgba(210,153,34,.3); color: var(--yellow); }
  .alert-exceeded { background: rgba(248,81,73,.12); border: 1px solid rgba(248,81,73,.3); color: var(--red); }

  /* Auto-refresh indicator */
  .refresh-badge {
    font-size: 11px;
    color: var(--text-dim);
    background: var(--bg);
    padding: 4px 10px;
    border-radius: 12px;
    border: 1px solid var(--border);
  }

  @media (max-width: 768px) {
    .charts-grid { grid-template-columns: 1fr; }
    .cards { grid-template-columns: 1fr 1fr; }
  }
</style>
</head>
<body>
<header>
  <h1><span>AgentMX</span> Dashboard</h1>
  <div class="header-meta">
    <span class="refresh-badge" id="refreshBadge">Auto-refresh: 30s</span>
  </div>
</header>
<div class="container">
  <div class="alerts" id="alerts"></div>
  <div class="cards" id="cards"></div>
  <div class="charts-grid">
    <div class="chart-box full">
      <h3>Daily Activity</h3>
      <canvas id="dailyChart" height="80"></canvas>
    </div>
    <div class="chart-box">
      <h3>Cost Trend (Daily)</h3>
      <canvas id="costChart" height="140"></canvas>
    </div>
    <div class="chart-box">
      <h3>Tasks by Agent</h3>
      <canvas id="agentPieChart" height="140"></canvas>
    </div>
    <div class="chart-box">
      <h3>Success Rate by Agent</h3>
      <canvas id="successChart" height="140"></canvas>
    </div>
    <div class="chart-box">
      <h3>Cost by Agent</h3>
      <canvas id="costPieChart" height="140"></canvas>
    </div>
  </div>
  <div class="table-box">
    <h3>Agent Statistics</h3>
    <table id="agentTable">
      <thead>
        <tr>
          <th>Agent</th>
          <th>Tasks</th>
          <th>Success</th>
          <th>Errors</th>
          <th>Rate</th>
          <th>Avg Time</th>
          <th>Total Cost</th>
          <th>Avg Cost</th>
        </tr>
      </thead>
      <tbody></tbody>
    </table>
  </div>
  <div class="table-box">
    <h3>Cost Summary</h3>
    <table id="costTable">
      <thead>
        <tr>
          <th>Agent</th>
          <th>Today</th>
          <th>This Week</th>
          <th>This Month</th>
          <th>Total</th>
          <th>Sessions</th>
          <th>Avg / Session</th>
        </tr>
      </thead>
      <tbody></tbody>
    </table>
  </div>
</div>
<script>
const COLORS = ['#58a6ff','#3fb950','#bc8cff','#f0883e','#f85149','#d29922','#79c0ff','#56d364'];
const chartDefaults = {
  color: '#8b949e',
  borderColor: '#30363d',
};
Chart.defaults.color = chartDefaults.color;
Chart.defaults.borderColor = chartDefaults.borderColor;

let charts = {};

function fmtCost(v) {
  if (v === 0) return '$0.00';
  if (v < 0.01) return '$' + v.toFixed(4);
  return '$' + v.toFixed(2);
}

function fmtDuration(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return h + 'h ' + (m % 60) + 'm';
  if (m > 0) return m + 'm ' + (s % 60) + 's';
  return s + 's';
}

function renderCards(data) {
  const el = document.getElementById('cards');
  const rate = data.analytics.overallSuccessRate;
  const rateClass = rate >= 80 ? 'green' : rate >= 50 ? 'yellow' : '';
  el.innerHTML = \`
    <div class="card"><div class="card-label">Total Sessions</div><div class="card-value accent">\${data.analytics.totalSessions}</div></div>
    <div class="card"><div class="card-label">Success Rate</div><div class="card-value \${rateClass}">\${rate.toFixed(1)}%</div></div>
    <div class="card"><div class="card-label">Total Cost</div><div class="card-value">\${fmtCost(data.analytics.totalCost)}</div></div>
    <div class="card"><div class="card-label">Total Time</div><div class="card-value">\${fmtDuration(data.analytics.totalDurationMs)}</div></div>
    <div class="card"><div class="card-label">Agents Used</div><div class="card-value accent">\${data.analytics.agentStats.length}</div></div>
  \`;
}

function renderAlerts(data) {
  const el = document.getElementById('alerts');
  if (!data.budgetAlerts || data.budgetAlerts.length === 0) { el.innerHTML = ''; return; }
  el.innerHTML = data.budgetAlerts.map(a =>
    \`<div class="alert alert-\${a.level}">\${a.level === 'exceeded' ? '⛔' : '⚠️'} <strong>\${a.scope}</strong> \${a.period} budget: \${fmtCost(a.spent)} / \${fmtCost(a.limit)} (\${a.percentage.toFixed(0)}%)</div>\`
  ).join('');
}

function renderAgentTable(stats) {
  const tbody = document.querySelector('#agentTable tbody');
  tbody.innerHTML = stats.map(s => {
    const rateClass = s.successRate >= 80 ? 'green' : s.successRate >= 50 ? 'yellow' : 'red';
    return \`<tr>
      <td><strong>\${s.agentName}</strong></td>
      <td>\${s.totalTasks}</td>
      <td>\${s.successCount}</td>
      <td>\${s.errorCount}</td>
      <td><span class="badge badge-\${rateClass}">\${s.successRate.toFixed(0)}%</span></td>
      <td>\${fmtDuration(s.avgDurationMs)}</td>
      <td>\${fmtCost(s.totalCost)}</td>
      <td>\${fmtCost(s.avgCost)}</td>
    </tr>\`;
  }).join('');
}

function renderCostTable(costs) {
  const tbody = document.querySelector('#costTable tbody');
  tbody.innerHTML = costs.map(c => \`<tr>
    <td><strong>\${c.agentName}</strong></td>
    <td>\${fmtCost(c.todayCost)}</td>
    <td>\${fmtCost(c.weekCost)}</td>
    <td>\${fmtCost(c.monthCost)}</td>
    <td>\${fmtCost(c.totalCost)}</td>
    <td>\${c.sessionCount}</td>
    <td>\${fmtCost(c.avgCostPerSession)}</td>
  </tr>\`).join('');
}

function makeOrUpdate(id, type, cfg) {
  if (charts[id]) {
    charts[id].data = cfg.data;
    charts[id].update();
  } else {
    charts[id] = new Chart(document.getElementById(id), { type, ...cfg });
  }
}

function renderCharts(data) {
  const daily = data.analytics.dailyStats.slice(-30);
  const agents = data.analytics.agentStats;

  // Daily activity (bar: success + error stacked)
  makeOrUpdate('dailyChart', 'bar', {
    data: {
      labels: daily.map(d => d.date),
      datasets: [
        { label: 'Success', data: daily.map(d => d.successCount), backgroundColor: '#3fb950', borderRadius: 3 },
        { label: 'Errors',  data: daily.map(d => d.errorCount),   backgroundColor: '#f85149', borderRadius: 3 },
      ]
    },
    options: {
      responsive: true,
      plugins: { legend: { position: 'top' } },
      scales: {
        x: { stacked: true, grid: { display: false } },
        y: { stacked: true, beginAtZero: true, ticks: { stepSize: 1 } }
      }
    }
  });

  // Cost trend (line)
  makeOrUpdate('costChart', 'line', {
    data: {
      labels: daily.map(d => d.date),
      datasets: [{
        label: 'Cost ($)',
        data: daily.map(d => d.totalCost),
        borderColor: '#58a6ff',
        backgroundColor: 'rgba(88,166,255,.1)',
        fill: true,
        tension: .3,
        pointRadius: 2,
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false } },
        y: { beginAtZero: true }
      }
    }
  });

  // Agent pie
  makeOrUpdate('agentPieChart', 'doughnut', {
    data: {
      labels: agents.map(a => a.agentName),
      datasets: [{
        data: agents.map(a => a.totalTasks),
        backgroundColor: COLORS.slice(0, agents.length),
        borderWidth: 0,
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } } }
    }
  });

  // Success rate (horizontal bar)
  makeOrUpdate('successChart', 'bar', {
    data: {
      labels: agents.map(a => a.agentName),
      datasets: [{
        label: 'Success %',
        data: agents.map(a => a.successRate),
        backgroundColor: agents.map(a => a.successRate >= 80 ? '#3fb950' : a.successRate >= 50 ? '#d29922' : '#f85149'),
        borderRadius: 4,
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { min: 0, max: 100, grid: { display: false } },
        y: { grid: { display: false } }
      }
    }
  });

  // Cost pie
  makeOrUpdate('costPieChart', 'doughnut', {
    data: {
      labels: agents.map(a => a.agentName),
      datasets: [{
        data: agents.map(a => a.totalCost),
        backgroundColor: COLORS.slice(0, agents.length),
        borderWidth: 0,
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } } }
    }
  });
}

async function loadData() {
  const res = await fetch('/api/data');
  const data = await res.json();
  renderCards(data);
  renderAlerts(data);
  renderAgentTable(data.analytics.agentStats);
  renderCostTable(data.costs);
  renderCharts(data);
}

loadData();
setInterval(loadData, 30000);
</script>
</body>
</html>`;
}

export async function dashboardCommand(opts: {
  port?: string;
  open?: boolean;
}): Promise<void> {
  const port = opts.port ? parseInt(opts.port, 10) : 3120;

  const server = createServer((req, res) => {
    if (req.url === "/api/data") {
      const analytics = getAnalyticsSummary();
      const costs = getAgentCosts();
      const budgetAlerts = checkBudgets();

      res.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
      });
      res.end(JSON.stringify({ analytics, costs, budgetAlerts }));
      return;
    }

    // Serve HTML for everything else
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(buildHTML());
  });

  server.listen(port, () => {
    const url = `http://localhost:${port}`;
    console.log();
    console.log(chalk.bold("  AgentMX Web Dashboard"));
    console.log();
    console.log(`  ${chalk.green("●")} Running at ${chalk.cyan.underline(url)}`);
    console.log(`  ${chalk.dim("  Auto-refresh every 30s")}`);
    console.log();
    console.log(chalk.dim("  Press Ctrl+C to stop"));
    console.log();

    if (opts.open !== false) {
      openBrowser(url);
    }
  });

  // Keep alive until Ctrl+C
  await new Promise<void>((resolve) => {
    process.on("SIGINT", () => {
      console.log(chalk.dim("\n  Shutting down dashboard..."));
      server.close(() => resolve());
    });
    process.on("SIGTERM", () => {
      server.close(() => resolve());
    });
  });
}
