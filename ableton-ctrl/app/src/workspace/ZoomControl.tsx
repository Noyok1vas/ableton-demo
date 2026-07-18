import type { View } from './types.ts'
import { zoomView } from './viewUtils.ts'

type ZoomControlProps = {
  view: View
  onViewChange: (view: View) => void
  onReset: () => void
}

/** Compact zoom readout + in/out/reset, fixed bottom-right in screen space. */
export function ZoomControl({ view, onViewChange, onReset }: ZoomControlProps) {
  const zoom = (factor: number) => {
    const el = document.querySelector('.surface')
    const rect = el?.getBoundingClientRect()
    const cx = rect ? rect.width / 2 : 0
    const cy = rect ? rect.height / 2 : 0
    onViewChange(zoomView(view, factor, cx, cy))
  }

  return (
    <div className="zoomctl">
      <button type="button" className="zoomctl-btn" aria-label="Zoom out" onClick={() => zoom(1 / 1.2)}>
        −
      </button>
      <span className="zoomctl-readout num">{Math.round(view.scale * 100)}%</span>
      <button type="button" className="zoomctl-btn" aria-label="Zoom in" onClick={() => zoom(1.2)}>
        +
      </button>
      <button type="button" className="zoomctl-reset" onClick={onReset}>
        Reset view
      </button>
    </div>
  )
}
