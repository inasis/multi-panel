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

import St from 'gi://St';
import Shell from 'gi://Shell';
import Meta from 'gi://Meta';
import Atk from 'gi://Atk';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as Panel from 'resource:///org/gnome/shell/ui/panel.js';
import * as CtrlAltTab from 'resource:///org/gnome/shell/ui/ctrlAltTab.js';
import * as Layout from 'resource:///org/gnome/shell/ui/layout.js';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import * as MMCalendar from './mmcalendar.js';
import * as Constants from './mmPanelConstants.js';
import { StatusIndicatorsController } from './statusIndicatorsController.js';
import { MirroredIndicatorButton } from './mirroredIndicatorButton.js';

MMCalendar.setMainRef(Main);

// Re-export for backward compatibility
export const setMMPanelArrayRef = Constants.setMMPanelArrayRef;
export const SHOW_ACTIVITIES_ID = Constants.SHOW_ACTIVITIES_ID;
export const SHOW_APP_MENU_ID = Constants.SHOW_APP_MENU_ID;
export const SHOW_DATE_TIME_ID = Constants.SHOW_DATE_TIME_ID;
export const AVAILABLE_INDICATORS_ID = Constants.AVAILABLE_INDICATORS_ID;
export const TRANSFER_INDICATORS_ID = Constants.TRANSFER_INDICATORS_ID;
export const INDICATOR_ORDER_ID = Constants.INDICATOR_ORDER_ID;
export const INDICATOR_PADDING_ID = Constants.INDICATOR_PADDING_ID;
export const INDICATOR_GAP_ID = Constants.INDICATOR_GAP_ID;
export const QUICK_SETTINGS_GAP_ID = Constants.QUICK_SETTINGS_GAP_ID;
export const EXCLUDE_INDICATORS_ID = Constants.EXCLUDE_INDICATORS_ID;


const MultiMonitorsAppMenuButton = GObject.registerClass(
    class MultiMonitorsAppMenuButton extends PanelMenu.Button {
        _init(panel) {
            if (panel.monitorIndex == undefined)
                this._monitorIndex = Main.layoutManager.primaryIndex;
            else
                this._monitorIndex = panel.monitorIndex;
            this._actionOnWorkspaceGroupNotifyId = 0;
            this._targetAppGroup = null;
            this._lastFocusedWindow = null;

            if (typeof Panel !== 'undefined' && Panel.AppMenuButton && Panel.AppMenuButton.prototype._init) {
                Panel.AppMenuButton.prototype._init.call(this, panel);
            } else {
                super._init(0.0, null, false);
                this._startingApps = [];
                this._targetApp = null;
                this._busyNotifyId = 0;
                this._actionGroupNotifyId = 0;
            }

            this._windowEnteredMonitorId = global.display.connect('window-entered-monitor',
                this._windowEnteredMonitor.bind(this));
            this._windowLeftMonitorId = global.display.connect('window-left-monitor',
                this._windowLeftMonitor.bind(this));
        }

        _windowEnteredMonitor(metaScreen, monitorIndex, metaWin) {
            if (monitorIndex == this._monitorIndex) {
                switch (metaWin.get_window_type()) {
                    case Meta.WindowType.NORMAL:
                    case Meta.WindowType.DIALOG:
                    case Meta.WindowType.MODAL_DIALOG:
                    case Meta.WindowType.SPLASHSCREEN:
                        this._sync();
                        break;
                }
            }
        }

        _windowLeftMonitor(metaScreen, monitorIndex, metaWin) {
            if (monitorIndex == this._monitorIndex) {
                switch (metaWin.get_window_type()) {
                    case Meta.WindowType.NORMAL:
                    case Meta.WindowType.DIALOG:
                    case Meta.WindowType.MODAL_DIALOG:
                    case Meta.WindowType.SPLASHSCREEN:
                        this._sync();
                        break;
                }
            }
        }

        _findTargetApp() {
            if (this._actionOnWorkspaceGroupNotifyId) {
                this._targetAppGroup.disconnect(this._actionOnWorkspaceGroupNotifyId);
                this._actionOnWorkspaceGroupNotifyId = 0;
                this._targetAppGroup = null;
            }
            let groupWindow = false;
            let groupFocus = false;

            const workspaceManager = global.workspace_manager;
            const workspace = workspaceManager.get_active_workspace();
            const tracker = Shell.WindowTracker.get_default();
            const focusedApp = tracker.focus_app;
            if (focusedApp && focusedApp.is_on_workspace(workspace)) {
                for (const win of focusedApp.get_windows()) {
                    if (win.located_on_workspace(workspace)) {
                        if (win.get_monitor() == this._monitorIndex) {
                            if (win.has_focus()) {
                                this._lastFocusedWindow = win;
                                return focusedApp;
                            } else {
                                groupWindow = true;
                            }
                        } else {
                            if (win.has_focus())
                                groupFocus = true;
                        }
                        if (groupFocus && groupWindow) {
                            if (focusedApp != this._targetApp) {
                                this._targetAppGroup = focusedApp;
                                this._actionOnWorkspaceGroupNotifyId = this._targetAppGroup.connect(
                                    'notify::action-group',
                                    this._sync.bind(this)
                                );
                            }
                            break;
                        }
                    }
                }
            }

            const startingApp = this._startingApps.find(app => app.is_on_workspace(workspace));
            if (startingApp)
                return startingApp;

            if (this._lastFocusedWindow &&
                this._lastFocusedWindow.located_on_workspace(workspace) &&
                this._lastFocusedWindow.get_monitor() == this._monitorIndex) {
                return tracker.get_window_app(this._lastFocusedWindow);
            }

            const windowOnMonitor = global.display.get_tab_list(Meta.TabList.NORMAL_ALL, workspace)
                .find(window => window.get_monitor() == this._monitorIndex);
            if (windowOnMonitor) {
                this._lastFocusedWindow = windowOnMonitor;
                return tracker.get_window_app(windowOnMonitor);
            }

            return null;
        }

        _sync() {
            if (!this._switchWorkspaceNotifyId)
                return;

            if (typeof Panel !== 'undefined' && Panel.AppMenuButton && Panel.AppMenuButton.prototype._sync)
                Panel.AppMenuButton.prototype._sync.call(this);
        }

        destroy() {
            if (this._actionGroupNotifyId) {
                this._targetApp.disconnect(this._actionGroupNotifyId);
                this._actionGroupNotifyId = 0;
            }

            global.display.disconnect(this._windowEnteredMonitorId);
            global.display.disconnect(this._windowLeftMonitorId);

            if (this._busyNotifyId) {
                this._targetApp.disconnect(this._busyNotifyId);
                this._busyNotifyId = 0;
            }

            if (this.menu._windowsChangedId) {
                this.menu._app.disconnect(this.menu._windowsChangedId);
                this.menu._windowsChangedId = 0;
            }
            super.destroy();
        }
    });

