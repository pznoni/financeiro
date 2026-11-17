// form-lancamento.js — bottom sheet de novo lançamento / edição, e ações comuns das listas.
import { get, put, putMany } from '../db.js';
import {
  MAX_PARCELAS, buildEntries, deleteTransaction, invoiceDates, invoiceMonthFor, loadAll,
  splitAmount, togglePaid,
} from '../finance.js';
import { state } from '../state.js';
import {
  centsToInput, currentMonth, dateInMonth, escapeHTML, formatBRL, formatDateShort, isISODate,
  monthShort, parseMoney, todayISO,
} from '../util.js';
import {
  $, categoryOptions, choiceDialog, confirmDialog, openSheet, originOptions, parseOrigin,
  showError, toast,
} from './components.js';

/** Data padrão para um lançamento novo: hoje, ou o dia 1 se estiver vendo outro mês. */
function defaultDate() {
  return state.month === currentMonth() ? todayISO() : dateInMonth(state.month, 1);
}

/**
 * Abre o formulário.
 * - openTransactionForm()                    → novo lançamento
 * - openTransactionForm({ id })              → edição
 * - openTransactionForm({ defaults: {...} }) → novo com valores sugeridos (ex.: cardId)
 */
export async function openTransactionForm({ id = null, defaults = {} } = {}) {
  let d;
  let t = null;
  try {
    d = await loadAll();
    if (id) {
      t = await get('transactions', id);
      if (!t) throw new Error('Lançamento não encontrado.');
    }
  } catch (err) {
    showError(err);
    return;
  }

  const isEdit = Boolean(t);
  const isPayment = Boolean(t?.faturaPagamento);
  const isInstallment = Boolean(t?.parcela);
  const v = t || {
    tipo: defaults.tipo || 'despesa',
    valor: null,
    data: defaults.data || defaultDate(),
    descricao: '',
    categoryId: defaults.categoryId || null,
    accountId: defaults.cardId ? null : defaults.accountId || d.accounts[0]?.id || null,
    cardId: defaults.cardId || null,
    pago: defaults.pago ?? true,
  };
  const origin = v.cardId ? `card:${v.cardId}` : v.accountId ? `acc:${v.accountId}` : '';

  const title = isPayment ? 'Pagamento de fatura' : isEdit ? 'Editar lançamento' : 'Novo lançamento';
  const sheet = openSheet({ title, content: formHTML() });
  const form = $('form', sheet.body);

  function formHTML() {
    const parcelOpts = Array.from({ length: MAX_PARCELAS }, (_, i) => i + 1)
      .map((n) => `<option value="${n}">${n === 1 ? 'À vista' : `${n}×`}</option>`).join('');
    return `
      <form class="form" novalidate>
        ${isPayment ? '' : `
        <div class="segmented" role="radiogroup" aria-label="Tipo de lançamento">
          <label><input type="radio" name="tipo" value="despesa"${v.tipo === 'despesa' ? ' checked' : ''}><span>Despesa</span></label>
          <label><input type="radio" name="tipo" value="receita"${v.tipo === 'receita' ? ' checked' : ''}><span>Receita</span></label>
        </div>`}

        <label class="field field-money">
          <span>Valor${isInstallment ? ' da parcela' : ''}</span>
          <input name="valor" inputmode="decimal" autocomplete="off" placeholder="0,00" required
            value="${escapeHTML(v.valor != null ? centsToInput(v.valor) : '')}" enterkeyhint="next">
        </label>

        <label class="field">
          <span>Descrição</span>
          <input name="descricao" type="text" maxlength="80" autocomplete="off" autocapitalize="sentences"
            placeholder="Ex.: Mercado" value="${escapeHTML(v.descricao)}" enterkeyhint="done">
        </label>

        <div class="row2">
          <label class="field">
            <span>Data</span>
            <input name="data" type="date" required value="${escapeHTML(v.data)}">
          </label>
          ${isPayment ? '' : `
          <label class="field">
            <span>Categoria</span>
            <select name="categoryId" required></select>
          </label>`}
        </div>

        <label class="field">
          <span>${isPayment ? 'Pago com a conta' : 'Conta ou cartão'}</span>
          <select name="origem" required${isInstallment ? ' disabled' : ''}></select>
        </label>

        <div class="card-only" hidden>
          ${isEdit ? '' : `
          <label class="field">
            <span>Parcelas</span>
            <select name="parcelas">${parcelOpts}</select>
          </label>`}
          <p class="hint" data-invoice-hint aria-live="polite"></p>
        </div>

        <label class="toggle account-only">
          <input type="checkbox" name="pago"${v.pago ? ' checked' : ''}>
          <span class="toggle-ui" aria-hidden="true"></span>
          <span data-paid-label>Pago</span>
        </label>

        <p class="form-error" role="alert" hidden></p>

        <div class="form-actions">
          ${isEdit ? '<button type="button" class="btn btn-danger-ghost" data-delete>Excluir</button>' : ''}
          <button type="submit" class="btn btn-primary">Salvar</button>
        </div>
      </form>`;
  }

  const tipo = () => (isPayment ? 'despesa' : form.tipo.value);

  function refreshOptions() {
    if (!isPayment) {
      // Ao trocar receita/despesa, não mantém uma categoria do outro tipo.
      const prev = form.categoryId.value || v.categoryId;
      const current = d.catMap.get(prev)?.tipo === tipo() ? prev : null;
      form.categoryId.innerHTML = categoryOptions(d.categories, tipo(), current);
      if (!form.categoryId.value && form.categoryId.options.length) form.categoryId.selectedIndex = 0;
    }
    const selected = form.origem.value || origin;
    // Cartão só aceita despesas (e pagamentos saem sempre de uma conta).
    const allowCards = tipo() === 'despesa' && !isPayment;
    form.origem.innerHTML = originOptions(d, selected, { allowCards });
    if (!form.origem.value && form.origem.options.length) form.origem.selectedIndex = 0;
    refreshOriginUI();
  }

  function selectedCard() {
    const { cardId } = parseOrigin(form.origem.value);
    return cardId ? d.cardMap.get(cardId) : null;
  }

  function refreshOriginUI() {
    const card = selectedCard();
    $('.card-only', form).hidden = !card;
    $('.account-only', form).hidden = Boolean(card);
    $('[data-paid-label]', form).textContent = tipo() === 'receita' ? 'Recebido' : 'Pago';
    if (!card) return;

    const date = isISODate(form.data.value) ? form.data.value : todayISO();
    const n = Number(form.parcelas?.value || 1);
    // Na edição de parcela, a fatura acompanha a data escolhida.
    const fatura = invoiceMonthFor(card, date);
    const { vencimento } = invoiceDates(card, fatura);
    let hint = `Entra na fatura de ${monthShort(fatura)} (vence ${formatDateShort(vencimento)}).`;
    const cents = parseMoney(form.valor.value);
    if (n > 1 && cents > 0) {
      const parts = splitAmount(cents, n);
      hint = `${n}× de ${formatBRL(parts[parts.length - 1])}${parts[0] !== parts[parts.length - 1] ? ` (1ª: ${formatBRL(parts[0])})` : ''}. 1ª parcela na fatura de ${monthShort(fatura)}.`;
    }
    if (isInstallment) hint = `Parcela ${t.parcela.n}/${t.parcela.total} · ${hint}`;
    $('[data-invoice-hint]', form).textContent = hint;
  }

  function fail(msg, field) {
    const el = $('.form-error', form);
    el.textContent = msg;
    el.hidden = false;
    field?.focus();
  }

  refreshOptions();
  form.addEventListener('change', (ev) => {
    if (ev.target.name === 'tipo') refreshOptions();
    else refreshOriginUI();
  });
  form.valor.addEventListener('input', refreshOriginUI);

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const valor = parseMoney(form.valor.value);
    if (!(valor > 0)) return fail('Informe um valor maior que zero.', form.valor);
    const data = form.data.value;
    if (!isISODate(data)) return fail('Informe uma data válida.', form.data);
    const { accountId, cardId } = parseOrigin(isInstallment ? origin : form.origem.value);
    if (!accountId && !cardId) return fail('Escolha uma conta ou cartão. Cadastre uma em Ajustes.', form.origem);
    const categoryId = isPayment ? null : form.categoryId.value || null;
    const cat = d.catMap.get(categoryId);
    const descricao = form.descricao.value.trim() || cat?.nome || 'Lançamento';
    const card = cardId ? d.cardMap.get(cardId) : null;
    const pago = card ? false : form.pago.checked;

    const submit = $('[type=submit]', form);
    submit.disabled = true;
    try {
      if (isEdit) {
        const updated = { ...t, tipo: tipo(), valor, data, descricao, categoryId, accountId, cardId, pago: card ? t.pago && t.cardId === cardId : pago };
        if (card) updated.fatura = invoiceMonthFor(card, data);
        else delete updated.fatura;
        await put('transactions', updated);
        toast('Lançamento atualizado.', { type: 'success' });
      } else {
        const entries = buildEntries({
          tipo: tipo(), valor, data, descricao, categoryId, accountId, card,
          parcelas: Number(form.parcelas?.value || 1), pago,
        });
        await putMany('transactions', entries);
        toast(entries.length > 1 ? `${entries.length} parcelas lançadas.` : 'Lançamento salvo.', { type: 'success' });
      }
      sheet.close();
    } catch (err) {
      submit.disabled = false;
      showError(err);
    }
  });

  $('[data-delete]', form)?.addEventListener('click', async () => {
    const removed = await askDelete(t);
    if (removed) sheet.close();
  });
}

