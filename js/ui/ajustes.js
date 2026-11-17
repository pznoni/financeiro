// ajustes.js — contas, categorias, backup/restauração, armazenamento, apagar dados e versão.
import { clearAll, metaGet, put } from '../db.js';
import { accountBalance, deleteAccount, deleteCategory, loadAll } from '../finance.js';
import { exportCSV, importBackupFile, lastBackupLabel, runBackup } from '../backup.js';
import { APP_VERSION } from '../version.js';
import { centsToInput, escapeHTML, formatBRL, parseMoney, todayISO, uid } from '../util.js';
import {
  $, confirmDialog, icons, moneyClass, openSheet, showError, toast,
} from './components.js';

export async function render(root, ctx) {
  const [d, lastBackup, persisted] = await Promise.all([
    loadAll(),
    metaGet('lastBackup'),
    navigator.storage?.persisted?.().catch(() => false) ?? false,
  ]);
  const today = todayISO();
  const receitas = d.categories.filter((c) => c.tipo === 'receita');
  const despesas = d.categories.filter((c) => c.tipo === 'despesa');

  root.innerHTML = `
    <header class="view-header"><h1>Ajustes</h1></header>

    <section class="panel" id="contas">
      <div class="panel-head">
        <h2>Contas</h2>
        <button type="button" class="btn btn-small btn-secondary" data-new-account>${icons.plus} Nova</button>
      </div>
      <ul class="settings-list">${d.accounts.map((a) => {
        const saldo = accountBalance(a, d.transactions, { until: today });
        return `
          <li><button type="button" class="settings-row" data-account="${escapeHTML(a.id)}">
            <span class="tx-text"><span class="tx-desc">${escapeHTML(a.nome)}</span>
              <span class="tx-meta">saldo inicial ${formatBRL(a.saldoInicial)}</span></span>
            <span class="tx-value ${moneyClass(saldo)}">${formatBRL(saldo)}</span>
          </button></li>`;
      }).join('') || '<li class="hint">Nenhuma conta. Cadastre pelo menos uma.</li>'}</ul>
      <p class="hint">Saldo atual = saldo inicial + lançamentos pagos até hoje.</p>
    </section>

    <section class="panel" id="categorias">
      <div class="panel-head">
        <h2>Categorias</h2>
        <button type="button" class="btn btn-small btn-secondary" data-new-category>${icons.plus} Nova</button>
      </div>
      <h3 class="sub">Despesas</h3>
      <ul class="cat-grid">${despesas.map(catChip).join('')}</ul>
      <h3 class="sub">Receitas</h3>
      <ul class="cat-grid">${receitas.map(catChip).join('')}</ul>
    </section>

    <section class="panel" id="backup">
      <h2>Backup</h2>
      <p class="hint">Os dados ficam só neste aparelho. Faça backup com frequência e guarde no app Arquivos ou no iCloud.</p>
      <p class="backup-status">${lastBackupLabel(lastBackup)}</p>
      <div class="stack">
        <button type="button" class="btn btn-primary" data-backup>Exportar backup (JSON)</button>
        <button type="button" class="btn btn-secondary" data-csv>Exportar lançamentos (CSV/Excel)</button>
        <label class="btn btn-secondary file-btn">
          Restaurar backup…
          <input type="file" accept="application/json,.json" data-import class="visually-hidden">
        </label>
      </div>
    </section>

    <section class="panel">
      <h2>Armazenamento</h2>
      <p class="hint">${persisted
        ? '✅ Armazenamento persistente ativado: o sistema não apaga os dados para liberar espaço.'
        : 'O iOS pode apagar dados de sites pouco usados. Adicione o app à Tela de Início e mantenha backups em dia.'}</p>
    </section>

    <section class="panel danger-zone">
      <h2>Zona de perigo</h2>
      <button type="button" class="btn btn-danger btn-block" data-wipe>Apagar todos os dados</button>
    </section>

    <p class="app-version">Financeiro · versão ${escapeHTML(APP_VERSION)}</p>`;

  root.addEventListener('click', (ev) => {
    const t = ev.target;
    if (t.closest('[data-new-account]')) openAccountForm(null);
    else if (t.closest('[data-account]')) openAccountForm(d.accMap.get(t.closest('[data-account]').dataset.account));
    else if (t.closest('[data-new-category]')) openCategoryForm(null);
    else if (t.closest('[data-category]')) openCategoryForm(d.catMap.get(t.closest('[data-category]').dataset.category));
    else if (t.closest('[data-backup]')) runBackup();
    else if (t.closest('[data-csv]')) exportCSV();
    else if (t.closest('[data-wipe]')) wipeAll();
  });
  $('[data-import]', root).addEventListener('change', async (ev) => {
    const file = ev.target.files?.[0];
    ev.target.value = '';
    if (file) await importBackupFile(file);
  });

  // #ajustes/contas, #ajustes/categorias, #ajustes/backup rolam até a seção.
  const section = ctx.params[0] && root.querySelector(`#${CSS.escape(ctx.params[0])}`);
  if (section) requestAnimationFrame(() => section.scrollIntoView({ block: 'start' }));
}

