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
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// Settings keys
export const SHOW_PANEL_ID = 'show-panel';
export const SHOW_ACTIVITIES_ID = 'show-activities';
export const SHOW_APP_MENU_ID = 'show-app-menu';
export const SHOW_DATE_TIME_ID = 'show-date-time';
export const AVAILABLE_INDICATORS_ID = 'available-indicators';
export const TRANSFER_INDICATORS_ID = 'transfer-indicators';
export const INDICATOR_ORDER_ID = 'indicator-order';
export const INDICATOR_POSITIONS_ID = 'indicator-positions';
export const HIDDEN_INDICATORS_ID = 'hidden-indicators';
export const INDICATOR_PADDING_ID = 'indicator-padding';
export const INDICATOR_GAP_ID = 'indicator-gap';
export const QUICK_SETTINGS_GAP_ID = 'quick-settings-gap';
export const APPLY_INDICATOR_LAYOUT_TO_MAIN_PANEL_ID = 'apply-indicator-layout-to-main-panel';
export const PANEL_LEFT_PADDING_ID = 'panel-left-padding';
export const PANEL_RIGHT_PADDING_ID = 'panel-right-padding';
export const PANEL_HEIGHT_ID = 'panel-height';
export const EXCLUDE_INDICATORS_ID = 'exclude-indicators';
export const SCREENSHOT_ON_ALL_MONITORS_ID = 'screenshot-on-all-monitors';

export const PANEL_BOX_LEFT = 'left';
export const PANEL_BOX_CENTER = 'center';
export const PANEL_BOX_RIGHT = 'right';

export const PANEL_BOX_IDS = [
    PANEL_BOX_LEFT,
    PANEL_BOX_CENTER,
    PANEL_BOX_RIGHT,
];

// Fixed roles that can appear on external panels even if not listed in available-indicators
export const FIXED_EXTERNAL_PANEL_ROLES = [
    'activities',
    'appMenu',
    'dateMenu',
    'quickSettings',
];

const TRANSIENT_ROLE_PATTERNS = [
    /^appindicator-:/i,
    /^org\/ayatana\/NotificationItem/i,
];

// Store reference to mmPanel array set by extension.js
let _mmPanelArrayRef = null;

// Helper function to set the mmPanel reference
export function setMMPanelArrayRef(mmPanelArray) {
    _mmPanelArrayRef = mmPanelArray;
}

// Helper function to safely access mmPanel array
export function getMMPanelArray() {
    if ('mmPanel' in Main && Main.mmPanel)
        return Main.mmPanel;

    return _mmPanelArrayRef;
}

export function getIndicatorOrder(settings) {
    try {
        return settings.get_strv(INDICATOR_ORDER_ID) || [];
    } catch (_e) {
        return [];
    }
}

export function getIndicatorPositions(settings) {
    try {
        const positions = settings.get_value(INDICATOR_POSITIONS_ID).deep_unpack();
        const filtered = {};

        for (const [role, box] of Object.entries(positions)) {
            if (!isPersistentRole(role))
                continue;

            filtered[role] = PANEL_BOX_IDS.includes(box) ? box : getDefaultIndicatorPosition(role);
        }

        return filtered;
    } catch (_e) {
        return {};
    }
}

export function setIndicatorPositions(settings, positions) {
    const normalized = {};

    for (const [role, box] of Object.entries(positions || {})) {
        if (!isPersistentRole(role))
            continue;

        normalized[role] = PANEL_BOX_IDS.includes(box) ? box : getDefaultIndicatorPosition(role);
    }

    settings.set_value(INDICATOR_POSITIONS_ID, new GLib.Variant('a{ss}', normalized));
}

export function getDefaultIndicatorPosition(role) {
    switch (role) {
    case 'dateMenu':
        return PANEL_BOX_CENTER;
    case 'quickSettings':
        return PANEL_BOX_RIGHT;
    default:
        return PANEL_BOX_LEFT;
    }
}

export function getIndicatorPosition(settings, role) {
    const positions = getIndicatorPositions(settings);
    return positions[role] || getDefaultIndicatorPosition(role);
}