/** Confirma e exclui. Em parcelas, pergunta se é só esta ou todas. */
export async function askDelete(t) {
  let wholeGroup = false;
  if (t.groupId && t.parcela) {
    const choice = await choiceDialog({
      title: 'Excluir parcela',
      message: `"${t.descricao}" tem ${t.parcela.total} parcelas.`,
      options: [
        { label: 'Excluir só esta parcela', value: 'one', danger: true },
        { label: `Excluir as ${t.parcela.total} parcelas`, value: 'all', danger: true },
      ],
    });
    if (!choice) return false;
    wholeGroup = choice === 'all';
  } else {
    const ok = await confirmDialog({
      title: 'Excluir lançamento?',
      message: t.faturaPagamento
        ? 'A fatura voltará a ficar em aberto.'
        : `"${t.descricao}" de ${formatBRL(t.valor)} será excluído.`,
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (!ok) return false;
  }
  try {
    await deleteTransaction(t, { wholeGroup });
    toast(wholeGroup ? 'Parcelas excluídas.' : 'Lançamento excluído.', { type: 'success' });
    return true;
  } catch (err) {
    showError(err);
    return false;
  }
}

/** Liga os botões data-action="edit" e "toggle-paid" de uma lista. */
export function bindTransactionActions(root) {
  root.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-action]');
    if (!btn || !root.contains(btn)) return;
    const { action, id } = btn.dataset;
    if (action === 'edit') openTransactionForm({ id });
    if (action === 'toggle-paid') {
      btn.disabled = true;
      try {
        const nowPaid = await togglePaid(id);
        toast(nowPaid ? 'Marcado como pago.' : 'Marcado como pendente.', { duration: 1800 });
      } catch (err) {
        btn.disabled = false;
        showError(err);
      }
    }
  });
}
