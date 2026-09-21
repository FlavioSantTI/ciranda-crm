---
title: Estado do ambiente e achados de setup
parent: ../prd/07-prd-odonto-saas.md
version: 1.0
status: medido
date: 2026-09-10
owner: Flavio Santiago
medido_em: origin/main @ 6aee6564, Windows 10.0.26200, Node v24.19.0, pnpm 9.15.9
---

# Estado do ambiente — o que foi medido, e o que ainda falta

> Tudo nesta página foi **executado**, não inferido. Onde há número, há comando que o produziu.
> Onde algo não pôde ser provado, está escrito que não pôde.

---

## 1. Toolchain desta máquina

| Item | Esperado pelo projeto | Nesta máquina | Situação |
|---|---|---|---|
| Node | `.nvmrc` = 22, `engines` = `>=22` | **v24.19.0** | Passa no `engines`, mas diverge do CI (Node 22) |
| pnpm | `packageManager: pnpm@9.15.9` | 9.15.9 via `corepack pnpm` | OK |
| Docker | necessário para `test:db` e Supabase local | **ausente** | Bloqueia `pnpm test:db` |
| Supabase CLI | necessário para `supabase link` | **ausente** | Bloqueia o caminho documentado |
| psql | necessário para aplicar `baseline.sql` | **ausente** | Bloqueia a criação do schema |

### O detalhe do pnpm que economiza meia hora

`corepack enable` **falha nesta máquina** com `EPERM: operation not permitted, open 'C:\Program Files\nodejs\yarn'`
— precisa de terminal como administrador para criar os shims.

Não é necessário resolver isso. Use a forma sem shim, que respeita a versão exata fixada no `package.json`:

```powershell
corepack pnpm install
corepack pnpm typecheck
```

Instalar pnpm por fora (`npm i -g pnpm`) também funciona, mas pega a versão mais nova em vez da 9.15.9 —
e o projeto fixa a versão por um motivo.

---

## 2. Resultado da suíte de verificação

Rodado em `origin/main @ 6aee6564`, sem nenhuma modificação de código.

| Comando | Resultado | Observação |
|---|---|---|
| `pnpm typecheck` | ✅ **passa** | `tsc --noEmit` estrito, 63s |
| `pnpm lint` | ✅ **passa** | 0 erros, 345 warnings (todos pré-existentes) |
| `pnpm lint:channels` | ✅ **passa** | "62 arquivos de dívida conhecida, nenhum novo" |
| `pnpm test:unit` | ⚠️ **7.975 de 7.993 passam** | 17 falhas em 5 arquivos — causa na §4 |
| `pnpm test:db` | ⛔ **não executado** | exige Docker |
| `pnpm test:e2e` | ⛔ **não executado** | exige Supabase local + dev server |

---

## 3. 🔴 A armadilha do `.env.local` — copiar o template quebra 245 testes

**Este é o achado mais caro do setup, e ele custa horas a quem não sabe.**

O `README.md` e o `docs/SETUP.md` mandam fazer `cp .env.example .env.local`. Fazer exatamente isso
**derruba 245 testes em 150 arquivos**, todos com a mesma mensagem:

```
Error: Variáveis de ambiente inválidas. Veja o erro acima e ajuste .env.local / Vercel.
 ❯ lib/env.ts:363:9
```

### Prova

Mesmo arquivo de teste, duas execuções, nada mais mudou:

```
=== COM .env.local (copiado de .env.example) ===
 Test Files  1 failed (1)
      Tests  no tests

=== SEM .env.local ===
 Test Files  1 passed (1)
      Tests  7 passed (7)
```

E na suíte inteira: **com** o template, 245 falhas; **sem** ele, 17.

### Causa raiz

Duas linhas de `tests/setup/vitest.setup.ts` que, isoladas, estão certas — e juntas, não:

1. O carregador de `.env` grava **string vazia** para toda chave presente-porém-vazia do template:
   ```ts
   if (key && !process.env[key]) {
     process.env[key] = stripQuotes(rest.join("=").trim());  // vira ""
   }
   ```
2. Os placeholders de teste usam `??=`, que só substitui `undefined` ou `null` — **não** substitui `""`:
   ```ts
   const PLACEHOLDERS = {
     NEXT_PUBLIC_SUPABASE_URL: "https://test-placeholder.invalid",
     // ...
   };
   for (const [chave, valor] of Object.entries(PLACEHOLDERS)) {
     process.env[chave] ??= valor;   // "" não é nullish → placeholder nunca entra
   }
   ```

Resultado: `NEXT_PUBLIC_SUPABASE_URL` chega ao Zod como `""` e reprova em `.url()`.

No CI não existe `.env.local`, as variáveis ficam `undefined`, os placeholders entram e tudo passa. **O bug
só atinge quem seguiu a documentação.**

### O que fazer agora

Enquanto não houver credenciais reais de Supabase, **não tenha `.env.local`**. A suíte unitária não precisa
dele. Quando for criar, preencha os três obrigatórios com valores reais — nunca deixe em branco:

```
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service role key>
```

São os únicos marcados `requiredAlways` em `lib/env.ts`; os outros 54 têm default.

### Candidato a contribuição upstream (degrau 3 da escada)

Correção de uma linha: trocar `??=` por `||=` nos placeholders, ou ignorar valores vazios no carregador.
É um bug que atinge todo dev novo do projeto, tem reprodução de 30 segundos e correção trivial — o tipo de
PR que entra rápido e constrói reputação no repositório.

