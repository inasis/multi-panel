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

import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GnomeDesktop from 'gi://GnomeDesktop';
import Pango from 'gi://Pango';
import GObject from 'gi://GObject';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as DateMenu from 'resource:///org/gnome/shell/ui/dateMenu.js';

import * as Common from '../../shared/common.js';
import { shellVersion } from '../../shared/common.js';
import { shellMain } from './state.js';
import {
    AuxiliaryCalendar,
    AuxiliaryEventsSection,
    AuxiliaryTodayButton,
} from './calendar.js';
import {
    AuxiliaryCalendarMessageList,
    AuxiliaryMessagesIndicator,
} from './messages.js';

export const AuxiliaryDateMenuButton = (() => {
    let AuxiliaryDateMenuButton = class AuxiliaryDateMenuButton extends PanelMenu.Button {
        _init() {
            let hbox;
            let vbox;

            super._init(0.5);

            this._clockDisplay = new St.Label({
                style_class: 'clock',
                y_align: Clutter.ActorAlign.CENTER,
            });
            this._clockDisplay.clutter_text.y_align = Clutter.ActorAlign.CENTER;
            this._clockDisplay.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;

            this._indicator = new AuxiliaryMessagesIndicator();

            const indicatorPad = new St.Widget();
            this._indicator.bind_property(
                'visible',
                indicatorPad,
                'visible',
                GObject.BindingFlags.SYNC_CREATE
            );
            indicatorPad.add_constraint(new Clutter.BindConstraint({
                source: this._indicator,
                coordinate: Clutter.BindCoordinate.SIZE,
            }));

            const box = new St.BoxLayout({
                style_class: 'clock-display-box',
                visible: true,
            });
            box.add_child(indicatorPad);
            box.add_child(this._clockDisplay);
            box.add_child(this._indicator);

            this.label_actor = this._clockDisplay;
            this.add_child(box);
            this.add_style_class_name('panel-button');
            this._clockDisplay?.add_style_class_name?.('clock-display');

            const mainBtn = shellMain?.panel?.statusArea
                ? shellMain.panel.statusArea.dateMenu
                : null;
            if (mainBtn) {
                const btnCls = mainBtn.get_style_class_name?.();
                if (btnCls)
                    this.set_style_class_name(btnCls);

                const menuCls = mainBtn.menu?.box?.get_style_class_name?.();
                if (menuCls)
                    this.menu?.box?.set_style_class_name?.(menuCls);
            }

            this.visible = true;
            this.show();
            box.show();
            this._clockDisplay.show();

            let layout;
            if (shellVersion >= 40 && DateMenu.FreezableBinLayout) {
                layout = new DateMenu.FreezableBinLayout();
            } else {
                layout = new Clutter.BinLayout();
                Object.defineProperty(layout, 'frozen', {
                    configurable: true,
                    enumerable: false,
                    get() { return false; },
                    set(_value) {},
                });
            }

            const bin = new St.Widget({ layout_manager: layout });
            bin._delegate = this;
            this.menu.box.add_child(bin);

            hbox = new St.BoxLayout({ name: 'calendarArea' });
            bin.add_child(hbox);

            this._calendar = new AuxiliaryCalendar();
            this._calendar.connect('selected-date-changed', (_calendar, datetime) => {
                const date = DateMenu._gDateTimeToDate(datetime);
                layout.frozen = !DateMenu._isToday(date);
                this._eventsItem.setDate(date);
            });
            this._date = new AuxiliaryTodayButton(this._calendar);

            this.menu.connect('open-state-changed', (_menu, isOpen) => {
                if (!isOpen)
                    return;

                const now = new Date();
                this._calendar.setDate(now);
                this._date.setDate(now);
                this._eventsItem.setDate(now);
            });

            this._messageList = new AuxiliaryCalendarMessageList();
            hbox.add_child(this._messageList);

            const boxLayout = new Clutter.BoxLayout({
                orientation: Clutter.Orientation.VERTICAL,
            });
            vbox = new St.Widget({
                style_class: 'datemenu-calendar-column',
                layout_manager: boxLayout,
            });
            hbox.add_child(vbox);

            vbox.add_child(this._date);
            vbox.add_child(this._calendar);

            this._displaysSection = new St.ScrollView({
                style_class: 'datemenu-displays-section vfade',
                x_expand: true,
                overlay_scrollbars: true,
            });
            this._displaysSection.set_policy(St.PolicyType.NEVER, St.PolicyType.EXTERNAL);
            vbox.add_child(this._displaysSection);

            const displaysBox = new St.BoxLayout({
                vertical: true,
                x_expand: true,
                style_class: 'datemenu-displays-box',
            });
            this._displaysSection.add_child(displaysBox);

            if (DateMenu.WorldClocksSection) {
                this._clocksItem = new DateMenu.WorldClocksSection();
                displaysBox.add_child(this._clocksItem);
            }

            if (DateMenu.WeatherSection) {
                this._weatherItem = new DateMenu.WeatherSection();
                displaysBox.add_child(this._weatherItem);
            }

            this._eventsItem = new AuxiliaryEventsSection();
            displaysBox.add_child(this._eventsItem);

            this._clock = new GnomeDesktop.WallClock();
            this._clock.bind_property(
                'clock',
                this._clockDisplay,
                'text',
                GObject.BindingFlags.SYNC_CREATE
            );
            this._clockNotifyTimezoneId = this._clock.connect(
                'notify::timezone',
                this._updateTimeZone.bind(this)
            );

            this._sessionModeUpdatedId = shellMain.sessionMode.connect(
                'updated',
                this._sessionUpdated.bind(this)
            );
            this._sessionUpdated();
        }

        destroy() {
            shellMain.sessionMode.disconnect(this._sessionModeUpdatedId);
            this._clock.disconnect(this._clockNotifyTimezoneId);

            this._clocksItem?.destroy();
            this._weatherItem?.destroy();

            super.destroy();
        }

        _updateTimeZone() {
            if (!this._calendar)
                return;
        }

        _sessionUpdated() {
            if (!this._displaysSection)
                return;
        }
    };

    const RegisteredClass = GObject.registerClass(AuxiliaryDateMenuButton);
    Common.patchAddActorMethod(RegisteredClass.prototype);
    return RegisteredClass;
})();
