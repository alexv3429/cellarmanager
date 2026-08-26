begin;

-- Household-owned descriptive facts remain separate from reviewed shared
-- knowledge and from personal observations. The legacy `area` column remains
-- the synchronized region field so existing imports and devices stay
-- compatible.
alter table public.wines
    add column country text,
    add column classification text,
    add column vineyard text,
    add column grape_composition jsonb not null default '[]'::jsonb,
    add column sweetness_category text,
    add column alcohol_percent numeric(4, 2),
    add column certifications jsonb not null default '[]'::jsonb;


create or replace function private.valid_wine_grape_composition(
    p_value jsonb
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
    v_item jsonb;
    v_name text;
    v_name_key text;
    v_names text[] := array[]::text[];
    v_percentage numeric;
    v_total numeric := 0;
    v_count integer := 0;
begin
    if p_value is null
       or pg_catalog.jsonb_typeof(p_value) <> 'array'
    then
        return false;
    end if;

    for v_item in
        select value
        from pg_catalog.jsonb_array_elements(p_value)
    loop
        v_count := v_count + 1;

        if v_count > 20
           or pg_catalog.jsonb_typeof(v_item) <> 'object'
           or not (v_item ? 'name')
           or pg_catalog.jsonb_typeof(v_item -> 'name') <> 'string'
           or exists (
               select 1
               from pg_catalog.jsonb_object_keys(v_item) as key
               where key not in ('name', 'percentage')
           )
        then
            return false;
        end if;

        v_name := pg_catalog.regexp_replace(
            pg_catalog.btrim(v_item ->> 'name'),
            '[[:space:]]+',
            ' ',
            'g'
        );

        if v_name = '' or pg_catalog.length(v_name) > 200 then
            return false;
        end if;

        v_name_key := pg_catalog.lower(v_name);

        if v_name_key = any(v_names) then
            return false;
        end if;

        v_names := pg_catalog.array_append(v_names, v_name_key);

        if v_item ? 'percentage'
           and v_item -> 'percentage' <> 'null'::jsonb
        then
            if pg_catalog.jsonb_typeof(v_item -> 'percentage') <> 'number'
            then
                return false;
            end if;

            v_percentage := (v_item ->> 'percentage')::numeric;

            if v_percentage <= 0
               or v_percentage > 100
               or pg_catalog.scale(v_percentage) > 2
            then
                return false;
            end if;

            v_total := v_total + v_percentage;
        end if;
    end loop;

    return v_total <= 100;
end;
$$;

revoke execute
on function private.valid_wine_grape_composition(jsonb)
from public, anon, authenticated;


create or replace function private.valid_wine_certifications(
    p_value jsonb
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
    v_item jsonb;
    v_name text;
    v_name_key text;
    v_names text[] := array[]::text[];
    v_count integer := 0;
begin
    if p_value is null
       or pg_catalog.jsonb_typeof(p_value) <> 'array'
    then
        return false;
    end if;

    for v_item in
        select value
        from pg_catalog.jsonb_array_elements(p_value)
    loop
        v_count := v_count + 1;

        if v_count > 20
           or pg_catalog.jsonb_typeof(v_item) <> 'string'
        then
            return false;
        end if;

        v_name := pg_catalog.regexp_replace(
            pg_catalog.btrim(v_item #>> '{}'),
            '[[:space:]]+',
            ' ',
            'g'
        );

        if v_name = '' or pg_catalog.length(v_name) > 200 then
            return false;
        end if;

        v_name_key := pg_catalog.lower(v_name);

        if v_name_key = any(v_names) then
            return false;
        end if;

        v_names := pg_catalog.array_append(v_names, v_name_key);
    end loop;

    return true;
end;
$$;

revoke execute
on function private.valid_wine_certifications(jsonb)
from public, anon, authenticated;


alter table public.wines
    add constraint wines_country_check
        check (
            country is null
            or (
                length(trim(country)) between 1 and 200
                and country = trim(country)
            )
        ),
    add constraint wines_classification_check
        check (
            classification is null
            or (
                length(trim(classification)) between 1 and 200
                and classification = trim(classification)
            )
        ),
    add constraint wines_vineyard_check
        check (
            vineyard is null
            or (
                length(trim(vineyard)) between 1 and 200
                and vineyard = trim(vineyard)
            )
        ),
    add constraint wines_grape_composition_check
        check (private.valid_wine_grape_composition(grape_composition)),
    add constraint wines_sweetness_category_check
        check (
            sweetness_category is null
            or sweetness_category in (
                'bone-dry',
                'dry',
                'off-dry',
                'medium-sweet',
                'sweet'
            )
        ),
    add constraint wines_alcohol_percent_check
        check (
            alcohol_percent is null
            or alcohol_percent > 0 and alcohol_percent <= 30
        ),
    add constraint wines_certifications_check
        check (private.valid_wine_certifications(certifications));

comment on column public.wines.country is
    'Household-maintained country label; shared enrichment never overwrites it silently.';
comment on column public.wines.area is
    'Household-maintained region label retained under its legacy column name for synchronization compatibility.';
comment on column public.wines.classification is
    'Household-maintained classification such as Premier Cru or DOCG.';
comment on column public.wines.vineyard is
    'Household-maintained vineyard, climat, site, or parcel label.';
comment on column public.wines.grape_composition is
    'Ordered grape names with optional percentages; known percentages may not exceed 100 in total.';
comment on column public.wines.sweetness_category is
    'Normalized descriptive sweetness, separate from the reviewed 0-5 inference trait.';
comment on column public.wines.alcohol_percent is
    'Label alcohol by volume percentage when known.';
comment on column public.wines.certifications is
    'Household-maintained certification labels; no certification is inferred from a practice claim.';


create or replace function public.update_wine_facts(
    p_wine_id uuid,
    p_country text,
    p_region text,
    p_classification text,
    p_vineyard text,
    p_grape_composition jsonb,
    p_sweetness_category text,
    p_alcohol_percent numeric,
    p_certifications jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := (select auth.uid());
    v_wine public.wines%rowtype;
    v_country text := nullif(
        pg_catalog.regexp_replace(
            pg_catalog.btrim(coalesce(p_country, '')),
            '[[:space:]]+',
            ' ',
            'g'
        ),
        ''
    );
    v_region text := nullif(
        pg_catalog.regexp_replace(
            pg_catalog.btrim(coalesce(p_region, '')),
            '[[:space:]]+',
            ' ',
            'g'
        ),
        ''
    );
    v_classification text := nullif(
        pg_catalog.regexp_replace(
            pg_catalog.btrim(coalesce(p_classification, '')),
            '[[:space:]]+',
            ' ',
            'g'
        ),
        ''
    );
    v_vineyard text := nullif(
        pg_catalog.regexp_replace(
            pg_catalog.btrim(coalesce(p_vineyard, '')),
            '[[:space:]]+',
            ' ',
            'g'
        ),
        ''
    );
    v_grapes jsonb := '[]'::jsonb;
    v_certifications jsonb := '[]'::jsonb;
    v_item jsonb;
    v_name text;
begin
    if v_user_id is null then
        raise exception using
            errcode = '28000',
            message = 'Authentication is required';
    end if;

    if p_wine_id is null then
        raise exception using
            errcode = '22023',
            message = 'Wine id is required';
    end if;

    select wine.*
    into v_wine
    from public.wines wine
    where wine.id = p_wine_id
    for update;

    if not found then
        raise exception using
            errcode = '22023',
            message = 'Wine was not found';
    end if;

    if not exists (
        select 1
        from public.household_members member
        where member.household_id = v_wine.household_id
          and member.user_id = v_user_id
          and member.role = 'owner'
    ) then
        raise exception using
            errcode = '42501',
            message = 'Only household owners can edit wine facts';
    end if;

    if coalesce(pg_catalog.length(v_country), 0) > 200
       or coalesce(pg_catalog.length(v_region), 0) > 200
       or coalesce(pg_catalog.length(v_classification), 0) > 200
       or coalesce(pg_catalog.length(v_vineyard), 0) > 200
    then
        raise exception using
            errcode = '22023',
            message = 'Wine fact labels must be 200 characters or fewer';
    end if;

    if not private.valid_wine_grape_composition(
        coalesce(p_grape_composition, '[]'::jsonb)
    ) then
        raise exception using
            errcode = '22023',
            message = 'Grape composition is invalid';
    end if;

    if not private.valid_wine_certifications(
        coalesce(p_certifications, '[]'::jsonb)
    ) then
        raise exception using
            errcode = '22023',
            message = 'Certifications are invalid';
    end if;

    if p_sweetness_category is not null
       and p_sweetness_category not in (
           'bone-dry',
           'dry',
           'off-dry',
           'medium-sweet',
           'sweet'
       )
    then
        raise exception using
            errcode = '22023',
            message = 'Sweetness category is invalid';
    end if;

    if p_alcohol_percent is not null
       and (p_alcohol_percent <= 0 or p_alcohol_percent > 30)
    then
        raise exception using
            errcode = '22023',
            message = 'Alcohol percentage must be greater than 0 and at most 30';
    end if;

    for v_item in
        select value
        from pg_catalog.jsonb_array_elements(
            coalesce(p_grape_composition, '[]'::jsonb)
        )
    loop
        v_name := pg_catalog.regexp_replace(
            pg_catalog.btrim(v_item ->> 'name'),
            '[[:space:]]+',
            ' ',
            'g'
        );
        v_grapes := v_grapes || pg_catalog.jsonb_build_array(
            pg_catalog.jsonb_build_object(
                'name', v_name,
                'percentage', v_item -> 'percentage'
            )
        );
    end loop;

    for v_item in
        select value
        from pg_catalog.jsonb_array_elements(
            coalesce(p_certifications, '[]'::jsonb)
        )
    loop
        v_name := pg_catalog.regexp_replace(
            pg_catalog.btrim(v_item #>> '{}'),
            '[[:space:]]+',
            ' ',
            'g'
        );
        v_certifications := v_certifications
            || pg_catalog.jsonb_build_array(v_name);
    end loop;

    update public.wines
    set country = v_country,
        area = v_region,
        classification = v_classification,
        vineyard = v_vineyard,
        grape_composition = v_grapes,
        sweetness_category = p_sweetness_category,
        alcohol_percent = p_alcohol_percent,
        certifications = v_certifications
    where id = p_wine_id;

    return p_wine_id;
end;
$$;

revoke all
on function public.update_wine_facts(
    uuid,
    text,
    text,
    text,
    text,
    jsonb,
    text,
    numeric,
    jsonb
)
from public, anon;

grant execute
on function public.update_wine_facts(
    uuid,
    text,
    text,
    text,
    text,
    jsonb,
    text,
    numeric,
    jsonb
)
to authenticated;

commit;
