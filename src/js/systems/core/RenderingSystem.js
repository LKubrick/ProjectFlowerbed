/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { SessionComponent } from '../../components/SessionComponent';
import { System } from 'ecsy';
import { THREEGlobalComponent } from '../../components/THREEGlobalComponent';
import { THREEJS_LAYERS } from '../../Constants';

export class RenderingSystem extends System {
	init() {
		this.threeglobal = null;
		this.renderer = null;
		this.scene = null;
		this.camera = null;
		this.postProcessing = null;
		this.sparkRenderer = null;
		this.cameraWorldPosition = null;
	}

	execute(/*delta, time*/) {
		let sessionState;
		this.queries.gameManager.added.forEach((entity) => {
			this.threeglobal = entity.getComponent(THREEGlobalComponent);
			sessionState = entity.getComponent(SessionComponent);
			this.renderer = this.threeglobal.renderer;
			this.scene = this.threeglobal.scene;
			this.camera = this.threeglobal.camera;
			this.postProcessing = this.threeglobal.postProcessing;
			this.sparkRenderer = this.threeglobal.sparkRenderer;
			this.cameraWorldPosition = this.cameraWorldPosition || this.camera.position.clone();
		});

		this.queries.session.results.forEach((entity) => {
			sessionState = entity.getComponent(SessionComponent);
		});

		if (!this.renderer || !this.scene || !this.camera || !sessionState) {
			return;
		}

		this.sparkRenderer = this.threeglobal?.sparkRenderer;

		if (sessionState.isExperienceOpened) {
			const xrCamera = this.threeglobal.getCamera();
			xrCamera.layers.enable(THREEJS_LAYERS.VIEWER_ONLY);
			if (xrCamera.cameras) {
				for (const cam of xrCamera.cameras) {
					cam.layers.enable(THREEJS_LAYERS.VIEWER_ONLY);
				}
			}

			if (this.sparkRenderer && !this.renderer.xr.isPresenting) {
				this.sparkRenderer.render(this.scene, this.camera);
				return;
			}

			if (this.postProcessing && !this.renderer.xr.isPresenting) {
				if (this.postProcessing.bokehPass && this.postProcessing.focusTarget) {
					this.camera.getWorldPosition(this.cameraWorldPosition);
					this.postProcessing.bokehPass.uniforms.focus.value =
						this.cameraWorldPosition.distanceTo(this.postProcessing.focusTarget);
				}

				this.postProcessing.composer.render();
				return;
			}

			this.renderer.render(this.scene, this.camera);
		}
	}
}

RenderingSystem.queries = {
	gameManager: { components: [THREEGlobalComponent], listen: { added: true } },
	session: { components: [SessionComponent] },
};
