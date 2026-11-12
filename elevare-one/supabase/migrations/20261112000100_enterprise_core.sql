-- ELEVARE ONE — isolated enterprise schema
-- Apply only to the dedicated ELEVARE ONE Supabase project.
begin;

create extension if not exists pgcrypto;
create schema if not exists private;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 160),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,78}[a-z0-9]$'),
  status text not null default 'active' check (status in ('active','suspended','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','admin','manager','member','viewer')),
  status text not null default 'active' check (status in ('invited','active','suspended')),
  created_at timestamptz not null default now(),
  unique (organization_id,user_id)
);
create index if not exists organization_members_user_idx on public.organization_members(user_id, status);
create index if not exists organization_members_org_idx on public.organization_members(organization_id, status);

create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 120),
  code text,
  manager_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, name),
  unique (organization_id, code)
);

create table if not exists public.kpis (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 160),
  code text not null check (code ~ '^[A-Z0-9_-]{2,40}$'),
  unit text,
  current_value numeric(20,4),
  target_value numeric(20,4),
  period_start date,
  period_end date,
  status text not null default 'active' check (status in ('active','paused','archived')),
  owner_user_id uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id,code),
  check (period_end is null or period_start is null or period_end >= period_start)
);

create table if not exists public.workflows (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 160),
  description text,
  status text not null default 'draft' check (status in ('draft','active','paused','archived')),
  trigger_type text not null default 'manual' check (trigger_type in ('manual','webhook','schedule')),
  definition jsonb not null default '{"version":1,"steps":[]}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists workflows_org_created_idx on public.workflows(organization_id,created_at desc);

create table if not exists public.workflow_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  workflow_id uuid not null references public.workflows(id) on delete restrict,
  status text not null default 'queued' check (status in ('queued','running','succeeded','failed','canceled')),
  input jsonb not null default '{}'::jsonb,
  output jsonb,
  error_message text,
  initiated_by uuid references auth.users(id) on delete set null,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists workflow_runs_org_created_idx on public.workflow_runs(organization_id,created_at desc);
create index if not exists workflow_runs_workflow_idx on public.workflow_runs(workflow_id,created_at desc);

create table if not exists public.integrations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 160),
  provider text not null check (char_length(provider) between 2 and 100),
  endpoint_url text not null check (endpoint_url ~ '^https://'),
  status text not null default 'pending' check (status in ('pending','connected','degraded','disabled','error')),
  auth_type text not null default 'managed' check (auth_type in ('managed','oauth2','api_key','basic','none')),
  last_synced_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists integrations_org_created_idx on public.integrations(organization_id,created_at desc);

create table if not exists public.integration_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  integration_id uuid not null references public.integrations(id) on delete cascade,
  event_type text not null,
  status text not null check (status in ('received','processed','failed','retried','ignored')),
  request_id text,
  error_summary text,
  occurred_at timestamptz not null default now()
);
create index if not exists integration_events_org_time_idx on public.integration_events(organization_id,occurred_at desc);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_logs_org_time_idx on public.audit_logs(organization_id,created_at desc);

-- Membership predicates live in a non-exposed schema. They only answer authorization
-- questions for the authenticated principal and expose no membership data.
create or replace function private.is_org_member(_org uuid)
returns boolean language sql stable security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1 from public.organization_members m
    where m.organization_id = _org and m.user_id = auth.uid() and m.status = 'active'
  );
$$;

create or replace function private.has_org_role(_org uuid, _roles text[])
returns boolean language sql stable security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1 from public.organization_members m
    where m.organization_id = _org and m.user_id = auth.uid()
      and m.status = 'active' and m.role = any(_roles)
  );
$$;

revoke all on function private.is_org_member(uuid) from public, anon;
revoke all on function private.has_org_role(uuid,text[]) from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.is_org_member(uuid) to authenticated;
grant execute on function private.has_org_role(uuid,text[]) to authenticated;

-- Internal audit trigger. It does not accept client-supplied actor identities.
create or replace function private.write_audit_log()
returns trigger language plpgsql security definer
set search_path = ''
as $$
declare
  _org uuid;
  _id uuid;
  _action text;
begin
  _org := coalesce(new.organization_id, old.organization_id);
  _id := coalesce(new.id, old.id);
  _action := lower(tg_op);
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
  values (_org, auth.uid(), _action, tg_table_name, _id,
    jsonb_build_object('source','database_trigger'));
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function private.write_audit_log() from public, anon, authenticated;

