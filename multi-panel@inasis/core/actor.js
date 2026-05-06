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

import * as PanelSettings from './settings.js';

const disposedActors = new WeakSet();

export function isDisposedActor(actor) {
    if (!actor)
        return true;

    return disposedActors.has(actor);
}

export function isUsablePanel(panel) {
    if (!panel)
        return false;

    try {
        return !isDisposedActor(panel) && panel._isDestroying !== true;
    } catch (_e) {
        return false;
    }
}

export function markActorDisposed(actor) {
    if (actor)
        disposedActors.add(actor);
}

export function trackActorDispose(actor) {
    if (!actor?.connect)
        return;

    try {
        actor.connect('destroy', () => {
            disposedActors.add(actor);
        });
    } catch (_e) {
    }
}

export function getIndicatorContainer(indicator) {
    return indicator?.container ?? indicator ?? null;
}

export function getActorChildren(actor) {
    try {
        return actor?.get_children?.() ?? [];
    } catch (_e) {
        return [];
    }
}

export function removeActorFromParent(actor) {
    if (!actor || isDisposedActor(actor))
        return;

    try {
        const parent = actor?.get_parent?.();
        if (!parent || isDisposedActor(parent))
            return;

        // Parent may be disposed asynchronously while panel refresh runs.
        // Guarding and swallowing here prevents noisy GJS disposal warnings.
        if (actor.get_parent?.() === parent)
            parent.remove_child(actor);
    } catch (_e) {
    }
}

export function syncWidgetAppearance(target, source) {
    if (!target || !source || isDisposedActor(target) || isDisposedActor(source))
        return;

    try {
        target.visible = source.visible;
        target.opacity = source.opacity;
        target.reactive = source.reactive;

        const styleClass = source.get_style_class_name?.() ?? '';
        if (target.get_style_class_name?.() !== styleClass)
            target.set_style_class_name(styleClass);

        const style = PanelSettings.sanitizeInlineStyle(source.get_style?.() ?? null);
        if (target.get_style?.() !== style)
            target.set_style(style);
    } catch (_e) {
    }
}
