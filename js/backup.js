// backup.js — exportação (JSON e CSV), validação e importação de backups.
import { DATA_STORES, SCHEMA_VERSION, exportData, importData, metaSet } from './db.js';
import { isInvoicePayment, loadAll } from './finance.js';
import { centsToInput, escapeHTML, isISODate, isMonth, signed, todayISO } from './util.js';
import { choiceDialog, confirmDialog, showError, toast } from './ui/components.js';

// ---------- Entrega do arquivo ----------

/**
 * No iOS, abre a folha de compartilhamento (Salvar em Arquivos/iCloud).
 * Sem suporte, baixa o arquivo. Resolve false se o usuário cancelou.
 */
async function deliverFile(content, filename, type) {
  const blob = new Blob([content], { type });
  const file = new File([blob], filename, { type });

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return true;
    } catch (err) {
      if (err.name === 'AbortError') return false;
      // NotAllowedError (gesto expirou) ou outro: cai no download.
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return true;
}

// ---------- Exportar ----------

/** Exporta tudo em JSON e registra a data do backup. */
export async function runBackup() {
  try {
    const backup = await exportData();
    const ok = await deliverFile(
      JSON.stringify(backup, null, 2),
      `financeiro-backup-${todayISO()}.json`,
      'application/json',
    );
    if (!ok) return;
    await metaSet('lastBackup', backup.exportedAt);
    toast('Backup gerado.', { type: 'success' });
  } catch (err) {
    showError(err);
  }
}

/** Campo CSV: aspas quando houver separador, aspas ou quebra de linha. */
function csvField(value) {
  const s = String(value ?? '');
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Exporta os lançamentos em CSV para Excel (";", vírgula decimal, UTF-8 com BOM). */
export async function exportCSV() {
  try {
    const d = await loadAll();
    const header = ['Data', 'Tipo', 'Descrição', 'Categoria', 'Conta/Cartão', 'Valor', 'Pago', 'Parcela', 'Fatura'];
    const rows = [...d.transactions]
      .sort((a, b) => a.data.localeCompare(b.data))
      .map((t) => {
        const [y, m, day] = t.data.split('-');
        const where = t.cardId ? d.cardMap.get(t.cardId)?.nome : d.accMap.get(t.accountId)?.nome;
        const categoria = isInvoicePayment(t) ? 'Pagamento de fatura' : d.catMap.get(t.categoryId)?.nome || 'Sem categoria';
        return [
          `${day}/${m}/${y}`,
          t.tipo === 'receita' ? 'Receita' : 'Despesa',
          t.descricao,
          categoria,
          where || '',
          centsToInput(signed(t)),
          t.pago ? 'Sim' : 'Não',
          t.parcela ? `${t.parcela.n}/${t.parcela.total}` : '',
          t.fatura || '',
        ];
      });
    const csv = `﻿${[header, ...rows].map((r) => r.map(csvField).join(';')).join('\r\n')}\r\n`;
    if (await deliverFile(csv, `financeiro-lancamentos-${todayISO()}.csv`, 'text/csv')) {
      toast(`${rows.length} lançamentos exportados.`, { type: 'success' });
    }
  } catch (err) {
    showError(err);
  }
}

// ---------- Validar ----------

const isInt = (n) => Number.isSafeInteger(n);
const isDay = (n) => isInt(n) && n >= 1 && n <= 31;
const isStr = (s) => typeof s === 'string';

/** Regras mínimas por store: se falhar, o item é inválido. */
const VALIDATORS = {
  categories: (c) => isStr(c.nome) && ['receita', 'despesa'].includes(c.tipo),
  accounts: (a) => isStr(a.nome) && isInt(a.saldoInicial ?? 0),
  cards: (c) => isStr(c.nome) && isInt(c.limite ?? 0) && isDay(c.fechamento) && isDay(c.vencimento),
  recurring: (r) => isStr(r.descricao) && isInt(r.valor) && r.valor >= 0
    && ['receita', 'despesa'].includes(r.tipo) && isDay(r.dia),
  transactions: (t) => ['receita', 'despesa'].includes(t.tipo) && isInt(t.valor) && t.valor >= 0
    && isISODate(t.data) && (t.fatura == null || isMonth(t.fatura)),
};

/** Lança um erro com mensagem amigável se o arquivo não for um backup válido. */
export function validateBackup(obj) {
  const fail = (msg) => { throw new Error(`Backup inválido: ${msg}`); };
  if (!obj || typeof obj !== 'object' || obj.app !== 'financeiro' || !obj.data) {
    fail('este arquivo não é um backup do app.');
  }
  if (!isInt(obj.schemaVersion) || obj.schemaVersion > SCHEMA_VERSION) {
    fail('ele foi gerado por uma versão mais nova do app. Atualize o app e tente de novo.');
  }
  const data = {};
  for (const name of DATA_STORES) {
    const list = obj.data[name] ?? [];
    if (!Array.isArray(list)) fail(`a seção "${name}" está corrompida.`);
    list.forEach((item, i) => {
      if (!item || typeof item !== 'object' || !isStr(item.id) || !item.id) fail(`item ${i + 1} de "${name}" sem id.`);
      if (!VALIDATORS[name](item)) fail(`item ${i + 1} de "${name}" tem dados inválidos.`);
    });
    data[name] = list;
  }
  return data;
}

// ---------- Importar ----------

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
    reader.readAsText(file);
  });
}

/** Lê, valida, mostra a prévia e importa (substituir ou mesclar). Resolve true se importou. */
export async function importBackupFile(file) {
  let data;
  try {
    const text = await readFile(file);
    let obj;
    try { obj = JSON.parse(text); } catch { throw new Error('Backup inválido: o arquivo não é um JSON.'); }
    data = validateBackup(obj);
  } catch (err) {
    showError(err);
    return false;
  }

  const n = (k) => data[k].length;
  const preview = `${n('transactions')} lançamentos, ${n('cards')} cartões, ${n('recurring')} contas fixas, `
    + `${n('accounts')} contas e ${n('categories')} categorias.`;
  const mode = await choiceDialog({
    title: 'Importar backup',
    message: `O arquivo tem ${preview}`,
    options: [
      { label: 'Mesclar com os dados atuais', value: 'merge', primary: true },
      { label: 'Substituir tudo', value: 'replace', danger: true },
    ],
  });
  if (!mode) return false;
  if (mode === 'replace') {
    const ok = await confirmDialog({
      title: 'Substituir tudo?',
      message: 'Todos os dados atuais deste aparelho serão apagados e trocados pelos do backup.',
      confirmLabel: 'Substituir',
      danger: true,
    });
    if (!ok) return false;
  }
  try {
    await importData(data, mode);
    toast(mode === 'replace' ? 'Dados substituídos pelo backup.' : 'Backup mesclado.', { type: 'success' });
    return true;
  } catch (err) {
    showError(err);
    return false;
  }
}

/** Texto curto do último backup, para Ajustes. */
export function lastBackupLabel(iso) {
  if (!iso) return 'Nenhum backup feito ainda.';
  const d = new Date(iso);
  return `Último backup: ${escapeHTML(d.toLocaleDateString('pt-BR'))} às ${escapeHTML(d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }))}`;
}
