/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as THREE from '../../../node_modules/three/build/three.module.js';

export * from '../../../node_modules/three/build/three.module.js';
export const REVISION = '179';

if (!Object.prototype.hasOwnProperty.call(THREE.Material.prototype, 'allowOverride')) {
	Object.defineProperty(THREE.Material.prototype, 'allowOverride', {
		value: true,
		writable: true,
		configurable: true,
	});
}

if (!THREE.WebGLRenderer.prototype.readRenderTargetPixelsAsync) {
	THREE.WebGLRenderer.prototype.readRenderTargetPixelsAsync = function (
		renderTarget,
		x,
		y,
		width,
		height,
		buffer,
		activeCubeFaceIndex,
	) {
		return Promise.resolve().then(() => {
			this.readRenderTargetPixels(
				renderTarget,
				x,
				y,
				width,
				height,
				buffer,
				activeCubeFaceIndex,
			);
			return buffer;
		});
	};
}

if (!THREE.BufferAttribute.prototype.addUpdateRange) {
	THREE.BufferAttribute.prototype.addUpdateRange = function (offset, count) {
		if (!this.updateRange) {
			this.updateRange = { offset: 0, count: -1 };
		}

		if (this.updateRange.count === -1) {
			this.updateRange.offset = offset;
			this.updateRange.count = count;
			return;
		}

		const start = Math.min(this.updateRange.offset, offset);
		const end = Math.max(
			this.updateRange.offset + this.updateRange.count,
			offset + count,
		);

		this.updateRange.offset = start;
		this.updateRange.count = end - start;
	};
}

if (!THREE.BufferAttribute.prototype.clearUpdateRanges) {
	THREE.BufferAttribute.prototype.clearUpdateRanges = function () {
		if (!this.updateRange) {
			this.updateRange = { offset: 0, count: -1 };
			return;
		}

		this.updateRange.offset = 0;
		this.updateRange.count = -1;
	};
}

export class Matrix2 {
	constructor() {
		this.elements = [1, 0, 0, 1];
		this.isMatrix2 = true;
	}

	set(n11, n12, n21, n22) {
		this.elements[0] = n11;
		this.elements[1] = n21;
		this.elements[2] = n12;
		this.elements[3] = n22;
		return this;
	}

	identity() {
		return this.set(1, 0, 0, 1);
	}

	copy(matrix) {
		return this.fromArray(matrix.elements);
	}

	clone() {
		return new Matrix2().fromArray(this.elements);
	}

	fromArray(array, offset = 0) {
		for (let i = 0; i < 4; i++) {
			this.elements[i] = array[i + offset];
		}
		return this;
	}

	toArray(array = [], offset = 0) {
		for (let i = 0; i < 4; i++) {
			array[offset + i] = this.elements[i];
		}
		return array;
	}
}