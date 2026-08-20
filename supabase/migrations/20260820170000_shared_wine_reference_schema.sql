begin;

-- Shared wine identities are service-managed. Household wines retain their
-- imported or edited descriptions and may link to the most specific shared
-- identity currently known without copying provider data into the household.
create table public.wine_reference_entities (
    id uuid primary key default gen_random_uuid(),
    entity_type text not null,
    created_at timestamptz not null default now(),

    constraint wine_reference_entities_type_check
        check (
            entity_type in (
                'producer',
                'product',
                'release',
                'package'
            )
        ),

    constraint wine_reference_entities_typed_identity_unique
        unique (id, entity_type)
);

comment on table public.wine_reference_entities is
    'Stable CellarManager identities shared across households.';


create table public.wine_reference_producers (
    id uuid primary key,
    entity_type text not null default 'producer',
    canonical_name text not null,

    constraint wine_reference_producers_type_check
        check (entity_type = 'producer'),

    constraint wine_reference_producers_name_check
        check (length(trim(canonical_name)) > 0),

    constraint wine_reference_producers_entity_fk
        foreign key (id, entity_type)
        references public.wine_reference_entities(id, entity_type)
        on delete cascade
);


create table public.wine_reference_products (
    id uuid primary key,
    entity_type text not null default 'product',
    producer_id uuid not null
        references public.wine_reference_producers(id),
    canonical_name text not null,

    constraint wine_reference_products_type_check
        check (entity_type = 'product'),

    constraint wine_reference_products_name_check
        check (length(trim(canonical_name)) > 0),

    constraint wine_reference_products_entity_fk
        foreign key (id, entity_type)
        references public.wine_reference_entities(id, entity_type)
        on delete cascade
);

create index wine_reference_products_producer_id_idx
    on public.wine_reference_products(producer_id);


-- A vintage identifies a release directly. An NV release needs at least one
-- discriminator; an unidentified generic NV wine links at product level until
-- a base vintage, disgorgement, lot, or release label becomes known.
create table public.wine_reference_releases (
    id uuid primary key,
    entity_type text not null default 'release',
    product_id uuid not null
        references public.wine_reference_products(id),
    vintage_year integer,
    release_designator text,
    base_vintage_year integer,
    disgorged_on date,
    lot_code text,

    constraint wine_reference_releases_type_check
        check (entity_type = 'release'),

    constraint wine_reference_releases_vintage_check
        check (
            vintage_year is null
            or vintage_year between 1800 and 2200
        ),

    constraint wine_reference_releases_base_vintage_check
        check (
            base_vintage_year is null
            or base_vintage_year between 1800 and 2200
        ),

    constraint wine_reference_releases_designator_check
        check (
            release_designator is null
            or length(trim(release_designator)) > 0
        ),

    constraint wine_reference_releases_lot_code_check
        check (
            lot_code is null
            or length(trim(lot_code)) > 0
        ),

    constraint wine_reference_releases_identity_check
        check (
            vintage_year is not null
            or release_designator is not null
            or base_vintage_year is not null
            or disgorged_on is not null
            or lot_code is not null
        ),

    constraint wine_reference_releases_entity_fk
        foreign key (id, entity_type)
        references public.wine_reference_entities(id, entity_type)
        on delete cascade
);

create index wine_reference_releases_product_id_idx
    on public.wine_reference_releases(product_id);


-- volume_ml describes one contained unit; unit_count distinguishes a bottle
-- from a six- or twelve-bottle case without changing the release identity.
create table public.wine_reference_packages (
    id uuid primary key,
    entity_type text not null default 'package',
    release_id uuid not null
        references public.wine_reference_releases(id),
    container_type text not null default 'bottle',
    volume_ml integer not null,
    unit_count integer not null default 1,
    package_designator text,

    constraint wine_reference_packages_type_check
        check (entity_type = 'package'),

    constraint wine_reference_packages_container_check
        check (length(trim(container_type)) > 0),

    constraint wine_reference_packages_volume_check
        check (volume_ml > 0),

    constraint wine_reference_packages_unit_count_check
        check (unit_count > 0),

    constraint wine_reference_packages_designator_check
        check (
            package_designator is null
            or length(trim(package_designator)) > 0
        ),

    constraint wine_reference_packages_entity_fk
        foreign key (id, entity_type)
        references public.wine_reference_entities(id, entity_type)
        on delete cascade
);

create index wine_reference_packages_release_id_idx
    on public.wine_reference_packages(release_id);


-- The deferred shape check permits the root and typed row to be inserted in
-- either order within one transaction, but prevents committed orphan roots or
-- deletion of a typed row while its stable identity remains.
create or replace function private.validate_wine_reference_entity_shape()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
    v_entity_id uuid;
    v_entity_type text;
    v_has_typed_row boolean;
