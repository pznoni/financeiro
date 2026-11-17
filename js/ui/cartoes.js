// cartoes.js — cartões de crédito: lista com limite e tela de fatura por mês (#cartoes/<id>/<YYYY-MM>).
import { put } from '../db.js';
import {
  INVOICE_STATUS, cardUsage, currentInvoiceMonth, deleteCard, getInvoice, loadAll, payInvoice,
} from '../finance.js';
import {
  addMonths, centsToInput, escapeHTML, formatBRL, formatDate, isISODate, isMonth, monthLabel,
  monthShort, parseMoney, todayISO, uid,
} from '../util.js';
import {
  $, confirmDialog, emptyState, icons, openSheet, originOptions, parseOrigin,
  progressBar, showError, toast, transactionRow,
} from './components.js';
import { bindTransactionActions, openTransactionForm } from './form-lancamento.js';

export async function render(root, ctx) {
  const [cardId, ym] = ctx.params;
  if (cardId) return renderInvoice(root, ctx, decodeURIComponent(cardId), ym);
  return renderList(root);
}

// ---------- Lista de cartões ----------

async function renderList(root) {
  const d = await loadAll();
  root.innerHTML = `
    <header class="view-header">
      <h1>Cartões</h1>
      <button type="button" class="icon-btn" data-new-card aria-label="Novo cartão">${icons.plus}</button>
    </header>
    ${d.cards.length ? `<ul class="card-list">${d.cards.map((c) => cardItem(c, d)).join('')}</ul>`
      : `${emptyState('Nenhum cartão cadastrado.', '💳')}
         <button type="button" class="btn btn-primary btn-block" data-new-card>Cadastrar cartão</button>`}`;

  root.addEventListener('click', (ev) => {
    if (ev.target.closest('[data-new-card]')) openCardForm(null);
  });
}

function cardItem(card, d) {
  const { usado, disponivel } = cardUsage(card, d.transactions);
  const inv = getInvoice(card, currentInvoiceMonth(card), d.transactions);
  return `
    <li>
      <a class="credit-card" href="#cartoes/${encodeURIComponent(card.id)}/${inv.ym}">
        <div class="cc-top">
          <strong>${escapeHTML(card.nome)}</strong>
          <span class="badge badge-${inv.status}">${INVOICE_STATUS[inv.status]}</span>
        </div>
        <div class="cc-invoice">
          <span>Fatura de ${monthShort(inv.ym)}</span>
          <strong>${formatBRL(inv.total)}</strong>
          <small>fecha ${formatDate(inv.fechamento)} · vence ${formatDate(inv.vencimento)}</small>
        </div>
        ${progressBar(usado, card.limite, { label: 'Limite usado', danger: disponivel < 0 })}
        <div class="cc-limit">
          <span>Usado ${formatBRL(usado)}</span>
          <span class="${disponivel < 0 ? 'neg' : ''}">Disponível ${formatBRL(disponivel)}</span>
        </div>
      </a>
    </li>`;
}

// ---------- Fatura ----------

