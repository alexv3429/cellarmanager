# Location wizard visibility and orientation

The selected location structure controls which form section is visible. Hidden
sections remain in memory so switching between structures does not discard
values the user has entered.

Grid and depth orientation is a physical drawing property:

- `horizontal_direction = ltr` places the first column on the left;
- `horizontal_direction = rtl` places the first column on the right;
- `vertical_direction = ttb` places row 1 at the top;
- `vertical_direction = btt` places row 1 at the bottom.

The imported and stored codes do not change when orientation changes. A depth
location named `G1B` is still matched as `G1B`; only its row in the visual grid
changes.
