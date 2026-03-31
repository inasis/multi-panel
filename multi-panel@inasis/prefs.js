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
import Gdk from 'gi://Gdk';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Adw from 'gi://Adw';
import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const SHOW_PANEL_ID = 'show-panel';
const AVAILABLE_INDICATORS_ID = 'available-indicators';
const TRANSFER_INDICATORS_ID = 'transfer-indicators';
const INDICATOR_ORDER_ID = 'indicator-order';
const INDICATOR_POSITIONS_ID = 'indicator-positions';
const HIDDEN_INDICATORS_ID = 'hidden-indicators';
const INDICATOR_PADDING_ID = 'indicator-padding';
const INDICATOR_GAP_ID = 'indicator-gap';
const QUICK_SETTINGS_GAP_ID = 'quick-settings-gap';
const APPLY_INDICATOR_LAYOUT_TO_MAIN_PANEL_ID = 'apply-indicator-layout-to-main-panel';
const PANEL_LEFT_PADDING_ID = 'panel-left-padding';
const PANEL_RIGHT_PADDING_ID = 'panel-right-padding';
const PANEL_HEIGHT_ID = 'panel-height';
const ENABLE_HOT_CORNERS = 'enable-hot-corners';
const SCREENSHOT_ON_ALL_MONITORS_ID = 'screenshot-on-all-monitors';

const FIXED_EXTERNAL_PANEL_ROLES = [
    'activities',
    'appMenu',
    'dateMenu',
    'quickSettings',
];

const TRANSIENT_ROLE_PATTERNS = [
    /^appindicator-:/i,
    /^org\/ayatana\/NotificationItem/i,
];

const PANEL_BOX_LEFT = 'left';
const PANEL_BOX_CENTER = 'center';
const PANEL_BOX_RIGHT = 'right';

const Columns = {
    INDICATOR_NAME: 0,
    MONITOR_NUMBER: 1
};

function uniqueRoles(roles) {
    const seen = new Set();
    const unique = [];

    for (const role of roles) {
        if (!role || seen.has(role))
            continue;

        seen.add(role);
        unique.push(role);
    }

    return unique;
}

function isPersistentRole(role) {
    return !!role && !TRANSIENT_ROLE_PATTERNS.some(pattern => pattern.test(role));
}

function getDefaultIndicatorPosition(role) {
    switch (role) {
    case 'dateMenu':
        return PANEL_BOX_CENTER;
    case 'quickSettings':
        return PANEL_BOX_RIGHT;
    default:
        return PANEL_BOX_LEFT;
    }
}

function getIndicatorDisplayName(role) {
    switch (role) {
    case 'appMenu':
        return _('Application Menu');
    case 'activities':
        return _('Activities');
    case 'a11y':
        return _('Accessbility');
    case 'keyboard':
        return _('Keyboard');
    case 'screenSharing':
        return _('Screen Sharing');
    case 'screenRecording':
        return _('Screen Recording');
    case 'quickSettings':
        return _('Quick Settings');
    case 'dateMenu':
        return _('Date and Clock');
    default:
        return role;
    }
}

function getDefaultIndicatorPadding(settings, role) {
    if (role === 'quickSettings') {
        try {
            return settings.get_int(QUICK_SETTINGS_GAP_ID);
        } catch (_e) {
            return 0;
        }
    }

    return 0;
}

function mergeUniqueRoles(...roleGroups) {
    const merged = [];

    for (const roles of roleGroups) {
        for (const role of roles) {
            if (!isPersistentRole(role) || merged.includes(role))
                continue;

            merged.push(role);
        }
    }

    return merged;
}

function getOrderableIndicators(settings) {
    const available = (settings.get_strv(AVAILABLE_INDICATORS_ID) || []).filter(isPersistentRole);
    const transfers = settings.get_value(TRANSFER_INDICATORS_ID).deep_unpack();
    const order = (settings.get_strv(INDICATOR_ORDER_ID) || []).filter(isPersistentRole);

    return mergeUniqueRoles(
        FIXED_EXTERNAL_PANEL_ROLES,
        available,
        Object.keys(transfers),
        order
    );
}

function clearListBox(listBox) {
    let row = listBox?.get_row_at_index?.(0);
    while (row) {
        listBox.remove(row);
        row = listBox.get_row_at_index(0);
    }
}

