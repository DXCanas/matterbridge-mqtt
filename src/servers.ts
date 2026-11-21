/**
 * @file src/servers.ts
 * @description Cluster server variants that a device opts into with the `behavior` key of a cluster config.
 * @author David C
 * @created 2026-11-21
 * @version 1.0.0
 * @license Apache-2.0
 *
 * Copyright 2026 David C.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { MatterbridgeServer } from 'matterbridge';
import { MatterbridgeRvcOperationalStateServer, MatterbridgeRvcRunModeServer } from 'matterbridge/devices';
import type { Behavior } from 'matterbridge/matter';
import { ModeBase, type OperationalState, RvcOperationalState, RvcRunMode } from 'matterbridge/matter/clusters';
import type { ClusterId } from 'matterbridge/matter/types';

/** The RvcRunMode Idle mode tag, as the number a mode tag carries. */
const idleModeTag: number = RvcRunMode.ModeTag.Idle;

/**
 * RvcRunMode server for a device that publishes its own operational state (`"behavior": "deviceState"`).
 *
 * Matterbridge's `MatterbridgeRvcRunModeServer.changeToMode()` also sets the RvcOperationalState: a mode tagged Cleaning
 * makes it Running, a mode tagged Idle makes it SeekingCharger. This variant validates the request and changes the
 * current mode like Matterbridge does, runs the command handler and emits the command, and leaves the operational state
 * to the device's state messages.
 */
export class DeviceStateRvcRunModeServer extends MatterbridgeRvcRunModeServer {
  override async changeToMode(request: ModeBase.ChangeToModeRequest): Promise<ModeBase.ChangeToModeResponse> {
    const device = this.endpoint.stateOf(MatterbridgeServer);
    device.log.info(`DeviceStateRvcRunModeServer: changing mode to ${request.newMode} (endpoint ${this.endpoint.maybeId}.${this.endpoint.maybeNumber})`);
    await device.commandHandler.executeHandler('RvcRunMode.changeToMode', {
      command: 'changeToMode',
      request,
      cluster: MatterbridgeRvcRunModeServer.id,
      attributes: this.state,
      endpoint: this.endpoint,
      context: this.context,
    });
    const supported = this.state.supportedModes.find((mode) => mode.mode === request.newMode);
    if (!supported) {
      device.log.error(
        `DeviceStateRvcRunModeServer: changeToMode called with unsupported newMode ${request.newMode} (endpoint ${this.endpoint.maybeId}.${this.endpoint.maybeNumber})`,
      );
      return { status: ModeBase.ModeChangeStatus.UnsupportedMode, statusText: 'Unsupported mode' };
    }
    if (request.newMode === this.state.currentMode) {
      return { status: ModeBase.ModeChangeStatus.Success, statusText: 'Already in requested mode' };
    }
    // Without DirectModeChange, the spec allows a change between two non-Idle modes only through an Idle mode.
    const isIdle = (mode: number): boolean => this.state.supportedModes.some((candidate) => candidate.mode === mode && candidate.modeTags.some((tag) => tag.value === idleModeTag));
    if (!this.features.directModeChange && !isIdle(this.state.currentMode) && !isIdle(request.newMode)) {
      device.log.debug(
        `DeviceStateRvcRunModeServer: changeToMode rejected direct non-Idle mode change from ${this.state.currentMode} to ${request.newMode} (endpoint ${this.endpoint.maybeId}.${this.endpoint.maybeNumber})`,
      );
      return { status: ModeBase.ModeChangeStatus.InvalidInMode, statusText: 'Direct mode change is not supported while operating' };
    }
    this.state.currentMode = request.newMode;
    device.log.debug(
      `DeviceStateRvcRunModeServer: changeToMode changed mode to ${request.newMode} (${supported.label}), operational state left to the device (endpoint ${this.endpoint.maybeId}.${this.endpoint.maybeNumber})`,
    );
    this.endpoint.emitCommand(RvcRunMode, 'changeToMode', request, this.context);
    return { status: ModeBase.ModeChangeStatus.Success, statusText: 'Success' };
  }
}

/**
 * RvcOperationalState server for a device that publishes its own operational state (`"behavior": "deviceState"`).
 *
 * Matterbridge's `pause()`, `resume()` and `goHome()` set the operational state (Paused, the state before the pause,
 * SeekingCharger) and the operational error. This variant runs them unchanged (validation against the current state,
 * command handler, emitted command, response) and then puts the operational state and error back, so only the device's
 * state messages change them. The change and its reversal happen in the same transaction, so no change is reported.
 */
export class DeviceStateRvcOperationalStateServer extends MatterbridgeRvcOperationalStateServer {
  override async pause(): Promise<OperationalState.OperationalCommandResponse> {
    return this.keepingState(async () => super.pause());
  }

  override async resume(): Promise<OperationalState.OperationalCommandResponse> {
    return this.keepingState(async () => super.resume());
  }

  override async goHome(): Promise<OperationalState.OperationalCommandResponse> {
    return this.keepingState(async () => super.goHome());
  }

  /**
   * Runs a command of the Matterbridge server and restores the operational state and error it may have changed.
   *
   * @param {() => Promise<OperationalState.OperationalCommandResponse>} command - The Matterbridge command to run.
   * @returns {Promise<OperationalState.OperationalCommandResponse>} The command's response.
   */
  private async keepingState(command: () => Promise<OperationalState.OperationalCommandResponse>): Promise<OperationalState.OperationalCommandResponse> {
    const { operationalState, operationalError } = this.state;
    const response = await command();
    this.state.operationalState = operationalState;
    this.state.operationalError = operationalError;
    return response;
  }
}

/**
 * The server variants a cluster config can select with its `behavior` key, by cluster id and variant name.
 */
export const behaviorVariants: ReadonlyMap<ClusterId, Readonly<Record<string, Behavior.Type>>> = new Map<ClusterId, Readonly<Record<string, Behavior.Type>>>([
  [RvcRunMode.id, { deviceState: DeviceStateRvcRunModeServer }],
  [RvcOperationalState.id, { deviceState: DeviceStateRvcOperationalStateServer }],
]);
