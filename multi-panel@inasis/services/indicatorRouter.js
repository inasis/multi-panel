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

import { IndicatorInspector } from './indicatorInspector.js';
import { DEFAULT_INDICATOR_RULES, RuleRegistry } from './indicatorRules.js';

export class IndicatorRouter {
    constructor({rules = DEFAULT_INDICATOR_RULES} = {}) {
        this._inspector = new IndicatorInspector();
        this._rules = new RuleRegistry(rules);
    }

    describe({role, source}) {
        return this._rules.apply(this._inspector.inspect({role, source}));
    }
}

let defaultRouter = null;

export function getIndicatorDescriptor({role, source}) {
    if (!defaultRouter)
        defaultRouter = new IndicatorRouter();

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