class MultiMonitorsPrefsWidget extends Adw.PreferencesGroup {
    _init(settings, desktopSettings) {
        super._init({
            margin_top: 12,
            margin_end: 12,
            margin_bottom: 12,
            margin_start: 12,
            title: _('Settings'),
        });

        this._settings = settings;
        this._desktopSettings = desktopSettings;

        this._display = Gdk.Display.get_default();
        this._monitors = this._display.get_monitors();

        this._draggedIndicatorName = null;
        this._updatingIndicatorOrder = false;

        this._currentSection = null;
        this._addBooleanSwitch(_('Show bar on additional monitors'), SHOW_PANEL_ID);

        this._beginSection(
            _('General'),
            _('General behavior for additional monitors and desktop integration.')
        );
        this._addSettingsBooleanSwitch(_('Enable hot corners'), this._desktopSettings, ENABLE_HOT_CORNERS);
        this._addBooleanSwitch(_('Show screenshot tools on all monitors'), SCREENSHOT_ON_ALL_MONITORS_ID);

        const indicatorsSection = this._beginSection(
            _('Indicators'),
            _('Reorder indicators, choose their group, and show or hide them on additional monitors.')
        );
        this._appendIndicatorOrderSection();

        this._beginSubsection(
            _('Transferred Indicators'),
            _('Move stable indicators away from the primary bar to a specific monitor.')
        );
        this._appendTransferSection();
        this._currentSection = indicatorsSection;

        this._transferChangedId = this._settings.connect(`changed::${TRANSFER_INDICATORS_ID}`, () => {
            this._updateTransfers();
            this._normalizeIndicatorOrder();
            this._updateIndicatorOrderList();
        });

        this._availableChangedId = this._settings.connect(`changed::${AVAILABLE_INDICATORS_ID}`, () => {
            this._normalizeIndicatorOrder();
            this._updateIndicatorOrderList();
        });

        this._orderChangedId = this._settings.connect(`changed::${INDICATOR_ORDER_ID}`, () => {
            this._updateIndicatorOrderList();
        });

        this._hiddenChangedId = this._settings.connect(`changed::${HIDDEN_INDICATORS_ID}`, () => {
            this._updateIndicatorOrderList();
        });

        this._positionsChangedId = this._settings.connect(`changed::${INDICATOR_POSITIONS_ID}`, () => {
            this._updateIndicatorOrderList();
        });

        this._updateTransfers();
        this._normalizeIndicatorOrder();
        this._updateIndicatorOrderList();
    }

    _uniqueRoles(roles) {
        return uniqueRoles(roles);
    }

    _isPersistentRole(role) {
        return isPersistentRole(role);
    }

    _getDefaultIndicatorPosition(role) {
        return getDefaultIndicatorPosition(role);
    }

    _getIndicatorDisplayName(role) {
        return getIndicatorDisplayName(role);
    }

    _getMonitorIndexes() {
        const primaryMonitor = this._display.get_primary_monitor?.() ?? null;
        const indexes = Array.from(
            {length: this._monitors.get_n_items()},
            (_unused, index) => index
        );

        if (!primaryMonitor)
            return indexes;

        return indexes.filter(index => this._monitors.get_item(index) !== primaryMonitor);
    }

    _getIndicatorPositions() {
        try {
            return this._settings.get_value(INDICATOR_POSITIONS_ID).deep_unpack();
        } catch (_e) {
            return {};
        }
    }

    _getIndicatorPosition(role) {
        const positions = this._getIndicatorPositions();
        const box = positions[role];
        return [PANEL_BOX_LEFT, PANEL_BOX_CENTER, PANEL_BOX_RIGHT].includes(box)
            ? box
            : this._getDefaultIndicatorPosition(role);
    }

    _setIndicatorPosition(role, box) {
        const positions = this._getIndicatorPositions();
        positions[role] = box;
        this._settings.set_value(INDICATOR_POSITIONS_ID, new GLib.Variant('a{ss}', positions));
    }

    _getPanelBoxRank(box) {
        switch (box) {
        case PANEL_BOX_LEFT:
            return 0;
        case PANEL_BOX_CENTER:
            return 1;
        case PANEL_BOX_RIGHT:
            return 2;
        default:
            return 0;
        }
    }

    _mergeUniqueRoles(...roleGroups) {
        return mergeUniqueRoles(...roleGroups);
    }

    _normalizeOrderByPositions(order, allowed = null) {
        const effectiveAllowed = allowed ?? this._getOrderableIndicators();
        const deduped = this._uniqueRoles(
            (order || []).filter(role => this._isPersistentRole(role) && effectiveAllowed.includes(role))
        );
        const next = [];

        for (const box of [PANEL_BOX_LEFT, PANEL_BOX_CENTER, PANEL_BOX_RIGHT]) {
            for (const role of deduped) {
                if (this._getIndicatorPosition(role) === box)
                    next.push(role);
            }
        }

        for (const role of effectiveAllowed) {
            if (!next.includes(role))
                next.push(role);
        }

        return next;
    }

    _createExpanderRow(title, description) {
        const expander = new Adw.ExpanderRow({
            title,
            subtitle: description,
            expanded: true,
            activatable: false,
        });

        return expander;
    }

    _newAlignedBox(params = {}) {
        return new Gtk.Box({
            valign: Gtk.Align.CENTER,
            ...params,
        });
    }

    _beginSection(title, description) {
        const expander = this._createExpanderRow(title, description);

        this.add(expander);
        this._currentSection = expander;
        return expander;
    }

