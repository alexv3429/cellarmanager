begin;

alter table public.household_members
    add column id uuid not null default gen_random_uuid();

alter table public.devices
    drop constraint devices_membership_fk;

alter table public.household_members
    drop constraint household_members_pkey;

alter table public.household_members
    add constraint household_members_pkey
        primary key (id);

alter table public.household_members
    add constraint household_members_household_user_unique
        unique (household_id, user_id);

alter table public.devices
    add constraint devices_membership_fk
        foreign key (household_id, user_id)
        references public.household_members(household_id, user_id)
        on delete cascade;

commit;
