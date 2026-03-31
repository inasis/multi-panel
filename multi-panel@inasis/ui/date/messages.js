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
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';

import * as MessageList from 'resource:///org/gnome/shell/ui/messageList.js';
import * as DateMenu from 'resource:///org/gnome/shell/ui/dateMenu.js';
import * as Calendar from 'resource:///org/gnome/shell/ui/calendar.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import * as Common from '../../shared/common.js';
import { shellVersion } from '../../shared/common.js';
import { shellMain } from './state.js';

const AuxiliaryDoNotDisturbSwitch = GObject.registerClass(
    class AuxiliaryDoNotDisturbSwitch extends PopupMenu.Switch {
        _init() {
            this._settings = new Gio.Settings({
                schema_id: 'org.gnome.desktop.notifications',
            });

            super._init(this._settings.get_boolean('show-banners'));

            this._settings.bind(
                'show-banners',
                this,
                'state',
                Gio.SettingsBindFlags.INVERT_BOOLEAN
            );

            this.connect('destroy', () => {
                this._settings = null;
            });
        }
    });

const AuxiliaryNotificationPlaceholder = GObject.registerClass(
    class AuxiliaryNotificationPlaceholder extends St.BoxLayout {
        _init() {
            super._init({
                style_class: 'message-list-placeholder',
                vertical: true,
            });
            this._date = new Date();

            this._icon = new St.Icon({ icon_name: 'no-notifications-symbolic' });
            this.add_child(this._icon);

            this._label = new St.Label({ text: _('No Notifications') });
            this.add_child(this._label);
        }
    });

const AuxiliaryNotificationSection = (() => {
    const BaseClass = shellVersion >= 40 && MessageList.MessageListSection
        ? MessageList.MessageListSection
        : St.Widget;

    let AuxiliaryNotificationSection = class AuxiliaryNotificationSection extends BaseClass {
        _init() {
            super._init();

            this._sources = new Map();
            this._nUrgent = 0;

            this._sourceAddedId = shellMain.messageTray.connect(
                'source-added',
                this._sourceAdded.bind(this)
            );
            shellMain.messageTray.getSources().forEach(source => {
                this._sourceAdded(shellMain.messageTray, source);
            });
        }

        destroy() {
            shellMain.messageTray.disconnect(this._sourceAddedId);
            let source;
            let obj;
            for ([source, obj] of this._sources.entries())
                this._onSourceDestroy(source, obj);
            super.destroy();
        }

        _sourceAdded(_tray, _source) {
        }

        _onSourceDestroy(source, _obj) {
            this._sources.delete(source);
        }
    };

    if (Calendar.NotificationSection)
        Common.copyClass(Calendar.NotificationSection, AuxiliaryNotificationSection);
    return GObject.registerClass(AuxiliaryNotificationSection);
})();

export const AuxiliaryCalendarMessageList = (() => {
    let AuxiliaryCalendarMessageList = class AuxiliaryCalendarMessageList extends St.Widget {
        _initCustom() {
            super._init({
                style_class: 'message-list',
                layout_manager: new Clutter.BinLayout(),
                x_expand: true,
                y_expand: true,
            });

            this._sessionModeUpdatedId = 0;

            this._placeholder = new AuxiliaryNotificationPlaceholder();
            this.add_child(this._placeholder);

            const box = new St.BoxLayout({
                vertical: true,
                x_expand: true,
                y_expand: true,
            });
            this.add_child(box);

            this._scrollView = new St.ScrollView({
                style_class: 'vfade',
                overlay_scrollbars: true,
                x_expand: true,
                y_expand: true,
            });
            this._scrollView.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);
            box.add_child(this._scrollView);

            const hbox = new St.BoxLayout({ style_class: 'message-list-controls' });
            box.add_child(hbox);

            const dndLabel = new St.Label({
                text: _('Do Not Disturb'),
                y_align: Clutter.ActorAlign.CENTER,
            });
            hbox.add_child(dndLabel);

            this._dndSwitch = new AuxiliaryDoNotDisturbSwitch();
            this._dndButton = new St.Button({
                can_focus: true,
                toggle_mode: true,
                child: this._dndSwitch,
                label_actor: dndLabel,
            });

            this._dndSwitch.bind_property(
                'state',
                this._dndButton,
                'checked',
                GObject.BindingFlags.BIDIRECTIONAL | GObject.BindingFlags.SYNC_CREATE
            );

            hbox.add_child(this._dndButton);

            this._clearButton = new St.Button({
                style_class: 'message-list-clear-button button',
                label: _('Clear'),
                can_focus: true,
                x_expand: true,
                x_align: Clutter.ActorAlign.END,
            });
            this._clearButton.connect('clicked', () => {
                this._sectionList.get_children().forEach(section => section.clear());
            });
            hbox.add_child(this._clearButton);

            this._placeholder.bind_property(
                'visible',
                this._clearButton,
                'visible',
                GObject.BindingFlags.INVERT_BOOLEAN
            );

            this._sectionList = new St.BoxLayout({
                style_class: 'message-list-sections',
                vertical: true,
                x_expand: true,
                y_expand: true,
                y_align: Clutter.ActorAlign.START,
            });
            this._scrollView.add_child(this._sectionList);

            this._notificationSection = new AuxiliaryNotificationSection();
            this._addSection(this._notificationSection);

            this._sessionModeUpdatedId = shellMain.sessionMode.connect(
                'updated',
                this._sync.bind(this)
            );
        }

        destroy() {
            shellMain.sessionMode.disconnect(this._sessionModeUpdatedId);
            this._sessionModeUpdatedId = 0;
            super.destroy();
        }

        _sync() {
            if (this._sessionModeUpdatedId === 0)
                return;

            const sections = this._sectionList.get_children();
            const empty = sections.every(section => section.empty || !section.visible);
            this._placeholder.visible = empty;
        }
    };

    if (Calendar.CalendarMessageList)
        Common.copyClass(Calendar.CalendarMessageList, AuxiliaryCalendarMessageList);

    AuxiliaryCalendarMessageList.prototype._init = AuxiliaryCalendarMessageList.prototype._initCustom;
    AuxiliaryCalendarMessageList.prototype._addSection = function (section) {
        this._sectionList.add_child(section);
        section.connect('notify::empty', this._sync.bind(this));
        section.connect('notify::visible', this._sync.bind(this));
        section.connect('destroy', () => {
            this._sectionList.remove_child(section);
            this._sync();
        });
    };

    const RegisteredClass = GObject.registerClass(AuxiliaryCalendarMessageList);
    Common.patchAddActorMethod(RegisteredClass.prototype);

    const originalInit = RegisteredClass.prototype._init;
    RegisteredClass.prototype._init = function () {
        originalInit.call(this);
        if (this._sectionList) {
            const originalConnect = this._sectionList.connect.bind(this._sectionList);
            this._sectionList.connect = function (signal, callback) {
                if (signal === 'actor-added' || signal === 'actor-removed' ||
                    signal === 'child-added' || signal === 'child-removed')
                    return 0;

                return originalConnect(signal, callback);
            };
        }
    };

    return RegisteredClass;
})();