    _beginSubsection(title, description) {
        if (!this._currentSection)
            return null;

        const expander = this._createExpanderRow(title, description);
        this._currentSection.add_row(expander);
        this._currentSection = expander;
        return expander;
    }

    _appendWidgetToCurrentSection(widget) {
        const row = new Adw.PreferencesRow({
            activatable: false,
            selectable: false,
        });
        row.set_child(widget);
        if (this._currentSection)
            this._currentSection.add_row(row);
        else
            this.add(row);
    }

    _appendRowToCurrentSection(widget) {
        this._appendWidgetToCurrentSection(widget);
    }

    _appendTransferSection() {
        const outer = this._newAlignedBox({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 6,
            hexpand: true,
            vexpand: true,
        });

        this._store = new Gtk.ListStore();
        this._store.set_column_types([GObject.TYPE_STRING, GObject.TYPE_INT]);

        this._treeView = new Gtk.TreeView({
            model: this._store,
            hexpand: true,
            vexpand: true,
            height_request: 180,
        });
        this._treeView.get_selection().set_mode(Gtk.SelectionMode.SINGLE);

        const appColumn = new Gtk.TreeViewColumn({
            expand: true,
            sort_column_id: Columns.INDICATOR_NAME,
            title: _('Indicators transferred to additional monitors')
        });

        let nameRenderer = new Gtk.CellRendererText();
        appColumn.pack_start(nameRenderer, true);
        appColumn.add_attribute(nameRenderer, 'text', Columns.INDICATOR_NAME);

        let monitorRenderer = new Gtk.CellRendererText();
        appColumn.pack_start(monitorRenderer, true);
        appColumn.add_attribute(monitorRenderer, 'text', Columns.MONITOR_NUMBER);

        this._treeView.append_column(appColumn);
        outer.append(this._treeView);

        const toolbar = this._newAlignedBox({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 6,
        });

        const addButton = new Gtk.Button({
            label: '+',
            valign: Gtk.Align.CENTER,
            tooltip_text: _('Add indicator'),
        });
        addButton.connect('clicked', () => this._addIndicator());
        toolbar.append(addButton);

        const removeButton = new Gtk.Button({
            label: '-',
            valign: Gtk.Align.CENTER,
            tooltip_text: _('Remove indicator'),
        });
        removeButton.connect('clicked', () => this._removeIndicator());
        toolbar.append(removeButton);

        outer.append(toolbar);
        this._appendWidgetToCurrentSection(outer);
    }

    _appendIndicatorOrderSection() {
        this._orderList = new Gtk.ListBox({
            selection_mode: Gtk.SelectionMode.NONE,
            css_classes: ['boxed-list'],
            hexpand: true,
            vexpand: true,
        });

        const scrolled = new Gtk.ScrolledWindow({
            min_content_height: 260,
            hexpand: true,
            vexpand: true,
            margin_top: 10,
            margin_bottom: 10,
            margin_start: 10,
            margin_end: 10,
        });
        scrolled.set_child(this._orderList);
        this._appendWidgetToCurrentSection(scrolled);

        const listDropTarget = Gtk.DropTarget.new(
            GObject.TYPE_STRING,
            Gdk.DragAction.MOVE
        );

        listDropTarget.connect('drop', (_target, value) => {
            const sourceName = String(value);
            this._moveIndicatorToEnd(sourceName);
            return true;
        });

        this._orderList.add_controller(listDropTarget);
    }
    
    _getOrderableIndicators() {
        return getOrderableIndicators(this._settings);
    }

    _normalizeIndicatorOrder() {
        if (this._updatingIndicatorOrder)
            return;

        const allowed = this._getOrderableIndicators();
        const current = (this._settings.get_strv(INDICATOR_ORDER_ID) || [])
            .filter(role => this._isPersistentRole(role));
        const next = this._normalizeOrderByPositions(current, allowed);

        const changed = next.length !== current.length ||
            next.some((role, index) => role !== current[index]);

        if (changed) {
            this._updatingIndicatorOrder = true;
            this._settings.set_strv(INDICATOR_ORDER_ID, next);
            this._updatingIndicatorOrder = false;
        }
    }

    _updateIndicatorOrderList() {
        if (!this._orderList)
            return;

        clearListBox(this._orderList);

        const allowed = this._getOrderableIndicators();
        const order = (this._settings.get_strv(INDICATOR_ORDER_ID) || [])
            .filter(role => this._isPersistentRole(role));
        const ordered = this._uniqueRoles(order.filter(role => allowed.includes(role)));

        for (const role of allowed) {
            if (!ordered.includes(role))
                ordered.push(role);
        }

        for (const role of ordered) {
            this._orderList.append(this._createOrderRow(role));
        }
    }