const MultiMonitorsActivitiesButton = GObject.registerClass(
    class MultiMonitorsActivitiesButton extends PanelMenu.Button {
        _init() {
            super._init(0.0, null, true);
            this.accessible_role = Atk.Role.TOGGLE_BUTTON;

            this.name = 'mmPanelActivities';

            this._label = new St.Label({
                text: _("Activities"),
                y_align: Clutter.ActorAlign.CENTER,
            });
            this.add_child(this._label);

            this.label_actor = this._label;

            this._showingId = Main.overview.connect('showing', () => {
                this.add_style_pseudo_class('overview');
                this.add_accessible_state(Atk.StateType.CHECKED);
            });
            this._hidingId = Main.overview.connect('hiding', () => {
                this.remove_style_pseudo_class('overview');
                this.remove_accessible_state(Atk.StateType.CHECKED);
            });

            this._xdndTimeOut = 0;
        }

        vfunc_event(event) {
            if (event.type() === Clutter.EventType.BUTTON_PRESS ||
                event.type() === Clutter.EventType.TOUCH_BEGIN) {
                Main.overview.toggle();
                return Clutter.EVENT_STOP;
            }

            return super.vfunc_event(event);
        }

        destroy() {
            if (this._showingId) {
                Main.overview.disconnect(this._showingId);
                this._showingId = null;
            }
            if (this._hidingId) {
                Main.overview.disconnect(this._hidingId);
                this._hidingId = null;
            }
            super.destroy();
        }
    });

const MULTI_MONITOR_PANEL_ITEM_IMPLEMENTATIONS = {
    'appMenu': MultiMonitorsAppMenuButton,
};

function syncWidgetAppearance(target, source) {
    if (!target || !source || isDisposedActor(target) || isDisposedActor(source))
        return;

    try {
        target.visible = source.visible;
        target.opacity = source.opacity;
        target.reactive = source.reactive;

        const styleClass = source.get_style_class_name?.() ?? '';
        if (target.get_style_class_name?.() !== styleClass)
            target.set_style_class_name(styleClass);

        const style = sanitizeInlineStyle(source.get_style?.() ?? null);
        if (target.get_style?.() !== style)
            target.set_style(style);
    } catch (_e) {
    }
}

function isDisposedActor(actor) {
    if (!actor)
        return true;

    if (actor._mmDisposed === true)
        return true;

    try {
        void actor.visible;
        return false;
    } catch (_e) {
        return true;
    }
}

function isUsablePanel(panel) {
    if (!panel)
        return false;

    try {
        return panel._mmDisposed !== true && panel._isDestroying !== true;
    } catch (_e) {
        return false;
    }
}

