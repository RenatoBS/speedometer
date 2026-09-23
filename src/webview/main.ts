import {
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  Legend,
  LinearScale,
  Tooltip
} from 'chart.js';
import { CursorExtras, DashboardData, DashboardTool } from '../types';

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend);

declare function acquireVsCodeApi(): { postMessage: (msg: unknown) => void };
const vscode = acquireVsCodeApi();

const COLORS: Record<string, string> = {
  claude: '#d97757',
  cursor: '#3b82f6',
  codex: '#10a37f',
  trae: '#007bff',
  antigravity: '#a855f7'
};

let currentData: DashboardData = (window as unknown as { __INITIAL_DATA__: DashboardData }).__INITIAL_DATA__;
let metric: 'cost' | 'limit' = 'limit';
let chart: Chart | undefined;

function cssVar(name: string, fallback: string): string {
  return getComputedStyle(document.body).getPropertyValue(name).trim() || fallback;
}

function primaryPercent(tool: DashboardTool): number | null {
  if (tool.result.status !== 'ok') return null;
  const windows = tool.result.data.windows;
  const primary =
    windows.find((w) => w.kind === 'session' || w.kind === 'auto' || w.kind === 'plan' || w.kind === 'entitlement') ??
    windows[0];
  return primary ? primary.percent : null;
}

function costUSD(tool: DashboardTool): number | null {
  if (tool.id === 'cursor' && tool.extras && 'models' in tool.extras) {
    const extras = tool.extras as CursorExtras;
    const sum = extras.models.reduce((acc, m) => acc + m.costUSD, 0);
    return sum;
  }
  if (tool.result.status !== 'ok') return null;
  const used = tool.result.data.windows.reduce((acc, w) => acc + (w.unit === 'usd' ? w.used ?? 0 : 0), 0);
  return used || null;
}

function renderCards(data: DashboardData): void {
  const cardsEl = document.getElementById('cards')!;
  cardsEl.innerHTML = '';
  for (const tool of data.tools) {
    const card = document.createElement('div');
    card.className = 'card';
    card.style.setProperty('--accent', COLORS[tool.id] ?? '#888');
    const percent = primaryPercent(tool);
    const cost = costUSD(tool);
    if (tool.result.status !== 'ok') {
      card.innerHTML = `<div class="card-title">${tool.label}</div><div class="card-unavailable">${tool.result.message}</div>`;
    } else {
      const note = tool.result.data.plan ? `Plano ${tool.result.data.plan}` : tool.result.data.sourceNote ?? '';
      card.innerHTML = `
        <div class="card-title">${tool.label}</div>
        <div class="card-percent">${percent !== null ? `${Math.round(percent)}%` : '—'}<span class="card-percent-label">do limite</span></div>
        <div class="bar-track"><div class="bar-fill" style="width:${Math.min(100, percent ?? 0)}%"></div></div>
        <div class="card-sub">${cost !== null ? `Gasto: $${cost.toFixed(2)}` : tool.result.data.account ?? ''}</div>
        <div class="card-note">${note}</div>
      `;
    }
    cardsEl.appendChild(card);
  }
}

function limitDatasets(data: DashboardData) {
  const labels: string[] = [];
  const values: number[] = [];
  const colors: string[] = [];
  for (const tool of data.tools) {
    if (tool.result.status !== 'ok') continue;
    for (const window of tool.result.data.windows.filter((w) => w.kind !== 'scoped')) {
      labels.push(`${tool.label} ${window.label}`);
      values.push(Math.round(window.percent));
      colors.push(COLORS[tool.id] ?? '#888');
    }
  }
  return { labels, datasets: [{ label: '% usado', data: values, backgroundColor: colors, borderRadius: 4, maxBarThickness: 28 }] };
}

function costDatasets(data: DashboardData) {
  const cursor = data.tools.find((t) => t.id === 'cursor');
  const extras = cursor?.extras as CursorExtras | undefined;
  if (extras?.models?.length) {
    return {
      labels: extras.models.map((m) => m.model),
      datasets: [
        {
          label: 'USD',
          data: extras.models.map((m) => Number(m.costUSD.toFixed(2))),
          backgroundColor: COLORS.cursor,
          borderRadius: 4,
          maxBarThickness: 28
        }
      ]
    };
  }
  const labels: string[] = [];
  const values: number[] = [];
  const colors: string[] = [];
  for (const tool of data.tools) {
    if (tool.result.status !== 'ok') continue;
    for (const window of tool.result.data.windows) {
      if (window.unit !== 'usd' || window.used == null) continue;
      labels.push(`${tool.label} ${window.label}`);
      values.push(Number(window.used.toFixed(2)));
      colors.push(COLORS[tool.id] ?? '#888');
    }
  }
  return { labels, datasets: [{ label: 'USD', data: values, backgroundColor: colors, borderRadius: 4, maxBarThickness: 28 }] };
}

function renderChart(data: DashboardData): void {
  const ctx = (document.getElementById('chart') as HTMLCanvasElement).getContext('2d')!;
  const built = metric === 'limit' ? limitDatasets(data) : costDatasets(data);
  const fg = cssVar('--vscode-foreground', '#ccc');
  const grid = cssVar('--vscode-widget-border', 'rgba(128,128,128,0.2)');
  if (chart) chart.destroy();
  chart = new Chart(ctx, {
    type: 'bar',
    data: built,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { ticks: { color: fg }, grid: { color: grid } },
        y: {
          ticks: { color: fg, callback: (v) => (metric === 'cost' ? `$${v}` : `${v}%`) },
          grid: { color: grid },
          beginAtZero: true,
          max: metric === 'limit' ? 100 : undefined
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (item) => {
              const val = item.parsed.y as number;
              return metric === 'cost' ? `$${val.toFixed(2)}` : `${val}%`;
            }
          }
        }
      }
    }
  });
}

function render(): void {
  renderCards(currentData);
  renderChart(currentData);
  document.getElementById('generated-at')!.textContent = `Atualizado em ${new Date(currentData.generatedAt).toLocaleString('pt-BR')}`;
}

document.getElementById('metric-toggle')!.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('button');
  if (!btn) return;
  metric = btn.dataset.value as 'cost' | 'limit';
  document.querySelectorAll('#metric-toggle button').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  renderChart(currentData);
});

document.getElementById('refresh-btn')!.addEventListener('click', () => {
  vscode.postMessage({ type: 'requestRefresh' });
});

window.addEventListener('message', (event) => {
  if (event.data?.type === 'data') {
    currentData = event.data.data as DashboardData;
    render();
  }
});

render();
