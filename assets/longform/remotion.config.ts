import {Config} from '@remotion/cli/config';
// Lossless intermediate frames — jpeg bakes generation-loss artifacts into
// every frame before the final h264 encode even runs. png costs render time,
// never quality, which is the trade this project always takes.
Config.setVideoImageFormat('png');
Config.setCrf(16); // delivered file — visually lossless, never traded for speed
Config.overrideWebpackConfig((c) => c);
