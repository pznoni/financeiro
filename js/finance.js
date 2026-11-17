// finance.js — regras de negócio: resumos, saldos, cartões e faturas, parcelas e recorrências.
import { readAll, withTx, req2p, emitChange } from './db.js';
import {
  addDays, addMonths, addMonthsToDate, byId, currentMonth, dateInMonth, monthShort,
  pad, signed, sum, todayISO, uid,
} from './util.js';

export const MAX_PARCELAS = 48;

const byName = (a, b) => a.nome.localeCompare(b.nome, 'pt-BR');

/** Carrega todos os dados e monta mapas por id para consulta rápida. */
export async function loadAll() {
  const d = await readAll();
  d.categories.sort(byName);
  d.accounts.sort(byName);
  d.cards.sort(byName);
  d.catMap = byId(d.categories);
  d.accMap = byId(d.accounts);
  d.cardMap = byId(d.cards);
  return d;
}

// ---------- Resumos ----------

/** Pagamento de fatura é só movimentação de dinheiro: as compras já contaram como despesa. */
export const isInvoicePayment = (t) => Boolean(t.faturaPagamento);

export const inMonth = (txs, ym) => txs.filter((t) => t.data.slice(0, 7) === ym);

export function summarize(txs) {
  let receitas = 0;
  let despesas = 0;
  for (const t of txs) {
    if (isInvoicePayment(t)) continue;
    if (t.tipo === 'receita') receitas += t.valor;
    else despesas += t.valor;
  }
  return { receitas, despesas, saldo: receitas - despesas };
}

/** Total de despesas por categoria, do maior para o menor. */
export function spendingByCategory(txs, catMap) {
  const totals = new Map();
  for (const t of txs) {
    if (t.tipo !== 'despesa' || isInvoicePayment(t)) continue;
    const key = t.categoryId || '';
    totals.set(key, (totals.get(key) || 0) + t.valor);
  }
  return [...totals]
    .map(([id, valor]) => ({ cat: catMap.get(id) || null, valor }))
    .sort((a, b) => b.valor - a.valor);
}

/** Saldo de uma conta: saldo inicial + lançamentos (só pagos, por padrão) até a data. */
export function accountBalance(account, txs, { until = null, onlyPaid = true } = {}) {
  let total = account.saldoInicial || 0;
  for (const t of txs) {
    if (t.accountId !== account.id) continue;
    if (onlyPaid && !t.pago) continue;
    if (until && t.data > until) continue;
    total += signed(t);
  }
  return total;
}

/** Receita, despesa e saldo de cada mês do ano. */
export function yearSummary(txs, year) {
  return Array.from({ length: 12 }, (_, i) => {
    const ym = `${year}-${pad(i + 1)}`;
    return { ym, ...summarize(inMonth(txs, ym)) };
  });
}

// ---------- Cartões e faturas ----------
// A fatura é identificada pelo mês de VENCIMENTO ("YYYY-MM").

/** Dia de fechamento efetivo no mês (dia 31 vira 30/28 em meses curtos). */
function closingDay(card, ym) {
  return Number(dateInMonth(ym, card.fechamento).slice(8, 10));
}

/** Em qual fatura cai uma compra feita na data: compra após o fechamento vai para a seguinte. */
export function invoiceMonthFor(card, dateISO) {
  const ym = dateISO.slice(0, 7);
  const day = Number(dateISO.slice(8, 10));
  const closingMonth = day > closingDay(card, ym) ? addMonths(ym, 1) : ym;
  // Se vence antes (ou no mesmo dia) do fechamento, o vencimento é no mês seguinte.
  return card.vencimento > card.fechamento ? closingMonth : addMonths(closingMonth, 1);
}

/** Datas de fechamento e vencimento da fatura do mês `ym`. */
export function invoiceDates(card, ym) {
  const closingMonth = card.vencimento > card.fechamento ? ym : addMonths(ym, -1);
  return {
    fechamento: dateInMonth(closingMonth, card.fechamento),
    vencimento: dateInMonth(ym, card.vencimento),
  };
}

