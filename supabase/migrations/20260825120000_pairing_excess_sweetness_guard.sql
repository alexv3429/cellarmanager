alter function private.score_wine_pairing(
    jsonb, jsonb, text, text, text
)
rename to score_wine_pairing_v1;

revoke execute on function private.score_wine_pairing_v1(
    jsonb, jsonb, text, text, text
)
from public, anon, authenticated;

grant execute on function private.score_wine_pairing_v1(
    jsonb, jsonb, text, text, text
)
to service_role;

create function private.score_wine_pairing(
    p_wine_traits jsonb,
    p_dish_attributes jsonb,
    p_maturity_state text,
    p_preferred_style text,
    p_previous_verdict text
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
    v_result jsonb;
    v_wine_sweetness numeric := (p_wine_traits ->> 'sweetness')::numeric;
    v_dish_sweetness numeric := (p_dish_attributes ->> 'sweetness')::numeric;
    v_dish_salt numeric := (p_dish_attributes ->> 'salt')::numeric;
    v_dish_umami numeric := (p_dish_attributes ->> 'umami')::numeric;
    v_excess_sweetness numeric;
    v_penalty numeric := 0;
    v_supports_sweet_savory_contrast boolean;
    v_unsafe_excess boolean := false;
    v_score integer;
    v_base_score integer;
begin
    v_result := private.score_wine_pairing_v1(
        p_wine_traits,
        p_dish_attributes,
        p_maturity_state,
        p_preferred_style,
        p_previous_verdict
    );

    v_excess_sweetness := v_wine_sweetness - v_dish_sweetness;
    v_supports_sweet_savory_contrast := v_dish_sweetness < 3
        and v_dish_salt >= 4
        and v_dish_umami >= 4;

    if v_dish_sweetness < 3
       and not v_supports_sweet_savory_contrast
       and v_excess_sweetness > 0.75 then
        v_penalty := (v_excess_sweetness - 0.75) * 14;
        v_unsafe_excess := v_excess_sweetness > 1.5;

        v_score := round(greatest(
            0,
            (v_result ->> 'score')::numeric - v_penalty
        ))::integer;
        v_base_score := round(greatest(
            0,
            (v_result ->> 'base_score')::numeric - v_penalty
        ))::integer;

        v_result := jsonb_set(v_result, '{score}', to_jsonb(v_score));
        v_result := jsonb_set(
            v_result,
            '{base_score}',
            to_jsonb(v_base_score)
        );
        v_result := jsonb_set(
            v_result,
            '{cautions}',
            coalesce(v_result -> 'cautions', '[]'::jsonb)
                || jsonb_build_array(
                    'The wine may be too sweet for this savoury dish.'
                )
        );
    end if;

    v_result := jsonb_set(
        v_result,
        '{suitable}',
        to_jsonb(
            (v_result ->> 'suitable')::boolean
            and not v_unsafe_excess
        )
    );

    return v_result;
end;
$$;

revoke execute on function private.score_wine_pairing(
    jsonb, jsonb, text, text, text
)
from public, anon, authenticated;

grant execute on function private.score_wine_pairing(
    jsonb, jsonb, text, text, text
)
to service_role;

comment on function private.score_wine_pairing(
    jsonb, jsonb, text, text, text
) is
    'Scores structural pairing with bidirectional sweetness safety and a narrow salty-umami exception.';
