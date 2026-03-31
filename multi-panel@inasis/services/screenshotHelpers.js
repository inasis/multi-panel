/*
Copyright (C) 2014  spin83
Copyright (C) 2026  inasis

This program is free software; you can redistribute it and/or
modify it under the terms of the GNU General Public License
as published by the Free Software Foundation; either version 2
of the License, or (at your option) any later version.
*/

import St from 'gi://St';

export function emitClick(actor) {
    if (typeof actor?.clicked === 'function')
        actor.clicked(0);
    else if (typeof actor?.emit === 'function')
        actor.emit('clicked', 0);
}

export function setChecked(actor, checked) {
    if (typeof actor?.set_checked === 'function')
        actor.set_checked(checked);
    else if (actor?.checked !== undefined)
        actor.checked = checked;
}

export function getChecked(actor) {
    if (typeof actor?.get_checked === 'function')
        return actor.get_checked();

    return actor?.checked !== undefined ? actor.checked : false;
}

export function setPressedState(actor, pressed) {
    if (typeof actor?.set_pressed === 'function')
        actor.set_pressed(pressed);
    else if (typeof actor?.add_style_pseudo_class === 'function' &&
        typeof actor?.remove_style_pseudo_class === 'function')
        actor[pressed ? 'add_style_pseudo_class' : 'remove_style_pseudo_class']('active');
}

export function isPointerButton(actor, screenshotUI) {
    return actor === screenshotUI._showPointerButtonContainer ||
        actor === screenshotUI._showPointerButton;
}

export function isScreenshotClickableActor(actor, screenshotUI) {
    return actor instanceof St.Button ||
        actor?.constructor?.name === 'IconLabelButton' ||
        actor?.has_style_class_name?.('screenshot-ui-capture-button') ||
        actor === screenshotUI?._captureButton;
}

export function findClickableScreenshotActor(actor, screenshotUI, maxDepth = 10) {
    let currentActor = actor;

    for (let depth = 0; depth < maxDepth && currentActor; depth++) {
        if (isScreenshotClickableActor(currentActor, screenshotUI))
            return currentActor;

        currentActor = currentActor.get_parent?.();
    }

    return null;
}

export function forwardClickToToolbar(stageX, stageY, rect, runTimeout, button = 1) {
    const relX = stageX - rect.x;
    const relY = stageY - rect.y;
    const targetX = rect.toolbarX + relX;
    const targetY = rect.toolbarY + relY;

    const targetActor = global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, targetX, targetY);

    if (targetActor && targetActor !== global.stage) {
        if (typeof targetActor.emit === 'function')
            targetActor.emit('clicked');

        if (typeof targetActor.activate === 'function')
            targetActor.activate(null);

        return true;
    }

    return false;
}
