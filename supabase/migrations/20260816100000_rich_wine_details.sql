begin;

-- v0.4 rich details extend a wine reference. They never participate in the
-- conservative physical identity used by inventory matching.
alter table public.wines
    add column country text,
    add column region text,
    add column classification text,
    add column vineyard text,
    add column sweetness text,
    add column alcohol_abv numeric(4, 2),
    add column drink_from_year integer,
    add column drink_until_year integer,
    add column serving_temperature_min_c numeric(4, 1),
    add column serving_temperature_max_c numeric(4, 1),
    add column serving_guidance text,
    add constraint wines_country_check
        check (country is null or length(trim(country)) > 0),
    add constraint wines_region_check
        check (region is null or length(trim(region)) > 0),
    add constraint wines_classification_check
        check (
            classification is null
            or length(trim(classification)) > 0
        ),
    add constraint wines_vineyard_check
        check (vineyard is null or length(trim(vineyard)) > 0),
    add constraint wines_sweetness_check
        check (sweetness is null or length(trim(sweetness)) > 0),
    add constraint wines_alcohol_abv_check
        check (
            alcohol_abv is null
            or (alcohol_abv >= 0 and alcohol_abv <= 100)
        ),
    add constraint wines_drink_from_year_check
        check (
            drink_from_year is null
            or drink_from_year between 1800 and 2400
        ),
    add constraint wines_drink_until_year_check
        check (
            drink_until_year is null
            or drink_until_year between 1800 and 2400
        ),
    add constraint wines_drinking_window_check
        check (
            drink_from_year is null
            or drink_until_year is null
            or drink_from_year <= drink_until_year
        ),
    add constraint wines_serving_temperature_min_check
        check (
            serving_temperature_min_c is null
            or serving_temperature_min_c between 0 and 40
        ),
    add constraint wines_serving_temperature_max_check
        check (
            serving_temperature_max_c is null
            or serving_temperature_max_c between 0 and 40
        ),
    add constraint wines_serving_temperature_range_check
        check (
            serving_temperature_min_c is null
            or serving_temperature_max_c is null
            or serving_temperature_min_c
                <= serving_temperature_max_c
        ),
    add constraint wines_serving_guidance_check
        check (
            serving_guidance is null
            or length(trim(serving_guidance)) > 0
        );

comment on column public.wines.country is
    'Display country; metadata only and never part of wine identity.';
comment on column public.wines.region is
    'Display region; metadata only and never part of wine identity.';
comment on column public.wines.drink_from_year is
    'Inclusive beginning of the recommended drinking window.';
comment on column public.wines.drink_until_year is
    'Inclusive end of the recommended drinking window.';


-- A note is personal to a household member. Shared reference facts belong on
-- wines or their normalized child tables instead.
create table public.wine_notes (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null,
    wine_id uuid not null,
    user_id uuid not null,
    notes text not null check (length(trim(notes)) > 0),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint wine_notes_wine_fk
        foreign key (wine_id, household_id)
        references public.wines(id, household_id)
        on delete cascade,

    constraint wine_notes_membership_fk
        foreign key (household_id, user_id)
        references public.household_members(household_id, user_id)
        on delete cascade,

    constraint wine_notes_member_wine_unique
        unique (wine_id, user_id)
);

create index wine_notes_household_id_idx
    on public.wine_notes(household_id);
create index wine_notes_user_id_idx
    on public.wine_notes(user_id);


create table public.wine_grape_components (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null,
    wine_id uuid not null,
    grape_name text not null
        check (length(trim(grape_name)) > 0),
    percentage numeric(5, 2)
        check (
            percentage is null
            or (percentage > 0 and percentage <= 100)
        ),
    display_order integer not null default 0
        check (display_order >= 0),
    created_at timestamptz not null default now(),

    constraint wine_grape_components_wine_fk
        foreign key (wine_id, household_id)
        references public.wines(id, household_id)
        on delete cascade
);

create index wine_grape_components_household_id_idx
    on public.wine_grape_components(household_id);
create index wine_grape_components_wine_id_idx
    on public.wine_grape_components(wine_id);
create unique index wine_grape_components_wine_name_unique
    on public.wine_grape_components (
        wine_id,
        lower(
            regexp_replace(
                trim(grape_name),
                '[[:space:]]+',
                ' ',
                'g'
            )
        )
    );


create table public.wine_food_pairings (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null,
    wine_id uuid not null,
    pairing text not null check (length(trim(pairing)) > 0),
    display_order integer not null default 0
        check (display_order >= 0),
    created_at timestamptz not null default now(),

    constraint wine_food_pairings_wine_fk
        foreign key (wine_id, household_id)
        references public.wines(id, household_id)
        on delete cascade
);

