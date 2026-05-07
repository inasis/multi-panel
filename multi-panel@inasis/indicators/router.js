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

import St from 'gi://St';

const DIRECT_ACTION_METHODS = [
    'stop',
    '_stop',
    'stopRecording',
    '_stopRecording',
    'stopScreencast',
    '_stopScreencast',
    'stopSharing',
    '_stopSharing',
];

const CUSTOM_MENU_PROPERTIES = [
    '_popupFavoriteAppsMenu',
    '_popupPowerItemsMenu',
    '_popup',
    '_popupMenu',
];

function mergeCapabilities(descriptor, capabilities) {
    return new Set([...descriptor.capabilities, ...capabilities]);
}

function lower(value) {
    return String(value ?? '').toLowerCase();
}

function hasAny(value, needles) {
    const haystack = lower(value);
    return needles.some(needle => haystack.includes(needle));
}

class IndicatorInspector {
    inspect({role, source}) {
        const actor = this._resolveActor(source);

        if (!source || !actor) {
            return {
                role,
                source,
                actor: null,
                kind: 'missing',
                capabilities: new Set(),
                reason: 'source-not-found',
            };
        }

        const capabilities = new Set();

        if (source.menu)
            capabilities.add('menu');
        if (typeof source.menu?.toggle === 'function' ||
            typeof source.menu?.open === 'function')
            capabilities.add('menu-toggle');
        if (typeof source.activate === 'function')
            capabilities.add('activate');
        if (typeof source.clicked === 'function' || source instanceof St.Button)
            capabilities.add('click');
        if (typeof source.toggleMenu === 'function' ||
            typeof source.arcMenu?.toggle === 'function' ||
            typeof source._menuButton?.toggleMenu === 'function' ||
            CUSTOM_MENU_PROPERTIES.some(name => typeof source[name]?.toggle === 'function'))
            capabilities.add('custom-menu-toggle');
        if (this._hasDirectAction(source) || this._hasDirectAction(actor))
            capabilities.add('direct-action');
        if (this._hasInteractiveActor(actor))
            capabilities.add('interaction-forward');
        if (typeof actor.connect === 'function')
            capabilities.add('signals');
        if (this._hasIcon(actor) || this._hasLabel(actor))
            capabilities.add('simple-visual');
        if (this._hasIcon(actor))
            capabilities.add('icon');
        if (this._hasLabel(actor))
            capabilities.add('label');
        if (actor && typeof actor.get_parent === 'function')
            capabilities.add('cloneable');
        if (this._looksLikePanelButton(actor))
            capabilities.add('panel-button');
        if (this._looksExternalIndicator(role, source, actor))
            capabilities.add('external');

        return {
            role,
            source,
            actor,
            kind: this._classify(capabilities),
            capabilities,
            reason: null,
        };
    }

    _resolveActor(source) {
        if (!source)
            return null;

        return source.container ??
            source.actor ??
            source.button ??
            source._button ??
            source._menuButton ??
            source._indicator ??
            source.menu?.sourceActor ??
            source._menu?.sourceActor ??
            source.arcMenu?.sourceActor ??
            source;
    }

    _classify(capabilities) {
        if (capabilities.has('menu-toggle') ||
            capabilities.has('custom-menu-toggle'))
            return 'menu-forward';
        if (capabilities.has('activate') ||
            capabilities.has('direct-action') ||
            capabilities.has('click') ||
            capabilities.has('interaction-forward'))
            return 'activation-forward';
        if (capabilities.has('simple-visual'))
            return 'simple-visual';
        if (capabilities.has('cloneable'))
            return 'clone-only';

        return 'unsupported';
    }

    _hasIcon(actor) {
        return this._walk(actor).some(child => child instanceof St.Icon);
    }

    _hasLabel(actor) {
        return this._walk(actor).some(child => child instanceof St.Label);
    }

