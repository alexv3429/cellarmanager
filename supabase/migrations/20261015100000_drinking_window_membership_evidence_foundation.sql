begin;

-- Draft-only applicability and provenance for the three-milestone library.
-- This migration does not activate a version, select advice, or grant browser
-- access. Publication must later validate hierarchy, overlapping membership,
-- evidence review, and cross-household reuse rights as one atomic version.

alter table public.drinking_window_ageing_groups
    add constraint drinking_window_ageing_groups_id_version_unique
    unique (id, version_id);

alter table public.drinking_window_reference_rows
    add constraint drinking_window_reference_rows_id_version_unique
    unique (id, version_id);

create table public.drinking_window_ageing_group_memberships (
    id uuid primary key default gen_random_uuid(),
    version_id uuid not null references public.drinking_window_reference_versions(id),
    group_id uuid not null,
    member_kind text not null
        check (member_kind in ('place', 'product', 'release')),
    member_place_id uuid references public.enrichment_places(id),
    member_product_id uuid references public.wine_reference_products(id),
    member_release_id uuid references public.wine_reference_releases(id),
    first_vintage_year integer check (first_vintage_year between 1800 and 2200),
    last_vintage_year integer check (last_vintage_year between 1800 and 2200),
    rationale text not null check (length(trim(rationale)) > 0),
    created_at timestamptz not null default now(),
    constraint drinking_window_memberships_group_version_fk
        foreign key (group_id, version_id)
        references public.drinking_window_ageing_groups(id, version_id),
    constraint drinking_window_memberships_id_version_unique
        unique (id, version_id),
    constraint drinking_window_memberships_target_check check (
        (member_kind = 'place' and member_place_id is not null
            and member_product_id is null and member_release_id is null)
        or (member_kind = 'product' and member_place_id is null
            and member_product_id is not null and member_release_id is null)
        or (member_kind = 'release' and member_place_id is null
            and member_product_id is null and member_release_id is not null)
    ),
    constraint drinking_window_memberships_vintage_range_check check (
        first_vintage_year is null or last_vintage_year is null
        or first_vintage_year <= last_vintage_year
    )
);

create unique index drinking_window_memberships_exact_key_unique
    on public.drinking_window_ageing_group_memberships (
        group_id, member_kind,
        coalesce(member_place_id, member_product_id, member_release_id),
        coalesce(first_vintage_year, 1800),
        coalesce(last_vintage_year, 2200)
    );

create index drinking_window_memberships_group_idx
    on public.drinking_window_ageing_group_memberships(group_id);

create trigger drinking_window_memberships_draft_only
before insert or update or delete on public.drinking_window_ageing_group_memberships
for each row execute function private.require_draft_drinking_window_reference_version();

-- One existing evidence record can support separate parts of a coherent
-- window. A link names exactly one draft row, group definition, or eligible
-- member; it does not make pending evidence reviewed or permit publication.
create table public.drinking_window_reference_evidence (
    id uuid primary key default gen_random_uuid(),
    version_id uuid not null references public.drinking_window_reference_versions(id),
    reference_row_id uuid,
    ageing_group_id uuid,
    membership_id uuid,
    evidence_id uuid not null references public.enrichment_evidence(id),
    claim_part text not null check (claim_part in (
        'first_trial', 'optimal_period', 'group_definition',
        'membership_eligibility', 'context'
    )),
    evidence_role text not null default 'supports'
        check (evidence_role in ('supports', 'contradicts', 'context')),
    created_at timestamptz not null default now(),
    constraint drinking_window_reference_evidence_row_version_fk
        foreign key (reference_row_id, version_id)
        references public.drinking_window_reference_rows(id, version_id),
    constraint drinking_window_reference_evidence_group_version_fk
        foreign key (ageing_group_id, version_id)
        references public.drinking_window_ageing_groups(id, version_id),
    constraint drinking_window_reference_evidence_member_version_fk
        foreign key (membership_id, version_id)
        references public.drinking_window_ageing_group_memberships(id, version_id),
    constraint drinking_window_reference_evidence_target_check check (
        (reference_row_id is not null and ageing_group_id is null
            and membership_id is null
            and claim_part in ('first_trial', 'optimal_period', 'context'))
        or (reference_row_id is null and ageing_group_id is not null
            and membership_id is null
            and claim_part in ('group_definition', 'context'))
        or (reference_row_id is null and ageing_group_id is null
            and membership_id is not null
            and claim_part in ('membership_eligibility', 'context'))
    )
);

create unique index drinking_window_reference_evidence_row_unique
    on public.drinking_window_reference_evidence
    (reference_row_id, evidence_id, claim_part, evidence_role)
    where reference_row_id is not null;

create unique index drinking_window_reference_evidence_group_unique
    on public.drinking_window_reference_evidence
    (ageing_group_id, evidence_id, claim_part, evidence_role)
    where ageing_group_id is not null;

create unique index drinking_window_reference_evidence_membership_unique
    on public.drinking_window_reference_evidence
    (membership_id, evidence_id, claim_part, evidence_role)
    where membership_id is not null;

create trigger drinking_window_reference_evidence_draft_only
before insert or update or delete on public.drinking_window_reference_evidence
for each row execute function private.require_draft_drinking_window_reference_version();

alter table public.drinking_window_ageing_group_memberships enable row level security;
alter table public.drinking_window_reference_evidence enable row level security;

revoke all privileges on table
    public.drinking_window_ageing_group_memberships,
    public.drinking_window_reference_evidence
from public, anon, authenticated, powersync_role;

grant select, insert, update, delete on table
    public.drinking_window_ageing_group_memberships,
    public.drinking_window_reference_evidence
to service_role;

commit;