drop trigger if exists audit_kpis on public.kpis;
create trigger audit_kpis after insert or update or delete on public.kpis for each row execute function private.write_audit_log();
drop trigger if exists audit_workflows on public.workflows;
create trigger audit_workflows after insert or update or delete on public.workflows for each row execute function private.write_audit_log();
drop trigger if exists audit_integrations on public.integrations;
create trigger audit_integrations after insert or update or delete on public.integrations for each row execute function private.write_audit_log();

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.departments enable row level security;
alter table public.kpis enable row level security;
alter table public.workflows enable row level security;
alter table public.workflow_runs enable row level security;
alter table public.integrations enable row level security;
alter table public.integration_events enable row level security;
alter table public.audit_logs enable row level security;

create policy organizations_select_member on public.organizations for select to authenticated using (private.is_org_member(id));
create policy organizations_update_owner on public.organizations for update to authenticated using (private.has_org_role(id,array['owner'])) with check (private.has_org_role(id,array['owner']));

create policy members_select_org on public.organization_members for select to authenticated using (private.is_org_member(organization_id));
create policy members_manage_admin on public.organization_members for all to authenticated
using (private.has_org_role(organization_id,array['owner','admin']))
with check (private.has_org_role(organization_id,array['owner','admin']));

create policy departments_select_org on public.departments for select to authenticated using (private.is_org_member(organization_id));
create policy departments_manage_admin on public.departments for all to authenticated
using (private.has_org_role(organization_id,array['owner','admin','manager']))
with check (private.has_org_role(organization_id,array['owner','admin','manager']));

create policy kpis_select_org on public.kpis for select to authenticated using (private.is_org_member(organization_id));
create policy kpis_insert_org on public.kpis for insert to authenticated with check (private.has_org_role(organization_id,array['owner','admin','manager']));
create policy kpis_update_org on public.kpis for update to authenticated using (private.has_org_role(organization_id,array['owner','admin','manager'])) with check (private.has_org_role(organization_id,array['owner','admin','manager']));
create policy kpis_delete_org on public.kpis for delete to authenticated using (private.has_org_role(organization_id,array['owner','admin']));

create policy workflows_select_org on public.workflows for select to authenticated using (private.is_org_member(organization_id));
create policy workflows_insert_org on public.workflows for insert to authenticated with check (private.has_org_role(organization_id,array['owner','admin','manager']));
create policy workflows_update_org on public.workflows for update to authenticated using (private.has_org_role(organization_id,array['owner','admin','manager'])) with check (private.has_org_role(organization_id,array['owner','admin','manager']));
create policy workflows_delete_org on public.workflows for delete to authenticated using (private.has_org_role(organization_id,array['owner','admin']));

create policy workflow_runs_select_org on public.workflow_runs for select to authenticated using (private.is_org_member(organization_id));
create policy workflow_runs_insert_org on public.workflow_runs for insert to authenticated with check (private.has_org_role(organization_id,array['owner','admin','manager']));
create policy workflow_runs_update_org on public.workflow_runs for update to authenticated using (private.has_org_role(organization_id,array['owner','admin'])) with check (private.has_org_role(organization_id,array['owner','admin']));

create policy integrations_select_org on public.integrations for select to authenticated using (private.is_org_member(organization_id));
create policy integrations_insert_org on public.integrations for insert to authenticated with check (private.has_org_role(organization_id,array['owner','admin']));
create policy integrations_update_org on public.integrations for update to authenticated using (private.has_org_role(organization_id,array['owner','admin'])) with check (private.has_org_role(organization_id,array['owner','admin']));
create policy integrations_delete_org on public.integrations for delete to authenticated using (private.has_org_role(organization_id,array['owner','admin']));

create policy integration_events_select_org on public.integration_events for select to authenticated using (private.is_org_member(organization_id));
create policy audit_logs_select_org on public.audit_logs for select to authenticated using (private.is_org_member(organization_id));

-- Browser clients cannot write audit records or integration events directly.
revoke all on public.audit_logs from anon, authenticated;
grant select on public.audit_logs to authenticated;
revoke all on public.integration_events from anon, authenticated;
grant select on public.integration_events to authenticated;

grant select on public.organizations, public.organization_members, public.departments,
  public.kpis, public.workflows, public.workflow_runs, public.integrations to authenticated;
grant insert, update, delete on public.departments, public.kpis, public.workflows, public.workflow_runs, public.integrations to authenticated;

commit;