/** Fatura atualmente aberta (onde entraria uma compra feita hoje). */
export const currentInvoiceMonth = (card) => invoiceMonthFor(card, todayISO());

const cardAmount = (t) => (t.tipo === 'despesa' ? t.valor : -t.valor);

export function getInvoice(card, ym, txs, today = todayISO()) {
  const items = txs
    .filter((t) => t.cardId === card.id && t.fatura === ym)
    .sort((a, b) => a.data.localeCompare(b.data));
  const payments = txs.filter((t) => t.faturaPagamento?.cardId === card.id && t.faturaPagamento.mes === ym);
  const total = sum(items, cardAmount);
  const paid = sum(payments, (t) => t.valor);
  const remaining = Math.max(0, total - paid);
  const { fechamento, vencimento } = invoiceDates(card, ym);

  let status;
  if (total <= 0 && paid === 0) status = 'vazia';
  else if (remaining === 0) status = 'paga';
  else if (today > vencimento) status = 'atrasada';
  else if (today > fechamento) status = 'fechada';
  else status = 'aberta';

  return { card, ym, items, payments, total, paid, remaining, fechamento, vencimento, status };
}

export const INVOICE_STATUS = {
  vazia: 'Sem lançamentos',
  aberta: 'Aberta',
  fechada: 'Fechada',
  atrasada: 'Atrasada',
  paga: 'Paga',
};

/** Limite usado = tudo que foi comprado no cartão − tudo que já foi pago. */
export function cardUsage(card, txs) {
  const spent = sum(txs.filter((t) => t.cardId === card.id), cardAmount);
  const paid = sum(txs.filter((t) => t.faturaPagamento?.cardId === card.id), (t) => t.valor);
  const usado = Math.max(0, spent - paid);
  return { usado, disponivel: (card.limite || 0) - usado };
}

/** Faturas com saldo a pagar que vencem até o mês `ym` (inclui atrasadas). */
export function unpaidInvoicesUntil(d, ym) {
  const list = [];
  for (const card of d.cards) {
    const months = new Set(
      d.transactions.filter((t) => t.cardId === card.id && t.fatura <= ym).map((t) => t.fatura),
    );
    for (const m of months) {
      const inv = getInvoice(card, m, d.transactions);
      if (inv.remaining > 0) list.push(inv);
    }
  }
  return list.sort((a, b) => a.vencimento.localeCompare(b.vencimento));
}

/** Gera o pagamento da fatura (despesa na conta) e marca os itens como pagos se quitada. */
export function payInvoice({ card, ym, accountId, data, valor, quitada }) {
  return withTx('transactions', 'readwrite', async (s) => {
    if (quitada) {
      const items = await req2p(s.transactions.index('cardId').getAll(card.id));
      items.filter((t) => t.fatura === ym && !t.pago).forEach((t) => s.transactions.put({ ...t, pago: true }));
    }
    s.transactions.put({
      id: uid(),
      tipo: 'despesa',
      valor,
      data,
      descricao: `Fatura ${card.nome} (${monthShort(ym)})`,
      categoryId: null,
      accountId,
      cardId: null,
      pago: true,
      faturaPagamento: { cardId: card.id, mes: ym },
      criadoEm: new Date().toISOString(),
    });
  });
}

/** Exclui o cartão, suas compras e desativa recorrências ligadas a ele. */
export function deleteCard(cardId) {
  return withTx(['cards', 'transactions', 'recurring'], 'readwrite', async (s) => {
    const [items, recs] = await Promise.all([
      req2p(s.transactions.index('cardId').getAll(cardId)),
      req2p(s.recurring.getAll()),
    ]);
    items.forEach((t) => s.transactions.delete(t.id));
    recs.filter((r) => r.cardId === cardId).forEach((r) => s.recurring.put({ ...r, ativo: false }));
    s.cards.delete(cardId);
  });
}

// ---------- Lançamentos ----------