    _hasDirectAction(actor) {
        return DIRECT_ACTION_METHODS.some(method => typeof actor?.[method] === 'function');
    }

    _hasInteractiveActor(actor) {
        return this._walk(actor).some(child =>
            child?.reactive === true ||
            child?.can_focus === true ||
            child?.track_hover === true ||
            child instanceof St.Button ||
            typeof child?.activate === 'function' ||
            typeof child?.clicked === 'function' ||
            typeof child?.toggle === 'function' ||
            typeof child?.openMenu === 'function' ||
            typeof child?._onButtonPress === 'function' ||
            typeof child?._onClicked === 'function');
    }

    _looksLikePanelButton(actor) {
        const style = actor.get_style_class_name?.() ?? actor.style_class ?? '';
        return style.includes('panel-button');
    }

    _looksExternalIndicator(role, source, actor) {
        const needles = ['appindicator', 'kstatusnotifier', 'tray', 'indicator'];
        return [
            role,
            source?.constructor?.name,
            actor?.constructor?.name,
            actor?.get_style_class_name?.() ?? actor?.style_class,
        ].some(value => hasAny(value, needles));
    }

    _walk(root) {
        const result = [];
        const stack = [root];
        const visited = new Set();

        while (stack.length > 0) {
            const node = stack.shift();
            if (!node || visited.has(node))
                continue;

            visited.add(node);
            result.push(node);

            if (typeof node.get_children === 'function')
                stack.push(...node.get_children());
        }

        return result;
    }
}

