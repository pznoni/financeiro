// historico.js — visão anual: receita, despesa e saldo mês a mês (#historico/<ano>).
import { loadAll, summarize, yearSummary } from '../finance.js';
import { setMonth, state } from '../state.js';
import { MESES, currentMonth, escapeHTML, formatBRL, sum } from '../util.js';
import { $, icons, moneyClass } from './components.js';

export async function render(root, ctx) {
  const yearParam = Number(ctx.params[0]);
  const year = Number.isInteger(yearParam) && yearParam > 1900 ? yearParam : Number(state.month.slice(0, 4));
  const d = await loadAll();
  const months = yearSummary(d.transactions, year);
  const total = summarize(d.transactions.filter((t) => t.data.startsWith(`${year}-`)));
  const max = Math.max(1, ...months.map((m) => Math.max(m.receitas, m.despesas)));
  const nowYm = currentMonth();
  const withData = months.filter((m) => m.receitas || m.despesas);
  const media = withData.length ? Math.round(sum(withData, (m) => m.despesas) / withData.length) : 0;

  root.innerHTML = `
    <header class="view-header">
      <a class="back" href="#inicio" aria-label="Voltar para o início">${icons.left}<span>Início</span></a>
      <h1 class="h-center">Histórico</h1>
      <div class="header-actions"></div>
    </header>
    <div class="month-switcher">
      <a class="icon-btn" href="#historico/${year - 1}" aria-label="Ano anterior">${icons.left}</a>
      <span class="month-label">${year}</span>
      <a class="icon-btn" href="#historico/${year + 1}" aria-label="Próximo ano">${icons.right}</a>
    </div>

    <section class="summary-grid" aria-label="Resumo do ano">
      <div class="stat stat-wide">
        <span class="stat-label">Saldo do ano</span>
        <strong class="stat-value big ${moneyClass(total.saldo)}">${formatBRL(total.saldo)}</strong>
      </div>
      <div class="stat"><span class="stat-label">Receitas</span><strong class="stat-value pos">${formatBRL(total.receitas)}</strong></div>
      <div class="stat"><span class="stat-label">Despesas</span><strong class="stat-value neg">${formatBRL(total.despesas)}</strong></div>
      <div class="stat stat-wide"><span class="stat-label">Gasto médio por mês</span><strong class="stat-value">${formatBRL(media)}</strong>
        <span class="stat-sub">considerando ${withData.length} ${withData.length === 1 ? 'mês' : 'meses'} com lançamentos</span></div>
    </section>

    <section class="panel">
      <h2>Mês a mês <small>toque para abrir</small></h2>
      <ul class="year-list">${months.map((m, i) => `
        <li>
          <button type="button" class="year-row${m.ym === nowYm ? ' is-current' : ''}" data-ym="${m.ym}"
            aria-label="${escapeHTML(`${MESES[i]}: receitas ${formatBRL(m.receitas)}, despesas ${formatBRL(m.despesas)}, saldo ${formatBRL(m.saldo)}`)}">
            <span class="yr-month">${MESES[i].slice(0, 3)}</span>
            <span class="yr-bars" aria-hidden="true">
              <span class="yr-bar pos" style="width:${((m.receitas / max) * 100).toFixed(1)}%"></span>
              <span class="yr-bar neg" style="width:${((m.despesas / max) * 100).toFixed(1)}%"></span>
            </span>
            <span class="yr-values">
              <strong class="${moneyClass(m.saldo)}">${formatBRL(m.saldo)}</strong>
              <small>${m.receitas || m.despesas ? `+${formatBRL(m.receitas)} · −${formatBRL(m.despesas)}` : 'sem lançamentos'}</small>
            </span>
          </button>
        </li>`).join('')}
      </ul>
      <p class="legend" aria-hidden="true"><span class="dot pos"></span>Receitas <span class="dot neg"></span>Despesas</p>
    </section>`;

  $('.year-list', root).addEventListener('click', (ev) => {
    const row = ev.target.closest('[data-ym]');
    if (!row) return;
    setMonth(row.dataset.ym);
    ctx.go('#inicio');
  });
}
