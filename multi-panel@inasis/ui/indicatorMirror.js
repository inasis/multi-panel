/*
Copyright (C) 2025-2026  Frederyk Abryan Palinoan
Copyright (C) 2026  inasis

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
import * as Constants from '../services/settings.js';
import { installMirroredIndicatorCloneSupport } from './indicatorMirrorClone.js';
import { installMirroredIndicatorInteractionSupport } from './indicatorMirrorMenu.js';

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
            this.connect('button-press-event', () => {
                this._onButtonPress();
                return Clutter.EVENT_STOP;
            });

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
                console.debug('[MultiPanel] Failed to create mirrored indicator:', String(e));
                this._createFallbackIcon();
            }
        }

    });

installMirroredIndicatorCloneSupport(MirroredIndicatorButton.prototype);
installMirroredIndicatorInteractionSupport(MirroredIndicatorButton.prototype);