function mergeUniqueRoles(...roleGroups) {
    const merged = [];

    for (const roles of roleGroups) {
        for (const role of roles) {
            if (!isPersistentRole(role) || merged.includes(role))
                continue;

            merged.push(role);
        }
    }

    return merged;
}

function getPanelBoxRank(box) {
    switch (box) {
    case PANEL_BOX_LEFT:
        return 0;
    case PANEL_BOX_CENTER:
        return 1;
    case PANEL_BOX_RIGHT:
        return 2;
    default:
        return 0;
    }
}

export function setIndicatorOrder(settings, order) {
    settings.set_strv(INDICATOR_ORDER_ID, order);
}

export function getTransferredIndicators(settings) {
    try {
        const transfers = settings.get_value(TRANSFER_INDICATORS_ID).deep_unpack();
        const filtered = {};

        for (const [role, monitor] of Object.entries(transfers)) {
            if (!isPersistentRole(role))
                continue;

            filtered[role] = monitor;
        }

        return filtered;
    } catch (_e) {
        return {};
    }
}

export function getAvailableIndicators(settings) {
    try {
        return (settings.get_strv(AVAILABLE_INDICATORS_ID) || []).filter(isPersistentRole);
    } catch (_e) {
        return [];
    }
}

export function getExcludedIndicators(settings) {
    try {
        return settings.get_strv(EXCLUDE_INDICATORS_ID) || [];
    } catch (_e) {
        return [];
    }
}

export function getHiddenIndicators(settings) {
    try {
        return uniqueRoles((settings.get_strv(HIDDEN_INDICATORS_ID) || []).filter(isPersistentRole));
    } catch (_e) {
        return [];
    }
}

export function setHiddenIndicators(settings, roles) {
    settings.set_strv(HIDDEN_INDICATORS_ID, uniqueRoles((roles || []).filter(isPersistentRole)));
}

export function getIndicatorPaddingMap(settings) {
    try {
        const paddingMap = settings.get_value(INDICATOR_PADDING_ID).deep_unpack();
        const filtered = {};

        for (const [role, padding] of Object.entries(paddingMap)) {
            if (!isPersistentRole(role))
                continue;

            filtered[role] = Number.isInteger(padding) ? padding : 0;
        }

        return filtered;
    } catch (_e) {
        return {};
    }
}

export function getDefaultIndicatorPadding(settings, role) {
    if (role === 'quickSettings')
        return getQuickSettingsGap(settings);

    return null;
}

export function hasIndicatorPaddingOverride(settings, role) {
    const paddingMap = getIndicatorPaddingMap(settings);
    return Number.isInteger(paddingMap[role]);
}

export function getIndicatorPadding(settings, role) {
    const paddingMap = getIndicatorPaddingMap(settings);
    return Number.isInteger(paddingMap[role])
        ? paddingMap[role]
        : getDefaultIndicatorPadding(settings, role);
}

export function setIndicatorPadding(settings, role, padding) {
    const paddingMap = getIndicatorPaddingMap(settings);
    const nextPadding = Number.isFinite(padding) ? Math.round(padding) : 0;

    if (nextPadding === 0)
        delete paddingMap[role];
    else
        paddingMap[role] = nextPadding;

    settings.set_value(INDICATOR_PADDING_ID, new GLib.Variant('a{si}', paddingMap));
}

export function getIndicatorGap(settings) {
    try {
        const value = settings.get_int(INDICATOR_GAP_ID);
        return Number.isInteger(value) ? value : 0;
    } catch (_e) {
        return 0;
    }
}

export function getQuickSettingsGap(settings) {
    try {
        const value = settings.get_int(QUICK_SETTINGS_GAP_ID);
        return Number.isInteger(value) ? value : 0;
    } catch (_e) {
        return 0;
    }
}

export function getPanelLeftPadding(settings) {
    try {
        const value = settings.get_int(PANEL_LEFT_PADDING_ID);
        return Number.isInteger(value) ? Math.max(0, value) : 0;
    } catch (_e) {
        return 0;
    }
}

