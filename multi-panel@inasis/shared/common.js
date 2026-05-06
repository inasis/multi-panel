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

import * as Config from 'resource:///org/gnome/shell/misc/config.js';

// Shell version for feature detection - centralized here and exported for other modules
const [major] = Config.PACKAGE_VERSION.split('.');
export const shellVersion = Number.parseInt(major);

const LOG_PREFIX = '[MultiPanel]';

export function debug(message, error = null) {
    if (!globalThis.MULTI_PANEL_DEBUG)
        return;

    console.debug(`${LOG_PREFIX} ${message}${error ? `: ${String(error)}` : ''}`);
}

export function warn(message, error = null) {
    console.warn(`${LOG_PREFIX} ${message}${error ? `: ${String(error)}` : ''}`);
}

export function error(message, error = null) {
    console.error(`${LOG_PREFIX} ${message}${error ? `: ${String(error)}` : ''}`);
}