const INDICATOR_RULES = [
    {
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
                gapAnchor: true,
                hideOnPrimaryMonitor: true,
                mainPanelHiddenMode: 'preserve-visible',
                mainPanelPaddingTarget: 'container',
                restoreMainPanelPaddingBeforeApply: true,
            },
            reason: null,
        }),
    },
    {
        match: descriptor => descriptor.role === 'appMenu',
        apply: descriptor => ({
            ...descriptor,
            kind: 'dedicated',
            implementation: 'appMenu',
            reason: null,
        }),
    },
    {
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
        match: descriptor => descriptor.role === 'aggregateMenu',
        apply: descriptor => ({
            ...descriptor,
            kind: 'hidden',
            reason: 'legacy-aggregate-menu-hidden',
        }),
    },
    {
        match: descriptor =>
            ['screenSharing', 'screenRecording', 'screencast'].includes(descriptor.role) &&
            (descriptor.capabilities.has('direct-action') ||
                descriptor.capabilities.has('click') ||
                descriptor.capabilities.has('interaction-forward')),
        apply: descriptor => ({
            ...descriptor,
            kind: 'activation-forward',
            capabilities: mergeCapabilities(descriptor, [
                'direct-action',
                'appearance-sync',
                'prefer-source-event',
                'track-empty-source',
            ]),
            layout: {
                mainPanelPaddingTarget: 'container',
                preserveMainPanelPadding: descriptor.role === 'screenRecording',
            },
        }),
    },
    {
        match: descriptor => descriptor.role === 'keyboard',
        apply: descriptor => ({
            ...descriptor,
            kind: 'menu-forward',
            layout: {
                ...(descriptor.layout ?? {}),
                mainPanelPaddingTarget: 'display-child',
            },
            capabilities: mergeCapabilities(descriptor, [
                'menu-toggle',
                'interaction-forward',
                'native-menu-position',
                'track-empty-source',
                'ignore-source-style',
                'ignore-source-visibility',
            ]),
        }),
    },
    {
        match: descriptor =>
            hasAny(descriptor.role, ['appindicator', 'kstatusnotifieritem']) ||
            hasAny(descriptor.source?.constructor?.name, ['appindicator', 'kstatusnotifieritem']),
        apply: descriptor => {
            if (descriptor.source)
                descriptor.source.menu ??= descriptor.source._menu ?? descriptor.source._indicator?.menu;
            return {
                ...descriptor,
                kind: 'menu-forward',
                capabilities: mergeCapabilities(descriptor, [
                    'menu-toggle',
                    'custom-menu-toggle',
                    'interaction-forward',
                ]),
                reason: 'override-appindicator-interaction',
            };
        },
    },
    {
        match: descriptor => ['places', 'gsconnect', 'drive-menu'].includes(descriptor.role),
        apply: descriptor => ({
            ...descriptor,
            kind: 'menu-forward',
            capabilities: mergeCapabilities(descriptor, ['menu-toggle', 'interaction-forward']),
            reason: 'override-menu-toggle',
        }),
    },
    {
        match: descriptor =>
            hasAny(descriptor.role, ['clipboard']) ||
            hasAny(descriptor.source?.constructor?.name, ['clipboard']),
        apply: descriptor => ({
            ...descriptor,
            kind: 'menu-forward',
            capabilities: mergeCapabilities(descriptor, ['menu-toggle', 'interaction-forward']),
            reason: 'override-clipboard-menu-toggle',
        }),
    },
    {
        match: descriptor =>
            hasAny(descriptor.role, ['caffeine']) ||
            hasAny(descriptor.source?.constructor?.name, ['caffeine']),
        apply: descriptor => {
            if (descriptor.source && typeof descriptor.source.toggle === 'function' && !descriptor.source.activate)
                descriptor.source.activate = () => descriptor.source.toggle();

            return {
                ...descriptor,
                kind: 'activation-forward',
                capabilities: mergeCapabilities(descriptor, [
                    'activate',
                    'click',
                    'interaction-forward',
                ]),
                reason: 'override-caffeine-toggle',
            };
        },
    },
    {
        match: descriptor =>
            hasAny(descriptor.role, ['arcmenu', 'applications']) ||
            hasAny(descriptor.source?.constructor?.name, ['arcmenu']),
        apply: descriptor => {
            if (descriptor.source && !descriptor.source.menu && typeof descriptor.source.arcMenu?.toggle === 'function')
                descriptor.source.menu = {toggle: () => descriptor.source.arcMenu.toggle()};

            return {
                ...descriptor,
                kind: 'menu-forward',
                capabilities: mergeCapabilities(descriptor, [
                    'menu-toggle',
                    'custom-menu-toggle',
                    'interaction-forward',
                ]),
                reason: 'override-activities-alt-menu-toggle',
            };
        },
    },
    {
        match: descriptor => hasAny(descriptor.role, ['inputmethod', 'a11y', 'dwellclick']),
        apply: descriptor => ({
            ...descriptor,
            kind: 'menu-forward',
            capabilities: mergeCapabilities(descriptor, ['menu-toggle', 'interaction-forward']),
            reason: 'override-input-a11y-menu-toggle',
        }),
    },
    {
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

class RuleRegistry {
    constructor(rules = INDICATOR_RULES) {
        this._rules = rules;
    }

    apply(descriptor) {
        for (const rule of this._rules) {
            if (rule.match(descriptor))
                return rule.apply(descriptor);
        }

        return descriptor;
    }
}

export class IndicatorRouter {
    constructor({rules = INDICATOR_RULES} = {}) {
        this._inspector = new IndicatorInspector();
        this._rules = new RuleRegistry(rules);
    }

    describe({role, source}) {
        return this._rules.apply(this._inspector.inspect({role, source}));
    }
}

let defaultRouter = null;

export function getIndicatorDescriptor({role, source}) {
    defaultRouter ??= new IndicatorRouter();
    return defaultRouter.describe({role, source});
}

export function isRoutableDescriptor(descriptor) {
    return descriptor.kind === 'dedicated' ||
        descriptor.kind === 'overview-forward' ||
        isMirroredDescriptor(descriptor);
}

export function isMirroredDescriptor(descriptor) {
    return [
        'menu-forward',
        'activation-forward',
        'simple-visual',
        'clone-only',
    ].includes(descriptor.kind);
}
