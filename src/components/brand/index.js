// Components live in the "use client" module; the name and the mark geometry
// live in a plain module so Server Components can import them as real values.
export { default as Logo, LogoMark } from "./Logo";
export {
  BRAND_NAME,
  MARK_VIEW_BOX,
  MARK_TILE_RADIUS,
  MARK_CHECK_D,
  MARK_CHECK_POINTS,
  MARK_CHECK_WIDTH,
} from "./brand";
