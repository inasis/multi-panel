/*
Copyright (C) 2025-2026  Frederyk Abryan Palinoan
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
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

const interactionSupportMethods = {
    _onButtonPress() {
        if (this._role === 'activities') {
            Main.overview.toggle();
            return Clutter.EVENT_STOP;
        }

        if (this._handleDirectIndicatorAction())
            return Clutter.EVENT_STOP;

        if (this._sourceIndicator && this._sourceIndicator.menu)
            return this._openMirroredMenu();

        if (this._sourceIndicator) {
            if (typeof this._sourceIndicator.toggleMenu === 'function')
                return this._openArcMenu();

            if (this._sourceIndicator.arcMenu && typeof this._sourceIndicator.arcMenu.toggle === 'function')
                return this._openArcMenu();

            if (this._sourceIndicator._menuButton && typeof this._sourceIndicator._menuButton.toggleMenu === 'function')
                return this._openArcMenu();

            const customMenus = [
                '_popupFavoriteAppsMenu',
                '_popupPowerItemsMenu',
                '_popup',
                '_popupMenu',
            ];

            for (const menuName of customMenus) {
                if (this._sourceIndicator[menuName]?.toggle)
                    return this._openCustomPopupMenu(this._sourceIndicator[menuName]);
            }

            if (typeof this._sourceIndicator?.clicked === 'function' ||
                this._sourceIndicator instanceof St.Button)
                return this._forwardClickToSource();
        }

        return Clutter.EVENT_PROPAGATE;
    },

    _handleDirectIndicatorAction() {
        if (!this._sourceIndicator)
            return false;

        const directActions = this._role === 'screenRecording' || this._role === 'screencast'
            ? ['stop', '_stop', 'stopRecording', '_stopRecording', 'stopScreencast', '_stopScreencast']
            : this._role === 'screenSharing'
                ? ['stop', '_stop', 'stopSharing', '_stopSharing']
                : [];

        const action = this._findDirectActionTarget(directActions);
        if (action) {
            try {
                action.target[action.actionName]();
                return true;
            } catch (_e) {
            }
        }

        if (this._role === 'screenRecording' ||
            this._role === 'screencast' ||
            this._role === 'screenSharing')
            return this._forwardClickToSource() === Clutter.EVENT_STOP;

        return false;
    },

    _forwardClickToSource() {
        this._setButtonActive(true);

        try {
            const clickableTarget = this._findClickableTarget();
            if (typeof clickableTarget?.clicked === 'function') {
                clickableTarget.clicked();
            } else if (typeof clickableTarget?.toggle === 'function') {
                clickableTarget.toggle();
            } else if (clickableTarget instanceof St.Button &&
                typeof clickableTarget?.emit === 'function') {
                clickableTarget.emit('clicked');
            } else {
                this._setButtonActive(false);
                return Clutter.EVENT_PROPAGATE;
            }
        } catch (_e) {
            this._setButtonActive(false);
            return Clutter.EVENT_PROPAGATE;
        }

        this._replaceTimeout('_forwardClickTimeoutId', 150, () => {
            this._setButtonActive(false);
            return GLib.SOURCE_REMOVE;
        });

        return Clutter.EVENT_STOP;
    },

    _resolveArcMenuToggle() {
        if (this._sourceIndicator.arcMenu) {
            return {
                arcMenu: this._sourceIndicator.arcMenu,
                toggleFunc: () => this._sourceIndicator.arcMenu.toggle(),
            };
        }

        if (this._sourceIndicator._menuButton?.arcMenu) {
            return {
                arcMenu: this._sourceIndicator._menuButton.arcMenu,
                toggleFunc: () => this._sourceIndicator._menuButton.toggleMenu(),
            };
        }

        if (typeof this._sourceIndicator.toggleMenu === 'function') {
            return {
                arcMenu: this._sourceIndicator.arcMenu || this._sourceIndicator.menu,
                toggleFunc: () => this._sourceIndicator.toggleMenu(),
            };
        }

        return { arcMenu: null, toggleFunc: null };
    },

    _openArcMenu() {
        const { arcMenu, toggleFunc } = this._resolveArcMenuToggle();

        if (arcMenu && arcMenu.sourceActor) {
            const originalSourceActor = arcMenu.sourceActor;
            const sourceState = this._preventMainPanelActiveState();

            this._setButtonActive(true);
            this._setMenuSourceActor(arcMenu, this);

            this._bindMenuLifecycle(arcMenu, () => {
                this._setButtonActive(false);
                this._setMenuSourceActor(arcMenu, originalSourceActor);
                this._restoreSourceIndicatorMenuState(sourceState);
            });

            if (toggleFunc)
                toggleFunc();
        } else {
            this._setButtonActive(true);

            if (toggleFunc) {
                toggleFunc();
            }

            this._replaceTimeout('_arcMenuTimeoutId', 300, () => {
                this._setButtonActive(false);
                return GLib.SOURCE_REMOVE;
            });
        }

        return Clutter.EVENT_STOP;
    },

    _openCustomPopupMenu(popupMenu) {
        const monitorIndex = Main.layoutManager.findIndexForActor(this);
        const originalSourceActor = popupMenu.sourceActor;

        if (popupMenu.isOpen) {
            popupMenu.close();
            return Clutter.EVENT_STOP;
        }

        this._setButtonActive(true);
        this._setMenuSourceActor(popupMenu, this);

        if (popupMenu.box) {
            const monitor = Main.layoutManager.monitors[monitorIndex];
            if (monitor && popupMenu.box._updateFlip)
                popupMenu.box._updateFlip(monitor);
        }

        this._bindMenuLifecycle(
            popupMenu,
            () => {
                this._setButtonActive(false);
                this._setMenuSourceActor(popupMenu, originalSourceActor);
            },
            () => this._setButtonActive(true)
        );

        popupMenu.open();

        return Clutter.EVENT_STOP;
    },

    _openMirroredMenu() {
        const monitorIndex = Main.layoutManager.findIndexForActor(this);
        const menu = this._sourceIndicator.menu;

        const originalSourceActor = menu.sourceActor;
        const menuPositionActor = this._getMenuPositionActor(menu);
        const originalBoxPointer = menuPositionActor?._sourceActor;
        const sourceState = this._preventMainPanelActiveState();

        let menuBoxState = null;

        if (menu.isOpen) {
            menu.close();
            return Clutter.EVENT_STOP;
        }

        this._setButtonActive(true);
        this._setMenuSourceActor(menu, this);

        if (menuPositionActor)
            menuBoxState = this._updateMenuPositioning(menu, monitorIndex);

        this._bindMenuLifecycle(
            menu,
            () => this._restoreMenuState(
                menu,
                originalSourceActor,
                originalBoxPointer,
                sourceState,
                menuBoxState
            ),
            () => this._setButtonActive(true)
        );

        menu.open();

        return Clutter.EVENT_STOP;
    },

    _getMenuPositionActor(menu) {
        return menu?._boxPointer ?? menu?.box ?? menu?.actor ?? null;
    },

    _updateMenuPositioning(menu, monitorIndex) {
        const menuBox = this._getMenuPositionActor(menu);
        if (!menuBox)
            return null;

        menuBox._sourceActor = this;
        menuBox._sourceAllocation = null;

        const removedConstraints = [];
        const constraints = menuBox.get_constraints();
        for (const constraint of constraints) {
            if (constraint.constructor.name === 'BindConstraint' ||
                constraint.constructor.name === 'AlignConstraint') {
                menuBox.remove_constraint(constraint);
                removedConstraints.push(constraint);
            }
        }

        const originalSetPosition = menuBox.setPosition;
        const monitor = Main.layoutManager.monitors[monitorIndex] || Main.layoutManager.primaryMonitor;

        if (typeof menuBox.setPosition !== 'function') {
            return {
                originalSetPosition,
                removedConstraints,
            };
        }

        menuBox.setPosition = function (sourceActor, _alignment) {
            const [btnX, btnY] = sourceActor.get_transformed_position();
            const [btnW, btnH] = sourceActor.get_transformed_size();
            const [menuW, menuH] = this.get_preferred_size();
            const finalMenuW = menuW[1];
            const [currW, currH] = this.get_size();
            const finalMenuH = currH > 0 ? currH : menuH[1];

            let newX = btnX + btnW / 2 - finalMenuW / 2;
            let newY = btnY + btnH;

            if (newX + finalMenuW > monitor.x + monitor.width)
                newX = monitor.x + monitor.width - finalMenuW;
            if (newX < monitor.x)
                newX = monitor.x;

            if (newY + finalMenuH > monitor.y + monitor.height) {
                newY = btnY - finalMenuH;
                if (this.setArrowSide)
                    this.setArrowSide(St.Side.BOTTOM);
            } else if (this.setArrowSide) {
                this.setArrowSide(St.Side.TOP);
            }

            this.set_position(Math.round(newX), Math.round(newY));
        };

        return {
            originalSetPosition,
            removedConstraints,
        };
    },

    _restoreMenuState(menu, originalSourceActor, originalBoxPointer, sourceState, menuBoxState) {
        if (originalSourceActor)
            this._setMenuSourceActor(menu, originalSourceActor);

        const menuPositionActor = this._getMenuPositionActor(menu);
        if (menuPositionActor && originalBoxPointer)
            menuPositionActor._sourceActor = originalBoxPointer;

        this._restoreSourceIndicatorMenuState(sourceState);

        if (menuPositionActor && menuBoxState) {
            if (menuBoxState.originalSetPosition)
                menuPositionActor.setPosition = menuBoxState.originalSetPosition;

            if (menuBoxState.removedConstraints?.length > 0) {
                menuBoxState.removedConstraints.forEach(constraint => {
                    menuPositionActor.add_constraint(constraint);
                });
            }
        }

        if (this._sourceIndicator && this._sourceIndicator.remove_style_pseudo_class) {
            this._sourceIndicator.remove_style_pseudo_class('active');
            this._sourceIndicator.remove_style_pseudo_class('checked');
        }

        this._resetButtonState();
    },

    _cleanup() {
        if (this._isCleanedUp)
            return;
        this._isCleanedUp = true;
        this._isDestroying = true;

        [
            '_clockUpdateId',
            '_forwardClickTimeoutId',
            '_iconSyncId',
            '_labelSyncId',
            '_arcMenuTimeoutId',
            '_lockSizeTimeoutId',
            '_monitorTimeoutId',
            '_qsInitialSyncId',
            '_sizeDebounceId',
        ].forEach(timeoutKey => this._clearTimeoutKey(timeoutKey));

        this._disconnectSignal(Main.overview, '_overviewShowingId');
        this._disconnectSignal(global.display, '_fullscreenChangedId');
        this._disconnectSignal(this._quickSettingsSource, '_sourceSizeChangedId');

        this._cleanupAllocationSyncedClones();
        this._cleanupSourceVisibilityTracking();

        this._clearTrackedWidgetSignals();
        this._cleanupActivitiesSignals();
    },

    destroy() {
        this._cleanup();
        return PanelMenu.Button.prototype.destroy.call(this);
    },
};

export function installMirroredIndicatorInteractionSupport(prototype) {
    Object.assign(prototype, interactionSupportMethods);
}