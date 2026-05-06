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
import Graphene from 'gi://Graphene';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as Util from 'resource:///org/gnome/shell/misc/util.js';
import { installMirroredIndicatorSupport } from './support.js';
import { getIndicatorDescriptor } from '../router.js';
import * as Common from '../../shared/common.js';

const INACTIVE_WORKSPACE_DOT_SCALE = 0.75;

const MultiPanelWorkspaceDot = GObject.registerClass({
    Properties: {
        'expansion': GObject.ParamSpec.double(
            'expansion',
            null,
            null,
            GObject.ParamFlags.READWRITE,
            0.0,
            1.0,
            0.0
        ),
        'width-multiplier': GObject.ParamSpec.double(
            'width-multiplier',
            null,
            null,
            GObject.ParamFlags.READWRITE,
            1.0,
            10.0,
            1.0
        ),
    },
}, class MultiPanelWorkspaceDot extends Clutter.Actor {
    _init(params = {}) {
        super._init({
            pivot_point: new Graphene.Point({x: 0.5, y: 0.5}),
            ...params,
        });

        this._dot = new St.Widget({
            style_class: 'workspace-dot',
            y_align: Clutter.ActorAlign.CENTER,
            pivot_point: new Graphene.Point({x: 0.5, y: 0.5}),
            request_mode: Clutter.RequestMode.WIDTH_FOR_HEIGHT,
        });
        this.add_child(this._dot);

        this.connect('notify::width-multiplier', () => this.queue_relayout());
        this.connect('notify::expansion', () => {
            this._updateVisuals();
            this.queue_relayout();
        });
        this._updateVisuals();

        this._destroying = false;
    }

    _updateVisuals() {
        const {expansion} = this;

        this._dot.set({
            opacity: Util.lerp(0.50, 1.0, expansion) * 255,
            scaleX: Util.lerp(INACTIVE_WORKSPACE_DOT_SCALE, 1.0, expansion),
            scaleY: Util.lerp(INACTIVE_WORKSPACE_DOT_SCALE, 1.0, expansion),
        });
    }

    vfunc_get_preferred_width(forHeight) {
        const factor = Util.lerp(1.0, this.widthMultiplier, this.expansion);
        return this._dot.get_preferred_width(forHeight).map(value => Math.round(value * factor));
    }

    vfunc_get_preferred_height(forWidth) {
        return this._dot.get_preferred_height(forWidth);
    }

    vfunc_allocate(box) {
        this.set_allocation(box);

        box.set_origin(0, 0);
        this._dot.allocate(box);
    }

    get destroying() {
        return this._destroying;
    }
});

const MultiPanelWorkspaceIndicators = GObject.registerClass(
    class MultiPanelWorkspaceIndicators extends St.BoxLayout {
        _init() {
            super._init();

            this._workspacesAdjustment = Main.createWorkspacesAdjustment(this);
            this._workspacesAdjustment.connectObject(
                'notify::value', () => this._updateExpansion(),
                'notify::upper', () => this._recalculateDots(),
                this
            );

            for (let index = 0; index < this._workspacesAdjustment.upper; index++)
                this.insert_child_at_index(new MultiPanelWorkspaceDot(), index);

            this._updateExpansion();
        }

        _getActiveIndicators() {
            return this.get_children().filter(indicator => !indicator.destroying);
        }

        _recalculateDots() {
            const activeIndicators = this._getActiveIndicators();
            const nIndicators = activeIndicators.length;
            const targetIndicators = this._workspacesAdjustment.upper;

            let remaining = Math.abs(nIndicators - targetIndicators);
            while (remaining--) {
                if (nIndicators < targetIndicators) {
                    this.add_child(new MultiPanelWorkspaceDot());
                } else {
                    activeIndicators[nIndicators - remaining - 1].destroy();
                }
            }

            this._updateExpansion();
        }

        _updateExpansion() {
            const nIndicators = this._getActiveIndicators().length;
            const activeWorkspace = this._workspacesAdjustment.value;

            let widthMultiplier;
            if (nIndicators <= 2)
                widthMultiplier = 3.625;
            else if (nIndicators <= 5)
                widthMultiplier = 3.25;
            else
                widthMultiplier = 2.75;

            this.get_children().forEach((indicator, index) => {
                const distance = Math.abs(index - activeWorkspace);
                indicator.expansion = Math.clamp(1 - distance, 0, 1);
                indicator.widthMultiplier = widthMultiplier;
            });
        }
    });

