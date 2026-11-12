# ELEVARE ONE

Enterprise Operating Platform — fundação inicial com os módulos CONTROL, FLOW e CONNECT.

## Estrutura
- `index.html`: interface de acesso e workspace.
- `styles.css`: sistema visual responsivo.
- `app.js`: autenticação e consultas do workspace.
- `config.example.js`: modelo de configuração pública do Supabase.
- `supabase/migrations/`: esquema e políticas de banco.

## Configuração
1. Criar um projeto Supabase independente para o ELEVARE ONE.
2. Aplicar a migration SQL em `supabase/migrations`.
3. Criar um usuário corporativo pelo fluxo administrativo controlado.
4. Provisionar organização e associação do usuário por operação administrativa segura.
5. Copiar `config.example.js` para `config.js` e preencher somente URL e publishable key.
6. Publicar o diretório como raiz de um serviço estático separado.

Não habilitar cadastro público. Não inserir service_role/secret key no navegador ou repositório.

## Estado
Fundação de interface e esquema em desenvolvimento. Não é ambiente de produção até concluir provisionamento, testes de segurança, integração e deploy.
