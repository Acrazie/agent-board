import type { ClientModule } from 'claude-code'

// An empty, pressable region laid over a whole repository band, on desktop; it
// draws nothing, so the band shows through. A left press anywhere in it, or Return or Space once a click has
// given it the focus, asks the plugin to toggle the row; the plugin decides what
// that does.
const Band: ClientModule = (_props, surface) => {
  // Listeners are set once per instance: the function runs again on every resize, and setting them on each
  // call floods the page with messages while the pane is resized, which faults the Client.
  if (surface.state === undefined) {
    surface.onPointer(event => {
      if (event.type === 'down' && event.button === 'left') surface.post({ toggle: true })
    })
    surface.onKey(event => {
      if (event.key === 'return' || event.key === ' ') surface.post({ toggle: true })
      // R refreshes the pane, as the refresh Button's hotkey does on the other surfaces.
      if (event.key === 'r' && !event.ctrl && !event.meta) surface.post({ refresh: true })
    })
    surface.setState(true)
  }
  // No height of its own: the Client's fixed rows size the region.
  return surface.elements.Box({ width: '100%' })
}

export default Band
