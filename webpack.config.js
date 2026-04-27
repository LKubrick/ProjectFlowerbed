/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as path from 'path';

import CopyPlugin from 'copy-webpack-plugin';
import ESLintPlugin from 'eslint-webpack-plugin';
import HtmlWebpackPlugin from 'html-webpack-plugin';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const isProd = process.env.NODE_ENV === 'production';

export default {
	mode: isProd ? 'production' : 'development',
	entry: {
		index: './src/index.js',
	},
	module: {
		rules: [
			{
				test: /\.css$/i,
				use: ['style-loader', 'css-loader'],
			},

			{
				test: /\.(js)$/,
				exclude: /node_modules/,
				resolve: {
					fullySpecified: false,
				},
			},
			{
				test: /\.html$/,
				exclude: /node_modules/,
				use: {
					loader: 'html-loader',
					options: {
						sources: false,
					},
				},
			},
		],
	},
	devServer: {
		https: true,
		host: '0.0.0.0',
		static: path.join(__dirname, 'dist'),
		compress: true,
		port: 8081,
	},
	output: {
		filename: '[name].bundle.js',
		path: path.resolve(__dirname, 'dist'),
		clean: true,
	},
	resolve: {
		alias: {
			// change this to change how different backends will use different
			// code paths
			'@config': path.resolve(__dirname, './src/js/config/github'),
			three$: path.resolve(__dirname, './src/js/lib/three-compat.js'),
			src: path.resolve(__dirname, 'src'),
		},
	},
	plugins: [
		new ESLintPlugin(),
		new HtmlWebpackPlugin({
			template: './src/index.html',
			chunks: ['index'],
			favicon: './src/favicon.png',
		}),
		new CopyPlugin({
			patterns: [
				{ from: 'src/assets', to: 'assets' },
				{
					from: 'content/images/ground_textures',
					to: 'assets/images/ground_textures',
					noErrorOnMissing: true,
				},
				{ from: 'content/HDRI', to: 'assets/HDRI', noErrorOnMissing: true },
				{ from: 'content/splats', to: 'assets/splats', noErrorOnMissing: true },
				// Cloudflare Pages routing fallback (safe to include even if unused).
				{ from: 'src/_redirects', to: '.', noErrorOnMissing: true },
				{ from: 'node_modules/three/examples/js/libs/basis', to: 'vendor' },
			],
		}),
	],
	devtool: isProd ? false : 'source-map',
};
