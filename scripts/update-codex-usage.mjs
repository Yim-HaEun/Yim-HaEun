// From this repository, run: node scripts/update-codex-usage.mjs
// Use a local Codex CLI signed in to the account whose usage you want to show.
// Commit and push the regenerated SVG to refresh the profile.
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';

function readUsage() {
  return new Promise((resolve, reject) => {
    const server = spawn('codex', ['app-server', '--listen', 'stdio://'], {
      stdio: ['pipe', 'pipe', 'ignore'],
      windowsHide: true,
    });
    const lines = createInterface({ input: server.stdout });
    const timeout = setTimeout(() => finish(new Error('Codex usage request timed out')), 30_000);
    let finished = false;

    function finish(error, usage) {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      lines.close();
      server.stdin.destroy();
      server.kill();
      if (error) reject(error);
      else resolve(usage);
    }

    function send(message) {
      server.stdin.write(JSON.stringify(message) + '\n');
    }

    server.on('error', finish);
    server.stdin.on('error', finish);
    server.on('exit', () => finish(new Error('Codex app-server closed before returning usage')));
    lines.on('line', line => {
      let response;
      try {
        response = JSON.parse(line);
      } catch {
        finish(new Error('Codex app-server returned invalid JSON'));
        return;
      }
      if (response.id !== 1 && response.id !== 2) return;
      if (response.error) {
        finish(new Error(response.error.message));
        return;
      }
      if (response.id === 1) {
        send({ method: 'initialized', params: {} });
        send({ method: 'account/usage/read', id: 2 });
      } else {
        finish(null, response.result);
      }
    });
    send({
      method: 'initialize',
      id: 1,
      params: {
        clientInfo: { name: 'codex_usage_profile', title: 'Codex Usage Profile', version: '1.0.0' },
        capabilities: { experimentalApi: true },
      },
    });
  });
}

function renderCard({ summary, dailyUsageBuckets }) {
  if (!Number.isSafeInteger(summary?.lifetimeTokens)) {
    throw new Error('Codex did not return lifetime token usage');
  }

  const dateFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', dateStyle: 'short' });
  const updated = dateFormat.format(new Date());
  const format = new Intl.NumberFormat('en-US');
  const usageByDate = new Map(dailyUsageBuckets?.map(({ startDate, tokens }) => [startDate, tokens]));
  const dates = [...usageByDate.keys()].sort();
  const last = new Date((dates.at(-1) ?? updated) + 'T00:00:00Z');
  const dayMs = 86_400_000;
  const start = last.getTime() - (77 + last.getUTCDay()) * dayMs;
  const colors = ['#202833', '#174839', '#197752', '#21a66d', '#4ade91'];
  const tiles = [];

  for (let time = start; time <= last.getTime() && dates.length; time += dayMs) {
    const date = new Date(time).toISOString().slice(0, 10);
    if (date < dates[0]) continue;
    const index = (time - start) / dayMs;
    const tokens = usageByDate.get(date) ?? 0;
    const level = tokens >= 25_000_000 ? 4 : tokens >= 10_000_000 ? 3 : tokens >= 1_000_000 ? 2 : tokens > 0 ? 1 : 0;
    const x = 296 + Math.floor(index / 7) * 16;
    const y = 50 + (index % 7) * 16;
    tiles.push(`<rect x="${x}" y="${y}" width="12" height="12" rx="3" fill="${colors[level]}"><title>${date} · ${format.format(tokens)} tokens</title></rect>`);
  }

  const streak = Number.isSafeInteger(summary.currentStreakDays) ? `${summary.currentStreakDays} day streak` : '';
  const dailyLabel = dates.length ? `Daily activity through ${dates.at(-1)}` : 'Daily activity unavailable';
  const legend = dates.length ? colors.map((color, index) =>
    `<rect x="${366 + index * 15}" y="171" width="11" height="11" rx="2" fill="${color}"/>`
  ).join('') : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="200" viewBox="0 0 512 200" role="img" aria-labelledby="title desc">
  <title id="title">Codex token usage</title>
  <desc id="desc">${format.format(summary.lifetimeTokens)} lifetime tokens. ${dailyLabel}. Updated ${updated} KST.</desc>
  <rect x="0.5" y="0.5" width="511" height="199" rx="15" fill="#111820" stroke="#303b46"/>
  <g font-family="system-ui, -apple-system, Segoe UI, sans-serif">
    <text x="24" y="37" fill="#65e5a4" font-size="16" font-weight="700">Codex token usage</text>
    <text x="24" y="91" fill="#f0f6fc" font-size="33" font-weight="700">${format.format(summary.lifetimeTokens)}</text>
    <text x="25" y="115" fill="#aab7c4" font-size="14">Lifetime tokens</text>
    <text x="25" y="146" fill="#65e5a4" font-size="13">${streak}</text>
    <text x="25" y="177" fill="#aab7c4" font-size="11">Updated ${updated} KST</text>
    <text x="296" y="35" fill="#aab7c4" font-size="11">${dailyLabel}</text>
    ${tiles.join('\n    ')}
    ${legend}
    ${dates.length ? '<text x="331" y="181" fill="#aab7c4" font-size="10">Less</text><text x="446" y="181" fill="#aab7c4" font-size="10">More</text>' : ''}
  </g>
</svg>
`;
}

try {
  const card = renderCard(await readUsage());
  const assets = new URL('../assets/', import.meta.url);
  await mkdir(assets, { recursive: true });
  await writeFile(new URL('codex-usage.svg', assets), card);
  console.log('Updated assets/codex-usage.svg');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
