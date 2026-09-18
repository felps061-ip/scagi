# Revisão de segurança — 17/09/2026

Base: `f623a679611a1cc9d2cc24c50c2547e95104c603`, branch `agent/scagi-mvp`.
O scan final inclui as alterações locais desta revisão, ainda não publicadas.

## Resultado

| Verificação | Resultado |
| --- | --- |
| Trivy 0.74.0 — vulnerabilidades, segredos, configurações | 0 achados |
| Semgrep 1.177.0 — scan final combinado | 5 alertas, todos revisados como falsos positivos de interface |
| Semgrep — execução ampla inicial | 0 achados com p/security-audit, p/javascript e p/nodejs |
| Testes Node.js | 35 passaram |

O scan final do Semgrep carregou 298 regras e executou 96 aplicáveis em 37 arquivos
(34 JavaScript), incluindo testes. Não houve erros de análise e aproximadamente
100% das linhas analisadas foram interpretadas. Não foram adicionadas supressões
`nosemgrep` nem exclusões dos arquivos apontados no relatório.

O Trivy identificou o `package-lock.json`; não encontrou arquivos de infraestrutura
compatíveis com o scanner de configurações. Assim, zero configurações vulneráveis
não significa que a implantação, o Windows ou a rede tenham sido auditados.

## Os 11 alertas do GitGuard

| Regra / localização no relatório | Tratamento |
| --- | --- |
| regex_dos — src/portals/acre.js:25 | Reproduzido no commit original. Substituída a expressão regular por validação limitada a 32 caracteres, com separação de sinal, parte inteira, milhares e centavos. Não reproduzido após a alteração. |
| node_username — public/app.js:152, 153, 154, 157, 678 | Cinco alertas reproduzidos. São atribuições de textos/estado da interface e do perfil `operator`, não credenciais. Mantidos visíveis para revisão, sem supressão. |
| node_username — public/app.js:148, 149, 150, 527 | Não reproduzidos com a regra upstream atual. Os trechos tratam de elementos, estado e ações da interface. Não há credenciais literais nessas linhas. |
| detect-non-literal-regexp — src/portals/roraima.js:34 | Não reproduzido nem no commit original. A função usa indexOf/search com expressão literal; não há construção de RegExp dinâmica no código atual. |

A regra `regex_dos` do njsscan é heurística: identifica regex aplicada a argumentos
de funções e não demonstra por si só complexidade catastrófica. Não foi demonstrado
um ataque de ReDoS na expressão anterior. A alteração elimina a dependência de regex
nesse ponto e endurece o formato: `..,20` e agrupamentos inválidos passam a ser rejeitados.
São preservados valores negativos, zero, valores sem separador de milhares e valores
como `1.234,56`. Há teste para entrada excessiva de 100.000 caracteres.

As versões exatas das regras usadas internamente pelo GitGuard não constam do anexo.
Por isso, não é possível garantir que uma nova execução naquele serviço produza
os mesmos números. A reprodução usou as regras upstream consultadas nesta data.

## Método e limites

- Trivy instalado em diretório local isolado, com SHA-256 conferido contra checksums
  publicados no release oficial. Bases de vulnerabilidades e verificações baixadas.
- Semgrep instalado em ambiente Python isolado; métricas e checagem de versão
  desativadas nos scans. Código analisado localmente; não foi usado `semgrep ci`.
- Comparação do Semgrep com cópia isolada de `git archive HEAD`: seis achados antes,
  cinco depois. O conjunto final inclui também as regras amplas e os testes.
- `.env`, dados operacionais, dependências, ferramentas e relatórios locais ficam
  fora do scan do repositório. `.env.example` permanece incluído. Este resultado
  não atesta ausência de segredos na configuração operacional ou em backups.
- Nenhuma credencial de portal foi alterada e nenhum portal foi consultado.
- Context7 foi utilizado para consultar documentação de Trivy e Semgrep;
  Context7 não executa scanners.
- Não foi realizado pentest, revisão completa de autorização, scan do sistema
  operacional ou da infraestrutura de hospedagem. Ausência de achados automáticos
  não equivale a ausência de vulnerabilidades.

## Evidências locais

Arquivos em `.security-reports/` (ignorados pelo Git):

- `semgrep-before.json`: regras do GitGuard no commit original.
- `semgrep-gitguard.json`: mesmas regras após a alteração da validação.
- `semgrep-broad.json`: conjuntos amplos iniciais.
- `semgrep-final.json`: conjuntos amplos e regras upstream, incluindo testes.
- `trivy-before.json` e `trivy-after.json`: Trivy antes/depois.

### Repetir no PowerShell, a partir da raiz do projeto

As ferramentas abaixo estão instaladas localmente em `.security-tools/`, não no Git.

```powershell
$env:PYTHONUTF8 = '1'
& ./.security-tools/venv/Scripts/semgrep.exe scan --config .security-tools/rules --config p/security-audit --config p/javascript --config p/nodejs --metrics off --disable-version-check --json --output .security-reports/semgrep-final.json src public test
& ./.security-tools/trivy/trivy.exe fs --scanners vuln,secret,misconfig --skip-dirs .git --skip-dirs node_modules --skip-dirs .data --skip-dirs .security-tools --skip-dirs .security-reports --skip-files .env --cache-dir .security-tools/trivy-cache --format json --output .security-reports/trivy-after.json .
npm test
```

## Referências consultadas via Context7 e regras oficiais

- [Trivy — filesystem scan](https://github.com/aquasecurity/trivy/blob/main/docs/getting-started/index.md)
- [Semgrep — quickstart/Windows](https://github.com/semgrep/semgrep-docs/blob/main/docs/getting-started/quickstart.mdx)
- [Semgrep — exportação de resultados](https://github.com/semgrep/semgrep-docs/blob/main/docs/customize-semgrep-ce.mdx)
- [njsscan — regras de segredos](https://github.com/ajinabraham/njsscan/blob/master/njsscan/rules/semantic_grep/generic/hardcoded_secrets.yaml)
- [njsscan — regex_dos](https://github.com/ajinabraham/njsscan/blob/master/njsscan/rules/semantic_grep/dos/regex_dos.yaml)
- [Semgrep — RegExp dinâmica](https://github.com/semgrep/semgrep-rules/blob/develop/javascript/lang/security/audit/detect-non-literal-regexp.yaml)
