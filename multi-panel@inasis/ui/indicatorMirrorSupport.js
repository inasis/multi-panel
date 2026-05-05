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

const cloneSupportMethods = {

    // Clone factory
    _createSimpleClone(parent, source) {
        if (this._isDescriptorKind?.('simple-visual', 'menu-forward', 'activation-forward') ||
            this._hasCapability?.('external')) {
            this._createStaticIconCopy(parent, source);
            return;
        }

        this._createAllocationSyncedClone(parent, source, `simple:${this._role ?? 'generic'}`);
    },

    _createAllocationSyncedClone(parent, source, kind = 'generic') {
        const clone = new Clutter.Clone({
            source,
            y_align: Clutter.ActorAlign.CENTER,
        });
        clone.visible = false;

        parent.add_child(clone);

        if (!this._allocationSyncedClones)
            this._allocationSyncedClones = new Map();

        const syncKey = kind || 'generic';
        const previous = this._allocationSyncedClones.get(syncKey);
        if (previous?.signalId && previous?.source) {
            try {
                previous.source.disconnect(previous.signalId);
            } catch (_e) {
            }
        }
        if (previous?.timeoutId)
            GLib.source_remove(previous.timeoutId);

        const syncSize = () => {
            if (this._isDestroying || !source || !clone)
                return;

            try {
                const alloc = source.get_allocation_box();
                const width = alloc.get_width();
                const height = alloc.get_height();

                if (width > 0 && height > 0) {
                    clone.set_size(width, height);
                    clone.visible = true;
                } else {
                    clone.visible = false;
                }
            } catch (_e) {
                clone.visible = false;
            }
        };

        const signalId = source.connect('notify::allocation', syncSize);
        const timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
            syncSize();
            const entry = this._allocationSyncedClones?.get(syncKey);
            if (entry)
                entry.timeoutId = null;
            return GLib.SOURCE_REMOVE;
        });

        this._allocationSyncedClones.set(syncKey, {
            clone,
            source,
            signalId,
            timeoutId,
        });
    },

    // Static icon copy
    _createStaticIconCopy(parent, source) {
        const container = new St.BoxLayout({
            style_class: 'panel-status-menu-box',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            y_expand: false,
            reactive: false,
        });
        this._applyZeroSpacingStyle(container);

        this._copyIconsFromSource(container, source);
        if (this._shouldSyncRoleContainerAppearance())
            this._syncMirroredContainerAppearance(container, source);
        parent.add_child(container);
        this._iconContainer = container;
        this._iconSource = source;

        this._startIconSync();
    },

    // Role predicates (delegating to shared constants)
    _shouldSyncRoleContainerAppearance() {
        return this._hasCapability?.('appearance-sync') ?? false;
    },

    _getMirroredSourceInlineStyle(widget) {
        if (!widget?.get_style)
            return null;

        if (this._hasCapability?.('ignore-source-style'))
            return null;

        return widget.get_style?.() ?? null;
    },

    // Actor tree helpers
    _getActorDepth(actor) {
        let depth = 0;
        let current = actor;

        while (current) {
            depth++;
            current = current.get_parent?.() ?? null;
        }

        return depth;
    },

    _isPreferredRoleActionActor(actor) {
        if (!actor)
            return false;

        return actor.reactive === true ||
            actor.can_focus === true ||
            actor.track_hover === true ||
            actor instanceof St.Button ||
            typeof actor.clicked === 'function' ||
            typeof actor.toggle === 'function' ||
            typeof actor.stop === 'function' ||
            typeof actor.stopRecording === 'function' ||
            typeof actor.stopScreencast === 'function' ||
            typeof actor.stopSharing === 'function';
    },

    _findPreferredRoleActor(root, predicate) {
        if (!root)
            return null;

        const queue = [root];
        const visited = new Set();
        let bestMatch = null;
        let bestDepth = -1;

        while (queue.length > 0) {
            const actor = queue.shift();
            if (!actor || visited.has(actor))
                continue;

            visited.add(actor);

            if (predicate(actor)) {
                const depth = this._getActorDepth(actor);
                if (depth > bestDepth) {
                    bestMatch = actor;
                    bestDepth = depth;
                }
            }

            const children = actor.get_children?.() ?? [];
            for (const child of children)
                queue.push(child);
        }

        return bestMatch;
    },

    _getRoleAppearanceSource(root) {
        if (!this._shouldSyncRoleContainerAppearance())
            return root;

        return this._findPreferredRoleActor(root, actor =>
            this._isPreferredRoleActionActor(actor) ||
            actor.has_style_pseudo_class?.('active') ||
            actor.has_style_pseudo_class?.('checked') ||
            Boolean(actor.get_style_class_name?.()) ||
            Boolean(actor.get_style?.())) ?? root;
    },

    // Appearance sync
    _syncPseudoClass(container, appearanceSource, pseudoClass) {
        if (appearanceSource.has_style_pseudo_class?.(pseudoClass)) {
            container.add_style_pseudo_class(pseudoClass);
            this.add_style_pseudo_class(pseudoClass);
        } else {
            container.remove_style_pseudo_class(pseudoClass);
            this.remove_style_pseudo_class(pseudoClass);
        }
    },

    _syncMirroredContainerAppearance(container, source) {
        if (!container || !source)
            return;

        const syncAppearance = () => {
            if (this._isDestroying)
                return;

            try {
                const appearanceSource = this._getRoleAppearanceSource(source) ?? source;
                const nextStyleClass = appearanceSource.get_style_class_name?.() || 'panel-status-menu-box';
                if (container.get_style_class_name?.() !== nextStyleClass)
                    container.set_style_class_name(nextStyleClass);

                this._applyZeroSpacingStyle(container, appearanceSource.get_style?.() ?? '');

                const nextVisible = this._isEffectivelyVisible(appearanceSource, this._sourceIndicator);
                if (container.visible !== nextVisible)
                    container.visible = nextVisible;

                this._syncPseudoClass(container, appearanceSource, 'active');
                this._syncPseudoClass(container, appearanceSource, 'checked');
            } catch (_e) {
            }
        };

        syncAppearance();
        this._trackWidgetSignals(source, ['notify::style', 'notify::visible'], syncAppearance);
    },

    // Action target finders
    _findDirectActionTarget(actionNames) {
        const target = this._findForwardTarget(actor =>
            actionNames.some(actionName => typeof actor[actionName] === 'function'));
        if (!target)
            return null;

        const actionName = actionNames.find(name => typeof target[name] === 'function');
        return actionName ? { target, actionName } : null;
    },

    _findClickableTarget() {
        return this._findForwardTarget(actor =>
            typeof actor?.activate === 'function' ||
            typeof actor?.clicked === 'function' ||
            typeof actor?.toggle === 'function' ||
            actor instanceof St.Button ||
            actor.reactive === true);
    },

    _findForwardTarget(predicate) {
        let bestTarget = null;
        let bestDepth = -1;

        for (const root of this._getForwardSearchRoots()) {
            const target = this._findPreferredRoleActor(root, predicate);
            if (!target)
                continue;

            const depth = this._getActorDepth(target);
            if (depth > bestDepth) {
                bestTarget = target;
                bestDepth = depth;
            }
        }

        return bestTarget;
    },

    _getForwardSearchRoots() {
        return [
            this._sourceIndicator,
            this._sourceIndicator?.container,
            this._descriptor?.actor,
        ].filter((actor, index, actors) =>
            actor && actors.indexOf(actor) === index);
    },

    // Signal tracking
    _clearTrackedWidgetSignals() {
        if (!this._trackedWidgetSignals)
            return;

        for (const {sourceWidget, signalId} of this._trackedWidgetSignals) {
            if (!sourceWidget || !signalId)
                continue;

            try {
                sourceWidget.disconnect(signalId);
            } catch (_e) {
            }
        }

        this._trackedWidgetSignals = [];
    },

    _isEffectivelyVisible(widget, stopActor = null) {
        let current = widget;

        while (current) {
            if (current.visible === false)
                return false;

            if (current === stopActor)
                return true;

            current = current.get_parent?.() ?? null;
        }

        return true;
    },

    // Icon copy
    _copyIconsFromSource(container, source) {
        this._clearTrackedWidgetSignals();
        container.remove_all_children();

        const widgets = this._findAllDisplayWidgets(source);

        if (widgets.length > 0) {
            for (const widget of widgets) {
                if (widget instanceof St.Icon) {
                    const iconCopy = new St.Icon({
                        gicon: widget.gicon,
                        icon_name: widget.icon_name,
                        icon_size: widget.icon_size || 16,
                        style_class: widget.get_style_class_name() || 'system-status-icon',
                        y_align: Clutter.ActorAlign.CENTER,
                    });
                    this._trackMirroredCopySignals(
                        widget,
                        [
                            'notify::gicon',
                            'notify::icon-name',
                            'notify::icon-size',
                            'notify::style',
                            'notify::visible',
                        ],
                        iconCopy,
                        source,
                        () => {
                            iconCopy.gicon = widget.gicon;
                            iconCopy.icon_name = widget.icon_name;
                            iconCopy.icon_size = widget.icon_size || 16;
                        },
                        'system-status-icon'
                    );

                    container.add_child(iconCopy);
                } else if (widget instanceof St.Label) {
                    const labelCopy = new St.Label({
                        text: widget.text,
                        style_class: widget.get_style_class_name() || '',
                        x_expand: false,
                        y_expand: false,
                        y_align: Clutter.ActorAlign.CENTER,
                    });
                    if (labelCopy.clutter_text)
                        labelCopy.clutter_text.y_align = Clutter.ActorAlign.CENTER;

                    this._trackMirroredCopySignals(
                        widget,
                        ['notify::text', 'notify::style', 'notify::visible'],
                        labelCopy,
                        source,
                        () => {
                            labelCopy.text = widget.text;
                        }
                    );

                    labelCopy._sourceLabel = widget;
                    container.add_child(labelCopy);
                }
            }
        } else {
            this._createAllocationSyncedClone(container, source, `fallback:${this._role ?? 'generic'}`);
        }
    },

    _findAllDisplayWidgets(actor, stopActor = actor) {
        const widgets = [];
        if (!actor)
            return widgets;

        if (!(this._hasCapability?.('ignore-source-visibility') ?? false) &&
            !this._isEffectivelyVisible(actor, stopActor))
            return widgets;

        if (actor instanceof St.Icon || actor instanceof St.Label) {
            widgets.push(actor);
            return widgets;
        }

        const children = actor.get_children ? actor.get_children() : [];
        for (const child of children)
            widgets.push(...this._findAllDisplayWidgets(child, stopActor));
        return widgets;
    },

    // Icon sync timer
    _makeDestroyGuardedTimer(timeoutKey, body) {
        return () => {
            try {
                if (this._isDestroying) {
                    this[timeoutKey] = null;
                    return GLib.SOURCE_REMOVE;
                }
                return body();
            } catch (_e) {
                this[timeoutKey] = null;
                return GLib.SOURCE_REMOVE;
            }
        };
    },

    _startIconSync() {
        if (this._iconSyncId) {
            GLib.source_remove(this._iconSyncId);
            this._iconSyncId = null;
        }
        if (this._labelSyncId) {
            GLib.source_remove(this._labelSyncId);
            this._labelSyncId = null;
        }

        this._iconSyncId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            5,
            this._makeDestroyGuardedTimer('_iconSyncId', () => {
                if (this._iconContainer && this._iconSource) {
                    this._copyIconsFromSource(this._iconContainer, this._iconSource);
                    if (this._shouldSyncRoleContainerAppearance())
                        this._syncMirroredContainerAppearance(this._iconContainer, this._iconSource);
                }
                return GLib.SOURCE_CONTINUE;
            })
        );

        if (this._isDirectSyncRole())
            return;

        this._labelSyncId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            2,
            this._makeDestroyGuardedTimer('_labelSyncId', () => {
                if (this._iconContainer)
                    this._syncLabelTexts(this._iconContainer);
                return GLib.SOURCE_CONTINUE;
            })
        );
    },

    _syncLabelTexts(container) {
        const children = container.get_children();
        for (const child of children) {
            if (child instanceof St.Label && child._sourceLabel) {
                try {
                    child.text = child._sourceLabel.text;
                } catch (_e) {
                }
            }
        }
    },

};

