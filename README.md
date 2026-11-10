# Elevare Dev

Site institucional e painel administrativo da Elevare Dev.

## URLs
- Site público: https://elevare-dev.onrender.com
- Painel: https://elevare-dev.onrender.com/admin.html

## Infraestrutura
- Frontend: Render Static Site (deploy automático pelo branch main).
- Banco/Auth: Supabase, região São Paulo.
- Projeto Supabase: qggsjccidzvixjukaovl.
- config.js contém apenas URL e publishable key pública; nunca incluir service_role/secret key no navegador.

## Funcionalidades
- Formulário público salva leads no Supabase e abre WhatsApp.
- Admin com login e verificação de autorização no banco.
- Gestão de leads, clientes, projetos, propostas e pagamentos.
- RLS habilitado nas tabelas.

## Primeiro administrador
Por segurança, o cadastro público não cria administradores. Crie um usuário em Supabase Dashboard > Authentication > Users. Depois execute no SQL Editor, substituindo pelos dados reais:

```sql
insert into public.admin_users (user_id, email)
values ('UUID_DO_USUARIO_AUTH', 'EMAIL_DO_ADMIN')
on conflict (user_id) do nothing;
```

Depois acesse /admin.html e entre com a conta criada. Nunca coloque senha ou service_role no repositório.

## Segurança
A chave publishable é pública por definição. A proteção dos dados privados é feita por RLS e pela tabela admin_users. O usuário só consegue operar o CRM se estiver autorizado nessa tabela.