export function getPanelRightPadding(settings) {
    try {
        const value = settings.get_int(PANEL_RIGHT_PADDING_ID);
        return Number.isInteger(value) ? Math.max(0, value) : 0;
    } catch (_e) {
        return 0;
    }
}

export function getPanelHeight(settings) {
    try {
        const value = settings.get_int(PANEL_HEIGHT_ID);
        return Number.isInteger(value) ? Math.max(0, value) : 0;
    } catch (_e) {
        return 0;
    }
}

export function shouldApplyIndicatorLayoutToMainPanel(settings) {
    try {
        return settings.get_boolean(APPLY_INDICATOR_LAYOUT_TO_MAIN_PANEL_ID);
    } catch (_e) {
        return false;
    }
}

export function composeSpacingStyle(baseStyle, gap) {
    const gapStyle = `spacing: ${gap}px;`;
    return `${baseStyle || ''}${baseStyle && gapStyle ? ' ' : ''}${gapStyle}`.trim() || null;
}

export function sanitizeInlineStyle(style) {
    if (!style || typeof style !== 'string')
        return null;

    const lengthLikeProperty = /^(?:padding|margin|spacing|width|height|min-width|min-height|max-width|max-height|icon-size|border(?:-(?:top|right|bottom|left))?-width|-natural-hpadding|-minimum-hpadding)$/i;
    const validLengthValue = /^(?:-?\d+(?:\.\d+)?(?:px|pt|em|rem|%)?|0|auto|inherit|initial|unset|calc\(.+\)|var\(.+\))$/i;

    const sanitized = style
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

    return sanitized || null;
}

export function applyManagedStyle(actor, key, buildStyle) {
    if (!actor?.set_style)
        return;

    const originalStyle = actor[key] ?? actor.get_style?.() ?? null;
    if (actor[key] === undefined)
        actor[key] = originalStyle;

    const nextStyle = buildStyle(actor[key] || '');
    actor.set_style(nextStyle || null);
}

export function restoreManagedStyle(actor, key) {
    if (!actor?.set_style || actor[key] === undefined)
        return;

    actor.set_style(actor[key] || null);
    delete actor[key];
}

export function applyHorizontalPaddingStyle(actor, key, leftPadding, rightPadding) {
    applyManagedStyle(actor, key, baseStyle => {
        const paddingStyle = `padding-left: ${leftPadding}px; padding-right: ${rightPadding}px;`;
        return `${baseStyle}${baseStyle && paddingStyle ? ' ' : ''}${paddingStyle}`.trim();
    });
}

export function applyGapStyle(actor, key, gap) {
    applyManagedStyle(actor, key, baseStyle => composeSpacingStyle(baseStyle, gap));
}

export function isIndicatorHidden(settings, role) {
    return getHiddenIndicators(settings).includes(role);
}

export function getOrderableRoles(settings) {
    const available = getAvailableIndicators(settings);
    const transfers = getTransferredIndicators(settings);
    const order = getIndicatorOrder(settings);
    return mergeUniqueRoles(
        FIXED_EXTERNAL_PANEL_ROLES,
        available,
        Object.keys(transfers),
        order
    );
}

function uniqueRoles(roles) {
    const seen = new Set();
    const unique = [];

    for (const role of roles) {
        if (!role || seen.has(role))
            continue;

        seen.add(role);
        unique.push(role);
    }

    return unique;
}

export function isTransientRole(role) {
    if (!role)
        return false;

    return TRANSIENT_ROLE_PATTERNS.some(pattern => pattern.test(role));
}

export function isPersistentRole(role) {
    return !!role && !isTransientRole(role);
}

function buildNormalizedIndicatorOrder(settings, order, allowed = getOrderableRoles(settings)) {
    const currentOrder = order ?? getIndicatorOrder(settings);
    const dedupedOrder = uniqueRoles(
        currentOrder.filter(role => isPersistentRole(role) && allowed.includes(role))
    );

    const nextOrder = [];

    for (const box of PANEL_BOX_IDS) {
        for (const role of dedupedOrder) {
            if (getIndicatorPosition(settings, role) === box)
                nextOrder.push(role);
        }
    }

    for (const role of allowed) {
        if (!nextOrder.includes(role))
            nextOrder.push(role);
    }

    return nextOrder;
}

