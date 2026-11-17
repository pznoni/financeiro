// inicio.js — dashboard do mês: resumo, saldos, faturas, próximos vencimentos e gastos por categoria.
import { metaGet } from '../db.js';
import {
  accountBalance, inMonth, loadAll, spendingByCategory, summarize, unpaidInvoicesUntil, upcomingBills,
} from '../finance.js';
import { runBackup } from '../backup.js';
import { state } from '../state.js';
import {
  diffDays, dueLabel, endOfMonth, escapeHTML, formatBRL, formatDate, monthShort, sum, todayISO,
} from '../util.js';
import {
  bindMonthSwitcher, emptyState, icons, monthSwitcher, moneyClass,
} from './components.js';
import { bindTransactionActions } from './form-lancamento.js';

export async function render(root) {
  const ym = state.month;
  const [d, lastBackup] = await Promise.all([loadAll(), metaGet('lastBackup')]);
  const monthTx = inMonth(d.transactions, ym);
  const s = summarize(monthTx);
  const end = endOfMonth(ym);
  const saldoReal = sum(d.accounts, (a) => accountBalance(a, d.transactions, { until: end }));
  const saldoPrevisto = sum(d.accounts, (a) => accountBalance(a, d.transactions, { until: end, onlyPaid: false }));
  const faturas = unpaidInvoicesUntil(d, ym);
  const totalFaturas = sum(faturas, (f) => f.remaining);

  root.innerHTML = `
    <header class="view-header">
      <h1>Início</h1>
      <a class="icon-btn" href="#historico" aria-label="Histórico e visão anual">${icons.chart}</a>
    </header>
    ${monthSwitcher(ym)}
    ${backupReminder(d, lastBackup)}

    <section class="summary-grid" aria-label="Resumo do mês">
      <div class="stat stat-wide">
        <span class="stat-label">Saldo do mês</span>
        <strong class="stat-value big ${moneyClass(s.saldo)}">${formatBRL(s.saldo)}</strong>
      </div>
      <div class="stat">
        <span class="stat-label">Receitas</span>
        <strong class="stat-value pos">${formatBRL(s.receitas)}</strong>
      </div>
      <div class="stat">
        <span class="stat-label">Despesas</span>
        <strong class="stat-value neg">${formatBRL(s.despesas)}</strong>
      </div>
      <a class="stat" href="#ajustes/contas">
        <span class="stat-label">Saldo em contas</span>
        <strong class="stat-value ${moneyClass(saldoReal)}">${formatBRL(saldoReal)}</strong>
        <span class="stat-sub">previsto ${formatBRL(saldoPrevisto)}</span>
      </a>
      <a class="stat" href="#cartoes">
        <span class="stat-label">Faturas em aberto</span>
        <strong class="stat-value ${totalFaturas ? 'neg' : ''}">${formatBRL(totalFaturas)}</strong>
        <span class="stat-sub">${faturas.length ? `${faturas.length} fatura${faturas.length > 1 ? 's' : ''} até ${monthShort(ym)}` : 'nenhuma pendente'}</span>
      </a>
    </section>

    <section class="panel">
      <h2>Próximas contas <small>7 dias</small></h2>
      ${upcomingHTML(d)}
    </section>

    <section class="panel">
      <h2>Gastos por categoria</h2>
      ${categoryBars(monthTx, d)}
    </section>`;

  bindMonthSwitcher(root);
  bindTransactionActions(root);
  root.querySelector('[data-backup-now]')?.addEventListener('click', runBackup);
}

function backupReminder(d, lastBackup) {
  if (!d.transactions.length) return '';
  const days = lastBackup ? diffDays(lastBackup.slice(0, 10), todayISO()) : null;
  if (days != null && days <= 7) return '';
  return `
    <div class="banner banner-warn" role="note">
      ${icons.alert}
      <div>
        <strong>${days == null ? 'Você ainda não fez backup' : `Último backup há ${days} dias`}</strong>
        <p>Os dados ficam só neste iPhone. Salve uma cópia no app Arquivos/iCloud.</p>
      </div>
      <button type="button" class="btn btn-small" data-backup-now>Fazer backup</button>
    </div>`;
}

function upcomingHTML(d) {
  const items = upcomingBills(d);
  if (!items.length) return emptyState('Nada vencendo nos próximos 7 dias.', '✅');
  const today = todayISO();
  return `<ul class="bill-list">${items.map((it) => {
    const late = it.date < today;
    if (it.kind === 'invoice') {
      const inv = it.invoice;
      return `
        <li class="bill${late ? ' late' : ''}">
          <a class="tx-main" href="#cartoes/${encodeURIComponent(inv.card.id)}/${inv.ym}">
            <span class="tx-text">
              <span class="tx-desc">Fatura ${escapeHTML(inv.card.nome)}</span>
              <span class="tx-meta">${escapeHTML(dueLabel(it.date))} · ${formatDate(it.date)}</span>
            </span>
            <span class="tx-value neg">${formatBRL(it.valor)}</span>
          </a>
        </li>`;
    }
    const t = it.tx;
    const cat = d.catMap.get(t.categoryId);
    return `
      <li class="bill${late ? ' late' : ''}">
        <button type="button" class="tx-main" data-action="edit" data-id="${escapeHTML(t.id)}">
          <span class="tx-text">
            <span class="tx-desc">${escapeHTML(t.descricao)}</span>
            <span class="tx-meta">${escapeHTML(dueLabel(it.date))} · ${formatDate(it.date)}</span>
          </span>
          <span class="tx-value neg">${formatBRL(it.valor)}</span>
        </button>
        <button type="button" class="check" data-action="toggle-paid" data-id="${escapeHTML(t.id)}" aria-pressed="false" aria-label="Marcar ${escapeHTML(t.descricao)} como pago">${icons.check}</button>
      </li>`;
  }).join('')}</ul>`;
}

function categoryBars(monthTx, d) {
  const rows = spendingByCategory(monthTx, d.catMap);
  if (!rows.length) return emptyState('Sem despesas neste mês.', '📊');
  const total = sum(rows, (r) => r.valor);
  const max = rows[0].valor;
  return `<ul class="bars">${rows.map(({ cat, valor }) => {
    const pct = Math.round((valor / total) * 100);
    return `
      <li>
        <div class="bar-head">
          <span>${escapeHTML(cat ? cat.nome : 'Sem categoria')}</span>
          <span><strong>${formatBRL(valor)}</strong> <small>${pct}%</small></span>
        </div>
        <div class="bar-track"><span style="width:${((valor / max) * 100).toFixed(1)}%"></span></div>
      </li>`;
  }).join('')}</ul>`;
}
