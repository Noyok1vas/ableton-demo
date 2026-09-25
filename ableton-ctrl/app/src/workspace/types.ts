export type PageId =
  | 'rhythmic-intent'
  | 'untitled-2'
  | 'untitled-3'
  | 'untitled-4'
  | 'untitled-5'

export type Page = { id: PageId; name: string }

/** Canvas view transform. x/y are screen-space translation in px; scale is
    the zoom factor. Applied as translate(x,y) scale(scale) with origin 0,0. */
export type View = { x: number; y: number; scale: number }

/** Which content a window renders. */
export type WindowKind =
  | 'sound-source'
  | 'transport'
  | 'mixer'
  | 'rhythmic-intent'
  | 'collection'
  | 'sound-intent'
  | 'sound-visual'
  | 'fx'
  | 'selector'
  | 'ripple'
  | 'march-intent'
  | 'march-family'

/** Where a window's function ends up in the product. `software` stays on a
    screen (the system display and the Sound Visual); `hardware` becomes a
    physical control surface. The canvas draws the two differently — black
    outline for software, grey for hardware — so the split is visible while
    everything is still on screen. */
export type WindowTier = 'software' | 'hardware'

export type WindowState = {
  id: string
  kind: WindowKind
  title: string
  /** Position and size in canvas coordinates (pre-zoom). */
  x: number
  y: number
  w: number
  h: number
}

export type WindowLimits = {
  minW: number
  minH: number
  maxW: number
  maxH: number
}

export const MIN_SCALE = 0.05
export const MAX_SCALE = 8
