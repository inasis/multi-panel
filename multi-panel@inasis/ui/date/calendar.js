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
import Gio from 'gi://Gio';
import Shell from 'gi://Shell';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';

import * as DateMenu from 'resource:///org/gnome/shell/ui/dateMenu.js';
import * as Calendar from 'resource:///org/gnome/shell/ui/calendar.js';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import * as Common from '../../shared/common.js';
import { shellVersion } from '../../shared/common.js';

export const AuxiliaryTodayButton = GObject.registerClass(
    class AuxiliaryTodayButton extends St.Button {
        _init(calendar) {
            super._init({
                style_class: 'datemenu-today-button',
                x_expand: true,
                x_align: Clutter.ActorAlign.START,
                can_focus: true,
            });

            const hbox = new St.BoxLayout({ vertical: true });
            this.add_child(hbox);

            this._dayLabel = new St.Label({
                style_class: 'day-label',
                x_align: Clutter.ActorAlign.START,
            });
            hbox.add_child(this._dayLabel);

            this._dateLabel = new St.Label({ style_class: 'date-label' });
            hbox.add_child(this._dateLabel);

            this._calendar = calendar;
            this._calendar.connect('selected-date-changed', (_calendar, datetime) => {
                this.reactive = !DateMenu._isToday(DateMenu._gDateTimeToDate(datetime));
            });
        }

        vfunc_clicked() {
            this._calendar.setDate(new Date(), false);
        }

        setDate(date) {
            const weekdayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'long' });
            const longDateFmt = new Intl.DateTimeFormat(undefined, {
                year: 'numeric', month: 'long', day: 'numeric',
            });
            const dayText = weekdayFmt.format(date);
            const dateText = longDateFmt.format(date);
            this._dayLabel.set_text(dayText);
            this._dateLabel.set_text(dateText);
            this.accessible_name = `${dayText} ${dateText}`;
        }
    });

export const AuxiliaryCalendar = (() => {
    let AuxiliaryCalendar = class AuxiliaryCalendar extends St.Widget {
        _init() {
            try {
                Calendar.Calendar.prototype._init.call(this);
                this.connect('destroy', this._onDestroy.bind(this));
                return;
            } catch (_e) {
            }

            this._weekStart = Shell.util_get_week_start();
            this._settings = new Gio.Settings({ schema_id: 'org.gnome.desktop.calendar' });

            if (shellVersion >= 40 && Calendar.SHOW_WEEKDATE_KEY) {
                this._showWeekdateKeyId = this._settings.connect(
                    `changed::${Calendar.SHOW_WEEKDATE_KEY}`,
                    this._onSettingsChange.bind(this)
                );
                this._useWeekdate = this._settings.get_boolean(Calendar.SHOW_WEEKDATE_KEY);
            } else {
                this._showWeekdateKeyId = 0;
                this._useWeekdate = false;
            }

            this._headerFormatWithoutYear = _('%OB');
            this._headerFormat = _('%OB %Y');
            this._selectedDate = new Date();
            this._shouldDateGrabFocus = false;

            super._init({
                style_class: 'calendar',
                layout_manager: new Clutter.GridLayout(),
                reactive: true,
            });

            this._buildHeader();
        }

        destroy() {
            this._settings.disconnect(this._showWeekdateKeyId);
            super.destroy();
        }
    };

    Common.copyClass(Calendar.Calendar, AuxiliaryCalendar);
    return GObject.registerClass({
        Signals: { 'selected-date-changed': { param_types: [GLib.DateTime.$gtype] } },
    }, AuxiliaryCalendar);
})();

export const AuxiliaryEventsSection = (() => {
    let AuxiliaryEventsSection = class AuxiliaryEventsSection extends St.Button {
        _init() {
            super._init({
                style_class: 'events-button',
                can_focus: true,
                x_expand: true,
                child: new St.BoxLayout({
                    style_class: 'events-box',
                    vertical: true,
                    x_expand: true,
                }),
            });

            this._startDate = null;
            this._endDate = null;
            this._eventSource = null;
            this._calendarApp = null;

            this._title = new St.Label({ style_class: 'events-title' });
            this.child.add_child(this._title);

            this._eventsList = new St.BoxLayout({
                style_class: 'events-list',
                vertical: true,
                x_expand: true,
            });
            this.child.add_child(this._eventsList);

            this._appSys = Shell.AppSystem.get_default();
            this._appInstalledChangedId = this._appSys.connect(
                'installed-changed',
                this._appInstalledChanged.bind(this)
            );
            this._appInstalledChanged();
            this._appInstalledChanged();
        }

        destroy() {
            this._appSys.disconnect(this._appInstalledChangedId);
            super.destroy();
        }

        _appInstalledChanged() {
            this._calendarApp = this._appSys.lookup_app('org.gnome.Calendar.desktop') ||
                this._appSys.lookup_app('evolution.desktop') ||
                this._appSys.lookup_app('gnome-calendar.desktop');

            if (this._calendarApp)
                this.visible = true;
        }

        setEventSource(eventSource) {
            this._eventSource = eventSource;
        }

        setDate(date) {
            this._startDate = date;
        }
    };

    const EventsBase = DateMenu.EventsSection ?? null;
    if (EventsBase)
        Common.copyClass(EventsBase, AuxiliaryEventsSection);

    return GObject.registerClass(AuxiliaryEventsSection);
})();