export const MirroredIndicatorButton = GObject.registerClass(
    class MirroredIndicatorButton extends PanelMenu.Button {
        _init(panel, role, descriptor = null) {
            super._init(0.0, null, false);

            this._role = role;
            this._panel = panel;
            this._descriptor = descriptor;
            this._isDestroying = false;
            this.add_style_class_name('mm-mirrored-indicator');

            // Ensure cleanup happens when the underlying Clutter object is destroyed
            // This captures cases where mmpanel implicitly destroys children
            this.connect('destroy', this._cleanup.bind(this));
            this.connect('button-press-event', () => this._activateProxy());
            try {
                this.connect('clicked', () => this._activateProxy());
            } catch (_e) {
            }

            if (this._isDescriptorKind('overview-forward')) {
                this._initOverviewForwardButton();
            } else {
                this._initGenericIndicator(role);
            }
        }

        // Style helpers
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

        _isDirectSyncRole() {
            return this._descriptor?.capabilities?.has('direct-action');
        }

        _hasCapability(capability) {
            return this._descriptor?.capabilities?.has(capability) ?? false;
        }

        _isDescriptorKind(...kinds) {
            return kinds.includes(this._descriptor?.kind);
        }

        _activateProxy() {
            if (this._proxyActivationBlocked)
                return Clutter.EVENT_STOP;

            this._proxyActivationBlocked = true;
            this._replaceTimeout('_proxyActivationBlockTimeoutId', 75, () => {
                this._proxyActivationBlocked = false;
                return GLib.SOURCE_REMOVE;
            });

            return this._onButtonPress?.() ?? Clutter.EVENT_STOP;
        }

        _usesDirectLabelSync() {
            return this._isDirectSyncRole() ||
                this._isDescriptorKind('menu-forward', 'activation-forward', 'simple-visual');
        }

        _shouldKeepProxyWithoutVisibleContent() {
            return this._isDescriptorKind('menu-forward', 'activation-forward') ||
                this._hasCapability('menu-toggle') ||
                this._hasCapability('custom-menu-toggle') ||
                this._hasCapability('interaction-forward') ||
                this._hasCapability('click') ||
                this._isDirectSyncRole();
        }

        // Widget sync helpers
        _applyMirroredWidgetStyle(widget, sourceWidget = null) {
            const sourceStyle = sourceWidget ? this._getMirroredSourceInlineStyle(sourceWidget) : '';
            this._applyZeroSpacingStyle(widget, sourceStyle || '');
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
            const nextVisible = this._hasCapability('ignore-source-visibility')
                ? true
                : this._isEffectivelyVisible(sourceWidget, stopActor);
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

        // Button state helpers
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

        // Timeout helpers
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

        _clearTimeoutKey(timeoutKey) {
            if (!this[timeoutKey])
                return;

            GLib.source_remove(this[timeoutKey]);
            this[timeoutKey] = null;
        }

        // Menu state helpers
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
            if (typeof menu?.connect !== 'function')
                return false;

            try {
                const openStateId = menu.connect('open-state-changed', (_menu, isOpen) => {
                    if (isOpen) {
                        onOpen?.();
                        return;
                    }

                    onClose?.();
                    menu.disconnect(openStateId);
                });
                return true;
            } catch (_e) {
                return false;
            }
        }

        // Signal helpers
        _disconnectSignal(source, signalKey) {
            if (!source || !this[signalKey])
                return;

            try {
                source.disconnect(this[signalKey]);
            } catch (_e) {
            }

            this[signalKey] = null;
        }

        // Cleanup
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

        _cleanupOverviewForwardSignals() {
            if (!this._isDescriptorKind('overview-forward'))
                return;

            this._disconnectSignal(Main.overview, '_showingId');
            this._disconnectSignal(Main.overview, '_hidingId');
            this._disconnectSignal(this._workspaceManager, '_activeWsChangedId');
            this._disconnectSignal(this._workspaceManager, '_nWorkspacesChangedId');
        }

        // Initialisation
        _initOverviewForwardButton() {
            this._sourceIndicator = this._descriptor?.source ??
                Main.panel.statusArea?.[this._role] ??
                null;
            this.accessible_role = Atk.Role.TOGGLE_BUTTON;
            if (this._descriptor?.appearance?.name)
                this.name = this._descriptor.appearance.name;
            if (this._descriptor?.appearance?.styleClass)
                this.add_style_class_name(this._descriptor.appearance.styleClass);

            // Set up for full height hover
            this.y_expand = true;
            this.y_align = Clutter.ActorAlign.FILL;
            this.set_style('padding: 0; margin: 0; -natural-hpadding: 0; -minimum-hpadding: 0;');

            const sourceContainer = this._sourceIndicator?.container ?? this._sourceIndicator;
            const sourceDisplay = sourceContainer ??
                this._sourceIndicator?.label_actor ??
                this._sourceIndicator?.get_first_child?.();

            if (sourceDisplay) {
                const container = new St.BoxLayout({
                    style_class: sourceDisplay.get_style_class_name?.() || '',
                    x_align: Clutter.ActorAlign.CENTER,
                    y_align: Clutter.ActorAlign.CENTER,
                    y_expand: true,
                });
                this.add_child(container);
                this.label_actor = container;
                this._overviewForwardCloneContainer = container;
                this._createAllocationSyncedClone(container, sourceDisplay, 'overview-forward');
            } else {
                this._workspaceDotsBox = new MultiPanelWorkspaceIndicators();
                this.add_child(this._workspaceDotsBox);
                this.label_actor = this._workspaceDotsBox;
            }

            // Sync with overview state
            this._showingId = Main.overview.connect('showing', () => {
                this.add_style_pseudo_class('overview');
                this.add_accessible_state(Atk.StateType.CHECKED);
            });

            this._hidingId = Main.overview.connect('hiding', () => {
                this.remove_style_pseudo_class('overview');
                this.remove_accessible_state(Atk.StateType.CHECKED);
            });
        }

        _initGenericIndicator(role) {
            this._sourceIndicator = Main.panel.statusArea[role] || null;
            this._descriptor ??= getIndicatorDescriptor({
                role,
                source: this._sourceIndicator,
            });

            if (this._descriptor.kind === 'missing' ||
                this._descriptor.kind === 'unsupported' ||
                this._descriptor.kind === 'hidden') {
                this._isEmpty = true;
                this.visible = false;
                return;
            }

            if (this._sourceIndicator) {
                const sourceChild = this._getSourceVisualActor();
                if (!this._hasVisibleSourceContent(sourceChild)) {
                    this._isEmpty = true;
                    this.visible = false;
                    return;
                }

                this._createIndicatorClone();
                this._trackSourceVisibility(sourceChild);
            } else {
                this._isEmpty = true;
                this.visible = false;
            }
        }

        _getSourceVisualActor() {
            if (!this._sourceIndicator)
                return null;

            return this._sourceIndicator.get_first_child?.() ??
                this._descriptor?.actor ??
                null;
        }

        // Source visibility tracking
        _hasVisibleSourceContent(sourceChild = null) {
            if (!this._sourceIndicator)
                return false;

            const child = sourceChild ?? this._getSourceVisualActor();
            if (!child)
                return false;

            if (this._hasCapability('ignore-source-visibility'))
                return true;

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

            const child = sourceChild ?? this._getSourceVisualActor();
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

        // Clone creation
        _createIndicatorClone() {
            try {
                const sourceChild = this._getSourceVisualActor();
                if (!sourceChild) {
                    this._isEmpty = true;
                    this.visible = false;
                    return;
                }

                if (this._isDirectSyncRole()) {
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

                if (this._isDescriptorKind('simple-visual', 'menu-forward', 'activation-forward')) {
                    const container = new St.BoxLayout({
                        style_class: sourceChild.get_style_class_name?.() || 'panel-status-menu-box',
                        x_align: Clutter.ActorAlign.CENTER,
                        y_align: Clutter.ActorAlign.CENTER,
                        y_expand: false,
                        reactive: false,
                    });
                    this._applyZeroSpacingStyle(container);
                    this._createStaticIconCopy(container, sourceChild);
                    this.add_child(container);
                    return;
                }

                if (this._isDescriptorKind('clone-only')) {
                    const container = new St.BoxLayout({
                        style_class: sourceChild.get_style_class_name?.() || 'panel-status-menu-box',
                        x_align: Clutter.ActorAlign.CENTER,
                        y_align: Clutter.ActorAlign.CENTER,
                        y_expand: false,
                    });
                    this._applyZeroSpacingStyle(container);
                    this._createAllocationSyncedClone(container, sourceChild, `clone-only:${this._role ?? 'generic'}`);
                    this.add_child(container);
                    return;
                }

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
                Common.debug(`Failed to create mirrored indicator '${this._role ?? 'unknown'}'`, e);
                this._isEmpty = true;
                this.visible = false;
            }
        }

    });

installMirroredIndicatorSupport(MirroredIndicatorButton.prototype);