    _createOrderRow(role) {
        const row = new Gtk.ListBoxRow({
            activatable: false,
            selectable: false,
        });

        row._indicatorName = role;

        const box = this._newAlignedBox({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 10,
            margin_top: 8,
            margin_bottom: 8,
            margin_start: 10,
            margin_end: 10,
            hexpand: true,
        });

        const dragIcon = new Gtk.Label({
            label: '\u2261',
            valign: Gtk.Align.CENTER,
            css_classes: ['dim-label'],
        });
        box.append(dragIcon);

        const name = new Gtk.Label({
            label: this._getIndicatorDisplayName(role),
            xalign: 0,
            hexpand: true,
            halign: Gtk.Align.FILL,
        });
        box.append(name);

        const positionModel = Gtk.StringList.new([
            _('Left'),
            _('Center'),
            _('Right'),
        ]);
        const positionValues = [PANEL_BOX_LEFT, PANEL_BOX_CENTER, PANEL_BOX_RIGHT];
        const currentPosition = this._getIndicatorPosition(role);
        const currentIndex = Math.max(0, positionValues.indexOf(currentPosition));
        const positionDropdown = new Gtk.DropDown({
            model: positionModel,
            selected: currentIndex,
            valign: Gtk.Align.CENTER,
            tooltip_text: _('Choose where this indicator should appear'),
        });
        positionDropdown.connect('notify::selected', widget => {
            const selected = positionValues[widget.selected] || PANEL_BOX_LEFT;
            this._setIndicatorPosition(role, selected);
            this._normalizeIndicatorOrder();
        });
        box.append(positionDropdown);

        const hidden = (this._settings.get_strv(HIDDEN_INDICATORS_ID) || []).includes(role);
        const visibilitySwitch = new Gtk.Switch({
            valign: Gtk.Align.CENTER,
            active: !hidden,
            tooltip_text: _('Show or hide this indicator on Multi Monitor Bar'),
        });
        visibilitySwitch.connect('notify::active', widget => {
            const current = this._uniqueRoles(
                (this._settings.get_strv(HIDDEN_INDICATORS_ID) || []).filter(name => this._isPersistentRole(name))
            );

            const next = widget.active
                ? current.filter(name => name !== role)
                : this._uniqueRoles([...current, role]);

            this._settings.set_strv(HIDDEN_INDICATORS_ID, next);
        });
        box.append(visibilitySwitch);

        row.set_child(box);

        const dragSource = new Gtk.DragSource({
            actions: Gdk.DragAction.MOVE,
        });

        dragSource.connect('prepare', () => {
            this._draggedIndicatorName = role;
            return Gdk.ContentProvider.new_for_value(role);
        });

        dragSource.connect('drag-end', () => {
            this._draggedIndicatorName = null;
            row.remove_css_class('accent');
        });

        dragSource.connect('drag-begin', () => {
            row.add_css_class('accent');
        });

        row.add_controller(dragSource);

        const dropTarget = Gtk.DropTarget.new(
            GObject.TYPE_STRING,
            Gdk.DragAction.MOVE
        );

        dropTarget.connect('enter', () => {
            row.add_css_class('suggested-action');
            return Gdk.DragAction.MOVE;
        });

        dropTarget.connect('leave', () => {
            row.remove_css_class('suggested-action');
        });

        dropTarget.connect('drop', (_target, value) => {
            row.remove_css_class('suggested-action');
            const sourceName = String(value);
            this._moveIndicatorBefore(sourceName, role);
            return true;
        });

        row.add_controller(dropTarget);

        return row;
    }

    _moveIndicatorBefore(sourceName, targetName) {
        if (!sourceName || !targetName || sourceName === targetName)
            return;

        this._normalizeIndicatorOrder();
        const current = (this._settings.get_strv(INDICATOR_ORDER_ID) || [])
            .filter(role => this._isPersistentRole(role));
        const next = current.filter(name => name !== sourceName);
        const sourceBox = this._getIndicatorPosition(sourceName);
        const targetBox = this._getIndicatorPosition(targetName);

        if (this._getPanelBoxRank(sourceBox) < this._getPanelBoxRank(targetBox)) {
            let insertIndex = next.indexOf(targetName);
            while (insertIndex > 0 && this._getIndicatorPosition(next[insertIndex - 1]) === sourceBox)
                insertIndex--;
            next.splice(insertIndex, 0, sourceName);
        } else if (this._getPanelBoxRank(sourceBox) > this._getPanelBoxRank(targetBox)) {
            const insertIndex = next.findIndex(role => this._getIndicatorPosition(role) === sourceBox);
            if (insertIndex < 0)
                next.push(sourceName);
            else
                next.splice(insertIndex, 0, sourceName);
        } else {
            const targetIndex = next.indexOf(targetName);
            if (targetIndex < 0)
                next.push(sourceName);
            else
                next.splice(targetIndex, 0, sourceName);
        }

        this._settings.set_strv(INDICATOR_ORDER_ID, this._normalizeOrderByPositions(next));
    }

