begin;

-- First, inert slice of the reference-first drinking-window rollout. No
-- publisher, resolver, browser permission, or active reference is installed.
-- Publication stays blocked until evidence, group membership, and shadow
-- comparison gates exist.
create table public.drinking_window_reference_versions (
    id uuid primary key default gen_random_uuid(),
    version_number integer not null unique check (version_number > 0),
    status text not null default 'draft'
        check (status in ('draft', 'active', 'superseded')),
    content_sha256 text check (
        content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$'
    ),
    created_at timestamptz not null default now(),
    published_at timestamptz,
    constraint drinking_window_reference_versions_draft_check
        check (status <> 'draft' or published_at is null)
);

create unique index drinking_window_reference_versions_one_active_idx
    on public.drinking_window_reference_versions(status)
    where status = 'active';

create or replace function private.block_drinking_window_reference_publication()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if new.status <> 'draft' then
        raise exception using
            errcode = '23514',
            message = 'Drinking-window reference publication is not enabled';
    end if;
    return new;
end;
$$;

revoke execute on function private.block_drinking_window_reference_publication()
from public, anon, authenticated;

create trigger drinking_window_reference_versions_block_publication
before insert or update on public.drinking_window_reference_versions
for each row execute function private.block_drinking_window_reference_publication();


-- Group definitions are local to one scope, region, and colour. Membership
-- and evidence-backed eligibility will be added before publication opens.
create table public.drinking_window_ageing_groups (
    id uuid primary key default gen_random_uuid(),
    version_id uuid not null references public.drinking_window_reference_versions(id),
    scope text not null check (scope in ('producer_appellation', 'appellation', 'region')),
    region_id uuid not null references public.enrichment_places(id),
    wine_color text not null check (
        wine_color in ('red', 'white', 'rose', 'sparkling', 'sweet', 'fortified', 'other')
    ),
    group_key text not null check (length(trim(group_key)) > 0),
    definition text not null check (length(trim(definition)) > 0),
    created_at timestamptz not null default now(),
    constraint drinking_window_ageing_groups_key_unique
        unique (version_id, scope, region_id, wine_color, group_key),
    constraint drinking_window_ageing_groups_row_fk_unique
        unique (id, version_id, scope, region_id, wine_color)
);


-- Every reference row owns all four milestones. Two-year spreadsheet pairs
-- cannot be inserted here and can only enter the separate candidate queue.
create table public.drinking_window_reference_rows (
    id uuid primary key default gen_random_uuid(),
    version_id uuid not null references public.drinking_window_reference_versions(id),
    scope text not null check (scope in ('release', 'producer_appellation', 'appellation', 'region')),
    producer_id uuid references public.wine_reference_producers(id),
    product_id uuid references public.wine_reference_products(id),
    release_id uuid references public.wine_reference_releases(id),
    appellation_id uuid references public.enrichment_places(id),
    region_id uuid not null references public.enrichment_places(id),
    wine_color text not null check (
        wine_color in ('red', 'white', 'rose', 'sparkling', 'sweet', 'fortified', 'other')
    ),
    vintage_year integer not null check (vintage_year between 1800 and 2200),
    ageing_group_id uuid,
    all_at_scope boolean not null default false,
    first_trial_year integer not null,
    best_start_year integer not null,
    best_end_year integer not null,
    drink_by_year integer not null,
    rationale text not null check (length(trim(rationale)) > 0),
    created_at timestamptz not null default now(),
    constraint drinking_window_reference_rows_group_fk
        foreign key (ageing_group_id, version_id, scope, region_id, wine_color)
        references public.drinking_window_ageing_groups(id, version_id, scope, region_id, wine_color),
    constraint drinking_window_reference_rows_scope_shape_check check (
        (scope = 'release'
            and producer_id is not null and product_id is not null
            and release_id is not null and appellation_id is not null)
        or (scope = 'producer_appellation'
            and producer_id is not null and product_id is null
            and release_id is null and appellation_id is not null)
        or (scope = 'appellation'
            and producer_id is null and product_id is null
            and release_id is null and appellation_id is not null)
        or (scope = 'region'
            and producer_id is null and product_id is null
            and release_id is null and appellation_id is null)
    ),
    constraint drinking_window_reference_rows_applicability_check check (
        (scope = 'release' and all_at_scope and ageing_group_id is null)
        or (scope <> 'release' and (all_at_scope <> (ageing_group_id is not null)))
    ),
    constraint drinking_window_reference_rows_years_check check (
        vintage_year <= first_trial_year
        and first_trial_year <= best_start_year
        and best_start_year <= best_end_year
        and best_end_year <= drink_by_year
        and drink_by_year <= 2300
    )
);