async function renderInvoice(root, ctx, cardId, ymParam) {
  const d = await loadAll();
  const card = d.cardMap.get(cardId);
  if (!card) {
    root.innerHTML = `${backHeader('Cartão')}${emptyState('Cartão não encontrado.', '🔍')}`;
    return;
  }
  const ym = isMonth(ymParam) ? ymParam : currentInvoiceMonth(card);
  const inv = getInvoice(card, ym, d.transactions);
  const { usado, disponivel } = cardUsage(card, d.transactions);
  const base = `#cartoes/${encodeURIComponent(card.id)}`;

  root.innerHTML = `
    ${backHeader(card.nome, `<button type="button" class="icon-btn" data-edit-card aria-label="Editar cartão">${icons.edit}</button>`)}
    <div class="month-switcher">
      <a class="icon-btn" href="${base}/${addMonths(ym, -1)}" aria-label="Fatura anterior">${icons.left}</a>
      <span class="month-label">Fatura de ${escapeHTML(monthLabel(ym))}</span>
      <a class="icon-btn" href="${base}/${addMonths(ym, 1)}" aria-label="Próxima fatura">${icons.right}</a>
    </div>

    <section class="panel invoice">
      <div class="invoice-total">
        <span class="badge badge-${inv.status}">${INVOICE_STATUS[inv.status]}</span>
        <strong>${formatBRL(inv.total)}</strong>
      </div>
      <dl class="kv">
        <div><dt>Fechamento</dt><dd>${formatDate(inv.fechamento)}</dd></div>
        <div><dt>Vencimento</dt><dd>${formatDate(inv.vencimento)}</dd></div>
        ${inv.paid ? `<div><dt>Pago</dt><dd class="pos">${formatBRL(inv.paid)}</dd></div>` : ''}
        ${inv.paid && inv.remaining ? `<div><dt>Falta pagar</dt><dd class="neg">${formatBRL(inv.remaining)}</dd></div>` : ''}
      </dl>
      <div class="btn-row">
        <button type="button" class="btn btn-secondary" data-new-purchase>${icons.plus} Compra</button>
        ${inv.remaining > 0 ? '<button type="button" class="btn btn-primary" data-pay>Pagar fatura</button>' : ''}
      </div>
    </section>

    <section class="panel">
      <h2>Limite</h2>
      ${progressBar(usado, card.limite, { label: 'Limite usado', danger: disponivel < 0 })}
      <div class="cc-limit">
        <span>Usado ${formatBRL(usado)}</span>
        <span class="${disponivel < 0 ? 'neg' : ''}">Disponível ${formatBRL(disponivel)}</span>
      </div>
      <p class="hint">Limite total ${formatBRL(card.limite)}</p>
    </section>

    <section class="panel">
      <h2>Lançamentos <small>${inv.items.length}</small></h2>
      ${inv.items.length
        ? `<ul class="tx-list">${inv.items.map((t) => transactionRow(t, d, { toggle: false, showDate: true })).join('')}</ul>`
        : emptyState('Nenhuma compra nesta fatura.', '🧾')}
    </section>

    ${inv.payments.length ? `
    <section class="panel">
      <h2>Pagamentos</h2>
      <ul class="tx-list">${inv.payments.map((t) => transactionRow(t, d, { toggle: false, showDate: true })).join('')}</ul>
    </section>` : ''}`;

  bindTransactionActions(root);
  root.addEventListener('click', (ev) => {
    if (ev.target.closest('[data-edit-card]')) openCardForm(card, ctx);
    if (ev.target.closest('[data-new-purchase]')) openTransactionForm({ defaults: { cardId: card.id, data: purchaseDateFor(inv) } });
    if (ev.target.closest('[data-pay]')) openPaySheet(inv, d);
  });
}

/** Data sugerida para nova compra: hoje na fatura atual; nas outras, o dia do fechamento (cai nela). */
function purchaseDateFor(inv) {
  return inv.ym === currentInvoiceMonth(inv.card) ? todayISO() : inv.fechamento;
}

function backHeader(title, actions = '') {
  return `
    <header class="view-header">
      <a class="back" href="#cartoes" aria-label="Voltar para cartões">${icons.left}<span>Cartões</span></a>
      <h1 class="h-center">${escapeHTML(title)}</h1>
      <div class="header-actions">${actions}</div>
    </header>`;
}

// ---------- Pagar fatura ----------

