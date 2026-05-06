/*
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
import St from 'gi://St';

import * as Config from 'resource:///org/gnome/shell/misc/config.js';
import { pgettext as C_ } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import { QuickSettingsMenu, SystemIndicator } from 'resource:///org/gnome/shell/ui/quickSettings.js';

import * as Common from '../../shared/common.js';

const N_QUICK_SETTINGS_COLUMNS = 2;

async function importStatusModule(name, optional = false) {
    try {
        return await import(`resource:///org/gnome/shell/ui/status/${name}.js`);
    } catch (e) {
        if (!optional)
            throw e;

        Common.debug(`Optional quick settings module unavailable: ${name}`);
        return null;
    }
}

const UnsafeModeIndicator = GObject.registerClass(
    class UnsafeModeIndicator extends SystemIndicator {
        _init() {
            super._init();

            this._indicator = this._addIndicator();
            this._indicator.icon_name = 'channel-insecure-symbolic';
            global.context.bind_property(
                'unsafe-mode',
                this._indicator,
                'visible',
                GObject.BindingFlags.SYNC_CREATE
            );
        }
    });

export const AuxiliaryQuickSettings = GObject.registerClass(
    class AuxiliaryQuickSettings extends PanelMenu.Button {
        _init() {
            super._init(0.0, C_('System menu in the top bar', 'System'), true);

            this._indicators = new St.BoxLayout({
                style_class: 'panel-status-indicators-box',
            });
            this.add_child(this._indicators);

            this.setMenu(new QuickSettingsMenu(this, N_QUICK_SETTINGS_COLUMNS));

            this._setupIndicators().catch(error => {
                Common.error('Failed to setup quick settings', error);
            });
        }

        async _setupIndicators() {
            if (this._isDestroying)
                return;

            const [
                AutoRotateStatus,
                BackgroundAppsStatus,
                BacklightStatus,
                BrightnessStatus,
                CameraStatus,
                DarkModeStatus,
                DoNotDisturb,
                LocationStatus,
                NightLightStatus,
                PowerProfileStatus,
                RemoteAccessStatus,
                RFKillStatus,
                SystemStatus,
                ThunderboltStatus,
                VolumeStatus,
            ] = await Promise.all([
                importStatusModule('autoRotate'),
                importStatusModule('backgroundApps'),
                importStatusModule('backlight', true),
                importStatusModule('brightness'),
                importStatusModule('camera'),
                importStatusModule('darkMode'),
                importStatusModule('doNotDisturb'),
                importStatusModule('location'),
                importStatusModule('nightLight'),
                importStatusModule('powerProfiles'),
                importStatusModule('remoteAccess'),
                importStatusModule('rfkill'),
                importStatusModule('system'),
                importStatusModule('thunderbolt'),
                importStatusModule('volume'),
            ]);

            if (this._isDestroying)
                return;

            this._network = null;
            this._bluetooth = null;
            if (Config.HAVE_NETWORKMANAGER) {
                const NetworkStatus = await importStatusModule('network');
                this._network = new NetworkStatus.Indicator();
            }
            if (Config.HAVE_BLUETOOTH) {
                const BluetoothStatus = await importStatusModule('bluetooth');
                this._bluetooth = new BluetoothStatus.Indicator();
            }

            if (this._isDestroying)
                return;

            this._system = new SystemStatus.Indicator();
            this._camera = new CameraStatus.Indicator();
            this._volumeOutput = new VolumeStatus.OutputIndicator();
            this._volumeInput = new VolumeStatus.InputIndicator();
            this._brightness = new BrightnessStatus.Indicator();
            this._remoteAccess = new RemoteAccessStatus.RemoteAccessApplet();
            this._location = new LocationStatus.Indicator();
            this._thunderbolt = new ThunderboltStatus.Indicator();
            this._nightLight = new NightLightStatus.Indicator();
            this._darkMode = new DarkModeStatus.Indicator();
            this._doNotDisturb = new DoNotDisturb.Indicator();
            this._backlight = BacklightStatus ? new BacklightStatus.Indicator() : null;
            this._powerProfiles = new PowerProfileStatus.Indicator();
            this._rfkill = new RFKillStatus.Indicator();
            this._autoRotate = new AutoRotateStatus.Indicator();
            this._unsafeMode = new UnsafeModeIndicator();
            this._backgroundApps = new BackgroundAppsStatus.Indicator();

            let pos = 0;
            this._indicators.insert_child_at_index(this._remoteAccess, pos++);
            this._indicators.insert_child_at_index(this._camera, pos++);
            this._indicators.insert_child_at_index(this._volumeInput, pos++);
            this._indicators.insert_child_at_index(this._location, pos++);

            this._indicators.add_child(this._brightness);
            this._indicators.add_child(this._thunderbolt);
            this._indicators.add_child(this._nightLight);
            if (this._network)
                this._indicators.add_child(this._network);
            this._indicators.add_child(this._darkMode);
            this._indicators.add_child(this._doNotDisturb);
            if (this._backlight)
                this._indicators.add_child(this._backlight);
            if (this._bluetooth)
                this._indicators.add_child(this._bluetooth);
            this._indicators.add_child(this._rfkill);
            this._indicators.add_child(this._autoRotate);
            this._indicators.add_child(this._volumeOutput);
            this._indicators.add_child(this._unsafeMode);
            this._indicators.add_child(this._powerProfiles);
            this._indicators.add_child(this._system);

            const sibling = this.menu.getFirstItem();
            this._addItemsBefore(this._system.quickSettingsItems, sibling, N_QUICK_SETTINGS_COLUMNS);
            this._addItemsBefore(this._volumeOutput.quickSettingsItems, sibling, N_QUICK_SETTINGS_COLUMNS);
            this._addItemsBefore(this._volumeInput.quickSettingsItems, sibling, N_QUICK_SETTINGS_COLUMNS);
            this._addItemsBefore(this._brightness.quickSettingsItems, sibling, N_QUICK_SETTINGS_COLUMNS);

            this._addItemsBefore(this._camera.quickSettingsItems, sibling);
            this._addItemsBefore(this._remoteAccess.quickSettingsItems, sibling);
            this._addItemsBefore(this._thunderbolt.quickSettingsItems, sibling);
            this._addItemsBefore(this._location.quickSettingsItems, sibling);
            if (this._network)
                this._addItemsBefore(this._network.quickSettingsItems, sibling);
            if (this._bluetooth)
                this._addItemsBefore(this._bluetooth.quickSettingsItems, sibling);
            this._addItemsBefore(this._powerProfiles.quickSettingsItems, sibling);
            this._addItemsBefore(this._nightLight.quickSettingsItems, sibling);
            this._addItemsBefore(this._darkMode.quickSettingsItems, sibling);
            this._addItemsBefore(this._doNotDisturb.quickSettingsItems, sibling);
            if (this._backlight)
                this._addItemsBefore(this._backlight.quickSettingsItems, sibling);
            this._addItemsBefore(this._rfkill.quickSettingsItems, sibling);
            this._addItemsBefore(this._autoRotate.quickSettingsItems, sibling);
            this._addItemsBefore(this._unsafeMode.quickSettingsItems, sibling);

            this._backgroundApps.quickSettingsItems.forEach(item => {
                this.menu.addItem(item, N_QUICK_SETTINGS_COLUMNS);
            });
        }

        _addItemsBefore(items, sibling, colSpan = 1) {
            items.forEach(item => this.menu.insertItemBefore(item, sibling, colSpan));
        }

        addExternalIndicator(indicator, colSpan = 1) {
            let sibling = this._brightness ?? null;
            this._indicators.insert_child_below(indicator, sibling);

            sibling = this._backgroundApps?.quickSettingsItems?.at(-1) ?? null;
            this._addItemsBefore(indicator.quickSettingsItems, sibling, colSpan);
        }

        destroy() {
            this._isDestroying = true;
            super.destroy();
        }
    });
