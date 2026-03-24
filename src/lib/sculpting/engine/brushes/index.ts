export { DrawBrush } from "./DrawBrush";
export { ClayStripsBrush } from "./ClayStripsBrush";
export { SmoothBrush } from "./SmoothBrush";
export { FlattenBrush } from "./FlattenBrush";
export { InflateBrush } from "./InflateBrush";
export { GrabBrush } from "./GrabBrush";
export { PinchBrush } from "./PinchBrush";
export { CreaseBrush } from "./CreaseBrush";
export { ScrapeBrush } from "./ScrapeBrush";
export { FillBrush } from "./FillBrush";
export { SnakeHookBrush } from "./SnakeHookBrush";
export { ThumbBrush } from "./ThumbBrush";
export { LayerBrush } from "./LayerBrush";
export { ElasticDeformBrush } from "./ElasticDeformBrush";
export { PoseBrush } from "./PoseBrush";
export { MaskBrush } from "./MaskBrush";

import { DrawBrush } from "./DrawBrush";
import { ClayStripsBrush } from "./ClayStripsBrush";
import { SmoothBrush } from "./SmoothBrush";
import { FlattenBrush } from "./FlattenBrush";
import { InflateBrush } from "./InflateBrush";
import { GrabBrush } from "./GrabBrush";
import { PinchBrush } from "./PinchBrush";
import { CreaseBrush } from "./CreaseBrush";
import { ScrapeBrush } from "./ScrapeBrush";
import { FillBrush } from "./FillBrush";
import { SnakeHookBrush } from "./SnakeHookBrush";
import { ThumbBrush } from "./ThumbBrush";
import { LayerBrush } from "./LayerBrush";
import { ElasticDeformBrush } from "./ElasticDeformBrush";
import { PoseBrush } from "./PoseBrush";
import { MaskBrush } from "./MaskBrush";
import type { Brush } from "../BrushSystem";

/** Create instances of all 16 brushes */
export function createAllBrushes(): Brush[] {
  return [
    new DrawBrush(),
    new ClayStripsBrush(),
    new SmoothBrush(),
    new FlattenBrush(),
    new InflateBrush(),
    new GrabBrush(),
    new PinchBrush(),
    new CreaseBrush(),
    new ScrapeBrush(),
    new FillBrush(),
    new SnakeHookBrush(),
    new ThumbBrush(),
    new LayerBrush(),
    new ElasticDeformBrush(),
    new PoseBrush(),
    new MaskBrush(),
  ];
}