/** Divide um valor em n parcelas inteiras; a diferença de centavos vai para a 1ª. */
export function splitAmount(total, n) {
  const base = Math.floor(total / n);
  const parts = Array(n).fill(base);
  parts[0] += total - base * n;
  return parts;
}

/**
 * Monta os lançamentos de um formulário novo. No cartão, gera uma parcela por fatura
 * (todas com o mesmo groupId); em conta, um único lançamento.
 */
export function buildEntries({ tipo, valor, data, descricao, categoryId, accountId, card, parcelas = 1, pago = false }) {
  const base = { tipo, descricao, categoryId, criadoEm: new Date().toISOString() };
  if (!card) {
    return [{ ...base, id: uid(), valor, data, accountId, cardId: null, pago }];
  }
  const n = Math.max(1, Math.min(MAX_PARCELAS, Math.trunc(parcelas) || 1));
  const first = invoiceMonthFor(card, data);
  const groupId = n > 1 ? uid() : null;
  return splitAmount(valor, n).map((v, i) => ({
    ...base,
    id: uid(),
    valor: v,
    data: addMonthsToDate(data, i),
    accountId: null,
    cardId: card.id,
    fatura: addMonths(first, i),
    pago: false,
    ...(n > 1 ? { groupId, parcela: { n: i + 1, total: n } } : {}),
  }));
}

export function togglePaid(id) {
  return withTx('transactions', 'readwrite', async (s) => {
    const t = await req2p(s.transactions.get(id));
    if (!t) throw new Error('Lançamento não encontrado.');
    s.transactions.put({ ...t, pago: !t.pago });
    return !t.pago;
  });
}

/** Exclui um lançamento (ou todas as parcelas do grupo). Excluir um pagamento reabre a fatura. */
export function deleteTransaction(t, { wholeGroup = false } = {}) {
  return withTx('transactions', 'readwrite', async (s) => {
    if (wholeGroup && t.groupId) {
      const group = await req2p(s.transactions.index('groupId').getAll(t.groupId));
      group.forEach((g) => s.transactions.delete(g.id));
    } else {
      s.transactions.delete(t.id);
    }
    if (t.faturaPagamento) {
      const items = await req2p(s.transactions.index('cardId').getAll(t.faturaPagamento.cardId));
      items
        .filter((i) => i.fatura === t.faturaPagamento.mes && i.pago)
        .forEach((i) => s.transactions.put({ ...i, pago: false }));
    }
  });
}

// ---------- Contas fixas / recorrências ----------

const recurringTxId = (recId, ym) => `rec-${recId}-${ym}`;

function recurringToTx(r, ym, card) {
  const data = dateInMonth(ym, r.dia);
  const tx = {
    id: recurringTxId(r.id, ym),
    tipo: r.tipo,
    valor: r.valor,
    data,
    descricao: r.descricao,
    categoryId: r.categoryId,
    accountId: card ? null : r.accountId,
    cardId: card ? card.id : null,
    pago: false,
    recurringId: r.id,
    criadoEm: new Date().toISOString(),
  };
  if (card) tx.fatura = invoiceMonthFor(card, data);
  return tx;
}

/**
 * Gera os lançamentos pendentes das recorrências ativas para o mês. Idempotente:
 * cada recorrência guarda os meses já gerados (`gerados`) e o id do lançamento é
 * determinístico (recurringId + mês). Assim, abrir o mês de novo não duplica, e um
 * lançamento excluído pelo usuário não volta.
 */
export async function generateRecurring(ym) {
  const created = await withTx(['recurring', 'transactions', 'cards'], 'readwrite', async (s) => {
    const [recs, cards] = await Promise.all([req2p(s.recurring.getAll()), req2p(s.cards.getAll())]);
    const cardMap = byId(cards);
    let count = 0;
    for (const r of recs) {
      const gerados = r.gerados || [];
      if (!r.ativo || (r.inicio && ym < r.inicio) || gerados.includes(ym)) continue;
      const card = r.cardId ? cardMap.get(r.cardId) : null;
      if (r.cardId && !card) continue;
      s.transactions.put(recurringToTx(r, ym, card));
      s.recurring.put({ ...r, gerados: [...gerados, ym] });
      count++;
    }
    return count;
  }, { silent: true });
  if (created) emitChange();
  return created;
}

