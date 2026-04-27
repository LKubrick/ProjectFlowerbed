/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as THREE from 'three';
import * as TWEEN from '@tweenjs/tween.js';

import {
	LoopingAudioComponent,
	LoopingAudioResources,
	OneshotAudioComponent,
} from '../../components/AudioComponents';

import { AssetDatabaseComponent } from '../../components/AssetDatabaseComponent';
import { Howler } from 'howler';
import { Object3DComponent } from '../../components/Object3DComponent';
import { PlayerStateComponent } from '../../components/PlayerStateComponent';
import { System } from 'ecsy';
import { getOnlyEntity } from '../../utils/entityUtils';
import { updateMatrixRecursively } from '../../utils/object3dUtils';

const GLOBAL_AUDIO_FADE_TIME = 2;
const _vector = new THREE.Vector3();
const _vector2 = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _orientation = new THREE.Vector3();

export class AudioSystem extends System {
	init() {
		this._missingAudioIds = new Set();
		this._boundUnlockAudioContext = this._unlockAudioContext.bind(this);

		const compressor = Howler.ctx.createDynamicsCompressor();

		Howler.masterGain.disconnect(Howler.ctx.destination);
		Howler.masterGain.connect(compressor);
		compressor.connect(Howler.ctx.destination);

		Howler.volume(0);

		this._tweenValues = { volume: 0 };
		this.fadeInTween = new TWEEN.Tween(this._tweenValues)
			.to({ volume: 1 }, GLOBAL_AUDIO_FADE_TIME) // second value is time n ms
			.onUpdate(() => {
				Howler.volume(this._tweenValues.volume);
			});

		this.fadeOutTween = new TWEEN.Tween(this._tweenValues)
			.to({ volume: 0 }, GLOBAL_AUDIO_FADE_TIME)
			.easing(TWEEN.Easing.Quadratic.Out)
			.onUpdate(() => {
				Howler.volume(this._tweenValues.volume);
			});

		this._bindAudioUnlock();

		this._setGlobalAudible(true);

		// handle any looping sounds that were added before initialization
		const audioDatabase = getOnlyEntity(
			this.queries.assetDatabase,
		).getComponent(AssetDatabaseComponent)?.audio;
		this.queries.loopingSounds.results.forEach((entity) => {
			this._initializeLoopingSound(entity, audioDatabase);
		});
	}

	_bindAudioUnlock() {
		['pointerdown', 'keydown', 'touchend'].forEach((eventName) => {
			window.addEventListener(eventName, this._boundUnlockAudioContext, {
				passive: true,
			});
		});

		this._unlockAudioContext();
	}

	_removeAudioUnlockListeners() {
		['pointerdown', 'keydown', 'touchend'].forEach((eventName) => {
			window.removeEventListener(eventName, this._boundUnlockAudioContext);
		});
	}

	_unlockAudioContext() {
		if (!Howler.ctx || Howler.ctx.state === 'running') {
			this._removeAudioUnlockListeners();
			return;
		}

		Howler.ctx
			.resume()
			.then(() => {
				if (Howler.ctx.state === 'running') {
					this._removeAudioUnlockListeners();
				}
			})
			.catch(() => {
				// Keep the listeners alive so the next interaction can retry.
			});
	}