function trackActorDispose(actor) {
    if (!actor?.connect)
        return;

    actor._mmDisposed = false;
    actor.connect('destroy', () => {
        actor._mmDisposed = true;
    });
}

function getIndicatorContainer(indicator) {
    return indicator?.container ?? indicator ?? null;
}

function getActorChildren(actor) {
    try {
        return actor?.get_children?.() ?? [];
    } catch (_e) {
        return [];
    }
}

function removeActorFromParent(actor) {
    try {
        const parent = actor?.get_parent?.();
        if (parent && !isDisposedActor(parent))
            parent.remove_child(actor);
    } catch (_e) {
    }
}

function composeSpacingStyle(baseStyle, gap) {
    const gapStyle = `spacing: ${gap}px;`;
    return `${baseStyle || ''}${baseStyle && gapStyle ? ' ' : ''}${gapStyle}`.trim() || null;
}

function sanitizeInlineStyle(style) {
    if (!style || typeof style !== 'string')
        return null;

    const lengthLikeProperty = /^(?:padding|margin|spacing|width|height|min-width|min-height|max-width|max-height|icon-size|border(?:-(?:top|right|bottom|left))?-width|-natural-hpadding|-minimum-hpadding)$/i;
    const validLengthValue = /^(?:-?\d+(?:\.\d+)?(?:px|pt|em|rem|%)?|0|auto|inherit|initial|unset|calc\(.+\)|var\(.+\))$/i;

    const sanitized = style
        .split(';')
        .map(part => part.trim())
        .filter(Boolean)
        .filter(part => part.includes(':'))
        .map(part => {
            const [property, ...valueParts] = part.split(':');
            const name = property.trim();
            const value = valueParts.join(':').trim();
            return {name, value};
        })
        .filter(({name, value}) => name && value)
        .filter(({value}) => !/(?:^|[\s:(-])(NaN|undefined|null)(?:$|[\s);-])/i.test(value))
        .filter(({name, value}) => !lengthLikeProperty.test(name) || validLengthValue.test(value))
        .map(({name, value}) => `${name}: ${value}`)
        .join('; ');

    return sanitized || null;
}