/**
 * Salva a recorrência. Na edição, atualiza também os lançamentos já gerados
 * deste mês em diante que ainda não foram pagos.
 */
export function saveRecurring(r, cardMap) {
  return withTx(['recurring', 'transactions'], 'readwrite', async (s) => {
    s.recurring.put(r);
    const generated = await req2p(s.transactions.index('recurringId').getAll(r.id));
    const from = currentMonth();
    for (const t of generated) {
      const ym = t.data.slice(0, 7);
      if (t.pago || ym < from || t.id !== recurringTxId(r.id, ym)) continue;
      const card = r.cardId ? cardMap.get(r.cardId) : null;
      s.transactions.put({ ...recurringToTx(r, ym, card), criadoEm: t.criadoEm });
    }
  });
}

// ---------- Próximos vencimentos ----------

/** Despesas não pagas e faturas com vencimento até `days` dias (inclui atrasadas recentes). */
export function upcomingBills(d, today = todayISO(), days = 7) {
  const limit = addDays(today, days);
  const from = addDays(today, -60);
  const items = [];

  for (const t of d.transactions) {
    if (t.tipo !== 'despesa' || t.pago || t.cardId || t.data > limit || t.data < from) continue;
    items.push({ kind: 'tx', date: t.data, valor: t.valor, tx: t });
  }

  const cm = today.slice(0, 7);
  for (const card of d.cards) {
    for (const m of [addMonths(cm, -1), cm, addMonths(cm, 1)]) {
      const inv = getInvoice(card, m, d.transactions, today);
      if (inv.remaining > 0 && inv.vencimento <= limit && inv.vencimento >= from) {
        items.push({ kind: 'invoice', date: inv.vencimento, valor: inv.remaining, invoice: inv });
      }
    }
  }
  return items.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Exclui a recorrência. Com `removePending`, apaga também os lançamentos gerados
 * por ela, deste mês em diante, que ainda não foram pagos.
 */
export function deleteRecurring(recId, { removePending = false } = {}) {
  return withTx(['recurring', 'transactions'], 'readwrite', async (s) => {
    if (removePending) {
      const from = currentMonth();
      const generated = await req2p(s.transactions.index('recurringId').getAll(recId));
      generated
        .filter((t) => !t.pago && t.data.slice(0, 7) >= from)
        .forEach((t) => s.transactions.delete(t.id));
    }
    s.recurring.delete(recId);
  });
}

// ---------- Categorias e contas ----------

/** Exclui a categoria; lançamentos e recorrências que a usavam ficam "Sem categoria". */
export function deleteCategory(catId) {
  return withTx(['categories', 'transactions', 'recurring'], 'readwrite', async (s) => {
    const [txs, recs] = await Promise.all([
      req2p(s.transactions.index('categoryId').getAll(catId)),
      req2p(s.recurring.getAll()),
    ]);
    txs.forEach((t) => s.transactions.put({ ...t, categoryId: null }));
    recs.filter((r) => r.categoryId === catId).forEach((r) => s.recurring.put({ ...r, categoryId: null }));
    s.categories.delete(catId);
  });
}

/** Exclui a conta apenas se nada a referencia (evita lançamentos órfãos). */
export function deleteAccount(accId) {
  return withTx(['accounts', 'transactions', 'recurring'], 'readwrite', async (s) => {
    const [txs, recs] = await Promise.all([req2p(s.transactions.getAll()), req2p(s.recurring.getAll())]);
    const used = txs.filter((t) => t.accountId === accId).length;
    if (used) throw new Error(`Esta conta tem ${used} lançamento${used > 1 ? 's' : ''}. Exclua ou mova os lançamentos antes.`);
    if (recs.some((r) => r.accountId === accId)) throw new Error('Esta conta é usada por uma conta fixa. Altere a conta fixa antes.');
    s.accounts.delete(accId);
  });
}