	execute() {
		const audioDatabase = getOnlyEntity(
			this.queries.assetDatabase,
		).getComponent(AssetDatabaseComponent)?.audio;

		// move the listener to the player position
		const playerEntity = getOnlyEntity(this.queries.player, false);
		if (playerEntity) {
			const viewerTransform = playerEntity.getComponent(PlayerStateComponent)
				.viewerTransform;

			viewerTransform.matrixWorld.decompose(_vector, _quat, _vector2);
			_orientation.set(0, 0, -1).applyQuaternion(_quat);
			audioDatabase.moveListener(_vector, _orientation, viewerTransform.up);
		}

		// Play sound effectss
		// These get played once
		this.queries.oneshotSounds.results.forEach((entity) => {
			const oneshot = entity.getComponent(OneshotAudioComponent);
			const audioObject = audioDatabase.get(oneshot.id);
			if (!audioObject) {
				this._warnMissingAudio(oneshot.id);
				if (oneshot.isTempEntity) {
					entity.remove();
				} else {
					entity.removeComponent(OneshotAudioComponent);
				}
				return;
			}

			// play the sound
			const instanceId = audioDatabase.play(oneshot.id);

			// note that position should be world position
			if (oneshot.position) {
				audioObject.pos(
					oneshot.position.x,
					oneshot.position.y,
					oneshot.position.z,
					instanceId,
				);
			}

			// then remove the component so we don't play it again.
			// remove the entire entity if we created a temporary entity to play this.
			if (oneshot.isTempEntity) {
				entity.remove();
			} else {
				entity.removeComponent(OneshotAudioComponent);
			}
		});

		// Handle looping sounds
		this.queries.loopingSounds.added.forEach((entity) => {
			this._initializeLoopingSound(entity, audioDatabase);
		});

		this.queries.loopingSounds.removed.forEach((entity) => {
			const loopResource = entity.getComponent(LoopingAudioResources);
			if (!loopResource) {
				return;
			}

			// stop the sound
			audioDatabase.stop(
				loopResource.audioId,
				loopResource.fadeOutDuration,
				loopResource.instanceId,
			);

			// remove the resources
			entity.removeComponent(LoopingAudioResources);
		});

		this.queries.loopingSounds.changed.forEach((entity) => {
			const loop = entity.getComponent(LoopingAudioComponent);
			const loopResource = entity.getMutableComponent(LoopingAudioResources);
			if (!loopResource) {
				this._initializeLoopingSound(entity, audioDatabase);
				return;
			}

			// update the loop resource's fadeOutDuration if need be
			if (loop.fadeOutDuration !== loopResource.fadeOutDuration) {
				loopResource.fadeOutDuration = loop.fadeOutDuration;
			}

			// if we need to change the sound id, we stop the old one and start the new one
			if (loop.id !== loopResource.audioId) {
				// stop the old sound
				audioDatabase.stop(
					loopResource.audioId,
					loopResource.fadeOutDuration,
					loopResource.instanceId,
				);
				// ...and start the new one right away
				loopResource.audioId = loop.id;
				const audioObject = audioDatabase.get(loop.id);
				if (!audioObject) {
					this._warnMissingAudio(loop.id);
					entity.removeComponent(LoopingAudioResources);
					return;
				}
				loopResource.instanceId = audioDatabase.play(
					loop.id,
					loop.fadeInDuration,
				);
				audioObject.loop(true, loopResource.instanceId);
			}
		});

		this.queries.positionalLoopingSounds.added.forEach((entity) => {
			this._updateLoopingSoundPosition(entity, audioDatabase);
		});

		this.queries.positionalLoopingSounds.results.forEach((entity) => {
			const object3D = entity.getComponent(Object3DComponent).value;
			if (!object3D.matrixAutoUpdate) {
				return;
			}
			this._updateLoopingSoundPosition(entity, audioDatabase);
		});
	}

	_initializeLoopingSound(entity, audioDatabase) {
		const loop = entity.getComponent(LoopingAudioComponent);

		const audioObject = audioDatabase.get(loop.id);
		if (!audioObject) {
			this._warnMissingAudio(loop.id);
			return;
		}

		audioObject.once('play', () => {
			if (!audioObject.loop()) {
				audioObject.loop(true);
			}
		});

		const instanceId = audioDatabase.play(loop.id, loop.fadeInDuration);

		// add resource component to keep track of what's being played
		entity.addComponent(LoopingAudioResources, {
			audioId: loop.id,
			instanceId: instanceId,
			volume: loop.volume,
		});

		if (entity.hasComponent(Object3DComponent)) {
			this._updateLoopingSoundPosition(entity, audioDatabase);
		}
	}

	_updateLoopingSoundPosition(entity, audioDatabase) {
		const object3D = entity.getComponent(Object3DComponent).value;
		updateMatrixRecursively(object3D);
		object3D.getWorldPosition(_vector);
		const position = _vector;

		const loop = entity.getComponent(LoopingAudioComponent);
		const loopResource = entity.getComponent(LoopingAudioResources);
		const audioObject = audioDatabase.get(loop.id);
		if (!loopResource || !audioObject) {
			if (!audioObject) {
				this._warnMissingAudio(loop.id);
			}
			return;
		}

		audioObject.pos(
			position.x,
			position.y,
			position.z,
			loopResource.instanceId,
		);
	}

	_warnMissingAudio(id) {
		if (this._missingAudioIds.has(id)) {
			return;
		}

		this._missingAudioIds.add(id);
		console.warn(`Skipping unavailable audio asset: ${id}`);
	}

	_setGlobalAudible(audible, isImmediate) {
		this.isAudible = audible;
		if (isImmediate) {
			Howler.volume(this.isAudible ? 1 : 0);
			return;
		}

		if (this.isAudible) {
			this.fadeInTween.start();
		} else {
			this.fadeOutTween.start();
		}
	}
}

AudioSystem.queries = {
	assetDatabase: {
		components: [AssetDatabaseComponent],
	},
	oneshotSounds: {
		components: [OneshotAudioComponent],
	},
	loopingSounds: {
		components: [LoopingAudioComponent],
		listen: { added: true, removed: true, changed: [LoopingAudioComponent] },
	},
	positionalLoopingSounds: {
		components: [LoopingAudioComponent, Object3DComponent],
		listen: { added: true },
	},
	player: {
		components: [PlayerStateComponent],
	},
};
