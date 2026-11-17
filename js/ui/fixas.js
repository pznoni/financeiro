// fixas.js — contas fixas / recorrentes (aluguel, internet, assinaturas, salário).
import { deleteRecurring, generateRecurring, loadAll, saveRecurring } from '../finance.js';
import { state } from '../state.js';
import { centsToInput, escapeHTML, formatBRL, parseMoney, sum, uid, currentMonth } from '../util.js';
import {
  $, catIcon, categoryOptions, choiceDialog, emptyState, icons, openSheet, originOptions,
  parseOrigin, showError, toast,
} from './components.js';

export async function render(root) {
  const d = await loadAll();
  const recs = [...d.recurring].sort((a, b) => a.dia - b.dia || a.descricao.localeCompare(b.descricao, 'pt-BR'));
  const ativas = recs.filter((r) => r.ativo);
  const pausadas = recs.filter((r) => !r.ativo);
  const totalDesp = sum(ativas.filter((r) => r.tipo === 'despesa'), (r) => r.valor);
  const totalRec = sum(ativas.filter((r) => r.tipo === 'receita'), (r) => r.valor);

  root.innerHTML = `
    <header class="view-header">
      <h1>Contas fixas</h1>
      <button type="button" class="icon-btn" data-new aria-label="Nova conta fixa">${icons.plus}</button>
    </header>
    ${recs.length ? `
      <section class="summary-grid" aria-label="Total mensal das contas fixas ativas">
        <div class="stat"><span class="stat-label">Receitas fixas</span><strong class="stat-value pos">${formatBRL(totalRec)}</strong></div>
        <div class="stat"><span class="stat-label">Despesas fixas</span><strong class="stat-value neg">${formatBRL(totalDesp)}</strong></div>
      </section>
      ${group('Ativas', ativas, d)}
      ${group('Pausadas', pausadas, d)}
      <p class="hint center">Os lançamentos são criados automaticamente quando você abre cada mês.</p>`
    : `${emptyState('Cadastre aluguel, internet, assinaturas e salário. Eles entram sozinhos em cada mês.', '🔁')}
       <button type="button" class="btn btn-primary btn-block" data-new>Nova conta fixa</button>`}`;

  root.addEventListener('click', (ev) => {
    if (ev.target.closest('[data-new]')) openRecurringForm(null, d);
    const item = ev.target.closest('[data-rec]');
    if (item) openRecurringForm(d.recurring.find((r) => r.id === item.dataset.rec), d);
  });
}

function group(title, list, d) {
  if (!list.length) return '';
  return `
    <section class="panel">
      <h2>${title} <small>${list.length}</small></h2>
      <ul class="tx-list">${list.map((r) => {
        const cat = d.catMap.get(r.categoryId);
        const where = r.cardId ? d.cardMap.get(r.cardId)?.nome : d.accMap.get(r.accountId)?.nome;
        const meta = [`todo dia ${r.dia}`, cat?.nome || 'Sem categoria', where].filter(Boolean);
        return `
          <li class="tx${r.ativo ? '' : ' is-paused'}">
            <button type="button" class="tx-main" data-rec="${escapeHTML(r.id)}">
              ${catIcon(cat)}
              <span class="tx-text">
                <span class="tx-desc">${escapeHTML(r.descricao)}</span>
                <span class="tx-meta">${meta.map(escapeHTML).join(' · ')}</span>
              </span>
              <span class="tx-value ${r.tipo === 'receita' ? 'pos' : 'neg'}">${r.tipo === 'receita' ? '+' : '−'} ${formatBRL(r.valor)}</span>
            </button>
          </li>`;
      }).join('')}</ul>
    </section>`;
}

function dayOptions(selected) {
  return Array.from({ length: 31 }, (_, i) => i + 1)
    .map((n) => `<option value="${n}"${n === selected ? ' selected' : ''}>${n}</option>`).join('');
}

