/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as THREE from 'three';

import { OldSparkRenderer, SplatMesh } from '@sparkjsdev/spark';

import { GaussianSplatLoaderComponent } from '../../components/GaussianSplatLoaderComponent';
import { Object3DComponent } from '../../components/Object3DComponent';
import { System } from 'ecsy';
import { THREEGlobalComponent } from '../../components/THREEGlobalComponent';
import { getOnlyEntity } from '../../utils/entityUtils';

const LOAD_TIMEOUT_MS = 30000;
const SPARK_USAMPLER_PRECISION_LINE = 'precision highp usampler2D;';
const SPARK_SAMPLER3D_PRECISION_LINE = 'precision highp sampler3D;';

const patchSparkVertexShader = (vertexShader) => {
	if (
		!vertexShader ||
		vertexShader.includes(SPARK_USAMPLER_PRECISION_LINE)
	) {
		return vertexShader;
	}

	return vertexShader.replace(
		'precision highp int;\nprecision highp usampler2DArray;',
		`precision highp int;\n${SPARK_USAMPLER_PRECISION_LINE}\nprecision highp usampler2DArray;`,
	);
};

const patchSparkFragmentShader = (fragmentShader) => {
	if (
		!fragmentShader ||
		fragmentShader.includes(SPARK_SAMPLER3D_PRECISION_LINE)
	) {
		return fragmentShader;
	}

	return fragmentShader.replace(
		'precision highp float;\nprecision highp int;',
		`precision highp float;\nprecision highp int;\n${SPARK_SAMPLER3D_PRECISION_LINE}`,
	);
};

const patchSparkIntegerTexture = (texture) => {
	if (!texture?.isTexture) {
		return;
	}

	texture.format = THREE.RGBAIntegerFormat;
	texture.type = THREE.UnsignedIntType;
	texture.internalFormat = 'RGBA32UI';
	texture.unpackAlignment = 1;
	texture.generateMipmaps = false;
	texture.needsUpdate = true;
};

const patchSparkUniformTextures = (sparkRenderer) => {
	const uniforms = sparkRenderer?.material?.uniforms;
	if (!uniforms) {
		return;
	}

	patchSparkIntegerTexture(uniforms.ordering?.value);
	patchSparkIntegerTexture(uniforms.extSplats?.value);
	patchSparkIntegerTexture(uniforms.extSplats2?.value);
};

export class GaussianSplatLoaderSystem extends System {
	init() {
		this.instances = new Map();
		this.pendingLoads = new Map();
		this.sparkRenderer = null;
		this.sparkRendererAddedToScene = false;
	}

	execute() {
		const gameManagerEntity = getOnlyEntity(this.queries.gameManager, false);
		if (!gameManagerEntity) {
			return;
		}

		const threeGlobal = gameManagerEntity.getComponent(THREEGlobalComponent);
		if (!threeGlobal?.renderer || !threeGlobal?.scene || !threeGlobal?.camera) {
			return;
		}

		this.ensureSparkRenderer(gameManagerEntity, threeGlobal);

		this.queries.splats.results.forEach((entity) => {
			const splatConfig = entity.getComponent(GaussianSplatLoaderComponent);
			if (!splatConfig.autoLoad || !splatConfig.splatUrl) {
				return;
			}

			if (this.instances.has(entity) || this.pendingLoads.has(entity)) {
				return;
			}

			this.load(entity).catch((error) => {
				console.error(
					`[GaussianSplatLoaderSystem] Failed to load splat for entity ${entity.id}:`,
					error,
				);
			});
		});

		this.queries.splats.removed.forEach((entity) => {
			this.unload(entity);
		});
	}

	ensureSparkRenderer(gameManagerEntity, threeGlobal) {
		this.patchLegacyRendererCompatibility(threeGlobal.renderer);

		if (!this.sparkRenderer) {
			this.sparkRenderer = new OldSparkRenderer({
				renderer: threeGlobal.renderer,
			});
			this.sparkRenderer.material.vertexShader = patchSparkVertexShader(
				this.sparkRenderer.material.vertexShader,
			);
			this.sparkRenderer.material.fragmentShader = patchSparkFragmentShader(
				this.sparkRenderer.material.fragmentShader,
			);
			this.sparkRenderer.frustumCulled = false;
			this.sparkRenderer.renderOrder = -10;
			patchSparkUniformTextures(this.sparkRenderer);
		}

		if (!this.sparkRendererAddedToScene) {
			threeGlobal.scene.add(this.sparkRenderer);
			this.sparkRendererAddedToScene = true;
		}

		const mutableThreeGlobal = gameManagerEntity.getMutableComponent(
			THREEGlobalComponent,
		);
		if (mutableThreeGlobal) {
			mutableThreeGlobal.sparkRenderer = this.sparkRenderer;
		}

		patchSparkUniformTextures(this.sparkRenderer);
		this.sparkRenderer.update({ scene: threeGlobal.scene });
	}

	patchLegacyRendererCompatibility(renderer) {
		if (!renderer?.properties || renderer.properties.has) {
			return;
		}

		renderer.properties.has = function has(object) {
			const properties = this.get(object);
			return Object.keys(properties).length > 0;
		};
	}

	async load(entity) {
		const config = entity.getComponent(GaussianSplatLoaderComponent);
		const parent = entity.getComponent(Object3DComponent)?.value;
		if (!config?.splatUrl) {
			throw new Error(
				`[GaussianSplatLoaderSystem] Entity ${entity.id} has an empty splatUrl.`,
			);
		}

		if (!parent) {
			throw new Error(
				`[GaussianSplatLoaderSystem] Entity ${entity.id} has no object3D.`,
			);
		}

		if (this.instances.has(entity)) {
			this.unload(entity);
		}

		const loadToken = Symbol('gaussian-splat-load');
		this.pendingLoads.set(entity, loadToken);

		const splat = new SplatMesh({
			url: config.splatUrl,
			lod: config.enableLod || undefined,
			lodScale: config.lodSplatScale,
		});
		const timeout = new Promise((_, reject) => {
			setTimeout(() => {
				reject(
					new Error(
						`[GaussianSplatLoaderSystem] Timed out loading "${config.splatUrl}" after ${LOAD_TIMEOUT_MS / 1000}s`,
					),
				);
			}, LOAD_TIMEOUT_MS);
		});

		await Promise.race([splat.initialized, timeout]);

		if (this.pendingLoads.get(entity) !== loadToken) {
			splat.dispose();
			return;
		}

		splat.renderOrder = -10;
		parent.add(splat);
		patchSparkUniformTextures(this.sparkRenderer);

		const gameManagerEntity = getOnlyEntity(this.queries.gameManager, false);
		const threeGlobal = gameManagerEntity?.getComponent(THREEGlobalComponent);
		if (this.sparkRenderer && threeGlobal?.scene) {
			this.sparkRenderer.update({ scene: threeGlobal.scene });
		}

		this.pendingLoads.delete(entity);
		this.instances.set(entity, { splat });
	}

	unload(entity) {
		this.pendingLoads.delete(entity);

		const instance = this.instances.get(entity);
		if (!instance) {
			return;
		}

		instance.splat.parent?.remove(instance.splat);
		instance.splat.dispose();
		this.instances.delete(entity);
	}
}

GaussianSplatLoaderSystem.queries = {
	gameManager: {
		components: [THREEGlobalComponent],
	},
	splats: {
		components: [GaussianSplatLoaderComponent, Object3DComponent],
		listen: { removed: true },
	},
};