const interactionSupportMethods = {
    _onButtonPress() {
        if (this._isDescriptorKind?.('overview-forward')) {
            Main.overview.toggle();
            return Clutter.EVENT_STOP;
        }

        if (this._isDescriptorKind?.('hidden', 'missing', 'unsupported'))
            return Clutter.EVENT_PROPAGATE;

        if (this._handleDirectIndicatorAction())
            return Clutter.EVENT_STOP;

        if (this._sourceIndicator &&
            this._sourceIndicator.menu &&
            this._isDescriptorKind?.('menu-forward'))
            return this._openMirroredMenu();

        if (this._sourceIndicator) {
            if (this._hasCapability?.('custom-menu-toggle') &&
                typeof this._sourceIndicator.toggleMenu === 'function')
                return this._openArcMenu();

            if (this._hasCapability?.('custom-menu-toggle') &&
                this._sourceIndicator.arcMenu &&
                typeof this._sourceIndicator.arcMenu.toggle === 'function')
                return this._openArcMenu();

            if (this._hasCapability?.('custom-menu-toggle') &&
                this._sourceIndicator._menuButton &&
                typeof this._sourceIndicator._menuButton.toggleMenu === 'function')
                return this._openArcMenu();

            const customMenus = [
                '_popupFavoriteAppsMenu',
                '_popupPowerItemsMenu',
                '_popup',
                '_popupMenu',
            ];

            for (const menuName of customMenus) {
                if (this._hasCapability?.('custom-menu-toggle') &&
                    this._sourceIndicator[menuName]?.toggle)
                    return this._openCustomPopupMenu(this._sourceIndicator[menuName]);
            }

            if (this._isDescriptorKind?.('activation-forward') ||
                this._hasCapability?.('click') ||
                this._hasCapability?.('interaction-forward'))
                return this._forwardClickToSource();
        }

        return Clutter.EVENT_PROPAGATE;
    },

    _handleDirectIndicatorAction() {
        if (!this._sourceIndicator)
            return false;

        if (!this._hasCapability?.('direct-action'))
            return false;

        const directActions = [
            'stop',
            '_stop',
            'stopRecording',
            '_stopRecording',
            'stopScreencast',
            '_stopScreencast',
            'stopSharing',
            '_stopSharing',
        ];

        const action = this._findDirectActionTarget(directActions);
        if (action) {
            try {
                action.target[action.actionName]();
                return true;
            } catch (_e) {
            }
        }

        return this._forwardClickToSource() === Clutter.EVENT_STOP;
    },

    _forwardClickToSource() {
        this._setButtonActive(true);

        try {
            const clickableTarget = this._findClickableTarget();
            if (!this._invokeForwardedClick(clickableTarget)) {
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

    _invokeForwardedClick(target) {
        const attempts = [
            {
                canRun: () => typeof this._sourceIndicator?.activate === 'function',
                run: () => this._sourceIndicator.activate(),
            },
            {
                canRun: () => typeof target?.activate === 'function',
                run: () => target.activate(),
            },
            {
                canRun: () => typeof target?.clicked === 'function',
                run: () => target.clicked(),
            },
            {
                canRun: () => typeof target?.toggle === 'function',
                run: () => target.toggle(),
            },
            {
                canRun: () => typeof target?.emit === 'function',
                run: () => target.emit('clicked'),
            },
            {
                canRun: () => typeof target?.emit === 'function',
                run: () => target.emit('button-press-event', null),
            },
            {
                canRun: () => typeof target?.emit === 'function',
                run: () => target.emit('button-release-event', null),
            },
        ];

        for (const attempt of attempts) {
            if (!attempt.canRun())
                continue;

            try {
                attempt.run();
                return true;
            } catch (_e) {
            }
        }

        return false;
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
            if (constraint instanceof Clutter.BindConstraint ||
                constraint instanceof Clutter.AlignConstraint) {
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
            '_forwardClickTimeoutId',
            '_iconSyncId',
            '_labelSyncId',
            '_arcMenuTimeoutId',
            '_lockSizeTimeoutId',
            '_proxyActivationBlockTimeoutId',
            '_sizeDebounceId',
        ].forEach(timeoutKey => this._clearTimeoutKey(timeoutKey));

        this._disconnectSignal(Main.overview, '_overviewShowingId');

        this._cleanupAllocationSyncedClones();
        this._cleanupSourceVisibilityTracking();

        this._clearTrackedWidgetSignals();
        this._cleanupOverviewForwardSignals();
    },

    destroy() {
        this._cleanup();
        return PanelMenu.Button.prototype.destroy.call(this);
    },
};

export function installMirroredIndicatorSupport(prototype) {
    Object.assign(prototype, cloneSupportMethods, interactionSupportMethods);
}