export const AuxiliaryMessagesIndicator = (() => {
    let AuxiliaryMessagesIndicator = class AuxiliaryMessagesIndicator extends St.Icon {
        _init() {
            super._init({
                icon_size: 16,
                visible: false,
                y_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });

            this._sources = [];
            this._count = 0;

            this._settings = new Gio.Settings({
                schema_id: 'org.gnome.desktop.notifications',
            });

            if (this._sync)
                this._settings.connect('changed::show-banners', this._sync.bind(this));

            this._sourceAddedId = shellMain.messageTray.connect(
                'source-added',
                this._onSourceAdded.bind(this)
            );
            this._sourceRemovedId = shellMain.messageTray.connect(
                'source-removed',
                this._onSourceRemoved.bind(this)
            );
            this._queueChangedId = shellMain.messageTray.connect(
                'queue-changed',
                this._updateCount.bind(this)
            );

            shellMain.messageTray.getSources().forEach(source => this._onSourceAdded(null, source));

            if (this._sync)
                this._sync();
            else
                this._updateVisibility();

            this.connect('destroy', () => {
                this._settings = null;
                shellMain.messageTray.disconnect(this._sourceAddedId);
                shellMain.messageTray.disconnect(this._sourceRemovedId);
                shellMain.messageTray.disconnect(this._queueChangedId);
                this._clearSourceConnections();
            });
        }

        _clearSourceConnections() {
            if (!this._sourceConnections)
                return;

            this._sourceConnections.forEach(({notifAddedId, notifRemovedId}, source) => {
                if (notifAddedId)
                    source.disconnect(notifAddedId);
                if (notifRemovedId)
                    source.disconnect(notifRemovedId);
            });
            this._sourceConnections.clear();
        }

        _trackSourceNotifications(source) {
            if (!source?.connect)
                return;

            const notifAddedId = source.connect('notification-added', this._updateCount.bind(this));
            const notifRemovedId = source.connect('notification-removed', this._updateCount.bind(this));

            if (!this._sourceConnections)
                this._sourceConnections = new Map();

            this._sourceConnections.set(source, { notifAddedId, notifRemovedId });
        }

        _untrackSourceNotifications(source) {
            if (!this._sourceConnections?.has(source))
                return;

            const {notifAddedId, notifRemovedId} = this._sourceConnections.get(source);
            if (notifAddedId)
                source.disconnect(notifAddedId);
            if (notifRemovedId)
                source.disconnect(notifRemovedId);
            this._sourceConnections.delete(source);
        }

        _onSourceAdded(_tray, source) {
            if (!this._sources || this._sources.includes(source))
                return;

            this._sources.push(source);
            this._trackSourceNotifications(source);
            this._updateCount();
        }

        _onSourceRemoved(_tray, source) {
            if (!this._sources)
                return;

            const index = this._sources.indexOf(source);
            if (index < 0)
                return;

            this._untrackSourceNotifications(source);
            this._sources.splice(index, 1);
            this._updateCount();
        }

        _updateCount() {
            if (!this._sources) {
                this._count = 0;
                this._updateVisibility();
                return;
            }

            this._count = this._sources.reduce((count, source) => count + source.unseenCount, 0);
            this._updateVisibility();
        }

        _updateVisibility() {
            if (!this._settings) {
                this.visible = this._count > 0;
                return;
            }

            const dndEnabled = !this._settings.get_boolean('show-banners');
            this.visible = this._count > 0 || dndEnabled;

            if (this.visible) {
                this.icon_name = dndEnabled
                    ? 'notifications-disabled-symbolic'
                    : 'message-indicator-symbolic';
            }
        }
    };

    if (DateMenu.MessagesIndicator)
        Common.copyClass(DateMenu.MessagesIndicator, AuxiliaryMessagesIndicator);
    return GObject.registerClass(AuxiliaryMessagesIndicator);
})();
