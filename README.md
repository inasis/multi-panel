# Multi Panel

GNOME Shell extension that adds stable auxiliary panels on secondary monitors.

- Name: `Multi Panel`
- UUID: `multi-panel@inasis`
- Author: `inasis`
- Supported GNOME Shell (metadata): `45, 46, 47, 48, 49, 50`

## What It Does

`Multi Panel` creates top bars on non-primary monitors and mirrors/transfers panel indicators with layout controls.

Main capabilities:

- Auxiliary top panel per secondary monitor
- Indicator mirroring and transfer between primary/secondary panels
- Indicator order, position (left/center/right), visibility, and exclusion controls
- Per-indicator padding and panel gap controls
- Panel left/right padding and panel height settings
- Optional layout sync to the main GNOME panel (`Apply to main panel`)
- Screenshot UI behavior option for all monitors

## Install

```bash
git clone https://github.com/inasis/multi-panel
cd multi-panel
cp -r multi-panel@inasis ~/.local/share/gnome-shell/extensions/
```

Then reload GNOME Shell and enable:

- X11: `Alt+F2`, type `r`, Enter
- Wayland: log out and log back in
- Enable from Extensions app or:

```bash
gnome-extensions enable multi-panel@inasis
```

## License

Distributed under GNU GPL v2 or later. See [LICENSE](LICENSE).
