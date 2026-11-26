import type { ClientModule } from 'claude-code'

// An empty, pressable region laid over a whole repository band, on desktop; it
// draws nothing, so the band shows through. A left press anywhere in it, or Return or Space once a click has
// given it the focus, asks the plugin to toggle the row; the plugin decides what
// that does.
const Band: ClientModule = (_props, surface) => {
  surface.onPointer(event => {
    if (event.type === 'down' && event.button === 'left') surface.post({ toggle: true })
  })
  surface.onKey(event => {
    if (event.key === 'return' || event.key === ' ') surface.post({ toggle: true })
  })
  // Fills the whole region, so the region never shrinks to an empty drawing's size.
  return surface.elements.Box({ width: '100%', height: '100%' })
}

export default Band
