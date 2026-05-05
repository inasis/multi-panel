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

export class IndicatorInspector {
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
        if (this._hasSimpleVisual(actor))
            capabilities.add('simple-visual');
        if (this._hasIcon(actor))
            capabilities.add('icon');
        if (this._hasLabel(actor))
            capabilities.add('label');
        if (this._isCloneable(actor))
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

        return source.container ?? source;
    }

    _classify(capabilities) {
        if (capabilities.has('menu-toggle') ||
            capabilities.has('custom-menu-toggle'))
            return 'menu-forward';

        if (capabilities.has('activate') ||
            capabilities.has('direct-action') ||
            capabilities.has('click'))
            return 'activation-forward';

        if (capabilities.has('interaction-forward'))
            return 'activation-forward';

        if (capabilities.has('simple-visual'))
            return 'simple-visual';

        if (capabilities.has('cloneable'))
            return 'clone-only';

        return 'unsupported';
    }

    _hasSimpleVisual(actor) {
        return this._hasIcon(actor) || this._hasLabel(actor);
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
            typeof child?.toggle === 'function');
    }

    _isCloneable(actor) {
        return actor && typeof actor.get_parent === 'function';
    }

    _looksLikePanelButton(actor) {
        const style = actor.get_style_class_name?.() ?? actor.style_class ?? '';
        return style.includes('panel-button');
    }

    _looksExternalIndicator(role, source, actor) {
        const roleName = String(role ?? '').toLowerCase();
        const ctor = String(source?.constructor?.name ?? '').toLowerCase();
        const actorCtor = String(actor?.constructor?.name ?? '').toLowerCase();
        const style = String(actor?.get_style_class_name?.() ?? actor?.style_class ?? '').toLowerCase();

        return [
            roleName,
            ctor,
            actorCtor,
            style,
        ].some(value =>
            value.includes('appindicator') ||
            value.includes('kstatusnotifier') ||
            value.includes('tray') ||
            value.includes('indicator'));
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
