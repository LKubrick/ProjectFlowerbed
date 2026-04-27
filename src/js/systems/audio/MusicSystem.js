/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { DEBUG_CONSTANTS } from '../../Constants';
import { GaussianSplatLoaderComponent } from '../../components/GaussianSplatLoaderComponent';
import { Object3DComponent } from '../../components/Object3DComponent';
import { PlaylistAudioComponent } from '../../components/AudioComponents';
import { SOUNDTRACK } from '@config/SoundtrackIds';
import { SessionComponent } from '../../components/SessionComponent';
import { SettingsComponent } from '../../components/SettingsComponent';
import { System } from 'ecsy';
import { getOnlyEntity } from '../../utils/entityUtils';

// All this does now is initialize the music entity.
// functionality to play music is in PlaylistAudioSystem.
export class MusicSystem extends System {
	init() {
		this.musicEntity = this.world.createEntity();
		this.activeMusicEntity = undefined;

		const settings = getOnlyEntity(this.queries.settings, false);
		if (settings) {
			const settingsValues = settings.getComponent(SettingsComponent);
			if (!settingsValues.musicEnabled) {
				this.stop();
				return;
			}
		}

		if (this._shouldPlayMusic()) {
			this._syncMusicTarget();
		}
	}

	execute() {
		if (!this.enabled) {
			return;
		}

		if (!this._shouldPlayMusic()) {
			this._removeMusic();
			return;
		}

		this._syncMusicTarget();
	}

	stop() {
		this._removeMusic();
		super.stop();
	}

	play() {
		super.play();
		if (this._shouldPlayMusic()) {
			this._syncMusicTarget();
		}
	}

	_shouldPlayMusic() {
		const session = getOnlyEntity(this.queries.session, false);
		const sessionState = session?.getComponent(SessionComponent);

		return Boolean(sessionState?.isExperienceOpened) && !document.hidden;
	}

	_syncMusicTarget() {
		const targetEntity = this._getMusicEntity();
		if (!targetEntity) {
			return;
		}

		if (
			this.activeMusicEntity &&
			this.activeMusicEntity !== targetEntity &&
			this.activeMusicEntity.hasComponent(PlaylistAudioComponent)
		) {
			this.activeMusicEntity.removeComponent(PlaylistAudioComponent);
		}

		if (!targetEntity.hasComponent(PlaylistAudioComponent)) {
			targetEntity.addComponent(PlaylistAudioComponent, {
				ids: SOUNDTRACK,
			});
		}

		this.activeMusicEntity = targetEntity;
	}

	_removeMusic() {
		if (
			this.activeMusicEntity &&
			this.activeMusicEntity.hasComponent(PlaylistAudioComponent)
		) {
			this.activeMusicEntity.removeComponent(PlaylistAudioComponent);
		}

		if (
			this.musicEntity.hasComponent(PlaylistAudioComponent) &&
			this.activeMusicEntity !== this.musicEntity
		) {
			this.musicEntity.removeComponent(PlaylistAudioComponent);
		}

		this.activeMusicEntity = undefined;
	}

	_getMusicEntity() {
		if (!DEBUG_CONSTANTS.USE_MINIMAL_PLANT_BED_SCENE) {
			return this.musicEntity;
		}

		return getOnlyEntity(this.queries.splats, false) ?? this.musicEntity;
	}
}

MusicSystem.queries = {
	settings: {
		components: [SettingsComponent],
	},
	splats: {
		components: [GaussianSplatLoaderComponent, Object3DComponent],
	},
	session: {
		components: [SessionComponent],
	},
};