    _moveIndicatorToEnd(sourceName) {
        if (!sourceName)
            return;

        this._normalizeIndicatorOrder();
        const current = (this._settings.get_strv(INDICATOR_ORDER_ID) || [])
            .filter(role => this._isPersistentRole(role));
        const next = current.filter(name => name !== sourceName);
        const sourceBox = this._getIndicatorPosition(sourceName);
        let insertIndex = -1;

        for (let i = next.length - 1; i >= 0; i--) {
            if (this._getIndicatorPosition(next[i]) === sourceBox) {
                insertIndex = i + 1;
                break;
            }
        }

        if (insertIndex < 0)
            next.push(sourceName);
        else
            next.splice(insertIndex, 0, sourceName);

        this._settings.set_strv(INDICATOR_ORDER_ID, this._normalizeOrderByPositions(next));
    }

    _updateTransfers() {
        this._store.clear();

        const transfers = this._settings.get_value(TRANSFER_INDICATORS_ID).deep_unpack();
        let changed = false;

        for (const indicator of Object.keys(transfers)) {
            if (this._isPersistentRole(indicator))
                continue;

            delete transfers[indicator];
            changed = true;
        }

        if (changed) {
            this._settings.set_value(TRANSFER_INDICATORS_ID, new GLib.Variant('a{si}', transfers));
            return;
        }

        Object.keys(transfers)
            .sort((a, b) => a.localeCompare(b))
            .forEach(indicator => {
                const monitor = transfers[indicator];
                const iter = this._store.append();
                this._store.set(iter,
                    [Columns.INDICATOR_NAME, Columns.MONITOR_NUMBER],
                    [indicator, monitor]);
            });
    }

    _addIndicator() {
        const dialog = new Gtk.Dialog({
            title: _('Select indicator'),
            transient_for: this.get_root(),
            modal: true,
        });
        dialog.add_button(_('Cancel'), Gtk.ResponseType.CANCEL);
        dialog.add_button(_('Add'), Gtk.ResponseType.OK);
        dialog.set_default_response(Gtk.ResponseType.OK);

        const grid = this._newAlignedBox({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 12,
            margin_top: 12,
            margin_bottom: 12,
            margin_start: 12,
            margin_end: 12,
        });

        dialog._store = new Gtk.ListStore();
        dialog._store.set_column_types([GObject.TYPE_STRING]);

        dialog._treeView = new Gtk.TreeView({
            model: dialog._store,
            hexpand: true,
            vexpand: true,
        });
        dialog._treeView.get_selection().set_mode(Gtk.SelectionMode.SINGLE);

        const appColumn = new Gtk.TreeViewColumn({
            expand: true,
            sort_column_id: Columns.INDICATOR_NAME,
            title: _('Indicators on Top Panel')
        });

        const nameRenderer = new Gtk.CellRendererText();
        appColumn.pack_start(nameRenderer, true);
        appColumn.add_attribute(nameRenderer, 'text', Columns.INDICATOR_NAME);
        dialog._treeView.append_column(appColumn);

        const availableIndicators = () => {
            const transfers = this._settings.get_value(TRANSFER_INDICATORS_ID).deep_unpack();
            dialog._store.clear();

            this._settings.get_strv(AVAILABLE_INDICATORS_ID).forEach(indicator => {
                if (!this._isPersistentRole(indicator))
                    return;

                if (!Object.prototype.hasOwnProperty.call(transfers, indicator)) {
                    const iter = dialog._store.append();
                    dialog._store.set(iter, [Columns.INDICATOR_NAME], [indicator]);
                }
            });
        };

        const availableIndicatorsId = this._settings.connect(`changed::${AVAILABLE_INDICATORS_ID}`, availableIndicators);
        const transferIndicatorsId = this._settings.connect(`changed::${TRANSFER_INDICATORS_ID}`, availableIndicators);

        availableIndicators();
        grid.append(dialog._treeView);

        const gHBox = this._newAlignedBox({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 20,
            hexpand: true
        });

        const gLabel = new Gtk.Label({ label: _('Monitor index:'), halign: Gtk.Align.START });
        gHBox.append(gLabel);

        dialog._monitorIndexes = [];
        dialog._monitorList = Gtk.StringList.new([]);
        const monitorDropdown = new Gtk.DropDown({
            halign: Gtk.Align.END,
            model: dialog._monitorList,
        });
        gHBox.append(monitorDropdown);

        const monitorsChanged = () => {
            dialog._monitorIndexes = this._getMonitorIndexes();
            dialog._monitorList.splice(0, dialog._monitorList.get_n_items(), []);

            for (const monitorIndex of dialog._monitorIndexes)
                dialog._monitorList.append(String(monitorIndex));

            monitorDropdown.selected = dialog._monitorIndexes.length > 0 ? 0 : Gtk.INVALID_LIST_POSITION;
        };

        const monitorsChangedId = this._monitors.connect('items-changed', monitorsChanged);
        monitorsChanged();

        grid.append(gHBox);
        dialog.get_content_area().append(grid);

        dialog.connect('response', (_dlg, id) => {
            this._monitors.disconnect(monitorsChangedId);
            this._settings.disconnect(availableIndicatorsId);
            this._settings.disconnect(transferIndicatorsId);

            if (id !== Gtk.ResponseType.OK) {
                dialog.destroy();
                return;
            }

            const [any, model, iter] = dialog._treeView.get_selection().get_selected();
            if (any) {
                const indicator = model.get_value(iter, Columns.INDICATOR_NAME);
                const transfers = this._settings.get_value(TRANSFER_INDICATORS_ID).deep_unpack();
                const selectedMonitor = dialog._monitorIndexes[monitorDropdown.selected];

                if (!Object.prototype.hasOwnProperty.call(transfers, indicator) &&
                    Number.isInteger(selectedMonitor)) {
                    transfers[indicator] = selectedMonitor;
                    this._settings.set_value(TRANSFER_INDICATORS_ID, new GLib.Variant('a{si}', transfers));

                    const order = this._uniqueRoles(this._settings.get_strv(INDICATOR_ORDER_ID) || []);
                    if (!order.includes(indicator)) {
                        order.push(indicator);
                        this._settings.set_strv(INDICATOR_ORDER_ID, order);
                    }
                }
            }

            dialog.destroy();
        });

        dialog.present();
    }

