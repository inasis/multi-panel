/*
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

export const DEFAULT_INDICATOR_RULES = [
    {
        name: 'activities-uses-shell-overview-forwarder',
        match: descriptor => descriptor.role === 'activities',
        apply: descriptor => ({
            ...descriptor,
            kind: 'overview-forward',
            appearance: {
                name: 'mmPanelActivities',
                styleClass: 'mm-activities',
            },
            layout: {
                auxiliaryPaddingTarget: 'label-actor',
                ensureOnAuxiliary: true,
                gapAnchor: true,
                hideOnPrimaryMonitor: true,
                mainPanelHiddenMode: 'preserve-visible',
                mainPanelPaddingTarget: 'container',
                pinMainPanelOrder: true,
                restoreMainPanelPaddingBeforeApply: true,
                skipMainPanelMove: true,
                showWhenSetting: 'show-activities',
            },
            reason: null,
        }),
    },
    {
        name: 'app-menu-uses-dedicated-auxiliary-button',
        match: descriptor => descriptor.role === 'appMenu',
        apply: descriptor => ({
            ...descriptor,
            kind: 'dedicated',
            implementation: 'appMenu',
            reason: null,
        }),
    },
    {
        name: 'date-menu-uses-dedicated-auxiliary-button',
        match: descriptor => descriptor.role === 'dateMenu',
        apply: descriptor => ({
            ...descriptor,
            kind: 'dedicated',
            implementation: 'dateMenu',
            catalog: {
                preservePreferredSettings: true,
            },
            layout: {
                auxiliaryPaddingTarget: 'label-actor',
                mainPanelPaddingTarget: 'label-parent',
            },
            reason: null,
        }),
    },
    {
        name: 'quick-settings-uses-dedicated-auxiliary-button',
        match: descriptor => descriptor.role === 'quickSettings',
        apply: descriptor => ({
            ...descriptor,
            kind: 'dedicated',
            implementation: 'quickSettings',
            catalog: {
                preservePreferredSettings: true,
            },
            layout: {
                auxiliaryPaddingMode: 'outer-and-target',
                forceAuxiliaryRightmost: true,
                forceMainPanelRightmost: true,
                mainPanelPaddingTarget: 'named-container',
                mainPanelPaddingClassNames: [
                    'panel-status-indicators-box',
                    'panel-status-menu-box',
                ],
            },
            reason: null,
        }),
    },
    {
        name: 'hide-legacy-aggregate-menu',
        match: descriptor => descriptor.role === 'aggregateMenu',
        apply: descriptor => ({
            ...descriptor,
            kind: 'hidden',
            reason: 'legacy-aggregate-menu-hidden',
        }),
    },
    {
        name: 'screen-capture-indicators-forward-actions',
        match: descriptor =>
            ['screenSharing', 'screenRecording', 'screencast'].includes(descriptor.role) &&
            (descriptor.capabilities.has('direct-action') ||
                descriptor.capabilities.has('click') ||
                descriptor.capabilities.has('interaction-forward')),
        apply: descriptor => ({
            ...descriptor,
            kind: 'activation-forward',
            capabilities: new Set([
                ...descriptor.capabilities,
                'direct-action',
                'appearance-sync',
            ]),
            layout: {
                mainPanelPaddingTarget: 'container',
                preserveMainPanelPadding: descriptor.role === 'screenRecording',
            },
        }),
    },
    {
        name: 'keyboard-prefers-display-padding',
        match: descriptor => descriptor.role === 'keyboard',
        apply: descriptor => ({
            ...descriptor,
            layout: {
                ...(descriptor.layout ?? {}),
                mainPanelHiddenMode: 'force-visible',
                mainPanelPaddingTarget: 'display-child',
            },
            catalog: {
                ...(descriptor.catalog ?? {}),
                includeWhenHidden: true,
            },
            capabilities: new Set([
                ...descriptor.capabilities,
                'ignore-source-style',
                'ignore-source-visibility',
                'always-visible',
            ]),
        }),
    },
    {
        name: 'external-indicator-clone-only-without-forwarding',
        match: descriptor =>
            descriptor.capabilities.has('external') &&
            descriptor.capabilities.has('cloneable') &&
            !descriptor.capabilities.has('menu-toggle') &&
            !descriptor.capabilities.has('custom-menu-toggle') &&
            !descriptor.capabilities.has('activate') &&
            !descriptor.capabilities.has('click') &&
            !descriptor.capabilities.has('interaction-forward'),
        apply: descriptor => ({
            ...descriptor,
            kind: 'clone-only',
        }),
    },
];

export class RuleRegistry {
    constructor(rules = DEFAULT_INDICATOR_RULES) {
        this._rules = rules;
    }

    apply(descriptor) {
        for (const rule of this._rules) {
            if (!rule.match(descriptor))
                continue;

            return rule.apply(descriptor);
        }

        return descriptor;
    }
}