begin
    if tg_op = 'DELETE' then
        v_entity_id := old.id;
    else
        v_entity_id := new.id;
    end if;

    select entity.entity_type
    into v_entity_type
    from public.wine_reference_entities entity
    where entity.id = v_entity_id;

    if not found then
        return null;
    end if;

    v_has_typed_row := case v_entity_type
        when 'producer' then exists (
            select 1
            from public.wine_reference_producers producer
            where producer.id = v_entity_id
        )
        when 'product' then exists (
            select 1
            from public.wine_reference_products product
            where product.id = v_entity_id
        )
        when 'release' then exists (
            select 1
            from public.wine_reference_releases release
            where release.id = v_entity_id
        )
        when 'package' then exists (
            select 1
            from public.wine_reference_packages package
            where package.id = v_entity_id
        )
        else false
    end;

    if not v_has_typed_row then
        raise exception using
            errcode = '23514',
            message = 'Wine reference entity requires its matching typed row';
    end if;

    return null;
end;
$$;

revoke execute
    on function private.validate_wine_reference_entity_shape()
    from public, anon, authenticated;

create constraint trigger wine_reference_entities_shape
after insert or update on public.wine_reference_entities
deferrable initially deferred
for each row
execute function private.validate_wine_reference_entity_shape();

create constraint trigger wine_reference_producers_shape
after delete on public.wine_reference_producers
deferrable initially deferred
for each row
execute function private.validate_wine_reference_entity_shape();

create constraint trigger wine_reference_products_shape
after delete on public.wine_reference_products
deferrable initially deferred
for each row
execute function private.validate_wine_reference_entity_shape();

create constraint trigger wine_reference_releases_shape
after delete on public.wine_reference_releases
deferrable initially deferred
for each row
execute function private.validate_wine_reference_entity_shape();

create constraint trigger wine_reference_packages_shape
after delete on public.wine_reference_packages
deferrable initially deferred
for each row
execute function private.validate_wine_reference_entity_shape();


-- These are curated, shared aliases. Household-specific shorthand and match
-- decisions belong to the later matching workflow and never become global
-- aliases automatically.
create table public.wine_reference_aliases (
    id uuid primary key default gen_random_uuid(),
    entity_id uuid not null,
    entity_type text not null,
    alias_value text not null,
    normalized_value text not null,
    locale text,
    source_name text not null default 'cellarmanager',
    created_at timestamptz not null default now(),

    constraint wine_reference_aliases_entity_fk
        foreign key (entity_id, entity_type)
        references public.wine_reference_entities(id, entity_type)
        on delete cascade,

    constraint wine_reference_aliases_value_check
        check (length(trim(alias_value)) > 0),

    constraint wine_reference_aliases_normalized_check
        check (length(trim(normalized_value)) > 0),

    constraint wine_reference_aliases_locale_check
        check (locale is null or length(trim(locale)) > 0),

    constraint wine_reference_aliases_source_check
        check (length(trim(source_name)) > 0)
);

create index wine_reference_aliases_lookup_idx
    on public.wine_reference_aliases(normalized_value, entity_type);

create unique index wine_reference_aliases_source_unique
    on public.wine_reference_aliases (
        entity_id,
        normalized_value,
        coalesce(locale, ''),
        lower(source_name)
    );


create table public.wine_reference_external_identifiers (
    id uuid primary key default gen_random_uuid(),
    entity_id uuid not null,
    entity_type text not null,
    authority text not null,
    identifier_scheme text not null,
    identifier_value text not null,
    canonical_url text,
    created_at timestamptz not null default now(),

    constraint wine_reference_external_identifiers_entity_fk
        foreign key (entity_id, entity_type)
        references public.wine_reference_entities(id, entity_type),

    constraint wine_reference_external_identifiers_authority_check
        check (
            length(authority) > 0
            and authority = lower(trim(authority))
        ),

    constraint wine_reference_external_identifiers_scheme_check
        check (
            length(identifier_scheme) > 0
            and identifier_scheme = upper(trim(identifier_scheme))
        ),

    constraint wine_reference_external_identifiers_value_check
        check (
            length(identifier_value) > 0
            and identifier_value = trim(identifier_value)
        ),

    constraint wine_reference_external_identifiers_url_check
        check (
            canonical_url is null
            or length(trim(canonical_url)) > 0
        ),

    constraint wine_reference_external_identifiers_lwin_scope_check
        check (
            authority <> 'liv-ex'
            or identifier_scheme not in ('LWIN7', 'LWIN11', 'LWIN16')
            or (
                identifier_scheme = 'LWIN7'
                and entity_type = 'product'
                and identifier_value ~ '^[0-9]{7}$'
            )
            or (
                identifier_scheme = 'LWIN11'
                and entity_type = 'release'
                and identifier_value ~ '^[0-9]{11}$'
            )
            or (
                identifier_scheme = 'LWIN16'
                and entity_type = 'package'
                and identifier_value ~ '^[0-9]{16}$'
            )
        ),

    constraint wine_reference_external_identifiers_gtin_scope_check
        check (
            identifier_scheme not like 'GTIN%'
            or entity_type = 'package'
        ),

    constraint wine_reference_external_identifiers_authority_unique
        unique (authority, identifier_scheme, identifier_value)
);

