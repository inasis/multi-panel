/*
Copyright (C) 2014  spin83

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

import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import * as Constants from './mmPanelConstants.js';

export class StatusIndicatorsController {
    constructor(settings) {
        this._transfered_indicators = [];
        this._settings = settings;
        this._mainPanelRefreshTimeoutIds = [];

        this._updatedSessionId = Main.sessionMode.connect('updated', this._updateSessionIndicators.bind(this));
        this._extensionStateChangedId = Main.extensionManager.connect(
            'extension-state-changed',
            this._extensionStateChanged.bind(this)
        );

        this._transferIndicatorsId = this._settings.connect(
            `changed::${Constants.TRANSFER_INDICATORS_ID}`,
            this.transferIndicators.bind(this)
        );

        this._excludeIndicatorsId = this._settings.connect(
            `changed::${Constants.EXCLUDE_INDICATORS_ID}`,
            this._onExcludeIndicatorsChanged.bind(this)
        );

        this._indicatorOrderId = this._settings.connect(
            `changed::${Constants.INDICATOR_ORDER_ID}`,
            this._onIndicatorOrderChanged.bind(this)
        );

        this._indicatorPositionsId = this._settings.connect(
            `changed::${Constants.INDICATOR_POSITIONS_ID}`,
            this._onIndicatorPositionsChanged.bind(this)
        );

        this._indicatorPaddingId = this._settings.connect(
            `changed::${Constants.INDICATOR_PADDING_ID}`,
            this._onIndicatorPaddingChanged.bind(this)
        );

        this._indicatorGapId = this._settings.connect(
            `changed::${Constants.INDICATOR_GAP_ID}`,
            this._onMainPanelLayoutChanged.bind(this)
        );

        this._quickSettingsGapId = this._settings.connect(
            `changed::${Constants.QUICK_SETTINGS_GAP_ID}`,
            this._onMainPanelLayoutChanged.bind(this)
        );

        this._applyToMainPanelId = this._settings.connect(
            `changed::${Constants.APPLY_INDICATOR_LAYOUT_TO_MAIN_PANEL_ID}`,
            this._onMainPanelLayoutChanged.bind(this)
        );

        this._updateSessionIndicators();
    }

    destroy() {
        this._settings.disconnect(this._transferIndicatorsId);
        this._settings.disconnect(this._excludeIndicatorsId);
        this._settings.disconnect(this._indicatorOrderId);
        this._settings.disconnect(this._indicatorPositionsId);
        this._settings.disconnect(this._indicatorPaddingId);
        this._settings.disconnect(this._indicatorGapId);
        this._settings.disconnect(this._quickSettingsGapId);
        this._settings.disconnect(this._applyToMainPanelId);
        Main.extensionManager.disconnect(this._extensionStateChangedId);
        Main.sessionMode.disconnect(this._updatedSessionId);

        for (const timeoutId of this._mainPanelRefreshTimeoutIds)
            GLib.source_remove(timeoutId);
        this._mainPanelRefreshTimeoutIds = [];

        this._restoreMainPanelIndicatorPositions();
        this._restoreMainPanelIndicatorPadding();
        this._restoreMainPanelIndicatorGap();
        this._settings.set_strv(Constants.AVAILABLE_INDICATORS_ID, []);
        this._transferBack(this._transfered_indicators);
    }

    _getPanels() {
        return Constants.getMMPanelArray() ?? [];
    }

    _forEachPanel(callback) {
        this._getPanels().forEach(panel => callback(panel));
    }

    _getPersistentStatusRoles() {
        return Object.keys(Main.panel.statusArea || {})
            .filter(role => Constants.isPersistentRole(role));
    }

    _forEachPersistentStatusIndicator(callback) {
        this._getPersistentStatusRoles().forEach(role => {
            callback(role, Main.panel.statusArea[role]);
        });
    }

    _syncMainPanelIndicators() {
        this._findAvailableIndicators();
        Constants.normalizeIndicatorOrder(this._settings);
        this.transferIndicators();
        this._applyMainPanelIndicatorPositions();
        this._reorderMainPanelIndicators();
        this._onMainPanelLayoutChanged();
    }

    _onExcludeIndicatorsChanged() {
        this._syncMainPanelIndicators();
    }

    _onIndicatorOrderChanged() {
        this._reorderMainPanelIndicators();
        this._forEachPanel(panel => panel?._reorderBoxesByIndicatorOrder?.());
    }

    _onIndicatorPositionsChanged() {
        this._applyMainPanelIndicatorPositions();
        this._reorderMainPanelIndicators();
        this._forEachPanel(panel => panel?._updatePanel?.());
    }

    _onIndicatorPaddingChanged() {
        for (const transferred of this._transfered_indicators) {
            const indicator = Main.panel.statusArea[transferred.iname];
            const container = this._getIndicatorContainer(indicator);
            const panel = this._findPanel(transferred.monitor);

            if (!container || !panel)
                continue;

            panel?._applyIndicatorPadding?.(transferred.iname, container);
        }

        this._onMainPanelLayoutChanged();
    }

    _onMainPanelLayoutChanged() {
        if (Constants.shouldApplyIndicatorLayoutToMainPanel(this._settings)) {
            this._applyMainPanelIndicatorPadding();
            this._applyMainPanelIndicatorGap();
            return;
        }

        this._restoreMainPanelIndicatorPadding();
        this._restoreMainPanelIndicatorGap();
    }

    _getMainPanelPositionBoxes() {
        return [Main.panel._leftBox, Main.panel._centerBox, Main.panel._rightBox].filter(Boolean);
    }

    _moveMainPanelIndicators(getTargetBox) {
        this._forEachPersistentStatusIndicator((role, indicator) => {
            if (this._transfered_indicators.some(entry => entry.iname === role))
                return;

            const container = this._getIndicatorContainer(indicator);
            if (!container)
                return;

            const currentParent = container.get_parent?.() ?? null;
            if (!this._getMainPanelPositionBoxes().includes(currentParent))
                return;

            const targetBox = getTargetBox(role);
            if (!targetBox || currentParent === targetBox)
                return;

            currentParent.remove_child(container);
            targetBox.add_child(container);
        });
    }

    _applyMainPanelIndicatorPositions() {
        this._moveMainPanelIndicators(role => this._getMainPanelTargetBox(role));
        this._reorderMainPanelIndicators();
    }

    _restoreMainPanelIndicatorPositions() {
        this._moveMainPanelIndicators(role => this._getMainPanelTargetBox(role, true));
    }

    _getMainPanelTargetBox(role, useDefaultPosition = false) {
        const position = useDefaultPosition
            ? Constants.getDefaultIndicatorPosition(role)
            : Constants.getIndicatorPosition(this._settings, role);

        switch (position) {
        case Constants.PANEL_BOX_CENTER:
            return Main.panel._centerBox;
        case Constants.PANEL_BOX_RIGHT:
            return Main.panel._rightBox;
        case Constants.PANEL_BOX_LEFT:
        default:
            return Main.panel._leftBox;
        }
    }

    _getMainPanelRoleForChild(child) {
        if (!child)
            return null;

        for (const [role, indicator] of Object.entries(Main.panel.statusArea || {})) {
            if (!indicator || !Constants.isPersistentRole(role))
                continue;

            const container = this._getIndicatorContainer(indicator);
            if (container === child)
                return role;
        }

        return child._mmIndicatorRole ?? null;
    }

    _reorderMainPanelBox(box) {
        if (!box)
            return;

        const children = box.get_children?.() ?? [];
        const entries = children.map(child => ({
            child,
            role: this._getMainPanelRoleForChild(child),
        }));

        const orderedRoles = Constants.sortIndicatorsByOrder(
            this._settings,
            entries.map(entry => entry.role).filter(Boolean)
        );
        const rankMap = new Map();
        orderedRoles.forEach((role, index) => rankMap.set(role, index));

        entries.sort((a, b) => {
            const aRank = a.role && rankMap.has(a.role) ? rankMap.get(a.role) : Number.MAX_SAFE_INTEGER;
            const bRank = b.role && rankMap.has(b.role) ? rankMap.get(b.role) : Number.MAX_SAFE_INTEGER;
            return aRank - bRank;
        });

        this._pinMainPanelRightmostIndicator(box, entries);

        for (const {child} of entries) {
            box.remove_child(child);
            box.add_child(child);
        }
    }

    _pinMainPanelRightmostIndicator(box, entries) {
        if (box !== Main.panel._rightBox || entries.length === 0)
            return;

        const orderedPersistentEntries = entries.filter(entry =>
            entry.role && Constants.isPersistentRole(entry.role));
        if (orderedPersistentEntries.length === 0)
            return;

        const terminalEntry = orderedPersistentEntries[orderedPersistentEntries.length - 1];
        const terminalIndex = entries.indexOf(terminalEntry);
        if (terminalIndex < 0 || terminalIndex === entries.length - 1)
            return;

        entries.splice(terminalIndex, 1);
        entries.push(terminalEntry);
    }

    _reorderMainPanelIndicators() {
        [Main.panel._leftBox, Main.panel._centerBox, Main.panel._rightBox]
            .forEach(box => this._reorderMainPanelBox(box));
    }

    _applyZeroSpacingStyle(actor, extraStyle = '') {
        if (!actor?.set_style)
            return;

        const base = 'padding: 0; margin: 0; spacing: 0; -natural-hpadding: 0; -minimum-hpadding: 0;';
        actor.set_style(`${base}${extraStyle ? ` ${extraStyle}` : ''}`.trim());
    }

    _composeZeroSpacingStyle(baseStyle = '', extraStyle = '') {
        const zeroStyle = 'padding: 0; margin: 0; spacing: 0; -natural-hpadding: 0; -minimum-hpadding: 0;';
        return `${zeroStyle}${baseStyle ? ` ${baseStyle}` : ''}${extraStyle ? ` ${extraStyle}` : ''}`.trim();
    }

    _forEachActorChild(actor, callback) {
        const children = actor?.get_children?.() ?? [];
        children.forEach(child => callback(child));
    }

    _walkActorTree(actor, callback) {
        if (!actor)
            return;

        callback(actor);
        this._forEachActorChild(actor, child => this._walkActorTree(child, callback));
    }

    _rememberZeroSpacingStyle(actor) {
        if (!actor?.set_style)
            return false;

        const originalStyle = actor._mmMainPanelZeroBaseStyle ?? actor.get_style?.() ?? null;
        if (actor._mmMainPanelZeroBaseStyle === undefined)
            actor._mmMainPanelZeroBaseStyle = originalStyle;
        return true;
    }

    _applyZeroSpacingRecursively(actor) {
        this._walkActorTree(actor, currentActor => {
            if (!this._rememberZeroSpacingStyle(currentActor))
                return;

            this._applyZeroSpacingStyle(currentActor, currentActor._mmMainPanelZeroBaseStyle || '');
        });
    }

    _applyZeroSpacingToChildren(actor) {
        this._forEachActorChild(actor, child => this._applyZeroSpacingRecursively(child));
    }

    _restoreZeroSpacingRecursively(actor) {
        this._walkActorTree(actor, currentActor => {
            if (!currentActor?.set_style || currentActor._mmMainPanelZeroBaseStyle === undefined)
                return;

            currentActor.set_style(currentActor._mmMainPanelZeroBaseStyle || null);
            delete currentActor._mmMainPanelZeroBaseStyle;
        });
    }

    _restoreZeroSpacingFromChildren(actor) {
        this._forEachActorChild(actor, child => this._restoreZeroSpacingRecursively(child));
    }

    _applyPaddingToDisplayActor(actor, padding) {
        if (actor.set_style) {
            const baseStyle = actor._mmMainPanelZeroBaseStyle ?? actor.get_style?.() ?? null;
            if (actor._mmMainPanelZeroBaseStyle === undefined)
                actor._mmMainPanelZeroBaseStyle = baseStyle;

            const nextStyle = this._composeZeroSpacingStyle(
                baseStyle || '',
                `padding-left: ${padding}px; padding-right: ${padding}px;`
            );
            actor.set_style(nextStyle || null);
        }
    }

    _applyMainPanelQuickSettingsInternalPadding(actor) {
        if (!actor)
            return;

        const quickSettingsPadding = Constants.getQuickSettingsGap(this._settings) + 1;
        this._forEachActorChild(actor, child => {
            if (child?.set_style && (child instanceof St.Icon || child instanceof St.Label)) {
                this._applyPaddingToDisplayActor(child, quickSettingsPadding);
            }

            this._applyMainPanelQuickSettingsInternalPadding(child);
        });
    }

    _applyMainPanelDisplayPadding(actor, padding) {
        if (!actor)
            return;

        if (actor instanceof St.Icon || actor instanceof St.Label)
            this._applyPaddingToDisplayActor(actor, padding);

        this._forEachActorChild(actor, child => this._applyMainPanelDisplayPadding(child, padding));
    }

    transferBack(panel) {
        const transferBack = this._transfered_indicators
            .filter(element => element.monitor === panel.monitorIndex);

        this._transferBack(transferBack, panel);
    }

    transferIndicators() {
        const boxs = ['_leftBox', '_centerBox', '_rightBox'];
        const transfers = this._settings.get_value(Constants.TRANSFER_INDICATORS_ID).deep_unpack();
        const affectedPanels = new Set();
        let transfersChanged = false;

        for (const role of Object.keys(transfers)) {
            if (Constants.isPersistentRole(role))
                continue;

            delete transfers[role];
            transfersChanged = true;
        }

        if (transfersChanged)
            this._settings.set_value(Constants.TRANSFER_INDICATORS_ID, new GLib.Variant('a{si}', transfers));

        Constants.normalizeIndicatorOrder(this._settings);

        const existingTransfers = [...this._transfered_indicators];
        if (existingTransfers.length > 0)
            this._transferBack(existingTransfers);

        Object.keys(transfers)
            .filter(iname => Object.prototype.hasOwnProperty.call(transfers, iname))
            .map(iname => this._getTransferContext(iname, transfers[iname]))
            .filter(Boolean)
            .forEach(({iname, monitor, container, panel}) => {
                boxs.forEach(box => {
                    if (!Main.panel[box]?.contains(container))
                        return;

                    this._transfered_indicators.push({iname, box, monitor});
                    container._mmIndicatorRole = iname;

                    Main.panel[box].remove_child(container);
                    panel[box].add_child(container);
                    panel?._applyIndicatorPadding?.(iname, container);
                    affectedPanels.add(panel);
                });
            });

        for (const panel of affectedPanels) {
            panel?._reorderBoxesByIndicatorOrder?.();
        }
    }

    _getTransferContext(iname, monitor) {
        const indicator = Main.panel.statusArea[iname];
        const container = this._getIndicatorContainer(indicator);
        const panel = this._findPanel(monitor);

        if (!indicator || !container || !panel)
            return null;

        return {iname, monitor, indicator, container, panel};
    }

    _findPanel(monitor) {
        return this._getPanels().find(panel => panel.monitorIndex === monitor) ?? null;
    }

    _getMainPanelRestoreIndex(boxName) {
        if (boxName !== '_leftBox')
            return 0;

        const leftBoxChildren = Main.panel[boxName].get_n_children();
        return leftBoxChildren > 1 ? leftBoxChildren : 1;
    }

    _transferBack(transferBack, panel = null) {
        transferBack.forEach(element => {
            const idx = this._transfered_indicators.indexOf(element);
            if (idx >= 0)
                this._transfered_indicators.splice(idx, 1);

            if (!Main.panel.statusArea[element.iname])
                return;

            const indicator = Main.panel.statusArea[element.iname];
            const container = this._getIndicatorContainer(indicator);
            const targetPanel = panel ?? this._findPanel(element.monitor);

            if (!targetPanel || !container || !targetPanel[element.box]?.contains(container))
                return;

            targetPanel?._restoreIndicatorPadding?.(element.iname, container);
            targetPanel[element.box].remove_child(container);
            Main.panel[element.box].insert_child_at_index(
                container,
                this._getMainPanelRestoreIndex(element.box)
            );
        });
    }

    _getIndicatorContainer(indicator) {
        if (!indicator)
            return null;

        return indicator.container ?? indicator;
    }

    _extensionStateChanged() {
        this._syncMainPanelIndicators();
        this._queueMainPanelRefresh();
        this._forEachPanel(panel => {
            panel?._ensureQuickSettingsRightmost?.();
            panel?._reorderBoxesByIndicatorOrder?.();
        });
    }

    _updateSessionIndicators() {
        const sessionIndicators = [];
        sessionIndicators.push('MultiMonitorsAddOn');

        const sessionPanel = Main.sessionMode.panel;
        for (const sessionBox in sessionPanel) {
            sessionPanel[sessionBox].forEach(sessionIndicator => {
                sessionIndicators.push(sessionIndicator);
            });
        }

        this._session_indicators = sessionIndicators;
        this._available_indicators = [];

        this._syncMainPanelIndicators();
        this._queueMainPanelRefresh();
    }

    _queueMainPanelRefresh() {
        const delays = [150, 500, 1200];

        for (const delay of delays) {
            const timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
                this._syncMainPanelIndicators();

                this._mainPanelRefreshTimeoutIds = this._mainPanelRefreshTimeoutIds
                    .filter(id => id !== timeoutId);
                return GLib.SOURCE_REMOVE;
            });

            this._mainPanelRefreshTimeoutIds.push(timeoutId);
        }
    }

    _findAvailableIndicators() {
        const excludedIndicators = this._settings.get_strv(Constants.EXCLUDE_INDICATORS_ID);
        const statusArea = Main.panel.statusArea;
        const availableIndicators = Object.keys(statusArea).filter(indicator =>
            Object.prototype.hasOwnProperty.call(statusArea, indicator) &&
            Constants.isPersistentRole(indicator) &&
            !excludedIndicators.includes(indicator) &&
            (indicator === 'keyboard' || this._isIndicatorVisible(statusArea[indicator])));

        this._assignPreferredPositionsToNewIndicators(availableIndicators);
        this._assignPreferredOrderToNewIndicators(availableIndicators);
        this._pruneIndicatorSettings(availableIndicators);

        if (availableIndicators.length !== this._available_indicators.length ||
            availableIndicators.some((v, i) => v !== this._available_indicators[i])) {
            this._available_indicators = availableIndicators;
            this._settings.set_strv(Constants.AVAILABLE_INDICATORS_ID, this._available_indicators);
        }
    }

    _assignPreferredPositionsToNewIndicators(availableIndicators) {
        const currentPositions = this._settings.get_value(Constants.INDICATOR_POSITIONS_ID).deep_unpack();
        let changed = false;

        for (const role of availableIndicators) {
            if (!Constants.isPersistentRole(role))
                continue;

            if (Object.prototype.hasOwnProperty.call(currentPositions, role))
                continue;

            if (role === 'dateMenu' || role === 'quickSettings')
                continue;

            currentPositions[role] = Constants.PANEL_BOX_RIGHT;
            changed = true;
        }

        if (changed)
            this._settings.set_value(Constants.INDICATOR_POSITIONS_ID, new GLib.Variant('a{ss}', currentPositions));
    }

    _assignPreferredOrderToNewIndicators(availableIndicators) {
        const currentOrder = this._settings.get_strv(Constants.INDICATOR_ORDER_ID) || [];
        const currentPositions = this._settings.get_value(Constants.INDICATOR_POSITIONS_ID).deep_unpack();
        const newRoles = availableIndicators.filter(role => {
            if (!Constants.isPersistentRole(role))
                return false;

            if (role === 'dateMenu' || role === 'quickSettings')
                return false;

            return !currentOrder.includes(role) && currentPositions[role] === Constants.PANEL_BOX_RIGHT;
        });

        if (newRoles.length === 0)
            return;

        const nextOrder = currentOrder.filter(role => Constants.isPersistentRole(role));
        let insertIndex = nextOrder.findIndex(role =>
            Constants.getIndicatorPosition(this._settings, role) === Constants.PANEL_BOX_RIGHT);

        if (insertIndex < 0)
            insertIndex = nextOrder.length;

        nextOrder.splice(insertIndex, 0, ...newRoles);
        this._settings.set_strv(Constants.INDICATOR_ORDER_ID, nextOrder);
    }

    _isIndicatorVisible(indicator) {
        const container = this._getIndicatorContainer(indicator);
        if (!indicator || !container)
            return false;

        if (indicator.visible === false || container.visible === false)
            return false;

        const visibleDescendants = actor => {
            if (!actor || actor.visible === false)
                return false;

            if (actor instanceof St.Icon || actor instanceof St.Label)
                return true;

            const children = actor.get_children?.() ?? [];
            if (children.length === 0)
                return true;

            return children.some(child => visibleDescendants(child));
        };

        return visibleDescendants(container);
    }

    _pruneIndicatorSettings(availableIndicators) {
        const allowedRoles = new Set([
            ...Constants.FIXED_EXTERNAL_PANEL_ROLES,
            ...availableIndicators,
        ]);
        this._pruneDictionarySetting(
            Constants.TRANSFER_INDICATORS_ID,
            'a{si}',
            this._settings.get_value(Constants.TRANSFER_INDICATORS_ID).deep_unpack(),
            allowedRoles
        );

        this._pruneArraySetting(Constants.INDICATOR_ORDER_ID, allowedRoles);
        this._pruneArraySetting(Constants.HIDDEN_INDICATORS_ID, allowedRoles);

        this._pruneDictionarySetting(
            Constants.INDICATOR_POSITIONS_ID,
            'a{ss}',
            this._settings.get_value(Constants.INDICATOR_POSITIONS_ID).deep_unpack(),
            allowedRoles
        );

        this._pruneDictionarySetting(
            Constants.INDICATOR_PADDING_ID,
            'a{si}',
            this._settings.get_value(Constants.INDICATOR_PADDING_ID).deep_unpack(),
            allowedRoles,
            padding => Number.isInteger(padding) ? padding : 0
        );
    }

    _pruneArraySetting(key, allowedRoles) {
        const currentValue = this._settings.get_strv(key) || [];
        const nextValue = currentValue.filter(role =>
            Constants.isPersistentRole(role) && allowedRoles.has(role));

        if (nextValue.length !== currentValue.length)
            this._settings.set_strv(key, nextValue);
    }

    _pruneDictionarySetting(key, variantType, currentValue, allowedRoles, mapValue = value => value) {
        let changed = false;
        const nextValue = Object.fromEntries(
            Object.entries(currentValue).flatMap(([role, value]) => {
                if (!Constants.isPersistentRole(role) || !allowedRoles.has(role)) {
                    changed = true;
                    return [];
                }

                return [[role, mapValue(value)]];
            })
        );

        if (changed)
            this._settings.set_value(key, new GLib.Variant(variantType, nextValue));
    }

    _getMainPanelPaddingTarget(role) {
        const indicator = Main.panel.statusArea[role];
        if (!indicator)
            return null;

        const container = this._getIndicatorContainer(indicator);
        const parent = container?.get_parent?.() ?? null;
        if (parent !== Main.panel._leftBox && parent !== Main.panel._centerBox && parent !== Main.panel._rightBox)
            return null;

        if (role === 'quickSettings') {
            const contentBox = this._findNamedContainer(container, [
                'panel-status-indicators-box',
                'panel-status-menu-box',
            ]);
            return contentBox ?? container;
        }

        if (role === 'activities' && indicator.label_actor)
            return indicator.label_actor;

        if (role === 'screenRecording')
            return container;

        if (role === 'dateMenu' && indicator._clockDisplay) {
            const clockParent = indicator._clockDisplay.get_parent?.() ?? null;
            return clockParent ?? indicator._clockDisplay;
        }

        if (indicator._clockDisplay)
            return indicator._clockDisplay;

        if (role === 'keyboard') {
            const displayChild = this._findFirstDisplayChild(container);
            if (displayChild)
                return displayChild;
        }

        const firstChild = container?.get_first_child?.() ?? null;
        return firstChild ?? container;
    }

    _findNamedContainer(actor, classNames) {
        if (!actor)
            return null;

        const actorClasses = actor.get_style_class_name?.()?.split(/\s+/).filter(Boolean) ?? [];
        if (classNames.some(className => actorClasses.includes(className)))
            return actor;

        const children = actor.get_children?.() ?? [];
        for (const child of children) {
            const match = this._findNamedContainer(child, classNames);
            if (match)
                return match;
        }

        return null;
    }

    _findFirstDisplayChild(actor) {
        if (!actor)
            return null;

        if (actor instanceof St.Label || actor instanceof St.Icon)
            return actor;

        const children = actor.get_children?.() ?? [];
        for (const child of children) {
            const displayChild = this._findFirstDisplayChild(child);
            if (displayChild)
                return displayChild;
        }

        return null;
    }

    _getMainPanelStyleRoots(role) {
        const indicator = Main.panel.statusArea[role];
        if (!indicator)
            return [];

        const roots = [];
        const pushUnique = actor => {
            if (!actor || roots.includes(actor))
                return;
            roots.push(actor);
        };

        pushUnique(indicator);
        pushUnique(this._getIndicatorContainer(indicator));
        pushUnique(this._getMainPanelPaddingTarget(role));

        return roots;
    }

    _preserveMainPanelIndicatorPadding(role) {
        return role === 'screenRecording';
    }

    _forEachMainPanelPaddingEntry(callback) {
        this._getPersistentStatusRoles().forEach(role => {
            const target = this._getMainPanelPaddingTarget(role);
            const roots = this._getMainPanelStyleRoots(role);
            if (!target || roots.length === 0)
                return;

            callback({role, target, roots});
        });
    }

    _applyMainPanelPaddingPreparation(role, target, roots) {
        if (this._preserveMainPanelIndicatorPadding(role))
            return;

        roots.forEach(root => {
            if (root === target) {
                this._applyZeroSpacingStyle(root, root._mmMainPanelZeroBaseStyle ?? root.get_style?.() ?? '');
                this._applyZeroSpacingToChildren(root);
                return;
            }

            this._applyZeroSpacingRecursively(root);
        });
    }

    _applyMainPanelPaddingStyle(role, target, padding) {
        if (this._preserveMainPanelIndicatorPadding(role)) {
            if (target._mmMainPanelPreservedBaseStyle === undefined)
                target._mmMainPanelPreservedBaseStyle = target.get_style?.() ?? null;

            const preservedBaseStyle = target._mmMainPanelPreservedBaseStyle || '';
            const nextStyle = `${preservedBaseStyle}${preservedBaseStyle ? ' ' : ''}padding-left: ${padding}px; padding-right: ${padding}px;`.trim();
            target.set_style(nextStyle || null);
            return;
        }

        const baseStyle = target._mmMainPanelZeroBaseStyle || '';
        const nextStyle = this._composeZeroSpacingStyle(
            baseStyle,
            `padding-left: ${padding}px; padding-right: ${padding}px;`
        );
        target.set_style(nextStyle || null);
    }

    _applyActivitiesMainPanelPadding(role, target, padding) {
        const indicator = Main.panel.statusArea[role];
        const container = this._getIndicatorContainer(indicator);
        if (container?.set_style) {
            const containerBaseStyle = container._mmMainPanelZeroBaseStyle ?? container.get_style?.() ?? '';
            container.set_style(this._composeZeroSpacingStyle(
                containerBaseStyle,
                `padding-left: ${padding}px; padding-right: ${padding}px;`
            ));
        }

        this._applyMainPanelDisplayPadding(target, padding);
    }

    _applyMainPanelPaddingPostProcessing(role, target, padding) {
        if (role === 'activities') {
            this._applyActivitiesMainPanelPadding(role, target, padding);
            return;
        }

        if (role === 'quickSettings') {
            this._applyMainPanelQuickSettingsInternalPadding(target);
            return;
        }

        if (role !== 'dateMenu' && !this._preserveMainPanelIndicatorPadding(role))
            this._applyMainPanelDisplayPadding(target, padding);
    }

    _applyMainPanelIndicatorPadding() {
        this._forEachMainPanelPaddingEntry(({role, target, roots}) => {
            this._applyMainPanelPaddingPreparation(role, target, roots);
            const padding = Constants.getIndicatorPadding(this._settings, role);
            this._applyMainPanelPaddingStyle(role, target, padding);
            this._applyMainPanelPaddingPostProcessing(role, target, padding);
        });
    }

    _restoreMainPanelIndicatorPadding() {
        this._forEachMainPanelPaddingEntry(({role, target, roots}) => {
            if (this._preserveMainPanelIndicatorPadding(role)) {
                if (target._mmMainPanelPreservedBaseStyle !== undefined) {
                    target.set_style(target._mmMainPanelPreservedBaseStyle || null);
                    delete target._mmMainPanelPreservedBaseStyle;
                }
                return;
            }

            roots.forEach(root => {
                if (root === target) {
                    if (root._mmMainPanelZeroBaseStyle !== undefined) {
                        root.set_style(root._mmMainPanelZeroBaseStyle || null);
                        delete root._mmMainPanelZeroBaseStyle;
                    }
                    this._restoreZeroSpacingFromChildren(root);
                    return;
                }

                this._restoreZeroSpacingRecursively(root);
            });
        });
    }

    _getMainPanelGapTargets() {
        return [Main.panel._leftBox, Main.panel._centerBox, Main.panel._rightBox].filter(Boolean);
    }

    _forEachMainPanelGapTarget(callback) {
        this._getMainPanelGapTargets().forEach(target => callback(target));
    }

    _applyMainPanelGapStyle(target, gap) {
        const originalStyle = target._mmMainPanelGapStyle ?? target.get_style?.() ?? null;
        if (target._mmMainPanelGapStyle === undefined)
            target._mmMainPanelGapStyle = originalStyle;

        const baseStyle = target._mmMainPanelGapStyle || '';
        const gapStyle = `spacing: ${gap}px;`;
        const nextStyle = `${baseStyle}${baseStyle && gapStyle ? ' ' : ''}${gapStyle}`.trim();
        target.set_style(nextStyle || null);
    }

    _applyMainPanelIndicatorGap() {
        const gap = Constants.getIndicatorGap(this._settings);
        this._forEachMainPanelGapTarget(target => this._applyMainPanelGapStyle(target, gap));
    }

    _restoreMainPanelIndicatorGap() {
        this._forEachMainPanelGapTarget(target => {
            if (target._mmMainPanelGapStyle === undefined)
                return;

            target.set_style(target._mmMainPanelGapStyle || null);
            delete target._mmMainPanelGapStyle;
        });
    }

    _getFirstExternalMonitorIndex() {
        const primary = Main.layoutManager.primaryIndex;
        const n = Main.layoutManager.monitors?.length ?? 1;

        for (let i = 0; i < n; i++) {
            if (i !== primary)
                return i;
        }

        return primary;
    }

    _autoTransferIndicatorByPattern(pattern) {
        const available = this._settings.get_strv(Constants.AVAILABLE_INDICATORS_ID) || [];
        const name = available.find(n => pattern.test(n));
        if (!name)
            return;

        const transfers = this._settings.get_value(Constants.TRANSFER_INDICATORS_ID).deep_unpack();
        if (Object.prototype.hasOwnProperty.call(transfers, name))
            return;

        const targetMonitor = this._getFirstExternalMonitorIndex();
        if (targetMonitor === Main.layoutManager.primaryIndex)
            return;

        transfers[name] = targetMonitor;
        this._settings.set_value(Constants.TRANSFER_INDICATORS_ID, new GLib.Variant('a{si}', transfers));
    }
}