create index wine_food_pairings_household_id_idx
    on public.wine_food_pairings(household_id);
create index wine_food_pairings_wine_id_idx
    on public.wine_food_pairings(wine_id);
create unique index wine_food_pairings_wine_value_unique
    on public.wine_food_pairings (
        wine_id,
        lower(
            regexp_replace(
                trim(pairing),
                '[[:space:]]+',
                ' ',
                'g'
            )
        )
    );


create table public.wine_certifications (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null,
    wine_id uuid not null,
    certification text not null
        check (length(trim(certification)) > 0),
    display_order integer not null default 0
        check (display_order >= 0),
    created_at timestamptz not null default now(),

    constraint wine_certifications_wine_fk
        foreign key (wine_id, household_id)
        references public.wines(id, household_id)
        on delete cascade
);

create index wine_certifications_household_id_idx
    on public.wine_certifications(household_id);
create index wine_certifications_wine_id_idx
    on public.wine_certifications(wine_id);
create unique index wine_certifications_wine_value_unique
    on public.wine_certifications (
        wine_id,
        lower(
            regexp_replace(
                trim(certification),
                '[[:space:]]+',
                ' ',
                'g'
            )
        )
    );


create table public.wine_external_identifiers (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null,
    wine_id uuid not null,
    identifier_scheme text not null
        check (length(trim(identifier_scheme)) > 0),
    identifier_value text not null
        check (length(trim(identifier_value)) > 0),
    external_url text
        check (
            external_url is null
            or length(trim(external_url)) > 0
        ),
    created_at timestamptz not null default now(),

    constraint wine_external_identifiers_wine_fk
        foreign key (wine_id, household_id)
        references public.wines(id, household_id)
        on delete cascade
);

create index wine_external_identifiers_household_id_idx
    on public.wine_external_identifiers(household_id);
create index wine_external_identifiers_wine_id_idx
    on public.wine_external_identifiers(wine_id);
create unique index wine_external_identifiers_household_value_unique
    on public.wine_external_identifiers (
        household_id,
        lower(trim(identifier_scheme)),
        trim(identifier_value)
    );


-- Provenance is append-only history with one current row per logical field.
-- value_snapshot makes the record self-describing even after a later edit.
create table public.wine_field_provenance (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null,
    wine_id uuid not null,
    field_name text not null,
    source_kind text not null,
    source_name text,
    source_reference text,
    source_url text,
    value_snapshot jsonb not null,
    confidence numeric(5, 4),
    retrieved_at timestamptz,
    applied_at timestamptz not null default now(),
    applied_by uuid
        references auth.users(id)
        on delete set null,
    is_current boolean not null default true,

    constraint wine_field_provenance_wine_fk
        foreign key (wine_id, household_id)
        references public.wines(id, household_id)
        on delete cascade,

    constraint wine_field_provenance_field_check
        check (
            field_name in (
                'producer',
                'cuvee',
                'vintage',
                'color',
                'appellation',
                'area',
                'format_ml',
                'country',
                'region',
                'classification',
                'vineyard',
                'sweetness',
                'alcohol_abv',
                'drink_from_year',
                'drink_until_year',
                'serving_temperature_min_c',
                'serving_temperature_max_c',
                'serving_guidance',
                'grape_composition',
                'food_pairings',
                'certifications',
                'external_identifiers'
            )
        ),

    constraint wine_field_provenance_source_kind_check
        check (
            source_kind in (
                'unattributed',
                'manual',
                'csv_import',
                'legacy',
                'provider'
            )
        ),

    constraint wine_field_provenance_source_name_check
        check (
            source_name is null
            or length(trim(source_name)) > 0
        ),

    constraint wine_field_provenance_source_reference_check
        check (
            source_reference is null
            or length(trim(source_reference)) > 0
        ),

    constraint wine_field_provenance_source_url_check
        check (
            source_url is null
            or length(trim(source_url)) > 0
        ),

    constraint wine_field_provenance_confidence_check
        check (
            confidence is null
            or (confidence >= 0 and confidence <= 1)
        ),

    constraint wine_field_provenance_provider_shape_check
        check (
            source_kind <> 'provider'
            or (
                source_name is not null
                and retrieved_at is not null
            )
        )
);

create index wine_field_provenance_household_id_idx
    on public.wine_field_provenance(household_id);
create index wine_field_provenance_wine_id_idx
    on public.wine_field_provenance(wine_id);
create unique index wine_field_provenance_current_unique
    on public.wine_field_provenance(wine_id, field_name)
    where is_current;


