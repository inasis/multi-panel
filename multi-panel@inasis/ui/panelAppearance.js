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
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {
    getActorChildren,
    isDisposedActor,
    isUsablePanel,
    syncWidgetAppearance,
} from './actorUtils.js';

const appearanceSupportMethods = {
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
    },

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
    },

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
    },

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
    },

    _maybeRefreshIndicatorsFromMainPanel() {
        if (!isUsablePanel(this))
            return;

        const signature = this._getMainPanelIndicatorSignature();
        if (signature === this._lastMainPanelIndicatorSignature)
            return;

        this._lastMainPanelIndicatorSignature = signature;
        this._updatePanel();
    },

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
    },

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
    },

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
            this._applyPanelLayout();
            this._applyIndicatorGap();
            this._ensureBlurMyShellCompatibility();
            this._syncBlurMyShellActor();
        } catch (_e) {
        }
    },

    vfunc_map() {
        St.Widget.prototype.vfunc_map.call(this);
        this._syncPanelAppearance();
        this._updatePanel();
        this._showDateTime();
    },
};

export function installAuxiliaryPanelAppearanceSupport(prototype) {
    Object.assign(prototype, appearanceSupportMethods);
}
