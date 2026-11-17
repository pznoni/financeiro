# Financeiro

App de controle financeiro pessoal para usar no iPhone pelo Safari, como um app "de verdade" (PWA). Ele fica hospedado de graça no GitHub Pages, **sem domínio, sem servidor e sem banco na nuvem**. Os dados ficam só no aparelho (IndexedDB), e o backup é feito por você, em JSON.

## O que o app faz

- **Início**: resumo do mês (receitas, despesas, saldo), saldo das contas, faturas em aberto, contas que vencem nos próximos 7 dias e gastos por categoria. O ícone de gráfico abre o **Histórico** (visão anual mês a mês).
- **Lançamentos**: lista do mês agrupada por dia, com busca e filtros. Tocar num item edita; o círculo marca como pago/não pago.
- **Cartões**: limite usado/disponível, fatura por mês, compras parceladas (uma parcela por fatura) e "Pagar fatura", que gera a despesa na conta escolhida. Compra feita depois do dia de fechamento entra na fatura seguinte.
- **Contas fixas**: aluguel, internet, assinaturas, salário… Os lançamentos são criados automaticamente quando você abre cada mês, sem duplicar.
- **Ajustes**: contas, categorias, backup/restauração (JSON), exportação CSV para Excel e apagar todos os dados.
- Funciona **offline** depois do primeiro acesso.

## Testar no computador (Windows)

O app precisa ser servido por um servidor local (abrir o `index.html` direto com dois cliques não funciona, por causa dos módulos JavaScript e do service worker).

Abra o terminal (PowerShell) na pasta do projeto e rode **um** destes comandos:

```powershell
npx serve .
# ou, se tiver Python instalado:
python -m http.server 8000
```

Depois abra no navegador o endereço mostrado (por exemplo `http://localhost:3000` ou `http://localhost:8000`).

> Dica: no Chrome, F12 → ícone de celular para ver o app no tamanho de um iPhone.

## Publicar no GitHub Pages (passo a passo)

### 1. Criar o repositório

1. Entre em <https://github.com> (crie uma conta se ainda não tiver).
2. Clique em **+** (canto superior direito) → **New repository**.
3. Em **Repository name**, digite `financeiro`.
4. Deixe **Public** (o GitHub Pages gratuito exige repositório público; seus dados financeiros **não** vão para o repositório, só o código do app).
5. Clique em **Create repository**.

### 2. Subir os arquivos

**Opção A, pelo site (mais fácil):**

1. Na página do repositório, clique em **uploading an existing file**.
2. Arraste **todo o conteúdo** desta pasta (`index.html`, `sw.js`, `manifest.webmanifest`, `.nojekyll`, e as pastas `css`, `js`, `icons`). O `index.html` precisa ficar na raiz do repositório, não dentro de uma subpasta.
3. Clique em **Commit changes**.

**Opção B, pelo terminal (com Git instalado):**

```powershell
cd C:\caminho\da\pasta
git init
git add .
git commit -m "Primeira versão"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/financeiro.git
git push -u origin main
```

### 3. Ativar o GitHub Pages

1. No repositório, vá em **Settings → Pages**.
2. Em **Build and deployment → Source**, escolha **Deploy from a branch**.
3. Em **Branch**, escolha **main** e a pasta **/ (root)**. Clique em **Save**.
4. Aguarde 1 ou 2 minutos. O endereço aparece no topo da página: `https://SEU-USUARIO.github.io/financeiro/`.

## Instalar no iPhone

1. Abra o endereço `https://SEU-USUARIO.github.io/financeiro/` no **Safari** (precisa ser o Safari).
2. Toque em **Compartilhar** (quadrado com seta para cima).
3. Role e toque em **Adicionar à Tela de Início** → **Adicionar**.
4. Abra o app pelo ícone novo na Tela de Início. Ele abre em tela cheia e funciona offline.

> **Importante:** os dados do app instalado na Tela de Início ficam separados dos dados do Safari. Use sempre pelo ícone.

## Backup (faça sempre!)

Os dados ficam **somente no iPhone**. Se você apagar o app, trocar de aparelho ou o iOS limpar os dados do site, eles se perdem sem backup.

- **Ajustes → Exportar backup (JSON)** → **Salvar em Arquivos** → escolha uma pasta no **iCloud Drive**.
- Para restaurar: **Ajustes → Restaurar backup…** e escolha o arquivo. Dá para **mesclar** com os dados atuais ou **substituir tudo**.
- O Início mostra um lembrete quando o último backup tem mais de 7 dias.
- **Exportar lançamentos (CSV/Excel)** gera uma planilha para abrir no Excel ou no Numbers.

## Publicar atualizações

Sempre que alterar algum arquivo:

1. Abra `sw.js` e **incremente** `CACHE_VERSION` (por exemplo, de `financeiro-v1` para `financeiro-v2`).
2. Em `js/version.js`, atualize `APP_VERSION` (por exemplo, `1.0.1`). É a versão mostrada em Ajustes.
3. Se criou um arquivo novo, adicione o caminho dele na lista `ASSETS` do `sw.js`.
4. Suba os arquivos para o GitHub (pelo site ou `git add . && git commit -m "..." && git push`).
5. Em 1 ou 2 minutos, ao abrir o app no iPhone aparece **"Nova versão disponível — toque para atualizar"**. Toque em **Atualizar**.

Se não aparecer, feche o app (deslize para cima no seletor de apps) e abra de novo.

## Estrutura

```
index.html              página única do app
manifest.webmanifest    nome, ícones e modo tela cheia
sw.js                   service worker (offline + atualizações)
css/styles.css          tema escuro
js/app.js               inicialização, rotas, abas, botão +
js/db.js                IndexedDB: schema, migrações, CRUD, backup
js/finance.js           regras: resumos, faturas, parcelas, recorrências
js/backup.js            exportar JSON/CSV, validar e importar
js/util.js              dinheiro (centavos), datas locais, utilidades
js/state.js             mês selecionado
js/version.js           versão exibida em Ajustes
js/ui/*.js              uma tela por arquivo + componentes
icons/                  ícones do app
```

Valores são guardados como inteiros em centavos e datas como texto `AAAA-MM-DD` no horário local, para evitar erros de arredondamento e de fuso horário.