    _removeIndicator() {
        const [any, model, iter] = this._treeView.get_selection().get_selected();
        if (!any)
            return;

        const indicator = model.get_value(iter, Columns.INDICATOR_NAME);
        const transfers = this._settings.get_value(TRANSFER_INDICATORS_ID).deep_unpack();

        if (Object.prototype.hasOwnProperty.call(transfers, indicator)) {
            delete transfers[indicator];
            this._settings.set_value(TRANSFER_INDICATORS_ID, new GLib.Variant('a{si}', transfers));
        }
    }

    _addComboBoxSwitch(label, schemaId, options) {
        this._addSettingsComboBoxSwitch(label, this._settings, schemaId, options);
    }

    _addSettingsComboBoxSwitch(label, settings, schemaId, options) {
        const gHBox = this._newAlignedBox({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 20,
            hexpand: true,
            margin_top: 8,
            margin_bottom: 8,
            margin_start: 10,
            margin_end: 10,
        });

        const gLabel = new Gtk.Label({ label: _(label), halign: Gtk.Align.START, hexpand: true, xalign: 0 });
        gHBox.append(gLabel);

        const gCBox = new Gtk.ComboBoxText({ halign: Gtk.Align.END });
        Object.entries(options).forEach(([key, val]) => {
            gCBox.append(key, val);
        });
        gHBox.append(gCBox);

        this._appendRowToCurrentSection(gHBox);
        settings.bind(schemaId, gCBox, 'active-id', Gio.SettingsBindFlags.DEFAULT);
    }

    _addBooleanSwitch(label, schemaId) {
        this._addSettingsBooleanSwitch(label, this._settings, schemaId);
    }

    _addSettingsBooleanSwitch(label, settings, schemaId) {
        const gHBox = this._newAlignedBox({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 20,
            hexpand: true,
            margin_top: 8,
            margin_bottom: 8,
            margin_start: 10,
            margin_end: 10,
        });

        const gLabel = new Gtk.Label({ label: _(label), halign: Gtk.Align.START, hexpand: true, xalign: 0 });
        gHBox.append(gLabel);

        const gSwitch = new Gtk.Switch({ halign: Gtk.Align.END });
        gHBox.append(gSwitch);

        this._appendRowToCurrentSection(gHBox);
        settings.bind(schemaId, gSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
    }
}

const MultiMonitorsPrefsWidgetGObject = GObject.registerClass(MultiMonitorsPrefsWidget);

class IndicatorPaddingPrefsWidget extends Adw.PreferencesGroup {
    _init(settings) {
        super._init({
            margin_top: 12,
            margin_end: 12,
            margin_bottom: 12,
            margin_start: 12,
            title: _('Layout'),
            description: _('Adjust internal left and right padding for each indicator on additional monitor bars.'),
        });

        this._settings = settings;
        this._paddingList = new Gtk.ListBox({
            selection_mode: Gtk.SelectionMode.NONE,
            css_classes: ['boxed-list'],
            hexpand: true,
            vexpand: true,
        });

        const scrolled = new Gtk.ScrolledWindow({
            min_content_height: 320,
            hexpand: true,
            vexpand: true,
            margin_top: 10,
            margin_bottom: 10,
            margin_start: 10,
            margin_end: 10,
        });
        scrolled.set_child(this._paddingList);

        const indicatorSection = new Adw.ExpanderRow({
            title: _('Indicator Padding'),
            subtitle: _('Adjust internal left and right padding for each indicator.'),
            expanded: true,
            activatable: false,
        });
        const listRow = new Adw.PreferencesRow({
            activatable: false,
            selectable: false,
        });
        listRow.set_child(scrolled);
        indicatorSection.add_row(listRow);
        this.add(indicatorSection);

        this._addGapControls();

        this._availableChangedId = this._settings.connect(`changed::${AVAILABLE_INDICATORS_ID}`, () => {
            this._updatePaddingList();
        });
        this._transferChangedId = this._settings.connect(`changed::${TRANSFER_INDICATORS_ID}`, () => {
            this._updatePaddingList();
        });
        this._orderChangedId = this._settings.connect(`changed::${INDICATOR_ORDER_ID}`, () => {
            this._updatePaddingList();
        });
        this.connect('destroy', () => this._disconnectSignals());

        this._updatePaddingList();
    }