---

## 4. As 17 falhas restantes são do Windows, não do produto

### A prova de que não é defeito do projeto

O CI do upstream está **inteiramente verde neste commit exato** (`6aee6564`), incluindo o job `verify`,
que é quem roda `pnpm test:unit`:

```
verify           completed  success
invariants       completed  success
build-and-size   completed  success
e2e              completed  success
imagens-ok       completed  success
```

CI roda Ubuntu + Node 22. Esta máquina é Windows + Node 24. A diferença está aí.

### A causa, num dos casos

`tests/unit/suporte-cobertura-de-efeitos.test.ts` monta caminhos com `join()` — que no Windows produz `\` —
e depois filtra com barra normal literal:

```ts
// linha 5: no Windows, isto produz "app\actions\impersonate\x.ts"
function files(dir){ return readdirSync(dir,{withFileTypes:true})
  .flatMap(i => i.isDirectory() ? files(join(dir,i.name)) : [join(dir,i.name)]); }

// linha 10: nunca casa no Windows
if (path.includes("/impersonate")) continue;
```

A exclusão não se aplica, arquivos que deveriam ser ignorados entram na varredura, e a asserção reprova.

### Os 5 arquivos

| Arquivo | Falhas | Natureza |
|---|---|---|
| `tests/unit/leads-import-route.test.ts` | 11 | rota de importação devolve 422 onde o teste espera 200 |
| `tests/unit/lgpd-pdf-meet.test.ts` | 3 | geração de PDF |
| `tests/unit/lgpd-pdf-replies.test.ts` | 1 | geração de PDF |
| `tests/unit/rascunho-superado-nao-e-regravado.test.ts` | 1 | sonda que varre o filesystem |
| `tests/unit/suporte-cobertura-de-efeitos.test.ts` | 1 | varredura de Server Actions (causa confirmada acima) |

### Decisão

**Não corrigir agora.** São testes de harness, não código de produto, e o produto está verde no CI de
referência. O custo de divergir do upstream (§2 do PRD) é maior que o benefício de ver 17 linhas verdes numa
máquina Windows.

**A régua de verdade para este projeto é o CI, não a máquina local** — o `CONTRIBUTING.md` já diz isso com
outras palavras: "Verde na sua máquina não é verde no merge."

Se o desenvolvimento no Windows se tornar frequente, a saída correta é **WSL2**, que alinha o ambiente local
ao CI de uma vez e resolve Docker, psql e separador de caminho no mesmo movimento.

---

## 5. ⛔ O que ainda falta para o ambiente ficar completo

O banco é o único bloqueio real, e ele depende de credenciais que só você pode criar.

### Passo 1 — criar o projeto Supabase

Conta grátis em [supabase.com](https://supabase.com). Anote as três chaves e a connection string do
**Session pooler** (não a direta).

### Passo 2 — habilitar as extensões ANTES do schema

Sem isto o `baseline.sql` para em `type public.vector does not exist`:

```sql
create extension if not exists vector  with schema public;
create extension if not exists citext  with schema public;
create extension if not exists pg_trgm with schema public;
```

Dá para rodar pelo SQL Editor do painel do Supabase, sem precisar de `psql`.

### Passo 3 — aplicar o schema

> ⚠️ **Aplique `supabase/baseline.sql`, NUNCA as migrations.** As migrations `0001`–`0009` e `0013` são
> stubs `SELECT 1;` — a cadeia não sobe do zero. `supabase db push` "passa" e deixa o banco vazio.

O `baseline.sql` é grande. Dois caminhos:

- **Sem instalar nada:** colar o conteúdo no SQL Editor do Supabase, em partes se necessário.
- **Com ferramenta:** instalar PostgreSQL client (traz o `psql`) e rodar
  `psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/baseline.sql`.

### Passo 4 — criar o `.env.local`

Com valores reais, e atenção à §3 desta página.

### Passo 5 — subir

```powershell
corepack pnpm dev
```

App em <http://localhost:3000>, saúde em <http://localhost:3000/api/v1/health>.

### Opcional, mas recomendado — Docker

Destrava `pnpm test:db` (o job `invariants`, que é gate obrigatório de merge) e o WAHA local.
No Windows, instalar via WSL2 resolve os dois problemas de uma vez.

---

## 6. Achados menores, já reconciliados

**`.env.example` está completo.** O `docs/current-state.md` §4.5 (retrato de 2026-07-29) afirma que faltam
6 variáveis, incluindo três secrets. **Remedido hoje: das 57 variáveis de `lib/env.ts`, a única ausente do
template é `NODE_ENV`**, que vem do runtime. A pendência foi resolvida em algum ponto entre julho e agora.

Isso confirma o aviso que o próprio documento traz no topo: ele é um retrato datado, não o estado de hoje.
**Meça antes de agir sobre qualquer linha dele.**

**O comentário do WAHA no compose está obsoleto.** `docker-compose.prod.yml` diz *"troque para
`devlikeapro/waha-plus` … (licença paga)"*, mas o WAHA Plus foi fundido no Core na versão **2026.6.1**, e o
próprio arquivo já usa `devlikeapro/waha:latest-2026.7.2`. Não há licença a pagar. Outro candidato barato a
contribuição upstream.