function openRecurringForm(rec, d) {
  const r = rec || {
    tipo: 'despesa', valor: null, descricao: '', dia: 10, categoryId: null,
    accountId: d.accounts[0]?.id || null, cardId: null, ativo: true,
  };
  const origin = r.cardId ? `card:${r.cardId}` : r.accountId ? `acc:${r.accountId}` : '';

  const sheet = openSheet({
    title: rec ? 'Editar conta fixa' : 'Nova conta fixa',
    content: `
      <form class="form" novalidate>
        <div class="segmented" role="radiogroup" aria-label="Tipo">
          <label><input type="radio" name="tipo" value="despesa"${r.tipo === 'despesa' ? ' checked' : ''}><span>Despesa</span></label>
          <label><input type="radio" name="tipo" value="receita"${r.tipo === 'receita' ? ' checked' : ''}><span>Receita</span></label>
        </div>
        <label class="field field-money"><span>Valor mensal</span>
          <input name="valor" inputmode="decimal" autocomplete="off" placeholder="0,00" value="${r.valor != null ? centsToInput(r.valor) : ''}">
        </label>
        <label class="field"><span>Descrição</span>
          <input name="descricao" type="text" maxlength="80" autocomplete="off" autocapitalize="sentences" placeholder="Ex.: Aluguel" value="${escapeHTML(r.descricao)}">
        </label>
        <div class="row2">
          <label class="field"><span>Dia do mês</span><select name="dia">${dayOptions(r.dia)}</select></label>
          <label class="field"><span>Categoria</span><select name="categoryId"></select></label>
        </div>
        <label class="field"><span>Conta ou cartão</span><select name="origem"></select></label>
        <label class="toggle">
          <input type="checkbox" name="ativo"${r.ativo ? ' checked' : ''}>
          <span class="toggle-ui" aria-hidden="true"></span>
          <span>Ativa</span>
        </label>
        ${rec ? '<p class="hint">Alterações valem para os lançamentos não pagos deste mês em diante.</p>' : ''}
        <p class="form-error" role="alert" hidden></p>
        <div class="form-actions">
          ${rec ? '<button type="button" class="btn btn-danger-ghost" data-delete>Excluir</button>' : ''}
          <button type="submit" class="btn btn-primary">Salvar</button>
        </div>
      </form>`,
  });
  const form = $('form', sheet.body);
  const tipo = () => form.tipo.value;

  function refreshOptions() {
    const prev = form.categoryId.value || r.categoryId;
    const cat = d.catMap.get(prev)?.tipo === tipo() ? prev : null;
    form.categoryId.innerHTML = categoryOptions(d.categories, tipo(), cat);
    if (!form.categoryId.value && form.categoryId.options.length) form.categoryId.selectedIndex = 0;
    const sel = form.origem.value || origin;
    form.origem.innerHTML = originOptions(d, sel, { allowCards: tipo() === 'despesa' });
    if (!form.origem.value && form.origem.options.length) form.origem.selectedIndex = 0;
  }
  refreshOptions();
  form.addEventListener('change', (ev) => { if (ev.target.name === 'tipo') refreshOptions(); });

  const fail = (msg, field) => {
    const el = $('.form-error', form);
    el.textContent = msg;
    el.hidden = false;
    field?.focus();
  };

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const valor = parseMoney(form.valor.value);
    if (!(valor > 0)) return fail('Informe um valor maior que zero.', form.valor);
    const descricao = form.descricao.value.trim();
    if (!descricao) return fail('Informe uma descrição.', form.descricao);
    const { accountId, cardId } = parseOrigin(form.origem.value);
    if (!accountId && !cardId) return fail('Escolha uma conta ou cartão. Cadastre uma em Ajustes.', form.origem);

    const saved = {
      ...r,
      id: rec?.id || uid(),
      tipo: tipo(),
      valor,
      descricao,
      dia: Number(form.dia.value),
      categoryId: form.categoryId.value || null,
      accountId,
      cardId,
      ativo: form.ativo.checked,
      inicio: rec?.inicio || currentMonth(),
      gerados: rec?.gerados || [],
    };
    try {
      await saveRecurring(saved, d.cardMap);
      // Gera já o mês atual e o mês que está sendo visto (sem duplicar).
      await generateRecurring(currentMonth());
      if (state.month > currentMonth()) await generateRecurring(state.month);
      toast(rec ? 'Conta fixa atualizada.' : 'Conta fixa cadastrada.', { type: 'success' });
      sheet.close();
    } catch (err) {
      showError(err);
    }
  });

  $('[data-delete]', form)?.addEventListener('click', async () => {
    const choice = await choiceDialog({
      title: 'Excluir conta fixa?',
      message: `"${rec.descricao}" deixará de ser lançada nos próximos meses.`,
      options: [
        { label: 'Excluir e apagar os pendentes', value: 'pending', danger: true },
        { label: 'Excluir e manter os já lançados', value: 'keep', danger: true },
      ],
    });
    if (!choice) return;
    try {
      await deleteRecurring(rec.id, { removePending: choice === 'pending' });
      toast('Conta fixa excluída.', { type: 'success' });
      sheet.close();
    } catch (err) {
      showError(err);
    }
  });
}
