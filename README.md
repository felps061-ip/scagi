# SCAGI

MVP do **Sistema Centralizado de Averbadoras do Grupo Império**. O Portal do Consignado possui um pool de acessos para Estado de São Paulo/PMESP e uma sessão isolada para Prefeitura de São Paulo.

## O que já está implementado

- login próprio do SCAGI, com sessão HTTP-only;
- múltiplos usuários com perfis de administrador e vendedor;
- conexões dos portais compartilhadas no servidor entre todos os vendedores;
- seleção da averbadora e entrada de CPF com validação;
- modo de demonstração sem acesso a dados reais;
- integração real via navegador controlado pelo backend;
- CAPTCHA com resolução humana, sem automação ou contorno;
- extração do painel **Margem Disponível - Total / Provimento 1**;
- sessão e fila independentes para cada acesso do portal;
- rodízio automático das consultas Gov SP entre os acessos estaduais conectados;
- histórico em memória com CPF mascarado;
- credenciais do portal mantidas fora do frontend e do Git.

## Executar em demonstração

Requer Node.js 22 ou superior.

```powershell
npm start
```

Acesse `http://127.0.0.1:3000`. Sem arquivo `.env`, o acesso de desenvolvimento é `admin` / `scagi-demo` e o Portal do Consignado usa dados simulados.

Para cadastrar vários usuários, defina `APP_USERS_JSON` no `.env`. Todos os usuários autenticados podem conectar ou reconectar os portais e usar as conexões globais já abertas:

```env
APP_USERS_JSON=[{"username":"admin","password":"senha-forte-admin","role":"admin"},{"username":"vendedor1","password":"senha-forte-vendedor","role":"operator"}]
```

As sessões dos portais pertencem ao processo do servidor SCAGI, não ao login individual. Assim, quando qualquer usuário conecta um portal, todos os vendedores autenticados nesse mesmo servidor passam a enxergá-lo conectado.

O administrador pode abrir **Vendedores** no menu para criar logins, redefinir senhas e remover acessos. As senhas são derivadas com `scrypt` e persistidas somente como hash em `.data/users.json`, arquivo ignorado pelo Git. Redefinir uma senha ou remover um vendedor encerra as sessões atuais desse usuário.

Para testar uma consulta, use um CPF matematicamente válido, por exemplo `529.982.247-25`. Nenhum dado desse CPF é enviado a um portal enquanto `PORTAL_MODE=mock`.

## Ativar o Portal do Consignado

1. Copie `.env.example` para `.env`.
2. Defina uma senha forte para o SCAGI e uma chave aleatória com pelo menos 32 caracteres.
3. Defina `PORTAL_MODE=real` e preencha as credenciais dos dois acessos estaduais e do acesso municipal.
4. Instale as dependências: `npm install`.
5. Mantenha `PORTAL_BROWSER_CHANNEL=chrome` se o Google Chrome estiver instalado. Para usar o Chromium do Playwright, deixe a variável vazia e execute `npx playwright install chromium`.
6. Inicie com `npm start`, entre no SCAGI, abra **Integrações** e conclua o CAPTCHA.

O arquivo `.env` é ignorado pelo Git. Não coloque credenciais em arquivos versionados nem no código-fonte.

## Testes

```powershell
npm test
```

## Arquitetura do primeiro MVP

O servidor Node entrega a interface, autentica o operador e mantém uma sessão de navegador isolada para cada credencial. Cada acesso possui sua própria fila porque a página do Portal do Consignado é stateful e usa Apache Wicket. Para Gov SP, o serviço escolhe os acessos conectados em round-robin; se somente um estiver conectado, ele recebe todas as consultas. O adaptador evita IDs temporários gerados pelo Wicket e usa seletores estáveis como `#cpfServidor`, o nome do botão de pesquisa e o escopo `#painelMargensDisponiveis`.

O histórico e as sessões do SCAGI ainda ficam em memória. Antes de uso com múltiplos operadores em produção, o próximo passo é adicionar banco de dados, perfis/permissões, criptografia de credenciais em repouso, logs de auditoria duráveis, HTTPS e uma política de retenção compatível com a LGPD.