-- Mutation RPCs use this helper so the value and its source change in the same
-- transaction. Browser roles never receive direct execute permission.
create or replace function private.replace_wine_field_provenance(
    p_household_id uuid,
    p_wine_id uuid,
    p_field_name text,
    p_value_snapshot jsonb,
    p_source_kind text,
    p_source_name text,
    p_source_reference text,
    p_source_url text,
    p_confidence numeric,
    p_retrieved_at timestamptz,
    p_applied_by uuid
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
    v_provenance_id uuid;
begin
    perform 1
    from public.wines wine
    where wine.id = p_wine_id
      and wine.household_id = p_household_id
    for update;

    if not found then
        raise exception using
            errcode = '22023',
            message = 'Wine was not found in the household';
    end if;

    update public.wine_field_provenance
    set is_current = false
    where wine_id = p_wine_id
      and field_name = p_field_name
      and is_current;

    insert into public.wine_field_provenance (
        household_id,
        wine_id,
        field_name,
        source_kind,
        source_name,
        source_reference,
        source_url,
        value_snapshot,
        confidence,
        retrieved_at,
        applied_by
    )
    values (
        p_household_id,
        p_wine_id,
        p_field_name,
        p_source_kind,
        p_source_name,
        p_source_reference,
        p_source_url,
        p_value_snapshot,
        p_confidence,
        p_retrieved_at,
        p_applied_by
    )
    returning id into v_provenance_id;

    return v_provenance_id;
end;
$$;

revoke execute
    on function private.replace_wine_field_provenance(
        uuid,
        uuid,
        text,
        jsonb,
        text,
        text,
        text,
        text,
        numeric,
        timestamptz,
        uuid
    )
    from public, anon, authenticated;


create or replace function private.initialize_wine_provenance()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    perform private.replace_wine_field_provenance(
        new.household_id,
        new.id,
        'producer',
        pg_catalog.to_jsonb(new.producer),
        'unattributed',
        null,
        null,
        null,
        null,
        null,
        null
    );

    perform private.replace_wine_field_provenance(
        new.household_id,
        new.id,
        'cuvee',
        pg_catalog.to_jsonb(new.cuvee),
        'unattributed',
        null,
        null,
        null,
        null,
        null,
        null
    );

    if new.vintage is not null then
        perform private.replace_wine_field_provenance(
            new.household_id,
            new.id,
            'vintage',
            pg_catalog.to_jsonb(new.vintage),
            'unattributed',
            null,
            null,
            null,
            null,
            null,
            null
        );
    end if;

    perform private.replace_wine_field_provenance(
        new.household_id,
        new.id,
        'color',
        pg_catalog.to_jsonb(new.color),
        'unattributed',
        null,
        null,
        null,
        null,
        null,
        null
    );

    if new.appellation is not null then
        perform private.replace_wine_field_provenance(
            new.household_id,
            new.id,
            'appellation',
            pg_catalog.to_jsonb(new.appellation),
            'unattributed',
            null,
            null,
            null,
            null,
            null,
            null
        );
    end if;

    if new.area is not null then
        perform private.replace_wine_field_provenance(
            new.household_id,
            new.id,
            'area',
            pg_catalog.to_jsonb(new.area),
            'unattributed',
            null,
            null,
            null,
            null,
            null,
            null
        );
    end if;

    perform private.replace_wine_field_provenance(
        new.household_id,
        new.id,
        'format_ml',
        pg_catalog.to_jsonb(new.format_ml),
        'unattributed',
        null,
        null,
        null,
        null,
        null,
        null
    );

    return new;
end;
$$;

create trigger wines_initialize_provenance
after insert on public.wines
for each row
execute function private.initialize_wine_provenance();


create or replace function private.track_wine_core_provenance()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
    v_user_id uuid := (select auth.uid());
    v_source_kind text :=
        case
            when v_user_id is null then 'unattributed'
            else 'manual'
        end;
begin
    if new.producer is distinct from old.producer then
        perform private.replace_wine_field_provenance(
            new.household_id,
            new.id,
            'producer',
            pg_catalog.to_jsonb(new.producer),
            v_source_kind,
            null,
            null,
            null,
            null,
            null,
            v_user_id
        );
    end if;

    if new.cuvee is distinct from old.cuvee then
        perform private.replace_wine_field_provenance(
            new.household_id,
            new.id,
            'cuvee',
            pg_catalog.to_jsonb(new.cuvee),
            v_source_kind,
            null,
            null,
            null,
            null,
            null,
            v_user_id
        );
    end if;

    if new.vintage is distinct from old.vintage then
        perform private.replace_wine_field_provenance(
            new.household_id,
            new.id,
            'vintage',
            coalesce(
                pg_catalog.to_jsonb(new.vintage),
                'null'::jsonb
            ),
            v_source_kind,
            null,
            null,
            null,
            null,
            null,
            v_user_id
        );
    end if;

    if new.color is distinct from old.color then
        perform private.replace_wine_field_provenance(
            new.household_id,
            new.id,
            'color',
            pg_catalog.to_jsonb(new.color),
            v_source_kind,
            null,
            null,
            null,
            null,
            null,
            v_user_id
        );
    end if;

    if new.appellation is distinct from old.appellation then
        perform private.replace_wine_field_provenance(
            new.household_id,
            new.id,
            'appellation',
            coalesce(
                pg_catalog.to_jsonb(new.appellation),
                'null'::jsonb
            ),
            v_source_kind,
            null,
            null,
            null,
            null,
            null,
            v_user_id
        );
    end if;

    if new.area is distinct from old.area then
        perform private.replace_wine_field_provenance(
            new.household_id,
            new.id,
            'area',
            coalesce(
                pg_catalog.to_jsonb(new.area),
                'null'::jsonb
            ),
            v_source_kind,
            null,
            null,
            null,
            null,
            null,
            v_user_id
        );
    end if;

    if new.format_ml is distinct from old.format_ml then
        perform private.replace_wine_field_provenance(
            new.household_id,
            new.id,
            'format_ml',
            pg_catalog.to_jsonb(new.format_ml),
            v_source_kind,
            null,
            null,
            null,
            null,
            null,
            v_user_id
        );
    end if;

    return new;
end;
$$;

create trigger wines_track_core_provenance
after update of
    producer,
    cuvee,
    vintage,
    color,
    appellation,
    area,
    format_ml
on public.wines
for each row
execute function private.track_wine_core_provenance();


-- Existing production values have an unknown pre-v0.4 origin. Labeling them
-- "unattributed" is honest and protects them from silent provider replacement.
insert into public.wine_field_provenance (
    household_id,
    wine_id,
    field_name,
    source_kind,
    value_snapshot,
    applied_at
)
select
    wine.household_id,
    wine.id,
    field.field_name,
    'unattributed',
    field.value_snapshot,
    wine.created_at
from public.wines wine
cross join lateral (
    values
        ('producer', pg_catalog.to_jsonb(wine.producer)),
        ('cuvee', pg_catalog.to_jsonb(wine.cuvee)),
        ('vintage', pg_catalog.to_jsonb(wine.vintage)),
        ('color', pg_catalog.to_jsonb(wine.color)),
        ('appellation', pg_catalog.to_jsonb(wine.appellation)),
        ('area', pg_catalog.to_jsonb(wine.area)),
        ('format_ml', pg_catalog.to_jsonb(wine.format_ml))
) as field(field_name, value_snapshot)
where field.value_snapshot is not null;


alter table public.wine_notes enable row level security;
alter table public.wine_grape_components enable row level security;
alter table public.wine_food_pairings enable row level security;
alter table public.wine_certifications enable row level security;
alter table public.wine_external_identifiers enable row level security;
alter table public.wine_field_provenance enable row level security;

create policy wine_notes_select_own
on public.wine_notes
for select
to authenticated
using (
    user_id = (select auth.uid())
    and (select private.is_household_member(household_id))
);

create policy wine_grape_components_select_member
on public.wine_grape_components
for select
to authenticated
using ((select private.is_household_member(household_id)));

create policy wine_food_pairings_select_member
on public.wine_food_pairings
for select
to authenticated
using ((select private.is_household_member(household_id)));

create policy wine_certifications_select_member
on public.wine_certifications
for select
to authenticated
using ((select private.is_household_member(household_id)));

create policy wine_external_identifiers_select_member
on public.wine_external_identifiers
for select
to authenticated
using ((select private.is_household_member(household_id)));

create policy wine_field_provenance_select_member
on public.wine_field_provenance
for select
to authenticated
using ((select private.is_household_member(household_id)));

revoke all privileges on table
    public.wine_notes,
    public.wine_grape_components,
    public.wine_food_pairings,
    public.wine_certifications,
    public.wine_external_identifiers,
    public.wine_field_provenance
from anon, authenticated;

grant select on table
    public.wine_notes,
    public.wine_grape_components,
    public.wine_food_pairings,
    public.wine_certifications,
    public.wine_external_identifiers,
    public.wine_field_provenance
to authenticated;

grant select on table
    public.wine_notes,
    public.wine_grape_components,
    public.wine_food_pairings,
    public.wine_certifications,
    public.wine_external_identifiers,
    public.wine_field_provenance
to powersync_role;

alter publication powersync add table
    public.wine_notes,
    public.wine_grape_components,
    public.wine_food_pairings,
    public.wine_certifications,
    public.wine_external_identifiers,
    public.wine_field_provenance;

commit;
