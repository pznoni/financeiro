// lancamentos.js — lista do mês agrupada por dia, com busca e filtros.
import { inMonth, isInvoicePayment, loadAll } from '../finance.js';
import { state } from '../state.js';
import { dayHeader, debounce, escapeHTML, formatBRL, normalize, signed, sum } from '../util.js';
import {
  $, $$, bindMonthSwitcher, emptyState, icons, monthSwitcher, moneyClass, transactionRow,
} from './components.js';
import { bindTransactionActions } from './form-lancamento.js';

// Filtros persistem enquanto o app está aberto (sobrevivem ao redesenho da tela).
const filters = { q: '', tipo: 'todos', cat: '' };

const TIPOS = [
  { value: 'todos', label: 'Todos' },
  { value: 'despesa', label: 'Despesas' },
  { value: 'receita', label: 'Receitas' },
  { value: 'pendente', label: 'Pendentes' },
];

export async function render(root) {
  const ym = state.month;
  const d = await loadAll();
  const monthTx = inMonth(d.transactions, ym);

  root.innerHTML = `
    <header class="view-header"><h1>Lançamentos</h1></header>
    ${monthSwitcher(ym)}
    <div class="filters">
      <label class="search">
        ${icons.search}
        <span class="visually-hidden">Buscar lançamentos</span>
        <input type="search" placeholder="Buscar" value="${escapeHTML(filters.q)}" autocomplete="off" enterkeyhint="search">
      </label>
      <div class="chips" role="group" aria-label="Filtrar por tipo">
        ${TIPOS.map((t) => `<button type="button" class="chip" data-tipo="${t.value}" aria-pressed="${filters.tipo === t.value}">${t.label}</button>`).join('')}
      </div>
      <label class="field field-compact">
        <span class="visually-hidden">Filtrar por categoria</span>
        <select data-filter-cat>
          <option value="">Todas as categorias</option>
          ${d.categories.map((c) => `<option value="${escapeHTML(c.id)}"${filters.cat === c.id ? ' selected' : ''}>${escapeHTML(c.nome)}</option>`).join('')}
        </select>
      </label>
    </div>
    <p class="list-summary" data-summary aria-live="polite"></p>
    <div data-list></div>`;

  const list = $('[data-list]', root);
  const summaryEl = $('[data-summary]', root);

  function draw() {
    const items = applyFilters(monthTx, d);
    const receitas = sum(items.filter((t) => t.tipo === 'receita' && !isInvoicePayment(t)), (t) => t.valor);
    const despesas = sum(items.filter((t) => t.tipo === 'despesa' && !isInvoicePayment(t)), (t) => t.valor);
    summaryEl.innerHTML = items.length
      ? `${items.length} lançamento${items.length > 1 ? 's' : ''} · <span class="pos">+${formatBRL(receitas)}</span> · <span class="neg">−${formatBRL(despesas)}</span>`
      : '';
    list.innerHTML = items.length
      ? groupByDay(items).map(([day, txs]) => dayGroup(day, txs, d)).join('')
      : emptyState(monthTx.length ? 'Nenhum lançamento com esses filtros.' : 'Nenhum lançamento neste mês. Toque em + para adicionar.');
  }

  $('input[type=search]', root).addEventListener('input', debounce((ev) => {
    filters.q = ev.target.value;
    draw();
  }, 150));
  $('[data-filter-cat]', root).addEventListener('change', (ev) => {
    filters.cat = ev.target.value;
    draw();
  });
  $('.chips', root).addEventListener('click', (ev) => {
    const chip = ev.target.closest('[data-tipo]');
    if (!chip) return;
    filters.tipo = chip.dataset.tipo;
    $$('.chip', root).forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
    draw();
  });

  bindMonthSwitcher(root);
  bindTransactionActions(list);
  draw();
}

function applyFilters(txs, d) {
  const q = normalize(filters.q.trim());
  return txs.filter((t) => {
    if (filters.tipo === 'pendente' && (t.pago || t.cardId)) return false;
    if ((filters.tipo === 'despesa' || filters.tipo === 'receita') && t.tipo !== filters.tipo) return false;
    if (filters.cat && t.categoryId !== filters.cat) return false;
    if (q) {
      const haystack = normalize([
        t.descricao,
        d.catMap.get(t.categoryId)?.nome,
        d.accMap.get(t.accountId)?.nome,
        d.cardMap.get(t.cardId)?.nome,
      ].join(' '));
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

/** [[dia, lançamentos], ...] do dia mais recente para o mais antigo. */
function groupByDay(txs) {
  const groups = new Map();
  [...txs]
    .sort((a, b) => b.data.localeCompare(a.data) || (b.criadoEm || '').localeCompare(a.criadoEm || ''))
    .forEach((t) => {
      if (!groups.has(t.data)) groups.set(t.data, []);
      groups.get(t.data).push(t);
    });
  return [...groups];
}

function dayGroup(day, txs, d) {
  const net = sum(txs.filter((t) => !isInvoicePayment(t)), signed);
  return `
    <section class="day">
      <h3 class="day-header">
        <span>${escapeHTML(dayHeader(day))}</span>
        <span class="${moneyClass(net)}">${formatBRL(net)}</span>
      </h3>
      <ul class="tx-list">${txs.map((t) => transactionRow(t, d)).join('')}</ul>
    </section>`;
}
