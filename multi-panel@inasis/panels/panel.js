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
import Meta from 'gi://Meta';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Graphene from 'gi://Graphene';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as CtrlAltTab from 'resource:///org/gnome/shell/ui/ctrlAltTab.js';
import * as Layout from 'resource:///org/gnome/shell/ui/layout.js';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { MultiPanelAppMenuButton, hasNativeAppMenuButton } from '../indicators/mandatory/appMenu.js';
import { AuxiliaryDateMenuButton } from '../indicators/mandatory/dateMenu.js';
import { AuxiliaryQuickSettings } from '../indicators/mandatory/quickSettings.js';
import { installAuxiliaryPanelSupport } from './support.js';
import {
    getActorChildren,
    isDisposedActor,
    isUsablePanel,
    markActorDisposed,
    syncWidgetAppearance,
    trackActorDispose,
} from '../core/actor.js';
import * as PanelSettings from '../core/settings.js';

const AUXILIARY_PANEL_ITEM_IMPLEMENTATIONS = {
    appMenu: MultiPanelAppMenuButton,
    dateMenu: AuxiliaryDateMenuButton,
    quickSettings: AuxiliaryQuickSettings,
};

export const SHOW_ACTIVITIES_ID = PanelSettings.SHOW_ACTIVITIES_ID;
export const SHOW_APP_MENU_ID = PanelSettings.SHOW_APP_MENU_ID;
export const SHOW_DATE_TIME_ID = PanelSettings.SHOW_DATE_TIME_ID;
export const AVAILABLE_INDICATORS_ID = PanelSettings.AVAILABLE_INDICATORS_ID;
export const TRANSFER_INDICATORS_ID = PanelSettings.TRANSFER_INDICATORS_ID;
export const INDICATOR_ORDER_ID = PanelSettings.INDICATOR_ORDER_ID;
export const HIDDEN_INDICATORS_ID = PanelSettings.HIDDEN_INDICATORS_ID;
export const INDICATOR_PADDING_ID = PanelSettings.INDICATOR_PADDING_ID;
export const INDICATOR_GAP_ID = PanelSettings.INDICATOR_GAP_ID;
export const QUICK_SETTINGS_GAP_ID = PanelSettings.QUICK_SETTINGS_GAP_ID;
export const PANEL_LEFT_PADDING_ID = PanelSettings.PANEL_LEFT_PADDING_ID;
export const PANEL_RIGHT_PADDING_ID = PanelSettings.PANEL_RIGHT_PADDING_ID;
export const PANEL_HEIGHT_ID = PanelSettings.PANEL_HEIGHT_ID;
export const EXCLUDE_INDICATORS_ID = PanelSettings.EXCLUDE_INDICATORS_ID;

