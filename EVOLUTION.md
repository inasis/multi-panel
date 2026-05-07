# Evolution from the Original Project

`Multi Panel` is deeply rooted in the history of the GNOME desktop. It was originally inspired by the legendary `multi-monitors-add-on` created by **spin83**. The development of this modern iteration began by incorporating and expanding upon experimental mirroring concepts from a distinct architectural branch, specifically FrederykAbryan/multi-monitors-bar_fapv2.

As GNOME Shell evolved (especially after version 45), the legacy architecture needed an update to keep up with modern standards. This project (`multi-panel@inasis`) is a **complete rewrite** designed for the modern GNOME ecosystem.

Here is a detailed breakdown of what has changed and how the internal systems have been improved.

## 1. Migration to Modern GNOME Stack (ESM)
* **The Past:** The original extension relied on GNOME's legacy import system (`imports.gi.*` and `imports.ui.*`).
* **The Present (Project-wide, e.g., `prefs.js`, `panels/panel.js`):** The entire codebase has been rewritten from scratch using **ES Modules (ESM)** standard (`import St from 'gi://St'`). It leverages `async/await`, native `GObject.registerClass`, and strict module scoping, making it fully compatible with GNOME 45+ and future-proof.

## 2. Universal Indicator Mirroring
* **The Past:** To show third-party extensions (e.g., weather, system monitors) on secondary panels, the old project relied on shallow Clutter cloning or hardcoded exceptions. This sometimes resulted in inactive icons or fallback boxes.
* **The Present:** `Multi Panel` introduces a more adaptable **Mirroring System**. 
* **The Origin:** The fundamental concept of robust indicator mirroring was pioneered in `mirroredIndicatorButton.js` from the FrederykAbryan branch.
* **The Present (`indicators/mirror/button.js` & `indicators/mirror/support.js`):** `Multi Panel` takes this foundational concept and expands it into a more comprehensive **Mirroring System**. 
  - **Deep Extraction:** It deeply traverses the target indicator's widget tree (`_findAllDisplayWidgets`) to find the actual `St.Icon` and `St.Label` elements.
  - **Property Binding:** It binds properties (`gicon`, `text`, `visible`) between the source and the clone, ensuring the clone updates when the original icon changes state.
  - **Event Forwarding:** When you click an indicator on a secondary monitor, the system forwards the event to the primary panel's original widget, supporting interaction with most extensions.

## 3. Native Quick Settings Implementation
* **The Past:** Older extensions struggled to adapt to GNOME's new pill-shaped Quick Settings menu, often rendering broken UIs by trying to hack the legacy Aggregate Menu.
* **The Present (`indicators/mandatory/quickSettings.js`):** The extension dynamically and asynchronously loads GNOME's internal status modules (Volume, Brightness, Network, Bluetooth, etc.) and constructs an independent `AuxiliaryQuickSettings` menu for secondary monitors to better match the native look.

## 4. Monitor-Aware App Menu
* **The Past:** The application menu typically just tracked whatever app was focused on the primary monitor.
* **The Present (`indicators/mandatory/appMenu.js`):** Through the new `AppMenuMonitorModel`, each secondary panel independently scans the GNOME Window Tracker. The App Menu now dynamically reflects the window that is actually focused and located on *that specific monitor's screen*.

## 5. Proactive Memory Management
* **The Past:** Multi-panel extensions occasionally struggled with memory management in GNOME Shell when monitors were hot-plugged or extensions were toggled.
* **The Present (`core/actor.js` & `panels/panel.js`):** A structured lifecycle management system was implemented. Using `trackActorDispose()` and `_isDestroying` flags within the `destroy()` overrides, the extension ensures that signal listeners, GLib timeouts, and Clutter bindings are properly cleared when a panel is removed to maintain stability.

## 6. Built-in Compatibility Layer
* **The Past:** Users often experienced visual glitches when running popular extensions like *Blur my Shell*.
* **The Present (`panels/support.js`):** Includes a dedicated compatibility layer (`_ensureBlurMyShellCompatibility` and `_syncBlurMyShellActor`) that helps coordinate with third-party extensions, allowing dynamic blurs and transparent backgrounds to apply smoothly to secondary panels.