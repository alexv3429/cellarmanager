begin;

create or replace function public.update_wine_identity(
    p_wine_id uuid,
    p_producer text,
    p_cuvee text,
    p_vintage integer,
    p_color text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := (select auth.uid());
    v_wine public.wines%rowtype;

    v_producer text :=
        pg_catalog.regexp_replace(
            pg_catalog.btrim(coalesce(p_producer, '')),
            '[[:space:]]+',
            ' ',
            'g'
        );

    v_cuvee text :=
        pg_catalog.regexp_replace(
            pg_catalog.btrim(coalesce(p_cuvee, '')),
            '[[:space:]]+',
            ' ',
            'g'
        );

    v_color text :=
        pg_catalog.lower(
            pg_catalog.regexp_replace(
                pg_catalog.btrim(coalesce(p_color, '')),
                '[[:space:]]+',
                ' ',
                'g'
            )
        );

    v_identity_changed boolean;
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

    select w.*
    into v_wine
    from public.wines w
    where w.id = p_wine_id
    for update;

    if not found then
        raise exception using
            errcode = '22023',
            message = 'Wine was not found';
    end if;

    if not exists (
        select 1
        from public.household_members hm
        where hm.household_id = v_wine.household_id
          and hm.user_id = v_user_id
          and hm.role = 'owner'
    ) then
        raise exception using
            errcode = '42501',
            message = 'Only household owners can edit catalog wines';
    end if;

    if v_producer = '' then
        raise exception using
            errcode = '22023',
            message = 'Wine producer is required';
    end if;

    if v_cuvee = '' then
        raise exception using
            errcode = '22023',
            message = 'Wine cuvée is required';
    end if;

    if p_vintage is not null
       and (
           p_vintage < 1800
           or p_vintage > 2200
       )
    then
        raise exception using
            errcode = '22023',
            message = 'Wine vintage must be between 1800 and 2200';
    end if;

    if v_color = '' then
        raise exception using
            errcode = '22023',
            message = 'Wine color is required';
    end if;

    v_identity_changed :=
        pg_catalog.lower(
            pg_catalog.regexp_replace(
                pg_catalog.btrim(v_wine.producer),
                '[[:space:]]+',
                ' ',
                'g'
            )
        ) is distinct from pg_catalog.lower(v_producer)
        or pg_catalog.lower(
            pg_catalog.regexp_replace(
                pg_catalog.btrim(v_wine.cuvee),
                '[[:space:]]+',
                ' ',
                'g'
            )
        ) is distinct from pg_catalog.lower(v_cuvee)
        or v_wine.vintage is distinct from p_vintage
        or pg_catalog.lower(
            pg_catalog.regexp_replace(
                pg_catalog.btrim(v_wine.color),
                '[[:space:]]+',
                ' ',
                'g'
            )
        ) is distinct from v_color;

    if v_identity_changed then
        -- Use the same semantic-identity lock as ADD so concurrent
        -- creation/editing cannot silently introduce a new ambiguity.
        perform pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended(
                v_wine.household_id::text
                || '|'
                || pg_catalog.lower(v_producer)
                || '|'
                || pg_catalog.lower(v_cuvee)
                || '|'
                || coalesce(p_vintage::text, 'NV')
                || '|'
                || v_color
                || '|'
                || v_wine.format_ml::text,
                0
            )
        );

        if exists (
            select 1
            from public.wines w
            where w.household_id = v_wine.household_id
              and w.id <> p_wine_id
              and pg_catalog.lower(
                      pg_catalog.regexp_replace(
                          pg_catalog.btrim(w.producer),
                          '[[:space:]]+',
                          ' ',
                          'g'
                      )
                  ) = pg_catalog.lower(v_producer)
              and pg_catalog.lower(
                      pg_catalog.regexp_replace(
                          pg_catalog.btrim(w.cuvee),
                          '[[:space:]]+',
                          ' ',
                          'g'
                      )
                  ) = pg_catalog.lower(v_cuvee)
              and w.vintage is not distinct from p_vintage
              and pg_catalog.lower(
                      pg_catalog.regexp_replace(
                          pg_catalog.btrim(w.color),
                          '[[:space:]]+',
                          ' ',
                          'g'
                      )
                  ) = v_color
              and w.format_ml = v_wine.format_ml
        ) then
            raise exception using
                errcode = '22023',
                message = 'Another catalog wine already has this identity';
        end if;
    end if;

    update public.wines
    set producer = v_producer,
        cuvee = v_cuvee,
        vintage = p_vintage,
        color = v_color
    where id = p_wine_id;

    return p_wine_id;
end;
$$;

revoke all
on function public.update_wine_identity(
    uuid,
    text,
    text,
    integer,
    text
)
from public, anon;

grant execute
on function public.update_wine_identity(
    uuid,
    text,
    text,
    integer,
    text
)
to authenticated;

commit;