export function normalizeIndicatorOrder(settings) {
    const currentOrder = getIndicatorOrder(settings);
    const nextOrder = buildNormalizedIndicatorOrder(settings, currentOrder);

    const changed =
        nextOrder.length !== currentOrder.length ||
        nextOrder.some((role, index) => role !== currentOrder[index]);

    if (changed)
        setIndicatorOrder(settings, nextOrder);

    return nextOrder;
}

export function getIndicatorRankMap(settings) {
    const order = normalizeIndicatorOrder(settings);
    const map = new Map();

    order.forEach((role, index) => {
        map.set(role, index);
    });

    return map;
}

export function sortIndicatorsByOrder(settings, roles) {
    const rankMap = getIndicatorRankMap(settings);
    const unique = uniqueRoles(roles);

    return unique.sort((a, b) => {
        const aRank = isPersistentRole(a) && rankMap.has(a) ? rankMap.get(a) : Number.MAX_SAFE_INTEGER;
        const bRank = isPersistentRole(b) && rankMap.has(b) ? rankMap.get(b) : Number.MAX_SAFE_INTEGER;

        if (aRank !== bRank)
            return aRank - bRank;

        return 0;
    });
}

export function moveIndicatorBefore(settings, sourceRole, targetRole) {
    if (!sourceRole || !targetRole || sourceRole === targetRole)
        return getIndicatorOrder(settings);

    const order = normalizeIndicatorOrder(settings);
    const next = order.filter(role => role !== sourceRole);
    const sourceBox = getIndicatorPosition(settings, sourceRole);
    const targetBox = getIndicatorPosition(settings, targetRole);

    if (getPanelBoxRank(sourceBox) < getPanelBoxRank(targetBox)) {
        let insertIndex = next.indexOf(targetRole);
        while (insertIndex > 0 && getIndicatorPosition(settings, next[insertIndex - 1]) === sourceBox)
            insertIndex--;
        next.splice(insertIndex, 0, sourceRole);
    } else if (getPanelBoxRank(sourceBox) > getPanelBoxRank(targetBox)) {
        let insertIndex = next.findIndex(role => getIndicatorPosition(settings, role) === sourceBox);
        if (insertIndex < 0)
            next.push(sourceRole);
        else
            next.splice(insertIndex, 0, sourceRole);
    } else {
        const targetIndex = next.indexOf(targetRole);
        if (targetIndex < 0)
            next.push(sourceRole);
        else
            next.splice(targetIndex, 0, sourceRole);
    }

    const normalized = normalizeIndicatorOrderWithFallback(settings, next);
    setIndicatorOrder(settings, normalized);
    return normalized;
}

function normalizeIndicatorOrderWithFallback(settings, order) {
    return buildNormalizedIndicatorOrder(settings, order);
}

export function moveIndicatorToEnd(settings, sourceRole) {
    if (!sourceRole)
        return getIndicatorOrder(settings);

    const order = normalizeIndicatorOrder(settings);
    const next = order.filter(role => role !== sourceRole);
    const sourceBox = getIndicatorPosition(settings, sourceRole);
    let insertIndex = -1;

    for (let i = next.length - 1; i >= 0; i--) {
        if (getIndicatorPosition(settings, next[i]) === sourceBox) {
            insertIndex = i + 1;
            break;
        }
    }

    if (insertIndex < 0)
        next.push(sourceRole);
    else
        next.splice(insertIndex, 0, sourceRole);

    const normalized = normalizeIndicatorOrderWithFallback(settings, next);
    setIndicatorOrder(settings, normalized);
    return normalized;
}

export function ensureIndicatorInOrder(settings, role) {
    if (!role)
        return getIndicatorOrder(settings);

    const order = normalizeIndicatorOrder(settings);
    if (order.includes(role))
        return order;

    const next = [...order, role];
    setIndicatorOrder(settings, next);
    return next;
}
