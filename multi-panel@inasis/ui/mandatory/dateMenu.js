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

import GObject from 'gi://GObject';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as DateMenu from 'resource:///org/gnome/shell/ui/dateMenu.js';

import * as Common from '../../shared/common.js';

const NativeAuxiliaryDateMenuButton = class NativeAuxiliaryDateMenuButton extends DateMenu.DateMenuButton {
    _init() {
        super._init();

        const mainButton = Main.panel.statusArea?.dateMenu ?? null;
        if (mainButton) {
            const buttonClass = mainButton.get_style_class_name?.();
            if (buttonClass)
                this.set_style_class_name(buttonClass);

            const menuClass = mainButton.menu?.box?.get_style_class_name?.();
            if (menuClass)
                this.menu?.box?.set_style_class_name?.(menuClass);
        }

        this.visible = true;
        this.show();
    }
};

export const AuxiliaryDateMenuButton = GObject.registerClass(NativeAuxiliaryDateMenuButton);
Common.patchAddActorMethod(AuxiliaryDateMenuButton.prototype);
