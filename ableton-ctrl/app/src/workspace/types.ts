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

/** Which content a window renders. Only Rhythmic Intent exists in this pass. */
export type WindowKind = 'rhythmic-intent'

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

export const MIN_SCALE = 0.25
export const MAX_SCALE = 3