create index wine_reference_external_identifiers_entity_id_idx
    on public.wine_reference_external_identifiers(entity_id);


-- A merge redirects a duplicate identity to its canonical identity. A
-- successor links a historical identity to a later one without asserting that
-- both are the same producer or wine. Household foreign keys remain unchanged.
create table public.wine_reference_supersessions (
    predecessor_entity_id uuid primary key,
    successor_entity_id uuid not null,
    entity_type text not null,
    relationship_type text not null,
    reason text,
    created_at timestamptz not null default now(),

    constraint wine_reference_supersessions_predecessor_fk
        foreign key (predecessor_entity_id, entity_type)
        references public.wine_reference_entities(id, entity_type)
        on delete cascade,

    constraint wine_reference_supersessions_successor_fk
        foreign key (successor_entity_id, entity_type)
        references public.wine_reference_entities(id, entity_type),

    constraint wine_reference_supersessions_distinct_check
        check (predecessor_entity_id <> successor_entity_id),

    constraint wine_reference_supersessions_relationship_check
        check (relationship_type in ('merge', 'successor')),

    constraint wine_reference_supersessions_reason_check
        check (reason is null or length(trim(reason)) > 0)
);

create index wine_reference_supersessions_successor_id_idx
    on public.wine_reference_supersessions(successor_entity_id);


create or replace function private.prevent_wine_reference_supersession_cycle()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if tg_op = 'UPDATE'
       and new.predecessor_entity_id is distinct from old.predecessor_entity_id
    then
        raise exception using
            errcode = '22023',
            message = 'A wine reference predecessor cannot be changed';
    end if;

    if exists (
        with recursive successors(entity_id) as (
            select new.successor_entity_id

            union

            select supersession.successor_entity_id
            from public.wine_reference_supersessions supersession
            join successors
              on successors.entity_id =
                    supersession.predecessor_entity_id
            where supersession.predecessor_entity_id <>
                    new.predecessor_entity_id
        )
        select 1
        from successors
        where entity_id = new.predecessor_entity_id
    ) then
        raise exception using
            errcode = '23514',
            message = 'Wine reference supersession would create a cycle';
    end if;

    return new;
end;
$$;

revoke execute
    on function private.prevent_wine_reference_supersession_cycle()
    from public, anon, authenticated;

create trigger wine_reference_supersessions_prevent_cycle
before insert or update on public.wine_reference_supersessions
for each row
execute function private.prevent_wine_reference_supersession_cycle();


-- A household wine can link at product, release, or package specificity. It
-- cannot link to a producer alone, and its user-owned fields remain unchanged.
alter table public.wines
    add column wine_reference_id uuid,
    add column wine_reference_type text,
    add constraint wines_reference_shape_check
        check (
            (
                wine_reference_id is null
                and wine_reference_type is null
            )
            or (
                wine_reference_id is not null
                and wine_reference_type in (
                    'product',
                    'release',
                    'package'
                )
            )
        ),
    add constraint wines_reference_entity_fk
        foreign key (wine_reference_id, wine_reference_type)
        references public.wine_reference_entities(id, entity_type);

create index wines_wine_reference_id_idx
    on public.wines(wine_reference_id)
    where wine_reference_id is not null;

comment on column public.wines.wine_reference_id is
    'Optional shared identity; household wine fields remain authoritative for display and inventory.';
comment on column public.wines.wine_reference_type is
    'Specificity of wine_reference_id: product, release, or package.';


-- Reference-library tables are reachable by trusted server code but are not
-- browser-readable and are not part of the PowerSync publication. Later steps
-- expose only reviewed household projections and permitted attribution.
alter table public.wine_reference_entities enable row level security;
alter table public.wine_reference_producers enable row level security;
alter table public.wine_reference_products enable row level security;
alter table public.wine_reference_releases enable row level security;
alter table public.wine_reference_packages enable row level security;
alter table public.wine_reference_aliases enable row level security;
alter table public.wine_reference_external_identifiers enable row level security;
alter table public.wine_reference_supersessions enable row level security;

revoke all privileges on table
    public.wine_reference_entities,
    public.wine_reference_producers,
    public.wine_reference_products,
    public.wine_reference_releases,
    public.wine_reference_packages,
    public.wine_reference_aliases,
    public.wine_reference_external_identifiers,
    public.wine_reference_supersessions
from public, anon, authenticated, powersync_role;

grant select, insert, update, delete on table
    public.wine_reference_entities,
    public.wine_reference_producers,
    public.wine_reference_products,
    public.wine_reference_releases,
    public.wine_reference_packages,
    public.wine_reference_aliases,
    public.wine_reference_external_identifiers,
    public.wine_reference_supersessions
to service_role;

commit;