create unique index drinking_window_reference_rows_key_unique
    on public.drinking_window_reference_rows (
        version_id, scope, region_id, wine_color, vintage_year,
        coalesce(producer_id, '00000000-0000-0000-0000-000000000000'::uuid),
        coalesce(product_id, '00000000-0000-0000-0000-000000000000'::uuid),
        coalesce(release_id, '00000000-0000-0000-0000-000000000000'::uuid),
        coalesce(appellation_id, '00000000-0000-0000-0000-000000000000'::uuid),
        coalesce(ageing_group_id, '00000000-0000-0000-0000-000000000000'::uuid)
    );

create index drinking_window_reference_rows_lookup_idx
    on public.drinking_window_reference_rows (
        version_id, region_id, wine_color, vintage_year, scope
    );

create or replace function private.require_draft_drinking_window_reference_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if tg_op <> 'INSERT' then
        if not exists (
            select 1 from public.drinking_window_reference_versions
            where id = old.version_id and status = 'draft'
        ) then
            raise exception using errcode = '23514',
                message = 'Published drinking-window reference rows are immutable';
        end if;
    end if;
    if tg_op <> 'DELETE' then
        if not exists (
            select 1 from public.drinking_window_reference_versions
            where id = new.version_id and status = 'draft'
        ) then
            raise exception using errcode = '23514',
                message = 'Drinking-window reference rows require a draft version';
        end if;
    end if;
    if tg_op = 'DELETE' then
        return old;
    end if;
    return new;
end;
$$;

revoke execute on function private.require_draft_drinking_window_reference_version()
from public, anon, authenticated;

create trigger drinking_window_reference_rows_draft_only
before insert or update or delete on public.drinking_window_reference_rows
for each row execute function private.require_draft_drinking_window_reference_version();

create trigger drinking_window_ageing_groups_draft_only
before insert or update or delete on public.drinking_window_ageing_groups
for each row execute function private.require_draft_drinking_window_reference_version();


-- The staging table keeps source coordinates and partial workbook years,
-- never private cellar records. A later importer will supply candidates.
create table public.drinking_window_candidates (
    id uuid primary key default gen_random_uuid(),
    source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
    source_locator text not null check (length(trim(source_locator)) > 0),
    candidate_scope text not null check (
        candidate_scope in ('release', 'producer_appellation', 'region', 'quarantine')
    ),
    source_identity jsonb not null check (jsonb_typeof(source_identity) = 'object'),
    wine_color text,
    vintage_year integer check (vintage_year between 1800 and 2200),
    first_trial_year integer,
    best_start_year integer,
    best_end_year integer,
    drink_by_year integer,
    review_status text not null default 'staged'
        check (review_status in ('staged', 'needs-review', 'rejected')),
    created_at timestamptz not null default now(),
    constraint drinking_window_candidates_source_unique
        unique (source_sha256, source_locator),
    constraint drinking_window_candidates_years_check check (
        (best_start_year is null or best_end_year is null
            or best_start_year <= best_end_year)
        and (first_trial_year is null or best_start_year is null
            or first_trial_year <= best_start_year)
        and (best_end_year is null or drink_by_year is null
            or best_end_year <= drink_by_year)
    )
);

alter table public.drinking_window_reference_versions enable row level security;
alter table public.drinking_window_ageing_groups enable row level security;
alter table public.drinking_window_reference_rows enable row level security;
alter table public.drinking_window_candidates enable row level security;

revoke all privileges on table
    public.drinking_window_reference_versions,
    public.drinking_window_ageing_groups,
    public.drinking_window_reference_rows,
    public.drinking_window_candidates
from public, anon, authenticated, powersync_role;

grant select, insert, update, delete on table
    public.drinking_window_reference_versions,
    public.drinking_window_ageing_groups,
    public.drinking_window_reference_rows,
    public.drinking_window_candidates
to service_role;

commit;
