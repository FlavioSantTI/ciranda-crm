# waconector (vendorizado)

Esta pasta contém o **waconector v1.3.0** (https://github.com/alltomatos/waconector)
com um **patch customizado para EvoAPI v2** (suporte a instance no path + parsing de
resposta v2), compilado e embutido no clinicCRM para deploy self-contained.

## Por que vendorizar?

O waconector upstream (v1.3.0) só suporta EvoAPI v1 (endpoints sem instance no
path). Nossa EvoAPI é v2 e exige o nome da instancia na URL (`/message/sendText/{instance}`).
O patch v2 foi enviado upstream mas ainda não mergeado.

Vendorizar evita:
- Depender de um fork externo no GitHub
- Precisar clonar 2 repos na VPS
- Buildar o waconector separadamente no deploy

## Estrutura

```
vendor/waconector/
├── dist/               # build compilado (js + d.ts) — com v2 patch aplicado
├── package.json        # package.json limpo (sem devDeps, scripts, bin)
├── v2-patch.patch       # patch git do commit v2 (referência)
└── README.md           # este arquivo
```

## O que o patch v2 muda

1. **Endpoints v2**: quando `options.instance` é fornecido, usa
   `/message/sendText/{instance}` em vez de `/send/text`
2. **Parsing de status v2**: reconhece `{instance:{state:"open"}}` além de
   `{Connected,LoggedIn}`
3. **Parsing de message ID v2**: reconhece `{key:{id}}` além de
   `{data:{Info:{ID}}}`
4. **Backward compatible**: sem `options.instance`, usa endpoints v1 originais

## Como atualizar o waconector vendorizado

Quando o upstream aceitar o patch v2 (ou quando quiser puxar uma versão nova):

```bash
# 1. Clonar/buildar o waconector upstream (com ou sem o patch)
cd /tmp
git clone https://github.com/alltomatos/waconector.git
cd waconector

# 2. Se o patch v2 ainda não foi mergeado upstream, aplicar:
git apply /path/to/clinicCRM/vendor/waconector/v2-patch.patch

# 3. Buildar
pnpm install --frozen-lockfile
pnpm build

# 4. Re-vendorizar (copia dist + package.json limpo)
bash /path/to/clinicCRM/scripts/vendor-waconector.sh /tmp/waconector
```

O script `scripts/vendor-waconector.sh` faz a cópia e limpeza do package.json
automaticamente. Depois é só commitar as mudanças em `vendor/waconector/`.

## Versionamento

- `version` no `package.json` vendored: `1.3.0-vendored` (sufixo `-vendored`
  para diferenciar do npm upstream)
- Quando atualizar, bumpar a versão e atualizar este README

## Zero dependências

O waconector é zero-deps (ADR-0004 do projeto original). O `dist/` é self-contained
— nenhuma dependência externa é instalada quando o clinicCRM resolve
`file:vendor/waconector`.