    _disconnectSignals() {
        if (this._availableChangedId) {
            this._settings.disconnect(this._availableChangedId);
            this._availableChangedId = null;
        }
        if (this._transferChangedId) {
            this._settings.disconnect(this._transferChangedId);
            this._transferChangedId = null;
        }
        if (this._orderChangedId) {
            this._settings.disconnect(this._orderChangedId);
            this._orderChangedId = null;
        }
    }

    _uniqueRoles(roles) {
        return uniqueRoles(roles);
    }

    _isPersistentRole(role) {
        return isPersistentRole(role);
    }

    _getIndicatorDisplayName(role) {
        return getIndicatorDisplayName(role);
    }

    _getOrderableIndicators() {
        return getOrderableIndicators(this._settings);
    }

    _getIndicatorPaddingMap() {
        try {
            return this._settings.get_value(INDICATOR_PADDING_ID).deep_unpack();
        } catch (_e) {
            return {};
        }
    }

    _getIndicatorPadding(role) {
        const paddingMap = this._getIndicatorPaddingMap();
        return Number.isInteger(paddingMap[role])
            ? paddingMap[role]
            : getDefaultIndicatorPadding(this._settings, role);
    }

    _setIndicatorPadding(role, padding) {
        const paddingMap = this._getIndicatorPaddingMap();
        const nextPadding = Number.isFinite(padding) ? Math.round(padding) : 0;

        if (nextPadding === 0)
            delete paddingMap[role];
        else
            paddingMap[role] = nextPadding;

        this._settings.set_value(INDICATOR_PADDING_ID, new GLib.Variant('a{si}', paddingMap));
    }

    _updatePaddingList() {
        clearListBox(this._paddingList);

        const order = (this._settings.get_strv(INDICATOR_ORDER_ID) || [])
            .filter(role => this._isPersistentRole(role));
        const allowed = this._getOrderableIndicators();
        const roles = this._uniqueRoles([
            ...order.filter(role => allowed.includes(role)),
            ...allowed,
        ]);
        for (const role of roles)
            this._paddingList.append(this._createPaddingRow(role));
    }

    _createScale(adjustment = null) {
        const scale = new Gtk.Scale({
            orientation: Gtk.Orientation.HORIZONTAL,
            adjustment: adjustment ?? new Gtk.Adjustment({
                lower: 0,
                upper: 30,
                step_increment: 1,
                page_increment: 4,
            }),
            digits: 0,
            draw_value: false,
            hexpand: true,
            round_digits: 0,
            has_origin: true,
        });

        for (let mark = 0; mark <= 30; mark += 5)
            scale.add_mark(mark, Gtk.PositionType.TOP, null);

        return scale;
    }

    _createSliderControlBox(value) {
        const controlBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 0,
            hexpand: true,
            halign: Gtk.Align.FILL,
        });
        controlBox.set_size_request(0, -1);

        const valueLabel = new Gtk.Label({
            label: String(value),
            css_classes: ['dim-label'],
            valign: Gtk.Align.CENTER,
            width_chars: 2,
            xalign: 1,
        });
        controlBox.append(valueLabel);
        controlBox.append(new Gtk.Box({
            width_request: 4,
        }));

