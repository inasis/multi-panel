# Multi Panel

`Multi Panel` extends your GNOME Shell experience to your other displays. It creates functional top bars on secondary monitors, adding to GNOME's default single-panel layout while providing layout and styling controls.

- Name: `Multi Panel`
- UUID: `multi-panel@inasis`
- Author: `inasis`
- Supported GNOME Shell (metadata): `45, 46, 47, 48, 49, 50`

> **Note:** This project is a complete rewrite of classic multi-monitor extensions. Read more about the architectural changes and project history in [EVOLUTION.md](EVOLUTION.md).

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
## Did you find a bug?
**_Don't be shy,_** Please feel free to write down your inconvenience here as an issue. I will come and fix it.

## What It Does

Here is a breakdown of the core capabilities and layout controls provided by the extension:

### Key Features

- **Multi-Monitor Support:** Generates independent top panels for secondary monitors.
- **Indicator Mirroring:** Mirrors system and third-party extension indicators across panels. Click and interact with them on any screen.
- **Layout Control:** Control over indicator order, positioning (left/center/right), visibility, and specific exclusions.
- **Styling Options:** Adjust per-indicator padding, panel gaps, left/right margins, and overall panel height.
- **Layout Synchronization:** Optionally synchronize your customized layout directly to the main GNOME panel (`Apply to main panel`) for a consistent look.

## Loading and Rendering Pipeline

Here is a high-level overview of how the auxiliary panels are loaded and drawn on secondary monitors:

### 1. Monitor Detection and Panel Initialization
When the extension is loaded, it checks the system's display layout to identify **secondary monitors** (excluding the primary monitor). For each secondary monitor, it creates a new, empty panel container mirroring the native layout structure (left, center, and right boxes) and positions it at the top edge of the screen.

### 2. Loading Core Independent Modules
The empty panel is then populated with core widgets specifically tailored for auxiliary screens:
* **Left Area:** Loads the App Menu (`MultiPanelAppMenuButton`), which independently tracks the window focus state for that specific monitor.
* **Center Area:** Places the Date/Clock Menu (`AuxiliaryDateMenuButton`), inheriting the style of the main panel for visual consistency.
* **Right Area:** Assembles a dedicated Quick Settings menu (`AuxiliaryQuickSettings`) by dynamically importing GNOME's internal status modules (volume, brightness, network, etc.).

### 3. Mirroring System and Third-Party Icons
The extension iterates through the system and extension icons active on the main panel's right area. A `MirroredIndicatorButton` scans the original widget's visual elements and creates a clone on the auxiliary panel. It binds their states so that if the original icon changes or hides, the clone updates accordingly.

### 4. Final Rendering
Once all components (App Menu, Clock, Quick Settings, and Mirrored Icons) are assembled, the auxiliary panel object is attached to GNOME Shell's main UI tree (Scene Graph). The graphics engine (Clutter) then calculates the allocation for each widget and finally draws the panel onto the secondary monitor.


## Uninstall

To remove the extension, first disable it and then remove its directory:

```bash
gnome-extensions disable multi-panel@inasis
rm -rf ~/.local/share/gnome-shell/extensions/multi-panel@inasis
```

Then reload GNOME Shell to complete the uninstallation:

- X11: `Alt+F2`, type `r`, Enter
- Wayland: log out and log back in

## License

Distributed under GNU GPL v2 or later. See [LICENSE](LICENSE).
