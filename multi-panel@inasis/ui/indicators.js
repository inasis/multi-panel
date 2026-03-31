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

import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import * as PanelSettings from '../services/settings.js';
import { installStatusIndicatorsCatalogSupport } from './indicatorCatalog.js';

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
            `changed::${PanelSettings.TRANSFER_INDICATORS_ID}`,
            this.transferIndicators.bind(this)
        );

        this._excludeIndicatorsId = this._settings.connect(
            `changed::${PanelSettings.EXCLUDE_INDICATORS_ID}`,
            this._onExcludeIndicatorsChanged.bind(this)
        );

        this._indicatorOrderId = this._settings.connect(
            `changed::${PanelSettings.INDICATOR_ORDER_ID}`,
            this._onIndicatorOrderChanged.bind(this)
        );

        this._indicatorPositionsId = this._settings.connect(
            `changed::${PanelSettings.INDICATOR_POSITIONS_ID}`,
            this._onIndicatorPositionsChanged.bind(this)
        );

        this._indicatorPaddingId = this._settings.connect(
            `changed::${PanelSettings.INDICATOR_PADDING_ID}`,
            this._onIndicatorPaddingChanged.bind(this)
        );

        this._indicatorGapId = this._settings.connect(
            `changed::${PanelSettings.INDICATOR_GAP_ID}`,
            this._onMainPanelLayoutChanged.bind(this)
        );

        this._quickSettingsGapId = this._settings.connect(
            `changed::${PanelSettings.QUICK_SETTINGS_GAP_ID}`,
            this._onMainPanelLayoutChanged.bind(this)
        );

        this._applyToMainPanelId = this._settings.connect(
            `changed::${PanelSettings.APPLY_INDICATOR_LAYOUT_TO_MAIN_PANEL_ID}`,
            this._onMainPanelLayoutChanged.bind(this)
        );
        this._panelLeftPaddingId = this._settings.connect(
            `changed::${PanelSettings.PANEL_LEFT_PADDING_ID}`,
            this._onMainPanelLayoutChanged.bind(this)
        );
        this._panelRightPaddingId = this._settings.connect(
            `changed::${PanelSettings.PANEL_RIGHT_PADDING_ID}`,
            this._onMainPanelLayoutChanged.bind(this)
        );
        this._panelHeightId = this._settings.connect(
            `changed::${PanelSettings.PANEL_HEIGHT_ID}`,
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
        this._settings.disconnect(this._panelLeftPaddingId);
        this._settings.disconnect(this._panelRightPaddingId);
        this._settings.disconnect(this._panelHeightId);
        Main.extensionManager.disconnect(this._extensionStateChangedId);
        Main.sessionMode.disconnect(this._updatedSessionId);

        for (const timeoutId of this._mainPanelRefreshTimeoutIds)
            GLib.source_remove(timeoutId);
        this._mainPanelRefreshTimeoutIds = [];

        this._restoreMainPanelIndicatorPositions();
        this._restoreMainPanelIndicatorPadding();
        this._restoreMainPanelIndicatorGap();
        this._restoreMainPanelPanelLayout();
        this._settings.set_strv(PanelSettings.AVAILABLE_INDICATORS_ID, []);
        this._transferBack(this._transfered_indicators);
    }

    _getPanels() {
        return PanelSettings.getMMPanelArray() ?? [];
    }

    _forEachPanel(callback) {
        this._getPanels().forEach(panel => callback(panel));
    }

    _getPersistentStatusRoles() {
        return Object.keys(Main.panel.statusArea || {})
            .filter(role => PanelSettings.isPersistentRole(role));
    }

    _forEachPersistentStatusIndicator(callback) {
        this._getPersistentStatusRoles().forEach(role => {
            callback(role, Main.panel.statusArea[role]);
        });
    }

    _syncMainPanelIndicators() {
        this._findAvailableIndicators();
        PanelSettings.normalizeIndicatorOrder(this._settings);
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
        if (PanelSettings.shouldApplyIndicatorLayoutToMainPanel(this._settings)) {
            this._applyMainPanelIndicatorPadding();
            this._applyMainPanelIndicatorGap();
            this._applyMainPanelPanelLayout();
            return;
        }

        this._restoreMainPanelIndicatorPadding();
        this._restoreMainPanelIndicatorGap();
        this._restoreMainPanelPanelLayout();
    }

    _applyMainPanelPanelLayout() {
        const leftPadding = PanelSettings.getPanelLeftPadding(this._settings);
        const rightPadding = PanelSettings.getPanelRightPadding(this._settings);
        const height = PanelSettings.getPanelHeight(this._settings);

        PanelSettings.applyHorizontalPaddingStyle(
            Main.panel,
            '_mmPanelLayoutBaseStyle',
            leftPadding,
            rightPadding
        );
        PanelSettings.applyManagedStyle(
            Main.layoutManager.panelBox,
            '_mmPanelHeightBaseStyle',
            baseStyle => {
                const heightStyle = height > 0 ? `height: ${height}px;` : '';
                return `${baseStyle}${baseStyle && heightStyle ? ' ' : ''}${heightStyle}`.trim();
            }
        );
        Main.layoutManager.panelBox.set_height(height > 0 ? height : -1);
        Main.layoutManager.panelBox.queue_relayout?.();
        Main.panel.queue_relayout?.();
    }

    _restoreMainPanelPanelLayout() {
        PanelSettings.restoreManagedStyle(Main.panel, '_mmPanelLayoutBaseStyle');
        PanelSettings.restoreManagedStyle(Main.layoutManager.panelBox, '_mmPanelHeightBaseStyle');
        Main.layoutManager.panelBox.set_height(-1);
        Main.layoutManager.panelBox.queue_relayout?.();
        Main.panel.queue_relayout?.();
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
            ? PanelSettings.getDefaultIndicatorPosition(role)
            : PanelSettings.getIndicatorPosition(this._settings, role);

        switch (position) {
        case PanelSettings.PANEL_BOX_CENTER:
            return Main.panel._centerBox;
        case PanelSettings.PANEL_BOX_RIGHT:
            return Main.panel._rightBox;
        case PanelSettings.PANEL_BOX_LEFT:
        default:
            return Main.panel._leftBox;
        }
    }

    _getMainPanelRoleForChild(child) {
        if (!child)
            return null;

        for (const [role, indicator] of Object.entries(Main.panel.statusArea || {})) {
            if (!indicator || !PanelSettings.isPersistentRole(role))
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

        const orderedRoles = PanelSettings.sortIndicatorsByOrder(
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
            entry.role && PanelSettings.isPersistentRole(entry.role));
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

        const quickSettingsPadding = PanelSettings.getQuickSettingsGap(this._settings);
        this._forEachActorChild(actor, child => {
            if (child?.set_style && (child instanceof St.Icon || child instanceof St.Label))
                this._applyPaddingToDisplayActor(child, quickSettingsPadding);

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
        const transfers = this._settings.get_value(PanelSettings.TRANSFER_INDICATORS_ID).deep_unpack();
        const affectedPanels = new Set();
        let transfersChanged = false;

        for (const role of Object.keys(transfers)) {
            if (PanelSettings.isPersistentRole(role))
                continue;

            delete transfers[role];
            transfersChanged = true;
        }

        if (transfersChanged)
            this._settings.set_value(PanelSettings.TRANSFER_INDICATORS_ID, new GLib.Variant('a{si}', transfers));

        PanelSettings.normalizeIndicatorOrder(this._settings);

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

        for (const panel of affectedPanels)
            panel?._reorderBoxesByIndicatorOrder?.();
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

}

installStatusIndicatorsCatalogSupport(StatusIndicatorsController.prototype);