        return {controlBox, valueLabel};
    }

    _createHalfWidthSliderRowContent(labelText, value, onChange, adjustment = null) {
        const outer = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 12,
            margin_top: 10,
            margin_bottom: 10,
            margin_start: 12,
            margin_end: 12,
            hexpand: true,
        });

        const nameBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            hexpand: true,
            halign: Gtk.Align.FILL,
        });
        const name = new Gtk.Label({
            label: labelText,
            xalign: 0,
            hexpand: true,
            halign: Gtk.Align.FILL,
        });
        nameBox.append(name);
        outer.append(nameBox);

        const {controlBox, valueLabel} = this._createSliderControlBox(value);
        const scale = this._createScale(adjustment ?? new Gtk.Adjustment({
            lower: 0,
            upper: 30,
            step_increment: 1,
            page_increment: 4,
            value,
        }));
        scale.set_size_request(0, -1);
        scale.hexpand = true;
        scale.connect('value-changed', widget => {
            const nextValue = Math.round(widget.get_value());
            if (valueLabel.label !== String(nextValue))
                valueLabel.label = String(nextValue);
            onChange(nextValue);
        });
        controlBox.append(scale);
        outer.append(controlBox);
        outer.set_homogeneous(true);

        return {outer, scale, valueLabel};
    }

    _createPaddingRow(role) {
        const row = new Gtk.ListBoxRow({
            activatable: false,
            selectable: false,
        });

        const {outer} = this._createHalfWidthSliderRowContent(
            this._getIndicatorDisplayName(role),
            this._getIndicatorPadding(role),
            value => {
                if (value !== this._getIndicatorPadding(role))
                    this._setIndicatorPadding(role, value);
            }
        );
        row.set_child(outer);
        return row;
    }

    _addGapControls() {
        const quickSettingsGapRow = new Adw.PreferencesRow({
            activatable: false,
            selectable: false,
        });
        const {outer: quickSettingsGapBox} = this._createHalfWidthSliderRowContent(
            _('Quick Settings gap'),
            this._settings.get_int(QUICK_SETTINGS_GAP_ID),
            value => {
                if (value !== this._settings.get_int(QUICK_SETTINGS_GAP_ID))
                    this._settings.set_int(QUICK_SETTINGS_GAP_ID, value);
            }
        );
        quickSettingsGapRow.set_child(quickSettingsGapBox);
        this.add(quickSettingsGapRow);

        const gapRow = new Adw.PreferencesRow({
            activatable: false,
            selectable: false,
        });
        const {outer: gapBox} = this._createHalfWidthSliderRowContent(
            _('Indicator gap'),
            this._settings.get_int(INDICATOR_GAP_ID),
            value => {
                if (value !== this._settings.get_int(INDICATOR_GAP_ID))
                    this._settings.set_int(INDICATOR_GAP_ID, value);
            }
        );
        gapRow.set_child(gapBox);
        this.add(gapRow);

        const panelSection = new Adw.ExpanderRow({
            title: _('Panel Layout'),
            subtitle: _('Adjust panel left and right padding and height.'),
            expanded: false,
            activatable: false,
        });

        const makePanelRow = (label, key, upper = 80) => {
            const row = new Adw.PreferencesRow({
                activatable: false,
                selectable: false,
            });
            const {outer} = this._createHalfWidthSliderRowContent(
                label,
                this._settings.get_int(key),
                value => {
                    if (value !== this._settings.get_int(key))
                        this._settings.set_int(key, value);
                },
                new Gtk.Adjustment({
                    lower: 0,
                    upper,
                    step_increment: 1,
                    page_increment: 4,
                    value: this._settings.get_int(key),
                })
            );
            row.set_child(outer);
            panelSection.add_row(row);
        };

        makePanelRow(_('Panel left padding'), PANEL_LEFT_PADDING_ID);
        makePanelRow(_('Panel right padding'), PANEL_RIGHT_PADDING_ID);
        makePanelRow(_('Panel height'), PANEL_HEIGHT_ID, 120);
        this.add(panelSection);

        const applyRow = new Adw.ActionRow({
            title: _('Apply to main panel'),
            subtitle: _('Use the same panel height, panel padding, and indicator spacing on the primary GNOME top bar.'),
            activatable: false,
        });
        const applySwitch = new Gtk.Switch({
            valign: Gtk.Align.CENTER,
            active: this._settings.get_boolean(APPLY_INDICATOR_LAYOUT_TO_MAIN_PANEL_ID),
        });
        applySwitch.connect('notify::active', widget => {
            if (widget.active !== this._settings.get_boolean(APPLY_INDICATOR_LAYOUT_TO_MAIN_PANEL_ID))
                this._settings.set_boolean(APPLY_INDICATOR_LAYOUT_TO_MAIN_PANEL_ID, widget.active);
        });
        applyRow.add_suffix(applySwitch);
        this.add(applyRow);
    }
}

const IndicatorPaddingPrefsWidgetGObject = GObject.registerClass(IndicatorPaddingPrefsWidget);

export default class MultiMonitorsExtensionPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const desktopSettings = new Gio.Settings({ schema: 'org.gnome.desktop.interface' });

        const settingsPage = new Adw.PreferencesPage({
            title: _('Settings'),
            icon_name: 'preferences-system-symbolic',
        });
        settingsPage.add(new MultiMonitorsPrefsWidgetGObject(settings, desktopSettings));
        window.add(settingsPage);

        const paddingPage = new Adw.PreferencesPage({
            title: _('Layout'),
            icon_name: 'view-more-symbolic',
        });
        paddingPage.add(new IndicatorPaddingPrefsWidgetGObject(settings));
        window.add(paddingPage);
    }
}
