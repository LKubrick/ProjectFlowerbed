/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { Component, Types } from 'ecsy';

export class GaussianSplatLoaderComponent extends Component {}

GaussianSplatLoaderComponent.schema = {
	splatUrl: { type: Types.String, default: '' },
	autoLoad: { type: Types.Boolean, default: false },
	enableLod: { type: Types.Boolean, default: true },
	lodSplatScale: { type: Types.Number, default: 1.0 },
};