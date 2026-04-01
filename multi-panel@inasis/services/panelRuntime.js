/*
Copyright (C) 2014  spin83
Copyright (C) 2026  inasis

This program is free software; you can redistribute it and/or
modify it under the terms of the GNU General Public License
as published by the Free Software Foundation; either version 2
of the License, or (at your option) any later version.
*/

let _panelRegistryRef = null;

export function setPanelRegistryRef(panelRegistry) {
    _panelRegistryRef = panelRegistry;
}

export function getPanelRegistry() {
    return _panelRegistryRef;
}

export function isDisposedActor(actor) {
    if (!actor)
        return true;

    if (actor._mmDisposed === true)
        return true;

    try {
        void actor.visible;
        return false;
    } catch (_e) {
        return true;
    }
}

export function trackActorDispose(actor) {
    if (!actor?.connect)
        return;

    actor._mmDisposed = false;
    actor.connect('destroy', () => {
        actor._mmDisposed = true;
    });
}

export function disconnectSignal(source, signalId) {
    if (!source || !signalId)
        return;

    try {
        source.disconnect(signalId);
    } catch (_e) {
    }
}

export function removeActorFromParent(actor) {
    try {
        if (actor?.get_parent())
            actor.get_parent().remove_child(actor);
    } catch (_e) {
    }
}

export function getMonitorId(index, monitor) {
    return `i${index}x${monitor.x}y${monitor.y}w${monitor.width}h${monitor.height}`;
}
