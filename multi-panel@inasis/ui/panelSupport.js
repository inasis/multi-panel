/*
Copyright (C) 2014  spin83
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
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { MirroredIndicatorButton } from './indicatorMirror.js';
import {
    getIndicatorDescriptor,
    isMirroredDescriptor,
    isRoutableDescriptor,
} from '../services/indicatorRouter.js';
import * as PanelSettings from '../services/settings.js';
import {
    getActorChildren,
    getIndicatorContainer,
    isDisposedActor,
    isUsablePanel,
    removeActorFromParent,
    syncWidgetAppearance,
} from './actorUtils.js';

const appearanceSupportMethods = {
    _startExtensionWatcher() {
        this._extensionStateChangedId = Main.extensionManager.connect(
            'extension-state-changed',
            this._onExtensionStateChanged.bind(this)
        );

        this._initialCheckTimeouts = [];
        const delays = [1000, 2000, 3000, 5000, 8000];

        for (const delay of delays) {
            const timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
                if (!isUsablePanel(this))
                    return GLib.SOURCE_REMOVE;

                this._updatePanel();
                const idx = this._initialCheckTimeouts.indexOf(timeoutId);
                if (idx >= 0)
                    this._initialCheckTimeouts.splice(idx, 1);
                return GLib.SOURCE_REMOVE;
            });
            this._initialCheckTimeouts.push(timeoutId);
        }
    },

    _onExtensionStateChanged(_extensionManager, _extension) {
        this._blurMyShellApplied = false;

        if (this._extensionUpdateTimeoutId) {
            GLib.source_remove(this._extensionUpdateTimeoutId);
            this._extensionUpdateTimeoutId = null;
        }
        this._extensionUpdateTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
            this._updatePanel();
            this._extensionUpdateTimeoutId = null;
            return GLib.SOURCE_REMOVE;
        });
    },

    _startAppearanceSync() {
        if (this._appearanceSyncId)
            return;

        this._appearanceSyncId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            250,
            () => {
                if (!isUsablePanel(this))
                    return GLib.SOURCE_REMOVE;

                try {
                    this._syncPanelAppearance();
                    this._maybeRefreshIndicatorsFromMainPanel();
                } catch (_e) {
                    return GLib.SOURCE_REMOVE;
                }
                return GLib.SOURCE_CONTINUE;
            }
        );
    },

    _getMainPanelIndicatorSignature() {
        const mainPanel = Main.panel;
        if (!mainPanel)
            return '';

        const roles = ['_leftBox', '_centerBox', '_rightBox']
            .flatMap(boxName => getActorChildren(mainPanel[boxName])
                .filter(child => child.visible)
                .map(child => this._getRoleForBoxChild(child))
                .filter(Boolean)
                .map(role => `${boxName}:${role}`));

        return roles.join('|');
    },

    _maybeRefreshIndicatorsFromMainPanel() {
        if (!isUsablePanel(this))
            return;

        const signature = this._getMainPanelIndicatorSignature();
        if (signature === this._lastMainPanelIndicatorSignature)
            return;

        this._lastMainPanelIndicatorSignature = signature;
        this._updatePanel();
    },

    _ensureBlurMyShellCompatibility() {
        if (!isUsablePanel(this))
            return;

        const panelBlur = global.blur_my_shell?._panel_blur;
        if (!panelBlur?.maybe_blur_panel || !panelBlur.enabled)
            return;

        const existingActors = panelBlur.actors_list?.find(entry => entry?.widgets?.panel === this);
        if (existingActors) {
            this._blurMyShellApplied = true;
            return;
        }

        try {
            if (!this.mapped || this.width <= 0 || this.height <= 0)
                return;

            panelBlur.maybe_blur_panel(this);
            const appliedActors = panelBlur.actors_list?.find(entry => entry?.widgets?.panel === this);
            this._blurMyShellApplied = !!appliedActors;
        } catch (e) {
            console.debug('[MultiPanel] Blur my Shell compatibility failed:', String(e));
        }
    },

    _syncBlurMyShellActor() {
        if (!isUsablePanel(this))
            return;

        const panelBlur = global.blur_my_shell?._panel_blur;
        const actors = panelBlur?.actors_list?.find(entry => entry?.widgets?.panel === this);
        if (!actors) {
            this._blurMyShellApplied = false;
            return;
        }

        const monitor = Main.layoutManager.findMonitorForActor(this);
        if (!monitor)
            return;

        actors.monitor = monitor;

        const background = actors.widgets?.background;
        const backgroundGroup = actors.widgets?.background_group;
        const panelBox = actors.widgets?.panel_box;
        if (!background || !panelBox)
            return;

        if (backgroundGroup) {
            backgroundGroup.set_position(0, 0);
            backgroundGroup.set_size(panelBox.width, panelBox.height);
        }

        if (actors.static_blur) {
            background.x = 0;
            background.y = 0.5;
            background.width = monitor.width;
            background.height = monitor.height;
            background.set_clip(0, 0, this.width, this.height);
        } else {
            background.x = 0;
            background.y = 0;
            background.width = panelBox.width;
            background.height = panelBox.height;
        }
    },

    _syncPanelAppearance() {
        if (!isUsablePanel(this))
            return;

        syncWidgetAppearance(this, Main.panel);
        [
            [this._leftBox, Main.panel._leftBox],
            [this._centerBox, Main.panel._centerBox],
            [this._rightBox, Main.panel._rightBox],
        ].forEach(([target, source]) => syncWidgetAppearance(target, source));

        const panelBox = this._panelBoxWrapper?.panelBox;
        if (panelBox && !isDisposedActor(panelBox)) {
            try {
                this.set_position(0, 0);
                this.set_size(panelBox.width, panelBox.height);
            } catch (_e) {
                return;
            }
        }

        try {
            this._panelBoxWrapper?.syncFromMainPanel?.();
            this._applyPanelLayout();
            this._applyIndicatorGap();
            this._ensureBlurMyShellCompatibility();
            this._syncBlurMyShellActor();
        } catch (_e) {
        }
    },

    vfunc_map() {
        St.Widget.prototype.vfunc_map.call(this);
        this._syncPanelAppearance();
        this._updatePanel();
        this._showDateTime();
    },
};

const indicatorSupportMethods = {
    _hideIndicators() {
        for (const role in this._panelItemImplementations) {
            const indicator = this.statusArea[role];
            if (!indicator)
                continue;
            indicator.container.hide();
        }
    },

    _ensureIndicator(role) {
        const descriptor = this._describeIndicatorRole(role);
        if (this._shouldHideRoleOnThisMonitor(descriptor))
            return null;

        let indicator = this.statusArea[role];
        if (indicator) {
            if (indicator.container)
                indicator.container.show();
            else
                indicator.show();
            return indicator;
        }

        if (!isRoutableDescriptor(descriptor))
            return null;

        if (descriptor.kind === 'dedicated')
            return this._createDedicatedIndicator(role, descriptor);

        if (descriptor.kind === 'overview-forward' ||
            isMirroredDescriptor(descriptor)) {
            try {
                indicator = new MirroredIndicatorButton(this, role, descriptor);
                this.statusArea[role] = indicator;
                return indicator;
            } catch (e) {
                console.error('[MultiPanel] Failed to create routed indicator for', role, ':', String(e));
                return null;
            }
        }

        return null;
    },

    _describeIndicatorRole(role) {
        return getIndicatorDescriptor({
            role,
            source: Main.panel.statusArea?.[role] ?? null,
        });
    },

    _shouldHideRoleOnThisMonitor(descriptor) {
        return descriptor.layout?.hideOnPrimaryMonitor === true &&
            this.monitorIndex === Main.layoutManager.primaryIndex;
    },

    _shouldIncludeHiddenSource(descriptor) {
        return descriptor.catalog?.includeWhenHidden === true ||
            descriptor.capabilities?.has('always-visible') === true;
    },

    _shouldEnsureAuxiliaryRole(descriptor) {
        if (descriptor.layout?.ensureOnAuxiliary !== true)
            return false;

        const settingKey = descriptor.layout?.showWhenSetting;
        return !settingKey || this._settings.get_boolean(settingKey);
    },

    _getRightmostAuxiliaryRoles() {
        return Object.keys(Main.panel.statusArea ?? {})
            .filter(role => this._describeIndicatorRole(role).layout?.forceAuxiliaryRightmost === true);
    },

    _createDedicatedIndicator(role, descriptor) {
        const implementation = descriptor.implementation ?? role;
        const constructor = this._panelItemImplementations[implementation];
        if (!constructor)
            return null;

        let indicator;
        try {
            indicator = new constructor(this);
            indicator._descriptor = descriptor;
        } catch (e) {
            console.error('[MultiPanel] Error creating indicator for', role, ':', String(e));
            throw e;
        }

        this.statusArea[role] = indicator;
        return indicator;
    },

    _addToPanelBox(role, indicator, _position, box) {
        if (!indicator || !box || isDisposedActor(box))
            return;

        let container = indicator;
        if (indicator.container)
            container = indicator.container;
        if (!container || isDisposedActor(container))
            return;

        container._mmIndicatorRole = role;
        this.statusArea[role] = indicator;

        if (!indicator._mmDestroyConnected) {
            indicator.connect('destroy', () => {
                delete this.statusArea[role];
            });
            indicator._mmDestroyConnected = true;
        }

        if (!indicator._mmMenuSetConnected) {
            indicator.connect('menu-set', () => {
                if (!indicator.menu)
                    return;
                this.menuManager.addMenu(indicator.menu);
            });
            indicator._mmMenuSetConnected = true;
        }

        removeActorFromParent(container);

        container.show();
        container.y_align = Clutter.ActorAlign.FILL;
        container.y_expand = true;
        this._applyIndicatorPadding(role, container);

        if (box === this._centerBox && this._centerBin) {
            container.x_align = Clutter.ActorAlign.CENTER;
            container.y_align = Clutter.ActorAlign.FILL;
            container.y_expand = true;

            this._centerBin.add_child(container);
        } else {
            box.add_child(container);
            this._reorderBoxByIndicatorOrder(box);
        }

        if (indicator.menu)
            this.menuManager.addMenu(indicator.menu);
    },

    _updatePanel() {
        this._syncPanelAppearance();
        this._hideIndicators();
        this._cloneAllMainPanelIndicators();
        this._ensureRightmostPolicyIndicators();
        this._reorderBoxesByIndicatorOrder();
    },

    _cloneAllMainPanelIndicators() {
        const mainPanel = Main.panel;
        if (!mainPanel || !mainPanel.statusArea)
            return;

        const groupedIndicators = {
            [PanelSettings.PANEL_BOX_LEFT]: [],
            [PanelSettings.PANEL_BOX_CENTER]: [],
            [PanelSettings.PANEL_BOX_RIGHT]: [],
        };
        const preferredPositions = PanelSettings.getIndicatorPositions(this._settings);
        const transferredIndicators = PanelSettings.getTransferredIndicators(this._settings);

        const isTransferredRole = role =>
            PanelSettings.isPersistentRole(role) &&
            Object.prototype.hasOwnProperty.call(transferredIndicators, role);

        const canMirrorRole = role => {
            if (!PanelSettings.isPersistentRole(role))
                return false;
            if (isTransferredRole(role))
                return false;

            const descriptor = this._describeIndicatorRole(role);
            return isRoutableDescriptor(descriptor);
        };

        const findRoleForChild = child => {
            for (const role in mainPanel.statusArea) {
                const indicator = mainPanel.statusArea[role];
                if (!indicator)
                    continue;
                if (!canMirrorRole(role))
                    continue;
                if (indicator === child || getIndicatorContainer(indicator) === child)
                    return role;
            }
            return null;
        };

        const pushRole = (role, fallbackPosition = PanelSettings.PANEL_BOX_LEFT) => {
            const targetPosition = preferredPositions[role] ?? fallbackPosition;
            groupedIndicators[targetPosition]?.push(role);
        };

        [
            [mainPanel._leftBox, PanelSettings.PANEL_BOX_LEFT],
            [mainPanel._centerBox, PanelSettings.PANEL_BOX_CENTER],
            [mainPanel._rightBox, PanelSettings.PANEL_BOX_RIGHT],
        ].forEach(([box, fallbackPosition]) => {
            getActorChildren(box)
                .filter(child => child && !isDisposedActor(child) && child.visible)
                .map(findRoleForChild)
                .filter(Boolean)
                .forEach(role => pushRole(role, fallbackPosition));
        });

        const knownRoles = new Set([
            ...groupedIndicators[PanelSettings.PANEL_BOX_LEFT],
            ...groupedIndicators[PanelSettings.PANEL_BOX_CENTER],
            ...groupedIndicators[PanelSettings.PANEL_BOX_RIGHT],
        ]);

        for (const [role, indicator] of Object.entries(mainPanel.statusArea)) {
            if (!indicator || knownRoles.has(role))
                continue;
            if (!canMirrorRole(role))
                continue;

            const container = getIndicatorContainer(indicator);
            const descriptor = this._describeIndicatorRole(role);
            if (!this._shouldIncludeHiddenSource(descriptor) && !container?.visible)
                continue;

            pushRole(role, PanelSettings.getIndicatorPosition(this._settings, role));
        }

        const ensureRole = (role, fallbackPosition = PanelSettings.PANEL_BOX_LEFT) => {
            if (knownRoles.has(role) || !canMirrorRole(role))
                return;

            const descriptor = this._describeIndicatorRole(role);
            if (this._shouldEnsureAuxiliaryRole(descriptor)) {
                if (!this._shouldHideRoleOnThisMonitor(descriptor)) {
                    pushRole(role, fallbackPosition);
                    knownRoles.add(role);
                }
                return;
            }

            if (mainPanel.statusArea[role]) {
                pushRole(role, fallbackPosition);
                knownRoles.add(role);
            }
        };

        for (const role of Object.keys(mainPanel.statusArea ?? {})) {
            const descriptor = this._describeIndicatorRole(role);
            if (!this._shouldEnsureAuxiliaryRole(descriptor) &&
                !this._shouldIncludeHiddenSource(descriptor))
                continue;

            ensureRole(role, PanelSettings.getIndicatorPosition(this._settings, role));
        }

        const orderedLeftIndicators = PanelSettings.sortIndicatorsByOrder(
            this._settings,
            groupedIndicators[PanelSettings.PANEL_BOX_LEFT]
        );
        const orderedCenterIndicators = PanelSettings.sortIndicatorsByOrder(
            this._settings,
            groupedIndicators[PanelSettings.PANEL_BOX_CENTER]
        );
        const orderedRightIndicators = PanelSettings.sortIndicatorsByOrder(
            this._settings,
            groupedIndicators[PanelSettings.PANEL_BOX_RIGHT]
        );

        this._updateBox(orderedLeftIndicators, this._leftBox);
        this._updateBox(orderedCenterIndicators, this._centerBox);
        this._updateBox(orderedRightIndicators, this._rightBox);
    },

    _updateBox(elements, box) {
        if (!elements || !box || isDisposedActor(box))
            return;

        let nChildren = 0;
        try {
            nChildren = box.get_n_children();
        } catch (_e) {
            return;
        }
        const hiddenIndicators = new Set(PanelSettings.getHiddenIndicators(this._settings));
        const transferredIndicators = PanelSettings.getTransferredIndicators(this._settings);

        for (const [index, role] of elements.entries()) {
            const descriptor = this._describeIndicatorRole(role);
            if (this._shouldHideRoleOnThisMonitor(descriptor))
                continue;

            if (Object.prototype.hasOwnProperty.call(transferredIndicators, role)) {
                const existing = this.statusArea[role];
                if (existing) {
                    const container = getIndicatorContainer(existing);
                    if (!isDisposedActor(container))
                        removeActorFromParent(container);
                    existing.destroy?.();
                }
                continue;
            }

            if (hiddenIndicators.has(role)) {
                const existing = this.statusArea[role];
                if (existing) {
                    const container = getIndicatorContainer(existing);
                    if (!isDisposedActor(container))
                        removeActorFromParent(container);
                    existing.hide?.();
                }
                continue;
            }

            try {
                const indicator = this._ensureIndicator(role);
                if (indicator) {
                    if (indicator._isEmpty) {
                        if (this._shouldIncludeHiddenSource(descriptor)) {
                            this._addToPanelBox(role, indicator, index + nChildren, box);
                            indicator.hide?.();
                            continue;
                        }

                        if (this.statusArea[role] === indicator)
                            delete this.statusArea[role];
                        indicator.destroy();
                        continue;
                    }

                    this._addToPanelBox(role, indicator, index + nChildren, box);
                }
            } catch (e) {
                console.error('[MultiPanel] _updateBox: ERROR for role', role, ':', e, e.stack);
            }
        }
    },

    _getRoleForBoxChild(child) {
        if (!child)
            return null;

        if (child._mmIndicatorRole)
            return child._mmIndicatorRole;

        for (const role in this.statusArea) {
            const indicator = this.statusArea[role];
            if (!indicator)
                continue;

            const container = getIndicatorContainer(indicator);
            if (container === child)
                return role;
        }

        return null;
    },

    _getPanelBoxForRole(role) {
        switch (PanelSettings.getIndicatorPosition(this._settings, role)) {
        case PanelSettings.PANEL_BOX_CENTER:
            return this._centerBox;
        case PanelSettings.PANEL_BOX_RIGHT:
            return this._rightBox;
        case PanelSettings.PANEL_BOX_LEFT:
        default:
            return this._leftBox;
        }
    },

    _getManagedPanelBoxes() {
        return [this._leftBox, this._centerBin, this._rightBox]
            .filter(box => box && !isDisposedActor(box));
    },

    _reorderBoxByIndicatorOrder(box) {
        if (!isUsablePanel(this) || !box || isDisposedActor(box))
            return;

        const entries = getActorChildren(box)
            .filter(child => child && !isDisposedActor(child))
            .map(child => ({ child, role: this._getRoleForBoxChild(child) }));

        const orderedRoles = PanelSettings.sortIndicatorsByOrder(
            this._settings,
            entries.map(entry => entry.role).filter(Boolean)
        );

        const rankMap = new Map();
        orderedRoles.forEach((role, index) => rankMap.set(role, index));

        entries.sort((a, b) => {
            const aRank = a.role && rankMap.has(a.role) ? rankMap.get(a.role) : Number.MAX_SAFE_INTEGER;
            const bRank = b.role && rankMap.has(b.role) ? rankMap.get(b.role) : Number.MAX_SAFE_INTEGER;

            if (aRank !== bRank)
                return aRank - bRank;

            return 0;
        });

        for (const entry of entries) {
            try {
                if (isDisposedActor(box) || isDisposedActor(entry.child))
                    continue;

                if (entry.child.get_parent?.() === box)
                    removeActorFromParent(entry.child);
                box.add_child(entry.child);
            } catch (_e) {
            }
        }
    },

    _reorderBoxesByIndicatorOrder() {
        if (!isUsablePanel(this))
            return;

        this._getManagedPanelBoxes().forEach(box => this._reorderBoxByIndicatorOrder(box));

        if (this._centerBin && !isDisposedActor(this._centerBin)) {
            for (const centerChild of getActorChildren(this._centerBin)) {
                if (!centerChild || isDisposedActor(centerChild))
                    continue;

                const role = this._getRoleForBoxChild(centerChild);
                if (role)
                    centerChild._mmIndicatorRole = role;
            }
        }
    },

    _getIndicatorContainerForRole(role) {
        const indicator = this.statusArea[role];
        if (!indicator)
            return null;

        return getIndicatorContainer(indicator);
    },

    _getIndicatorPaddingTarget(role, container = null) {
        const indicator = this.statusArea[role];
        const targetContainer = container ?? this._getIndicatorContainerForRole(role);

        if (!targetContainer)
            return null;

        const descriptor = indicator?._descriptor ?? this._describeIndicatorRole(role);
        const layout = descriptor.layout ?? {};

        if (layout.auxiliaryPaddingTarget === 'label-actor' && indicator?.label_actor)
            return indicator.label_actor;

        if (indicator?._iconContainer)
            return indicator._iconContainer;

        if (indicator instanceof MirroredIndicatorButton)
            return targetContainer;

        const firstChild = targetContainer.get_first_child?.() ?? null;
        return firstChild ?? targetContainer;
    },

    _getAuxiliaryIndicatorPadding(role) {
        return PanelSettings.getIndicatorPadding(this._settings, role);
    },

    _getIndicatorPaddingTargets(role, container = null) {
        const indicator = this.statusArea[role];
        const target = this._getIndicatorPaddingTarget(role, container);
        const descriptor = indicator?._descriptor ?? this._describeIndicatorRole(role);

        if (descriptor.layout?.auxiliaryPaddingMode !== 'outer-and-target')
            return target ? [{ actor: target, key: '_mmOriginalInlineStyle' }] : [];

        const outerTarget = container ?? indicator;
        return [
            { actor: outerTarget, key: '_mmOuterOriginalInlineStyle' },
            { actor: target, key: '_mmOriginalInlineStyle' },
        ].filter(({actor}, index, entries) =>
            actor && entries.findIndex(entry => entry.actor === actor) === index);
    },

    _applyAuxiliaryPaddingStyle(actor, padding, key = '_mmOriginalInlineStyle') {
        if (!actor?.set_style || isDisposedActor(actor))
            return;

        try {
            const originalStyle = actor[key] ?? actor.get_style?.() ?? null;
            if (actor[key] === undefined)
                actor[key] = originalStyle;

            const baseStyle = actor[key] || '';
            const paddingStyle = `padding-left: ${padding}px; padding-right: ${padding}px;`;
            const nextStyle = `${baseStyle}${baseStyle && paddingStyle ? ' ' : ''}${paddingStyle}`.trim();
            actor.set_style(nextStyle || null);
        } catch (_e) {
        }
    },

    _restoreAuxiliaryPaddingStyle(actor, key = '_mmOriginalInlineStyle') {
        if (!actor?.set_style || isDisposedActor(actor))
            return;

        try {
            if (actor[key] === undefined)
                return;

            actor.set_style(actor[key] || null);
            delete actor[key];
        } catch (_e) {
        }
    },

    _applyIndicatorPadding(role, container = null) {
        const hasOverride = PanelSettings.hasIndicatorPaddingOverride(this._settings, role);
        const padding = this._getAuxiliaryIndicatorPadding(role);

        if (!hasOverride) {
            this._getIndicatorPaddingTargets(role, container)
                .forEach(({actor, key}) => this._restoreAuxiliaryPaddingStyle(actor, key));
            return;
        }

        this._getIndicatorPaddingTargets(role, container)
            .forEach(({actor, key}) => this._applyAuxiliaryPaddingStyle(actor, padding, key));
    },

    _restoreIndicatorPadding(role, container = null) {
        this._getIndicatorPaddingTargets(role, container)
            .forEach(({actor, key}) => this._restoreAuxiliaryPaddingStyle(actor, key));
    },

    _applyIndicatorPaddingToAll() {
        for (const role of Object.keys(this.statusArea))
            this._applyIndicatorPadding(role);
    },

    _restoreAllIndicatorPadding() {
        for (const role of Object.keys(this.statusArea))
            this._restoreIndicatorPadding(role);
    },

    _getIndicatorGapTargets() {
        if (!isUsablePanel(this))
            return [];

        return this._getManagedPanelBoxes();
    },

    _applyIndicatorGap() {
        if (!isUsablePanel(this))
            return;

        const gap = PanelSettings.getIndicatorGap(this._settings);

        for (const target of this._getIndicatorGapTargets()) {
            if (!target || !target.set_style || isDisposedActor(target))
                continue;

            try {
                const originalStyle = target._mmOriginalGapStyle ?? target.get_style?.() ?? null;
                if (target._mmOriginalGapStyle === undefined)
                    target._mmOriginalGapStyle = originalStyle;

                PanelSettings.applyGapStyle(target, '_mmOriginalGapStyle', gap);
            } catch (_e) {
            }
        }
    },

    _restoreIndicatorGap() {
        for (const target of this._getIndicatorGapTargets()) {
            if (!target || !target.set_style || isDisposedActor(target))
                continue;

            try {
                if (target._mmOriginalGapStyle === undefined)
                    continue;

                target.set_style(target._mmOriginalGapStyle || null);
                delete target._mmOriginalGapStyle;
            } catch (_e) {
            }
        }
    },

    _applyPanelLayout() {
        if (!isUsablePanel(this))
            return;

        const leftPadding = PanelSettings.getPanelLeftPadding(this._settings);
        const rightPadding = PanelSettings.getPanelRightPadding(this._settings);

        try {
            PanelSettings.applyHorizontalPaddingStyle(this, '_multiPanelLayoutBaseStyle', leftPadding, rightPadding);
        } catch (_e) {
        }
    },

    _ensureRightmostPolicyIndicators() {
        if (!isUsablePanel(this) || isDisposedActor(this._rightBox))
            return;

        const roles = this._getRightmostAuxiliaryRoles();
        for (const role of roles)
            this._ensureRightmostIndicator(role);
    },

    _ensureRightmostIndicator(role) {
        const mainIndicator = Main.panel.statusArea[role];

        if (!mainIndicator) {
            if (this.statusArea[role]) {
                const ind = this.statusArea[role];
                const cont = getIndicatorContainer(ind);
                try {
                    if (!isDisposedActor(cont))
                        removeActorFromParent(cont);
                } catch (_e) {
                }
                try {
                    ind.destroy();
                } catch (_e) {
                }
                delete this.statusArea[role];
            }
            return;
        }

        const indicator = this._ensureIndicator(role);
        if (!indicator)
            return;

        const container = getIndicatorContainer(indicator);
        if (isDisposedActor(container))
            return;

        container._mmIndicatorRole = role;

        try {
            removeActorFromParent(container);

            if (!isDisposedActor(this._rightBox))
                this._rightBox.add_child(container);

            this._applyIndicatorPadding(role, container);
            this._reorderBoxByIndicatorOrder(this._rightBox);
        } catch (_e) {
        }
    },
};

export function installAuxiliaryPanelSupport(prototype) {
    Object.assign(prototype, appearanceSupportMethods, indicatorSupportMethods);
}
