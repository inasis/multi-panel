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

import { getIndicatorDescriptor, isRoutableDescriptor } from './indicatorRouter.js';
import * as PanelSettings from './settings.js';

const catalogSupportMethods = {
    _updateSessionIndicators() {
        const sessionIndicators = [];
        sessionIndicators.push('MultiPanel');

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
    },

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
    },

    _findAvailableIndicators() {
        const excludedIndicators = this._settings.get_strv(PanelSettings.EXCLUDE_INDICATORS_ID);
        const statusArea = Main.panel.statusArea;
        const availableIndicators = Object.keys(statusArea).filter(indicator =>
            Object.prototype.hasOwnProperty.call(statusArea, indicator) &&
            PanelSettings.isPersistentRole(indicator) &&
            !excludedIndicators.includes(indicator) &&
            this._isRoutableIndicator(indicator, statusArea[indicator]) &&
            (this._getIndicatorCatalogPolicy(indicator).includeWhenHidden === true ||
                this._isIndicatorVisible(statusArea[indicator])));

        this._assignPreferredPositionsToNewIndicators(availableIndicators);
        this._assignPreferredOrderToNewIndicators(availableIndicators);
        this._pruneIndicatorSettings(availableIndicators);

        if (availableIndicators.length !== this._available_indicators.length ||
            availableIndicators.some((v, i) => v !== this._available_indicators[i])) {
            this._available_indicators = availableIndicators;
            this._settings.set_strv(PanelSettings.AVAILABLE_INDICATORS_ID, this._available_indicators);
        }
    },

    _assignPreferredPositionsToNewIndicators(availableIndicators) {
        const currentPositions = this._settings.get_value(PanelSettings.INDICATOR_POSITIONS_ID).deep_unpack();
        let changed = false;

        for (const role of availableIndicators) {
            if (!PanelSettings.isPersistentRole(role))
                continue;
            if (Object.prototype.hasOwnProperty.call(currentPositions, role))
                continue;
            if (this._getIndicatorCatalogPolicy(role).preservePreferredSettings === true)
                continue;

            currentPositions[role] = PanelSettings.PANEL_BOX_RIGHT;
            changed = true;
        }

        if (changed)
            this._settings.set_value(PanelSettings.INDICATOR_POSITIONS_ID, new GLib.Variant('a{ss}', currentPositions));
    },

    _assignPreferredOrderToNewIndicators(availableIndicators) {
        const currentOrder = this._settings.get_strv(PanelSettings.INDICATOR_ORDER_ID) || [];
        const currentPositions = this._settings.get_value(PanelSettings.INDICATOR_POSITIONS_ID).deep_unpack();
        const newRoles = availableIndicators.filter(role => {
            if (!PanelSettings.isPersistentRole(role))
                return false;
            if (this._getIndicatorCatalogPolicy(role).preservePreferredSettings === true)
                return false;

            return !currentOrder.includes(role) &&
                currentPositions[role] === PanelSettings.PANEL_BOX_RIGHT;
        });

        if (newRoles.length === 0)
            return;

        const nextOrder = currentOrder.filter(role => PanelSettings.isPersistentRole(role));
        let insertIndex = nextOrder.findIndex(role =>
            PanelSettings.getIndicatorPosition(this._settings, role) === PanelSettings.PANEL_BOX_RIGHT);

        if (insertIndex < 0)
            insertIndex = nextOrder.length;

        nextOrder.splice(insertIndex, 0, ...newRoles);
        this._settings.set_strv(PanelSettings.INDICATOR_ORDER_ID, nextOrder);
    },

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
    },

    _isRoutableIndicator(role, source) {
        const descriptor = getIndicatorDescriptor({role, source});
        return isRoutableDescriptor(descriptor);
    },

    _getIndicatorCatalogPolicy(role) {
        return this._getIndicatorDescriptor(role).catalog ?? {};
    },

    _getIndicatorDescriptor(role) {
        return getIndicatorDescriptor({
            role,
            source: Main.panel.statusArea?.[role] ?? null,
        });
    },

    _pruneIndicatorSettings(availableIndicators) {
        const allowedRoles = new Set([
            ...PanelSettings.FIXED_EXTERNAL_PANEL_ROLES,
            ...availableIndicators,
        ]);
        this._pruneDictionarySetting(
            PanelSettings.TRANSFER_INDICATORS_ID,
            'a{si}',
            this._settings.get_value(PanelSettings.TRANSFER_INDICATORS_ID).deep_unpack(),
            allowedRoles
        );

        this._pruneArraySetting(PanelSettings.INDICATOR_ORDER_ID, allowedRoles);
        this._pruneArraySetting(PanelSettings.HIDDEN_INDICATORS_ID, allowedRoles);

        this._pruneDictionarySetting(
            PanelSettings.INDICATOR_POSITIONS_ID,
            'a{ss}',
            this._settings.get_value(PanelSettings.INDICATOR_POSITIONS_ID).deep_unpack(),
            allowedRoles
        );

        this._pruneDictionarySetting(
            PanelSettings.INDICATOR_PADDING_ID,
            'a{si}',
            this._settings.get_value(PanelSettings.INDICATOR_PADDING_ID).deep_unpack(),
            allowedRoles,
            padding => Number.isInteger(padding) ? padding : 0
        );
    },

    _pruneArraySetting(key, allowedRoles) {
        const currentValue = this._settings.get_strv(key) || [];
        const nextValue = currentValue.filter(role =>
            PanelSettings.isPersistentRole(role) && allowedRoles.has(role));

        if (nextValue.length !== currentValue.length)
            this._settings.set_strv(key, nextValue);
    },

    _pruneDictionarySetting(key, variantType, currentValue, allowedRoles, mapValue = value => value) {
        let changed = false;
        const nextValue = Object.fromEntries(
            Object.entries(currentValue).flatMap(([role, value]) => {
                if (!PanelSettings.isPersistentRole(role) || !allowedRoles.has(role)) {
                    changed = true;
                    return [];
                }

                return [[role, mapValue(value)]];
            })
        );

        if (changed)
            this._settings.set_value(key, new GLib.Variant(variantType, nextValue));
    },

    _getMainPanelPaddingTarget(role) {
        const indicator = Main.panel.statusArea[role];
        if (!indicator)
            return null;

        const container = this._getIndicatorContainer(indicator);
        const parent = container?.get_parent?.() ?? null;
        if (parent !== Main.panel._leftBox && parent !== Main.panel._centerBox && parent !== Main.panel._rightBox)
            return null;

        const descriptor = this._getIndicatorDescriptor(role);
        const layout = descriptor.layout ?? {};

        switch (layout.mainPanelPaddingTarget) {
        case 'container':
            return container;

        case 'named-container': {
            const contentBox = this._findNamedContainer(
                container,
                layout.mainPanelPaddingClassNames ?? []
            );
            return contentBox ?? container;
        }

        case 'label-parent':
            if (indicator.label_actor) {
                const labelParent = indicator.label_actor.get_parent?.() ?? null;
                return labelParent ?? indicator.label_actor;
            }
            break;

        case 'display-child': {
            const displayChild = this._findFirstDisplayChild(container);
            if (displayChild)
                return displayChild;
            break;
        }

        default:
            break;
        }

        const firstChild = container?.get_first_child?.() ?? null;
        return firstChild ?? container;
    },

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
    },

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
    },

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
    },

    _preserveMainPanelIndicatorPadding(role) {
        const indicator = Main.panel.statusArea[role];
        if (!indicator)
            return false;

        const descriptor = this._getIndicatorDescriptor(role);
        return descriptor.layout?.preserveMainPanelPadding === true;
    },

    _forEachMainPanelPaddingEntry(callback) {
        this._getPersistentStatusRoles().forEach(role => {
            const target = this._getMainPanelPaddingTarget(role);
            const roots = this._getMainPanelStyleRoots(role);
            if (!target || roots.length === 0)
                return;

            callback({ role, target, roots });
        });
    },

    _applyMainPanelPaddingPreparation(role, target, roots) {
        roots.forEach(root => {
            if (root._mmMainPanelZeroBaseStyle !== undefined)
                this._restoreZeroSpacingRecursively(root);
        });

        if (target._mmMainPanelPreservedBaseStyle === undefined)
            target._mmMainPanelPreservedBaseStyle = target.get_style?.() ?? null;
    },

    _applyMainPanelPaddingStyle(role, target, padding) {
        const preservedBaseStyle = target._mmMainPanelPreservedBaseStyle ?? target.get_style?.() ?? '';
        const paddingStyle = `padding-left: ${padding}px; padding-right: ${padding}px;`;
        const nextStyle = `${preservedBaseStyle}${preservedBaseStyle && paddingStyle ? ' ' : ''}${paddingStyle}`.trim();
        target.set_style(nextStyle || null);
    },

    _applyMainPanelIndicatorPadding() {
        this._restoreMainPanelPolicyPadding();
        this._forEachMainPanelPaddingEntry(({role, target, roots}) => {
            if (!PanelSettings.hasIndicatorPaddingOverride(this._settings, role)) {
                this._restoreMainPanelPaddingEntry(role, target, roots);
                return;
            }

            this._applyMainPanelPaddingPreparation(role, target, roots);
            const padding = PanelSettings.getIndicatorPadding(this._settings, role);
            this._applyMainPanelPaddingStyle(role, target, padding);
        });
    },

    _restoreMainPanelPaddingEntry(role, target, roots) {
        if (target._mmMainPanelPreservedBaseStyle !== undefined) {
            target.set_style(target._mmMainPanelPreservedBaseStyle || null);
            delete target._mmMainPanelPreservedBaseStyle;
        }

        roots.forEach(root => {
            if (root._mmMainPanelZeroBaseStyle !== undefined)
                this._restoreZeroSpacingRecursively(root);
        });
    },

    _restoreMainPanelIndicatorPadding() {
        this._restoreMainPanelPolicyPadding();
        this._forEachMainPanelPaddingEntry(({role, target, roots}) => {
            this._restoreMainPanelPaddingEntry(role, target, roots);
        });
    },

    _restoreMainPanelPolicyPadding() {
        const targets = [Main.panel._leftBox];

        this._getPersistentStatusRoles().forEach(role => {
            const descriptor = this._getIndicatorDescriptor(role);
            if (descriptor.layout?.restoreMainPanelPaddingBeforeApply !== true)
                return;

            const indicator = Main.panel.statusArea[role];
            targets.push(
                indicator,
                this._getIndicatorContainer(indicator),
                indicator?.label_actor
            );
        });

        targets.forEach(target => {
            if (!target?.set_style)
                return;

            if (target._mmMainPanelPreservedBaseStyle !== undefined) {
                target.set_style(target._mmMainPanelPreservedBaseStyle || null);
                delete target._mmMainPanelPreservedBaseStyle;
            }

            this._restoreZeroSpacingRecursively(target);

            if (target._mmMainPanelGapStyle !== undefined) {
                target.set_style(target._mmMainPanelGapStyle || null);
                delete target._mmMainPanelGapStyle;
            }
        });
    },

    _getMainPanelGapTargets() {
        const targets = [Main.panel._centerBox, Main.panel._rightBox].filter(Boolean);
        const anchorContainer = this._getMainPanelGapAnchorContainer();
        const leftBox = Main.panel._leftBox;

        if (leftBox && anchorContainer?.get_parent?.() !== leftBox)
            targets.unshift(leftBox);

        return targets;
    },

    _getMainPanelGapAnchorContainer() {
        const role = this._getPersistentStatusRoles().find(statusRole =>
            this._getIndicatorDescriptor(statusRole).layout?.gapAnchor === true);

        if (!role)
            return null;

        return this._getIndicatorContainer(Main.panel.statusArea[role]);
    },

    _forEachMainPanelGapTarget(callback) {
        this._getMainPanelGapTargets().forEach(target => callback(target));
    },

    _applyMainPanelGapStyle(target, gap) {
        PanelSettings.applyGapStyle(target, '_mmMainPanelGapStyle', gap);
    },

    _applyMainPanelIndicatorGap() {
        const gap = PanelSettings.getIndicatorGap(this._settings);
        this._forEachMainPanelGapTarget(target => this._applyMainPanelGapStyle(target, gap));
    },

    _restoreMainPanelIndicatorGap() {
        this._forEachMainPanelGapTarget(target => {
            if (target._mmMainPanelGapStyle === undefined)
                return;

            target.set_style(target._mmMainPanelGapStyle || null);
            delete target._mmMainPanelGapStyle;
        });
    },

    _getFirstExternalMonitorIndex() {
        const primary = Main.layoutManager.primaryIndex;
        const n = Main.layoutManager.monitors?.length ?? 1;

        for (let i = 0; i < n; i++) {
            if (i !== primary)
                return i;
        }

        return primary;
    },

    _autoTransferIndicatorByPattern(pattern) {
        const available = this._settings.get_strv(PanelSettings.AVAILABLE_INDICATORS_ID) || [];
        const name = available.find(n => pattern.test(n));
        if (!name)
            return;

        const transfers = this._settings.get_value(PanelSettings.TRANSFER_INDICATORS_ID).deep_unpack();
        if (Object.prototype.hasOwnProperty.call(transfers, name))
            return;

        const targetMonitor = this._getFirstExternalMonitorIndex();
        if (targetMonitor === Main.layoutManager.primaryIndex)
            return;

        transfers[name] = targetMonitor;
        this._settings.set_value(PanelSettings.TRANSFER_INDICATORS_ID, new GLib.Variant('a{si}', transfers));
    },
};

export function installStatusIndicatorsCatalogSupport(prototype) {
    Object.assign(prototype, catalogSupportMethods);
}
