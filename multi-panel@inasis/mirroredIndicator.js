/*
Copyright (C) 2025-2026  Frederyk Abryan Palinoan

This program is free software; you can redistribute it and/or
modify it under the terms of the GNU General Public License
as published by the Free Software Foundation; either version 2
of the License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program; if not, visit https://www.gnu.org/licenses/.
*/

import St from 'gi://St';
import Atk from 'gi://Atk';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as Constants from './panelSettings.js';

// Lightweight mirrored indicator that visually clones an existing indicator
// (e.g., Vitals) from the main panel and opens its menu anchored to this button.
export const MirroredIndicatorButton = GObject.registerClass(
    class MirroredIndicatorButton extends PanelMenu.Button {
        _init(panel, role) {
            super._init(0.0, null, false);

            this._role = role;
            this._panel = panel;
            this._isDestroying = false;
            this.add_style_class_name('mm-mirrored-indicator');

            // Ensure cleanup happens when the underlying Clutter object is destroyed
            // This captures cases where mmpanel implicitely destroys children
            this.connect('destroy', this._cleanup.bind(this));

            if (role === 'activities') {
                this._initActivitiesButton();
            } else {
                this._initGenericIndicator(role);
            }
        }

        _applyZeroSpacingStyle(actor, extraStyle = '') {
            if (!actor?.set_style)
                return;

            const base = 'padding: 0; margin: 0; spacing: 0; -natural-hpadding: 0; -minimum-hpadding: 0;';
            const sanitizedExtraStyle = this._sanitizeInlineStyle(extraStyle);
            actor.set_style(`${base}${sanitizedExtraStyle ? ` ${sanitizedExtraStyle}` : ''}`.trim());
        }

        _sanitizeInlineStyle(style) {
            if (!style || typeof style !== 'string')
                return '';

            const lengthLikeProperty = /^(?:padding|margin|spacing|width|height|min-width|min-height|max-width|max-height|icon-size|border(?:-(?:top|right|bottom|left))?-width|-natural-hpadding|-minimum-hpadding)$/i;
            const validLengthValue = /^(?:-?\d+(?:\.\d+)?(?:px|pt|em|rem|%)?|0|auto|inherit|initial|unset|calc\(.+\)|var\(.+\))$/i;

            return style
                .split(';')
                .map(part => part.trim())
                .filter(Boolean)
                .filter(part => part.includes(':'))
                .map(part => {
                    const [property, ...valueParts] = part.split(':');
                    const name = property.trim();
                    const value = valueParts.join(':').trim();
                    return {name, value};
                })
                .filter(({name, value}) => name && value)
                .filter(({value}) => !/(?:^|[\s:(-])(NaN|undefined|null)(?:$|[\s);-])/i.test(value))
                .filter(({name, value}) => !lengthLikeProperty.test(name) || validLengthValue.test(value))
                .map(({name, value}) => `${name}: ${value}`)
                .join('; ');
        }

        _isQuickSettingsRole() {
            return this._role === 'quickSettings';
        }

        _isDirectSyncRole() {
            return this._role === 'keyboard' ||
                this._role === 'screenSharing' ||
                this._role === 'screenRecording' ||
                this._role === 'screencast';
        }

        _getQuickSettingsGap() {
            const settings = this._panel?._settings;
            return settings ? Constants.getQuickSettingsGap(settings) : 0;
        }

        _getQuickSettingsGapStyle() {
            return `spacing: ${this._getQuickSettingsGap()}px;`;
        }

        _getQuickSettingsItemPaddingStyle() {
            const gap = this._getQuickSettingsGap();
            return `padding-left: ${gap}px; padding-right: ${gap}px;`;
        }

        _applyQuickSettingsIndicatorPadding(padding) {
            if (this._role !== 'quickSettings')
                return;

            const value = Number.isFinite(padding) ? Math.max(0, Math.round(padding)) : 0;

            if (this._quickSettingsPaddingLeft)
                this._quickSettingsPaddingLeft.width = value;

            if (this._quickSettingsPaddingRight)
                this._quickSettingsPaddingRight.width = value;
        }

        _applyContainerSpacing(container, gap) {
            if (!container)
                return;

            if ('spacing' in container)
                container.spacing = gap;
        }

        _applyMirroredWidgetStyle(widget, sourceWidget = null) {
            const sourceStyle = sourceWidget ? this._getMirroredSourceInlineStyle(sourceWidget) : '';
            const extraStyle = this._isQuickSettingsRole()
                ? `${sourceStyle || ''} ${this._getQuickSettingsItemPaddingStyle()}`.trim()
                : (sourceStyle || '');
            this._applyZeroSpacingStyle(widget, extraStyle);
        }

        _ensureTrackedWidgetSignals() {
            if (!this._trackedWidgetSignals)
                this._trackedWidgetSignals = [];
        }

        _trackWidgetSignals(sourceWidget, signalNames, callback) {
            if (!sourceWidget?.connect)
                return;

            this._ensureTrackedWidgetSignals();
            for (const signalName of signalNames) {
                const signalId = sourceWidget.connect(signalName, callback);
                this._trackedWidgetSignals.push({sourceWidget, signalId});
            }
        }

        _syncCopiedWidgetVisibility(targetWidget, sourceWidget, stopActor) {
            const nextVisible = this._isEffectivelyVisible(sourceWidget, stopActor);
            if (targetWidget.visible !== nextVisible)
                targetWidget.visible = nextVisible;
        }

        _syncMirroredCopyWidget(targetWidget, sourceWidget, stopActor, updateContent, fallbackStyleClass = '') {
            if (this._isDestroying)
                return;

            try {
                updateContent?.();
                this._syncCopiedWidgetVisibility(targetWidget, sourceWidget, stopActor);

                const nextStyleClass = sourceWidget.get_style_class_name?.() || fallbackStyleClass;
                if (targetWidget.get_style_class_name?.() !== nextStyleClass)
                    targetWidget.set_style_class_name(nextStyleClass);

                this._applyMirroredWidgetStyle(targetWidget, sourceWidget);
            } catch (_e) {
            }
        }

        _trackMirroredCopySignals(sourceWidget, signalNames, targetWidget, stopActor, updateContent, fallbackStyleClass = '') {
            const syncCopy = () => this._syncMirroredCopyWidget(
                targetWidget,
                sourceWidget,
                stopActor,
                updateContent,
                fallbackStyleClass
            );

            syncCopy();
            if (this._usesDirectLabelSync())
                this._trackWidgetSignals(sourceWidget, signalNames, syncCopy);
        }

        _setButtonActive(active) {
            if (active)
                this.add_style_pseudo_class('active');
            else
                this.remove_style_pseudo_class('active');
        }

        _resetButtonState() {
            if (this.remove_style_pseudo_class) {
                this.remove_style_pseudo_class('active');
                this.remove_style_pseudo_class('checked');
            }
        }

        _replaceTimeout(timeoutKey, delay, callback) {
            if (this[timeoutKey]) {
                GLib.source_remove(this[timeoutKey]);
                this[timeoutKey] = null;
            }

            this[timeoutKey] = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
                this[timeoutKey] = null;
                return callback();
            });
        }

        _getSourceIndicatorMenuState() {
            return {
                originalSetActive: this._sourceIndicator.setActive?.bind(this._sourceIndicator),
                originalAddPseudoClass: this._sourceIndicator.add_style_pseudo_class?.bind(this._sourceIndicator),
            };
        }

        _preventMainPanelActiveState() {
            const {originalSetActive, originalAddPseudoClass} = this._getSourceIndicatorMenuState();

            if (this._sourceIndicator.setActive)
                this._sourceIndicator.setActive = () => { };

            if (this._sourceIndicator.add_style_pseudo_class) {
                const originalMethod = this._sourceIndicator.add_style_pseudo_class.bind(this._sourceIndicator);
                this._sourceIndicator.add_style_pseudo_class = pseudoClass => {
                    if (pseudoClass !== 'active' && pseudoClass !== 'checked')
                        originalMethod(pseudoClass);
                };
            }

            if (this._sourceIndicator.remove_style_pseudo_class) {
                this._sourceIndicator.remove_style_pseudo_class('active');
                this._sourceIndicator.remove_style_pseudo_class('checked');
            }

            return {originalSetActive, originalAddPseudoClass};
        }

        _restoreSourceIndicatorMenuState({originalSetActive, originalAddPseudoClass} = {}) {
            if (originalSetActive && this._sourceIndicator)
                this._sourceIndicator.setActive = originalSetActive;

            if (originalAddPseudoClass && this._sourceIndicator)
                this._sourceIndicator.add_style_pseudo_class = originalAddPseudoClass;
        }

        _setMenuSourceActor(menu, sourceActor) {
            if (menu)
                menu.sourceActor = sourceActor;
        }

        _bindMenuLifecycle(menu, onClose, onOpen = null) {
            const openStateId = menu.connect('open-state-changed', (_menu, isOpen) => {
                if (isOpen) {
                    onOpen?.();
                    return;
                }

                onClose?.();
                menu.disconnect(openStateId);
            });
        }

        _clearTimeoutKey(timeoutKey) {
            if (!this[timeoutKey])
                return;

            GLib.source_remove(this[timeoutKey]);
            this[timeoutKey] = null;
        }

        _disconnectSignal(source, signalKey) {
            if (!source || !this[signalKey])
                return;

            try {
                source.disconnect(this[signalKey]);
            } catch (_e) {
            }

            this[signalKey] = null;
        }

        _cleanupAllocationSyncedClones() {
            if (!this._allocationSyncedClones)
                return;

            for (const entry of this._allocationSyncedClones.values()) {
                if (entry?.timeoutId) {
                    GLib.source_remove(entry.timeoutId);
                    entry.timeoutId = null;
                }

                if (entry?.signalId && entry?.source) {
                    try {
                        entry.source.disconnect(entry.signalId);
                    } catch (_e) {
                    }
                }
            }

            this._allocationSyncedClones.clear();
            this._allocationSyncedClones = null;
        }

        _cleanupSourceVisibilityTracking() {
            this._disconnectSignal(this._sourceIndicator, '_sourceVisibleId');
            this._disconnectSignal(this._sourceChildVisibleActor, '_sourceChildVisibleId');
            this._sourceChildVisibleActor = null;

            if (!this._sourceGrandchildVisibleIds)
                return;

            for (const {actor, signalId} of this._sourceGrandchildVisibleIds) {
                try {
                    actor.disconnect(signalId);
                } catch (_e) {
                }
            }

            this._sourceGrandchildVisibleIds = null;
        }

        _cleanupActivitiesSignals() {
            if (this._role !== 'activities')
                return;

            this._disconnectSignal(Main.overview, '_showingId');
            this._disconnectSignal(Main.overview, '_hidingId');
            this._disconnectSignal(this._workspaceManager, '_activeWsChangedId');
            this._disconnectSignal(this._workspaceManager, '_nWorkspacesChangedId');
        }

        _initActivitiesButton() {
            // Create the activities indicator with workspace dots like main panel
            this.accessible_role = Atk.Role.TOGGLE_BUTTON;
            this.name = 'mmPanelActivities';
            this.add_style_class_name('panel-button');
            this.add_style_class_name('mm-activities');

            // Set up for full height hover
            this.y_expand = true;
            this.y_align = Clutter.ActorAlign.FILL;

            // Container for workspace dots - centered vertically
            this._workspaceDotsBox = new St.BoxLayout({
                style_class: 'workspace-dots',
                y_align: Clutter.ActorAlign.CENTER,
                x_align: Clutter.ActorAlign.CENTER,
                y_expand: true,
            });
            this._applyZeroSpacingStyle(this._workspaceDotsBox);

            this.add_child(this._workspaceDotsBox);
            this.label_actor = this._workspaceDotsBox;

            // Store workspace manager reference first
            this._workspaceManager = global.workspace_manager;

            // Build initial workspace dots
            this._updateWorkspaceDots();

            // Connect to workspace changes
            this._activeWsChangedId = this._workspaceManager.connect('active-workspace-changed',
                this._updateWorkspaceDots.bind(this));
            this._nWorkspacesChangedId = this._workspaceManager.connect('notify::n-workspaces',
                this._updateWorkspaceDots.bind(this));

            // Sync with overview state
            this._showingId = Main.overview.connect('showing', () => {
                this.add_style_pseudo_class('overview');
                this.add_accessible_state(Atk.StateType.CHECKED);
            });

            this._hidingId = Main.overview.connect('hiding', () => {
                this.remove_style_pseudo_class('overview');
                this.remove_accessible_state(Atk.StateType.CHECKED);
            });

            this._sourceIndicator = null;
        }

        _updateWorkspaceDots() {
            if (!this._workspaceDotsBox || !this._workspaceManager)
                return;

            // Remove existing dots
            this._workspaceDotsBox.remove_all_children();

            const nWorkspaces = this._workspaceManager.n_workspaces;
            const activeIndex = this._workspaceManager.get_active_workspace_index();

            for (let i = 0; i < nWorkspaces; i++) {
                const isActive = (i === activeIndex);
                const dot = new St.Widget({
                    style_class: isActive ? 'workspace-dot active' : 'workspace-dot',
                    width: isActive ? 34 : 7,
                    height: isActive ? 8 : 7,
                    style: `border-radius: 6px; background-color: rgba(255, 255, 255, ${isActive ? '1' : '0.5'}); margin: 0 2px;`,
                    y_align: Clutter.ActorAlign.CENTER,
                });
                this._workspaceDotsBox.add_child(dot);
            }
        }

        _initGenericIndicator(role) {
            this._sourceIndicator = Main.panel.statusArea[role] || null;

            if (this._sourceIndicator) {
                const sourceChild = this._sourceIndicator.get_first_child();
                if (!this._hasVisibleSourceContent(sourceChild)) {
                    if (this._shouldTrackHiddenSource(role)) {
                        this._createIndicatorClone();
                        this.visible = false;
                        this._trackSourceVisibility(sourceChild);
                        return;
                    }

                    this._isEmpty = true;
                    this.visible = false;
                    return;
                }

                this._createIndicatorClone();
                this._trackSourceVisibility(sourceChild);
            } else {
                this._createFallbackIcon();
            }
        }

        _shouldTrackHiddenSource(role) {
            return role === 'keyboard' ||
                role === 'screenSharing' ||
                role === 'screenRecording' ||
                role === 'screencast';
        }

        _hasVisibleSourceContent(sourceChild = null) {
            if (!this._sourceIndicator)
                return false;

            const child = sourceChild ?? this._sourceIndicator.get_first_child();
            if (!child)
                return false;

            if (!this._sourceIndicator.visible || !child.visible)
                return false;

            if (child instanceof St.BoxLayout) {
                const visibleChildren = child.get_children().filter(c => c.visible);
                if (visibleChildren.length === 0)
                    return false;
            }

            return true;
        }

        _syncSourceVisibility() {
            if (this._isDestroying)
                return;

            const hasVisibleContent = this._hasVisibleSourceContent();
            this.visible = hasVisibleContent;

            if (!hasVisibleContent)
                this.remove_style_pseudo_class?.('active');
        }

        _trackSourceVisibility(sourceChild = null) {
            this._syncSourceVisibility();

            if (this._sourceVisibleId)
                this._sourceIndicator.disconnect(this._sourceVisibleId);
            this._sourceVisibleId = this._sourceIndicator.connect('notify::visible',
                this._syncSourceVisibility.bind(this));

            const child = sourceChild ?? this._sourceIndicator.get_first_child();
            if (!child)
                return;

            this._sourceChildVisibleActor = child;
            if (this._sourceChildVisibleId)
                child.disconnect?.(this._sourceChildVisibleId);
            if (child.connect)
                this._sourceChildVisibleId = child.connect('notify::visible',
                    this._syncSourceVisibility.bind(this));

            const children = child.get_children?.() ?? [];
            this._sourceGrandchildVisibleIds = [];
            for (const grandchild of children) {
                if (!grandchild?.connect)
                    continue;

                const signalId = grandchild.connect('notify::visible',
                    this._syncSourceVisibility.bind(this));
                this._sourceGrandchildVisibleIds.push({ actor: grandchild, signalId });
            }
        }

        _createIndicatorClone() {
            try {
                const sourceChild = this._sourceIndicator.get_first_child();
                if (!sourceChild) {
                    this._createFallbackIcon();
                    return;
                }

                // 1. Quick Settings (Handle explicitly regardless of structure)
                if (this._role === 'quickSettings') {
                    this.add_style_class_name('mm-quick-settings');
                    // Use FILL for full panel height hover detection
                    this.y_expand = true;
                    this.y_align = Clutter.ActorAlign.FILL;
                    const container = new St.BoxLayout({
                        style_class: 'mm-quick-settings-box',
                        y_align: Clutter.ActorAlign.FILL,
                        y_expand: true,
                    });
                    this._applyZeroSpacingStyle(container);

                    const leftSpacer = new St.Widget({
                        reactive: false,
                        width: 0,
                    });
                    const content = new St.BoxLayout({
                        y_align: Clutter.ActorAlign.FILL,
                        y_expand: true,
                    });
                    const rightSpacer = new St.Widget({
                        reactive: false,
                        width: 0,
                    });

                    this._applyContainerSpacing(content, this._getQuickSettingsGap());
                    this._applyZeroSpacingStyle(content, this._getQuickSettingsGapStyle());

                    container.add_child(leftSpacer);
                    container.add_child(content);
                    container.add_child(rightSpacer);

                    this._quickSettingsOuterContainer = container;
                    this._quickSettingsPaddingLeft = leftSpacer;
                    this._quickSettingsPaddingRight = rightSpacer;

                    this._createStaticIconCopy(content, sourceChild);
                    this.add_child(container);
                    return;
                }

                if (this._role === 'dateMenu') {
                    const container = new St.BoxLayout({
                        style_class: sourceChild.get_style_class_name?.() || 'clock-display-box',
                        y_align: Clutter.ActorAlign.FILL,
                        y_expand: true,
                    });
                    this._applyZeroSpacingStyle(container);
                    this._createAllocationSyncedClone(container, sourceChild, 'dateMenu');
                    this.add_child(container);
                    return;
                }

                // 2. Favorites Menu (Special handling)
                if (this._role === 'favorites-menu' || (this._role && (this._role.toLowerCase().includes('favorites') || this._role.toLowerCase().includes('favorite')))) {
                    this.add_style_class_name('mm-favorites-menu');
                    this.y_expand = true;
                    this.y_align = Clutter.ActorAlign.FILL;
                    const container = new St.BoxLayout({
                        style_class: 'mm-favorites-menu-box',
                        y_align: Clutter.ActorAlign.FILL,
                        y_expand: true,
                    });
                    this._applyZeroSpacingStyle(container);
                    this._createFillClone(container, sourceChild);
                    this.add_child(container);
                    return;
                }

                if (this._role === 'keyboard' ||
                    this._role === 'screenSharing' ||
                    this._role === 'screenRecording' ||
                    this._role === 'screencast') {
                    const container = new St.BoxLayout({
                        style_class: sourceChild.get_style_class_name?.() || 'panel-status-menu-box',
                        x_align: Clutter.ActorAlign.CENTER,
                        x_expand: false,
                        y_align: Clutter.ActorAlign.CENTER,
                        y_expand: false,
                    });
                    this._applyZeroSpacingStyle(container);
                    this._createStaticIconCopy(container, sourceChild);
                    this.add_child(container);
                    return;
                }

                // 3. Generic Handling
                if (sourceChild instanceof St.BoxLayout) {
                    // Container is FILL to get full-height hover, but clone inside is centered
                    const container = new St.BoxLayout({
                        style_class: sourceChild.get_style_class_name() || 'panel-status-menu-box',
                        y_align: Clutter.ActorAlign.FILL,
                        y_expand: true,
                    });
                    this._applyZeroSpacingStyle(container);
                    this._createSimpleClone(container, sourceChild);
                    this.add_child(container);
                } else {
                    this._createSimpleClone(this, sourceChild);
                }

            } catch (e) {
                console.debug('[MultiMonitors] Failed to create mirrored indicator:', String(e));
                this._createFallbackIcon();
            }
        }

        _createClockDisplay(container) {
            const clockDisplay = new St.Label({
                style_class: 'clock',
                y_align: Clutter.ActorAlign.CENTER,
            });
            this._applyZeroSpacingStyle(clockDisplay);

            const updateClock = () => {
                if (this._sourceIndicator._clockDisplay) {
                    clockDisplay.text = this._sourceIndicator._clockDisplay.text;
                }
            };

            updateClock();

            // Remove existing timeout before creating new one
            if (this._clockUpdateId) {
                GLib.source_remove(this._clockUpdateId);
                this._clockUpdateId = null;
            }

            this._clockUpdateId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
                try {
                    updateClock();
                    return GLib.SOURCE_CONTINUE;
                } catch (e) {
                    this._clockUpdateId = null;
                    return GLib.SOURCE_REMOVE;
                }
            });

            container.add_child(clockDisplay);
            this._clockDisplay = clockDisplay;
        }

        _createSimpleClone(parent, source) {
            // Check if this is a problematic extension that needs static icon copies
            // (Extensions that resize during fullscreen or shrink on GNOME < 49)
            // This includes:
            // - Tiling extensions: resize during fullscreen
            // - System Monitor extensions: shrink icons on GNOME < 49
            // - AppIndicator extensions: shrink icons on GNOME < 49
            const problematicExtensions = [
                // Tiling extensions
                'tiling', 'tilingshell', 'forge', 'pop-shell',
                // System monitor extensions (shrink on GNOME < 49)
                'system-monitor', 'system_monitor', 'vitals', 'tophat', 'astra-monitor',
                // AppIndicator/tray extensions (shrink on GNOME < 49)
                'appindicator', 'ubuntu-appindicator', 'kstatusnotifier', 'tray',
                // ArcMenu (squished icon fix) - checks loose 'arc' to catch variations
                'arcmenu', 'arc-menu', 'arc'
            ];
            const isProblematic = problematicExtensions.some(name =>
                this._role && this._role.toLowerCase().includes(name)
            );

            if (isProblematic) {
                // Use static icon copies for problematic extensions
                this._createStaticIconCopy(parent, source);
                return;
            }

            this._createAllocationSyncedClone(parent, source, `simple:${this._role ?? 'generic'}`);
        }

        _createQuickSettingsClone(parent, source) {
            // Clutter.Clone paints the source at the source's ALLOCATION size,
            // but get_preferred_width/height returns the source's PREFERRED size.
            // On the primary panel, allocation ≠ preferred (panel constrains the source).
            // - CENTER/y_expand:false → clone gets preferred height → too short → compresses
            // - FILL/y_expand:true → clone fills secondary panel → too tall → stretches
            //
            // The ONLY correct approach: explicitly set the clone's size to match
            // the source's actual allocation dimensions, then track changes.
            const clone = new Clutter.Clone({
                source: source,
            });

            parent.add_child(clone);

            this._quickSettingsClone = clone;
            this._quickSettingsSource = source;
            this._quickSettingsContainer = parent;
            this._lastSourceW = 0;
            this._lastSourceH = 0;

            // Sync clone size to source's actual allocation (not preferred size)
            const syncSize = () => {
                if (!this._quickSettingsSource || !this._quickSettingsClone)
                    return;
                try {
                    const alloc = this._quickSettingsSource.get_allocation_box();
                    const w = alloc.get_width();
                    const h = alloc.get_height();

                    if (w > 0 && h > 0 &&
                        (Math.abs(w - this._lastSourceW) > 0.5 ||
                            Math.abs(h - this._lastSourceH) > 0.5)) {
                        this._lastSourceW = w;
                        this._lastSourceH = h;
                        this._quickSettingsClone.set_size(w, h);
                    }
                } catch (e) {
                    // Source may not have allocation yet
                }
            };

            // Disconnect previous signal if any
            if (this._sourceSizeChangedId && this._quickSettingsSource) {
                this._quickSettingsSource.disconnect(this._sourceSizeChangedId);
                this._sourceSizeChangedId = null;
            }

            // Track source allocation changes
            this._sourceSizeChangedId = source.connect('notify::allocation', syncSize);

            // Initial sync after first layout pass
            this._qsInitialSyncId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
                try { syncSize(); } catch (e) { }
                this._qsInitialSyncId = null;
                return GLib.SOURCE_REMOVE;
            });

            // Monitor fullscreen state changes on primary monitor
            this._fullscreenChangedId = global.display.connect('in-fullscreen-changed',
                this._onQuickSettingsFullscreenChanged.bind(this));
        }

        _createAllocationSyncedClone(parent, source, kind = 'generic') {
            const clone = new Clutter.Clone({
                source: source,
                y_align: Clutter.ActorAlign.CENTER,
            });
            clone.visible = false;

            parent.add_child(clone);

            if (!this._allocationSyncedClones)
                this._allocationSyncedClones = new Map();

            const syncKey = kind || 'generic';
            const previous = this._allocationSyncedClones.get(syncKey);
            if (previous?.signalId && previous?.source) {
                try {
                    previous.source.disconnect(previous.signalId);
                } catch (_e) {
                }
            }
            if (previous?.timeoutId) {
                GLib.source_remove(previous.timeoutId);
            }

            const syncSize = () => {
                if (this._isDestroying || !source || !clone)
                    return;

                try {
                    const alloc = source.get_allocation_box();
                    const width = alloc.get_width();
                    const height = alloc.get_height();

                    if (width > 0 && height > 0) {
                        clone.set_size(width, height);
                        clone.visible = true;
                    } else {
                        clone.visible = false;
                    }
                } catch (_e) {
                    clone.visible = false;
                }
            };

            const signalId = source.connect('notify::allocation', syncSize);
            const timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
                syncSize();
                const entry = this._allocationSyncedClones?.get(syncKey);
                if (entry)
                    entry.timeoutId = null;
                return GLib.SOURCE_REMOVE;
            });

            this._allocationSyncedClones.set(syncKey, {
                clone,
                source,
                signalId,
                timeoutId,
            });
        }

        _onQuickSettingsFullscreenChanged() {
            if (!this._quickSettingsClone) return;
            // The allocation sync will handle size changes from fullscreen
            // Just queue a relayout to pick up the new source allocation
            this._quickSettingsClone.queue_relayout();
        }

        _applyNormalMode() {
            // Not used
        }

        _applyOverviewMode() {
            // Not used
        }

        _monitorSize(duration) {
            // Since we removed the clipping container and use FILL,
            // this just tracks the max observed width for reference
            if (this._monitorTimeoutId) {
                GLib.source_remove(this._monitorTimeoutId);
                this._monitorTimeoutId = null;
            }

            const startTime = GLib.get_monotonic_time();
            const endTime = startTime + (duration * 1000);

            const checkSize = () => {
                try {
                    if (!this._quickSettingsSource) {
                        return GLib.SOURCE_REMOVE;
                    }

                    // Get source size (max of actual and preferred)
                    const [minW, natW] = this._quickSettingsSource.get_preferred_width(-1);
                    const [actW] = this._quickSettingsSource.get_size();
                    const sourceWidth = Math.max(natW, minW, actW);

                    // Track max observed width
                    if (sourceWidth > (this._cachedWidth || 0)) {
                        this._cachedWidth = sourceWidth;
                    }

                    // Stop after duration
                    if (GLib.get_monotonic_time() > endTime) {
                        this._monitorTimeoutId = null;
                        return GLib.SOURCE_REMOVE;
                    }

                    return GLib.SOURCE_CONTINUE;
                } catch (e) {
                    this._monitorTimeoutId = null;
                    return GLib.SOURCE_REMOVE;
                }
            };

            this._monitorTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, checkSize);
        }

        _onSourceWidthChanged() {
            // Do nothing if width is locked (initial size captured)
            if (this._widthLocked) {
                return;
            }
            // Before locked, track the width
            if (this._monitorTimeoutId) {
                // Already monitoring, let it handle
            } else {
                this._monitorSize(500);
            }
        }

        _detectAndLockWidth() {
            // Unused - replaced by initial size capture
        }

        _isPrimaryMonitorFullscreen() {
            // Check if any window is fullscreen on the primary monitor
            const primaryIndex = Main.layoutManager.primaryIndex;
            const windows = global.get_window_actors();

            for (const actor of windows) {
                const metaWindow = actor.get_meta_window();
                if (metaWindow &&
                    metaWindow.is_fullscreen() &&
                    metaWindow.get_monitor() === primaryIndex) {
                    return true;
                }
            }
            return false;
        }

        _createStaticIconCopy(parent, source) {
            // Create static icon copies for problematic extensions (Tiling Shell, etc.)
            // These are immune to source changes during fullscreen
            const container = this._isQuickSettingsRole()
                ? parent
                : new St.BoxLayout({
                    style_class: 'panel-status-menu-box',
                    x_align: Clutter.ActorAlign.CENTER,
                    y_align: Clutter.ActorAlign.CENTER,
                    y_expand: false,
                    reactive: false,
                });

            if (this._isQuickSettingsRole()) {
                this._applyContainerSpacing(container, this._getQuickSettingsGap());
                this._applyZeroSpacingStyle(container, this._getQuickSettingsGapStyle());
            } else {
                this._applyZeroSpacingStyle(container);
            }

            // Copy all icons from the source
            this._copyIconsFromSource(container, source);
            if (this._shouldSyncRoleContainerAppearance())
                this._syncMirroredContainerAppearance(container, source);
            if (!this._isQuickSettingsRole())
                parent.add_child(container);
            this._iconContainer = container;
            this._iconSource = source;
            if (this._isQuickSettingsRole())
                this._quickSettingsContainer = container;

            // Periodically sync icons (every 5 seconds) to catch icon changes
            this._startIconSync();
        }

        _usesDirectLabelSync() {
            return this._isDirectSyncRole();
        }

        _getMirroredSourceInlineStyle(widget) {
            if (!widget?.get_style)
                return null;

            if (this._role === 'keyboard')
                return null;

            return widget.get_style?.() ?? null;
        }

        _shouldSyncRoleContainerAppearance() {
            return this._role === 'screenRecording' ||
                this._role === 'screencast' ||
                this._role === 'screenSharing';
        }

        _getActorDepth(actor) {
            let depth = 0;
            let current = actor;

            while (current) {
                depth++;
                current = current.get_parent?.() ?? null;
            }

            return depth;
        }

        _isPreferredRoleActionActor(actor) {
            if (!actor)
                return false;

            return actor.reactive === true ||
                actor.can_focus === true ||
                actor.track_hover === true ||
                actor instanceof St.Button ||
                typeof actor.clicked === 'function' ||
                typeof actor.toggle === 'function' ||
                typeof actor.stop === 'function' ||
                typeof actor.stopRecording === 'function' ||
                typeof actor.stopScreencast === 'function' ||
                typeof actor.stopSharing === 'function';
        }

        _findPreferredRoleActor(root, predicate) {
            if (!root)
                return null;

            const queue = [root];
            const visited = new Set();
            let bestMatch = null;
            let bestDepth = -1;

            while (queue.length > 0) {
                const actor = queue.shift();
                if (!actor || visited.has(actor))
                    continue;

                visited.add(actor);

                if (predicate(actor)) {
                    const depth = this._getActorDepth(actor);
                    if (depth > bestDepth) {
                        bestMatch = actor;
                        bestDepth = depth;
                    }
                }

                const children = actor.get_children?.() ?? [];
                for (const child of children)
                    queue.push(child);
            }

            return bestMatch;
        }

        _getRoleAppearanceSource(root) {
            if (!this._shouldSyncRoleContainerAppearance())
                return root;

            return this._findPreferredRoleActor(root, actor =>
                this._isPreferredRoleActionActor(actor) ||
                actor.has_style_pseudo_class?.('active') ||
                actor.has_style_pseudo_class?.('checked') ||
                Boolean(actor.get_style_class_name?.()) ||
                Boolean(actor.get_style?.())) ?? root;
        }

        _syncMirroredContainerAppearance(container, source) {
            if (!container || !source)
                return;

            const syncAppearance = () => {
                if (this._isDestroying)
                    return;

                try {
                    const appearanceSource = this._getRoleAppearanceSource(source) ?? source;
                    const nextStyleClass = appearanceSource.get_style_class_name?.() || 'panel-status-menu-box';
                    if (container.get_style_class_name?.() !== nextStyleClass)
                        container.set_style_class_name(nextStyleClass);

                    this._applyZeroSpacingStyle(container, appearanceSource.get_style?.() ?? '');

                    const nextVisible = this._isEffectivelyVisible(appearanceSource, this._sourceIndicator);
                    if (container.visible !== nextVisible)
                        container.visible = nextVisible;

                    if (appearanceSource.has_style_pseudo_class?.('active')) {
                        container.add_style_pseudo_class('active');
                        this.add_style_pseudo_class('active');
                    } else {
                        container.remove_style_pseudo_class('active');
                        this.remove_style_pseudo_class('active');
                    }

                    if (appearanceSource.has_style_pseudo_class?.('checked')) {
                        container.add_style_pseudo_class('checked');
                        this.add_style_pseudo_class('checked');
                    } else {
                        container.remove_style_pseudo_class('checked');
                        this.remove_style_pseudo_class('checked');
                    }
                } catch (_e) {
                }
            };

            syncAppearance();
            this._trackWidgetSignals(source, ['notify::style', 'notify::visible'], syncAppearance);
        }

        _findDirectActionTarget(actionNames) {
            const target = this._findPreferredRoleActor(this._sourceIndicator, actor =>
                actionNames.some(actionName => typeof actor[actionName] === 'function'));
            if (!target)
                return null;

            const actionName = actionNames.find(name => typeof target[name] === 'function');
            return actionName ? {target, actionName} : null;
        }

        _findClickableTarget() {
            return this._findPreferredRoleActor(this._sourceIndicator, actor =>
                typeof actor?.clicked === 'function' ||
                actor instanceof St.Button ||
                actor.reactive === true);
        }

        _clearTrackedWidgetSignals() {
            if (!this._trackedWidgetSignals)
                return;

            for (const { sourceWidget, signalId } of this._trackedWidgetSignals) {
                if (!sourceWidget || !signalId)
                    continue;

                try {
                    sourceWidget.disconnect(signalId);
                } catch (_e) {
                }
            }

            this._trackedWidgetSignals = [];
        }

        _isEffectivelyVisible(widget, stopActor = null) {
            let current = widget;

            while (current) {
                if (current.visible === false)
                    return false;

                if (current === stopActor)
                    return true;

                current = current.get_parent?.() ?? null;
            }

            return true;
        }

        _copyIconsFromSource(container, source) {
            this._clearTrackedWidgetSignals();

            // Remove existing children
            container.remove_all_children();

            // Find all display widgets (icons and labels) in the source and create copies
            const widgets = this._findAllDisplayWidgets(source);

            if (widgets.length > 0) {
                for (const widget of widgets) {
                    if (widget instanceof St.Icon) {
                        const iconCopy = new St.Icon({
                            gicon: widget.gicon,
                            icon_name: widget.icon_name,
                            icon_size: widget.icon_size || 16,
                            style_class: widget.get_style_class_name() || 'system-status-icon',
                            y_align: Clutter.ActorAlign.CENTER,
                        });
                        this._trackMirroredCopySignals(
                            widget,
                            [
                                'notify::gicon',
                                'notify::icon-name',
                                'notify::icon-size',
                                'notify::style',
                                'notify::visible',
                            ],
                            iconCopy,
                            source,
                            () => {
                                iconCopy.gicon = widget.gicon;
                                iconCopy.icon_name = widget.icon_name;
                                iconCopy.icon_size = widget.icon_size || 16;
                            },
                            'system-status-icon'
                        );

                        container.add_child(iconCopy);
                    } else if (widget instanceof St.Label) {
                        // Skip labels for ArcMenu (user request)
                        // Use loose check to catch any variation
                        if (this._role && this._role.toLowerCase().includes('arc')) {
                            continue;
                        }

                        // Copy labels (like Vitals' numbers/text values)
                        const labelCopy = new St.Label({
                            text: widget.text,
                            style_class: widget.get_style_class_name() || '',
                            x_expand: false,
                            y_expand: false,
                            y_align: Clutter.ActorAlign.CENTER,
                        });
                        if (labelCopy.clutter_text)
                            labelCopy.clutter_text.y_align = Clutter.ActorAlign.CENTER;

                        this._trackMirroredCopySignals(
                            widget,
                            ['notify::text', 'notify::style', 'notify::visible'],
                            labelCopy,
                            source,
                            () => {
                                labelCopy.text = widget.text;
                            }
                        );

                        // Store reference to sync text later
                        labelCopy._sourceLabel = widget;
                        container.add_child(labelCopy);
                    }
                }
            } else {
                // Fallback: use an allocation-synced clone so it is not painted
                // before the source has a valid size.
                this._createAllocationSyncedClone(container, source, `fallback:${this._role ?? 'generic'}`);
            }
        }

        _findAllDisplayWidgets(actor, stopActor = actor) {
            // Recursively find all visible St.Icon and St.Label instances in an actor tree.
            // Hidden branches are skipped so transient/unused Quick Settings values
            // do not leak into the mirrored panel.
            const widgets = [];
            if (!actor || !this._isEffectivelyVisible(actor, stopActor))
                return widgets;

            if (actor instanceof St.Icon || actor instanceof St.Label) {
                widgets.push(actor);
                return widgets;
            }

            const children = actor.get_children ? actor.get_children() : [];
            for (const child of children) {
                widgets.push(...this._findAllDisplayWidgets(child, stopActor));
            }
            return widgets;
        }

        _startIconSync() {
            if (this._iconSyncId) {
                GLib.source_remove(this._iconSyncId);
                this._iconSyncId = null;
            }
            if (this._labelSyncId) {
                GLib.source_remove(this._labelSyncId);
                this._labelSyncId = null;
            }

            // Full rebuild every 5 seconds to catch added/removed icons
            this._iconSyncId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 5, () => {
                try {
                    if (this._isDestroying) {
                        this._iconSyncId = null;
                        return GLib.SOURCE_REMOVE;
                    }

                    if (this._iconContainer && this._iconSource) {
                        this._copyIconsFromSource(this._iconContainer, this._iconSource);
                        if (this._shouldSyncRoleContainerAppearance())
                            this._syncMirroredContainerAppearance(this._iconContainer, this._iconSource);
                    }
                    return GLib.SOURCE_CONTINUE;
                } catch (e) {
                    this._iconSyncId = null;
                    return GLib.SOURCE_REMOVE;
                }
            });

            if (this._usesDirectLabelSync())
                return;

            // Sync label text more frequently (every 2 seconds) for Vitals-like extensions
            this._labelSyncId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2, () => {
                try {
                    if (this._isDestroying) {
                        this._labelSyncId = null;
                        return GLib.SOURCE_REMOVE;
                    }

                    if (this._iconContainer) {
                        this._syncLabelTexts(this._iconContainer);
                    }
                    return GLib.SOURCE_CONTINUE;
                } catch (e) {
                    this._labelSyncId = null;
                    return GLib.SOURCE_REMOVE;
                }
            });
        }

        _syncLabelTexts(container) {
            // Update label text from source labels
            const children = container.get_children();
            for (const child of children) {
                if (child instanceof St.Label && child._sourceLabel) {
                    try {
                        child.text = child._sourceLabel.text;
                    } catch (_e) {
                    }
                }
            }
        }

        _createFillClone(parent, source) {
            // For favorites-menu@fthx - create real widget copy instead of Clutter.Clone
            // This prevents visual glitches when the main panel hides during fullscreen
            const container = new St.BoxLayout({
                style_class: source.get_style_class_name ? source.get_style_class_name() : 'panel-status-menu-box',
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
                y_expand: true,
                reactive: false,
            });
            this._applyZeroSpacingStyle(container);

            // Find and copy the icon from the source (favorites-menu uses starred-symbolic icon)
            const icon = this._findIconInActor(source);
            if (icon) {
                const iconCopy = new St.Icon({
                    gicon: icon.gicon,
                    icon_name: icon.icon_name || 'starred-symbolic',
                    icon_size: icon.icon_size || 16,
                    style_class: icon.get_style_class_name() || 'system-status-icon',
                    y_align: Clutter.ActorAlign.CENTER,
                });
                this._applyZeroSpacingStyle(iconCopy);
                container.add_child(iconCopy);
            } else {
                // Fallback: create the starred icon directly
                const fallbackIcon = new St.Icon({
                    icon_name: 'starred-symbolic',
                    style_class: 'system-status-icon',
                    y_align: Clutter.ActorAlign.CENTER,
                });
                this._applyZeroSpacingStyle(fallbackIcon);
                container.add_child(fallbackIcon);
            }

            parent.add_child(container);
            this._favoritesContainer = container;
        }

        _findIconInActor(actor) {
            // Recursively find St.Icon in an actor tree
            if (actor instanceof St.Icon) {
                return actor;
            }
            const children = actor.get_children ? actor.get_children() : [];
            for (const child of children) {
                const found = this._findIconInActor(child);
                if (found) return found;
            }
            return null;
        }

        _createFallbackIcon() {
            const label = new St.Label({
                text: '⚙',
                y_align: Clutter.ActorAlign.CENTER
            });
            this._applyZeroSpacingStyle(label);
            this.add_child(label);
        }

        vfunc_button_press_event(buttonEvent) {
            this._onButtonPress();
            return Clutter.EVENT_STOP;
        }

        vfunc_event(event) {
            if (event.type() === Clutter.EventType.BUTTON_PRESS) {
                return this.vfunc_button_press_event(event);
            }
            return super.vfunc_event(event);
        }

        _onButtonPress() {
            if (this._role === 'activities') {
                Main.overview.toggle();
                return Clutter.EVENT_STOP;
            }

            if (this._handleDirectIndicatorAction())
                return Clutter.EVENT_STOP;

            // Check for standard menu first
            if (this._sourceIndicator && this._sourceIndicator.menu) {
                return this._openMirroredMenu();
            }

            // Handle extensions with custom popup menus (like favorite-apps-menu@venovar)
            // These extensions have _popupFavoriteAppsMenu or similar custom menus
            if (this._sourceIndicator) {
                // ArcMenu specific: try toggleMenu method directly
                if (typeof this._sourceIndicator.toggleMenu === 'function') {
                    return this._openArcMenu();
                }

                // ArcMenu specific: try arcMenu property
                if (this._sourceIndicator.arcMenu && typeof this._sourceIndicator.arcMenu.toggle === 'function') {
                    return this._openArcMenu();
                }

                // ArcMenu specific: try _menuButton.toggleMenu
                if (this._sourceIndicator._menuButton && typeof this._sourceIndicator._menuButton.toggleMenu === 'function') {
                    return this._openArcMenu();
                }

                // Try to find and open custom popup menus
                const customMenus = [
                    '_popupFavoriteAppsMenu',
                    '_popupPowerItemsMenu',
                    '_popup',
                    '_popupMenu'
                ];

                for (const menuName of customMenus) {
                    if (this._sourceIndicator[menuName]?.toggle) {
                        return this._openCustomPopupMenu(this._sourceIndicator[menuName]);
                    }
                }

                // Avoid forwarding raw button-press-event to generic St.Widget instances.
                // Some indicators expose the signal but still rely on an unimplemented vfunc.
                if (typeof this._sourceIndicator?.clicked === 'function' ||
                    this._sourceIndicator instanceof St.Button) {
                    return this._forwardClickToSource();
                }
            }

            return Clutter.EVENT_PROPAGATE;
        }

        _handleDirectIndicatorAction() {
            if (!this._sourceIndicator)
                return false;

            const directActions = this._role === 'screenRecording' || this._role === 'screencast'
                ? ['stop', '_stop', 'stopRecording', '_stopRecording', 'stopScreencast', '_stopScreencast']
                : this._role === 'screenSharing'
                    ? ['stop', '_stop', 'stopSharing', '_stopSharing']
                    : [];

            const action = this._findDirectActionTarget(directActions);
            if (action) {
                try {
                    action.target[action.actionName]();
                    return true;
                } catch (_e) {
                }
            }

            if (this._role === 'screenRecording' ||
                this._role === 'screencast' ||
                this._role === 'screenSharing') {
                return this._forwardClickToSource() === Clutter.EVENT_STOP;
            }

            return false;
        }

        _forwardClickToSource() {
            // Forward the click to the source indicator
            // This makes the source indicator handle the click as if it was clicked directly
            this._setButtonActive(true);

            try {
                const clickableTarget = this._findClickableTarget();
                if (typeof clickableTarget?.clicked === 'function') {
                    clickableTarget.clicked();
                } else if (typeof clickableTarget?.toggle === 'function') {
                    clickableTarget.toggle();
                } else if (clickableTarget instanceof St.Button &&
                    typeof clickableTarget?.emit === 'function') {
                    clickableTarget.emit('clicked');
                } else {
                    this._setButtonActive(false);
                    return Clutter.EVENT_PROPAGATE;
                }
            } catch (_e) {
                this._setButtonActive(false);
                return Clutter.EVENT_PROPAGATE;
            }

            this._replaceTimeout('_forwardClickTimeoutId', 150, () => {
                this._setButtonActive(false);
                return GLib.SOURCE_REMOVE;
            });

            return Clutter.EVENT_STOP;
        }

        _openArcMenu() {
            // Find ArcMenu's internal menu object
            let arcMenu = null;
            let toggleFunc = null;

            if (this._sourceIndicator.arcMenu) {
                arcMenu = this._sourceIndicator.arcMenu;
                toggleFunc = () => this._sourceIndicator.arcMenu.toggle();
            } else if (this._sourceIndicator._menuButton?.arcMenu) {
                arcMenu = this._sourceIndicator._menuButton.arcMenu;
                toggleFunc = () => this._sourceIndicator._menuButton.toggleMenu();
            } else if (typeof this._sourceIndicator.toggleMenu === 'function') {
                // Try to find arcMenu property on the indicator
                arcMenu = this._sourceIndicator.arcMenu || this._sourceIndicator.menu;
                toggleFunc = () => this._sourceIndicator.toggleMenu();
            }

            // If we found a menu, try to reposition it
            if (arcMenu && arcMenu.sourceActor) {
                const originalSourceActor = arcMenu.sourceActor;
                const sourceState = this._preventMainPanelActiveState();

                // Add active style to THIS button
                this._setButtonActive(true);

                // Temporarily change sourceActor to this button for positioning
                this._setMenuSourceActor(arcMenu, this);

                // Connect to menu close to restore state
                this._bindMenuLifecycle(arcMenu, () => {
                    this._setButtonActive(false);
                    this._setMenuSourceActor(arcMenu, originalSourceActor);
                    this._restoreSourceIndicatorMenuState(sourceState);
                });

                // Toggle the menu
                if (toggleFunc) {
                    toggleFunc();
                }
            } else {
                // Fallback: just toggle without repositioning
                this._setButtonActive(true);

                if (typeof this._sourceIndicator.toggleMenu === 'function') {
                    this._sourceIndicator.toggleMenu();
                } else if (this._sourceIndicator.arcMenu?.toggle) {
                    this._sourceIndicator.arcMenu.toggle();
                } else if (this._sourceIndicator._menuButton?.toggleMenu) {
                    this._sourceIndicator._menuButton.toggleMenu();
                }

                // Clean up active state after a short delay
                this._replaceTimeout('_arcMenuTimeoutId', 300, () => {
                    this._setButtonActive(false);
                    return GLib.SOURCE_REMOVE;
                });
            }

            return Clutter.EVENT_STOP;
        }

        _openCustomPopupMenu(popupMenu) {
            const monitorIndex = Main.layoutManager.findIndexForActor(this);
            const originalSourceActor = popupMenu.sourceActor;

            // Close the menu if it's already open
            if (popupMenu.isOpen) {
                popupMenu.close();
                return Clutter.EVENT_STOP;
            }

            // Add active style to this button
            this._setButtonActive(true);

            // Update popup's sourceActor to position correctly
            this._setMenuSourceActor(popupMenu, this);

            // Update positioning for the correct monitor
            if (popupMenu.box) {
                const monitor = Main.layoutManager.monitors[monitorIndex];
                if (monitor && popupMenu.box._updateFlip) {
                    popupMenu.box._updateFlip(monitor);
                }
            }

            // Setup cleanup on menu close
            this._bindMenuLifecycle(
                popupMenu,
                () => {
                    this._setButtonActive(false);
                    this._setMenuSourceActor(popupMenu, originalSourceActor);
                },
                () => this._setButtonActive(true)
            );

            popupMenu.open();

            return Clutter.EVENT_STOP;
        }

        _openMirroredMenu() {
            const monitorIndex = Main.layoutManager.findIndexForActor(this);
            const menu = this._sourceIndicator.menu;

            // Store original state variables
            const originalSourceActor = menu.sourceActor;
            const originalBoxPointer = menu.box?._sourceActor;
            const sourceState = this._preventMainPanelActiveState();

            // State for restoring menu box modifications
            let menuBoxState = null;

            if (menu.isOpen) {
                menu.close();
                return Clutter.EVENT_STOP;
            }

            // Add active style to THIS button
            this._setButtonActive(true);

            // Update menu's sourceActor
            this._setMenuSourceActor(menu, this);

            // Update BoxPointer positioning and save state for restoration
            if (menu.box) {
                menuBoxState = this._updateMenuPositioning(menu, monitorIndex);
            }

            // Setup cleanup on menu close
            this._bindMenuLifecycle(
                menu,
                () => this._restoreMenuState(
                    menu,
                    originalSourceActor,
                    originalBoxPointer,
                    sourceState,
                    menuBoxState
                ),
                () => this._setButtonActive(true)
            );

            menu.open();

            return Clutter.EVENT_STOP;
        }

        _updateMenuPositioning(menu, monitorIndex) {
            const menuBox = menu.box;

            // 1. Save original source actor
            menuBox._sourceActor = this;
            menuBox._sourceAllocation = null;

            // 2. Handle constraints
            const removedConstraints = [];
            const constraints = menuBox.get_constraints();
            for (let constraint of constraints) {
                if (constraint.constructor.name === 'BindConstraint' ||
                    constraint.constructor.name === 'AlignConstraint') {
                    menuBox.remove_constraint(constraint);
                    removedConstraints.push(constraint);
                }
            }

            // 3. Handle setPosition override - FULL MANUAL REPLACEMENT
            // We do NOT call oldSetPosition because it likely crashes/fails on extended monitors
            const originalSetPosition = menuBox.setPosition;

            const monitor = Main.layoutManager.monitors[monitorIndex] || Main.layoutManager.primaryMonitor;

            menuBox.setPosition = function (sourceActor, alignment) {
                // Calculate position manually
                const [btnX, btnY] = sourceActor.get_transformed_position();
                const [btnW, btnH] = sourceActor.get_transformed_size();
                const [menuW, menuH] = this.get_preferred_size(); // Get preferred size (min, nat)
                const finalMenuW = menuW[1]; // Use natural width
                // Height might be dynamic, use current size or preferred?
                // BoxPointer usually has size by now.
                const [currW, currH] = this.get_size();
                const finalMenuH = currH > 0 ? currH : menuH[1];

                // Center horizontally on the button
                let newX = btnX + (btnW / 2) - (finalMenuW / 2);
                let newY = btnY + btnH; // Below the button

                // Constraint to monitor bounds
                if (newX + finalMenuW > monitor.x + monitor.width) {
                    newX = monitor.x + monitor.width - finalMenuW;
                }
                if (newX < monitor.x) {
                    newX = monitor.x;
                }

                // Vertical constraint (flip if needed, though usually bar is top)
                if (newY + finalMenuH > monitor.y + monitor.height) {
                    newY = btnY - finalMenuH;
                    if (this.setArrowSide) this.setArrowSide(St.Side.BOTTOM);
                } else {
                    if (this.setArrowSide) this.setArrowSide(St.Side.TOP);
                }

                this.set_position(Math.round(newX), Math.round(newY));
            };

            return {
                originalSetPosition: originalSetPosition,
                removedConstraints: removedConstraints
            };
        }

        _restoreMenuState(menu, originalSourceActor, originalBoxPointer, sourceState, menuBoxState) {
            // 1. Restore standard menu properties
            if (originalSourceActor)
                this._setMenuSourceActor(menu, originalSourceActor);

            if (menu.box && originalBoxPointer)
                menu.box._sourceActor = originalBoxPointer;

            // 2. Restore hijacked indicator methods
            this._restoreSourceIndicatorMenuState(sourceState);

            // 3. Restore menu box modifications (setPosition and constraints)
            if (menu.box && menuBoxState) {
                if (menuBoxState.originalSetPosition) {
                    menu.box.setPosition = menuBoxState.originalSetPosition;
                }

                if (menuBoxState.removedConstraints && menuBoxState.removedConstraints.length > 0) {
                    menuBoxState.removedConstraints.forEach(constraint => {
                        menu.box.add_constraint(constraint);
                    });
                }
            }

            // 4. Reset style classes on source
            if (this._sourceIndicator && this._sourceIndicator.remove_style_pseudo_class) {
                this._sourceIndicator.remove_style_pseudo_class('active');
                this._sourceIndicator.remove_style_pseudo_class('checked');
            }

            // Always try to reset this button's state
            this._resetButtonState();
        }

        _cleanup() {
            if (this._isCleanedUp) return;
            this._isCleanedUp = true;
            this._isDestroying = true;

            [
                '_clockUpdateId',
                '_forwardClickTimeoutId',
                '_iconSyncId',
                '_labelSyncId',
                '_arcMenuTimeoutId',
                '_lockSizeTimeoutId',
                '_monitorTimeoutId',
                '_qsInitialSyncId',
                '_sizeDebounceId',
            ].forEach(timeoutKey => this._clearTimeoutKey(timeoutKey));

            this._disconnectSignal(Main.overview, '_overviewShowingId');
            this._disconnectSignal(global.display, '_fullscreenChangedId');
            this._disconnectSignal(this._quickSettingsSource, '_sourceSizeChangedId');

            this._cleanupAllocationSyncedClones();
            this._cleanupSourceVisibilityTracking();

            this._clearTrackedWidgetSignals();
            this._cleanupActivitiesSignals();
        }

        destroy() {
            this._cleanup();
            super.destroy();
        }
    });
