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

import { MultiPanelAppMenuButton, hasNativeAppMenuButton } from './appMenu.js';
import { AuxiliaryDateMenuButton } from './dateMenu.js';
import { AuxiliaryQuickSettings } from './quickSettings.js';

export { hasNativeAppMenuButton };

export const AUXILIARY_PANEL_ITEM_IMPLEMENTATIONS = {
    appMenu: MultiPanelAppMenuButton,
    dateMenu: AuxiliaryDateMenuButton,
    quickSettings: AuxiliaryQuickSettings,
};
