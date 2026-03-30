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

import * as Utils from './utils.js';

// Shell version for feature detection - centralized here and exported for other modules
export const shellVersion = Utils.SHELL_VERSION;

function hasAddChildMethod(prototype) {
    return !!(prototype?.add_child || Object.getPrototypeOf(prototype)?.add_child);
}

export function patchAddActorMethod(prototype) {
    if (prototype.add_actor || !hasAddChildMethod(prototype))
        return;

    prototype.add_actor = function (actor) {
        return this.add_child(actor);
    };
}

export function copyClass(s, d) {
    if (!s)
        return;

    const propertyNames = Reflect.ownKeys(s.prototype)
        .filter(pName => typeof pName !== 'symbol')
        .filter(pName => pName !== 'prototype' && pName !== 'constructor')
        .filter(pName => !Object.prototype.hasOwnProperty.call(d.prototype, pName));

    propertyNames.forEach(pName => {
        const pDesc = Reflect.getOwnPropertyDescriptor(s.prototype, pName);
        if (typeof pDesc === 'object')
            Reflect.defineProperty(d.prototype, pName, pDesc);
    });

    patchAddActorMethod(d.prototype);
}
