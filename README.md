# Duux Card

A compact, animated Home Assistant Lovelace card for Duux fans. One row when collapsed — fits comfortably in a mobile dashboard stack — expanding to full control on tap.

- Fixed hub, orbiting blades: spin rate and a touch of motion blur scale with fan speed
- Pulsing rings breathe outward from the hub, cadence tied to speed
- Horizontal / vertical oscillation shown as simple switches (not Duux's native list): on writes a configurable angle, off writes back to 0 — the icon itself tilts to match whichever axis is active
- Preset modes read directly from the fan entity's `preset_modes` attribute
- Optional night mode, child lock and timer rows, each auto-detected from your fan entity's name or set explicitly
- Colors, radius and shadow all come from your active Home Assistant theme — nothing is hardcoded

## Installation (HACS)

1. HACS → Frontend → ⋮ → Custom repositories → add this repository, category "Lovelace".
2. Install **Duux Card**, then reload/clear cache if prompted.

## Configuration

```yaml
type: custom:duux-card
entity: fan.living_room_fan       # required — your Duux fan entity
name: Living Room Fan             # optional, defaults to the entity's friendly name

# Optional companion entities — auto-detected by name if omitted
# (e.g. select.living_room_fan_horizontal_angle)
horizontal_entity: select.living_room_fan_horizontal_angle
vertical_entity: select.living_room_fan_vertical_angle
night_entity: switch.living_room_fan_night_mode
lock_entity: switch.living_room_fan_lock
timer_entity: number.living_room_fan_timer

# What the horizontal/vertical switches actually write when turned on/off.
# Match these to whatever options/values your integration's entity expects
# (Duux's own select entities typically use "Off" / "30°" / "45°").
horizontal_on_value: "30°"
horizontal_off_value: "Off"
vertical_on_value: "45°"
vertical_off_value: "Off"
```

## Preset modes

Preset chips are read straight from the fan entity's `preset_modes` attribute — for Duux that's typically `normal` / `natural` / `night`. The card capitalizes them for display (Normal, Natural, Night) but sends the exact lower-case value back to `fan.set_preset_mode`, so it works whether your integration reports them capitalized or not.

Only `entity` is required. Every companion entity is optional — its row simply doesn't render if there's nothing to control.

## Notes

- `horizontal_entity` / `vertical_entity` can be a `select`, `number`, or `switch` domain. For `select`/`number`, the on/off values above are what gets written; for `switch`, the card just calls `turn_on`/`turn_off` and ignores the values.
- `lock_entity` can be `switch` or `lock` domain.
- `timer_entity` can be `number` (cycles a fixed set of hour values) or `select` (cycles its own `options`).