const AuxiliaryPanel = GObject.registerClass(
class AuxiliaryPanel extends St.Widget {
    _init(monitorIndex, panelBox, settings) {
        if (!panelBox)
            throw new Error('panelBox parameter is required but was undefined');

        super._init({
            name: 'panel',
            reactive: true,
            style_class: 'panel',
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.FILL,
        });

        this.monitorIndex = monitorIndex;
        this._settings = settings;
        this._panelBoxWrapper = panelBox;
        this._panelItemImplementations = AUXILIARY_PANEL_ITEM_IMPLEMENTATIONS;
        this._isDestroying = false;
        trackActorDispose(this);

        this.set_offscreen_redirect(Clutter.OffscreenRedirect.ALWAYS);

        this._sessionStyle = null;
        this.statusArea = {};
        this.menuManager = new PopupMenu.PopupMenuManager(this);

        this._leftBox = new St.BoxLayout({
            name: 'panelLeft',
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.FILL,
        });
        trackActorDispose(this._leftBox);
        this.add_child(this._leftBox);

        this._centerBox = new St.BoxLayout({
            name: 'panelCenter',
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.FILL,
        });
        trackActorDispose(this._centerBox);
        this.add_child(this._centerBox);

        this._centerBin = new St.BoxLayout({
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.FILL,
        });
        trackActorDispose(this._centerBin);
        this._centerBox.add_child(this._centerBin);

        this._rightBox = new St.BoxLayout({
            name: 'panelRight',
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.FILL,
        });
        trackActorDispose(this._rightBox);
        this.add_child(this._rightBox);

        this._capturedEventId = this.connect('captured-event', (_actor, event) => {
            return this._onCapturedPanelEvent(event);
        });

        this._showingId = Main.overview.connect('showing', () => {
            this.add_style_pseudo_class('overview');
        });
        this._hidingId = Main.overview.connect('hiding', () => {
            this.remove_style_pseudo_class('overview');
        });

        panelBox.panelBox.add_child(this);
        Main.ctrlAltTabManager.addGroup(this, _("Top Bar"), 'focus-top-bar-symbolic',
            { sortGroup: CtrlAltTab.SortGroup.TOP });

        this._updatedId = Main.sessionMode.connect('updated', this._updatePanel.bind(this));
        this._workareasChangedId = global.display.connect('workareas-changed', () => {
            if (!isUsablePanel(this))
                return;

            try {
                this.queue_relayout();
            } catch (_e) {
            }
        });

        this._showActivitiesId = this._settings.connect(
            'changed::' + SHOW_ACTIVITIES_ID,
            this._showActivities.bind(this)
        );
        this._showActivities();

        this._showAppMenuId = this._settings.connect(
            'changed::' + SHOW_APP_MENU_ID,
            this._showAppMenu.bind(this)
        );
        this._showAppMenu();

        this._showDateTimeId = this._settings.connect(
            'changed::' + SHOW_DATE_TIME_ID,
            this._showDateTime.bind(this)
        );
        this._showDateTime();

        this._hiddenIndicatorsId = this._settings.connect(
            'changed::' + HIDDEN_INDICATORS_ID,
            this._updatePanel.bind(this)
        );

        this._indicatorPaddingId = this._settings.connect(
            'changed::' + INDICATOR_PADDING_ID,
            this._applyIndicatorPaddingToAll.bind(this)
        );
        this._indicatorGapId = this._settings.connect(
            'changed::' + INDICATOR_GAP_ID,
            this._applyIndicatorGap.bind(this)
        );
        this._quickSettingsGapId = this._settings.connect(
            'changed::' + QUICK_SETTINGS_GAP_ID,
            this._updatePanel.bind(this)
        );
        this._panelLeftPaddingId = this._settings.connect(
            'changed::' + PANEL_LEFT_PADDING_ID,
            this._updatePanel.bind(this)
        );
        this._panelRightPaddingId = this._settings.connect(
            'changed::' + PANEL_RIGHT_PADDING_ID,
            this._updatePanel.bind(this)
        );
        this._panelHeightId = this._settings.connect(
            'changed::' + PANEL_HEIGHT_ID,
            this._updatePanel.bind(this)
        );

        this._startExtensionWatcher();
        this._startAppearanceSync();
        this._syncPanelAppearance();
    }

    destroy() {
        this._isDestroying = true;
        markActorDisposed(this);

        if (this._capturedEventId) {
            this.disconnect(this._capturedEventId);
            this._capturedEventId = null;
        }

        if (this._extensionStateChangedId) {
            Main.extensionManager.disconnect(this._extensionStateChangedId);
            this._extensionStateChangedId = null;
        }
        if (this._initialCheckTimeouts) {
            for (const timeoutId of this._initialCheckTimeouts)
                GLib.source_remove(timeoutId);
            this._initialCheckTimeouts = null;
        }
        if (this._extensionUpdateTimeoutId) {
            GLib.source_remove(this._extensionUpdateTimeoutId);
            this._extensionUpdateTimeoutId = null;
        }
        if (this._appearanceSyncId) {
            GLib.source_remove(this._appearanceSyncId);
            this._appearanceSyncId = null;
        }

        if (this._workareasChangedId) {
            global.display.disconnect(this._workareasChangedId);
            this._workareasChangedId = null;
        }
        if (this._showingId) {
            Main.overview.disconnect(this._showingId);
            this._showingId = null;
        }
        if (this._hidingId) {
            Main.overview.disconnect(this._hidingId);
            this._hidingId = null;
        }

        for (const id of [
            '_showActivitiesId',
            '_showAppMenuId',
            '_showDateTimeId',
            '_hiddenIndicatorsId',
            '_indicatorPaddingId',
            '_indicatorGapId',
            '_quickSettingsGapId',
            '_panelLeftPaddingId',
            '_panelRightPaddingId',
            '_panelHeightId',
        ]) {
            if (this[id]) {
                this._settings.disconnect(this[id]);
                this[id] = null;
            }
        }

        for (const actor of [this._leftBox, this._centerBox, this._centerBin, this._rightBox]) {
            if (!actor)
                continue;
            markActorDisposed(actor);
        }

        this._restoreAllIndicatorPadding();
        this._restoreIndicatorGap();

        Main.ctrlAltTabManager.removeGroup(this);

        if (this._updatedId) {
            Main.sessionMode.disconnect(this._updatedId);
            this._updatedId = null;
        }

        this._leftBox = null;
        this._centerBox = null;
        this._centerBin = null;
        this._rightBox = null;
        this._panelBoxWrapper = null;

        super.destroy();
    }

    _destroyStatusIndicator(role) {
        const indicator = this.statusArea[role];
        if (!indicator)
            return;

        if (indicator.menu)
            this.menuManager.removeMenu(indicator.menu);

        indicator.destroy();
        delete this.statusArea[role];
    }

    _togglePanelIndicator(role, enabled, createIndicator) {
        if (enabled) {
            if (!this.statusArea[role]) {
                const indicator = createIndicator();
                if (indicator)
                    this._addToPanelBox(role, indicator, 0, this._getPanelBoxForRole(role));
            }

            if (this.statusArea[role])
                this.statusArea[role].visible = true;
        } else {
            this._destroyStatusIndicator(role);
        }

        this._reorderBoxesByIndicatorOrder();
    }

    _showActivities() {
        const role = 'activities';

        if (this.monitorIndex === Main.layoutManager.primaryIndex) {
            this._destroyStatusIndicator(role);
            return;
        }

        this._togglePanelIndicator(
            role,
            this._settings.get_boolean(SHOW_ACTIVITIES_ID),
            () => this._ensureIndicator(role)
        );
    }

    _showDateTime() {
        const role = 'dateMenu';
        this._togglePanelIndicator(
            role,
            this._settings.get_boolean(SHOW_DATE_TIME_ID),
            () => this._ensureIndicator(role)
        );
    }

    _showAppMenu() {
        const role = 'appMenu';

        if (!hasNativeAppMenuButton()) {
            this._destroyStatusIndicator(role);
            return;
        }

        this._togglePanelIndicator(
            role,
            this._settings.get_boolean(SHOW_APP_MENU_ID),
            () => this._ensureIndicator(role)
        );
    }

    vfunc_get_preferred_width(forHeight) {
        if (Main.layoutManager.monitors.length > this.monitorIndex)
            return [0, Main.layoutManager.monitors[this.monitorIndex].width];

        return [0, 0];
    }

    vfunc_allocate(box) {
        this.set_allocation(box);

        const themeNode = this.get_theme_node();
        const contentBox = themeNode.get_content_box(box);
        const allocWidth = contentBox.get_width();

        const [leftMinWidth, leftNatWidth] = this._leftBox.get_preferred_width(-1);
        const [centerMinWidth, centerNatWidth] = this._centerBox.get_preferred_width(-1);
        const [rightMinWidth, rightNatWidth] = this._rightBox.get_preferred_width(-1);

        const sideWidth = Math.max(leftNatWidth, rightNatWidth);

        let leftWidth, centerWidth, rightWidth;

        if (sideWidth * 2 + centerNatWidth > allocWidth) {
            leftWidth = Math.min(leftNatWidth, Math.floor(allocWidth * 0.33));
            rightWidth = Math.min(rightNatWidth, Math.floor(allocWidth * 0.33));
            centerWidth = Math.max(centerMinWidth, allocWidth - leftWidth - rightWidth);
        } else {
            leftWidth = sideWidth;
            rightWidth = sideWidth;
            centerWidth = allocWidth - leftWidth - rightWidth;
        }

        const leftChildBox = new Clutter.ActorBox();
        leftChildBox.x1 = contentBox.x1;
        leftChildBox.y1 = contentBox.y1;
        leftChildBox.x2 = contentBox.x1 + leftWidth;
        leftChildBox.y2 = contentBox.y2;
        this._leftBox.allocate(leftChildBox);
        this._leftBox.clip_to_allocation = true;

        const rightChildBox = new Clutter.ActorBox();
        rightChildBox.x1 = contentBox.x2 - rightWidth;
        rightChildBox.y1 = contentBox.y1;
        rightChildBox.x2 = contentBox.x2;
        rightChildBox.y2 = contentBox.y2;
        this._rightBox.allocate(rightChildBox);
        this._rightBox.clip_to_allocation = true;

        const centerChildBox = new Clutter.ActorBox();
        centerChildBox.x1 = leftChildBox.x2;
        centerChildBox.y1 = contentBox.y1;
        centerChildBox.x2 = rightChildBox.x1;
        centerChildBox.y2 = contentBox.y2;
        this._centerBox.allocate(centerChildBox);
        this._centerBox.clip_to_allocation = false;
    }

    _onCapturedPanelEvent(event) {
        let type;

        try {
            type = event.type();
        } catch (_e) {
            return Clutter.EVENT_PROPAGATE;
        }

        if (type !== Clutter.EventType.BUTTON_PRESS &&
            type !== Clutter.EventType.TOUCH_BEGIN)
            return Clutter.EVENT_PROPAGATE;

        if (type === Clutter.EventType.BUTTON_PRESS && event.get_button() !== 1)
            return Clutter.EVENT_PROPAGATE;

        if (this._tryDragWindow(event))
            return Clutter.EVENT_STOP;

        return Clutter.EVENT_PROPAGATE;
    }

    _getDraggableWindowForPosition(stageX) {
        const workspace = global.workspace_manager.get_active_workspace();
        const windows = workspace.list_windows();
        const stackedWindows = global.display.sort_windows_by_stacking(windows).reverse();

        return stackedWindows.find(metaWindow => {
            if (metaWindow.get_monitor() !== this.monitorIndex)
                return false;

            if (!metaWindow.showing_on_its_workspace())
                return false;

            if (metaWindow.get_window_type() === Meta.WindowType.DESKTOP)
                return false;

            if (metaWindow.skip_taskbar)
                return false;

            if (!metaWindow.maximized_vertically)
                return false;

            const rect = metaWindow.get_frame_rect();

            return stageX >= rect.x && stageX <= rect.x + rect.width;
        });
    }

    _tryDragWindowViaMainPanel(event) {
        if (typeof Main.panel?._tryDragWindow !== 'function')
            return false;

        try {
            return Main.panel._tryDragWindow.call(this, event) === Clutter.EVENT_STOP;
        } catch (_e) {
            return false;
        }
    }

    _eventTargetsPanel(event) {
        try {
            return global.stage.get_event_actor(event) === this;
        } catch (_e) {
            return false;
        }
    }

    _tryBeginWindowDrag(metaWindow, event, type, stageX, stageY) {
        const grabOp = Meta.GrabOp?.MOVING ?? Meta.GrabOp?.MOVE ?? null;
        if (grabOp === null)
            return false;

        const positionHint = new Graphene.Point({x: stageX, y: stageY});

        if (typeof metaWindow.begin_grab_op === 'function') {
            try {
                const backend = global.stage.get_context?.().get_backend?.();
                const sprite = backend?.get_sprite?.(global.stage, event) ?? null;

                if (sprite && metaWindow.begin_grab_op(
                    grabOp,
                    sprite,
                    event.get_time?.() ?? 0,
                    positionHint))
                    return true;
            } catch (_e) {
            }

            try {
                if (metaWindow.begin_grab_op(
                    grabOp,
                    event.get_device?.() ?? null,
                    event.get_event_sequence?.() ?? null,
                    event.get_time?.() ?? 0,
                    positionHint))
                    return true;
            } catch (_e) {
            }
        }

        if (typeof global.display?.begin_grab_op === 'function') {
            try {
                return !!global.display.begin_grab_op(
                    metaWindow,
                    grabOp,
                    false,
                    true,
                    type === Clutter.EventType.BUTTON_PRESS ? event.get_button() : -1,
                    event.get_state?.() ?? 0,
                    event.get_time?.() ?? 0,
                    stageX,
                    stageY
                );
            } catch (_e) {
            }
        }

        return false;
    }

    _tryDragWindowFallback(event) {
        let type;
        let stageX;
        let stageY;

        try {
            type = event.type();

            if (type !== Clutter.EventType.BUTTON_PRESS &&
                type !== Clutter.EventType.TOUCH_BEGIN)
                return false;

            if (type === Clutter.EventType.BUTTON_PRESS && event.get_button() !== 1)
                return false;

            [stageX, stageY] = event.get_coords?.() ?? [0, 0];
        } catch (_e) {
            return false;
        }

        if (Main.modalCount > 0 || !this._eventTargetsPanel(event))
            return false;

        const draggableWindow = this._getDraggableWindowForPosition(stageX);
        if (!draggableWindow)
            return false;

        return this._tryBeginWindowDrag(draggableWindow, event, type, stageX, stageY);
    }

    _tryDragWindow(event) {
        return this._tryDragWindowViaMainPanel(event) || this._tryDragWindowFallback(event);
    }

    vfunc_button_press_event(event) {
        if (this._tryDragWindow(event))
            return Clutter.EVENT_STOP;

        return Clutter.EVENT_PROPAGATE;
    }
});

installAuxiliaryPanelSupport(AuxiliaryPanel.prototype);

export { AuxiliaryPanel };