function catChip(c) {
  return `<li><button type="button" class="cat-chip" data-category="${escapeHTML(c.id)}"><span>${escapeHTML(c.nome)}</span></button></li>`;
}

// ---------- Contas ----------

function openAccountForm(acc) {
  const a = acc || { nome: '', saldoInicial: 0 };
  const sheet = openSheet({
    title: acc ? 'Editar conta' : 'Nova conta',
    content: `
      <form class="form" novalidate>
        <label class="field"><span>Nome</span>
          <input name="nome" type="text" maxlength="40" placeholder="Ex.: Conta corrente" value="${escapeHTML(a.nome)}" autocomplete="off">
        </label>
        <label class="field field-money"><span>Saldo inicial</span>
          <input name="saldo" inputmode="decimal" autocomplete="off" placeholder="0,00" value="${acc ? centsToInput(a.saldoInicial) : ''}">
        </label>
        <p class="hint">Use "-" para saldo negativo (ex.: -150,00).</p>
        <p class="form-error" role="alert" hidden></p>
        <div class="form-actions">
          ${acc ? '<button type="button" class="btn btn-danger-ghost" data-delete>Excluir</button>' : ''}
          <button type="submit" class="btn btn-primary">Salvar</button>
        </div>
      </form>`,
  });
  const form = $('form', sheet.body);
  const err = $('.form-error', form);

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const nome = form.nome.value.trim();
    const saldoInicial = form.saldo.value.trim() ? parseMoney(form.saldo.value) : 0;
    if (!nome) { err.textContent = 'Informe o nome da conta.'; err.hidden = false; return; }
    if (Number.isNaN(saldoInicial)) { err.textContent = 'Saldo inválido.'; err.hidden = false; return; }
    try {
      await put('accounts', { ...a, id: acc?.id || uid(), nome, saldoInicial });
      toast(acc ? 'Conta atualizada.' : 'Conta criada.', { type: 'success' });
      sheet.close();
    } catch (e) {
      showError(e);
    }
  });

  $('[data-delete]', form)?.addEventListener('click', async () => {
    const ok = await confirmDialog({ title: 'Excluir conta?', message: `"${acc.nome}" será excluída.`, confirmLabel: 'Excluir', danger: true });
    if (!ok) return;
    try {
      await deleteAccount(acc.id);
      toast('Conta excluída.', { type: 'success' });
      sheet.close();
    } catch (e) {
      showError(e);
    }
  });
}

// ---------- Categorias ----------

function openCategoryForm(cat) {
  const c = cat || { nome: '', tipo: 'despesa' };
  const sheet = openSheet({
    title: cat ? 'Editar categoria' : 'Nova categoria',
    content: `
      <form class="form" novalidate>
        <div class="segmented" role="radiogroup" aria-label="Tipo">
          <label><input type="radio" name="tipo" value="despesa"${c.tipo === 'despesa' ? ' checked' : ''}><span>Despesa</span></label>
          <label><input type="radio" name="tipo" value="receita"${c.tipo === 'receita' ? ' checked' : ''}><span>Receita</span></label>
        </div>
        <label class="field"><span>Nome</span>
          <input name="nome" type="text" maxlength="30" placeholder="Ex.: Pets" value="${escapeHTML(c.nome)}" autocomplete="off">
        </label>
        <p class="form-error" role="alert" hidden></p>
        <div class="form-actions">
          ${cat ? '<button type="button" class="btn btn-danger-ghost" data-delete>Excluir</button>' : ''}
          <button type="submit" class="btn btn-primary">Salvar</button>
        </div>
      </form>`,
  });
  const form = $('form', sheet.body);
  const err = $('.form-error', form);

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const nome = form.nome.value.trim();
    if (!nome) { err.textContent = 'Informe o nome da categoria.'; err.hidden = false; return; }
    try {
      await put('categories', {
        ...c, id: cat?.id || uid(), nome, tipo: form.tipo.value,
      });
      toast(cat ? 'Categoria atualizada.' : 'Categoria criada.', { type: 'success' });
      sheet.close();
    } catch (e) {
      showError(e);
    }
  });

  $('[data-delete]', form)?.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Excluir categoria?',
      message: `Lançamentos de "${cat.nome}" ficarão sem categoria.`,
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteCategory(cat.id);
      toast('Categoria excluída.', { type: 'success' });
      sheet.close();
    } catch (e) {
      showError(e);
    }
  });
}

// ---------- Apagar tudo (dupla confirmação) ----------

async function wipeAll() {
  const first = await confirmDialog({
    title: 'Apagar todos os dados?',
    message: 'Lançamentos, cartões, contas fixas, contas e categorias deste aparelho serão apagados. Faça um backup antes.',
    confirmLabel: 'Continuar',
    danger: true,
  });
  if (!first) return;
  const second = await confirmDialog({
    title: 'Tem certeza mesmo?',
    message: 'Esta ação não pode ser desfeita.',
    confirmLabel: 'Apagar tudo definitivamente',
    danger: true,
  });
  if (!second) return;
  try {
    await clearAll();
    try { sessionStorage.clear(); } catch { /* ignora */ }
    location.replace('./');
  } catch (e) {
    showError(e);
  }
}