function openPaySheet(inv, d) {
  if (!d.accounts.length) {
    toast('Cadastre uma conta em Ajustes antes de pagar.', { type: 'error' });
    return;
  }
  const today = todayISO();
  const sheet = openSheet({
    title: `Pagar fatura ${monthShort(inv.ym)}`,
    content: `
      <form class="form" novalidate>
        <p class="dialog-text">${escapeHTML(inv.card.nome)} · vence ${formatDate(inv.vencimento)}</p>
        <label class="field field-money">
          <span>Valor</span>
          <input name="valor" inputmode="decimal" autocomplete="off" value="${centsToInput(inv.remaining)}" required>
        </label>
        <div class="row2">
          <label class="field"><span>Data</span><input name="data" type="date" value="${today}" required></label>
          <label class="field"><span>Conta</span><select name="origem">${originOptions(d, '', { allowCards: false })}</select></label>
        </div>
        <p class="hint">Gera uma despesa na conta escolhida. Ela não conta de novo como gasto: as compras já foram somadas.</p>
        <p class="form-error" role="alert" hidden></p>
        <div class="form-actions"><button type="submit" class="btn btn-primary">Confirmar pagamento</button></div>
      </form>`,
  });
  const form = $('form', sheet.body);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const err = $('.form-error', form);
    const valor = parseMoney(form.valor.value);
    if (!(valor > 0)) { err.textContent = 'Informe um valor maior que zero.'; err.hidden = false; return; }
    if (!isISODate(form.data.value)) { err.textContent = 'Informe uma data válida.'; err.hidden = false; return; }
    const { accountId } = parseOrigin(form.origem.value);
    try {
      await payInvoice({
        card: inv.card, ym: inv.ym, accountId, data: form.data.value, valor, quitada: valor >= inv.remaining,
      });
      toast(valor >= inv.remaining ? 'Fatura paga!' : 'Pagamento parcial registrado.', { type: 'success' });
      sheet.close();
    } catch (e) {
      showError(e);
    }
  });
}

// ---------- Cadastro de cartão ----------

function dayOptions(selected) {
  return Array.from({ length: 31 }, (_, i) => i + 1)
    .map((n) => `<option value="${n}"${n === selected ? ' selected' : ''}>${n}</option>`).join('');
}

export function openCardForm(card, ctx) {
  const c = card || { nome: '', limite: 0, fechamento: 1, vencimento: 10, cor: '#6366f1' };
  const sheet = openSheet({
    title: card ? 'Editar cartão' : 'Novo cartão',
    content: `
      <form class="form" novalidate>
        <label class="field"><span>Nome</span>
          <input name="nome" type="text" maxlength="40" required placeholder="Ex.: Nubank" value="${escapeHTML(c.nome)}" autocomplete="off">
        </label>
        <label class="field field-money"><span>Limite</span>
          <input name="limite" inputmode="decimal" autocomplete="off" placeholder="0,00" value="${card ? centsToInput(c.limite) : ''}">
        </label>
        <div class="row2">
          <label class="field"><span>Dia de fechamento</span><select name="fechamento">${dayOptions(c.fechamento)}</select></label>
          <label class="field"><span>Dia de vencimento</span><select name="vencimento">${dayOptions(c.vencimento)}</select></label>
        </div>
        <p class="hint">Compras feitas depois do dia de fechamento entram na fatura seguinte.</p>
        <p class="form-error" role="alert" hidden></p>
        <div class="form-actions">
          ${card ? '<button type="button" class="btn btn-danger-ghost" data-delete>Excluir</button>' : ''}
          <button type="submit" class="btn btn-primary">Salvar</button>
        </div>
      </form>`,
  });
  const form = $('form', sheet.body);

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const err = $('.form-error', form);
    const nome = form.nome.value.trim();
    const limite = form.limite.value.trim() ? parseMoney(form.limite.value) : 0;
    if (!nome) { err.textContent = 'Informe o nome do cartão.'; err.hidden = false; form.nome.focus(); return; }
    if (!(limite >= 0)) { err.textContent = 'Limite inválido.'; err.hidden = false; form.limite.focus(); return; }
    const saved = {
      ...c,
      id: card?.id || uid(),
      nome,
      limite,
      fechamento: Number(form.fechamento.value),
      vencimento: Number(form.vencimento.value),
    };
    try {
      await put('cards', saved);
      toast(card ? 'Cartão atualizado.' : 'Cartão cadastrado.', { type: 'success' });
      sheet.close();
      if (card && (card.fechamento !== saved.fechamento || card.vencimento !== saved.vencimento)) {
        toast('As compras já lançadas continuam nas faturas originais.', { duration: 4500 });
      }
    } catch (e) {
      showError(e);
    }
  });

  $('[data-delete]', form)?.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Excluir cartão?',
      message: `"${card.nome}" e todas as compras lançadas nele serão excluídos. Pagamentos de fatura já feitos continuam nas contas.`,
      confirmLabel: 'Excluir cartão',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteCard(card.id);
      sheet.close();
      toast('Cartão excluído.', { type: 'success' });
      ctx?.go('#cartoes');
    } catch (e) {
      showError(e);
    }
  });
}