const MultiMonitorsPanel = GObject.registerClass(
    class MultiMonitorsPanel extends St.Widget {
        _init(monitorIndex, mmPanelBox, settings) {
            if (!mmPanelBox)
                throw new Error('mmPanelBox parameter is required but was undefined');

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
            this._panelBoxWrapper = mmPanelBox;
            this._mmDisposed = false;
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

            this._showingId = Main.overview.connect('showing', () => {
                this.add_style_pseudo_class('overview');
            });
            this._hidingId = Main.overview.connect('hiding', () => {
                this.remove_style_pseudo_class('overview');
            });

            mmPanelBox.panelBox.add_child(this);
            Main.ctrlAltTabManager.addGroup(this, _("Top Bar"), 'focus-top-bar-symbolic',
                { sortGroup: CtrlAltTab.SortGroup.TOP });

            this._updatedId = Main.sessionMode.connect('updated', this._updatePanel.bind(this));
            this._workareasChangedId = global.display.connect('workareas-changed', () => this.queue_relayout());

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

            this._startExtensionWatcher();
            this._startAppearanceSync();
            this._syncPanelAppearance();
        }

        _startExtensionWatcher() {
            this._extensionStateChangedId = Main.extensionManager.connect(
                'extension-state-changed',
                this._onExtensionStateChanged.bind(this)
            );

            this._initialCheckTimeouts = [];
            const delays = [1000, 2000, 3000, 5000, 8000];

            for (const delay of delays) {
                const timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
                    if (!isUsablePanel(this))
                        return GLib.SOURCE_REMOVE;

                    this._updatePanel();
                    const idx = this._initialCheckTimeouts.indexOf(timeoutId);
                    if (idx >= 0)
                        this._initialCheckTimeouts.splice(idx, 1);
                    return GLib.SOURCE_REMOVE;
                });
                this._initialCheckTimeouts.push(timeoutId);
            }
        }

        _onExtensionStateChanged(_extensionManager, _extension) {
            this._blurMyShellApplied = false;

            if (this._extensionUpdateTimeoutId) {
                GLib.source_remove(this._extensionUpdateTimeoutId);
                this._extensionUpdateTimeoutId = null;
            }
            this._extensionUpdateTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                this._updatePanel();
                this._extensionUpdateTimeoutId = null;
                return GLib.SOURCE_REMOVE;
            });
        }

        _startAppearanceSync() {
            if (this._appearanceSyncId)
                return;

            this._appearanceSyncId = GLib.timeout_add(
                GLib.PRIORITY_DEFAULT,
                250,
                () => {
                    if (!isUsablePanel(this))
                        return GLib.SOURCE_REMOVE;

                    try {
                        this._syncPanelAppearance();
                        this._maybeRefreshIndicatorsFromMainPanel();
                    } catch (_e) {
                        return GLib.SOURCE_REMOVE;
                    }
                    return GLib.SOURCE_CONTINUE;
                }
            );
        }

        _getMainPanelIndicatorSignature() {
            const mainPanel = Main.panel;
            if (!mainPanel)
                return '';

            const roles = ['_leftBox', '_centerBox', '_rightBox']
                .flatMap(boxName => getActorChildren(mainPanel[boxName])
                    .filter(child => child.visible)
                    .map(child => this._getRoleForBoxChild(child))
                    .filter(Boolean)
                    .map(role => `${boxName}:${role}`));

            return roles.join('|');
        }

        _maybeRefreshIndicatorsFromMainPanel() {
            if (!isUsablePanel(this))
                return;

            const signature = this._getMainPanelIndicatorSignature();
            if (signature === this._lastMainPanelIndicatorSignature)
                return;

            this._lastMainPanelIndicatorSignature = signature;
            this._updatePanel();
        }

        _ensureBlurMyShellCompatibility() {
            if (!isUsablePanel(this))
                return;

            const panelBlur = global.blur_my_shell?._panel_blur;
            if (!panelBlur?.maybe_blur_panel || !panelBlur.enabled)
                return;

            const existingActors = panelBlur.actors_list?.find(entry => entry?.widgets?.panel === this);
            if (existingActors) {
                this._blurMyShellApplied = true;
                return;
            }

            try {
                if (!this.mapped || this.width <= 0 || this.height <= 0)
                    return;

                panelBlur.maybe_blur_panel(this);
                const appliedActors = panelBlur.actors_list?.find(entry => entry?.widgets?.panel === this);
                this._blurMyShellApplied = !!appliedActors;
            } catch (e) {
                console.debug('[MultiMonitors] Blur my Shell compatibility failed:', String(e));
            }
        }

        _syncBlurMyShellActor() {
            if (!isUsablePanel(this))
                return;

            const panelBlur = global.blur_my_shell?._panel_blur;
            const actors = panelBlur?.actors_list?.find(entry => entry?.widgets?.panel === this);
            if (!actors) {
                this._blurMyShellApplied = false;
                return;
            }

            const monitor = Main.layoutManager.findMonitorForActor(this);
            if (!monitor)
                return;

            actors.monitor = monitor;

            const background = actors.widgets?.background;
            const backgroundGroup = actors.widgets?.background_group;
            const panelBox = actors.widgets?.panel_box;
            if (!background || !panelBox)
                return;

            if (backgroundGroup) {
                backgroundGroup.set_position(0, 0);
                backgroundGroup.set_size(panelBox.width, panelBox.height);
            }

            if (actors.static_blur) {
                background.x = 0;
                background.y = 0.5;
                background.width = monitor.width;
                background.height = monitor.height;
                background.set_clip(0, 0, this.width, this.height);
            } else {
                background.x = 0;
                background.y = 0;
                background.width = panelBox.width;
                background.height = panelBox.height;
            }
        }

        _syncPanelAppearance() {
            if (!isUsablePanel(this))
                return;

            syncWidgetAppearance(this, Main.panel);
            [
                [this._leftBox, Main.panel._leftBox],
                [this._centerBox, Main.panel._centerBox],
                [this._rightBox, Main.panel._rightBox],
            ].forEach(([target, source]) => syncWidgetAppearance(target, source));

            const panelBox = this._panelBoxWrapper?.panelBox;
            if (panelBox && !isDisposedActor(panelBox)) {
                try {
                    this.set_position(0, 0);
                    this.set_size(panelBox.width, panelBox.height);
                } catch (_e) {
                    return;
                }
            }

            try {
                this._panelBoxWrapper?.syncFromMainPanel?.();
                this._applyIndicatorGap();
                this._ensureBlurMyShellCompatibility();
                this._syncBlurMyShellActor();
            } catch (_e) {
            }
        }

        vfunc_map() {
            super.vfunc_map();
            this._syncPanelAppearance();
            this._updatePanel();
            this._showDateTime();
        }

        destroy() {
            this._mmDisposed = true;
            this._isDestroying = true;

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
            if (this._showActivitiesId) {
                this._settings.disconnect(this._showActivitiesId);
                this._showActivitiesId = null;
            }
            if (this._showAppMenuId) {
                this._settings.disconnect(this._showAppMenuId);
                this._showAppMenuId = null;
            }
            if (this._showDateTimeId) {
                this._settings.disconnect(this._showDateTimeId);
                this._showDateTimeId = null;
            }
            if (this._indicatorPaddingId) {
                this._settings.disconnect(this._indicatorPaddingId);
                this._indicatorPaddingId = null;
            }
            if (this._indicatorGapId) {
                this._settings.disconnect(this._indicatorGapId);
                this._indicatorGapId = null;
            }
            if (this._quickSettingsGapId) {
                this._settings.disconnect(this._quickSettingsGapId);
                this._quickSettingsGapId = null;
            }

            for (const actor of [this._leftBox, this._centerBox, this._centerBin, this._rightBox]) {
                if (!actor)
                    continue;
                actor._mmDisposed = true;
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
            this._togglePanelIndicator(
                role,
                this._settings.get_boolean(SHOW_APP_MENU_ID),
                () => {
                    const indicator = new MultiMonitorsAppMenuButton(this);
                    this.statusArea[role] = indicator;
                    return indicator;
                }
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

        _hideIndicators() {
            for (let role in MULTI_MONITOR_PANEL_ITEM_IMPLEMENTATIONS) {
                let indicator = this.statusArea[role];
                if (!indicator)
                    continue;
                indicator.container.hide();
            }
        }

        _ensureIndicator(role) {
            if (role === 'activities' && this.monitorIndex === Main.layoutManager.primaryIndex)
                return null;

            let indicator = this.statusArea[role];
            if (indicator) {
                if (indicator.container)
                    indicator.container.show();
                else
                    indicator.show();
                return indicator;
            }

            let constructor = MULTI_MONITOR_PANEL_ITEM_IMPLEMENTATIONS[role];
            if (!constructor) {
                const mainIndicator = Main.panel.statusArea[role];
                if (mainIndicator) {
                    try {
                        indicator = new MirroredIndicatorButton(this, role);
                        this.statusArea[role] = indicator;
                        return indicator;
                    } catch (e) {
                        console.error('[MultiMonitors] Failed to create mirrored indicator for', role, ':', String(e));
                        return null;
                    }
                }
                return null;
            }

            try {
                indicator = new constructor(this);
            } catch (e) {
                console.error('[MultiMonitors] Error creating indicator for', role, ':', String(e));
                throw e;
            }

            this.statusArea[role] = indicator;
            return indicator;
        }

        _getDraggableWindowForPosition(stageX) {
            let workspaceManager = global.workspace_manager;
            const windows = workspaceManager.get_active_workspace().list_windows();
            const allWindowsByStacking = global.display.sort_windows_by_stacking(windows).reverse();

            return allWindowsByStacking.find(metaWindow => {
                let rect = metaWindow.get_frame_rect();
                return metaWindow.get_monitor() == this.monitorIndex &&
                    metaWindow.showing_on_its_workspace() &&
                    metaWindow.get_window_type() != Meta.WindowType.DESKTOP &&
                    metaWindow.maximized_vertically &&
                    stageX > rect.x && stageX < rect.x + rect.width;
            });
        }

        _addToPanelBox(role, indicator, position, box) {
            let container = indicator;
            if (indicator.container)
                container = indicator.container;

            container._mmIndicatorRole = role;
            this.statusArea[role] = indicator;

            if (!indicator._mmDestroyConnected) {
                indicator.connect('destroy', () => {
                    delete this.statusArea[role];
                });
                indicator._mmDestroyConnected = true;
            }

            if (!indicator._mmMenuSetConnected) {
                indicator.connect('menu-set', () => {
                    if (!indicator.menu)
                        return;
                    this.menuManager.addMenu(indicator.menu);
                });
                indicator._mmMenuSetConnected = true;
            }

            removeActorFromParent(container);

            container.show();
            container.y_align = Clutter.ActorAlign.FILL;
            container.y_expand = true;
            this._applyIndicatorPadding(role, container);

            if (box === this._centerBox && this._centerBin) {
                container.x_align = Clutter.ActorAlign.CENTER;
                container.y_align = Clutter.ActorAlign.FILL;
                container.y_expand = true;

                this._centerBin.add_child(container);
            } else {
                box.add_child(container);
                this._reorderBoxByIndicatorOrder(box);
            }

            if (indicator.menu)
                this.menuManager.addMenu(indicator.menu);
        }

        _updatePanel() {
            this._syncPanelAppearance();
            this._hideIndicators();

            this._cloneAllMainPanelIndicators();

            this._ensureQuickSettingsRightmost();

            this._reorderBoxesByIndicatorOrder();
        }

        _cloneAllMainPanelIndicators() {
            const mainPanel = Main.panel;
            if (!mainPanel || !mainPanel.statusArea)
                return;

            const excludedIndicators = [
                'screenRecording',
                'screencast',
                'remoteAccess',
                'unsafeModeIndicator',
            ];

            const groupedIndicators = {
                [Constants.PANEL_BOX_LEFT]: [],
                [Constants.PANEL_BOX_CENTER]: [],
                [Constants.PANEL_BOX_RIGHT]: [],
            };
            const preferredPositions = Constants.getIndicatorPositions(this._settings);
            const transferredIndicators = Constants.getTransferredIndicators(this._settings);

            const isTransferredRole = role =>
                Constants.isPersistentRole(role) &&
                Object.prototype.hasOwnProperty.call(transferredIndicators, role);

            const findRoleForChild = child => {
                for (let role in mainPanel.statusArea) {
                    const indicator = mainPanel.statusArea[role];
                    if (!indicator)
                        continue;

                    if (!Constants.isPersistentRole(role))
                        continue;

                    if (excludedIndicators.includes(role))
                        continue;

                    if (isTransferredRole(role))
                        continue;

                    if (indicator === child || getIndicatorContainer(indicator) === child)
                        return role;
                }
                return null;
            };
            const pushRole = (role, fallbackPosition = Constants.PANEL_BOX_LEFT) => {
                const targetPosition = preferredPositions[role] ?? fallbackPosition;
                groupedIndicators[targetPosition]?.push(role);
            };

            [
                [mainPanel._leftBox, Constants.PANEL_BOX_LEFT],
                [mainPanel._centerBox, Constants.PANEL_BOX_CENTER],
                [mainPanel._rightBox, Constants.PANEL_BOX_RIGHT],
            ].forEach(([box, fallbackPosition]) => {
                getActorChildren(box)
                    .filter(child => child.visible)
                    .map(findRoleForChild)
                    .filter(Boolean)
                    .forEach(role => pushRole(role, fallbackPosition));
            });

            const knownRoles = new Set([
                ...groupedIndicators[Constants.PANEL_BOX_LEFT],
                ...groupedIndicators[Constants.PANEL_BOX_CENTER],
                ...groupedIndicators[Constants.PANEL_BOX_RIGHT],
            ]);

            for (const [role, indicator] of Object.entries(mainPanel.statusArea)) {
                if (!indicator || knownRoles.has(role))
                    continue;

                if (!Constants.isPersistentRole(role))
                    continue;

                if (excludedIndicators.includes(role))
                    continue;

                if (isTransferredRole(role))
                    continue;

                const container = getIndicatorContainer(indicator);
                if (!container?.visible)
                    continue;

                pushRole(role, Constants.getIndicatorPosition(this._settings, role));
            }

            const orderedLeftIndicators = Constants.sortIndicatorsByOrder(
                this._settings,
                groupedIndicators[Constants.PANEL_BOX_LEFT]
            );
            const orderedCenterIndicators = Constants.sortIndicatorsByOrder(
                this._settings,
                groupedIndicators[Constants.PANEL_BOX_CENTER]
            );
            const orderedRightIndicators = Constants.sortIndicatorsByOrder(
                this._settings,
                groupedIndicators[Constants.PANEL_BOX_RIGHT]
            );

            this._updateBox(orderedLeftIndicators, this._leftBox);
            this._updateBox(orderedCenterIndicators, this._centerBox);
            this._updateBox(orderedRightIndicators, this._rightBox);
        }

        _updateBox(elements, box) {
            if (!elements)
                return;

            const nChildren = box.get_n_children();
            const hiddenIndicators = new Set(Constants.getHiddenIndicators(this._settings));
            const transferredIndicators = Constants.getTransferredIndicators(this._settings);

            for (const [index, role] of elements.entries()) {
                if (role === 'activities' && this.monitorIndex === Main.layoutManager.primaryIndex)
                    continue;

                if (Object.prototype.hasOwnProperty.call(transferredIndicators, role)) {
                    const existing = this.statusArea[role];
                    if (existing) {
                        const container = getIndicatorContainer(existing);
                        removeActorFromParent(container);
                        existing.destroy?.();
                    }
                    continue;
                }

                if (hiddenIndicators.has(role)) {
                    const existing = this.statusArea[role];
                    if (existing) {
                        const container = getIndicatorContainer(existing);
                        removeActorFromParent(container);
                        existing.hide?.();
                    }
                    continue;
                }

                try {
                    let indicator = this._ensureIndicator(role);
                    if (indicator) {
                        if (indicator._isEmpty) {
                            if (role === 'keyboard') {
                                this._addToPanelBox(role, indicator, index + nChildren, box);
                                indicator.hide?.();
                                continue;
                            }

                            if (this.statusArea[role] === indicator)
                                delete this.statusArea[role];
                            indicator.destroy();
                            continue;
                        }

                        this._addToPanelBox(role, indicator, index + nChildren, box);
                    }
                } catch (e) {
                    console.error('[MultiMonitors] _updateBox: ERROR for role', role, ':', e, e.stack);
                }
            }
        }
        _findRoleByPattern(pattern) {
            try {
                const keys = Object.keys(Main.panel.statusArea || {});
                return keys.find(k => pattern.test(k)) || null;
            } catch (_e) {
                return null;
            }
        }

        _getRoleForBoxChild(child) {
            if (!child)
                return null;

            if (child._mmIndicatorRole)
                return child._mmIndicatorRole;

            for (const role in this.statusArea) {
                const indicator = this.statusArea[role];
                if (!indicator)
                    continue;

                const container = getIndicatorContainer(indicator);
                if (container === child)
                    return role;
            }

            return null;
        }

        _getPanelBoxForRole(role) {
            switch (Constants.getIndicatorPosition(this._settings, role)) {
            case Constants.PANEL_BOX_CENTER:
                return this._centerBox;
            case Constants.PANEL_BOX_RIGHT:
                return this._rightBox;
            case Constants.PANEL_BOX_LEFT:
            default:
                return this._leftBox;
            }
        }

        _getManagedPanelBoxes() {
            return [this._leftBox, this._centerBin, this._rightBox]
                .filter(box => box && !isDisposedActor(box));
        }

        _reorderBoxByIndicatorOrder(box) {
            if (!isUsablePanel(this) || !box || isDisposedActor(box))
                return;

            const entries = getActorChildren(box)
                .filter(child => child && !isDisposedActor(child))
                .map(child => ({child, role: this._getRoleForBoxChild(child)}));

            const orderedRoles = Constants.sortIndicatorsByOrder(
                this._settings,
                entries.map(entry => entry.role).filter(Boolean)
            );

            const rankMap = new Map();
            orderedRoles.forEach((role, index) => rankMap.set(role, index));

            entries.sort((a, b) => {
                const aRank = a.role && rankMap.has(a.role) ? rankMap.get(a.role) : Number.MAX_SAFE_INTEGER;
                const bRank = b.role && rankMap.has(b.role) ? rankMap.get(b.role) : Number.MAX_SAFE_INTEGER;

                if (aRank !== bRank)
                    return aRank - bRank;

                return 0;
            });

            for (const entry of entries) {
                try {
                    if (isDisposedActor(box) || isDisposedActor(entry.child))
                        continue;

                    if (entry.child.get_parent?.() === box)
                        removeActorFromParent(entry.child);
                    box.add_child(entry.child);
                } catch (_e) {
                }
            }
        }

        _reorderBoxesByIndicatorOrder() {
            if (!isUsablePanel(this))
                return;

            this._getManagedPanelBoxes().forEach(box => this._reorderBoxByIndicatorOrder(box));

            if (this._centerBin && !isDisposedActor(this._centerBin)) {
                for (const centerChild of getActorChildren(this._centerBin)) {
                    if (!centerChild || isDisposedActor(centerChild))
                        continue;

                    const role = this._getRoleForBoxChild(centerChild);
                    if (role)
                        centerChild._mmIndicatorRole = role;
                }
            }
        }

        _getIndicatorContainerForRole(role) {
            const indicator = this.statusArea[role];
            if (!indicator)
                return null;

            return getIndicatorContainer(indicator);
        }

        _getIndicatorPaddingTarget(role, container = null) {
            const indicator = this.statusArea[role];
            const targetContainer = container ?? this._getIndicatorContainerForRole(role);

            if (!targetContainer)
                return null;

            if (indicator?._clockDisplay)
                return indicator._clockDisplay;

            if (indicator?._quickSettingsContainer)
                return indicator._quickSettingsContainer;

            if (indicator?._favoritesContainer)
                return indicator._favoritesContainer;

            if (indicator?._iconContainer)
                return indicator._iconContainer;

            if (indicator?._workspaceDotsBox)
                return indicator._workspaceDotsBox;

            const firstChild = targetContainer.get_first_child?.() ?? null;
            return firstChild ?? targetContainer;
        }

        _getAuxiliaryIndicatorPadding(role) {
            return Constants.getIndicatorPadding(this._settings, role);
        }

        _getIndicatorPaddingTargets(role, container = null) {
            const indicator = this.statusArea[role];
            const target = this._getIndicatorPaddingTarget(role, container);

            if (role !== 'quickSettings')
                return target ? [{actor: target, key: '_mmOriginalInlineStyle'}] : [];

            const outerTarget = container ?? indicator;
            return [
                {actor: outerTarget, key: '_mmOuterOriginalInlineStyle'},
                {actor: target, key: '_mmOriginalInlineStyle'},
            ].filter(({actor}, index, entries) =>
                actor && entries.findIndex(entry => entry.actor === actor) === index);
        }

        _applyAuxiliaryPaddingStyle(actor, padding, key = '_mmOriginalInlineStyle') {
            if (!actor?.set_style || isDisposedActor(actor))
                return;

            try {
                const originalStyle = actor[key] ?? actor.get_style?.() ?? null;
                if (actor[key] === undefined)
                    actor[key] = originalStyle;

                const baseStyle = actor[key] || '';
                const paddingStyle = `padding-left: ${padding}px; padding-right: ${padding}px;`;
                const nextStyle = `${baseStyle}${baseStyle && paddingStyle ? ' ' : ''}${paddingStyle}`.trim();
                actor.set_style(nextStyle || null);
            } catch (_e) {
            }
        }

        _restoreAuxiliaryPaddingStyle(actor, key = '_mmOriginalInlineStyle') {
            if (!actor?.set_style || isDisposedActor(actor))
                return;

            try {
                if (actor[key] === undefined)
                    return;

                actor.set_style(actor[key] || null);
                delete actor[key];
            } catch (_e) {
            }
        }

        _applyIndicatorPadding(role, container = null) {
            const hasOverride = Constants.hasIndicatorPaddingOverride(this._settings, role);
            const padding = this._getAuxiliaryIndicatorPadding(role);

            if (role === 'quickSettings')
                this.statusArea[role]?._applyQuickSettingsIndicatorPadding?.(
                    Number.isFinite(padding) ? padding : Constants.getQuickSettingsGap(this._settings));

            if (!hasOverride) {
                this._getIndicatorPaddingTargets(role, container)
                    .forEach(({actor, key}) => this._restoreAuxiliaryPaddingStyle(actor, key));
                return;
            }

            this._getIndicatorPaddingTargets(role, container)
                .forEach(({actor, key}) => this._applyAuxiliaryPaddingStyle(actor, padding, key));
        }

        _restoreIndicatorPadding(role, container = null) {
            if (role === 'quickSettings')
                this.statusArea[role]?._applyQuickSettingsIndicatorPadding?.(
                    Constants.getDefaultIndicatorPadding(this._settings, role) ?? 0);

            this._getIndicatorPaddingTargets(role, container)
                .forEach(({actor, key}) => this._restoreAuxiliaryPaddingStyle(actor, key));
        }

        _applyIndicatorPaddingToAll() {
            for (const role of Object.keys(this.statusArea))
                this._applyIndicatorPadding(role);
        }

        _restoreAllIndicatorPadding() {
            for (const role of Object.keys(this.statusArea))
                this._restoreIndicatorPadding(role);
        }

        _getIndicatorGapTargets() {
            if (!isUsablePanel(this))
                return [];

            return this._getManagedPanelBoxes();
        }

        _applyIndicatorGap() {
            if (!isUsablePanel(this))
                return;

            const gap = Constants.getIndicatorGap(this._settings);

            for (const target of this._getIndicatorGapTargets()) {
                if (!target || !target.set_style || isDisposedActor(target))
                    continue;

                try {
                    const originalStyle = target._mmOriginalGapStyle ?? target.get_style?.() ?? null;
                    if (target._mmOriginalGapStyle === undefined)
                        target._mmOriginalGapStyle = originalStyle;

                    target.set_style(composeSpacingStyle(target._mmOriginalGapStyle || '', gap));
                } catch (_e) {
                }
            }
        }

        _restoreIndicatorGap() {
            for (const target of this._getIndicatorGapTargets()) {
                if (!target || !target.set_style || isDisposedActor(target))
                    continue;

                try {
                    if (target._mmOriginalGapStyle === undefined)
                        continue;

                    target.set_style(target._mmOriginalGapStyle || null);
                    delete target._mmOriginalGapStyle;
                } catch (_e) {
                }
            }
        }

        _ensureQuickSettingsRightmost() {
            if (!isUsablePanel(this) || isDisposedActor(this._rightBox))
                return;

            const role = 'quickSettings';
            const mainQS = Main.panel.statusArea[role];

            if (!mainQS) {
                if (this.statusArea[role]) {
                    const ind = this.statusArea[role];
                    const cont = getIndicatorContainer(ind);
                    try {
                        if (!isDisposedActor(cont))
                            removeActorFromParent(cont);
                    } catch (_e) {
                    }
                    try {
                        ind.destroy();
                    } catch (_e) {
                    }
                    delete this.statusArea[role];
                }
                return;
            }

            let indicator = this.statusArea[role];
            if (!indicator) {
                try {
                    indicator = new MirroredIndicatorButton(this, role);
                    this.statusArea[role] = indicator;
                } catch (_e) {
                    return;
                }
            }

            const container = getIndicatorContainer(indicator);
            if (isDisposedActor(container))
                return;

            container._mmIndicatorRole = role;

            try {
                removeActorFromParent(container);

                if (!isDisposedActor(this._rightBox))
                    this._rightBox.add_child(container);

                this._applyIndicatorPadding(role, container);
                this._reorderBoxByIndicatorOrder(this._rightBox);
            } catch (_e) {
            }
        }
    });

export {
    StatusIndicatorsController,
    MultiMonitorsAppMenuButton,
    MultiMonitorsActivitiesButton,
    MultiMonitorsPanel,
};
